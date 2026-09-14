// Build-time patch for additional workflow statuses in the deployed Node backend.
// Keeps the deployed server behavior unchanged except for extending STATUS_OPTIONS.

const fs = require('fs');
const file = './server.js';
let source = fs.readFileSync(file, 'utf8');

function insertStatus(status, marker, replacement) {
  if (source.includes(`'${status}'`)) return;
  if (!source.includes(marker)) {
    throw new Error(`Could not find STATUS_OPTIONS insertion point for ${status} in server.js`);
  }
  source = source.replace(marker, replacement);
}

insertStatus(
  'Sent to Purchasing',
  "  'Ordered',\n  'Waiting on Vendor',",
  "  'Ordered',\n  'Sent to Purchasing',\n  'Waiting on Vendor',"
);

insertStatus(
  'Sent to Install Team',
  "  'Sent to Purchasing',\n  'Waiting on Vendor',",
  "  'Sent to Purchasing',\n  'Sent to Install Team',\n  'Waiting on Vendor',"
);

insertStatus(
  'Scheduled for Delivery',
  "  'Ready',\n  'Complete',",
  "  'Ready',\n  'Scheduled for Delivery',\n  'Complete',"
);

fs.writeFileSync(file, source);
