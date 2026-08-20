// Show all quick-contact details directly in card headers.

function quickContactLine(customer) {
  const parts = [customer.contact, customer.phone, customer.email]
    .map(value => String(value || '').trim())
    .filter(Boolean);
  return parts.length ? parts.join(' · ') : 'No contact entered';
}

const coreCustomerCardWithContact = customerCard;
customerCard = function(customer) {
  const oldContact = `<div class="card-contact">${escapeHtml(customer.contact || customer.phone || customer.email || 'No contact entered')}</div>`;
  const newContact = `<div class="card-contact">${escapeHtml(quickContactLine(customer))}</div>`;
  return coreCustomerCardWithContact(customer).replace(oldContact, newContact);
};

const coreCustomerAccordionWithContact = customerAccordion;
customerAccordion = function(key, records) {
  const latestRecord = [...records].sort((a,b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))[0];
  const oldContact = `<div class="card-contact">${escapeHtml(latestRecord.contact || latestRecord.phone || latestRecord.email || 'No contact entered')}</div>`;
  const newContact = `<div class="card-contact">${escapeHtml(quickContactLine(latestRecord))}</div>`;
  return coreCustomerAccordionWithContact(key, records).replace(oldContact, newContact);
};

render();
