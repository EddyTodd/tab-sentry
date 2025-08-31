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

function getCurrentTabId() {
  return chrome.devtools?.inspectedWindow?.tabId;
}
