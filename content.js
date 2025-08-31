const STATE_KEY = 'enabled';
let enabled = false;

chrome.storage.local.get(STATE_KEY, (s) => {
  enabled = !!s[STATE_KEY];
  if (enabled) injectKillSwitch();
});

chrome.storage.onChanged.addListener((changes) => {
  if (STATE_KEY in changes) {
    enabled = !!changes[STATE_KEY].newValue;
    if (enabled) injectKillSwitch();
  }
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'enabled-changed') {
    enabled = !!msg.enabled;
    if (enabled) injectKillSwitch();
  }
});

function injectKillSwitch() {
  chrome.scripting.executeScript({
    target: { allFrames: true, tabId: getCurrentTabId() },
    files: ['injected.js']
  });
}

// Helper: get current tabId for executeScript
function getCurrentTabId() {
  // Content scripts don’t have tabId directly.
  // The background script can forward tabId to us, or
  // you can send a message to background to run executeScript for you.
  return chrome.devtools?.inspectedWindow?.tabId; // or handle via background
}
