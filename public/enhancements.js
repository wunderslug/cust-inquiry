// Small UI enhancements kept separate from the core CRM logic.
// Adds Date Created behavior, grouped-card sorting, theme switching,
// status color semantics, and a wider desktop workspace.

const DEFAULT_SORT_MODE = 'created-newest';
const SORT_STORAGE_KEY = 'crm.sortMode';
let sortMode = localStorage.getItem(SORT_STORAGE_KEY) || DEFAULT_SORT_MODE;

const DEFAULT_UI_THEME = 'workshop';
const THEME_STORAGE_KEY = 'crm.uiTheme';
const UI_THEMES = [
  ['workshop', 'Workshop'],
  ['material', 'Material'],
  ['slate', 'Slate Dark'],
  ['compact', 'Compact Desk']
];

function loadThemeStyles() {
  if (document.querySelector('link[data-crm-themes]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/themes.css?v=20260902-dashboard2';
  link.dataset.crmThemes = '1';
  document.head.appendChild(link);
}

function applyUiTheme(theme) {
  const valid = UI_THEMES.some(([value]) => value === theme);
  const nextTheme = valid ? theme : DEFAULT_UI_THEME;
  document.body.dataset.uiTheme = nextTheme;
  localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
  const selector = el('themeSwitcher');
  if (selector) selector.value = nextTheme;
}

function ensureThemeControl() {
  loadThemeStyles();
  if (el('themeSwitcher')) return;

  const actions = document.querySelector('.topbar-actions');
  const manageUsers = el('manageUsersBtn');
  if (!actions) return;

  const select = document.createElement('select');
  select.id = 'themeSwitcher';
  select.className = 'theme-switcher';
  select.setAttribute('aria-label', 'Interface theme');
  select.innerHTML = UI_THEMES
    .map(([value, label]) => `<option value="${value}">${label}</option>`)
    .join('');

  if (manageUsers) actions.insertBefore(select, manageUsers);
  else actions.prepend(select);

  const savedTheme = localStorage.getItem(THEME_STORAGE_KEY) || DEFAULT_UI_THEME;
  applyUiTheme(savedTheme);

  select.addEventListener('change', () => applyUiTheme(select.value));
}

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
    ? 'minmax(340px,1fr) 190px 190px auto auto'
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

function statusTone(status='') {
  const normalized = String(status).trim().toLowerCase();
  const tones = {
    'new inquiry':'new',
    'quote needed':'quote-needed',
    'quote sent':'quote-sent',
    'waiting on customer':'waiting-customer',
    'ordered':'ordered',
    'waiting on vendor':'waiting-vendor',
    'ready':'ready',
    'complete':'complete',
    'lost / cancelled':'lost'
  };
  return tones[normalized] || 'new';
}

function statusMarkup(status, due=false) {
  const safeStatus = status || 'New Inquiry';
  return `
    <div class="status-stack">
      <span class="status-pill status-${statusTone(safeStatus)}">${escapeHtml(safeStatus)}</span>
      ${due ? '<span class="attention-pill">Follow-up due</span>' : ''}
    </div>
  `;
}

function replacePrimaryStatusPill(markup, status, due=false) {
  const pillPattern = /<span class="status-pill[^\"]*">[^<]*<\/span>/;
  return markup.replace(pillPattern, statusMarkup(status, due));
}

const coreCustomerCardStatus = customerCard;
customerCard = function(customer) {
  return replacePrimaryStatusPill(
    coreCustomerCardStatus(customer),
    customer.status || 'New Inquiry',
    isDue(customer)
  );
};

const coreInquiryBlockStatus = inquiryBlock;
inquiryBlock = function(customer) {
  return replacePrimaryStatusPill(
    coreInquiryBlockStatus(customer),
    customer.status || 'New Inquiry',
    isDue(customer)
  );
};

const coreCustomerAccordion = customerAccordion;
customerAccordion = function(key, records) {
  const latestRecord = [...records].sort((a,b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))[0];
  return replacePrimaryStatusPill(
    coreCustomerAccordion(key, records),
    latestRecord.status || 'New Inquiry',
    records.some(isDue)
  );
};

function syncDetailStatusTone(status) {
  const select = el('detailStatusSelect');
  if (!select) return;
  select.dataset.statusTone = statusTone(status || select.value);
}

const coreOpenDetailStatusTone = openDetail;
openDetail = function(customer, focusInteraction=false) {
  coreOpenDetailStatusTone(customer, focusInteraction);
  syncDetailStatusTone(customer?.status);
};

el('detailStatusSelect')?.addEventListener('change', event => {
  syncDetailStatusTone(event.target.value);
});

ensureThemeControl();
ensureCreatedDateField();
ensureSortControl();
syncToolbarColumns();
widenDesktopWorkspace();
window.addEventListener('resize', syncToolbarColumns);
