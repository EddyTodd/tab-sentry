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

  function findAnchor(element) {
    return element instanceof Element ? element.closest('a[href]') : null;
  }

  function classify(event) {
    if (!event.isTrusted || !(event.target instanceof Element)) return;
    const anchor = findAnchor(event.target);
    if (anchor && ((anchor.getAttribute('target') || '').toLowerCase() === '_blank' ||
      event.metaKey || event.ctrlKey || event.shiftKey || event.button === 1)) {
      gesture = 'explicit';
    } else {
      const control = event.target.closest('button,[role="button"],a');
      const label = control
        ? [control.getAttribute('aria-label') || '', control.getAttribute('title') || '',
          typeof control.className === 'string' ? control.className : ''].join(' ')
        : '';
      const tag = event.target.tagName;
      const video = tag === 'VIDEO' || !!event.target.closest('video');
      // Include play buttons and native video. Isolated overlay repair deals
      // separately with transparent layers above embedded media.
      gesture = policy.isVideoGesture({ tag, label, playerArea: video }) ? 'video' : 'other';
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
