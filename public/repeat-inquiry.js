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

  // Keep every inquiry/order-specific field clean.
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

function newInquiryButton(customerId, extraClass='') {
  return `<button type="button" class="new-inquiry-action ${extraClass}" data-new-inquiry="${escapeHtml(customerId)}">+ New Order / Inquiry</button>`;
}

const coreCustomerCardRepeatInquiry = customerCard;
customerCard = function(customer) {
  const markup = coreCustomerCardRepeatInquiry(customer);
  const marker = '<footer class="card-footer">';
  return markup.replace(marker, `${marker}\n        ${newInquiryButton(customer.id)}`);
};

const coreCustomerAccordionRepeatInquiry = customerAccordion;
customerAccordion = function(key, records) {
  const markup = coreCustomerAccordionRepeatInquiry(key, records);
  const latestRecord = [...records].sort((a,b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))[0];
  return markup.replace(
    '</article>',
    `<footer class="card-footer customer-group-actions">${newInquiryButton(latestRecord.id)}</footer>\n    </article>`
  );
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
  const button = event.target.closest('[data-new-inquiry]');
  if (!button) return;

  event.preventDefault();
  event.stopPropagation();

  const customer = customers.find(item => item.id === button.dataset.newInquiry);
  openNewInquiryFrom(customer);
}, true);

const repeatInquiryStyle = document.createElement('style');
repeatInquiryStyle.textContent = `
  .detail-actions{gap:10px;flex-wrap:wrap}
  .card-footer .new-inquiry-action{
    background:var(--olive);
    color:#fff;
    border-radius:9px;
    padding:7px 10px;
  }
  .card-footer .new-inquiry-action:hover{background:var(--olive-dark)}
  .customer-group-actions{border-top:1px solid var(--line)}
`;
document.head.appendChild(repeatInquiryStyle);

ensureDetailNewInquiryButton();
render();
