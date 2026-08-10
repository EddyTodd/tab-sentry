const STATE_KEY = 'enabled';
const LAST_BLOCKED_KEY = 'lastBlocked';
const BLOCKED_COUNT_KEY = 'blockedCount';

const toggle = document.getElementById('toggle');
const allowNext = document.getElementById('allowNext');
const reopenLast = document.getElementById('reopenLast');
const status = document.getElementById('status');

let enabled = false;
let lastBlocked = null;

function setEnabledUI(value) {
  enabled = !!value;
  toggle.classList.toggle('on', enabled);
  toggle.setAttribute('aria-checked', String(enabled));
  allowNext.disabled = !enabled;
}

function setStatus(message) {
  status.textContent = message;
}

async function refreshSessionState() {
  const session = await chrome.storage.session.get([LAST_BLOCKED_KEY, BLOCKED_COUNT_KEY]);
  lastBlocked = session[LAST_BLOCKED_KEY] || null;
  const blockedCount = Number(session[BLOCKED_COUNT_KEY] || 0);

  reopenLast.disabled = !lastBlocked?.url;
  setStatus(blockedCount ? `Blocked ${blockedCount} unwanted tab${blockedCount === 1 ? '' : 's'} this session.` : '');
}

chrome.storage.local.get(STATE_KEY).then((stored) => setEnabledUI(stored[STATE_KEY]));
refreshSessionState();

toggle.addEventListener('click', async () => {
  const next = !enabled;
  await chrome.storage.local.set({ [STATE_KEY]: next });
  setEnabledUI(next);
  setStatus(next ? 'Protection enabled.' : 'Protection disabled.');
});

allowNext.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!Number.isInteger(tab?.id)) {
    setStatus('No active page is available.');
    return;
  }

  const response = await chrome.runtime.sendMessage({ type: 'allow-next-tab', tabId: tab.id });
  setStatus(response?.registered ? 'The next page-created tab is allowed for 30 seconds.' : 'Could not register the exception.');
});

reopenLast.addEventListener('click', async () => {
  if (!lastBlocked?.url) return;

  await chrome.tabs.create({ url: lastBlocked.url });
  await chrome.storage.session.remove(LAST_BLOCKED_KEY);
  lastBlocked = null;
  reopenLast.disabled = true;
  setStatus('Reopened the last blocked tab.');
});

chrome.runtime.sendMessage({ type: 'clear-blocked-count' });
