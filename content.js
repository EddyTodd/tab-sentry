const STATE_KEY = 'enabled';
const DUPLICATE_WINDOW_MS = 1_000;

let enabled = false;
let lastIntent = { url: null, sentAt: 0 };

chrome.storage.local.get(STATE_KEY).then((stored) => {
  enabled = !!stored[STATE_KEY];
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && STATE_KEY in changes) {
    enabled = !!changes[STATE_KEY].newValue;
  }
});

function findAnchor(event) {
  const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
  for (const node of path) {
    if (node instanceof HTMLAnchorElement) return node;
  }

  return event.target instanceof Element ? event.target.closest('a[href]') : null;
}

function isIntendedNewTabGesture(event, anchor) {
  if (!event.isTrusted || !anchor?.href) return false;
  if (event.type === 'contextmenu') return true;

  const target = (anchor.getAttribute('target') || '').toLowerCase();
  const modified = event.metaKey || event.ctrlKey || event.shiftKey;

  if (event.type === 'keydown') {
    return event.key === 'Enter' && (target === '_blank' || modified);
  }

  return event.button === 1 || target === '_blank' || modified;
}

function registerIntent(event) {
  if (!enabled) return;

  const anchor = findAnchor(event);
  if (!isIntendedNewTabGesture(event, anchor)) return;

  const now = Date.now();
  if (lastIntent.url === anchor.href && now - lastIntent.sentAt < DUPLICATE_WINDOW_MS) return;
  lastIntent = { url: anchor.href, sentAt: now };

  chrome.runtime.sendMessage({
    type: 'register-new-tab-intent',
    url: anchor.href
  });
}

window.addEventListener('pointerdown', registerIntent, true);
window.addEventListener('auxclick', registerIntent, true);
window.addEventListener('click', registerIntent, true);
window.addEventListener('contextmenu', registerIntent, true);
window.addEventListener('keydown', registerIntent, true);
