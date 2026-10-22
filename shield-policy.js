(function exposeShieldPolicy(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TabSentryShieldPolicy = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function buildShieldPolicy() {
  const GESTURE_MS = 1_400;

  function shouldBlockOpen({ enabled, siteAllowed, strict, gesture, activated }) {
    if (!enabled || siteAllowed) return false;
    if (gesture === 'explicit') return false;
    if (strict) return true;
    if (gesture === 'video') return true;
    // Background window.open calls have no user activation. Leave unknown
    // activation states to the existing navigation-target fallback.
    return activated === false;
  }

  function isVideoGesture({ tag, label = '', playerArea = false }) {
    if (tag === 'VIDEO') return true;
    if (/(^|[^a-z])(play|watch|start-video)([^a-z]|$)/i.test(label)) return true;
    return playerArea === true;
  }

  function isOverlay({
    overlayTag, overlayWidth, overlayHeight, playerWidth, playerHeight,
    isAncestor, isExternalLink, isTransparent, emptyElement
  }) {
    if (isAncestor || ['VIDEO', 'IFRAME', 'INPUT', 'BUTTON'].includes(overlayTag)) return false;
    if (![overlayWidth, overlayHeight, playerWidth, playerHeight].every(
      n => Number.isFinite(n) && n > 0
    )) return false;
    if (playerWidth < 160 || playerHeight < 90) return false;
    // Don't remove ordinary buttons and small control layers.
    if (overlayWidth < playerWidth * 0.7 || overlayHeight < playerHeight * 0.7) return false;
    if (isExternalLink === true) return true;
    return (overlayTag === 'DIV' || overlayTag === 'SPAN') &&
      isTransparent === true && emptyElement === true;
  }

  return { GESTURE_MS, shouldBlockOpen, isVideoGesture, isOverlay };
});
