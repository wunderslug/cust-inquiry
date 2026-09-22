const SHELL_CACHE = 'lumber-crm-shell-v1';
const DB_NAME = 'lumber-crm-offline-v1';
const DB_VERSION = 1;
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const OFFLINE_STATUSES = new Set([502, 503, 504]);

const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/enhancements.js',
  '/contact-details.js',
  '/toast-layer.js',
  '/read-only-view.js',
  '/offline-client.js',
  '/themes.css'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await cache.addAll(SHELL_ASSETS);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name !== SHELL_CACHE).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/api/')) {
    event.respondWith(handleApiRequest(request));
    return;
  }

  if (request.method === 'GET') {
    event.respondWith(handleAssetRequest(request));
  }
});

self.addEventListener('message', event => {
  const message = event.data || {};
  const reply = value => event.ports?.[0]?.postMessage(value);

  if (message.type === 'CREATE_BACKUP') {
    event.waitUntil((async () => {
      const backup = await ensureOfflineEpisode(message.reason || 'disconnect');
      reply({ ok: true, backup });
    })().catch(error => reply({ ok: false, error: error.message })));
    return;
  }

  if (message.type === 'SYNC_QUEUE') {
    event.waitUntil((async () => reply(await drainQueue()))().catch(error => reply({ ok: false, error: error.message })));
    return;
  }

  if (message.type === 'GET_STATUS') {
    event.waitUntil((async () => {
      const [pending, offlineActive, latestBackup] = await Promise.all([
        countQueue(),
        getMeta('offlineActive'),
        getLatestBackup()
      ]);
      reply({ ok: true, pending, offlineActive: Boolean(offlineActive), latestBackup });
    })().catch(error => reply({ ok: false, error: error.message })));
    return;
  }

  if (message.type === 'DOWNLOAD_BACKUP') {
    event.waitUntil((async () => {
      const backup = await createEmergencyBackup('manual-download');
      reply({ ok: true, backup });
    })().catch(error => reply({ ok: false, error: error.message })));
  }
});

self.addEventListener('sync', event => {
  if (event.tag === 'crm-sync') event.waitUntil(drainQueue());
});

async function handleAssetRequest(request) {
  try {
    const response = await fetchWithTimeout(request.clone(), 5000);
    if (response.ok) {
      const cache = await caches.open(SHELL_CACHE);
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch {
    const cache = await caches.open(SHELL_CACHE);
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    if (request.mode === 'navigate') {
      return (await cache.match('/index.html')) || Response.error();
    }
    return Response.error();
  }
}

async function handleApiRequest(request) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();

  if (path === '/api/health' && method === 'GET') return handleHealth(request);
  if (path === '/api/session' && method === 'GET') return networkFirstSession(request);
  if (path === '/api/view-users' && method === 'GET') return networkFirstViewUsers(request);
  if (path === '/api/view-user' && method === 'POST') return handleViewSwitch(request);
  if (path === '/api/customers' && method === 'GET') return networkFirstCustomers(request);
  if (path === '/api/backup' && method === 'GET') return handleBackupRequest(request);
  if (path === '/api/logout' && method === 'POST') return handleLogout(request);

  if (/^\/api\/customers(?:\/|$)/.test(path) && method !== 'GET') {
    return handleCrmWrite(request);
  }

  return fetch(request);
}

async function handleHealth(request) {
  try {
    const response = await fetchWithTimeout(request.clone(), 4000);
    if (!response.ok) throw new OfflineError(`Health check returned ${response.status}`);
    await markNetworkOnline();
    return response;
  } catch (error) {
    await ensureOfflineEpisode('server-unreachable');
    return jsonResponse({ ok: false, offline: true, error: error.message }, 503);
  }
}

async function networkFirstSession(request) {
  try {
    const response = await fetchWithTimeout(request.clone(), 5000);
    if (isOfflineResponse(response)) throw new OfflineError(`Server returned ${response.status}`);
    if (response.ok) {
      const data = await response.clone().json().catch(() => null);
      if (data) {
        await setMeta('session', { data, cachedAt: Date.now() });
        if (data.authenticated && data.user) {
          await setMeta('viewContext', {
            currentUser: minimalUser(data.user),
            viewingUser: minimalUser(data.viewingUser || data.user),
            readOnly: Boolean(data.readOnly)
          });
        }
      }
      await markNetworkOnline();
    }
    return response;
  } catch {
    await ensureOfflineEpisode('session-network-failure');
    const cached = await getMeta('session');
    if (!cached || !cached.data || Date.now() - Number(cached.cachedAt || 0) > SESSION_MAX_AGE_MS) {
      return jsonResponse({ authenticated: false, setupRequired: false, user: null, offline: true }, 200);
    }
    return jsonResponse({ ...cached.data, offline: true }, 200);
  }
}

async function networkFirstViewUsers(request) {
  try {
    const response = await fetchWithTimeout(request.clone(), 5000);
    if (isOfflineResponse(response)) throw new OfflineError(`Server returned ${response.status}`);
    if (response.ok) {
      const data = await response.clone().json().catch(() => null);
      if (data) {
        await setMeta('viewUsers', data);
        await setMeta('viewContext', {
          currentUser: minimalUser(data.currentUser),
          viewingUser: minimalUser(data.viewingUser || data.currentUser),
          readOnly: Boolean(data.readOnly)
        });
      }
      await markNetworkOnline();
    }
    return response;
  } catch {
    await ensureOfflineEpisode('view-users-network-failure');
    const cached = await getMeta('viewUsers');
    if (!cached) return jsonResponse({ error: 'User list is not available offline.' }, 503);
    return jsonResponse({ ...cached, offline: true }, 200);
  }
}

async function handleViewSwitch(request) {
  const offlineCopy = request.clone();
  try {
    const response = await fetchWithTimeout(request.clone(), 5000);
    if (isOfflineResponse(response)) throw new OfflineError(`Server returned ${response.status}`);
    if (response.ok) {
      const data = await response.clone().json().catch(() => null);
      if (data) {
        await setMeta('viewContext', {
          currentUser: minimalUser(data.currentUser),
          viewingUser: minimalUser(data.viewingUser),
          readOnly: Boolean(data.readOnly)
        });
      }
      await markNetworkOnline();
    }
    return response;
  } catch {
    await ensureOfflineEpisode('view-switch-network-failure');
    const body = await offlineCopy.json().catch(() => ({}));
    const cachedUsers = await getMeta('viewUsers');
    const context = await getContext();
    const target = cachedUsers?.users?.find(user => user.id === body.userId);
    if (!target || !context.currentUser) {
      return jsonResponse({ error: 'That CRM has not been cached on this device.' }, 503);
    }
    const next = {
      currentUser: context.currentUser,
      viewingUser: minimalUser(target),
      readOnly: target.id !== context.currentUser.id
    };
    const dataset = await getDataset(target.id);
    if (!dataset) return jsonResponse({ error: 'That CRM has not been cached on this device.' }, 503);
    await setMeta('viewContext', next);
    return jsonResponse({ ...next, offline: true }, 200);
  }
}

async function networkFirstCustomers(request) {
  try {
    const response = await fetchWithTimeout(request.clone(), 5000);
    if (isOfflineResponse(response)) throw new OfflineError(`Server returned ${response.status}`);
    if (response.ok) {
      const data = await response.clone().json().catch(() => null);
      if (data?.owner?.id && Array.isArray(data.customers)) {
        await putDataset(data.owner.id, data);
        const context = await getContext();
        await setMeta('viewContext', {
          currentUser: context.currentUser,
          viewingUser: minimalUser(data.owner),
          readOnly: Boolean(data.readOnly)
        });
      }
      await markNetworkOnline();
    }
    return response;
  } catch {
    await ensureOfflineEpisode('customers-network-failure');
    const context = await getContext();
    const ownerId = context.viewingUser?.id || context.currentUser?.id;
    const dataset = ownerId ? await getDataset(ownerId) : null;
    if (!dataset) return jsonResponse({ error: 'No cached CRM data is available on this device.' }, 503);
    return jsonResponse({ ...dataset, offline: true }, 200);
  }
}

async function handleCrmWrite(request) {
  const queuedRequest = request.clone();
  try {
    const response = await fetchWithTimeout(request.clone(), 5000);
    if (isOfflineResponse(response)) throw new OfflineError(`Server returned ${response.status}`);
    if (response.ok) await markNetworkOnline();
    return response;
  } catch {
    await ensureOfflineEpisode('write-network-failure');
    return queueAndApplyCrmWrite(queuedRequest);
  }
}

async function handleBackupRequest(request) {
  try {
    const response = await fetchWithTimeout(request.clone(), 5000);
    if (isOfflineResponse(response)) throw new OfflineError(`Server returned ${response.status}`);
    return response;
  } catch {
    await ensureOfflineEpisode('backup-network-failure');
    const context = await getContext();
    if (context.readOnly) return jsonResponse({ error: 'Read-only: switch back to your CRM before creating a backup.' }, 403);
    const ownerId = context.currentUser?.id;
    const dataset = ownerId ? await getDataset(ownerId) : null;
    if (!dataset) return jsonResponse({ error: 'No cached CRM data is available.' }, 503);
    const body = JSON.stringify({ customers: dataset.customers || [], offlineBackup: true }, null, 2);
    const safeName = String(context.currentUser?.username || 'offline').replace(/[^a-z0-9._-]/gi, '_');
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="customer-inquiry-${safeName}-offline-${new Date().toISOString().slice(0,10)}.json"`
      }
    });
  }
}

async function handleLogout(request) {
  try {
    const response = await fetchWithTimeout(request.clone(), 5000);
    if (response.ok) {
      await setMeta('session', null);
      await setMeta('viewContext', null);
    }
    return response;
  } catch {
    await setMeta('session', null);
    await setMeta('viewContext', null);
    return jsonResponse({ ok: true, offline: true }, 200);
  }
}

async function queueAndApplyCrmWrite(request) {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  const context = await getContext();
  if (!context.currentUser) return jsonResponse({ error: 'Offline session is unavailable.' }, 401);
  if (context.readOnly || context.viewingUser?.id !== context.currentUser.id) {
    return jsonResponse({ error: 'Read-only: switch back to your CRM to make changes.', readOnly: true }, 403);
  }

  const ownerId = context.currentUser.id;
  const dataset = await getDataset(ownerId);
  if (!dataset) return jsonResponse({ error: 'No local CRM copy is available to edit offline.' }, 503);

  let body = {};
  if (method !== 'DELETE') body = await request.clone().json().catch(() => ({}));
  const now = new Date().toISOString();
  const path = url.pathname;
  let responsePayload = { ok: true, offline: true };
  let responseStatus = 200;

  if (path === '/api/customers' && method === 'POST') {
    const id = validClientId(body.id) ? body.id : crypto.randomUUID();
    body.id = id;
    const customer = {
      id,
      company: clean(body.company),
      contact: clean(body.contact),
      phone: clean(body.phone),
      email: clean(body.email),
      quoteOrder: clean(body.quoteOrder),
      status: clean(body.status) || 'New Inquiry',
      nextFollowUp: clean(body.nextFollowUp),
      nextAction: clean(body.nextAction),
      notes: clean(body.notes),
      tags: Array.isArray(body.tags) ? body.tags : [],
      createdAt: now,
      updatedAt: now,
      createdBy: ownerId,
      updatedBy: ownerId,
      interactions: []
    };
    dataset.customers = [customer, ...(dataset.customers || [])];
    responsePayload = customer;
    responseStatus = 201;
  } else {
    const interactionItem = path.match(/^\/api\/customers\/([^/]+)\/interactions\/([^/]+)$/);
    const interactionCollection = path.match(/^\/api\/customers\/([^/]+)\/interactions$/);
    const customerItem = path.match(/^\/api\/customers\/([^/]+)$/);

    if (interactionItem) {
      const [, customerId, interactionId] = interactionItem;
      const customer = (dataset.customers || []).find(item => item.id === customerId);
      if (!customer) return jsonResponse({ error: 'Customer not found in local copy.' }, 404);
      customer.interactions = Array.isArray(customer.interactions) ? customer.interactions : [];
      const index = customer.interactions.findIndex(item => item.id === interactionId);
      if (index < 0) return jsonResponse({ error: 'Interaction not found in local copy.' }, 404);
      if (method === 'PUT') {
        const existing = customer.interactions[index];
        const updated = {
          ...existing,
          type: clean(body.type) || existing.type,
          summary: clean(body.summary),
          happenedAt: clean(body.happenedAt) || existing.happenedAt,
          updatedAt: now,
          updatedBy: ownerId
        };
        customer.interactions[index] = updated;
        responsePayload = updated;
      } else if (method === 'DELETE') {
        customer.interactions.splice(index, 1);
      }
      customer.updatedAt = now;
      customer.updatedBy = ownerId;
    } else if (interactionCollection && method === 'POST') {
      const customerId = interactionCollection[1];
      const customer = (dataset.customers || []).find(item => item.id === customerId);
      if (!customer) return jsonResponse({ error: 'Customer not found in local copy.' }, 404);
      const id = validClientId(body.id) ? body.id : crypto.randomUUID();
      body.id = id;
      const interaction = {
        id,
        type: clean(body.type) || 'Note',
        summary: clean(body.summary),
        happenedAt: clean(body.happenedAt) || now,
        createdAt: now,
        createdBy: ownerId,
        updatedBy: ownerId
      };
      customer.interactions = Array.isArray(customer.interactions) ? customer.interactions : [];
      customer.interactions.unshift(interaction);
      customer.updatedAt = now;
      customer.updatedBy = ownerId;
      responsePayload = customer;
      responseStatus = 201;
    } else if (customerItem) {
      const customerId = customerItem[1];
      const index = (dataset.customers || []).findIndex(item => item.id === customerId);
      if (index < 0) return jsonResponse({ error: 'Customer not found in local copy.' }, 404);
      if (method === 'PUT') {
        const existing = dataset.customers[index];
        const updated = {
          ...existing,
          company: clean(body.company),
          contact: clean(body.contact),
          phone: clean(body.phone),
          email: clean(body.email),
          quoteOrder: clean(body.quoteOrder),
          status: clean(body.status) || existing.status || 'New Inquiry',
          nextFollowUp: clean(body.nextFollowUp),
          nextAction: clean(body.nextAction),
          notes: clean(body.notes),
          tags: Array.isArray(body.tags) ? body.tags : (existing.tags || []),
          updatedAt: now,
          updatedBy: ownerId
        };
        dataset.customers[index] = updated;
        responsePayload = updated;
      } else if (method === 'DELETE') {
        dataset.customers.splice(index, 1);
      }
    } else {
      return jsonResponse({ error: 'This CRM operation is not available offline.' }, 503);
    }
  }

  await putDataset(ownerId, dataset);
  await addQueueItem({
    url: url.pathname + url.search,
    method,
    body: method === 'DELETE' ? null : JSON.stringify(body),
    userId: ownerId,
    createdAt: now
  });
  await registerBackgroundSync();
  await notifyClients({ type: 'CRM_OFFLINE_QUEUED', pending: await countQueue() });

  return jsonResponse(responsePayload, responseStatus, { 'X-CRM-Offline': 'queued' });
}

async function drainQueue() {
  const pending = await getQueueItems();
  if (!pending.length) {
    await markNetworkOnline();
    return { ok: true, pending: 0, synced: 0 };
  }

  let sessionResponse;
  try {
    sessionResponse = await fetchWithTimeout(new Request(new URL('/api/session', self.location.origin), { cache: 'no-store', credentials: 'same-origin' }), 5000);
  } catch (error) {
    await ensureOfflineEpisode('sync-network-failure');
    return { ok: false, offline: true, pending: pending.length, error: error.message };
  }

  if (!sessionResponse.ok) return { ok: false, pending: pending.length, needsLogin: true };
  const session = await sessionResponse.json().catch(() => ({}));
  if (!session.authenticated) return { ok: false, pending: pending.length, needsLogin: true };
  if (session.readOnly) return { ok: false, pending: pending.length, readOnly: true };

  const currentUserId = session.user?.id;
  let synced = 0;
  for (const item of pending) {
    if (item.userId && currentUserId && item.userId !== currentUserId) {
      return { ok: false, pending: pending.length - synced, wrongUser: true, synced };
    }
    const headers = { 'Content-Type': 'application/json', 'X-CRM-Offline-Replay': '1' };
    let response;
    try {
      response = await fetchWithTimeout(new Request(new URL(item.url, self.location.origin), {
        method: item.method,
        headers,
        body: item.body || undefined,
        credentials: 'same-origin'
      }), 7000);
    } catch (error) {
      await ensureOfflineEpisode('sync-network-failure');
      return { ok: false, offline: true, pending: pending.length - synced, synced, error: error.message };
    }

    if (response.status === 401) return { ok: false, needsLogin: true, pending: pending.length - synced, synced };
    if (response.status === 403) return { ok: false, readOnly: true, pending: pending.length - synced, synced };
    if (item.method === 'DELETE' && response.status === 404) {
      await deleteQueueItem(item.id);
      synced += 1;
      continue;
    }
    if (!response.ok) {
      const data = await response.clone().json().catch(() => ({}));
      return {
        ok: false,
        pending: pending.length - synced,
        synced,
        conflict: response.status === 409,
        status: response.status,
        error: data.error || `Sync stopped with ${response.status}`
      };
    }
    await deleteQueueItem(item.id);
    synced += 1;
  }

  try {
    const refresh = await fetchWithTimeout(new Request(new URL('/api/customers', self.location.origin), { cache: 'no-store', credentials: 'same-origin' }), 5000);
    if (refresh.ok) {
      const data = await refresh.clone().json().catch(() => null);
      if (data?.owner?.id && Array.isArray(data.customers)) await putDataset(data.owner.id, data);
    }
  } catch {}

  await markNetworkOnline();
  await notifyClients({ type: 'CRM_SYNC_COMPLETE', synced, pending: 0 });
  return { ok: true, synced, pending: 0 };
}

async function ensureOfflineEpisode(reason, forceBackup = false) {
  const active = Boolean(await getMeta('offlineActive'));
  if (active && !forceBackup) return getLatestBackup();
  const backup = await createEmergencyBackup(reason);
  await setMeta('offlineActive', true);
  await notifyClients({ type: 'CRM_OFFLINE', reason, backup, pending: await countQueue() });
  return backup;
}

async function markNetworkOnline() {
  const active = Boolean(await getMeta('offlineActive'));
  if (active) {
    await setMeta('offlineActive', false);
    await notifyClients({ type: 'CRM_SERVER_REACHABLE', pending: await countQueue() });
  }
}

async function createEmergencyBackup(reason) {
  const [session, viewContext, datasets, queue] = await Promise.all([
    getMeta('session'),
    getMeta('viewContext'),
    getAllDatasets(),
    getQueueItems()
  ]);
  const backup = {
    createdAt: new Date().toISOString(),
    reason,
    session: session?.data || null,
    viewContext: viewContext || null,
    datasets: datasets.map(entry => ({ ownerId: entry.key, data: entry.value })),
    pendingChanges: queue.map(({ id, ...item }) => item)
  };
  const id = await addBackup(backup);
  await trimBackups(20);
  return { id, createdAt: backup.createdAt, reason };
}

async function registerBackgroundSync() {
  try {
    if (self.registration.sync) await self.registration.sync.register('crm-sync');
  } catch {}
}

async function notifyClients(message) {
  const clients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
  for (const client of clients) client.postMessage(message);
}

function minimalUser(user) {
  if (!user) return null;
  return { id: user.id, username: user.username, displayName: user.displayName };
}

function clean(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function validClientId(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function isOfflineResponse(response) {
  return OFFLINE_STATUSES.has(response.status);
}

function jsonResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers }
  });
}

class OfflineError extends Error {}

async function fetchWithTimeout(request, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(request, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('datasets')) db.createObjectStore('datasets', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('queue')) db.createObjectStore('queue', { keyPath: 'id', autoIncrement: true });
      if (!db.objectStoreNames.contains('backups')) db.createObjectStore('backups', { keyPath: 'id', autoIncrement: true });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore(name, mode, operation) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(name, mode);
    const store = tx.objectStore(name);
    let result;
    try { result = operation(store); }
    catch (error) { reject(error); return; }
    tx.oncomplete = () => resolve(result?.result !== undefined ? result.result : result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
  }).finally(() => db.close());
}

async function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function setMeta(key, value) {
  return withStore('meta', 'readwrite', store => store.put({ key, value }));
}

async function getMeta(key) {
  const db = await openDb();
  try {
    const tx = db.transaction('meta', 'readonly');
    const row = await requestResult(tx.objectStore('meta').get(key));
    return row?.value;
  } finally { db.close(); }
}

async function putDataset(ownerId, value) {
  return withStore('datasets', 'readwrite', store => store.put({ key: ownerId, value, updatedAt: Date.now() }));
}

async function getDataset(ownerId) {
  const db = await openDb();
  try {
    const tx = db.transaction('datasets', 'readonly');
    const row = await requestResult(tx.objectStore('datasets').get(ownerId));
    return row?.value || null;
  } finally { db.close(); }
}

async function getAllDatasets() {
  const db = await openDb();
  try {
    const tx = db.transaction('datasets', 'readonly');
    return await requestResult(tx.objectStore('datasets').getAll());
  } finally { db.close(); }
}

async function addQueueItem(item) {
  return withStore('queue', 'readwrite', store => store.add(item));
}

async function getQueueItems() {
  const db = await openDb();
  try {
    const tx = db.transaction('queue', 'readonly');
    const rows = await requestResult(tx.objectStore('queue').getAll());
    return rows.sort((a, b) => a.id - b.id);
  } finally { db.close(); }
}

async function countQueue() {
  const db = await openDb();
  try {
    const tx = db.transaction('queue', 'readonly');
    return await requestResult(tx.objectStore('queue').count());
  } finally { db.close(); }
}

async function deleteQueueItem(id) {
  return withStore('queue', 'readwrite', store => store.delete(id));
}

async function addBackup(backup) {
  const db = await openDb();
  try {
    const tx = db.transaction('backups', 'readwrite');
    return await requestResult(tx.objectStore('backups').add(backup));
  } finally { db.close(); }
}

async function getLatestBackup() {
  const db = await openDb();
  try {
    const tx = db.transaction('backups', 'readonly');
    const store = tx.objectStore('backups');
    return await new Promise((resolve, reject) => {
      const request = store.openCursor(null, 'prev');
      request.onsuccess = () => {
        const cursor = request.result;
        resolve(cursor ? { id: cursor.key, createdAt: cursor.value.createdAt, reason: cursor.value.reason } : null);
      };
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}

async function trimBackups(keep) {
  const db = await openDb();
  try {
    const readTx = db.transaction('backups', 'readonly');
    const keys = await requestResult(readTx.objectStore('backups').getAllKeys());
    const remove = keys.slice(0, Math.max(0, keys.length - keep));
    if (!remove.length) return;
    const writeTx = db.transaction('backups', 'readwrite');
    const store = writeTx.objectStore('backups');
    for (const key of remove) store.delete(key);
    await new Promise((resolve, reject) => {
      writeTx.oncomplete = resolve;
      writeTx.onerror = () => reject(writeTx.error);
      writeTx.onabort = () => reject(writeTx.error);
    });
  } finally { db.close(); }
}

async function getContext() {
  const cached = await getMeta('viewContext');
  if (cached?.currentUser) return cached;
  const session = await getMeta('session');
  const user = session?.data?.user;
  return {
    currentUser: minimalUser(user),
    viewingUser: minimalUser(session?.data?.viewingUser || user),
    readOnly: Boolean(session?.data?.readOnly)
  };
}
