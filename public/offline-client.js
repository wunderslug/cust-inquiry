// Browser-side offline status UI and service-worker coordination.

let crmOffline = false;
let crmOfflineBackupCreatedAt = null;
let crmOfflinePending = 0;
let crmOfflineHealthTimer = null;
let crmOfflineHealthBusy = false;

function ensureOfflineUi() {
  if (!document.querySelector('meta[name="mobile-web-app-capable"]')) {
    const meta = document.createElement('meta');
    meta.name = 'mobile-web-app-capable';
    meta.content = 'yes';
    document.head.appendChild(meta);
  }

  if (!el('crmOfflineBanner')) {
    const banner = document.createElement('section');
    banner.id = 'crmOfflineBanner';
    banner.className = 'crm-offline-banner hidden';
    banner.setAttribute('role', 'status');
    banner.innerHTML = `
      <div class="crm-offline-banner-text">
        <strong id="crmOfflineTitle">Offline mode</strong>
        <span id="crmOfflineText"></span>
      </div>
      <button type="button" class="crm-offline-backup-button" id="crmDownloadOfflineBackup">Download local backup</button>
    `;
    const topbar = document.querySelector('.topbar');
    if (topbar) topbar.insertAdjacentElement('afterend', banner);

    el('crmDownloadOfflineBackup')?.addEventListener('click', downloadOfflineBackup);
  }

  if (!document.getElementById('crmOfflineStyles')) {
    const style = document.createElement('style');
    style.id = 'crmOfflineStyles';
    style.textContent = `
      .crm-offline-banner{
        position:sticky;
        top:0;
        z-index:95;
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:18px;
        padding:11px max(24px,calc((100vw - 1440px)/2));
        background:#ffe8c2;
        color:#654200;
        border-bottom:1px solid #d9a84c;
        box-shadow:0 4px 14px rgba(91,61,0,.10);
      }
      .crm-offline-banner.syncing{background:#dcecf8;color:#244f73;border-bottom-color:#8fb7d4}
      .crm-offline-banner.error{background:#f5d9d6;color:#7b2d26;border-bottom-color:#cf8e87}
      .crm-offline-banner-text{display:grid;gap:2px;min-width:0}
      .crm-offline-banner-text strong{font-size:.82rem;letter-spacing:.02em}
      .crm-offline-banner-text span{font-size:.78rem;line-height:1.35}
      .crm-offline-backup-button{
        border:1px solid currentColor;
        background:rgba(255,255,255,.65);
        color:inherit;
        border-radius:9px;
        min-height:36px;
        padding:7px 11px;
        font-weight:850;
        white-space:nowrap;
      }
      body[data-ui-theme="slate"] .crm-offline-banner{background:#4e3b1d;color:#ffe5aa;border-bottom-color:#85622c}
      body[data-ui-theme="slate"] .crm-offline-banner.syncing{background:#263d52;color:#d5e9fa;border-bottom-color:#4c708f}
      body[data-ui-theme="slate"] .crm-offline-banner.error{background:#4b2926;color:#ffd0ca;border-bottom-color:#80504a}
      body[data-ui-theme="slate"] .crm-offline-backup-button{background:rgba(0,0,0,.22)}
      body.crm-offline .signed-in::after{
        content:"Offline";
        color:#ffd58a;
        font-size:.66rem;
        font-weight:850;
        text-transform:uppercase;
        letter-spacing:.08em;
      }
      @media(max-width:760px){
        .crm-offline-banner{align-items:flex-start;flex-direction:column;padding:10px 14px;gap:8px}
        .crm-offline-backup-button{width:100%}
      }
    `;
    document.head.appendChild(style);
  }
}

function renderOfflineBanner(mode = crmOffline ? 'offline' : 'hidden', extra = {}) {
  ensureOfflineUi();
  const banner = el('crmOfflineBanner');
  if (!banner) return;

  banner.classList.remove('syncing', 'error');
  document.body.classList.toggle('crm-offline', mode === 'offline' || mode === 'syncing' || mode === 'error');

  if (mode === 'hidden') {
    banner.classList.add('hidden');
    return;
  }

  banner.classList.remove('hidden');
  const pending = Number(extra.pending ?? crmOfflinePending ?? 0);
  const backupText = crmOfflineBackupCreatedAt
    ? ` Emergency backup saved ${new Date(crmOfflineBackupCreatedAt).toLocaleTimeString([], { hour:'numeric', minute:'2-digit' })}.`
    : '';

  if (mode === 'syncing') {
    banner.classList.add('syncing');
    el('crmOfflineTitle').textContent = 'Server reachable — syncing';
    el('crmOfflineText').textContent = pending
      ? `Replaying ${pending} queued change${pending === 1 ? '' : 's'} in order…`
      : 'Refreshing the server copy…';
    return;
  }

  if (mode === 'error') {
    banner.classList.add('error');
    el('crmOfflineTitle').textContent = extra.title || 'Offline changes need attention';
    el('crmOfflineText').textContent = extra.message || `${pending} change${pending === 1 ? '' : 's'} remain safely stored on this device.`;
    return;
  }

  el('crmOfflineTitle').textContent = 'OFFLINE — Working from local CRM copy';
  el('crmOfflineText').textContent = `${pending} change${pending === 1 ? '' : 's'} waiting to sync.${backupText} Changes will resync automatically when the server returns.`;
}

async function sendOfflineWorkerMessage(type, payload = {}) {
  if (!('serviceWorker' in navigator)) return { ok: false, error: 'Service workers are unavailable.' };
  const registration = await navigator.serviceWorker.ready;
  const worker = navigator.serviceWorker.controller || registration.active;
  if (!worker) return { ok: false, error: 'Offline worker is not active yet.' };

  return new Promise(resolve => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve({ ok: false, error: 'Offline worker did not respond.' }), 8000);
    channel.port1.onmessage = event => {
      clearTimeout(timer);
      resolve(event.data || { ok: false });
    };
    worker.postMessage({ type, ...payload }, [channel.port2]);
  });
}

async function markOffline(reason = 'disconnect') {
  const wasOffline = crmOffline;
  crmOffline = true;

  if (!wasOffline) {
    const result = await sendOfflineWorkerMessage('CREATE_BACKUP', { reason });
    if (result?.backup?.createdAt) crmOfflineBackupCreatedAt = result.backup.createdAt;
  }

  const status = await sendOfflineWorkerMessage('GET_STATUS');
  if (status?.ok) {
    crmOfflinePending = Number(status.pending || 0);
    if (status.latestBackup?.createdAt) crmOfflineBackupCreatedAt = status.latestBackup.createdAt;
  }
  renderOfflineBanner('offline', { pending: crmOfflinePending });
}

async function tryOfflineSync() {
  const status = await sendOfflineWorkerMessage('GET_STATUS');
  if (status?.ok) crmOfflinePending = Number(status.pending || 0);

  renderOfflineBanner('syncing', { pending: crmOfflinePending });
  const result = await sendOfflineWorkerMessage('SYNC_QUEUE');

  if (!result?.ok) {
    crmOffline = Boolean(result?.offline);
    crmOfflinePending = Number(result?.pending ?? crmOfflinePending ?? 0);

    if (result?.needsLogin) {
      renderOfflineBanner('error', {
        pending: crmOfflinePending,
        title: 'Server is back — sign in to sync',
        message: `${crmOfflinePending} offline change${crmOfflinePending === 1 ? '' : 's'} are safe on this device. Sign in again and they will resume syncing automatically.`
      });
      return;
    }

    if (result?.readOnly) {
      renderOfflineBanner('error', {
        pending: crmOfflinePending,
        title: 'Return to your CRM to sync',
        message: `${crmOfflinePending} offline change${crmOfflinePending === 1 ? '' : 's'} are waiting. Switch back to your own CRM and syncing will resume.`
      });
      return;
    }

    if (result?.wrongUser) {
      renderOfflineBanner('error', {
        pending: crmOfflinePending,
        title: 'Offline changes belong to another login',
        message: `${crmOfflinePending} queued change${crmOfflinePending === 1 ? '' : 's'} remain safe. Sign in with the user who created them to sync.`
      });
      return;
    }

    renderOfflineBanner(result?.offline ? 'offline' : 'error', {
      pending: crmOfflinePending,
      message: result?.error
        ? `${result.error} ${crmOfflinePending} change${crmOfflinePending === 1 ? '' : 's'} remain safely stored.`
        : undefined
    });
    return;
  }

  crmOffline = false;
  crmOfflinePending = Number(result.pending || 0);

  if (currentUser && typeof loadCustomers === 'function') {
    try { await loadCustomers(); } catch {}
  }

  if (result.synced) toast(`${result.synced} offline change${result.synced === 1 ? '' : 's'} synced`);
  renderOfflineBanner('hidden');
}

async function checkCrmServer() {
  if (crmOfflineHealthBusy) return;
  crmOfflineHealthBusy = true;
  try {
    const response = await fetch(`/api/health?t=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error('Server unavailable');

    const status = await sendOfflineWorkerMessage('GET_STATUS');
    const pending = Number(status?.pending || 0);
    crmOfflinePending = pending;

    if (crmOffline || pending > 0) await tryOfflineSync();
    else renderOfflineBanner('hidden');
  } catch {
    await markOffline('server-disconnect');
  } finally {
    crmOfflineHealthBusy = false;
  }
}

async function downloadOfflineBackup() {
  const result = await sendOfflineWorkerMessage('DOWNLOAD_BACKUP');
  if (!result?.ok || !result.backup) {
    toast(result?.error || 'Could not create local backup');
    return;
  }

  const blob = new Blob([JSON.stringify(result.backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `crm-local-emergency-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Local emergency backup downloaded');
}

async function registerCrmOfflineWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
    await registration.update();
    await navigator.serviceWorker.ready;

    navigator.serviceWorker.addEventListener('message', event => {
      const message = event.data || {};
      if (message.type === 'CRM_OFFLINE') {
        crmOffline = true;
        crmOfflinePending = Number(message.pending || crmOfflinePending || 0);
        if (message.backup?.createdAt) crmOfflineBackupCreatedAt = message.backup.createdAt;
        renderOfflineBanner('offline', { pending: crmOfflinePending });
      } else if (message.type === 'CRM_OFFLINE_QUEUED') {
        crmOffline = true;
        crmOfflinePending = Number(message.pending || 0);
        renderOfflineBanner('offline', { pending: crmOfflinePending });
      } else if (message.type === 'CRM_SERVER_REACHABLE') {
        crmOfflinePending = Number(message.pending || 0);
        if (crmOffline || crmOfflinePending) setTimeout(tryOfflineSync, 0);
      } else if (message.type === 'CRM_SYNC_COMPLETE') {
        crmOffline = false;
        crmOfflinePending = Number(message.pending || 0);
        renderOfflineBanner('hidden');
      }
    });

    window.addEventListener('offline', () => markOffline('browser-offline'));
    window.addEventListener('online', () => checkCrmServer());

    const status = await sendOfflineWorkerMessage('GET_STATUS');
    if (status?.ok) {
      crmOfflinePending = Number(status.pending || 0);
      if (status.latestBackup?.createdAt) crmOfflineBackupCreatedAt = status.latestBackup.createdAt;
      if (status.offlineActive) crmOffline = true;
    }

    await checkCrmServer();
    clearInterval(crmOfflineHealthTimer);
    crmOfflineHealthTimer = setInterval(checkCrmServer, 15000);
  } catch (error) {
    console.error('Offline mode could not initialize', error);
  }
}

ensureOfflineUi();
registerCrmOfflineWorker();
