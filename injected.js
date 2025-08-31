(() => {
  const LOCKDOWN_FLAG = true;
  if (!LOCKDOWN_FLAG) return;

  try {
    Object.defineProperty(window, 'open', {
      configurable: false,
      enumerable: false,
      writable: false,
      value: function () { return null; }
    });
  } catch {
    try { window.open = function () { return null; }; } catch {}
  }

  function kill(ev) {
    ev.stopImmediatePropagation();
    ev.preventDefault();
    ev.stopPropagation();
  }

  const types = ['click','auxclick','mousedown','mouseup','pointerdown','pointerup','touchstart','touchend','keydown'];
  types.forEach(t => {
    window.addEventListener(t, ev => {
      if (!ev || !ev.isTrusted) return;
      let el = ev.target;
      while (el && el !== document.documentElement) {
        if (el.tagName === 'A') {
          const target = (el.getAttribute('target') || '').toLowerCase();
          if (target === '_blank') { kill(ev); return; }
        }
        el = el.parentElement;
      }
    }, { capture: true, passive: false });
  });

  try {
    const origAnchorClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function() {
      const target = (this.getAttribute('target') || '').toLowerCase();
      if (target === '_blank') return;
      return origAnchorClick.apply(this, arguments);
    };
  } catch {}
})();
