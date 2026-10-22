const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeUrl,
  isTransientUrl,
  isProtectablePageUrl,
  siteHost,
  isSiteAllowed,
  createIntentLedger
} = require('../tab-policy.js');

test('normalizes absolute and relative URLs', () => {
  assert.equal(normalizeUrl('/watch?id=7', 'https://example.com/home'), 'https://example.com/watch?id=7');
  assert.equal(normalizeUrl('not a url'), null);
  assert.equal(normalizeUrl(''), null);
});

test('recognizes transient initial destinations', () => {
  assert.equal(isTransientUrl(undefined), true);
  assert.equal(isTransientUrl('about:blank'), true);
  assert.equal(isTransientUrl('https://example.com/'), false);
});

test('limits protection to HTTP(S) source tabs', () => {
  assert.equal(isProtectablePageUrl('https://example.com/'), true);
  assert.equal(isProtectablePageUrl('http://example.com/'), true);
  assert.equal(isProtectablePageUrl('chrome://newtab/'), false);
  assert.equal(isProtectablePageUrl('file:///tmp/file'), false);
  assert.equal(isProtectablePageUrl('javascript:alert(1)'), false);
});

test('extracts exact hostnames for site exceptions', () => {
  assert.equal(siteHost('https://Sub.Example.com/path'), 'sub.example.com');
  assert.equal(siteHost('chrome://settings'), null);
  assert.equal(siteHost('bad url'), null);
  assert.equal(isSiteAllowed('https://example.com/path', { 'example.com': true }), true);
  assert.equal(isSiteAllowed('https://sub.example.com/path', { 'example.com': true }), false);
  assert.equal(isSiteAllowed('https://example.com/path', { 'example.com': false }), false);
  assert.equal(isSiteAllowed('https://example.com', { toString: true }), false);
});

test('allows an exact registered URL only once', () => {
  const ledger = createIntentLedger();
  assert.equal(ledger.register(10, 'https://example.com/wanted'), true);
  assert.deepEqual(ledger.consume(10, 'https://example.com/wanted'), { allowed: true, reason: 'matched-link' });
  assert.equal(ledger.consume(10, 'https://example.com/wanted').allowed, false);
});

test('does not let unmatched ads consume an intentional link', () => {
  const ledger = createIntentLedger();
  ledger.register(10, 'https://example.com/wanted');
  assert.equal(ledger.consume(10, 'https://ads.example/popup').allowed, false);
  assert.equal(ledger.consume(10, 'https://example.com/wanted').allowed, true);
});

test('does not share link intents between source tabs', () => {
  const ledger = createIntentLedger();
  ledger.register(10, 'https://example.com/wanted');
  assert.equal(ledger.consume(11, 'https://example.com/wanted').allowed, false);
  assert.equal(ledger.consume(10, 'https://example.com/wanted').allowed, true);
});

test('does not share link intents between frames in the same tab', () => {
  const ledger = createIntentLedger();
  ledger.register(10, 'https://example.com/wanted', 4);
  assert.equal(ledger.consume(10, 'https://example.com/wanted', 0).allowed, false);
  assert.equal(ledger.consume(10, 'https://example.com/wanted', 5).allowed, false);
  assert.equal(ledger.consume(10, 'https://example.com/wanted', 4).allowed, true);
});

test('expires link intents and caps custom TTL', () => {
  let currentTime = 1_000;
  const ledger = createIntentLedger({ intentTtlMs: 100, now: () => currentTime });
  ledger.register(10, 'https://example.com/wanted');
  currentTime += 101;
  assert.equal(ledger.consume(10, 'https://example.com/wanted').allowed, false);

  ledger.register(10, 'https://example.com/menu', 0, 60_000);
  currentTime += 12_001;
  assert.equal(ledger.consume(10, 'https://example.com/menu').allowed, false);
});

test('rejects invalid intents and unsafe URL schemes', () => {
  const ledger = createIntentLedger();
  assert.equal(ledger.register(null, 'https://example.com'), false);
  assert.equal(ledger.register(1, 'javascript:alert(1)'), false);
  assert.equal(ledger.register(1, 'https://example.com', 0, -1), false);
  assert.equal(ledger.register(1, 'https://example.com', 0, Number.NaN), false);
});

test('drops all intent frames on tab removal', () => {
  const ledger = createIntentLedger();
  ledger.register(10, 'https://example.com/a', 0);
  ledger.register(10, 'https://example.com/b', 3);
  ledger.register(11, 'https://example.com/c', 0);
  ledger.drop(10);
  assert.equal(ledger.consume(10, 'https://example.com/a').allowed, false);
  assert.equal(ledger.consume(10, 'https://example.com/b', 3).allowed, false);
  assert.equal(ledger.consume(11, 'https://example.com/c').allowed, true);
});

test('retains at most five latest active intents per frame', () => {
  const ledger = createIntentLedger();
  for (let index = 0; index < 6; index++) {
    ledger.register(10, 'https://example.com/' + index);
  }
  assert.equal(ledger.consume(10, 'https://example.com/0').allowed, false);
  for (let index = 1; index < 6; index++) {
    assert.equal(ledger.consume(10, 'https://example.com/' + index).allowed, true);
  }
});
