// v2.0.0 Phase C (plan items 14 + 15): cheap architecture tests that catch classes of bugs
// that shipped 3x. They scan source files, no runtime needed.
//  (a) 13-bootcheck.js must be the LAST <script> in index.html (it probes every other global).
//  (b) every IPC channel preload.js invokes must be registered somewhere in src/main/ (or src/mcp/).
//  (c) writeFileSync outside fs-utils is only allowed in whitelisted files (atomic-write guard).
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const rendererDir = path.join(root, 'src', 'renderer');
const mainDir = path.join(root, 'src', 'main');

let passed = 0;
function ok(name, cond) { assert(cond, `FAIL: ${name}`); console.log(`PASS ${name}`); passed++; }

// (a) bootcheck must load LAST.
const html = fs.readFileSync(path.join(rendererDir, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);
ok('index.html loads at least one script', scripts.length > 0);
ok('13-bootcheck.js is the LAST script', scripts[scripts.length - 1] === 'js/13-bootcheck.js');

// (b) every ipcRenderer.invoke/send channel exists as ipcMain.handle/on in src.
const preload = fs.readFileSync(path.join(root, 'src', 'preload.js'), 'utf8');
const channels = [...new Set([...preload.matchAll(/ipcRenderer\.(?:invoke|send)\(\s*'([\w:.-]+)'/g)].map(m => m[1]))];
ok('preload declares IPC channels', channels.length > 10);
const mainSrc = [];
for (const dir of [mainDir, path.join(root, 'src', 'mcp')]) {
  for (const f of fs.readdirSync(dir)) {
    if (f.endsWith('.js')) mainSrc.push(fs.readFileSync(path.join(dir, f), 'utf8'));
  }
}
// src/main.js also registers a couple.
mainSrc.push(fs.readFileSync(path.join(root, 'src', 'main.js'), 'utf8'));
const allMain = mainSrc.join('\n');
const missingCh = channels.filter(ch => !new RegExp(`['"]${ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`).test(allMain));
ok(`all ${channels.length} preload IPC channels registered in main`, missingCh.length === 0);
if (missingCh.length) console.log('   missing:', missingCh.join(', '));

// (c) atomic-write guard: writeFileSync outside fs-utils must be whitelisted.
const WHITELIST = new Set([
  'fs-utils.js',        // the atomic helper itself
  'server-files.js',    // writeEula: a tiny fixed-content file, rewriting is harmless
  'textures.js',        // texture buffer (binary, fully overwritten)
  'modpacks.js',        // staging dir write before an atomic move
  'settings-handlers.js', // user-chosen export path (console export) + dialog target
]);
const offenders = [];
for (const f of fs.readdirSync(mainDir)) {
  if (!f.endsWith('.js') || WHITELIST.has(f)) continue;
  const src = fs.readFileSync(path.join(mainDir, f), 'utf8');
  if (/\bfs\.writeFileSync\b/.test(src)) offenders.push(f);
}
ok('no non-whitelisted writeFileSync in src/main', offenders.length === 0);
if (offenders.length) console.log('   offenders:', offenders.join(', '));

console.log(`\n${passed} passed, 0 failed`);
