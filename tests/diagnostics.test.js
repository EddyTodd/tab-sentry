const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../diagnostics.js');

const NOW = 100_000;

test('captures only allowlisted event fields', () => {
  const event = D.add([], {
    type: 'video-click',
    tabId: 12,
    site: 'Example.COM',
    context: 'covering-element',
    selector: '#login',
    content: 'private text',
    url: 'https://example.com/watch?token=secret'
  }, NOW)[0];
  assert.deepEqual(event, {
    time: NOW, tabId: 12, type: 'video-click',
    site: 'example.com', frame: 0, context: 'covering-element'
  });
  assert.equal(JSON.stringify(event).includes('secret'), false);
});

test('drops unknown events and arbitrary contexts', () => {
  assert.equal(D.add([], { type: 'password-entry', tabId: 1 }, NOW).length, 0);
  assert.equal(D.add([], { type: 'video-click', tabId: -1 }, NOW).length, 0);
  const stored = D.add([], { type: 'video-click', tabId: 1, context: 'email-input' }, NOW);
  assert.equal(stored[0].context, undefined);
});

test('keeps events only for the previous sixty seconds', () => {
  let data = D.add([], { type: 'video-click', tabId: 1 }, NOW - 60_001);
  data = D.add(data, { type: 'popup-blocked', tabId: 1 }, NOW);
  assert.equal(data.length, 1);
  assert.equal(D.trim(data, NOW + 60_001).length, 0);
});

test('bounds the rolling buffer at 120 events', () => {
  let data = [];
  for (let index = 0; index < 160; index++) {
    data = D.add(data, { type: 'video-click', tabId: 1 }, NOW + index);
  }
  assert.equal(data.length, D.MAX_EVENTS);
});

test('report is limited to one active tab and omits internal tab IDs', () => {
  let data = [];
  data = D.add(data, { type: 'video-click', tabId: 1, site: 'example.com' }, NOW);
  data = D.add(data, { type: 'popup-blocked', tabId: 2, target: 'unrelated.example' }, NOW + 50);
  const report = D.createReport(data, 1, NOW + 100, 'example.com');
  assert.equal(report.timeline.length, 1);
  assert.equal(report.scope, 'active-tab-only');
  assert.equal(JSON.stringify(report).includes('unrelated.example'), false);
  assert.equal(Object.hasOwn(report.timeline[0], 'tabId'), false);
});

test('reports suspected play-click hijack without falsely claiming certainty', () => {
  let data = [];
  data = D.add(data, { type: 'video-click', tabId: 1, context: 'covering-element' }, NOW);
  data = D.add(data, { type: 'popup-attempt', tabId: 1, target: 'ad.example' }, NOW + 100);
  data = D.add(data, { type: 'popup-blocked', tabId: 1, target: 'ad.example' }, NOW + 300);
  const report = D.createReport(data, 1, NOW + 1_000, 'video.example');
  assert.equal(report.summary.possibleClickHijacks, 1);
  assert.equal(report.summary.blockedPopups, 1);
  data = D.add(data, { type: 'video-playing', tabId: 1 }, NOW + 400);
  const later = D.createReport(data, 1, NOW + 1_100, 'video.example');
  assert.equal(later.summary.possibleClickHijacks, 0);
});

test('site and target values cannot carry arbitrary strings into reports', () => {
  let data = [];
  data = D.add(data, {
    type: 'popup-attempt', tabId: 1,
    site: 'example.com/watch?secret=1',
    target: 'ads.example/sneaky',
    reason: 'unknown-reason'
  }, NOW);
  const report = D.createReport(data, 1, NOW);
  assert.equal(JSON.stringify(report).includes('secret'), false);
  assert.equal(JSON.stringify(report).includes('sneaky'), false);
  assert.equal(report.timeline[0].reason, undefined);
});
