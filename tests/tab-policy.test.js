const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeUrl,
  isTransientUrl,
  isProtectablePageUrl,
  createIntentLedger
} = require('../tab-policy.js');

test('normalizes exact intended destinations', () => {
  assert.equal(normalizeUrl('/watch?id=7', 'https://example.com/home'), 'https://example.com/watch?id=7');
  assert.equal(normalizeUrl('not a url'), null);
});

test('recognizes only empty initial targets as transient', () => {
  assert.equal(isTransientUrl(undefined), true);
  assert.equal(isTransientUrl('about:blank'), true);
  assert.equal(isTransientUrl('https://example.com/'), false);
});

test('protects web pages but not browser or extension pages', () => {
  assert.equal(isProtectablePageUrl('https://example.com/watch'), true);
  assert.equal(isProtectablePageUrl('http://example.com/watch'), true);
  assert.equal(isProtectablePageUrl('chrome://newtab/'), false);
  assert.equal(isProtectablePageUrl('chrome-extension://abc/popup.html'), false);
  assert.equal(isProtectablePageUrl('file:///tmp/page.html'), false);
});

test('allows one exact registered link and consumes it', () => {
  const ledger = createIntentLedger();
  assert.equal(ledger.register(10, 'https://example.com/wanted'), true);
  assert.deepEqual(ledger.consume(10, 'https://example.com/wanted'), {
    allowed: true,
    reason: 'matched-link'
  });
  assert.deepEqual(ledger.consume(10, 'https://example.com/wanted'), {
    allowed: false,
    reason: null
  });
});

test('does not let an ad consume an intended link', () => {
  const ledger = createIntentLedger();
  ledger.register(10, 'https://example.com/wanted');
  assert.deepEqual(ledger.consume(10, 'https://ads.example/popup'), {
    allowed: false,
    reason: null
  });
  assert.equal(ledger.consume(10, 'https://example.com/wanted').allowed, true);
});

test('registered link intents expire', () => {
  let currentTime = 1_000;
  const ledger = createIntentLedger({
    intentTtlMs: 100,
    now: () => currentTime
  });

  ledger.register(10, 'https://example.com/wanted');
  currentTime += 101;

  assert.equal(ledger.consume(10, 'https://example.com/wanted').allowed, false);
});
