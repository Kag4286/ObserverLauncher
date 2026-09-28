// hash-verify.test.js — supply-chain hash verification (v3.0.0 security fix).
//
// WHY: the marketplace registries publish a file hash for every download, but the install paths
// fetched the jar and used it WITHOUT checking — a compromised CDN / MITM could serve a trojaned jar
// that then runs on the user's server. verifyFileHash() is the new guard; this locks its contract.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const { verifyFileHash } = require('../src/main/fs-utils.js');

let pass = 0, fail = 0;
const check = (name, cond, detail) => cond ? (pass++, console.log('PASS', name)) : (fail++, console.log('FAIL', name + (detail ? ' — ' + detail : '')));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ol-hash-'));
const file = path.join(dir, 'thing.jar');
const content = Buffer.from('pretend this is a plugin jar');
fs.writeFileSync(file, content);
const sha512 = crypto.createHash('sha512').update(content).digest('hex');
const sha1 = crypto.createHash('sha1').update(content).digest('hex');
const sha256 = crypto.createHash('sha256').update(content).digest('hex');
const md5 = crypto.createHash('md5').update(content).digest('hex');

// 1) matching hash passes.
check('sha512 match -> ok', verifyFileHash(file, { sha512 }).ok === true);
check('sha1 match -> ok', verifyFileHash(file, { sha1 }).ok === true);
check('sha256 match -> ok', verifyFileHash(file, { sha256 }).ok === true);
check('md5 match -> ok', verifyFileHash(file, { md5 }).ok === true);
// case-insensitive
check('uppercase hash match -> ok', verifyFileHash(file, { sha512: sha512.toUpperCase() }).ok === true);

// 2) mismatch fails + reports the algo.
{
  const r = verifyFileHash(file, { sha512: 'deadbeef'.repeat(16) });
  check('sha512 mismatch -> fail', r.ok === false && r.algo === 'sha512', JSON.stringify(r));
}
{
  const r = verifyFileHash(file, { sha1: '0'.repeat(40) });
  check('sha1 mismatch -> fail', r.ok === false && r.algo === 'sha1');
}

// 3) ALL provided hashes must match (a wrong secondary still fails).
{
  const r = verifyFileHash(file, { sha1, sha512: 'x'.repeat(128) });
  check('one good + one bad -> fail', r.ok === false, JSON.stringify(r));
}

// 4) no hashes / empty / non-object -> SKIP (never blocks a source that has no hash data).
check('null hashes -> skipped ok', verifyFileHash(file, null).ok === true);
check('empty object -> skipped ok', verifyFileHash(file, {}).ok === true);
check('no sha fields -> skipped ok', verifyFileHash(file, { foo: 'bar' }).ok === true);
check('undefined -> skipped ok', verifyFileHash(file, undefined).ok === true);

// 5) missing file -> clean failure, not a throw.
{
  let threw = false, r;
  try { r = verifyFileHash(path.join(dir, 'nope.jar'), { sha1 }); } catch { threw = true; }
  check('missing file does not throw', !threw);
  check('missing file -> {ok:false}', r && r.ok === false);
}

// 6) real-world shapes: Modrinth {sha1,sha512}, CurseForge {sha1,md5}, Hangar {sha256}.
check('Modrinth shape', verifyFileHash(file, { sha1, sha512 }).ok === true);
check('CurseForge shape', verifyFileHash(file, { sha1, md5 }).ok === true);
check('Hangar shape', verifyFileHash(file, { sha256 }).ok === true);

try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
console.log(fail ? `\n${fail} check(s) failed.` : `\nAll hash-verify checks passed (${pass}).`);
process.exit(fail ? 1 : 0);
