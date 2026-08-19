const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3080;
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'crm.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

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
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ customers: [] }, null, 2));
  }
}

function readData() {
  ensureData();
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (!parsed || !Array.isArray(parsed.customers)) return { customers: [] };
    return parsed;
  } catch {
    return { customers: [] };
  }
}

function writeData(data) {
  ensureData();
  const tmp = `${DATA_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
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

function customerFromPayload(body, existing = {}) {
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
    interactions: Array.isArray(existing.interactions) ? existing.interactions : []
  };
}

function interactionFromPayload(body) {
  const allowed = ['Call', 'Email', 'Counter Visit', 'Quote', 'Order', 'Vendor', 'Note'];
  const type = allowed.includes(body.type) ? body.type : 'Note';
  const happenedAt = cleanString(body.happenedAt, 40) || new Date().toISOString();

  return {
    id: crypto.randomUUID(),
    type,
    summary: cleanString(body.summary, 2000),
    happenedAt,
    createdAt: new Date().toISOString()
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
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600'
    });
    fs.createReadStream(fullPath).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  try {
    if (pathname === '/api/customers' && req.method === 'GET') {
      return sendJson(res, 200, readData());
    }

    if (pathname === '/api/customers' && req.method === 'POST') {
      const body = await parseBody(req);
      const customer = customerFromPayload(body);
      if (!customer.company) return sendJson(res, 400, { error: 'Customer / company is required.' });

      const data = readData();
      data.customers.unshift(customer);
      writeData(data);
      return sendJson(res, 201, customer);
    }

    const customerMatch = pathname.match(/^\/api\/customers\/([^/]+)$/);
    if (customerMatch) {
      const id = customerMatch[1];
      const data = readData();
      const index = data.customers.findIndex(c => c.id === id);
      if (index === -1) return sendJson(res, 404, { error: 'Customer not found.' });

      if (req.method === 'PUT') {
        const body = await parseBody(req);
        const updated = customerFromPayload(body, data.customers[index]);
        if (!updated.company) return sendJson(res, 400, { error: 'Customer / company is required.' });
        data.customers[index] = updated;
        writeData(data);
        return sendJson(res, 200, updated);
      }

      if (req.method === 'DELETE') {
        data.customers.splice(index, 1);
        writeData(data);
        return sendJson(res, 200, { ok: true });
      }
    }

    const interactionMatch = pathname.match(/^\/api\/customers\/([^/]+)\/interactions$/);
    if (interactionMatch && req.method === 'POST') {
      const id = interactionMatch[1];
      const body = await parseBody(req);
      const interaction = interactionFromPayload(body);
      if (!interaction.summary) return sendJson(res, 400, { error: 'Interaction summary is required.' });

      const data = readData();
      const customer = data.customers.find(c => c.id === id);
      if (!customer) return sendJson(res, 404, { error: 'Customer not found.' });

      customer.interactions = Array.isArray(customer.interactions) ? customer.interactions : [];
      customer.interactions.unshift(interaction);
      customer.updatedAt = new Date().toISOString();
      writeData(data);
      return sendJson(res, 201, customer);
    }

    if (pathname === '/api/backup' && req.method === 'GET') {
      const data = JSON.stringify(readData(), null, 2);
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="lumber-yard-crm-backup-${new Date().toISOString().slice(0,10)}.json"`,
        'Content-Length': Buffer.byteLength(data)
      });
      return res.end(data);
    }

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
