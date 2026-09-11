// Build-time patch for the Site Visit interaction type.
// Updates both backend validation and the interaction dropdown, and fails loudly
// if the expected source markers ever change.

const fs = require('fs');

const serverFile = './server.js';
const serverMarker = "const allowed = ['Call', 'Email', 'Counter Visit', 'Quote', 'Order', 'Vendor', 'Note'];";
const serverReplacement = "const allowed = ['Call', 'Email', 'Counter Visit', 'Site Visit', 'Quote', 'Order', 'Vendor', 'Note'];";

let serverSource = fs.readFileSync(serverFile, 'utf8');
if (!serverSource.includes("'Site Visit'")) {
  const matches = serverSource.split(serverMarker).length - 1;
  if (matches !== 2) {
    throw new Error(`Expected 2 interaction allowlists in server.js, found ${matches}`);
  }
  serverSource = serverSource.split(serverMarker).join(serverReplacement);
  fs.writeFileSync(serverFile, serverSource);
}

const indexFile = './public/index.html';
const indexMarker = '              <option>Counter Visit</option>\n              <option>Quote</option>';
const indexReplacement = '              <option>Counter Visit</option>\n              <option>Site Visit</option>\n              <option>Quote</option>';

let indexSource = fs.readFileSync(indexFile, 'utf8');
if (!indexSource.includes('<option>Site Visit</option>')) {
  const matches = indexSource.split(indexMarker).length - 1;
  if (matches !== 1) {
    throw new Error(`Expected 1 interaction dropdown insertion point in public/index.html, found ${matches}`);
  }
  indexSource = indexSource.replace(indexMarker, indexReplacement);
  fs.writeFileSync(indexFile, indexSource);
}
