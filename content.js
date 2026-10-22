const STATE_KEY = 'enabled';
const DUPLICATE_WINDOW_MS = 150;

let enabled = false;
let lastIntent = { url: null, sentAt: 0 };

chrome.storage.local.get(STATE_KEY).then((stored) => {
  enabled = !!stored[STATE_KEY];
}).catch(() => {});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && STATE_KEY in changes) {
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
  try {
    if (!/^https?:$/.test(new URL(anchor.href).protocol)) return false;
  } catch {
    return false;
  }

  if (event.type === 'contextmenu') return true;
  const target = (anchor.getAttribute('target') || '').toLowerCase();
  const modified = event.metaKey || event.ctrlKey || event.shiftKey;

  if (event.type === 'keydown') {
    return event.key === 'Enter' && (target === '_blank' || modified);
  }
  if (event.type === 'auxclick') return event.button === 1;
  return event.button === 0 && (target === '_blank' || modified);
}

function registerIntent(event) {
  if (!enabled) return;
  const anchor = findAnchor(event);
  if (!isIntendedNewTabGesture(event, anchor)) return;

  const now = Date.now();
  if (lastIntent.url === anchor.href && now - lastIntent.sentAt < DUPLICATE_WINDOW_MS) {
    return;
  }
  lastIntent = { url: anchor.href, sentAt: now };

  chrome.runtime.sendMessage({
    type: 'register-new-tab-intent',
    url: anchor.href,
    contextMenu: event.type === 'contextmenu'
  }).catch(() => {});
}

window.addEventListener('pointerdown', registerIntent, true);
window.addEventListener('auxclick', registerIntent, true);
window.addEventListener('click', registerIntent, true);
window.addEventListener('contextmenu', registerIntent, true);
window.addEventListener('keydown', registerIntent, true);


// Lightweight flight recorder: observe only media-related interactions,
// never page text, element selectors, coordinates, or video content.
let lastMediaEvent = 0;

function sendDiagnostic(type, context) {
  if (!enabled || chrome.extension?.inIncognitoContext) return;
  chrome.runtime.sendMessage({
    type: 'diagnostic-event',
    event: { type, context }
  }).catch(() => {});
}

function withinRect(rect, x, y) {
  return rect.width >= 160 && rect.height >= 90 &&
    x >= rect.left && x <= rect.right &&
    y >= rect.top && y <= rect.bottom;
}

function classifyMediaClick(event) {
  if (!event.isTrusted || event.button !== 0 ||
      !(event.target instanceof Element)) return null;

  const target = event.target;
  if (target.closest('input,textarea,select,[contenteditable]')) return null;
  if (target instanceof HTMLVideoElement || target.closest('video')) return 'video';

  const control = target.closest('button,[role="button"],a');
  if (control) {
    const label = (control.getAttribute('aria-label') || '') + ' ' +
      (control.getAttribute('title') || '');
    const classes = typeof control.className === 'string' ? control.className : '';
    if (/(^|[^a-z])(play|watch|start-video)([^a-z]|$)/i.test(label + ' ' + classes)) {
      return 'play-control';
    }
  }

  // Identify potential overlay clicks by geometry without collecting DOM content.
  // An iframe may itself contain a legitimate video; this is only a diagnostic hint.
  const candidates = document.querySelectorAll('video,iframe');
  for (let i = 0; i < Math.min(candidates.length, 12); i++) {
    const element = candidates[i];
    if (!withinRect(element.getBoundingClientRect(), event.clientX, event.clientY)) continue;
    return element.tagName === 'IFRAME' && element === target
      ? 'embedded-frame'
      : 'covering-element';
  }
  return null;
}

window.addEventListener('pointerdown', (event) => {
  if (!enabled || Date.now() - lastMediaEvent < 250) return;
  const context = classifyMediaClick(event);
  if (!context) return;
  lastMediaEvent = Date.now();
  sendDiagnostic('video-click', context);
}, true);

document.addEventListener('playing', (event) => {
  if (enabled && event.target instanceof HTMLVideoElement) {
    sendDiagnostic('video-playing');
  }
}, true);

document.addEventListener('error', (event) => {
  if (enabled && event.target instanceof HTMLVideoElement) {
    sendDiagnostic('video-error');
  }
}, true);
