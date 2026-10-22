const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const policySource = fs.readFileSync(path.join(root, 'shield-policy.js'), 'utf8');
const mainSource = fs.readFileSync(path.join(root, 'shield-main.js'), 'utf8');

function createPage() {
  const listeners = new Map();
  let nativeCalls = 0;
  class Element {
    constructor(tagName, opts = {}) {
      this.tagName = tagName;
      this.options = opts;
    }
    closest(selector) {
      if (selector === 'a[href]' && this.tagName === 'A') return this;
      if (selector === 'button,[role="button"],a' && (this.tagName === 'BUTTON' || this.tagName === 'A')) return this;
      return null;
    }
    getAttribute(name) { return this.options[name] || null; }
    hasAttribute(name) { return Object.hasOwn(this.options, name); }
    getBoundingClientRect() { return { width: 640, height: 360 }; }
  }
  class CustomEvent {
    constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
  }
  const window = {
    addEventListener(name, listener) {
      const entries = listeners.get(name) || [];
      entries.push(listener);
      listeners.set(name, entries);
    },
    dispatchEvent(event) {
      for (const listener of listeners.get(event.type) || []) listener(event);
    },
    open(url) { nativeCalls++; return { url }; }
  };

  const sandbox = {
    window, Element, CustomEvent, URL, Reflect, Date, navigator: { userActivation: { isActive: true } },
    location: { href: 'https://player.example/watch' },
    document: { elementsFromPoint() { return []; } }
  };
  vm.createContext(sandbox);
  vm.runInContext(policySource, sandbox);
  vm.runInContext(mainSource, sandbox);

  function configure(enabled, strict = false) {
    window.dispatchEvent(new CustomEvent('tab-sentry:shield-config', { detail: { enabled, strict } }));
  }
  function click(tagName, options = {}) {
    window.dispatchEvent({
      type: 'pointerdown', isTrusted: true,
      target: new Element(tagName, options),
      clientX: 300, clientY: 120, button: 0,
      ctrlKey: false, shiftKey: false, metaKey: false
    });
  }

  return { window, click, configure, sandbox, get nativeCalls() { return nativeCalls; } };
}

test('disabled shield delegates to the original page open API', () => {
  const p = createPage();
  p.click('VIDEO');
  assert.notEqual(p.window.open('https://ad.example'), null);
  assert.equal(p.nativeCalls, 1);
});

test('video-click popups are prevented before native open', () => {
  const p = createPage();
  p.configure(true);
  p.click('VIDEO');
  assert.equal(p.window.open('https://ad.example'), null);
  assert.equal(p.nativeCalls, 0);
});

test('normal sign-in clicks remain allowed in Balanced mode', () => {
  const p = createPage();
  p.configure(true);
  p.click('BUTTON', { 'aria-label': 'Sign in' });
  assert.notEqual(p.window.open('https://login.example'), null);
  assert.equal(p.nativeCalls, 1);
});

test('Strict mode blocks other script popups', () => {
  const p = createPage();
  p.configure(true, true);
  p.click('BUTTON', { 'aria-label': 'Other' });
  assert.equal(p.window.open('https://ad.example'), null);
  assert.equal(p.nativeCalls, 0);
});

test('Strict mode allows deliberate new-tab links', () => {
  const p = createPage();
  p.configure(true, true);
  p.click('A', { target: '_blank' });
  assert.notEqual(p.window.open('https://wanted.example'), null);
  assert.equal(p.nativeCalls, 1);
});

test('turning protection off restores original behavior without reloading', () => {
  const p = createPage();
  p.configure(true, true);
  assert.equal(p.window.open('https://ad.example'), null);
  p.configure(false);
  assert.notEqual(p.window.open('https://wanted.example'), null);
  assert.equal(p.nativeCalls, 1);
});
