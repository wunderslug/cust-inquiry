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

  .status-pill.status-purchasing {
    background:#dff3f0;
    color:#1e625d;
  }
  .status-select[data-status-tone="purchasing"] {
    background:#dff3f0;
    color:#1e625d;
    border-color:#9ccfc8;
  }
  body[data-ui-theme="slate"] .status-pill.status-purchasing,
  body[data-ui-theme="slate"] .status-select[data-status-tone="purchasing"] {
    background:#244945;
    color:#bde7e1;
    border-color:#3e6c67;
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

// Additional workflow status: Ordered -> Sent to Purchasing -> Waiting on Vendor.
(function installSentToPurchasingStatus() {
  const STATUS = 'Sent to Purchasing';

  function addOption(select) {
    if (!select || [...select.options].some(option => option.value === STATUS)) return;
    const option = document.createElement('option');
    option.value = STATUS;
    option.textContent = STATUS;
    const ordered = [...select.options].find(existing => existing.value === 'Ordered');
    if (ordered) ordered.insertAdjacentElement('afterend', option);
    else select.appendChild(option);
  }

  addOption(el('statusFilter'));
  addOption(el('detailStatusSelect'));

  if (typeof statusTone === 'function') {
    const coreStatusTone = statusTone;
    statusTone = function(status='') {
      if (String(status).trim().toLowerCase() === 'sent to purchasing') return 'purchasing';
      return coreStatusTone(status);
    };
  }

  // Correct any cards rendered before this late-loaded enhancement ran.
  if (typeof render === 'function' && Array.isArray(customers) && customers.length) render();
  if (typeof syncDetailStatusTone === 'function' && el('detailStatusSelect')) {
    syncDetailStatusTone(el('detailStatusSelect').value);
  }
})();
