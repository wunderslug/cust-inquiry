// Small UI enhancements kept separate from the core CRM logic.
// Adds Date Created behavior, grouped-card sorting, and a wider desktop workspace.

const DEFAULT_SORT_MODE = 'created-newest';
const SORT_STORAGE_KEY = 'crm.sortMode';
let sortMode = localStorage.getItem(SORT_STORAGE_KEY) || DEFAULT_SORT_MODE;

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

  if (![...sort.options].some(option => option.value === sortMode)) {
    sortMode = DEFAULT_SORT_MODE;
  }
  sort.value = sortMode;
  statusFilter.insertAdjacentElement('afterend', sort);

  sort.addEventListener('change', () => {
    sortMode = sort.value;
    localStorage.setItem(SORT_STORAGE_KEY, sortMode);
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
window.addEventListener('resize', syncToolbarColumns);
