// Build-time patch for interaction type validation in the deployed Node backend.
// Adds Site Visit to both create- and edit-interaction allowlists.

const fs = require('fs');
const file = './server.js';
const marker = "const allowed = ['Call', 'Email', 'Counter Visit', 'Quote', 'Order', 'Vendor', 'Note'];";
const replacement = "const allowed = ['Call', 'Email', 'Counter Visit', 'Site Visit', 'Quote', 'Order', 'Vendor', 'Note'];";

const source = fs.readFileSync(file, 'utf8');
if (source.includes("'Site Visit'")) process.exit(0);

const matches = source.split(marker).length - 1;
if (matches !== 2) {
  throw new Error(`Expected 2 interaction allowlists in server.js, found ${matches}`);
}

fs.writeFileSync(file, source.split(marker).join(replacement));
