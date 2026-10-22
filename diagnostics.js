(function exposeDiagnostics(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TabSentryDiagnostics = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function buildDiagnostics() {
  const WINDOW_MS = 60_000;
  const MAX_EVENTS = 120;
  const types = new Set([
    'video-click', 'video-playing', 'video-error',
    'popup-attempt', 'popup-allowed', 'popup-blocked'
  ]);
  const contexts = new Set(['video', 'embedded-frame', 'play-control', 'covering-element']);
  const reasons = new Set(['matched-link', 'site-exception', 'unmatched-target']);

  function safeHost(value) {
    if (typeof value !== 'string') return null;
    const host = value.toLowerCase();
    return host.length <= 253 && /^(?=.{1,253}$)[a-z0-9.-]+$/.test(host) ? host : null;
  }

  function normalize(event, time) {
    if (!event || !types.has(event.type) ||
        !Number.isSafeInteger(event.tabId) || event.tabId < 0 ||
        !Number.isFinite(time)) return null;

    const normalized = {
      time,
      tabId: event.tabId,
      type: event.type,
      site: safeHost(event.site),
      frame: Number.isSafeInteger(event.frame) && event.frame >= 0 ? event.frame : 0
    };
    const target = safeHost(event.target);
    if (target && event.type.startsWith('popup-')) normalized.target = target;
    if (contexts.has(event.context) && event.type === 'video-click') {
      normalized.context = event.context;
    }
    if (reasons.has(event.reason) && event.type.startsWith('popup-')) {
      normalized.reason = event.reason;
    }
    return normalized;
  }

  function trim(events, now) {
    if (!Array.isArray(events)) return [];
    return events.filter((entry) =>
      entry && Number.isFinite(entry.time) && entry.time >= now - WINDOW_MS &&
      entry.time <= now + 1000 &&
      types.has(entry.type) && Number.isSafeInteger(entry.tabId) &&
      entry.tabId >= 0
    ).slice(-MAX_EVENTS);
  }

  function add(events, event, now = Date.now()) {
    const next = normalize(event, now);
    const live = trim(events, now);
    if (next) live.push(next);
    return live.slice(-MAX_EVENTS);
  }

  function createReport(events, tabId, now = Date.now(), site = null) {
    const filtered = trim(events, now)
      .filter((entry) => entry.tabId === tabId)
      .sort((left, right) => left.time - right.time);
    const timeline = filtered.map((entry) => {
      const output = {
        secondsAgo: Math.round((now - entry.time) / 100) / 10,
        type: entry.type
      };
      if (safeHost(entry.site)) output.site = safeHost(entry.site);
      if (safeHost(entry.target)) output.target = safeHost(entry.target);
      if (entry.frame) output.frame = 'subframe';
      if (contexts.has(entry.context)) output.context = entry.context;
      if (reasons.has(entry.reason)) output.reason = entry.reason;
      return output;
    });

    let suspectedClickHijacks = 0;
    for (const clicked of filtered.filter((e) => e.type === 'video-click')) {
      const popup = filtered.find((e) =>
        e.type === 'popup-attempt' &&
        e.time >= clicked.time && e.time <= clicked.time + 2_000);
      const playback = filtered.find((e) =>
        e.type === 'video-playing' &&
        e.time >= clicked.time && e.time <= clicked.time + 3_000);
      if (popup && !playback) suspectedClickHijacks++;
    }

    return {
      product: 'Tab Sentry',
      reportVersion: 1,
      scope: 'active-tab-only',
      site: safeHost(site),
      windowSeconds: WINDOW_MS / 1000,
      summary: {
        recordedEvents: timeline.length,
        popupAttempts: timeline.filter((e) => e.type === 'popup-attempt').length,
        blockedPopups: timeline.filter((e) => e.type === 'popup-blocked').length,
        playbackStarts: timeline.filter((e) => e.type === 'video-playing').length,
        possibleClickHijacks: suspectedClickHijacks
      },
      privacy: 'Hostnames and event categories only. No URLs, page text, cookies or video content.',
      timeline
    };
  }

  return { WINDOW_MS, MAX_EVENTS, safeHost, normalize, trim, add, createReport };
});
