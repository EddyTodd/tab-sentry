const STATE_KEY = 'enabled';

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(STATE_KEY, (s) => {
    if (typeof s[STATE_KEY] !== 'boolean') {
      chrome.storage.local.set({ [STATE_KEY]: false });
    }
  });
});

function isEnabled() {
  return new Promise((resolve) => {
    chrome.storage.local.get(STATE_KEY, (s) => resolve(!!s[STATE_KEY]));
  });
}

const lastActiveTabByWindow = new Map();

chrome.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
  lastActiveTabByWindow.set(windowId, tabId);
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  try {
    const [tab] = await chrome.tabs.query({ active: true, windowId });
    if (tab && tab.id) lastActiveTabByWindow.set(windowId, tab.id);
  } catch {}
});

async function nukeTabAndRefocus(createdTabId, sourceTabId, sourceWindowId) {
  try { await chrome.tabs.remove(createdTabId); } catch {}
  if (sourceTabId) {
    try { await chrome.tabs.update(sourceTabId, { active: true }); return; } catch {}
  }
  const fallbackTabId = lastActiveTabByWindow.get(sourceWindowId);
  if (fallbackTabId) {
    try { await chrome.tabs.update(fallbackTabId, { active: true }); } catch {}
  }
}

chrome.webNavigation.onCreatedNavigationTarget.addListener(async (details) => {
  if (!(await isEnabled())) return;
  nukeTabAndRefocus(details.tabId, details.sourceTabId, details.windowId);
});

chrome.tabs.onCreated.addListener(async (tab) => {
  if (!(await isEnabled())) return;

  const sourceTabId = tab.openerTabId || null;
  const windowId = tab.windowId || null;

  nukeTabAndRefocus(tab.id, sourceTabId, windowId);
});

chrome.windows.onCreated.addListener(async (win) => {
  if (!(await isEnabled())) return;
  try {
    await chrome.windows.remove(win.id);
    const windows = await chrome.windows.getAll({ populate: true });
    if (windows.length) {
      const lastWin = windows.find(w => w.focused) || windows[0];
      if (lastWin && lastWin.id != null) {
        const lastTabId = lastActiveTabByWindow.get(lastWin.id);
        if (lastTabId) await chrome.tabs.update(lastTabId, { active: true });
      }
    }
  } catch {}
});

chrome.runtime.onMessage.addListener((msg, _sender, _sendResponse) => {
  if (msg && msg.type === 'broadcast-enabled-change') {
    chrome.tabs.query({}, (tabs) => {
      for (const t of tabs) {
        try {
          chrome.tabs.sendMessage(t.id, { type: 'enabled-changed', enabled: msg.enabled });
        } catch {}
      }
    });
  }
});
