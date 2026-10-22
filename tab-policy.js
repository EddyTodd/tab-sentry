(function exposeTabSentryPolicy(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TabSentryPolicy = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function buildPolicy() {
  function normalizeUrl(value, base) {
    if (typeof value !== 'string' || !value.trim()) return null;
    try {
      return new URL(value, base).href;
    } catch {
      return null;
    }
  }

  function isTransientUrl(value) {
    return !value || value === 'about:blank';
  }

  function isProtectablePageUrl(value) {
    const url = normalizeUrl(value);
    if (!url) return false;
    const protocol = new URL(url).protocol;
    return protocol === 'http:' || protocol === 'https:';
  }

  function siteHost(value) {
    const url = normalizeUrl(value);
    return isProtectablePageUrl(url) ? new URL(url).hostname.toLowerCase() : null;
  }

  function isSiteAllowed(value, allowedSites) {
    const host = siteHost(value);
    return !!host && !!allowedSites &&
      Object.prototype.hasOwnProperty.call(allowedSites, host) &&
      allowedSites[host] === true;
  }

  function createIntentLedger(options = {}) {
    const intentTtlMs = options.intentTtlMs ?? 5_000;
    const now = options.now ?? Date.now;
    const intentsByFrame = new Map();

    function key(tabId, frameId) {
      return tabId + ':' + frameId;
    }

    function clean(frameKey) {
      const live = (intentsByFrame.get(frameKey) || [])
        .filter((intent) => intent.expiresAt > now());
      if (live.length) intentsByFrame.set(frameKey, live);
      else intentsByFrame.delete(frameKey);
    }

    function register(tabId, url, frameId = 0, ttlMs = intentTtlMs) {
      const normalizedUrl = normalizeUrl(url);
      if (!Number.isInteger(tabId) || !Number.isInteger(frameId) ||
          !isProtectablePageUrl(normalizedUrl) ||
          !Number.isFinite(ttlMs) || ttlMs <= 0) return false;

      const frameKey = key(tabId, frameId);
      clean(frameKey);
      const intents = (intentsByFrame.get(frameKey) || [])
        .filter((intent) => intent.url !== normalizedUrl);
      intents.push({ url: normalizedUrl, expiresAt: now() + Math.min(ttlMs, 12_000) });
      intentsByFrame.set(frameKey, intents.slice(-5));
      return true;
    }

    function consume(tabId, url, frameId = 0) {
      const normalizedUrl = normalizeUrl(url);
      if (!Number.isInteger(tabId) || !Number.isInteger(frameId) || !normalizedUrl) {
        return { allowed: false, reason: null };
      }

      const frameKey = key(tabId, frameId);
      clean(frameKey);
      const intents = intentsByFrame.get(frameKey) || [];
      const index = intents.findIndex((intent) => intent.url === normalizedUrl);
      if (index < 0) return { allowed: false, reason: null };

      intents.splice(index, 1);
      if (intents.length) intentsByFrame.set(frameKey, intents);
      else intentsByFrame.delete(frameKey);
      return { allowed: true, reason: 'matched-link' };
    }

    function drop(tabId) {
      for (const frameKey of intentsByFrame.keys()) {
        if (frameKey.startsWith(tabId + ':')) intentsByFrame.delete(frameKey);
      }
    }

    return { register, consume, drop };
  }

  return {
    normalizeUrl,
    isTransientUrl,
    isProtectablePageUrl,
    siteHost,
    isSiteAllowed,
    createIntentLedger
  };
});
