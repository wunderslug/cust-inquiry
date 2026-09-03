// Read-only cross-user CRM viewing.
// Authenticated users may inspect another active user's CRM, but all CRM writes remain locked.

let crmViewUsers = [];
let crmViewContext = {
  currentUser: null,
  viewingUser: null,
  readOnly: false
};
let crmViewSwitchBusy = false;
let crmReadOnlyWarnTimer = null;

function crmViewName(user) {
  return user?.displayName || user?.username || 'another user';
}

function isViewingAnotherCrm() {
  return Boolean(crmViewContext.readOnly && crmViewContext.viewingUser);
}

function readOnlyWarningMessage() {
  const viewed = crmViewName(crmViewContext.viewingUser);
  const mine = crmViewName(crmViewContext.currentUser || currentUser);
  return `Read-only: you are viewing ${viewed}'s CRM. Switch back to ${mine}'s CRM to make notes or changes.`;
}

function warnReadOnlyView() {
  if (!isViewingAnotherCrm()) return false;
  clearTimeout(crmReadOnlyWarnTimer);
  toast(readOnlyWarningMessage());
  const banner = el('crmReadOnlyBanner');
  if (banner) {
    banner.classList.add('attention-flash');
    crmReadOnlyWarnTimer = setTimeout(() => banner.classList.remove('attention-flash'), 650);
  }
  return true;
}

function ensureCrmViewUi() {
  const actions = document.querySelector('.topbar-actions');
  if (actions && !el('crmViewSwitcher')) {
    const wrap = document.createElement('label');
    wrap.className = 'crm-view-switcher-wrap';
    wrap.innerHTML = `
      <span>CRM</span>
      <select id="crmViewSwitcher" class="crm-view-switcher" aria-label="Choose CRM to view">
        <option value="">Loading…</option>
      </select>
    `;
    const before = el('themeSwitcher') || el('manageUsersBtn') || el('logoutBtn');
    if (before) actions.insertBefore(wrap, before);
    else actions.appendChild(wrap);

    el('crmViewSwitcher').addEventListener('change', async event => {
      const userId = event.target.value;
      if (!userId || crmViewSwitchBusy) return;
      await switchCrmView(userId);
    });
  }

  if (!el('crmReadOnlyBanner')) {
    const banner = document.createElement('section');
    banner.id = 'crmReadOnlyBanner';
    banner.className = 'crm-readonly-banner hidden';
    banner.setAttribute('role', 'status');
    banner.innerHTML = `
      <div class="crm-readonly-banner-text">
        <strong id="crmReadOnlyTitle">Read-only view</strong>
        <span id="crmReadOnlyText"></span>
      </div>
      <button type="button" class="crm-return-button" id="crmReturnToMine">Return to my CRM</button>
    `;
    const topbar = document.querySelector('.topbar');
    if (topbar) topbar.insertAdjacentElement('afterend', banner);

    el('crmReturnToMine').addEventListener('click', async () => {
      const myId = crmViewContext.currentUser?.id || currentUser?.id;
      if (myId) await switchCrmView(myId);
    });
  }

  if (!el('crmDetailReadOnlyNotice')) {
    const detailHead = document.querySelector('#detailDialog .modal-head');
    if (detailHead) {
      const notice = document.createElement('div');
      notice.id = 'crmDetailReadOnlyNotice';
      notice.className = 'crm-detail-readonly hidden';
      notice.innerHTML = '<strong>Read-only</strong><span id="crmDetailReadOnlyText"></span>';
      detailHead.insertAdjacentElement('afterend', notice);
    }
  }
}

function renderCrmViewSwitcher() {
  ensureCrmViewUi();
  const select = el('crmViewSwitcher');
  if (!select) return;

  const mine = crmViewContext.currentUser || currentUser;
  const viewingId = crmViewContext.viewingUser?.id || mine?.id || '';
  const users = [...crmViewUsers];
  users.sort((a, b) => {
    if (a.id === mine?.id) return -1;
    if (b.id === mine?.id) return 1;
    return crmViewName(a).localeCompare(crmViewName(b));
  });

  select.innerHTML = users.map(user => {
    const label = user.id === mine?.id
      ? `My CRM — ${crmViewName(user)}`
      : `${crmViewName(user)} — read only`;
    return `<option value="${escapeHtml(user.id)}">${escapeHtml(label)}</option>`;
  }).join('');

  if (viewingId && users.some(user => user.id === viewingId)) select.value = viewingId;
  select.disabled = crmViewSwitchBusy;
}

function syncReadOnlyControls() {
  const readOnly = isViewingAnotherCrm();
  document.body.classList.toggle('crm-read-only', readOnly);

  const interactionSummary = el('interactionSummary');
  const happenedAt = el('interactionHappenedAt');
  if (interactionSummary) interactionSummary.readOnly = readOnly;
  if (happenedAt) happenedAt.readOnly = readOnly;

  for (const id of ['interactionType', 'detailStatusSelect']) {
    const control = el(id);
    if (!control) continue;
    control.setAttribute('aria-disabled', readOnly ? 'true' : 'false');
  }

  const backup = document.querySelector('a[href="/api/backup"]');
  if (backup) backup.setAttribute('aria-disabled', readOnly ? 'true' : 'false');
}

function applyCrmViewContext(context = {}) {
  ensureCrmViewUi();

  if (context.currentUser) crmViewContext.currentUser = context.currentUser;
  else if (currentUser) crmViewContext.currentUser = {
    id: currentUser.id,
    username: currentUser.username,
    displayName: currentUser.displayName
  };

  if (context.viewingUser) crmViewContext.viewingUser = context.viewingUser;
  else if (!crmViewContext.viewingUser && crmViewContext.currentUser) crmViewContext.viewingUser = crmViewContext.currentUser;

  if (typeof context.readOnly === 'boolean') crmViewContext.readOnly = context.readOnly;
  else crmViewContext.readOnly = Boolean(
    crmViewContext.currentUser?.id &&
    crmViewContext.viewingUser?.id &&
    crmViewContext.currentUser.id !== crmViewContext.viewingUser.id
  );

  const banner = el('crmReadOnlyBanner');
  const detailNotice = el('crmDetailReadOnlyNotice');
  const viewedName = crmViewName(crmViewContext.viewingUser);
  const myName = crmViewName(crmViewContext.currentUser);

  if (banner) {
    banner.classList.toggle('hidden', !crmViewContext.readOnly);
    if (crmViewContext.readOnly) {
      el('crmReadOnlyTitle').textContent = `READ-ONLY — Viewing ${viewedName}'s CRM`;
      el('crmReadOnlyText').textContent = `You can inspect customers, notes, orders, and interactions. Switch back to ${myName}'s CRM before adding or changing anything.`;
      el('crmReturnToMine').textContent = `Return to ${myName}'s CRM`;
    }
  }

  if (detailNotice) {
    detailNotice.classList.toggle('hidden', !crmViewContext.readOnly);
    if (crmViewContext.readOnly) {
      el('crmDetailReadOnlyText').textContent = `Viewing ${viewedName}'s notes and interactions. Switch back to ${myName}'s CRM to make changes.`;
    }
  }

  syncReadOnlyControls();
  renderCrmViewSwitcher();
}

async function loadCrmViewUsers() {
  if (!currentUser) return;
  try {
    const data = await api('/api/view-users');
    crmViewUsers = data.users || [];
    applyCrmViewContext(data);
  } catch (err) {
    console.error('Could not load CRM view users', err);
  }
}

async function switchCrmView(userId) {
  if (!userId || crmViewSwitchBusy) return;
  crmViewSwitchBusy = true;
  renderCrmViewSwitcher();

  try {
    const data = await api('/api/view-user', {
      method: 'POST',
      body: JSON.stringify({ userId })
    });

    if (customerDialog.open) customerDialog.close();
    if (detailDialog.open) detailDialog.close();
    if (usersDialog.open) usersDialog.close();
    selectedCustomerId = null;
    resetInteractionForm();

    quickFilter = 'all';
    el('statusFilter').value = 'all';
    el('searchInput').value = '';

    applyCrmViewContext(data);
    await loadCustomers();

    if (data.readOnly) toast(`Viewing ${crmViewName(data.viewingUser)} — read only`);
    else toast('Back to your CRM — editing enabled');
  } catch (err) {
    alert(err.message);
    renderCrmViewSwitcher();
  } finally {
    crmViewSwitchBusy = false;
    renderCrmViewSwitcher();
  }
}

const coreApiCrmView = api;
api = async function(url, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  const crmWrite = /^\/api\/customers(?:\/|$)/.test(url) && method !== 'GET';

  if (isViewingAnotherCrm() && crmWrite) {
    const err = new Error(readOnlyWarningMessage());
    err.readOnly = true;
    throw err;
  }

  const data = await coreApiCrmView(url, options);
  if (url === '/api/customers' && method === 'GET' && data?.owner) {
    applyCrmViewContext({
      currentUser: crmViewContext.currentUser || currentUser,
      viewingUser: data.owner,
      readOnly: Boolean(data.readOnly)
    });
  }
  return data;
};

const coreShowAppCrmView = showApp;
showApp = function(user) {
  coreShowAppCrmView(user);
  ensureCrmViewUi();
  applyCrmViewContext({
    currentUser: { id: user.id, username: user.username, displayName: user.displayName },
    viewingUser: crmViewContext.viewingUser || { id: user.id, username: user.username, displayName: user.displayName }
  });
  setTimeout(loadCrmViewUsers, 0);
};

const coreShowAuthCrmView = showAuth;
showAuth = function(setupRequired) {
  crmViewUsers = [];
  crmViewContext = { currentUser: null, viewingUser: null, readOnly: false };
  document.body.classList.remove('crm-read-only');
  el('crmReadOnlyBanner')?.classList.add('hidden');
  el('crmDetailReadOnlyNotice')?.classList.add('hidden');
  coreShowAuthCrmView(setupRequired);
};

const coreOpenDetailCrmView = openDetail;
openDetail = function(customer, focusInteraction = false) {
  coreOpenDetailCrmView(customer, isViewingAnotherCrm() ? false : focusInteraction);
  applyCrmViewContext(crmViewContext);
};

const READ_ONLY_CLICK_SELECTOR = [
  '#addCustomerBtn',
  '[data-new-inquiry]',
  '[data-edit]',
  '[data-log]',
  '[data-delete-inquiry]',
  '[data-edit-interaction]',
  '[data-delete-interaction]',
  '#editFromDetailBtn',
  '#detailNewInquiryBtn',
  '#deleteCustomerBtn',
  '#interactionSubmitBtn',
  'a[href="/api/backup"]'
].join(',');

const READ_ONLY_FORM_CONTROL_SELECTOR = [
  '#detailStatusSelect',
  '#interactionType',
  '#interactionSummary',
  '#interactionHappenedAt'
].join(',');

document.addEventListener('click', event => {
  if (!isViewingAnotherCrm()) return;
  const writeControl = event.target.closest(READ_ONLY_CLICK_SELECTOR);
  if (!writeControl) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  warnReadOnlyView();
}, true);

document.addEventListener('submit', event => {
  if (!isViewingAnotherCrm()) return;
  if (!event.target.matches('#customerForm, #interactionForm')) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  warnReadOnlyView();
}, true);

document.addEventListener('pointerdown', event => {
  if (!isViewingAnotherCrm()) return;
  if (!event.target.closest(READ_ONLY_FORM_CONTROL_SELECTOR)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  warnReadOnlyView();
}, true);

document.addEventListener('keydown', event => {
  if (!isViewingAnotherCrm()) return;
  if (!event.target.closest(READ_ONLY_FORM_CONTROL_SELECTOR)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  warnReadOnlyView();
}, true);

document.addEventListener('change', event => {
  if (!isViewingAnotherCrm()) return;
  if (event.target.id !== 'detailStatusSelect') return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const customer = customers.find(item => item.id === selectedCustomerId);
  if (customer) event.target.value = customer.status || 'New Inquiry';
  warnReadOnlyView();
}, true);

const crmReadOnlyStyle = document.createElement('style');
crmReadOnlyStyle.textContent = `
  .crm-view-switcher-wrap{
    display:grid;
    gap:3px;
    color:inherit;
    font-size:.62rem;
    font-weight:850;
    text-transform:uppercase;
    letter-spacing:.08em;
  }
  .crm-view-switcher{
    min-width:190px;
    height:38px;
    border:1px solid rgba(255,255,255,.25);
    background:rgba(255,255,255,.07);
    color:#f7f3e9;
    border-radius:10px;
    padding:7px 30px 7px 10px;
    font-size:.78rem;
    font-weight:800;
    text-transform:none;
    letter-spacing:normal;
  }
  .crm-view-switcher option{color:#222;background:#fff}
  body[data-ui-theme="material"] .crm-view-switcher-wrap{color:var(--muted)}
  body[data-ui-theme="material"] .crm-view-switcher{
    background:#fff;color:var(--ink);border-color:var(--line)
  }
  body[data-ui-theme="slate"] .crm-view-switcher{
    background:#191d23;color:#eef1f5;border-color:#424a55
  }
  body[data-ui-theme="slate"] .crm-view-switcher option{background:#22262d;color:#eef1f5}

  .crm-readonly-banner{
    position:sticky;
    top:0;
    z-index:90;
    display:flex;
    align-items:center;
    justify-content:space-between;
    gap:18px;
    padding:11px max(24px,calc((100vw - 1440px)/2));
    background:#fff3cd;
    color:#5f4300;
    border-bottom:1px solid #e1bd58;
    box-shadow:0 4px 14px rgba(82,58,0,.10);
  }
  .crm-readonly-banner-text{display:grid;gap:2px;min-width:0}
  .crm-readonly-banner-text strong{font-size:.82rem;letter-spacing:.02em}
  .crm-readonly-banner-text span{font-size:.78rem;line-height:1.35}
  .crm-return-button{
    border:1px solid #9a741b;
    background:#fffaf0;
    color:#5f4300;
    border-radius:9px;
    min-height:36px;
    padding:7px 11px;
    font-weight:850;
    white-space:nowrap;
  }
  .crm-readonly-banner.attention-flash{animation:crmReadonlyFlash .65s ease}
  @keyframes crmReadonlyFlash{
    0%,100%{background:#fff3cd}
    40%{background:#ffe08a}
  }
  body[data-ui-theme="slate"] .crm-readonly-banner{
    background:#493b18;color:#fff1bd;border-bottom-color:#806b2d
  }
  body[data-ui-theme="slate"] .crm-return-button{
    background:#2e291b;color:#fff1bd;border-color:#806b2d
  }

  .crm-detail-readonly{
    display:flex;
    align-items:flex-start;
    gap:8px;
    margin:-8px 0 16px;
    padding:10px 12px;
    border:1px solid #e1bd58;
    border-radius:10px;
    background:#fff7dc;
    color:#5f4300;
    font-size:.78rem;
    line-height:1.4;
  }
  .crm-detail-readonly strong{white-space:nowrap}
  body[data-ui-theme="slate"] .crm-detail-readonly{
    background:#3d341d;color:#fff1bd;border-color:#806b2d
  }

  body.crm-read-only #addCustomerBtn,
  body.crm-read-only [data-new-inquiry],
  body.crm-read-only [data-edit],
  body.crm-read-only [data-log],
  body.crm-read-only [data-delete-inquiry],
  body.crm-read-only [data-edit-interaction],
  body.crm-read-only [data-delete-interaction],
  body.crm-read-only #editFromDetailBtn,
  body.crm-read-only #detailNewInquiryBtn,
  body.crm-read-only #deleteCustomerBtn,
  body.crm-read-only #interactionSubmitBtn,
  body.crm-read-only a[href="/api/backup"],
  body.crm-read-only #detailStatusSelect,
  body.crm-read-only #interactionForm select,
  body.crm-read-only #interactionForm textarea,
  body.crm-read-only #interactionForm input{
    opacity:.48;
    cursor:not-allowed!important;
  }
  body.crm-read-only #interactionForm{position:relative}
  body.crm-read-only #interactionForm::after{
    content:"Read-only — switch back to your CRM to add an interaction";
    grid-column:1/-1;
    color:var(--muted);
    font-size:.72rem;
    font-weight:800;
    margin-top:-2px;
  }

  @media(max-width:760px){
    .crm-view-switcher{min-width:160px;max-width:220px}
    .crm-readonly-banner{align-items:flex-start;flex-direction:column;padding:10px 14px;gap:8px}
    .crm-return-button{width:100%}
  }
`;
document.head.appendChild(crmReadOnlyStyle);

ensureCrmViewUi();
