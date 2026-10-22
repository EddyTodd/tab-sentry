const test = require('node:test');
const assert = require('node:assert/strict');
const policy = require('../shield-policy.js');

test('disabled shield never blocks JavaScript windows', () => {
  assert.equal(policy.shouldBlockOpen({
    enabled: false, strict: true, gesture: 'video', activated: false
  }), false);
});

test('site exceptions override strict and media blocking', () => {
  assert.equal(policy.shouldBlockOpen({
    enabled: true, siteAllowed: true, strict: true, gesture: 'video', activated: false
  }), false);
});

test('explicit new-tab interactions are respected in strict mode', () => {
  assert.equal(policy.shouldBlockOpen({
    enabled: true, strict: true, gesture: 'explicit', activated: true
  }), false);
});

test('blocks script popups triggered by video controls', () => {
  assert.equal(policy.shouldBlockOpen({
    enabled: true, strict: false, gesture: 'video', activated: true
  }), true);
});

test('blocks background script popups without browser activation', () => {
  assert.equal(policy.shouldBlockOpen({
    enabled: true, strict: false, gesture: 'other', activated: false
  }), true);
});

test('leaves ambiguous ordinary user-triggered workflows to browser fallback', () => {
  assert.equal(policy.shouldBlockOpen({
    enabled: true, strict: false, gesture: 'other', activated: true
  }), false);
  assert.equal(policy.shouldBlockOpen({
    enabled: true, strict: false, gesture: 'other', activated: undefined
  }), false);
});

test('strong mode blocks other scripts but keeps explicit links allowed', () => {
  assert.equal(policy.shouldBlockOpen({
    enabled: true, strict: true, gesture: 'other', activated: true
  }), true);
});

test('recognizes video surfaces and Play controls', () => {
  assert.equal(policy.isVideoGesture({ tag: 'VIDEO' }), true);
  assert.equal(policy.isVideoGesture({ tag: 'BUTTON', label: 'Play video' }), true);
  assert.equal(policy.isVideoGesture({ tag: 'DIV', playerArea: true }), true);
  assert.equal(policy.isVideoGesture({ tag: 'BUTTON', label: 'Sign in' }), false);
});

test('neutralizes large deceptive external links covering a player', () => {
  assert.equal(policy.isOverlay({
    overlayTag: 'A', overlayWidth: 700, overlayHeight: 360,
    playerWidth: 720, playerHeight: 380,
    isAncestor: false, isExternalLink: true
  }), true);
});

test('supports empty transparent overlays covering a video', () => {
  assert.equal(policy.isOverlay({
    overlayTag: 'DIV', overlayWidth: 600, overlayHeight: 300,
    playerWidth: 600, playerHeight: 300,
    isAncestor: false, isTransparent: true, emptyElement: true
  }), true);
});

test('does not neutralize small legitimate controls or video containers', () => {
  for (const values of [
    { overlayTag: 'BUTTON', overlayWidth: 600, overlayHeight: 300, isExternalLink: true },
    { overlayTag: 'A', overlayWidth: 40, overlayHeight: 40, isExternalLink: true },
    { overlayTag: 'DIV', overlayWidth: 600, overlayHeight: 300, isAncestor: true, isExternalLink: true },
    { overlayTag: 'DIV', overlayWidth: 600, overlayHeight: 300, isTransparent: true, emptyElement: false }
  ]) {
    assert.equal(policy.isOverlay({
      playerWidth: 600, playerHeight: 300, isAncestor: false, ...values
    }), false);
  }
});

test('rejects player surfaces smaller than normal embedded video', () => {
  assert.equal(policy.isOverlay({
    overlayTag: 'A', overlayWidth: 90, overlayHeight: 50,
    playerWidth: 90, playerHeight: 50, isExternalLink: true
  }), false);
});
