// Keep save/status confirmation toasts above modal dialog backdrops.
// Native modal dialogs live in the browser top layer, so z-index alone cannot do this.

let toastLayerTimer = null;
let toastLayerHideTimer = null;

const toastLayerStyle = document.createElement('style');
toastLayerStyle.textContent = `
  .toast[popover] {
    inset: auto 18px 18px auto;
    margin: 0;
    border: 0;
    width: max-content;
    max-width: min(420px, calc(100vw - 36px));
  }
`;
document.head.appendChild(toastLayerStyle);

toast = function(message) {
  const t = el('toast');
  if (!t) return;

  t.textContent = message;

  // Popovers are promoted into the browser's top layer. When shown after a
  // modal dialog, the toast stays crisp above the dialog's blurred backdrop.
  if (typeof t.showPopover === 'function') {
    if (!t.hasAttribute('popover')) t.setAttribute('popover', 'manual');

    try {
      if (!t.matches(':popover-open')) t.showPopover();
    } catch {
      // If the Popover API is unavailable or rejected, the existing fixed
      // positioning still provides the original behavior.
    }
  }

  clearTimeout(toastLayerTimer);
  clearTimeout(toastLayerHideTimer);

  requestAnimationFrame(() => t.classList.add('show'));

  toastLayerTimer = setTimeout(() => {
    t.classList.remove('show');
    toastLayerHideTimer = setTimeout(() => {
      if (typeof t.hidePopover === 'function') {
        try {
          if (t.matches(':popover-open')) t.hidePopover();
        } catch {}
      }
    }, 220);
  }, 1800);
};
