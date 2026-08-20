// Small UI enhancements kept separate from the core CRM logic.
// Adds Date Created behavior, grouped-card sorting, a wider desktop workspace,
// and status changes as part of the interaction workflow.

let sortMode = 'attention';

function dateInputValue(value) {
  if (!value) return todayLocal();
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10) || todayLocal();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function ensureCreatedDateField() {
  const nextFollowUp = el('nextFollowUp');
  if (!nextFollowUp) return;

  const nextWrap = nextFollowUp.closest('label');
  if (nextWrap && !nextWrap.id) nextWrap.id = 'nextFollowUpWrap';

  if (!el('dateCreated')) {
    const label = document.createElement('label');
    label.id = 'dateCreatedWrap';
    label.innerHTML = 'Date created<input id="dateCreated" type="date" readonly>';
    nextWrap.parentNode.insertBefore(label, nextWrap);
  }
}

function setCustomerFormDateMode(customer=null) {
  ensureCreatedDateField();
  const created = el('dateCreated');
  const nextWrap = el('nextFollowUpWrap');
  if (!created || !nextWrap) return;

  created.value = customer?.createdAt ? dateInputValue(customer.createdAt) : todayLocal();
  nextWrap.classList.toggle('hidden', !customer);
}

const coreOpenCustomerForm = openCustomerForm;
openCustomerForm = function(customer=null) {
  coreOpenCustomerForm(customer);
  setCustomerFormDateMode(customer);
};

function groupDate(records, field, pick='max') {
  const values = records.map(r => r[field]).filter(Boolean).sort();
  if (!values.length) return '';
  return pick === 'min' ? values[0] : values[values.length - 1];
}

function groupNextFollowUp(records, pick='min') {
  return groupDate(records, 'nextFollowUp', pick);
}

function groupLastInteraction(records) {
  const values = records
    .flatMap(r => (r.interactions || []).map(i => i.happenedAt))
    .filter(Boolean)
    .sort();
  return values.length ? values[values.length - 1] : '';
}

function compareOptional(a, b, direction='asc') {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return direction === 'asc' ? a.localeCompare(b) : b.localeCompare(a);
}

function groupName(group) {
  return String(group.records[0]?.company || '').trim().toLowerCase();
}

function sortCustomerGroups(groups) {
  if (sortMode === 'attention') return groups;

  return [...groups].sort((a, b) => {
    switch (sortMode) {
      case 'updated-newest':
        return compareOptional(groupDate(a.records, 'updatedAt'), groupDate(b.records, 'updatedAt'), 'desc');
      case 'updated-oldest':
        return compareOptional(groupDate(a.records, 'updatedAt'), groupDate(b.records, 'updatedAt'), 'asc');
      case 'followup-soonest':
        return compareOptional(groupNextFollowUp(a.records, 'min'), groupNextFollowUp(b.records, 'min'), 'asc');
      case 'followup-latest':
        return compareOptional(groupNextFollowUp(a.records, 'max'), groupNextFollowUp(b.records, 'max'), 'desc');
      case 'interaction-newest':
        return compareOptional(groupLastInteraction(a.records), groupLastInteraction(b.records), 'desc');
      case 'interaction-oldest':
        return compareOptional(groupLastInteraction(a.records), groupLastInteraction(b.records), 'asc');
      case 'customer-az':
        return groupName(a).localeCompare(groupName(b));
      case 'customer-za':
        return groupName(b).localeCompare(groupName(a));
      case 'created-newest':
        return compareOptional(groupDate(a.records, 'createdAt', 'max'), groupDate(b.records, 'createdAt', 'max'), 'desc');
      case 'created-oldest':
        return compareOptional(groupDate(a.records, 'createdAt', 'min'), groupDate(b.records, 'createdAt', 'min'), 'asc');
      default:
        return 0;
    }
  });
}

const coreGroupedCustomers = groupedCustomers;
groupedCustomers = function(items) {
  return sortCustomerGroups(coreGroupedCustomers(items));
};

function ensureSortControl() {
  if (el('sortFilter')) return;

  const statusFilter = el('statusFilter');
  const sort = document.createElement('select');
  sort.id = 'sortFilter';
  sort.setAttribute('aria-label', 'Sort customers');
  sort.innerHTML = `
    <option value="attention">Sort: Needs attention</option>
    <option value="updated-newest">Most recently updated</option>
    <option value="updated-oldest">Least recently updated</option>
    <option value="followup-soonest">Next follow-up — soonest</option>
    <option value="followup-latest">Next follow-up — latest</option>
    <option value="interaction-newest">Last interaction — newest</option>
    <option value="interaction-oldest">Last interaction — oldest</option>
    <option value="customer-az">Customer A–Z</option>
    <option value="customer-za">Customer Z–A</option>
    <option value="created-newest">Newest inquiry</option>
    <option value="created-oldest">Oldest inquiry</option>
  `;
  statusFilter.insertAdjacentElement('afterend', sort);

  sort.addEventListener('change', () => {
    sortMode = sort.value;
    render();
  });
}

function syncToolbarColumns() {
  const toolbar = document.querySelector('.toolbar');
  if (!toolbar) return;
  toolbar.style.gridTemplateColumns = window.innerWidth > 900
    ? 'minmax(260px,1fr) 190px 190px auto auto'
    : '';
}

function widenDesktopWorkspace() {
  const style = document.createElement('style');
  style.textContent = `
    .shell { max-width: 1440px; }
    .topbar {
      padding-left: max(24px, calc((100vw - 1440px) / 2));
      padding-right: max(24px, calc((100vw - 1440px) / 2));
    }
  `;
  document.head.appendChild(style);
}

const WORKFLOW_STATUSES = [
  'New Inquiry',
  'Quote Needed',
  'Quote Sent',
  'Waiting on Customer',
  'Ordered',
  'Waiting on Vendor',
  'Ready',
  'Complete',
  'Lost / Cancelled'
];

function hideCustomerStatusField() {
  const statusWrap = el('status')?.closest('label');
  if (statusWrap) statusWrap.classList.add('hidden');
}

function ensureInteractionStatusControl() {
  if (el('interactionStatus')) return;

  const form = el('interactionForm');
  const type = el('interactionType');
  if (!form || !type) return;

  form.classList.add('workflow-status-form');
  const label = document.createElement('label');
  label.className = 'interaction-status-field';
  label.innerHTML = `
    <span>Status</span>
    <select id="interactionStatus">
      ${WORKFLOW_STATUSES.map(status => `<option>${status}</option>`).join('')}
    </select>
  `;
  form.insertBefore(label, type);

  const style = document.createElement('style');
  style.textContent = `
    .interaction-form.workflow-status-form{grid-template-columns:180px 150px minmax(220px,1fr) auto}
    .interaction-status-field{display:grid;gap:5px;color:var(--muted);font-size:.72rem;font-weight:800}
    .interaction-status-field span{text-transform:uppercase;letter-spacing:.08em}
    @media(max-width:900px){
      .interaction-form.workflow-status-form{grid-template-columns:1fr 1fr}
      .interaction-form.workflow-status-form textarea{grid-column:1/-1}
    }
    @media(max-width:640px){
      .interaction-form.workflow-status-form{grid-template-columns:1fr}
      .interaction-form.workflow-status-form textarea{grid-column:auto}
    }
  `;
  document.head.appendChild(style);
}

const coreOpenDetail = openDetail;
openDetail = function(customer, focusInteraction=false) {
  coreOpenDetail(customer, focusInteraction);
  ensureInteractionStatusControl();
  if (el('interactionStatus')) el('interactionStatus').value = customer.status || 'New Inquiry';
};

function customerPayloadWithStatus(customer, status) {
  return {
    company: customer.company || '',
    contact: customer.contact || '',
    phone: customer.phone || '',
    email: customer.email || '',
    quoteOrder: customer.quoteOrder || '',
    status: status || customer.status || 'New Inquiry',
    nextFollowUp: customer.nextFollowUp || '',
    nextAction: customer.nextAction || '',
    notes: customer.notes || ''
  };
}

function installInteractionWorkflowSubmit() {
  const form = el('interactionForm');
  if (!form || form.dataset.workflowSubmitInstalled === '1') return;
  form.dataset.workflowSubmitInstalled = '1';

  form.addEventListener('submit', async event => {
    event.preventDefault();
    event.stopImmediatePropagation();

    const customerId = editingInteractionCustomerId || selectedCustomerId;
    const customer = customers.find(item => item.id === customerId);
    if (!customer) return;

    const payload = {
      type: el('interactionType').value,
      summary: el('interactionSummary').value
    };
    const nextStatus = el('interactionStatus')?.value || customer.status || 'New Inquiry';
    const submitButton = el('interactionSubmitBtn');
    const wasEditing = Boolean(editingInteractionId);

    try {
      submitButton.disabled = true;

      if (editingInteractionId) {
        if (el('interactionHappenedAt').value) {
          const parsed = new Date(el('interactionHappenedAt').value);
          if (Number.isNaN(parsed.getTime())) throw new Error('Please enter a valid interaction date and time.');
          payload.happenedAt = parsed.toISOString();
        }
        await api(`/api/customers/${customerId}/interactions/${editingInteractionId}`, {
          method:'PUT',
          body:JSON.stringify(payload)
        });
      } else {
        payload.happenedAt = new Date().toISOString();
        await api(`/api/customers/${customerId}/interactions`, {
          method:'POST',
          body:JSON.stringify(payload)
        });
      }

      if (nextStatus !== customer.status) {
        await api(`/api/customers/${customerId}`, {
          method:'PUT',
          body:JSON.stringify(customerPayloadWithStatus(customer, nextStatus))
        });
      }

      resetInteractionForm();
      await loadCustomers();
      const fresh = customers.find(item => item.id === customerId);
      if (fresh) {
        if (detailDialog.open) detailDialog.close();
        openDetail(fresh);
      }
      toast(wasEditing ? 'Interaction updated' : 'Interaction logged');
    } catch (err) {
      alert(err.message);
    } finally {
      submitButton.disabled = false;
    }
  }, true);
}

const coreCustomerAccordion = customerAccordion;
customerAccordion = function(key, records) {
  const latestRecord = [...records].sort((a,b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))[0];
  const due = records.some(isDue);
  const oldMarkup = `<span class="status-pill ${due ? 'due' : ''}">${escapeHtml(due ? 'Follow up' : 'History')}</span>`;
  const newMarkup = `<span class="status-pill ${due ? 'due' : ''}">${escapeHtml(latestRecord.status || 'New Inquiry')}</span>`;
  return coreCustomerAccordion(key, records).replace(oldMarkup, newMarkup);
};

ensureCreatedDateField();
ensureSortControl();
syncToolbarColumns();
widenDesktopWorkspace();
hideCustomerStatusField();
ensureInteractionStatusControl();
installInteractionWorkflowSubmit();
window.addEventListener('resize', syncToolbarColumns);
