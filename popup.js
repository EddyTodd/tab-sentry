const STATE_KEY = 'enabled';
const ALLOWED_SITES_KEY = 'allowedSites';
const BLOCKED_COUNT_KEY = 'blockedCount';
const RECENT_BLOCKED_KEY = 'recentBlocked';
const SHIELD_KEY = 'shieldEnabled';
const STRICT_KEY = 'strictSites';
const DIAGNOSTIC_EVENTS_KEY = 'diagnosticEvents';

const toggle = document.getElementById('toggle');
const shieldToggle = document.getElementById('shield-toggle');
const strictToggle = document.getElementById('strict-toggle');
const shieldDescription = document.getElementById('shield-description');
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
const diagnoseButton = document.getElementById('diagnose');
const reportPanel = document.getElementById('diagnostic-panel');
const reportField = document.getElementById('diagnostic-report');
const copyButton = document.getElementById('copy-diagnostic');

let enabled = false;
let currentHost = null;
let allowedSites = {};
let shieldEnabled = true;
let strictSites = {};
let currentTabId = null;
let diagnosticEvents = [];
let privateTab = false;

function setMessage(value) {
  message.textContent = value;
}

function setProtection(value) {
  enabled = value === true;
  toggle.setAttribute('aria-checked', String(enabled));
  statusPill.classList.toggle('off', !enabled);
  statusLabel.textContent = enabled ? 'Protected' : 'Off';
}

function setShieldControl(value) {
  shieldEnabled = value !== false;
  shieldToggle.setAttribute('aria-checked', String(shieldEnabled));
  shieldDescription.textContent = shieldEnabled
    ? 'Stop popup scripts and deceptive video overlays.'
    : 'Shield paused. Tab blocking remains available.';
}

function setSiteControl() {
  const allowed = !!currentHost && allowedSites[currentHost] === true;
  siteToggle.disabled = !currentHost;
  siteToggle.setAttribute('aria-checked', String(allowed));
  siteDescription.textContent = currentHost
    ? (allowed ? 'Popup blocking is bypassed here.' : 'Make an exception for sites you trust.')
    : 'Site controls are available on web pages.';
  strictToggle.disabled = !currentHost || allowed;
  strictToggle.setAttribute('aria-checked', String(
    !!currentHost && strictSites[currentHost] === true
  ));
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
      chrome.storage.local.get([STATE_KEY, ALLOWED_SITES_KEY, SHIELD_KEY, STRICT_KEY]),
      chrome.storage.session.get([BLOCKED_COUNT_KEY, RECENT_BLOCKED_KEY, DIAGNOSTIC_EVENTS_KEY]),
      chrome.tabs.query({ active: true, currentWindow: true })
    ]);

    allowedSites = settings[ALLOWED_SITES_KEY] || {};
    strictSites = settings[STRICT_KEY] || {};
    setProtection(settings[STATE_KEY]);
    setShieldControl(settings[SHIELD_KEY]);
    currentHost = getHost(activeTabs[0]?.url);
    currentTabId = activeTabs[0]?.id ?? null;
    privateTab = activeTabs[0]?.incognito === true;
    diagnosticEvents = TabSentryDiagnostics.trim(stats[DIAGNOSTIC_EVENTS_KEY], Date.now());
    diagnoseButton.disabled = !Number.isInteger(currentTabId) || privateTab;
    if (privateTab) setMessage('Flight recorder is disabled in private windows.');
    siteHostLabel.textContent = currentHost || 'Not available';
    setSiteControl();
    updateStatistics(stats);
  } catch {
    setMessage('Could not load extension settings. Reopen this popup.');
    toggle.disabled = true;
    siteToggle.disabled = true;
    strictToggle.disabled = true;
    shieldToggle.disabled = true;
    diagnoseButton.disabled = true;
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

shieldToggle.addEventListener('click', async () => {
  shieldToggle.disabled = true;
  try {
    const next = !shieldEnabled;
    await chrome.storage.local.set({ [SHIELD_KEY]: next });
    setShieldControl(next);
    setMessage(next ? 'Playback Shield enabled.' : 'Playback Shield paused.');
  } catch {
    setMessage('Could not change Playback Shield.');
  } finally {
    shieldToggle.disabled = false;
  }
});

strictToggle.addEventListener('click', async () => {
  if (!currentHost || allowedSites[currentHost] === true) return;
  strictToggle.disabled = true;
  try {
    const next = { ...strictSites };
    if (next[currentHost] === true) delete next[currentHost];
    else next[currentHost] = true;
    await chrome.storage.local.set({ [STRICT_KEY]: next });
    strictSites = next;
    setMessage('Site protection preference saved.');
  } catch {
    setMessage('Could not update site protection.');
  } finally {
    setSiteControl();
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

async function copyDiagnosticReport() {
  const text = reportField.value;
  if (!text) return;
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
    await navigator.clipboard.writeText(text);
    setMessage('Report copied. Paste it into ChatGPT for analysis.');
  } catch {
    reportField.focus();
    reportField.select();
    let copied = false;
    try { copied = document.execCommand('copy'); } catch {}
    setMessage(copied
      ? 'Report copied. Paste it into ChatGPT.'
      : 'Select and copy the report manually to share it.');
  }
}

diagnoseButton.addEventListener('click', () => {
  if (!Number.isInteger(currentTabId) || privateTab) return;
  const report = TabSentryDiagnostics.createReport(
    diagnosticEvents, currentTabId, Date.now(), currentHost
  );
  reportField.value = JSON.stringify(report, null, 2);
  reportPanel.hidden = false;
  if (!report.summary.recordedEvents) {
    setMessage('No recent signals. Try again right after the problem occurs.');
    return;
  }
  void copyDiagnosticReport();
});

copyButton.addEventListener('click', () => {
  void copyDiagnosticReport();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local') {
    if (STATE_KEY in changes) setProtection(changes[STATE_KEY].newValue);
    if (ALLOWED_SITES_KEY in changes) {
      allowedSites = changes[ALLOWED_SITES_KEY].newValue || {};
      setSiteControl();
    }
    if (SHIELD_KEY in changes) setShieldControl(changes[SHIELD_KEY].newValue);
    if (STRICT_KEY in changes) {
      strictSites = changes[STRICT_KEY].newValue || {};
      setSiteControl();
    }
  }
  if (area === 'session' && DIAGNOSTIC_EVENTS_KEY in changes) {
    diagnosticEvents = TabSentryDiagnostics.trim(
      changes[DIAGNOSTIC_EVENTS_KEY].newValue, Date.now()
    );
  }
  if (area === 'session' && (BLOCKED_COUNT_KEY in changes || RECENT_BLOCKED_KEY in changes)) {
    chrome.storage.session.get([BLOCKED_COUNT_KEY, RECENT_BLOCKED_KEY])
      .then(updateStatistics).catch(() => {});
  }
});

initialize();
