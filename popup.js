const STATE_KEY = 'enabled';
const ALLOWED_SITES_KEY = 'allowedSites';
const BLOCKED_COUNT_KEY = 'blockedCount';
const RECENT_BLOCKED_KEY = 'recentBlocked';

const toggle = document.getElementById('toggle');
const siteToggle = document.getElementById('site-toggle');
const siteHostLabel = document.getElementById('site-host');
const siteDescription = document.getElementById('site-description');
const statusPill = document.getElementById('protection-status');
const statusLabel = document.getElementById('protection-label');
const countLabel = document.getElementById('blocked-count');
const activityList = document.getElementById('activity-list');
const activityEmpty = document.getElementById('activity-empty');
const clearButton = document.getElementById('clear-history');
const message = document.getElementById('message');

let enabled = false;
let currentHost = null;
let allowedSites = {};

function setMessage(value) {
  message.textContent = value;
}

function setProtection(value) {
  enabled = value === true;
  toggle.setAttribute('aria-checked', String(enabled));
  statusPill.classList.toggle('off', !enabled);
  statusLabel.textContent = enabled ? 'Protected' : 'Off';
}

function setSiteControl() {
  const allowed = !!currentHost && allowedSites[currentHost] === true;
  siteToggle.disabled = !currentHost;
  siteToggle.setAttribute('aria-checked', String(allowed));
  siteDescription.textContent = currentHost
    ? (allowed ? 'Popup blocking is bypassed here.' : 'Make an exception for sites you trust.')
    : 'Site controls are available on web pages.';
}

function getHost(url) {
  try {
    const parsed = new URL(url);
    return /^https?:$/.test(parsed.protocol) ? parsed.hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

function renderActivity(items) {
  activityList.replaceChildren();
  const entries = Array.isArray(items) ? items.slice(0, 5) : [];
  activityEmpty.hidden = entries.length > 0;
  clearButton.disabled = entries.length === 0;

  for (const entry of entries) {
    const li = document.createElement('li');
    li.className = 'activity-item';

    const icon = document.createElement('span');
    icon.className = 'activity-icon';
    icon.textContent = '×';
    icon.setAttribute('aria-hidden', 'true');

    const details = document.createElement('div');
    details.className = 'activity-text';
    const target = document.createElement('div');
    target.className = 'activity-target';
    target.textContent = entry.target || 'Unknown destination';
    const origin = document.createElement('div');
    origin.className = 'activity-origin';
    origin.textContent = 'From ' + (entry.source || 'unknown source');
    details.append(target, origin);

    const time = document.createElement('time');
    time.className = 'activity-time';
    if (Number.isFinite(entry.time)) {
      time.dateTime = new Date(entry.time).toISOString();
      time.textContent = new Date(entry.time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    }
    li.append(icon, details, time);
    activityList.append(li);
  }
}

function updateStatistics(stored) {
  countLabel.textContent = String(Number(stored[BLOCKED_COUNT_KEY] || 0));
  renderActivity(stored[RECENT_BLOCKED_KEY]);
}

async function initialize() {
  try {
    const [settings, stats, activeTabs] = await Promise.all([
      chrome.storage.local.get([STATE_KEY, ALLOWED_SITES_KEY]),
      chrome.storage.session.get([BLOCKED_COUNT_KEY, RECENT_BLOCKED_KEY]),
      chrome.tabs.query({ active: true, currentWindow: true })
    ]);

    allowedSites = settings[ALLOWED_SITES_KEY] || {};
    setProtection(settings[STATE_KEY]);
    currentHost = getHost(activeTabs[0]?.url);
    siteHostLabel.textContent = currentHost || 'Not available';
    setSiteControl();
    updateStatistics(stats);
  } catch {
    setMessage('Could not load extension settings. Reopen this popup.');
    toggle.disabled = true;
    siteToggle.disabled = true;
  }
}

toggle.addEventListener('click', async () => {
  toggle.disabled = true;
  try {
    const next = !enabled;
    await chrome.storage.local.set({ [STATE_KEY]: next });
    setProtection(next);
    setMessage(next ? 'Popup protection enabled.' : 'Popup protection paused.');
  } catch {
    setMessage('Could not update protection. Try again.');
  } finally {
    toggle.disabled = false;
  }
});

siteToggle.addEventListener('click', async () => {
  if (!currentHost) return;
  siteToggle.disabled = true;
  try {
    const next = { ...allowedSites };
    if (next[currentHost] === true) delete next[currentHost];
    else next[currentHost] = true;
    await chrome.storage.local.set({ [ALLOWED_SITES_KEY]: next });
    allowedSites = next;
    setMessage('Site exception updated.');
  } catch {
    setMessage('Could not save site exception.');
  } finally {
    setSiteControl();
  }
});

clearButton.addEventListener('click', async () => {
  clearButton.disabled = true;
  try {
    const result = await chrome.runtime.sendMessage({ type: 'reset-stats' });
    if (!result?.reset) throw new Error('Stats reset failed');
    updateStatistics({ [BLOCKED_COUNT_KEY]: 0, [RECENT_BLOCKED_KEY]: [] });
    setMessage('Session activity cleared.');
  } catch {
    setMessage('Could not clear activity.');
  } finally {
    clearButton.disabled = false;
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local') {
    if (STATE_KEY in changes) setProtection(changes[STATE_KEY].newValue);
    if (ALLOWED_SITES_KEY in changes) {
      allowedSites = changes[ALLOWED_SITES_KEY].newValue || {};
      setSiteControl();
    }
  }
  if (area === 'session' && (BLOCKED_COUNT_KEY in changes || RECENT_BLOCKED_KEY in changes)) {
    chrome.storage.session.get([BLOCKED_COUNT_KEY, RECENT_BLOCKED_KEY])
      .then(updateStatistics).catch(() => {});
  }
});

initialize();
