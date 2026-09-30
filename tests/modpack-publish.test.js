// modpack-publish.test.js — guards the D3 publish archive writer (v3.2.0).
//
// The tarball is hand-rolled (no zip/tar CLI), so its correctness is not obvious from reading it.
// These checks gunzip the output and walk the tar headers to prove the entries + sizes round-trip.
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { tarGz, collect } = require('../scripts/modpack-publish.js');

let fail = 0;
const check = (name, cond, detail) => cond ? console.log('PASS ' + name) : (fail++, console.log('FAIL ' + name + (detail ? ' — ' + detail : '')));

// Walk a tar buffer -> [{name, size}]. Stops at the first zero-name block (end of archive).
function listTar(buf) {
  const out = [];
  for (let off = 0; off + 512 <= buf.length;) {
    const name = buf.toString('utf8', off, off + 100).replace(/\0.*$/, '');
    if (!name) break;
    const size = parseInt(buf.toString('ascii', off + 124, off + 136).replace(/\0.*$/, ''), 8) || 0;
    out.push({ name, size });
    off += 512 + Math.ceil(size / 512) * 512;
  }
  return out;
}

// --- tarGz round-trip ---
const entries = [
  { name: 'observerlauncher-manifest.json', data: Buffer.from('{"a":1}') },
  { name: 'plugins/Foo.jar', data: Buffer.alloc(1000, 7) },
  { name: 'mods/bar.jar', data: Buffer.from('x') },
];
const gz = tarGz(entries);
check('output is gzip (magic 1f 8b)', gz[0] === 0x1f && gz[1] === 0x8b);

const raw = zlib.gunzipSync(gz);
const list = listTar(raw);
check('entry count matches', list.length === 3, JSON.stringify(list));
check('entry names preserved', list.map(e => e.name).join(',') === 'observerlauncher-manifest.json,plugins/Foo.jar,mods/bar.jar');
check('entry sizes preserved', list[0].size === 7 && list[1].size === 1000 && list[2].size === 1, JSON.stringify(list));

// Padding: the archive must be a whole number of 512-byte blocks (header + padded data) + 2 zero blocks.
check('archive length is a multiple of 512', raw.length % 512 === 0, String(raw.length));
check('ends with two zero blocks', raw.slice(-1024).every(b => b === 0));

// A file whose data is exactly one block still gets a full 512-byte block, not zero padding skipped.
const one = zlib.gunzipSync(tarGz([{ name: 'a', data: Buffer.alloc(512, 1) }]));
check('exactly-one-block file round-trips', listTar(one)[0].size === 512);

// --- collect() walks a real folder recursively ---
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ol-pubtest-'));
fs.mkdirSync(path.join(tmp, 'plugins'));
fs.writeFileSync(path.join(tmp, 'plugins', 'a.jar'), 'A');
fs.writeFileSync(path.join(tmp, 'root.txt'), 'R');
const got = collect(tmp, '', []);
check('collect finds both files', got.length === 2, JSON.stringify(got.map(e => e.name)));
check('collect uses POSIX separators', got.some(e => e.name === 'plugins/a.jar'));
check('collect reads real bytes', got.find(e => e.name === 'root.txt').data.toString() === 'R');
fs.rmSync(tmp, { recursive: true, force: true });

console.log(fail ? `\n${fail} check(s) failed.` : '\nAll modpack-publish checks passed.');
process.exit(fail ? 1 : 0);
