const STATUS_CLOSED = new Set(['Complete', 'Lost / Cancelled']);

const el = id => document.getElementById(id);
const customerDialog = el('customerDialog');
const detailDialog = el('detailDialog');
const usersDialog = el('usersDialog');

let customers = [];
let selectedCustomerId = null;
let quickFilter = 'all';
let editingInteractionId = null;
let editingInteractionCustomerId = null;
let currentUser = null;
let authMode = 'login';
const expandedGroups = new Set();

function todayLocal() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function isDue(c) {
  return c.nextFollowUp && c.nextFollowUp <= todayLocal() && !STATUS_CLOSED.has(c.status);
}

function escapeHtml(value='') {
  return String(value).replace(/[&<>"']/g, ch => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
  })[ch]);
}

function formatDate(value) {
  if (!value) return '—';
  const d = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(value + 'T12:00:00')
    : new Date(value);
  if (Number.isNaN(d.getTime())) return escapeHtml(value);
  return d.toLocaleDateString(undefined, { month:'short', day:'numeric', year:'numeric' });
}

function formatDateTime(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return escapeHtml(value);
  return d.toLocaleString(undefined, { month:'short', day:'numeric', year:'numeric', hour:'numeric', minute:'2-digit' });
}

function toDateTimeLocal(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0,16);
}

function searchableText(c) {
  return [
    c.company,c.contact,c.phone,c.email,c.quoteOrder,c.status,c.nextAction,c.notes,
    ...(c.interactions || []).flatMap(i => [i.type,i.summary])
  ].join(' ').toLowerCase();
}

function customerKey(c) {
  return String(c.company || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

async function api(url, options={}) {
  const res = await fetch(url, {
    headers: { 'Content-Type':'application/json', ...(options.headers || {}) },
    ...options
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && url !== '/api/login') showAuth(false);
    const err = new Error(data.error || 'Something went wrong.');
    err.status = res.status;
    throw err;
  }
  return data;
}

function showAuth(setupRequired) {
  authMode = setupRequired ? 'setup' : 'login';
  currentUser = null;
  el('appRoot').classList.add('hidden');
  el('authScreen').classList.remove('hidden');
  el('authError').classList.add('hidden');
  el('authError').textContent = '';
  el('authForm').reset();

  const setup = authMode === 'setup';
  el('displayNameWrap').classList.toggle('hidden', !setup);
  el('authTitle').textContent = setup ? 'Create admin account' : 'Sign in';
  el('authSubtitle').textContent = setup
    ? 'This first account will own the customer records already in this app.'
    : 'Use your account to open your private customer list.';
  el('authSubmit').textContent = setup ? 'Create account' : 'Sign in';
  el('authPassword').autocomplete = setup ? 'new-password' : 'current-password';
  setTimeout(() => (setup ? el('authDisplayName') : el('authUsername')).focus(), 50);
}

function showApp(user) {
  currentUser = user;
  el('authScreen').classList.add('hidden');
  el('appRoot').classList.remove('hidden');
  el('currentUserName').textContent = user.displayName || user.username;
  el('currentUserRole').textContent = user.role === 'admin' ? 'Administrator' : user.username;
  el('manageUsersBtn').classList.toggle('hidden', user.role !== 'admin');
}

async function initializeSession() {
  const session = await api('/api/session');
  if (!session.authenticated) {
    showAuth(session.setupRequired);
    return;
  }
  showApp(session.user);
  await loadCustomers();
}

async function loadCustomers() {
  const data = await api('/api/customers');
  customers = data.customers || [];
  render();
}

function filteredCustomers() {
  const q = el('searchInput').value.trim().toLowerCase();
  const statusValue = el('statusFilter').value;

  return customers
    .filter(c => {
      if (quickFilter === 'due' && !isDue(c)) return false;
      if (quickFilter !== 'all' && quickFilter !== 'due' && c.status !== quickFilter) return false;

      if (statusValue === 'all') {
        if (quickFilter === 'all' && STATUS_CLOSED.has(c.status)) return false;
      } else if (c.status !== statusValue) {
        return false;
      }

      if (q && !searchableText(c).includes(q)) return false;
      return true;
    })
    .sort((a,b) => {
      const aDue = isDue(a) ? 1 : 0;
      const bDue = isDue(b) ? 1 : 0;
      if (aDue !== bDue) return bDue - aDue;
      const aFollow = a.nextFollowUp || '9999-99-99';
      const bFollow = b.nextFollowUp || '9999-99-99';
      if (aFollow !== bFollow) return aFollow.localeCompare(bFollow);
      return (b.updatedAt || '').localeCompare(a.updatedAt || '');
    });
}

function groupedCustomers(items) {
  const groups = new Map();
  for (const c of items) {
    const key = customerKey(c) || c.id;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }
  return [...groups.entries()].map(([key, records]) => ({ key, records }));
}

function renderStats() {
  el('statOpen').textContent = customers.filter(c => !STATUS_CLOSED.has(c.status)).length;
  el('statDue').textContent = customers.filter(isDue).length;
  el('statCustomer').textContent = customers.filter(c => c.status === 'Waiting on Customer').length;
  el('statVendor').textContent = customers.filter(c => c.status === 'Waiting on Vendor').length;
}

function timelineItem(customerId, i) {
  return `
    <div class="timeline-item">
      <div>
        <div class="timeline-type">${escapeHtml(i.type)}</div>
        <div class="timeline-date">${formatDateTime(i.happenedAt)}</div>
      </div>
      <div>
        <div class="timeline-text">${escapeHtml(i.summary)}</div>
        <div class="timeline-actions">
          <button type="button" class="mini-action" data-edit-interaction="${escapeHtml(i.id)}" data-customer-id="${escapeHtml(customerId)}">Edit</button>
          <button type="button" class="mini-action danger" data-delete-interaction="${escapeHtml(i.id)}" data-customer-id="${escapeHtml(customerId)}">Delete</button>
        </div>
      </div>
    </div>
  `;
}

function customerCard(c) {
  const latest = (c.interactions || [])[0];
  return `
    <article class="customer-card">
      <div class="card-main" data-open="${escapeHtml(c.id)}">
        <div class="card-top">
          <div>
            <h3 class="card-title">${escapeHtml(c.company)}</h3>
            <div class="card-contact">${escapeHtml(c.contact || c.phone || c.email || 'No contact entered')}</div>
          </div>
          <span class="status-pill ${isDue(c) ? 'due' : ''}">${escapeHtml(isDue(c) ? 'Follow up' : c.status)}</span>
        </div>

        <div class="card-meta">
          <div class="meta-row"><span class="meta-label">Quote / Order</span><strong>${escapeHtml(c.quoteOrder || '—')}</strong></div>
          <div class="meta-row"><span class="meta-label">Next follow-up</span><strong>${formatDate(c.nextFollowUp)}</strong></div>
          <div class="meta-row"><span class="meta-label">Last contact</span><strong>${latest ? formatDateTime(latest.happenedAt) : '—'}</strong></div>
        </div>
        ${latest ? `
          <div class="latest-interaction">
            <strong>${escapeHtml(latest.type)}</strong>
            <span>${escapeHtml(latest.summary)}</span>
          </div>
        ` : ''}
        ${c.nextAction ? `<div class="next-action"><strong>Initial Interest</strong>${escapeHtml(c.nextAction)}</div>` : ''}
      </div>
      <footer class="card-footer">
        <button data-log="${escapeHtml(c.id)}">+ Interaction</button>
        <button data-edit="${escapeHtml(c.id)}">Edit</button>
        <button class="danger" data-delete-inquiry="${escapeHtml(c.id)}">Delete</button>
      </footer>
    </article>
  `;
}

function inquiryBlock(c) {
  const interactions = c.interactions || [];
  return `
    <section class="inquiry-block">
      <div class="card-main">
        <div class="card-top">
          <div>
            <div class="eyebrow">Inquiry</div>
            <div class="card-contact">${escapeHtml(c.contact || c.phone || c.email || '')}</div>
          </div>
          <span class="status-pill ${isDue(c) ? 'due' : ''}">${escapeHtml(isDue(c) ? 'Follow up' : c.status)}</span>
        </div>

        ${c.nextAction ? `<div class="next-action"><strong>Initial Interest</strong>${escapeHtml(c.nextAction)}</div>` : ''}

        <div class="card-meta">
          <div class="meta-row"><span class="meta-label">Quote / Order</span><strong>${escapeHtml(c.quoteOrder || '—')}</strong></div>
          <div class="meta-row"><span class="meta-label">Next follow-up</span><strong>${formatDate(c.nextFollowUp)}</strong></div>
        </div>

        ${interactions.length ? `
          <div class="timeline">
            ${interactions.map(i => timelineItem(c.id, i)).join('')}
          </div>
        ` : `<div class="small">No interactions logged yet.</div>`}
      </div>
      <footer class="card-footer">
        <button data-open="${escapeHtml(c.id)}">Open</button>
        <button data-log="${escapeHtml(c.id)}">+ Interaction</button>
        <button data-edit="${escapeHtml(c.id)}">Edit</button>
        <button class="danger" data-delete-inquiry="${escapeHtml(c.id)}">Delete</button>
      </footer>
    </section>
  `;
}

function customerAccordion(key, records) {
  const latestRecord = [...records].sort((a,b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))[0];
  const interactionCount = records.reduce((sum,c) => sum + (c.interactions || []).length, 0);
  const expanded = expandedGroups.has(key);
  const due = records.some(isDue);

  return `
    <article class="customer-card">
      <div class="card-main accordion-head" data-accordion="${escapeHtml(key)}">
        <div class="card-top">
          <div>
            <h3 class="card-title">${escapeHtml(latestRecord.company)}</h3>
            <div class="card-contact">${escapeHtml(latestRecord.contact || latestRecord.phone || latestRecord.email || 'No contact entered')}</div>
          </div>
          <span class="status-pill ${due ? 'due' : ''}">${escapeHtml(due ? 'Follow up' : 'History')}</span>
        </div>
        <div class="card-meta">
          <div class="meta-row"><span class="meta-label">Inquiries</span><strong>${records.length}</strong></div>
          <div class="meta-row"><span class="meta-label">Interactions</span><strong>${interactionCount}</strong></div>
          <div class="meta-row"><span class="meta-label">${expanded ? 'Collapse' : 'Expand'}</span><strong>${expanded ? '▲' : '▼'}</strong></div>
        </div>
        ${latestRecord.nextAction ? `<div class="next-action"><strong>Initial Interest</strong>${escapeHtml(latestRecord.nextAction)}</div>` : ''}
      </div>
      <div class="${expanded ? '' : 'hidden'}">
        ${records.map(inquiryBlock).join('')}
      </div>
    </article>
  `;
}

function render() {
  renderStats();
  const items = filteredCustomers();
  const groups = groupedCustomers(items);
  const grid = el('customerGrid');

  grid.innerHTML = groups.map(({key, records}) => {
    const interactionCount = records.reduce((sum,c) => sum + (c.interactions || []).length, 0);
    return records.length > 1 || interactionCount > 1
      ? customerAccordion(key, records)
      : customerCard(records[0]);
  }).join('');

  el('resultCount').textContent = `${groups.length} customer${groups.length === 1 ? '' : 's'} · ${items.length} ${items.length === 1 ? 'inquiry' : 'inquiries'}`;
  el('emptyState').classList.toggle('hidden', items.length !== 0);

  let title = 'Active customers';
  if (quickFilter === 'due') title = 'Follow-ups due';
  else if (quickFilter !== 'all') title = quickFilter;
  else if (el('statusFilter').value !== 'all') title = el('statusFilter').value;
  if (el('searchInput').value.trim()) title = 'Search results';
  el('resultTitle').textContent = title;
}

function resetCustomerForm() {
  el('customerForm').reset();
  el('customerId').value = '';
  el('status').value = 'New Inquiry';
  el('customerDialogTitle').textContent = 'New customer';
  el('deleteCustomerBtn').classList.add('hidden');
}

function openCustomerForm(c=null) {
  resetCustomerForm();
  if (c) {
    el('customerId').value = c.id;
    el('company').value = c.company || '';
    el('contact').value = c.contact || '';
    el('phone').value = c.phone || '';
    el('email').value = c.email || '';
    el('quoteOrder').value = c.quoteOrder || '';
    el('status').value = c.status || 'New Inquiry';
    el('nextFollowUp').value = c.nextFollowUp || '';
    el('nextAction').value = c.nextAction || '';
    el('notes').value = c.notes || '';
    el('customerDialogTitle').textContent = 'Edit customer';
    el('deleteCustomerBtn').classList.remove('hidden');
  }
  customerDialog.showModal();
}

function summaryItem(label, value) {
  return `<div class="summary-item"><span>${escapeHtml(label)}</span>${escapeHtml(value || '—')}</div>`;
}

function resetInteractionForm() {
  editingInteractionId = null;
  editingInteractionCustomerId = null;
  el('interactionType').value = 'Call';
  el('interactionSummary').value = '';
  el('interactionHappenedAt').value = '';
  el('interactionHappenedAt').classList.add('hidden');
  el('cancelInteractionEdit').classList.add('hidden');
  el('interactionSubmitBtn').textContent = 'Add interaction';
}

function setInteractionEditMode(c, interaction) {
  editingInteractionId = interaction.id;
  editingInteractionCustomerId = c.id;
  el('interactionType').value = interaction.type || 'Note';
  el('interactionSummary').value = interaction.summary || '';
  el('interactionHappenedAt').value = toDateTimeLocal(interaction.happenedAt);
  el('interactionHappenedAt').classList.remove('hidden');
  el('cancelInteractionEdit').classList.remove('hidden');
  el('interactionSubmitBtn').textContent = 'Save changes';
  setTimeout(() => el('interactionSummary').focus(), 80);
}

function openDetail(c, focusInteraction=false) {
  selectedCustomerId = c.id;
  resetInteractionForm();
  el('detailStatus').textContent = c.status || 'Customer';
  el('detailCompany').textContent = c.company;
  el('detailContact').textContent = [c.contact,c.phone,c.email].filter(Boolean).join(' · ') || 'No contact details entered';

  el('detailSummary').innerHTML = [
    summaryItem('Quote / Order #', c.quoteOrder),
    summaryItem('Next follow-up', c.nextFollowUp ? formatDate(c.nextFollowUp) : ''),
    summaryItem('Initial Interest', c.nextAction),
    summaryItem('Notes', c.notes)
  ].join('');

  el('interactionInterest').textContent = c.nextAction || '—';

  const interactions = (c.interactions || []).slice(0,10);
  el('interactionTimeline').innerHTML = interactions.length
    ? interactions.map(i => timelineItem(c.id, i)).join('')
    : `<div class="empty"><p>No interactions logged yet.</p></div>`;

  detailDialog.showModal();
  if (focusInteraction) setTimeout(() => el('interactionSummary').focus(), 80);
}

function toast(msg) {
  const t = el('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 1800);
}

async function loadUsers() {
  const data = await api('/api/users');
  renderUsers(data.users || []);
}

function renderUsers(users) {
  el('usersList').innerHTML = users.map(u => `
    <div class="user-card" data-user-row="${escapeHtml(u.id)}">
      <div class="user-card-head">
        <div>
          <strong>${escapeHtml(u.displayName)}</strong>
          <span>@${escapeHtml(u.username)}</span>
        </div>
        <span class="status-pill ${u.active ? '' : 'inactive'}">${u.active ? 'Active' : 'Disabled'}</span>
      </div>
      <div class="user-fields">
        <label>Display name
          <input data-user-display value="${escapeHtml(u.displayName)}" maxlength="80">
        </label>
        <label>Username
          <input data-user-username value="${escapeHtml(u.username)}" maxlength="50">
        </label>
        <label>Role
          <select data-user-role>
            <option value="user" ${u.role === 'user' ? 'selected' : ''}>User</option>
            <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin</option>
          </select>
        </label>
        <label>New password
          <input data-user-password type="password" minlength="8" placeholder="Leave blank to keep">
        </label>
        <label class="user-active-check">
          <input data-user-active type="checkbox" ${u.active ? 'checked' : ''}>
          Account enabled
        </label>
      </div>
      <div class="user-actions">
        <button class="secondary" type="button" data-save-user="${escapeHtml(u.id)}">Save</button>
        <button class="secondary danger" type="button" data-delete-user="${escapeHtml(u.id)}" ${u.id === currentUser?.id ? 'disabled' : ''}>Delete user</button>
      </div>
    </div>
  `).join('');
}

el('authForm').addEventListener('submit', async e => {
  e.preventDefault();
  el('authError').classList.add('hidden');
  const payload = {
    username: el('authUsername').value,
    password: el('authPassword').value
  };
  if (authMode === 'setup') payload.displayName = el('authDisplayName').value;

  try {
    const data = await api(authMode === 'setup' ? '/api/setup' : '/api/login', {
      method:'POST',
      body:JSON.stringify(payload)
    });
    showApp(data.user);
    await loadCustomers();
    if (authMode === 'setup' && data.migratedLegacyData) toast('Existing customer data moved into your account');
  } catch (err) {
    el('authError').textContent = err.message;
    el('authError').classList.remove('hidden');
  }
});

el('logoutBtn').addEventListener('click', async () => {
  try { await api('/api/logout', { method:'POST' }); } catch {}
  customers = [];
  showAuth(false);
});

el('manageUsersBtn').addEventListener('click', async () => {
  usersDialog.showModal();
  try { await loadUsers(); }
  catch (err) {
    usersDialog.close();
    alert(err.message);
  }
});

el('newUserForm').addEventListener('submit', async e => {
  e.preventDefault();
  try {
    await api('/api/users', {
      method:'POST',
      body:JSON.stringify({
        displayName: el('newUserDisplayName').value,
        username: el('newUserUsername').value,
        password: el('newUserPassword').value,
        role: el('newUserRole').value
      })
    });
    el('newUserForm').reset();
    el('newUserRole').value = 'user';
    await loadUsers();
    toast('User added');
  } catch (err) {
    alert(err.message);
  }
});

el('addCustomerBtn').addEventListener('click', () => openCustomerForm());
el('searchInput').addEventListener('input', render);
el('statusFilter').addEventListener('change', () => { quickFilter = 'all'; render(); });
el('cancelInteractionEdit').addEventListener('click', resetInteractionForm);

document.querySelectorAll('.stat-card').forEach(btn => {
  btn.addEventListener('click', () => {
    quickFilter = btn.dataset.filter;
    el('statusFilter').value = 'all';
    render();
  });
});

el('clearFilterBtn').addEventListener('click', () => {
  quickFilter = 'all';
  el('statusFilter').value = 'all';
  el('searchInput').value = '';
  render();
});

document.addEventListener('click', async e => {
  const closeId = e.target.dataset.close;
  if (closeId) {
    el(closeId).close();
    return;
  }

  const saveUserBtn = e.target.closest('[data-save-user]');
  if (saveUserBtn) {
    const id = saveUserBtn.dataset.saveUser;
    const row = saveUserBtn.closest('[data-user-row]');
    const password = row.querySelector('[data-user-password]').value;
    const payload = {
      displayName: row.querySelector('[data-user-display]').value,
      username: row.querySelector('[data-user-username]').value,
      role: row.querySelector('[data-user-role]').value,
      active: row.querySelector('[data-user-active]').checked
    };
    if (password) payload.password = password;

    try {
      const data = await api(`/api/users/${id}`, { method:'PUT', body:JSON.stringify(payload) });
      if (id === currentUser.id) {
        currentUser = data.user;
        showApp(currentUser);
      }
      await loadUsers();
      toast('User updated');
    } catch (err) {
      alert(err.message);
    }
    return;
  }

  const deleteUserBtn = e.target.closest('[data-delete-user]');
  if (deleteUserBtn) {
    const id = deleteUserBtn.dataset.deleteUser;
    const row = deleteUserBtn.closest('[data-user-row]');
    const username = row.querySelector('[data-user-username]').value;
    if (!confirm(`Delete user "${username}"?\n\nTheir customer data will be archived, not erased.`)) return;
    try {
      await api(`/api/users/${id}`, { method:'DELETE' });
      await loadUsers();
      toast('User removed and data archived');
    } catch (err) {
      alert(err.message);
    }
    return;
  }

  const deleteInteractionBtn = e.target.closest('[data-delete-interaction]');
  if (deleteInteractionBtn) {
    const customerId = deleteInteractionBtn.dataset.customerId;
    const interactionId = deleteInteractionBtn.dataset.deleteInteraction;
    if (!confirm('Delete this interaction? This cannot be undone.')) return;
    try {
      await api(`/api/customers/${customerId}/interactions/${interactionId}`, { method:'DELETE' });
      const detailWasOpen = detailDialog.open && selectedCustomerId === customerId;
      await loadCustomers();
      if (detailWasOpen) {
        const fresh = customers.find(x => x.id === customerId);
        detailDialog.close();
        if (fresh) openDetail(fresh);
      }
      toast('Interaction deleted');
    } catch (err) {
      alert(err.message);
    }
    return;
  }

  const editInteractionBtn = e.target.closest('[data-edit-interaction]');
  if (editInteractionBtn) {
    const customerId = editInteractionBtn.dataset.customerId;
    const interactionId = editInteractionBtn.dataset.editInteraction;
    const c = customers.find(x => x.id === customerId);
    const interaction = c?.interactions?.find(i => i.id === interactionId);
    if (!c || !interaction) return;
    if (!detailDialog.open || selectedCustomerId !== customerId) {
      if (detailDialog.open) detailDialog.close();
      openDetail(c);
    }
    setInteractionEditMode(c, interaction);
    return;
  }

  const deleteInquiryBtn = e.target.closest('[data-delete-inquiry]');
  if (deleteInquiryBtn) {
    const id = deleteInquiryBtn.dataset.deleteInquiry;
    const c = customers.find(x => x.id === id);
    if (!c) return;
    const label = c.nextAction ? `\n\nInitial Interest: ${c.nextAction}` : '';
    if (!confirm(`Delete this inquiry and all of its interaction history?${label}\n\nThis cannot be undone.`)) return;
    try {
      await api(`/api/customers/${id}`, { method:'DELETE' });
      if (detailDialog.open && selectedCustomerId === id) detailDialog.close();
      await loadCustomers();
      toast('Inquiry deleted');
    } catch (err) {
      alert(err.message);
    }
    return;
  }

  const accordion = e.target.closest('[data-accordion]');
  if (accordion) {
    const key = accordion.dataset.accordion;
    if (expandedGroups.has(key)) expandedGroups.delete(key);
    else expandedGroups.add(key);
    render();
    return;
  }

  const openId = e.target.closest('[data-open]')?.dataset.open;
  if (openId) {
    const c = customers.find(x => x.id === openId);
    if (c) openDetail(c);
    return;
  }

  const editId = e.target.closest('[data-edit]')?.dataset.edit;
  if (editId) {
    const c = customers.find(x => x.id === editId);
    if (c) openCustomerForm(c);
    return;
  }

  const logId = e.target.closest('[data-log]')?.dataset.log;
  if (logId) {
    const c = customers.find(x => x.id === logId);
    if (c) openDetail(c, true);
  }
});

el('customerForm').addEventListener('submit', async e => {
  e.preventDefault();
  const id = el('customerId').value;
  const payload = {
    company: el('company').value,
    contact: el('contact').value,
    phone: el('phone').value,
    email: el('email').value,
    quoteOrder: el('quoteOrder').value,
    status: el('status').value,
    nextFollowUp: el('nextFollowUp').value,
    nextAction: el('nextAction').value,
    notes: el('notes').value
  };

  try {
    if (id) await api(`/api/customers/${id}`, { method:'PUT', body:JSON.stringify(payload) });
    else await api('/api/customers', { method:'POST', body:JSON.stringify(payload) });
    customerDialog.close();
    await loadCustomers();
    toast(id ? 'Customer updated' : 'Customer added');
  } catch (err) {
    alert(err.message);
  }
});

el('deleteCustomerBtn').addEventListener('click', async () => {
  const id = el('customerId').value;
  if (!id) return;
  if (!confirm('Delete this inquiry and all interaction history? This cannot be undone.')) return;
  try {
    await api(`/api/customers/${id}`, { method:'DELETE' });
    customerDialog.close();
    if (detailDialog.open && selectedCustomerId === id) detailDialog.close();
    await loadCustomers();
    toast('Inquiry deleted');
  } catch (err) {
    alert(err.message);
  }
});

el('editFromDetailBtn').addEventListener('click', () => {
  const c = customers.find(x => x.id === selectedCustomerId);
  if (!c) return;
  detailDialog.close();
  openCustomerForm(c);
});

el('interactionForm').addEventListener('submit', async e => {
  e.preventDefault();
  const customerId = editingInteractionCustomerId || selectedCustomerId;
  const c = customers.find(x => x.id === customerId);
  if (!c) return;

  const payload = {
    type: el('interactionType').value,
    summary: el('interactionSummary').value
  };

  try {
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

    const wasEditing = Boolean(editingInteractionId);
    resetInteractionForm();
    await loadCustomers();
    const fresh = customers.find(x => x.id === customerId);
    if (fresh) {
      if (detailDialog.open) detailDialog.close();
      openDetail(fresh);
    }
    toast(wasEditing ? 'Interaction updated' : 'Interaction logged');
  } catch (err) {
    alert(err.message);
  }
});

initializeSession().catch(err => {
  console.error(err);
  showAuth(false);
  el('authError').textContent = 'Could not initialize the app.';
  el('authError').classList.remove('hidden');
});
