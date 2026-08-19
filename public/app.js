const STATUS_CLOSED = new Set(['Complete', 'Lost / Cancelled']);

const el = id => document.getElementById(id);
const customerDialog = el('customerDialog');
const detailDialog = el('detailDialog');
let customers = [];
let selectedCustomerId = null;
let quickFilter = 'all';
let editingInteractionId = null;
let editingInteractionCustomerId = null;
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
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:9px;">
          <button type="button" class="secondary" data-edit-interaction="${escapeHtml(i.id)}" data-customer-id="${escapeHtml(customerId)}" style="padding:6px 9px;">Edit</button>
          <button type="button" class="secondary danger" data-delete-interaction="${escapeHtml(i.id)}" data-customer-id="${escapeHtml(customerId)}" style="padding:6px 9px;">Delete</button>
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
    <section>
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
      <div class="card-main" data-accordion="${escapeHtml(key)}">
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

function ensureInteractionEditControls() {
  const form = el('interactionForm');
  let timeInput = el('interactionHappenedAt');
  let cancelBtn = el('cancelInteractionEdit');
  const submitBtn = form.querySelector('button[type="submit"]');

  if (!timeInput) {
    timeInput = document.createElement('input');
    timeInput.type = 'datetime-local';
    timeInput.id = 'interactionHappenedAt';
    timeInput.hidden = true;
    timeInput.style.cssText = 'grid-column:1/-1;width:100%;border:1px solid var(--line);background:var(--surface);color:var(--ink);border-radius:12px;padding:12px 13px;outline:none;';
    form.insertBefore(timeInput, submitBtn);
  }

  if (!cancelBtn) {
    cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.id = 'cancelInteractionEdit';
    cancelBtn.className = 'secondary';
    cancelBtn.textContent = 'Cancel edit';
    cancelBtn.hidden = true;
    form.appendChild(cancelBtn);
    cancelBtn.addEventListener('click', resetInteractionForm);
  }

  return { timeInput, cancelBtn, submitBtn };
}

function resetInteractionForm() {
  editingInteractionId = null;
  editingInteractionCustomerId = null;
  el('interactionType').value = 'Call';
  el('interactionSummary').value = '';
  const { timeInput, cancelBtn, submitBtn } = ensureInteractionEditControls();
  timeInput.value = '';
  timeInput.hidden = true;
  cancelBtn.hidden = true;
  submitBtn.textContent = 'Add interaction';
}

function setInteractionEditMode(c, interaction) {
  editingInteractionId = interaction.id;
  editingInteractionCustomerId = c.id;
  el('interactionType').value = interaction.type || 'Note';
  el('interactionSummary').value = interaction.summary || '';
  const { timeInput, cancelBtn, submitBtn } = ensureInteractionEditControls();
  timeInput.value = toDateTimeLocal(interaction.happenedAt);
  timeInput.hidden = false;
  cancelBtn.hidden = false;
  submitBtn.textContent = 'Save changes';
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

document.addEventListener('click', async e => {
  const closeId = e.target.dataset.close;
  if (closeId) {
    el(closeId).close();
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
      const timeInput = el('interactionHappenedAt');
      if (timeInput?.value) {
        const parsed = new Date(timeInput.value);
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

ensureInteractionEditControls();

loadCustomers().catch(err => {
  console.error(err);
  alert('Could not load CRM data.');
});