// Build-time backend additions required by the offline-first browser layer.
// Adds a health endpoint plus client-generated UUID/idempotency support for queued writes.

const fs = require('fs');
const file = './server.js';
let source = fs.readFileSync(file, 'utf8');

function replaceOnce(marker, replacement, label) {
  if (!source.includes(marker)) throw new Error(`Offline patch failed: ${label}`);
  source = source.replace(marker, replacement);
}

if (!source.includes('function validClientId(value)')) {
  replaceOnce(
    `function validUsername(username) {\n  return /^[a-z0-9._-]{2,50}$/.test(username);\n}\n`,
    `function validUsername(username) {\n  return /^[a-z0-9._-]{2,50}$/.test(username);\n}\n\nfunction validClientId(value) {\n  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));\n}\n`,
    'validClientId insertion point not found'
  );
}

if (!source.includes("id: existing.id || (validClientId(body.id) ? body.id : crypto.randomUUID()),")) {
  replaceOnce(
    `    id: existing.id || crypto.randomUUID(),\n    company: cleanString(body.company, 160),`,
    `    id: existing.id || (validClientId(body.id) ? body.id : crypto.randomUUID()),\n    company: cleanString(body.company, 160),`,
    'customer client-id insertion point not found'
  );
}

if (!source.includes("id: validClientId(body.id) ? body.id : crypto.randomUUID(),\n    type,")) {
  replaceOnce(
    `  return {\n    id: crypto.randomUUID(),\n    type,\n    summary: cleanString(body.summary, 2000),`,
    `  return {\n    id: validClientId(body.id) ? body.id : crypto.randomUUID(),\n    type,\n    summary: cleanString(body.summary, 2000),`,
    'interaction client-id insertion point not found'
  );
}

if (!source.includes("pathname === '/api/health'")) {
  replaceOnce(
    `  try {\n    if (pathname === '/api/session' && req.method === 'GET') {`,
    `  try {\n    if (pathname === '/api/health' && req.method === 'GET') {\n      return sendJson(res, 200, { ok: true, time: new Date().toISOString() });\n    }\n\n    if (pathname === '/api/session' && req.method === 'GET') {`,
    'health endpoint insertion point not found'
  );
}

if (!source.includes('const duplicateCustomer = data.customers.find(c => c.id === customer.id);')) {
  replaceOnce(
    `      const data = readCustomerData(user.id);\n      data.customers.unshift(customer);\n      writeCustomerData(user.id, data);\n      return sendJson(res, 201, customer);`,
    `      const data = readCustomerData(user.id);\n      const duplicateCustomer = data.customers.find(c => c.id === customer.id);\n      if (duplicateCustomer) return sendJson(res, 200, duplicateCustomer);\n      data.customers.unshift(customer);\n      writeCustomerData(user.id, data);\n      return sendJson(res, 201, customer);`,
    'customer idempotency insertion point not found'
  );
}

if (!source.includes('const duplicateInteraction = customer.interactions.find(i => i.id === interaction.id);')) {
  replaceOnce(
    `      customer.interactions = Array.isArray(customer.interactions) ? customer.interactions : [];\n      customer.interactions.unshift(interaction);\n      customer.updatedAt = new Date().toISOString();`,
    `      customer.interactions = Array.isArray(customer.interactions) ? customer.interactions : [];\n      const duplicateInteraction = customer.interactions.find(i => i.id === interaction.id);\n      if (duplicateInteraction) return sendJson(res, 200, customer);\n      customer.interactions.unshift(interaction);\n      customer.updatedAt = new Date().toISOString();`,
    'interaction idempotency insertion point not found'
  );
}

fs.writeFileSync(file, source);
