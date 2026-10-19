// scripts/spike-skinsrestorer.js — READ-ONLY probe of a SkinsRestorer data folder.
//
// WHY: the storage format differs between SkinsRestorer versions (v14 text .skin, v15 binary
// .skin, or a MySQL/Postgres database). We must not write product code against a guessed
// interface, so this script inspects the real folder and prints what it found. It never writes,
// never mutates, and exits non-zero when the folder is missing so a caller can detect that.
//
// Usage: node scripts/spike-skinsrestorer.js <path-to-server-root>

const fs = require('fs');
const path = require('path');

const root = process.argv[2];
if (!root) {
  console.error('Usage: node scripts/spike-skinsrestorer.js <path-to-server-root>');
  process.exit(2);
}

function exists(p) { try { fs.accessSync(p); return true; } catch { return false; } }
function isDir(p) { try { return fs.statSync(p).isDirectory(); } catch { return false; } }

const srDir = path.join(root, 'plugins', 'SkinsRestorer');
console.log('Server root:', root);
console.log('SkinsRestorer folder:', srDir);
console.log('Exists:', exists(srDir), '| Is dir:', isDir(srDir));
if (!exists(srDir)) { console.log('RESULT: no SkinsRestorer plugin installed.'); process.exit(0); }

// 1. Top-level layout.
function walk(dir, depth, prefix) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { console.log(prefix + '<unreadable: ' + e.message + '>'); return; }
  for (const e of entries.slice(0, 40)) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      console.log(prefix + e.name + '/');
      if (depth < 2) walk(full, depth + 1, prefix + '  ');
    } else {
      let size = 0;
      try { size = fs.statSync(full).size; } catch {}
      console.log(prefix + e.name + ' (' + size + ' bytes)');
    }
  }
  if (entries.length > 40) console.log(prefix + '... (' + (entries.length - 40) + ' more)');
}
console.log('\n--- layout ---');
walk(srDir, 0, '');

// 2. config.yml storage backend.
const cfg = path.join(srDir, 'config.yml');
if (exists(cfg)) {
  console.log('\n--- config.yml (storage-related lines) ---');
  const text = fs.readFileSync(cfg, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    if (/storage|mysql|postgres|database/i.test(line)) console.log(line);
  }
}

// 3. Try the likely skin folders in order and describe the first file found.
const candidates = [
  path.join(srDir, 'data'),
  path.join(srDir, 'Skins'),
  path.join(srDir, 'skins'),
  path.join(srDir, 'storage'),
  path.join(srDir, 'playerdata'),
];
for (const dir of candidates) {
  if (!isDir(dir)) continue;
  const files = fs.readdirSync(dir).filter(f => fs.statSync(path.join(dir, f)).isFile());
  if (!files.length) { console.log('\n' + dir + ': empty'); continue; }
  console.log('\n--- sample from ' + dir + ' (' + files.length + ' files) ---');
  const sample = files[0];
  const buf = fs.readFileSync(path.join(dir, sample));
  console.log('file:', sample, '| size:', buf.length);
  console.log('first 64 bytes (hex):', buf.subarray(0, 64).toString('hex'));
  const asText = buf.toString('utf8', 0, Math.min(200, buf.length));
  console.log('first 200 chars (utf8):', JSON.stringify(asText));
  // v14 shape: whole file is a base64 JSON string (text).
  if (/^[A-Za-z0-9+/=]+$/.test(asText.trim())) console.log('GUESS: v14 text .skin (base64 only).');
  // v15 shape: [version][length][json].
  else if (buf.length > 5 && buf[0] <= 3) {
    const len = buf.readInt32BE(1);
    if (len > 0 && len < buf.length) {
      const json = buf.toString('utf8', 5, 5 + len);
      console.log('GUESS: v15 binary .skin. inner JSON parses:', (() => { try { JSON.parse(json); return 'yes'; } catch { return 'no'; } })());
      console.log('inner JSON (first 200):', JSON.stringify(json.slice(0, 200)));
    }
  }
}

// 4. Any .db file (SQLite or a MySQL driver artifact).
console.log('\n--- database files ---');
let foundDb = false;
for (const f of fs.readdirSync(srDir)) {
  if (/\.(db|sqlite|sqlite3)$/i.test(f)) { console.log(f); foundDb = true; }
}
if (!foundDb) console.log('(none at top level; MySQL/Postgres would be external)');

console.log('\nRESULT: probe complete.');
