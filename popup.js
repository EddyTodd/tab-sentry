const STATE_KEY = 'enabled';
const BLOCKED_COUNT_KEY = 'blockedCount';

const toggle = document.getElementById('toggle');
const status = document.getElementById('status');

let enabled = false;

function setEnabledUI(value) {
  enabled = !!value;
  toggle.classList.toggle('on', enabled);
  toggle.setAttribute('aria-checked', String(enabled));
}

function setStatus(message) {
  status.textContent = message;
}

async function initialize() {
  const [stored, session] = await Promise.all([
    chrome.storage.local.get(STATE_KEY),
    chrome.storage.session.get(BLOCKED_COUNT_KEY)
  ]);

  setEnabledUI(stored[STATE_KEY]);

  const blockedCount = Number(session[BLOCKED_COUNT_KEY] || 0);
  if (blockedCount) {
    setStatus(`Blocked ${blockedCount} unwanted tab${blockedCount === 1 ? '' : 's'} this session.`);
  }

  await chrome.runtime.sendMessage({ type: 'clear-blocked-count' });
}

toggle.addEventListener('click', async () => {
  const next = !enabled;
  await chrome.storage.local.set({ [STATE_KEY]: next });
  setEnabledUI(next);
  setStatus(next ? 'Protection enabled.' : 'Protection disabled.');
});

initialize();
