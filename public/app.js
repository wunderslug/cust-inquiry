const STATUS_CLOSED = new Set(['Complete', 'Lost / Cancelled']);

const el = id => document.getElementById(id);
const customerDialog = el('customerDialog');
const detailDialog = el('detailDialog');
let customers = [];
let selectedCustomerId = null;
let quickFilter = 'all';

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

function searchableText(c) {
  return [
    c.company,c.contact,c.phone,c.email,c.quoteOrder,c.status,c.nextAction,c.notes,
    ...(c.interactions || []).flatMap(i => [i.type,i.summary])
  ].join(' ').toLowerCase();
}

async function api(url, options={}) {
  const res = await fetch(url, {
    headers: { 'Content-Type':'application/json', ...(options.headers || {}) },
    ...options
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
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

function renderStats() {
  el('statOpen').textContent = customers.filter(c => !STATUS_CLOSED.has(c.status)).length;
  el('statDue').textContent = customers.filter(isDue).length;
  el('statCustomer').textContent = customers.filter(c => c.status === 'Waiting on Customer').length;
  el('statVendor').textContent = customers.filter(c => c.status === 'Waiting on Vendor').length;
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
        ${c.nextAction ? `<div class="next-action"><strong>Next action</strong>${escapeHtml(c.nextAction)}</div>` : ''}
      </div>
      <footer class="card-footer">
        <button data-log="${escapeHtml(c.id)}">+ Interaction</button>
        <button data-edit="${escapeHtml(c.id)}">Edit</button>
      </footer>
    </article>
  `;
}

function render() {
  renderStats();
  const items = filteredCustomers();
  const grid = el('customerGrid');
  grid.innerHTML = items.map(customerCard).join('');
  el('resultCount').textContent = `${items.length} shown`;
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

function openDetail(c, focusInteraction=false) {
  selectedCustomerId = c.id;
  el('detailStatus').textContent = c.status || 'Customer';
  el('detailCompany').textContent = c.company;
  el('detailContact').textContent = [c.contact,c.phone,c.email].filter(Boolean).join(' · ') || 'No contact details entered';

  el('detailSummary').innerHTML = [
    summaryItem('Quote / Order #', c.quoteOrder),
    summaryItem('Next follow-up', c.nextFollowUp ? formatDate(c.nextFollowUp) : ''),
    summaryItem('Next action', c.nextAction),
    summaryItem('Notes', c.notes)
  ].join('');

  const interactions = (c.interactions || []).slice(0,10);
  el('interactionTimeline').innerHTML = interactions.length
    ? interactions.map(i => `
      <div class="timeline-item">
        <div>
          <div class="timeline-type">${escapeHtml(i.type)}</div>
          <div class="timeline-date">${formatDateTime(i.happenedAt)}</div>
        </div>
        <div class="timeline-text">${escapeHtml(i.summary)}</div>
      </div>
    `).join('')
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

el('addCustomerBtn').addEventListener('click', () => openCustomerForm());
el('searchInput').addEventListener('input', render);
el('statusFilter').addEventListener('change', () => { quickFilter = 'all'; render(); });

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

document.addEventListener('click', e => {
  const closeId = e.target.dataset.close;
  if (closeId) el(closeId).close();

  const openId = e.target.closest('[data-open]')?.dataset.open;
  if (openId) {
    const c = customers.find(x => x.id === openId);
    if (c) openDetail(c);
  }

  const editId = e.target.dataset.edit;
  if (editId) {
    const c = customers.find(x => x.id === editId);
    if (c) openCustomerForm(c);
  }

  const logId = e.target.dataset.log;
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
  if (!confirm('Delete this customer and all interaction history?')) return;
  try {
    await api(`/api/customers/${id}`, { method:'DELETE' });
    customerDialog.close();
    await loadCustomers();
    toast('Customer deleted');
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
  const c = customers.find(x => x.id === selectedCustomerId);
  if (!c) return;
  try {
    await api(`/api/customers/${c.id}/interactions`, {
      method:'POST',
      body:JSON.stringify({
        type: el('interactionType').value,
        summary: el('interactionSummary').value,
        happenedAt: new Date().toISOString()
      })
    });
    el('interactionSummary').value = '';
    await loadCustomers();
    const fresh = customers.find(x => x.id === c.id);
    if (fresh) {
      detailDialog.close();
      openDetail(fresh);
    }
    toast('Interaction logged');
  } catch (err) {
    alert(err.message);
  }
});

loadCustomers().catch(err => {
  console.error(err);
  alert('Could not load CRM data.');
});
