importScripts('tab-policy.js');

const STATE_KEY = 'enabled';
const LAST_BLOCKED_KEY = 'lastBlocked';
const BLOCKED_COUNT_KEY = 'blockedCount';
const CLASSIFICATION_DELAY_MS = 100;
const FALLBACK_DELAY_MS = 750;

const ledger = TabSentryPolicy.createIntentLedger();
const pendingTargets = new Map();
const classifiedTabs = new Set();
const classifyingTabs = new Set();

let enabled = false;
const stateReady = chrome.storage.local.get(STATE_KEY).then((stored) => {
  enabled = !!stored[STATE_KEY];
});

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get(STATE_KEY);
  if (typeof stored[STATE_KEY] !== 'boolean') {
    await chrome.storage.local.set({ [STATE_KEY]: false });
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && STATE_KEY in changes) {
    enabled = !!changes[STATE_KEY].newValue;
  }
});

function finishClassification(tabId) {
  pendingTargets.delete(tabId);
  classifiedTabs.add(tabId);
  setTimeout(() => classifiedTabs.delete(tabId), 10_000);
}

async function refocusSource(sourceTabId) {
  if (!Number.isInteger(sourceTabId)) return;

  try {
    const sourceTab = await chrome.tabs.update(sourceTabId, { active: true });
    if (Number.isInteger(sourceTab.windowId)) {
      await chrome.windows.update(sourceTab.windowId, { focused: true });
    }
  } catch {
    // The source may have closed while the popup was being classified.
  }
}

async function rememberBlocked(url, sourceTabId) {
  const previous = await chrome.storage.session.get(BLOCKED_COUNT_KEY);
  const blockedCount = Number(previous[BLOCKED_COUNT_KEY] || 0) + 1;

  await chrome.storage.session.set({
    [LAST_BLOCKED_KEY]: {
      url: TabSentryPolicy.normalizeUrl(url),
      sourceTabId,
      blockedAt: Date.now()
    },
    [BLOCKED_COUNT_KEY]: blockedCount
  });

  await chrome.action.setBadgeBackgroundColor({ color: '#b3261e' });
  await chrome.action.setBadgeText({ text: String(Math.min(blockedCount, 99)) });
}

async function blockTarget(tabId, sourceTabId, url) {
  finishClassification(tabId);

  try {
    await rememberBlocked(url, sourceTabId);
  } catch {
    // Storage or badge failures must never let the popup survive.
  }

  try {
    await chrome.tabs.remove(tabId);
  } catch {
    // It may already have been closed by Chrome or another blocker.
  }

  await refocusSource(sourceTabId);
}

async function classifyTarget(tabId, sourceTabId, url, blockTransient = false) {
  if (classifiedTabs.has(tabId) || classifyingTabs.has(tabId)) return;
  classifyingTabs.add(tabId);

  try {
    await stateReady;
    if (classifiedTabs.has(tabId)) return;

    if (!enabled) {
      finishClassification(tabId);
      return;
    }

    if (!Number.isInteger(sourceTabId)) {
      finishClassification(tabId);
      return;
    }

    try {
      const sourceTab = await chrome.tabs.get(sourceTabId);
      if (!TabSentryPolicy.isProtectablePageUrl(sourceTab.url)) {
        finishClassification(tabId);
        return;
      }
    } catch {
      finishClassification(tabId);
      return;
    }

    if (TabSentryPolicy.isTransientUrl(url) && !blockTransient) {
      pendingTargets.set(tabId, { sourceTabId, url });
      return;
    }

    const decision = ledger.consume(sourceTabId, url);
    if (decision.allowed) {
      finishClassification(tabId);
      return;
    }

    await blockTarget(tabId, sourceTabId, url);
  } finally {
    classifyingTabs.delete(tabId);
  }
}

function scheduleClassification(tabId, sourceTabId, url, delayMs, blockTransient = false) {
  if (classifiedTabs.has(tabId)) return;
  pendingTargets.set(tabId, { sourceTabId, url });
  setTimeout(() => {
    const pending = pendingTargets.get(tabId);
    if (!pending || classifiedTabs.has(tabId)) return;
    classifyTarget(tabId, pending.sourceTabId, pending.url, blockTransient);
  }, delayMs);
}

chrome.webNavigation.onCreatedNavigationTarget.addListener((details) => {
  scheduleClassification(
    details.tabId,
    details.sourceTabId,
    details.url,
    CLASSIFICATION_DELAY_MS
  );

  scheduleClassification(
    details.tabId,
    details.sourceTabId,
    details.url,
    FALLBACK_DELAY_MS,
    true
  );
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  const pending = pendingTargets.get(tabId);
  if (!pending || !changeInfo.url || TabSentryPolicy.isTransientUrl(changeInfo.url)) return;
  scheduleClassification(tabId, pending.sourceTabId, changeInfo.url, CLASSIFICATION_DELAY_MS);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  pendingTargets.delete(tabId);
  classifiedTabs.delete(tabId);
  classifyingTabs.delete(tabId);
  ledger.drop(tabId);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== 'string') return false;

  if (message.type === 'register-new-tab-intent') {
    const registered = ledger.register(sender.tab?.id, message.url);
    sendResponse({ registered });
    return false;
  }

  if (message.type === 'allow-next-tab') {
    const registered = ledger.allowNext(message.tabId);
    sendResponse({ registered });
    return false;
  }

  if (message.type === 'clear-blocked-count') {
    chrome.storage.session.set({ [BLOCKED_COUNT_KEY]: 0 });
    chrome.action.setBadgeText({ text: '' });
    sendResponse({ cleared: true });
    return false;
  }

  return false;
});
