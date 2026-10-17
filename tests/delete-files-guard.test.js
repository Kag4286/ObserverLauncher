// v6.0.0 H3: safeServerFolderToDelete is the fail-closed gate before a recursive delete of a server
// folder. These tests prove it refuses dangerous paths and accepts a real server folder.
const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

const userData = path.join(os.tmpdir(), 'ob-h3-userdata');
fs.rmSync(userData, { recursive: true, force: true });
fs.mkdirSync(userData, { recursive: true });
const Module = require('module');
const origLoad = Module._load;
Module._load = function (request) {
  if (request === 'electron') return { app: { getPath: () => userData }, safeStorage: null };
  return origLoad.apply(this, arguments);
};

const { safeServerFolderToDelete } = require('../src/main/settings-handlers.js');

let passed = 0;
function ok(name, cond) { assert(cond, `FAIL: ${name}`); console.log(`PASS ${name}`); passed++; }

// --- refusals ---
ok('empty -> refuse', safeServerFolderToDelete('').ok === false);
ok('null -> refuse', safeServerFolderToDelete(null).ok === false);
ok('drive root -> refuse', safeServerFolderToDelete('C:\\').ok === false);
ok('posix root -> refuse', safeServerFolderToDelete('/').ok === false);
ok('nonexistent -> refuse', safeServerFolderToDelete(path.join(os.tmpdir(), 'ob-h3-nope-' + Date.now())).ok === false);

// --- a real server folder is accepted ---
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-h3-srv-'));
  fs.writeFileSync(path.join(root, 'server.properties'), 'x');
  const r = safeServerFolderToDelete(root);
  ok('server folder (server.properties) -> ok', r.ok === true);
  fs.rmSync(root, { recursive: true, force: true });
}
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-h3-srv-'));
  fs.writeFileSync(path.join(root, 'paper-1.21.jar'), 'x');
  const r = safeServerFolderToDelete(root);
  ok('server folder (jar only) -> ok', r.ok === true);
  fs.rmSync(root, { recursive: true, force: true });
}
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-h3-srv-'));
  fs.mkdirSync(path.join(root, 'world'));
  const r = safeServerFolderToDelete(root);
  ok('server folder (world dir) -> ok', r.ok === true);
  fs.rmSync(root, { recursive: true, force: true });
}

// --- an arbitrary folder with no Minecraft markers is refused ---
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-h3-junk-'));
  fs.writeFileSync(path.join(root, 'notes.txt'), 'x');
  const r = safeServerFolderToDelete(root);
  ok('non-server folder -> refuse (no marker)', r.ok === false);
  fs.rmSync(root, { recursive: true, force: true });
}

// --- a file (not a folder) is refused ---
{
  const f = path.join(userData, 'afile.txt');
  fs.writeFileSync(f, 'x');
  ok('a file path -> refuse', safeServerFolderToDelete(f).ok === false);
}

fs.rmSync(userData, { recursive: true, force: true });
console.log(`\n${passed} passed, 0 failed`);
