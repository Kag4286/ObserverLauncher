// 5.4.0: writeFileAtomic retry/fallback. Covers the normal write, replacing an existing file,
// and the new fallback path when rename fails. A real EPERM is hard to trigger deterministically,
// so the fallback is proven by stubbing fs.renameSync to throw EPERM on the first attempts.
const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-fs-atomic-'));

let passed = 0;
function ok(name, cond) { assert(cond, `FAIL: ${name}`); console.log(`PASS ${name}`); passed++; }

// Load fs-utils fresh so we can stub fs.renameSync. It requires the same 'fs' module object,
// so patching fs.renameSync here is visible inside it.
const { writeFileAtomic } = require('../src/main/fs-utils.js');

try {
  // 1) normal write creates the file with exact content.
  const f1 = path.join(dir, 'a.txt');
  writeFileAtomic(f1, 'hello');
  ok('creates file', fs.readFileSync(f1, 'utf8') === 'hello');

  // 2) overwrite replaces content.
  writeFileAtomic(f1, 'world');
  ok('overwrites content', fs.readFileSync(f1, 'utf8') === 'world');

  // 3) no temp file left behind after a normal write.
  const leftover = fs.readdirSync(dir).filter(n => n.includes('.tmp-'));
  ok('no temp file left', leftover.length === 0);

  // 4) rename failing with EPERM falls back to copy+unlink and still writes the content.
  const f2 = path.join(dir, 'b.txt');
  fs.writeFileSync(f2, 'old');
  const realRename = fs.renameSync;
  let attempts = 0;
  fs.renameSync = function () { attempts++; const e = new Error('EPERM'); e.code = 'EPERM'; throw e; };
  try { writeFileAtomic(f2, 'new'); } finally { fs.renameSync = realRename; }
  ok('retried rename (>=2 attempts)', attempts >= 2);
  ok('fallback wrote content', fs.readFileSync(f2, 'utf8') === 'new');
  const leftover2 = fs.readdirSync(dir).filter(n => n.includes('.tmp-'));
  ok('no temp file after fallback', leftover2.length === 0);

  // 5) a non-retryable error (e.g. ENOENT on the dir) still throws — we do not swallow real errors.
  fs.renameSync = function () { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; };
  let threw = false;
  try { writeFileAtomic(path.join(dir, 'c.txt'), 'x'); } catch { threw = true; } finally { fs.renameSync = realRename; }
  ok('non-EPERM error rethrows', threw === true);
  // clean any temp left by the rethrow case
  fs.readdirSync(dir).filter(n => n.includes('.tmp-')).forEach(n => { try { fs.unlinkSync(path.join(dir, n)); } catch {} });

  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`\n${passed} passed, 0 failed`);
  process.exit(0);
} catch (e) {
  console.error(e);
  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(1);
}
