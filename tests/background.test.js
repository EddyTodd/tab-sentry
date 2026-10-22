const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const policySource = fs.readFileSync(path.join(root, 'tab-policy.js'), 'utf8');
const backgroundSource = fs.readFileSync(path.join(root, 'background.js'), 'utf8');

function event() {
  const listeners = [];
  return {
    addListener(callback) { listeners.push(callback); },
    fire(...args) { for (const callback of listeners) callback(...args); }
  };
}

function storageArea(name, initial, changed) {
  const data = { ...initial };
  return {
    data,
    async get(keys) {
      const result = {};
      for (const key of typeof keys === 'string' ? [keys] : keys) result[key] = data[key];
      return result;
    },
    async set(values) {
      const changes = {};
      for (const [key, value] of Object.entries(values)) {
        changes[key] = { oldValue: data[key], newValue: value };
        data[key] = value;
      }
      changed.fire(changes, name);
    }
  };
}

function harness({ enabled = true, allowedSites = {} } = {}) {
  const onChanged = event();
  const onCreatedNavigationTarget = event();
  const onUpdated = event();
  const onRemoved = event();
  const onMessage = event();
  const tabData = new Map([
    [1, { id: 1, url: 'https://source.example/watch', windowId: 1, active: false }]
  ]);
  const removed = [];
  const local = storageArea('local', { enabled, allowedSites }, onChanged);
  const session = storageArea('session', {}, onChanged);

  const chrome = {
    storage: { local, session, onChanged },
    runtime: { onInstalled: event(), onMessage },
    webNavigation: { onCreatedNavigationTarget },
    tabs: {
      onUpdated, onRemoved,
      async get(id) {
        if (!tabData.has(id)) throw new Error('Tab not found: ' + id);
        return { ...tabData.get(id) };
      },
      async remove(id) {
        if (!tabData.has(id)) throw new Error('Tab already removed: ' + id);
        removed.push(id);
        tabData.delete(id);
        onRemoved.fire(id);
      },
      async update(id, change) {
        const tab = tabData.get(id);
        if (!tab) throw new Error('Tab not found');
        Object.assign(tab, change);
        return { ...tab };
      }
    },
    windows: {
      async getLastFocused() { return { id: 1, focused: false }; },
      async update(id) { return { id }; }
    },
    action: {
      async setBadgeText() {},
      async setBadgeBackgroundColor() {}
    }
  };

  const context = vm.createContext({ chrome, URL, Date, Promise, setTimeout, clearTimeout });
  context.importScripts = () => vm.runInContext(policySource, context);
  vm.runInContext(backgroundSource, context);

  function created(tabId, url, sourceFrameId = 0, sourceTabId = 1) {
    tabData.set(tabId, { id: tabId, url, windowId: 1, active: false });
    onCreatedNavigationTarget.fire({ tabId, url, sourceFrameId, sourceTabId });
  }

  function register(url, frameId = 0) {
    let response;
    onMessage.fire({ type: 'register-new-tab-intent', url },
      { tab: { id: 1 }, frameId }, (value) => { response = value; });
    return response;
  }

  async function until(predicate) {
    for (let i = 0; i < 100; i++) {
      if (predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.fail('Background task did not settle');
  }

  return { chrome, created, register, tabData, removed, until, onUpdated, session };
}

test('blocks an unmatched page-created tab and records hostname-only activity', async () => {
  const h = harness();
  h.created(2, 'https://ads.example/popup?private=secret');
  await h.until(() => h.removed.includes(2) && h.session.data.blockedCount === 1);
  assert.equal(h.session.data.recentBlocked[0].source, 'source.example');
  assert.equal(h.session.data.recentBlocked[0].target, 'ads.example');
  assert.equal(JSON.stringify(h.session.data.recentBlocked).includes('secret'), false);
});

test('allows exactly one user-intended tab from the originating frame', async () => {
  const h = harness();
  assert.equal(h.register('https://wanted.example/path', 3).registered, true);
  h.created(2, 'https://wanted.example/path', 3);
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(h.tabData.has(2), true);

  h.created(3, 'https://wanted.example/path', 3);
  await h.until(() => h.removed.includes(3));
  assert.equal(h.tabData.has(2), true);
});

test('accepts a user intent arriving shortly after Chrome creates a target', async () => {
  const h = harness();
  h.created(2, 'https://wanted.example/path', 0);
  await new Promise((resolve) => setTimeout(resolve, 20));
  h.register('https://wanted.example/path', 0);
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(h.tabData.has(2), true);
  assert.deepEqual(h.removed, []);
});

test('does not let an iframe intent authorize another frame', async () => {
  const h = harness();
  h.register('https://wanted.example/path', 3);
  h.created(2, 'https://wanted.example/path', 4);
  await h.until(() => h.removed.includes(2));
});

test('honors a per-site allow exception', async () => {
  const h = harness({ allowedSites: { 'source.example': true } });
  h.created(2, 'https://ads.example/popup');
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(h.tabData.has(2), true);
  assert.equal(h.session.data.blockedCount, undefined);
});

test('never blocks while protection is disabled', async () => {
  const h = harness({ enabled: false });
  h.created(2, 'https://ads.example/popup');
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(h.tabData.has(2), true);
});

test('counts simultaneous blocked tabs without losing increments', async () => {
  const h = harness();
  for (let id = 2; id <= 7; id++) h.created(id, 'https://ads.example/' + id);
  await h.until(() => h.removed.length === 6 && h.session.data.blockedCount === 6);
  assert.equal(h.session.data.recentBlocked.length, 6);
});

test('uses updated destination instead of stale about:blank', async () => {
  const h = harness();
  h.created(2, 'about:blank', 5);
  h.tabData.get(2).url = 'https://redirected.example/offer';
  h.onUpdated.fire(2, { url: 'https://redirected.example/offer' });
  await h.until(() => h.removed.includes(2) && h.session.data.blockedCount === 1);
  assert.equal(h.session.data.recentBlocked[0].target, 'redirected.example');
});

test('does not classify a navigation with no valid source tab', async () => {
  const h = harness();
  h.created(2, 'https://ads.example/popup', 0, -1);
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(h.tabData.has(2), true);
});
