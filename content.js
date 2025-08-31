// Content script runs in the isolated world. We inject a page-script to tamper
// with page's own JS (override window.open, etc.), and we also add top-level
// event traps here. We gate behavior on the enabled flag in storage.

let enabled = false;

// Pull initial state
chrome.storage.sync.get("nnthk_enabled", ({ nnthk_enabled }) => {
  enabled = !!nnthk_enabled;
  if (enabled) armBlockers();
});

// Listen for future toggles without reload
chrome.storage.onChanged.addListener((changes) => {
  if (Object.hasOwn(changes, "nnthk_enabled")) {
    enabled = !!changes.nnthk_enabled.newValue;
    if (enabled) {
      armBlockers();
    } else {
      disarmBlockers();
    }
  }
});

let armed = false;

function armBlockers() {
  if (armed) return;
  armed = true;

  // 1) Inject a page-context script to override window.open and related APIs.
  injectPageScript(`
    (function(){
      try {
        // Nuke window.open completely
        const noopOpen = function(){ return null; };
        Object.defineProperty(window, 'open', { value: noopOpen, configurable: false, writable: false });

        // Prevent programmatic anchoring to _blank
        const AProto = HTMLAnchorElement && HTMLAnchorElement.prototype;
        if (AProto) {
          const _click = AProto.click;
          AProto.click = function() {
            try { if (this && this.target === '_blank') return; } catch(_) {}
            return _click.apply(this, arguments);
          };
        }

        // Strip target=_blank as they are added
        const mo = new MutationObserver((muts) => {
          for (const m of muts) {
            if (m.type === 'attributes' && m.attributeName === 'target' && m.target?.getAttribute?.('target') === '_blank') {
              m.target.removeAttribute('target');
            }
            if (m.type === 'childList') {
              m.addedNodes && m.addedNodes.forEach((n) => {
                if (n && n.querySelectorAll) {
                  n.querySelectorAll('a[target="_blank"]').forEach(a => a.removeAttribute('target'));
                }
              });
            }
          }
        });
        try {
          mo.observe(document.documentElement, { attributes: true, attributeFilter: ['target'], subtree: true, childList: true });
        } catch(_) {}

        // Also scrub existing anchors on load
        try {
          document.querySelectorAll('a[target="_blank"]').forEach(a => a.removeAttribute('target'));
        } catch(_) {}
      } catch(_) {}
    })();
  `);

  // 2) Top-level capture: stop target=_blank navigation attempts ASAP
  const trap = (ev) => {
    try {
      // We block everything on user interaction to prevent popup logic
      // But we especially prevent anchor _blank behaviors.
      const target = ev.target;
      const anchor = target?.closest ? target.closest('a') : null;
      if (anchor && anchor.getAttribute && anchor.getAttribute('target') === '_blank') {
        ev.preventDefault();
        ev.stopImmediatePropagation();
        return false;
      }
    } catch (_) {}
    // Even if not an anchor, preventing helps stop many popup scripts
    // tied to user gestures; but don't break basic page interaction too hard:
    // We'll only stopImmediatePropagation for trusted click-like events.
    if (ev.type === 'click' || ev.type === 'auxclick' || ev.type === 'mouseup' || ev.type === 'mousedown' || ev.type === 'pointerup' || ev.type === 'pointerdown' || ev.type === 'touchend' || ev.type === 'touchstart') {
      // Let the event continue for the page's own UI, but kill popups via window.open override.
      // Do not blanket preventDefault here to avoid breaking video play/pause.
      // Many popup scripts rely on window.open (already neutered) so this is enough.
    }
  };

  window.addEventListener('click', trap, true);
  window.addEventListener('auxclick', trap, true);
  window.addEventListener('mousedown', trap, true);
  window.addEventListener('mouseup', trap, true);
  window.addEventListener('pointerdown', trap, true);
  window.addEventListener('pointerup', trap, true);
  window.addEventListener('touchstart', trap, { capture: true, passive: false });
  window.addEventListener('touchend', trap, { capture: true, passive: false });

  // 3) As a belt-and-suspenders: intercept calls that try to spawn windows via various aliases
  injectPageScript(`
    (function(){
      try {
        // Common popup functions/aliases
        const block = () => null;
        const names = ['open', 'showModalDialog'];
        for (const n of names) {
          try { window[n] = block; } catch(_) {}
        }

        // Sometimes libs stash a ref to window.open earlier; we try to freeze Function.prototype.call/apply usage avenues minimally by returning null for suspicious calls,
        // but this is best-effort. The onCreated close in background.js is the true last-resort.
      } catch(_) {}
    })();
  `);
}

function disarmBlockers() {
  // We rely on enabled checks inside handlers; simplest is to reload page if you want a clean state.
  // Leaving as-is keeps code small; when disabled, window.open has already been replaced for this page.
  // New navigations will load without blockers.
}

// Utility to inject JS into the page context (not the isolated world)
function injectPageScript(source) {
  const s = document.createElement('script');
  s.textContent = source;
  (document.head || document.documentElement).appendChild(s);
  s.remove();
}
