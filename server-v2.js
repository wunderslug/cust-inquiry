const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3080;
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const ACCOUNTS_DIR = path.join(DATA_DIR, 'accounts');
const ARCHIVE_DIR = path.join(DATA_DIR, 'archive');
const LEGACY_DATA_FILE = path.join(DATA_DIR, 'crm.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const sessions = new Map();

const STATUS_OPTIONS = [
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

function ensureData() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(ACCOUNTS_DIR, { recursive: true });
  fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
  if (!fs.existsSync(USERS_FILE)) {
    fs.writeFileSync(USERS_FILE, JSON.stringify({ users: [] }, null, 2));
  }
}

function readJson(file, fallback) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

function readUsers() {
  ensureData();
  const data = readJson(USERS_FILE, { users: [] });
  return { users: Array.isArray(data.users) ? data.users : [] };
}

function writeUsers(data) {
  writeJson(USERS_FILE, data);
}

function userDataFile(userId) {
  return path.join(ACCOUNTS_DIR, `${userId}.json`);
}

function readCustomerData(userId) {
  const file = userDataFile(userId);
  if (!fs.existsSync(file)) writeJson(file, { customers: [] });
  const data = readJson(file, { customers: [] });
  return { customers: Array.isArray(data.customers) ? data.customers : [] };
}

function writeCustomerData(userId, data) {
  writeJson(userDataFile(userId), data);
}

function migrateLegacyDataToUser(userId) {
  const target = userDataFile(userId);
  if (fs.existsSync(target)) return;
  if (fs.existsSync(LEGACY_DATA_FILE)) {
    const legacy = readJson(LEGACY_DATA_FILE, { customers: [] });
    if (legacy && Array.isArray(legacy.customers)) {
      writeJson(target, legacy);
      return;
    }
  }
  writeJson(target, { customers: [] });
}

function sendJson(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...extraHeaders
  });
  res.end(body);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error('Request too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try { resolve(JSON.parse(body)); }
      catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function cleanString(value, max = 5000) {
  if (value === null || value === undefined) return '';
  return String(value).trim().slice(0, max);
}

function normalizeUsername(value) {
  return cleanString(value, 50).toLowerCase();
}

function validUsername(username) {
  return /^[a-z0-9._-]{2,50}$/.test(username);
}

function scryptAsync(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (err, key) => err ? reject(err) : resolve(key));
  });
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const key = await scryptAsync(password, salt);
  return `${salt}:${key.toString('hex')}`;
}

async function verifyPassword(password, stored) {
  const [salt, hex] = String(stored || '').split(':');
  if (!salt || !hex) return false;
  try {
    const expected = Buffer.from(hex, 'hex');
    const actual = await scryptAsync(password, salt);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function parseCookies(req) {
  const out = {};
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

function isSecureRequest(req) {
  return req.socket.encrypted || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
}

function sessionCookie(req, token, maxAgeSeconds) {
  const secure = isSecureRequest(req) ? '; Secure' : '';
  return `crm_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}

function createSession(req, res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, {
    userId,
    viewUserId: userId,
    expiresAt: Date.now() + SESSION_TTL_MS
  });
  res.setHeader('Set-Cookie', sessionCookie(req, token, Math.floor(SESSION_TTL_MS / 1000)));
  return token;
}

function destroySession(req, res) {
  const token = parseCookies(req).crm_session;
  if (token) sessions.delete(token);
  res.setHeader('Set-Cookie', sessionCookie(req, '', 0));
}

function getSessionRecord(req) {
  const token = parseCookies(req).crm_session;
  if (!token) return null;
  const session = sessions.get(token);
  if (!session || session.expiresAt < Date.now()) {
    sessions.delete(token);
    return null;
  }
  const users = readUsers().users;
  const user = users.find(u => u.id === session.userId && u.active !== false);
  if (!user) {
    sessions.delete(token);
    return null;
  }
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  if (!session.viewUserId) session.viewUserId = user.id;
  return { token, session, user, users };
}

function getSessionUser(req) {
  return getSessionRecord(req)?.user || null;
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    active: user.active !== false,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  };
}

function viewableUser(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName
  };
}

function requireUser(req, res) {
  const user = getSessionUser(req);
  if (!user) {
    sendJson(res, 401, { error: 'Please sign in.' });
    return null;
  }
  return user;
}

function requireAdmin(req, res) {
  const user = requireUser(req, res);
  if (!user) return null;
  if (user.role !== 'admin') {
    sendJson(res, 403, { error: 'Administrator access required.' });
    return null;
  }
  return user;
}

function activeAdminCount(users) {
  return users.filter(u => u.role === 'admin' && u.active !== false).length;
}

function getViewContext(req, user) {
  const token = parseCookies(req).crm_session;
  const session = token ? sessions.get(token) : null;
  const users = readUsers().users;
  let viewingUser = users.find(u => u.id === session?.viewUserId && u.active !== false);
  if (!viewingUser) {
    viewingUser = user;
    if (session) session.viewUserId = user.id;
  }
  return {
    session,
    viewingUser,
    readOnly: viewingUser.id !== user.id
  };
}

function requireWritableCrm(req, res, user) {
  const context = getViewContext(req, user);
  if (!context.readOnly) return context;
  sendJson(res, 403, {
    error: `Read-only: you are viewing ${context.viewingUser.displayName || context.viewingUser.username}'s CRM. Switch back to your CRM to make changes.`,
    readOnly: true,
    viewingUser: viewableUser(context.viewingUser)
  });
  return null;
}

function customerFromPayload(body, existing = {}, actor) {
  const now = new Date().toISOString();
  const status = STATUS_OPTIONS.includes(body.status) ? body.status : (existing.status || 'New Inquiry');
  return {
    ...existing,
    id: existing.id || crypto.randomUUID(),
    company: cleanString(body.company, 160),
    contact: cleanString(body.contact, 160),
    phone: cleanString(body.phone, 80),
    email: cleanString(body.email, 200),
    quoteOrder: cleanString(body.quoteOrder, 120),
    status,
    nextFollowUp: cleanString(body.nextFollowUp, 30),
    nextAction: cleanString(body.nextAction, 500),
    notes: cleanString(body.notes, 5000),
    tags: Array.isArray(body.tags)
      ? body.tags.map(v => cleanString(v, 50)).filter(Boolean).slice(0, 12)
      : (existing.tags || []),
    createdAt: existing.createdAt || now,
    updatedAt: now,
    createdBy: existing.createdBy || actor.id,
    updatedBy: actor.id,
    interactions: Array.isArray(existing.interactions) ? existing.interactions : []
  };
}

function interactionFromPayload(body, actor) {
  const allowed = ['Call', 'Email', 'Counter Visit', 'Quote', 'Order', 'Vendor', 'Note'];
  const type = allowed.includes(body.type) ? body.type : 'Note';
  const happenedAt = cleanString(body.happenedAt, 40) || new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    type,
    summary: cleanString(body.summary, 2000),
    happenedAt,
    createdAt: new Date().toISOString(),
    createdBy: actor.id,
    updatedBy: actor.id
  };
}

function updateInteractionFromPayload(body, existing, actor) {
  const allowed = ['Call', 'Email', 'Counter Visit', 'Quote', 'Order', 'Vendor', 'Note'];
  const type = allowed.includes(body.type) ? body.type : existing.type;
  return {
    ...existing,
    type,
    summary: cleanString(body.summary, 2000),
    happenedAt: cleanString(body.happenedAt, 40) || existing.happenedAt,
    updatedAt: new Date().toISOString(),
    updatedBy: actor.id
  };
}

function serveStatic(req, res) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);
  } catch {
    res.writeHead(400);
    return res.end('Bad Request');
  }
  if (pathname === '/') pathname = '/index.html';
  const safePath = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  const fullPath = path.join(PUBLIC_DIR, safePath);
  if (!fullPath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.stat(fullPath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404);
      return res.end('Not Found');
    }
    const ext = path.extname(fullPath).toLowerCase();
    const contentTypes = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg'
    };
    res.writeHead(200, {
      'Content-Type': contentTypes[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300'
    });
    fs.createReadStream(fullPath).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  try {
    if (pathname === '/api/session' && req.method === 'GET') {
      const users = readUsers().users;
      const user = getSessionUser(req);
      const context = user ? getViewContext(req, user) : null;
      return sendJson(res, 200, {
        authenticated: Boolean(user),
        setupRequired: users.length === 0,
        user: user ? publicUser(user) : null,
        viewingUser: context ? viewableUser(context.viewingUser) : null,
        readOnly: context ? context.readOnly : false
      });
    }

    if (pathname === '/api/setup' && req.method === 'POST') {
      const data = readUsers();
      if (data.users.length) return sendJson(res, 409, { error: 'Setup is already complete.' });
      const body = await parseBody(req);
      const username = normalizeUsername(body.username);
      const displayName = cleanString(body.displayName, 80) || username;
      const password = String(body.password || '');
      if (!validUsername(username)) return sendJson(res, 400, { error: 'Username must be 2–50 characters using letters, numbers, dot, dash, or underscore.' });
      if (password.length < 8) return sendJson(res, 400, { error: 'Password must be at least 8 characters.' });
      const now = new Date().toISOString();
      const user = {
        id: crypto.randomUUID(),
        username,
        displayName,
        role: 'admin',
        active: true,
        passwordHash: await hashPassword(password),
        createdAt: now,
        updatedAt: now
      };
      data.users.push(user);
      writeUsers(data);
      migrateLegacyDataToUser(user.id);
      createSession(req, res, user.id);
      return sendJson(res, 201, { user: publicUser(user), migratedLegacyData: fs.existsSync(LEGACY_DATA_FILE) });
    }

    if (pathname === '/api/login' && req.method === 'POST') {
      const body = await parseBody(req);
      const username = normalizeUsername(body.username);
      const password = String(body.password || '');
      const user = readUsers().users.find(u => u.username === username && u.active !== false);
      if (!user || !(await verifyPassword(password, user.passwordHash))) {
        return sendJson(res, 401, { error: 'Invalid username or password.' });
      }
      createSession(req, res, user.id);
      return sendJson(res, 200, { user: publicUser(user) });
    }

    if (pathname === '/api/logout' && req.method === 'POST') {
      destroySession(req, res);
      return sendJson(res, 200, { ok: true });
    }

    if (pathname === '/api/view-users' && req.method === 'GET') {
      const user = requireUser(req, res);
      if (!user) return;
      const users = readUsers().users
        .filter(u => u.active !== false)
        .map(viewableUser)
        .sort((a, b) => (a.displayName || a.username).localeCompare(b.displayName || b.username));
      const context = getViewContext(req, user);
      return sendJson(res, 200, {
        users,
        currentUser: viewableUser(user),
        viewingUser: viewableUser(context.viewingUser),
        readOnly: context.readOnly
      });
    }

    if (pathname === '/api/view-user' && req.method === 'POST') {
      const user = requireUser(req, res);
      if (!user) return;
      const body = await parseBody(req);
      const targetId = cleanString(body.userId, 100);
      const target = readUsers().users.find(u => u.id === targetId && u.active !== false);
      if (!target) return sendJson(res, 404, { error: 'That user is not available.' });
      const token = parseCookies(req).crm_session;
      const session = token ? sessions.get(token) : null;
      if (!session) return sendJson(res, 401, { error: 'Please sign in.' });
      session.viewUserId = target.id;
      return sendJson(res, 200, {
        currentUser: viewableUser(user),
        viewingUser: viewableUser(target),
        readOnly: target.id !== user.id
      });
    }

    if (pathname === '/api/users' && req.method === 'GET') {
      const admin = requireAdmin(req, res);
      if (!admin) return;
      return sendJson(res, 200, { users: readUsers().users.map(publicUser) });
    }

    if (pathname === '/api/users' && req.method === 'POST') {
      const admin = requireAdmin(req, res);
      if (!admin) return;
      const body = await parseBody(req);
      const username = normalizeUsername(body.username);
      const displayName = cleanString(body.displayName, 80) || username;
      const password = String(body.password || '');
      const role = body.role === 'admin' ? 'admin' : 'user';
      const data = readUsers();
      if (!validUsername(username)) return sendJson(res, 400, { error: 'Username must be 2–50 characters using letters, numbers, dot, dash, or underscore.' });
      if (password.length < 8) return sendJson(res, 400, { error: 'Password must be at least 8 characters.' });
      if (data.users.some(u => u.username === username)) return sendJson(res, 409, { error: 'That username already exists.' });
      const now = new Date().toISOString();
      const user = {
        id: crypto.randomUUID(),
        username,
        displayName,
        role,
        active: true,
        passwordHash: await hashPassword(password),
        createdAt: now,
        updatedAt: now
      };
      data.users.push(user);
      writeUsers(data);
      writeCustomerData(user.id, { customers: [] });
      return sendJson(res, 201, { user: publicUser(user) });
    }

    const userMatch = pathname.match(/^\/api\/users\/([^/]+)$/);
    if (userMatch) {
      const admin = requireAdmin(req, res);
      if (!admin) return;
      const userId = userMatch[1];
      const data = readUsers();
      const index = data.users.findIndex(u => u.id === userId);
      if (index === -1) return sendJson(res, 404, { error: 'User not found.' });
      const target = data.users[index];

      if (req.method === 'PUT') {
        const body = await parseBody(req);
        const nextRole = body.role === 'admin' ? 'admin' : (body.role === 'user' ? 'user' : target.role);
        const nextActive = typeof body.active === 'boolean' ? body.active : target.active !== false;
        const removingLastAdmin = target.role === 'admin' && target.active !== false &&
          (nextRole !== 'admin' || !nextActive) && activeAdminCount(data.users) <= 1;
        if (removingLastAdmin) return sendJson(res, 400, { error: 'You must keep at least one active administrator.' });
        if (target.id === admin.id && !nextActive) return sendJson(res, 400, { error: 'You cannot disable the account you are currently using.' });
        const displayName = body.displayName !== undefined ? cleanString(body.displayName, 80) : target.displayName;
        const username = body.username !== undefined ? normalizeUsername(body.username) : target.username;
        if (!validUsername(username)) return sendJson(res, 400, { error: 'Invalid username.' });
        if (data.users.some((u, i) => i !== index && u.username === username)) return sendJson(res, 409, { error: 'That username already exists.' });
        target.displayName = displayName || username;
        target.username = username;
        target.role = nextRole;
        target.active = nextActive;
        if (body.password !== undefined && String(body.password).length) {
          if (String(body.password).length < 8) return sendJson(res, 400, { error: 'Password must be at least 8 characters.' });
          target.passwordHash = await hashPassword(String(body.password));
        }
        target.updatedAt = new Date().toISOString();
        writeUsers(data);
        return sendJson(res, 200, { user: publicUser(target) });
      }

      if (req.method === 'DELETE') {
        if (target.id === admin.id) return sendJson(res, 400, { error: 'You cannot delete the account you are currently using.' });
        if (target.role === 'admin' && target.active !== false && activeAdminCount(data.users) <= 1) {
          return sendJson(res, 400, { error: 'You must keep at least one active administrator.' });
        }
        const source = userDataFile(target.id);
        if (fs.existsSync(source)) {
          const stamp = new Date().toISOString().replace(/[:.]/g, '-');
          fs.renameSync(source, path.join(ARCHIVE_DIR, `${target.username}-${target.id}-${stamp}.json`));
        }
        data.users.splice(index, 1);
        writeUsers(data);
        for (const [token, session] of sessions) {
          if (session.userId === target.id) sessions.delete(token);
          else if (session.viewUserId === target.id) session.viewUserId = session.userId;
        }
        return sendJson(res, 200, { ok: true, archived: true });
      }
    }

    let user = null;
    if (pathname.startsWith('/api/')) {
      user = requireUser(req, res);
      if (!user) return;
    }

    const context = user ? getViewContext(req, user) : null;

    if (pathname === '/api/customers' && req.method === 'GET') {
      const data = readCustomerData(context.viewingUser.id);
      return sendJson(res, 200, {
        ...data,
        owner: viewableUser(context.viewingUser),
        readOnly: context.readOnly
      });
    }

    if (pathname === '/api/customers' && req.method === 'POST') {
      if (!requireWritableCrm(req, res, user)) return;
      const body = await parseBody(req);
      const customer = customerFromPayload(body, {}, user);
      if (!customer.company) return sendJson(res, 400, { error: 'Customer / company is required.' });
      const data = readCustomerData(user.id);
      data.customers.unshift(customer);
      writeCustomerData(user.id, data);
      return sendJson(res, 201, customer);
    }

    const customerMatch = pathname.match(/^\/api\/customers\/([^/]+)$/);
    if (customerMatch) {
      if (!requireWritableCrm(req, res, user)) return;
      const id = customerMatch[1];
      const data = readCustomerData(user.id);
      const index = data.customers.findIndex(c => c.id === id);
      if (index === -1) return sendJson(res, 404, { error: 'Customer not found.' });
      if (req.method === 'PUT') {
        const body = await parseBody(req);
        const updated = customerFromPayload(body, data.customers[index], user);
        if (!updated.company) return sendJson(res, 400, { error: 'Customer / company is required.' });
        data.customers[index] = updated;
        writeCustomerData(user.id, data);
        return sendJson(res, 200, updated);
      }
      if (req.method === 'DELETE') {
        data.customers.splice(index, 1);
        writeCustomerData(user.id, data);
        return sendJson(res, 200, { ok: true });
      }
    }

    const interactionItemMatch = pathname.match(/^\/api\/customers\/([^/]+)\/interactions\/([^/]+)$/);
    if (interactionItemMatch) {
      if (!requireWritableCrm(req, res, user)) return;
      const customerId = interactionItemMatch[1];
      const interactionId = interactionItemMatch[2];
      const data = readCustomerData(user.id);
      const customer = data.customers.find(c => c.id === customerId);
      if (!customer) return sendJson(res, 404, { error: 'Customer not found.' });
      customer.interactions = Array.isArray(customer.interactions) ? customer.interactions : [];
      const index = customer.interactions.findIndex(i => i.id === interactionId);
      if (index === -1) return sendJson(res, 404, { error: 'Interaction not found.' });
      if (req.method === 'PUT') {
        const body = await parseBody(req);
        const updated = updateInteractionFromPayload(body, customer.interactions[index], user);
        if (!updated.summary) return sendJson(res, 400, { error: 'Interaction summary is required.' });
        customer.interactions[index] = updated;
        customer.updatedAt = new Date().toISOString();
        customer.updatedBy = user.id;
        writeCustomerData(user.id, data);
        return sendJson(res, 200, updated);
      }
      if (req.method === 'DELETE') {
        customer.interactions.splice(index, 1);
        customer.updatedAt = new Date().toISOString();
        customer.updatedBy = user.id;
        writeCustomerData(user.id, data);
        return sendJson(res, 200, { ok: true });
      }
    }

    const interactionMatch = pathname.match(/^\/api\/customers\/([^/]+)\/interactions$/);
    if (interactionMatch && req.method === 'POST') {
      if (!requireWritableCrm(req, res, user)) return;
      const id = interactionMatch[1];
      const body = await parseBody(req);
      const interaction = interactionFromPayload(body, user);
      if (!interaction.summary) return sendJson(res, 400, { error: 'Interaction summary is required.' });
      const data = readCustomerData(user.id);
      const customer = data.customers.find(c => c.id === id);
      if (!customer) return sendJson(res, 404, { error: 'Customer not found.' });
      customer.interactions = Array.isArray(customer.interactions) ? customer.interactions : [];
      customer.interactions.unshift(interaction);
      customer.updatedAt = new Date().toISOString();
      customer.updatedBy = user.id;
      writeCustomerData(user.id, data);
      return sendJson(res, 201, customer);
    }

    if (pathname === '/api/backup' && req.method === 'GET') {
      if (context.readOnly) {
        return sendJson(res, 403, {
          error: 'Read-only: switch back to your CRM before creating a backup.',
          readOnly: true
        });
      }
      const data = JSON.stringify(readCustomerData(user.id), null, 2);
      const safeName = user.username.replace(/[^a-z0-9._-]/gi, '_');
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="customer-inquiry-${safeName}-${new Date().toISOString().slice(0,10)}.json"`,
        'Content-Length': Buffer.byteLength(data)
      });
      return res.end(data);
    }

    if (pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'Not found.' });
    return serveStatic(req, res);
  } catch (err) {
    console.error(err);
    return sendJson(res, 500, { error: 'Server error.' });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  ensureData();
  console.log(`Lumber Yard Mini CRM listening on port ${PORT}`);
});
