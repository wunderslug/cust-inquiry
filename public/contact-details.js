// Quick-contact details, repeat-order actions, and compact multi-order customer cards.

function quickContactLine(customer) {
  const parts = [customer.contact, customer.phone, customer.email]
    .map(value => String(value || '').trim())
    .filter(Boolean);
  return parts.length ? parts.join(' · ') : 'No contact entered';
}

// Keep the existing single-order card, but show all useful contact details.
const coreCustomerCardWithContact = customerCard;
customerCard = function(customer) {
  const oldContact = `<div class="card-contact">${escapeHtml(customer.contact || customer.phone || customer.email || 'No contact entered')}</div>`;
  const newContact = `<div class="card-contact">${escapeHtml(quickContactLine(customer))}</div>`;
  return coreCustomerCardWithContact(customer).replace(oldContact, newContact);
};

// Make repeat contractor/customer work explicit and fast.
// A new order/inquiry copies only shared contact details; all order-specific fields stay fresh.
function openNewInquiryFrom(customer) {
  if (!customer) return;

  if (detailDialog.open) detailDialog.close();
  openCustomerForm();

  el('company').value = customer.company || '';
  el('contact').value = customer.contact || '';
  el('phone').value = customer.phone || '';
  el('email').value = customer.email || '';

  el('customerId').value = '';
  el('quoteOrder').value = '';
  el('status').value = 'New Inquiry';
  el('nextFollowUp').value = '';
  el('nextAction').value = '';
  el('notes').value = '';
  el('customerDialogTitle').textContent = 'New order / inquiry';
  el('deleteCustomerBtn').classList.add('hidden');

  setTimeout(() => el('quoteOrder').focus(), 80);
}

function newInquiryButton(customerId) {
  return `<button type="button" class="new-inquiry-action" data-new-inquiry="${escapeHtml(customerId)}">+ New Order / Inquiry</button>`;
}

// Add the explicit repeat-order action to normal single-order cards.
const coreCustomerCardRepeatInquiry = customerCard;
customerCard = function(customer) {
  const markup = coreCustomerCardRepeatInquiry(customer);
  const marker = '<footer class="card-footer">';
  return markup.replace(marker, `${marker}\n        ${newInquiryButton(customer.id)}`);
};

// Multi-order customers use a compact order picker instead of expanding every order/history.
const expandedOrderPickers = new Set();
const ORDER_PICKER_PREVIEW_COUNT = 3;

function orderSortValue(customer) {
  return customer.createdAt || customer.updatedAt || '';
}

function sortedOrderRecords(records) {
  return [...records].sort((a, b) => {
    const byCreated = orderSortValue(b).localeCompare(orderSortValue(a));
    if (byCreated) return byCreated;
    return (b.updatedAt || '').localeCompare(a.updatedAt || '');
  });
}

function orderNumberLabel(customer) {
  const value = String(customer.quoteOrder || '').trim();
  if (!value) return 'No order #';
  return value.startsWith('#') ? value : `#${value}`;
}

function orderSubject(customer) {
  return String(customer.nextAction || '').trim() || 'No description entered';
}

function compactOrderRow(customer) {
  const created = customer.createdAt ? formatDate(customer.createdAt) : '';
  return `
    <button type="button" class="order-picker-row" data-open="${escapeHtml(customer.id)}" aria-label="Open ${escapeHtml(orderNumberLabel(customer))}">
      <span class="order-picker-main">
        <span class="order-picker-number">${escapeHtml(orderNumberLabel(customer))}</span>
        <span class="order-picker-subject">${escapeHtml(orderSubject(customer))}</span>
        ${created ? `<span class="order-picker-date">Created ${created}</span>` : ''}
      </span>
      <span class="order-picker-status">${statusMarkup(customer.status || 'New Inquiry', isDue(customer))}</span>
      <span class="order-picker-chevron" aria-hidden="true">›</span>
    </button>
  `;
}

customerAccordion = function(key, records) {
  // The core renderer also uses customerAccordion for a single inquiry with several
  // interactions. Keep those customers compact instead of exposing history on the dashboard.
  if (records.length <= 1) return customerCard(records[0]);

  const sorted = sortedOrderRecords(records);
  const latestRecord = sorted[0];
  const expanded = expandedOrderPickers.has(key);
  const visible = expanded ? sorted : sorted.slice(0, ORDER_PICKER_PREVIEW_COUNT);
  const hiddenCount = Math.max(0, sorted.length - ORDER_PICKER_PREVIEW_COUNT);
  const dueCount = records.filter(isDue).length;

  return `
    <article class="customer-card multi-order-card">
      <div class="multi-order-head">
        <div class="multi-order-identity">
          <div class="multi-order-title-line">
            <h3 class="card-title">${escapeHtml(latestRecord.company)}</h3>
            <span class="order-count-pill">${records.length} orders</span>
          </div>
          <div class="card-contact">${escapeHtml(quickContactLine(latestRecord))}</div>
        </div>
        ${dueCount ? `<span class="attention-pill">${dueCount} follow-up${dueCount === 1 ? '' : 's'} due</span>` : ''}
      </div>

      <div class="order-picker-list" aria-label="Orders for ${escapeHtml(latestRecord.company)}">
        ${visible.map(compactOrderRow).join('')}
      </div>

      ${hiddenCount ? `
        <button type="button" class="older-orders-toggle" data-toggle-orders="${escapeHtml(key)}">
          ${expanded ? 'Show newest 3 only' : `View ${hiddenCount} older order${hiddenCount === 1 ? '' : 's'}`}
          <span aria-hidden="true">${expanded ? '↑' : '↓'}</span>
        </button>
      ` : ''}

      <footer class="card-footer customer-group-actions">
        ${newInquiryButton(latestRecord.id)}
      </footer>
    </article>
  `;
};

function ensureDetailNewInquiryButton() {
  if (el('detailNewInquiryBtn')) return;
  const actions = document.querySelector('#detailDialog .detail-actions');
  const editButton = el('editFromDetailBtn');
  if (!actions || !editButton) return;

  const button = document.createElement('button');
  button.type = 'button';
  button.id = 'detailNewInquiryBtn';
  button.className = 'primary';
  button.textContent = '+ New Order / Inquiry';
  button.addEventListener('click', () => {
    const customer = customers.find(item => item.id === selectedCustomerId);
    openNewInquiryFrom(customer);
  });
  actions.insertBefore(button, editButton);
}

document.addEventListener('click', event => {
  const newInquiry = event.target.closest('[data-new-inquiry]');
  if (newInquiry) {
    event.preventDefault();
    event.stopPropagation();
    const customer = customers.find(item => item.id === newInquiry.dataset.newInquiry);
    openNewInquiryFrom(customer);
    return;
  }

  const toggle = event.target.closest('[data-toggle-orders]');
  if (toggle) {
    event.preventDefault();
    event.stopPropagation();
    const key = toggle.dataset.toggleOrders;
    if (expandedOrderPickers.has(key)) expandedOrderPickers.delete(key);
    else expandedOrderPickers.add(key);
    render();
  }
}, true);

const repeatInquiryStyle = document.createElement('style');
repeatInquiryStyle.textContent = `
  .detail-actions{gap:10px;flex-wrap:wrap}
  .card-footer .new-inquiry-action{
    background:var(--olive);
    color:#fff;
    border:1px solid transparent;
    border-radius:10px;
    padding:8px 12px;
    min-height:36px;
  }
  .card-footer .new-inquiry-action:hover{background:var(--olive-dark)}

  .multi-order-card{
    overflow:visible;
    position:relative;
    isolation:isolate;
    background:var(--surface);
  }
  .multi-order-card::before,
  .multi-order-card::after{
    content:"";
    position:absolute;
    left:9px;
    right:9px;
    height:18px;
    border:1px solid var(--line);
    border-radius:var(--radius);
    background:var(--surface);
    z-index:-1;
    pointer-events:none;
  }
  .multi-order-card::before{bottom:-6px;opacity:.72}
  .multi-order-card::after{left:18px;right:18px;bottom:-11px;opacity:.42;z-index:-2}

  .multi-order-head{
    display:flex;
    align-items:flex-start;
    justify-content:space-between;
    gap:14px;
    padding:18px 18px 13px;
  }
  .multi-order-identity{min-width:0}
  .multi-order-title-line{display:flex;align-items:center;gap:9px;flex-wrap:wrap}
  .order-count-pill{
    display:inline-flex;
    align-items:center;
    min-height:24px;
    padding:3px 8px;
    border-radius:999px;
    background:var(--surface-2);
    color:var(--muted);
    font-size:.7rem;
    font-weight:850;
    white-space:nowrap;
  }

  .order-picker-list{
    display:grid;
    margin:0 12px;
    border:1px solid var(--line);
    border-radius:12px;
    overflow:hidden;
    background:var(--surface);
  }
  .order-picker-row{
    width:100%;
    min-height:70px;
    display:grid;
    grid-template-columns:minmax(0,1fr) auto 22px;
    align-items:center;
    gap:12px;
    padding:11px 12px;
    border:0;
    border-bottom:1px solid var(--line);
    background:transparent;
    color:var(--ink);
    text-align:left;
  }
  .order-picker-row:last-child{border-bottom:0}
  .order-picker-row:hover{background:color-mix(in srgb,var(--surface-2) 55%,transparent)}
  .order-picker-row:focus-visible{outline:3px solid color-mix(in srgb,var(--olive) 28%,transparent);outline-offset:-3px}
  .order-picker-main{display:grid;gap:2px;min-width:0}
  .order-picker-number{font-size:.82rem;font-weight:900;color:var(--ink)}
  .order-picker-subject{
    min-width:0;
    overflow:hidden;
    text-overflow:ellipsis;
    white-space:nowrap;
    color:var(--muted);
    font-size:.82rem;
  }
  .order-picker-date{font-size:.69rem;color:var(--muted);opacity:.78}
  .order-picker-status{display:flex;justify-content:flex-end;min-width:0}
  .order-picker-status .status-stack{align-items:flex-end}
  .order-picker-chevron{font-size:1.45rem;line-height:1;color:var(--muted)}

  .older-orders-toggle{
    width:calc(100% - 24px);
    margin:8px 12px 0;
    min-height:36px;
    border:0;
    background:transparent;
    color:var(--olive-dark);
    font-size:.78rem;
    font-weight:850;
    display:flex;
    align-items:center;
    justify-content:center;
    gap:7px;
    border-radius:9px;
  }
  .older-orders-toggle:hover{background:var(--surface-2)}
  .multi-order-card > .customer-group-actions{
    position:relative;
    z-index:1;
    margin-top:8px;
    border-top:1px solid var(--line);
    border-radius:0 0 var(--radius) var(--radius);
    overflow:hidden;
  }

  @media(max-width:640px){
    .multi-order-head{padding:15px 14px 11px}
    .order-picker-list{margin:0 10px}
    .order-picker-row{grid-template-columns:minmax(0,1fr) 18px;gap:8px}
    .order-picker-status{grid-column:1/-1;justify-content:flex-start;margin-top:2px}
    .order-picker-status .status-stack{align-items:flex-start;flex-direction:row;flex-wrap:wrap}
    .order-picker-chevron{grid-column:2;grid-row:1;align-self:center}
    .older-orders-toggle{width:calc(100% - 20px);margin-left:10px;margin-right:10px}
  }
`;
document.head.appendChild(repeatInquiryStyle);

ensureDetailNewInquiryButton();
render();
