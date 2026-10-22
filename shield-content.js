// Isolated-world playback shield. Never executes page-supplied code.
(() => {
  'use strict';
  const policy = globalThis.TabSentryShieldPolicy;
  if (!policy) return;

  const SETTINGS = ['enabled', 'shieldEnabled', 'strictSites', 'allowedSites'];
  const repaired = new Map();
  const MAX_REPAIRS = 12;
  let enabled = false;
  let strict = false;
  let siteAllowed = false;
  let recentSignals = 0;
  let signalWindow = 0;

  function hostname() {
    return location.protocol === 'http:' || location.protocol === 'https:'
      ? location.hostname.toLowerCase() : null;
  }

  function informPage() {
    window.dispatchEvent(new CustomEvent('tab-sentry:shield-config', {
      detail: { enabled: enabled && !siteAllowed, strict }
    }));
  }

  function configure(settings) {
    const host = hostname();
    const wasEnabled = enabled && !siteAllowed;
    enabled = settings.enabled === true && settings.shieldEnabled !== false;
    siteAllowed = !!host && settings.allowedSites?.[host] === true;
    strict = !!host && settings.strictSites?.[host] === true;
    if (wasEnabled && (!enabled || siteAllowed)) restoreOverlays();
    informPage();
  }

  chrome.storage.local.get(SETTINGS).then(configure).catch(() => {
    configure({ enabled: false });
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !SETTINGS.some(key => key in changes)) return;
    chrome.storage.local.get(SETTINGS).then(configure).catch(() => {});
  });

  function report(type, hostnameValue = null) {
    if (!enabled || siteAllowed || chrome.extension?.inIncognitoContext) return;
    // Treat page-world notifications as untrusted: strict rate limiting.
    const now = Date.now();
    if (now - signalWindow > 60_000) {
      signalWindow = now;
      recentSignals = 0;
    }
    if (++recentSignals > 20) return;
    chrome.runtime.sendMessage({
      type: 'shield-diagnostic',
      event: { type, target: hostnameValue }
    }).catch(() => {});
  }

  window.addEventListener('tab-sentry:popup-prevented', (event) => {
    if (!event.detail || typeof event.detail !== 'object') return;
    report('popup-prevented', event.detail.hostname);
  }, true);

  function restoreOverlays() {
    for (const [element, original] of repaired) {
      if (!element.isConnected) continue;
      if (original.value) {
        element.style.setProperty('pointer-events', original.value, original.priority);
      } else {
        element.style.removeProperty('pointer-events');
      }
    }
    repaired.clear();
  }

  function findOverlay(event) {
    if (!(event.target instanceof Element) ||
        !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY) ||
        typeof document.elementsFromPoint !== 'function') return null;

    const nodes = document.elementsFromPoint(event.clientX, event.clientY).slice(0, 20);
    const media = nodes.find(node =>
      (node.tagName === 'VIDEO' || node.tagName === 'IFRAME') &&
      node !== event.target
    );
    if (!media) return null;

    const overlay = event.target.closest('a[href]') || event.target;
    if (overlay === media || overlay.contains(media) || repaired.has(overlay)) return null;
    const overlayRect = overlay.getBoundingClientRect();
    const mediaRect = media.getBoundingClientRect();
    const style = getComputedStyle(overlay);
    let external = false;
    if (overlay instanceof HTMLAnchorElement) {
      try {
        const url = new URL(overlay.href);
        external = /^https?:$/.test(url.protocol) && url.hostname !== location.hostname;
      } catch {}
    }

    const transparent = Number.parseFloat(style.opacity) <= 0.08 ||
      style.backgroundColor === 'transparent' ||
      /^rgba\([^)]*,\s*0(?:\.0+)?\s*\)$/.test(style.backgroundColor);

    if (!policy.isOverlay({
      overlayTag: overlay.tagName,
      overlayWidth: overlayRect.width,
      overlayHeight: overlayRect.height,
      playerWidth: mediaRect.width,
      playerHeight: mediaRect.height,
      isAncestor: false,
      isExternalLink: external,
      isTransparent: transparent,
      emptyElement: overlay.childNodes.length === 0
    })) return null;
    return { overlay, media };
  }

  function tryRepair(event) {
    if (!enabled || siteAllowed || !event.isTrusted || repaired.size >= MAX_REPAIRS) return;
    const found = findOverlay(event);
    if (!found) return;

    const { overlay, media } = found;
    repaired.set(overlay, {
      value: overlay.style.getPropertyValue('pointer-events'),
      priority: overlay.style.getPropertyPriority('pointer-events')
    });
    overlay.style.setProperty('pointer-events', 'none', 'important');
    report('overlay-neutralized');

    // For a first click already aimed at the old overlay, suppress its ad
    // handler and attempt native playback within the real user gesture.
    if (event.type === 'pointerdown') {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (media instanceof HTMLVideoElement && media.paused) {
        try { void media.play().catch(() => {}); } catch {}
      }
    }
  }

  window.addEventListener('pointerover', tryRepair, true);
  window.addEventListener('pointerdown', tryRepair, true);
})();
