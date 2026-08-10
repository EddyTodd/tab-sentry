(function exposeTabSentryPolicy(root, factory) {
  const api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }

  if (root) {
    root.TabSentryPolicy = api;
  }
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
    const normalizedUrl = normalizeUrl(value);
    if (!normalizedUrl) return false;

    const protocol = new URL(normalizedUrl).protocol;
    return protocol === 'http:' || protocol === 'https:';
  }

  function createIntentLedger(options = {}) {
    const intentTtlMs = options.intentTtlMs ?? 30_000;
    const now = options.now ?? Date.now;
    const intentsByTab = new Map();

    function clean(tabId) {
      const currentTime = now();
      const liveIntents = (intentsByTab.get(tabId) || [])
        .filter((intent) => intent.expiresAt > currentTime);

      if (liveIntents.length) intentsByTab.set(tabId, liveIntents);
      else intentsByTab.delete(tabId);
    }

    function register(tabId, url) {
      const normalizedUrl = normalizeUrl(url);
      if (!Number.isInteger(tabId) || !normalizedUrl) return false;

      clean(tabId);
      const intents = intentsByTab.get(tabId) || [];
      const withoutDuplicate = intents.filter((intent) => intent.url !== normalizedUrl);
      withoutDuplicate.push({
        url: normalizedUrl,
        expiresAt: now() + intentTtlMs
      });
      intentsByTab.set(tabId, withoutDuplicate.slice(-5));
      return true;
    }

    function consume(tabId, url) {
      const normalizedUrl = normalizeUrl(url);
      if (!Number.isInteger(tabId) || !normalizedUrl) {
        return { allowed: false, reason: null };
      }

      clean(tabId);
      const intents = intentsByTab.get(tabId) || [];
      const matchingIndex = intents.findIndex((intent) => intent.url === normalizedUrl);

      if (matchingIndex >= 0) {
        intents.splice(matchingIndex, 1);
        if (intents.length) intentsByTab.set(tabId, intents);
        else intentsByTab.delete(tabId);
        return { allowed: true, reason: 'matched-link' };
      }

      return { allowed: false, reason: null };
    }

    function drop(tabId) {
      intentsByTab.delete(tabId);
    }

    return { register, consume, drop };
  }

  return { normalizeUrl, isTransientUrl, isProtectablePageUrl, createIntentLedger };
});
