// Build-time patch that adds automatic full-CRM nightly backups.
// Backups are stored inside /app/data/backups, which is already on the persistent host volume.

const fs = require('fs');

const file = './server.js';
const source = fs.readFileSync(file, 'utf8');

if (source.includes('function scheduleAutomaticBackups()')) process.exit(0);

const insertMarker = 'const server = http.createServer(async (req, res) => {';
const startupMarker = '  ensureData();\n  console.log(`Lumber Yard Mini CRM listening on port ${PORT}`);';

if (!source.includes(insertMarker)) {
  throw new Error('Could not find server insertion point for automatic backups.');
}
if (!source.includes(startupMarker)) {
  throw new Error('Could not find server startup hook for automatic backups.');
}

const backupCode = `
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const BACKUP_TIME_ZONE = 'America/New_York';
const BACKUP_RETENTION_DAYS = 30;
const BACKUP_HOUR = 23;
const BACKUP_MINUTE = 55;

function crmLocalDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BACKUP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);

  const values = {};
  for (const part of parts) {
    if (part.type !== 'literal') values[part.type] = part.value;
  }

  return {
    dateKey: values.year + '-' + values.month + '-' + values.day,
    hour: Number(values.hour),
    minute: Number(values.minute)
  };
}

function previousDateKey(dateKey) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day) - 86400000).toISOString().slice(0, 10);
}

function readArchivedCustomerData() {
  const archives = {};
  if (!fs.existsSync(ARCHIVE_DIR)) return archives;

  for (const name of fs.readdirSync(ARCHIVE_DIR)) {
    if (!name.toLowerCase().endsWith('.json')) continue;
    const fullPath = path.join(ARCHIVE_DIR, name);
    try {
      if (!fs.statSync(fullPath).isFile()) continue;
      archives[name] = readJson(fullPath, { customers: [] });
    } catch (err) {
      console.error('Could not include archived CRM file in backup:', name, err);
    }
  }
  return archives;
}

function pruneAutomaticBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return;
  const cutoff = Date.now() - (BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000);

  for (const name of fs.readdirSync(BACKUP_DIR)) {
    if (!/^crm-full-.*\\.json$/.test(name)) continue;
    const fullPath = path.join(BACKUP_DIR, name);
    try {
      const stat = fs.statSync(fullPath);
      if (stat.isFile() && stat.mtimeMs < cutoff) fs.unlinkSync(fullPath);
    } catch (err) {
      console.error('Could not prune old CRM backup:', name, err);
    }
  }
}

function createFullCrmBackup(dateKey, suffix = '') {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });

  const filename = 'crm-full-' + dateKey + (suffix ? '-' + suffix : '') + '.json';
  const target = path.join(BACKUP_DIR, filename);
  if (fs.existsSync(target)) return false;

  const usersData = readUsers();
  const accounts = {};
  for (const user of usersData.users) {
    accounts[user.id] = readJson(userDataFile(user.id), { customers: [] });
  }

  const payload = {
    version: 1,
    createdAt: new Date().toISOString(),
    timezone: BACKUP_TIME_ZONE,
    users: usersData,
    accounts,
    archives: readArchivedCustomerData()
  };

  writeJson(target, payload);
  pruneAutomaticBackups();
  console.log('CRM automatic backup created:', target);
  return true;
}

function scheduleAutomaticBackups() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });

  const now = crmLocalDateParts();
  const previousKey = previousDateKey(now.dateKey);
  const previousNightly = path.join(BACKUP_DIR, 'crm-full-' + previousKey + '.json');

  // If the app was offline during the prior nightly window, make a recovery
  // snapshot on startup rather than waiting until the next night.
  if (!fs.existsSync(previousNightly)) {
    createFullCrmBackup(now.dateKey, 'startup');
  }

  const tick = () => {
    try {
      const local = crmLocalDateParts();
      if (local.hour === BACKUP_HOUR && local.minute >= BACKUP_MINUTE) {
        createFullCrmBackup(local.dateKey);
      }
    } catch (err) {
      console.error('Automatic CRM backup failed:', err);
    }
  };

  tick();
  const timer = setInterval(tick, 60 * 1000);
  if (typeof timer.unref === 'function') timer.unref();

  console.log('CRM automatic backups enabled: 11:55 PM America/New_York, 30-day retention');
}

`;

let updated = source.replace(insertMarker, backupCode + insertMarker);
updated = updated.replace(startupMarker, '  ensureData();\n  scheduleAutomaticBackups();\n  console.log(`Lumber Yard Mini CRM listening on port ${PORT}`);');

fs.writeFileSync(file, updated);
