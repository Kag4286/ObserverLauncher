// 5.4.0: instance folder missing flag + relink. listInstances marks `missing` when the folder no
// longer exists (deleted, or an unmounted drive); relinkInstance points it at a new folder and
// refuses a folder already owned by another instance. Uses a real temp folder so existsSync is real.
const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

const userData = path.join(os.tmpdir(), 'ob-instance-missing-userdata');
fs.rmSync(userData, { recursive: true, force: true });
fs.mkdirSync(userData, { recursive: true });
const Module = require('module');
const origLoad = Module._load;
Module._load = function (request) {
  if (request === 'electron') return { app: { getPath: () => userData } };
  return origLoad.apply(this, arguments);
};

const S = require('../src/main/settings.js');

let passed = 0;
function ok(name, cond) { assert(cond, `FAIL: ${name}`); console.log(`PASS ${name}`); passed++; }

// A real folder on disk, and one that does NOT exist.
const realA = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-realA-'));
const realB = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-realB-'));
const gone = path.join(os.tmpdir(), 'ob-does-not-exist-' + Date.now());

try {
  const a = S.addInstance({ name: 'A', serverPath: realA });
  ok('add A ok', a.ok === true);
  let list = S.listInstances();
  ok('existing folder -> missing false', list.instances[0].missing === false);

  // Point A at a folder that does not exist -> missing true (set directly via the store).
  S.relinkInstance(a.id, gone);
  list = S.listInstances();
  ok('gone folder -> missing true', list.instances.find(i => i.id === a.id).missing === true);

  // Relink back to a real folder -> missing false again.
  const r = S.relinkInstance(a.id, realB);
  ok('relink ok', r.ok === true);
  list = S.listInstances();
  ok('relinked -> missing false', list.instances.find(i => i.id === a.id).missing === false);
  ok('relinked -> serverPath updated', list.instances.find(i => i.id === a.id).serverPath === realB);

  // relink refuses an empty path.
  ok('relink empty path refused', S.relinkInstance(a.id, '').ok === false);
  // relink refuses an unknown id.
  ok('relink unknown id refused', S.relinkInstance('nope', realA).ok === false);

  // A second instance on realA; A must not be allowed to relink onto it.
  const b = S.addInstance({ name: 'B', serverPath: realA });
  ok('add B ok', b.ok === true);
  const conflict = S.relinkInstance(a.id, realA);
  ok('relink to an owned folder refused', conflict.ok === false);

  // Empty serverPath also counts as missing.
  const c = S.addInstance({ name: 'C' });
  ok('add C (no path) ok', c.ok === true);
  list = S.listInstances();
  ok('empty path -> missing true', list.instances.find(i => i.id === c.id).missing === true);

  fs.rmSync(realA, { recursive: true, force: true });
  fs.rmSync(realB, { recursive: true, force: true });
  fs.rmSync(userData, { recursive: true, force: true });
  console.log(`\n${passed} passed, 0 failed`);
  process.exit(0);
} catch (e) {
  console.error(e);
  process.exit(1);
}
