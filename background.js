importScripts('tab-policy.js', 'diagnostics.js');

const STATE_KEY = 'enabled';
const ALLOWED_SITES_KEY = 'allowedSites';
const BLOCKED_COUNT_KEY = 'blockedCount';
const RECENT_BLOCKED_KEY = 'recentBlocked';
const DIAGNOSTIC_EVENTS_KEY = 'diagnosticEvents';
const BLANK_TARGET_GRACE_MS = 1_200;
const CLASSIFICATION_GRACE_MS = 90;

const ledger = TabSentryPolicy.createIntentLedger();
const pendingTargets = new Map();
const processingTabs = new Set();

let enabled = false;
let allowedSites = {};
let enabledChangeVersion = 0;
let sitesChangeVersion = 0;
let statisticsQueue = Promise.resolve();
let diagnosticQueue = Promise.resolve();

const configurationReady = chrome.storage.local
  .get([STATE_KEY, ALLOWED_SITES_KEY])
  .then((stored) => {
    if (enabledChangeVersion === 0) enabled = stored[STATE_KEY] === true;
    if (sitesChangeVersion === 0) allowedSites = stored[ALLOWED_SITES_KEY] || {};
  }).catch(() => {
    enabled = false;
    allowedSites = {};
  });

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get(STATE_KEY);
  if (typeof stored[STATE_KEY] !== 'boolean') {
    await chrome.storage.local.set({ [STATE_KEY]: false });
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (STATE_KEY in changes) {
    enabledChangeVersion++;
    enabled = changes[STATE_KEY].newValue === true;
  }
  if (ALLOWED_SITES_KEY in changes) {
    sitesChangeVersion++;
    allowedSites = changes[ALLOWED_SITES_KEY].newValue || {};
  }
});

function updateBadge(count) {
  return Promise.all([
    chrome.action.setBadgeBackgroundColor({ color: '#ef4444' }),
    chrome.action.setBadgeText({ text: count ? (count > 99 ? '99+' : String(count)) : '' })
  ]);
}

chrome.storage.session.get(BLOCKED_COUNT_KEY)
  .then((stored) => updateBadge(Number(stored[BLOCKED_COUNT_KEY] || 0)))
  .catch(() => {});

function enqueueStatistics(operation) {
  statisticsQueue = statisticsQueue.catch(() => {}).then(operation);
  return statisticsQueue;
}

function saveDiagnostic(event) {
  const observedAt = Date.now();
  diagnosticQueue = diagnosticQueue.catch(() => {}).then(async () => {
    const saved = await chrome.storage.session.get(DIAGNOSTIC_EVENTS_KEY);
    const events = TabSentryDiagnostics.add(
      saved[DIAGNOSTIC_EVENTS_KEY], event, observedAt
    );
    await chrome.storage.session.set({ [DIAGNOSTIC_EVENTS_KEY]: events });
  });
  // Diagnostics never delay or determine popup blocking.
  void diagnosticQueue.catch(() => {});
}

function describePopup(type, candidate, sourceTab, reason) {
  if (sourceTab.incognito === true) return;
  saveDiagnostic({
    type,
    tabId: candidate.sourceTabId,
    frame: candidate.sourceFrameId,
    site: TabSentryPolicy.siteHost(sourceTab.url),
    target: TabSentryPolicy.siteHost(candidate.url),
    reason
  });
}

function recordBlocked(sourceUrl, targetUrl) {
  return enqueueStatistics(async () => {
    const stored = await chrome.storage.session.get([BLOCKED_COUNT_KEY, RECENT_BLOCKED_KEY]);
    const count = Number(stored[BLOCKED_COUNT_KEY] || 0) + 1;
    const recent = Array.isArray(stored[RECENT_BLOCKED_KEY])
      ? stored[RECENT_BLOCKED_KEY] : [];

    recent.unshift({
      source: TabSentryPolicy.siteHost(sourceUrl) || 'Unknown source',
      target: TabSentryPolicy.siteHost(targetUrl) || 'Blank or hidden destination',
      time: Date.now()
    });

    await chrome.storage.session.set({
      [BLOCKED_COUNT_KEY]: count,
      [RECENT_BLOCKED_KEY]: recent.slice(0, 12)
    });
    await updateBadge(count);
  });
}

function resetStatistics() {
  return enqueueStatistics(async () => {
    await chrome.storage.session.set({
      [BLOCKED_COUNT_KEY]: 0,
      [RECENT_BLOCKED_KEY]: []
    });
    await updateBadge(0);
  });
}

function forgetTarget(tabId) {
  const pending = pendingTargets.get(tabId);
  if (pending?.timer) clearTimeout(pending.timer);
  pendingTargets.delete(tabId);
}

async function blockTarget(candidate, sourceTab) {
  let targetTab;
  let wasFocused = false;
  try {
    targetTab = await chrome.tabs.get(candidate.tabId);
    const focusedWindow = await chrome.windows.getLastFocused();
    wasFocused = !!targetTab.active && !!focusedWindow.focused &&
      focusedWindow.id === targetTab.windowId;
    await chrome.tabs.remove(candidate.tabId);
    describePopup('popup-blocked', candidate, sourceTab, 'unmatched-target');
  } catch {
    return;
  }

  if (wasFocused) {
    try {
      const source = await chrome.tabs.get(candidate.sourceTabId);
      const focusedWindow = await chrome.windows.getLastFocused();
      // Do not steal focus if the user has moved to another window.
      if (focusedWindow.id === targetTab.windowId ||
          focusedWindow.id === source.windowId) {
        await chrome.tabs.update(candidate.sourceTabId, { active: true });
        if (source.windowId !== targetTab.windowId) {
          await chrome.windows.update(source.windowId, { focused: true });
        }
      }
    } catch {
      // Source page may have closed.
    }
  }

  try {
    await recordBlocked(sourceTab.url, candidate.url);
  } catch {
    // Badge or storage errors should never undo successful blocking.
  }
}

async function processTarget(tabId) {
  if (processingTabs.has(tabId)) return;
  processingTabs.add(tabId);
  let observed = null;

  try {
    await configurationReady;
    while ((observed = pendingTargets.get(tabId))) {
      if (!observed.expired) return;
      if (!enabled) {
        forgetTarget(tabId);
        return;
      }

      let sourceTab;
      try {
        sourceTab = await chrome.tabs.get(observed.sourceTabId);
      } catch {
        forgetTarget(tabId);
        return;
      }
      // An update may have replaced the URL during an asynchronous API call.
      if (pendingTargets.get(tabId) !== observed) continue;

      if (!TabSentryPolicy.isProtectablePageUrl(sourceTab.url)) {
        forgetTarget(tabId);
        return;
      }

      if (!observed.diagnosticLogged) {
        observed.diagnosticLogged = true;
        describePopup('popup-attempt', observed, sourceTab);
      }

      if (TabSentryPolicy.isSiteAllowed(sourceTab.url, allowedSites)) {
        describePopup('popup-allowed', observed, sourceTab, 'site-exception');
        forgetTarget(tabId);
        return;
      }

      const intent = ledger.consume(observed.sourceTabId, observed.url, observed.sourceFrameId);
      if (intent.allowed) {
        describePopup('popup-allowed', observed, sourceTab, 'matched-link');
        forgetTarget(tabId);
        return;
      }

      if (pendingTargets.get(tabId) !== observed) continue;
      // Reserve this target before any asynchronous operations inside blockTarget.
      forgetTarget(tabId);
      await blockTarget(observed, sourceTab);
      return;
    }
  } finally {
    processingTabs.delete(tabId);
    const latest = pendingTargets.get(tabId);
    if (latest && latest !== observed && latest.expired) {
      void processTarget(tabId);
    }
  }
}

function watchTarget(tabId, sourceTabId, sourceFrameId, url) {
  forgetTarget(tabId);
  const candidate = {
    tabId,
    sourceTabId,
    sourceFrameId: Number.isInteger(sourceFrameId) ? sourceFrameId : 0,
    url,
    expired: false,
    timer: null
  };
  pendingTargets.set(tabId, candidate);

  if (TabSentryPolicy.isTransientUrl(url)) {
    candidate.timer = setTimeout(() => {
      if (pendingTargets.get(tabId) !== candidate) return;
      candidate.expired = true;
      void processTarget(tabId);
    }, BLANK_TARGET_GRACE_MS);
  } else {
    candidate.timer = setTimeout(() => {
      if (pendingTargets.get(tabId) !== candidate) return;
      candidate.expired = true;
      void processTarget(tabId);
    }, CLASSIFICATION_GRACE_MS);
  }
}

chrome.webNavigation.onCreatedNavigationTarget.addListener((details) => {
  watchTarget(details.tabId, details.sourceTabId, details.sourceFrameId, details.url);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  const pending = pendingTargets.get(tabId);
  if (!pending || !changeInfo.url || TabSentryPolicy.isTransientUrl(changeInfo.url)) return;
  watchTarget(tabId, pending.sourceTabId, pending.sourceFrameId, changeInfo.url);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  forgetTarget(tabId);
  ledger.drop(tabId);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== 'string') return false;

  if (message.type === 'diagnostic-event') {
    const type = message.event?.type;
    if (sender.tab?.incognito || !Number.isInteger(sender.tab?.id) ||
        !['video-click', 'video-playing', 'video-error'].includes(type)) return false;
    const event = {
      type,
      tabId: sender.tab.id,
      frame: sender.frameId,
      site: TabSentryPolicy.siteHost(sender.tab.url),
      context: message.event?.context
    };
    // A worker freshly woken by a video click has not loaded settings yet.
    void configurationReady.then(() => {
      if (enabled) saveDiagnostic(event);
    }).catch(() => {});
    return false;
  }

  if (message.type === 'register-new-tab-intent') {
    const registered = ledger.register(
      sender.tab?.id,
      message.url,
      sender.frameId,
      message.contextMenu === true ? 12_000 : 5_000
    );
    sendResponse({ registered });
    return false;
  }

  if (message.type === 'reset-stats') {
    resetStatistics()
      .then(() => sendResponse({ reset: true }))
      .catch(() => sendResponse({ reset: false }));
    return true;
  }

  return false;
});
