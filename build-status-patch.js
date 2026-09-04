// Build-time patch for the current Node backend status whitelist.
// Keeps the deployed server behavior unchanged except for adding this workflow status.

const fs = require('fs');
const file = './server.js';
const marker = "  'Ordered',\n  'Waiting on Vendor',";
const replacement = "  'Ordered',\n  'Sent to Purchasing',\n  'Waiting on Vendor',";

const source = fs.readFileSync(file, 'utf8');
if (source.includes("'Sent to Purchasing'")) process.exit(0);
if (!source.includes(marker)) {
  throw new Error('Could not find STATUS_OPTIONS insertion point in server.js');
}
fs.writeFileSync(file, source.replace(marker, replacement));
