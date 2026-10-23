// Page-world hook. The host page can inspect/replace it; the browser's
// webNavigation classifier remains the fallback if this is bypassed.
(() => {
  'use strict';
  if (typeof window.open !== 'function' || !globalThis.TabSentryShieldPolicy) return;
  const policy = globalThis.TabSentryShieldPolicy;
  const nativeOpen = window.open;
  let enabled = false;
  let strict = false;
  let gesture = 'other';
  let gestureTime = 0;

  window.addEventListener('tab-sentry:shield-config', (event) => {
    // Main-world signals are not a security boundary; sites can spoof them.
    if (!event.detail || typeof event.detail !== 'object') return;
    enabled = event.detail.enabled === true;
    strict = event.detail.strict === true;
  }, true);

  window.dispatchEvent(new CustomEvent('tab-sentry:shield-ready'));

  function findAnchor(element) {
    return element instanceof Element ? element.closest('a[href]') : null;
  }

  function isOverEmbeddedPlayer(event) {
    if (!enabled || !Number.isFinite(event.clientX) ||
        !Number.isFinite(event.clientY) ||
        typeof document.elementsFromPoint !== 'function') return false;
    const stack = document.elementsFromPoint(event.clientX, event.clientY).slice(0, 16);
    return stack.some((el) => {
      if (el.tagName === 'VIDEO') return true;
      if (el.tagName !== 'IFRAME') return false;
      const rect = el.getBoundingClientRect();
      return rect.width >= 160 && rect.height >= 90 &&
        (el.hasAttribute('allowfullscreen') || /autoplay/.test(el.getAttribute('allow') || ''));
    });
  }

  function classify(event) {
    if (!enabled || !event.isTrusted || !(event.target instanceof Element)) return;
    const anchor = findAnchor(event.target);
    const control = event.target.closest('button,[role="button"],a');
    const label = control
      ? [control.getAttribute('aria-label') || '', control.getAttribute('title') || '',
        typeof control.className === 'string' ? control.className : ''].join(' ')
      : '';
    const tag = event.target.tagName;
    const video = tag === 'VIDEO' || !!event.target.closest('video') ||
      isOverEmbeddedPlayer(event);
    // A deceptive external link covering a player must not authorize its own
    // popup merely because it declares target="_blank".
    if (policy.isVideoGesture({ tag, label, playerArea: video })) {
      gesture = 'video';
    } else if (anchor && ((anchor.getAttribute('target') || '').toLowerCase() === '_blank' ||
      event.metaKey || event.ctrlKey || event.shiftKey || event.button === 1)) {
      gesture = 'explicit';
    } else {
      gesture = 'other';
    }
    gestureTime = Date.now();
  }

  window.addEventListener('pointerdown', classify, true);
  window.addEventListener('keydown', (event) => {
    if (event.isTrusted && (event.key === 'Enter' || event.key === ' ')) classify(event);
  }, true);

  const protectedOpen = function (...args) {
    const recent = Date.now() - gestureTime <= policy.GESTURE_MS;
    const activation = navigator.userActivation?.isActive;
    if (policy.shouldBlockOpen({
      enabled,
      strict,
      gesture: recent ? gesture : 'other',
      activated: activation
    })) {
      // Only hostnames cross into the isolated diagnostic observer.
      let hostname = null;
      try {
        const target = new URL(String(args[0]), location.href);
        if (target.protocol === 'http:' || target.protocol === 'https:') {
          hostname = target.hostname.toLowerCase();
        }
      } catch {}
      window.dispatchEvent(new CustomEvent('tab-sentry:popup-prevented', {
        detail: { hostname }
      }));
      return null;
    }
    return Reflect.apply(nativeOpen, this, args);
  };

  try {
    window.open = protectedOpen;
  } catch {
    // Read-only/hostile wrappers are handled by the post-creation fallback.
  }
})();
