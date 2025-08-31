// Global ON/OFF state (persisted in storage)
let enabled = false;

// Track last active tab per window so we can refocus quickly
const lastActiveByWindow = new Map();

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.set({ nnthk_enabled: false }); // OFF by default
});

chrome.storage.sync.get("nnthk_enabled", ({ nnthk_enabled }) => {
  enabled = !!nnthk_enabled;
});

// Keep last active tab ID for each window
chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
  lastActiveByWindow.set(windowId, tabId);
});

// React to toggle changes from popup/content
chrome.storage.onChanged.addListener((changes) => {
  if (changes.nnthk_enabled) {
    enabled = !!changes.nnthk_enabled.newValue;
  }
});

// Hard-kill: Close ANY newly created tab immediately when enabled.
// Then force-focus the previous active tab ASAP.
chrome.tabs.onCreated.addListener(async (tab) => {
  if (!enabled) return;

  // Edge cases: devtools or special tabs might not have normal IDs/URLs yet.
  const id = tab.id;
  const winId = tab.windowId;

  try {
    // Close the tab if it exists
    if (typeof id === "number") {
      await chrome.tabs.remove(id);
    }
  } catch (_) {
    // Already gone or not closable; ignore
  }

  // Force focus back to the last known active tab (if still there)
  if (typeof winId === "number") {
    const last = lastActiveByWindow.get(winId);
    if (typeof last === "number") {
      try {
        await chrome.tabs.update(last, { active: true });
      } catch (_) {}
    }
  }
});
