// headless-guard.test.js — RATCHET against re-welding the backend to Electron (v3.0.0 Phase B1).
//
// WHY: B1 removed the top-level `const { app } = require('electron')` destructures and routed data
// paths through dataDir() so the SAME backend can run headless. Nothing stops a future edit from
// re-adding one — and the failure mode is nasty (require-time throw in a plain Node process, i.e.
// `node src/headless.js` dies before any tool runs). This scanner fails the build if either pattern
// comes back, exactly like the motion-token + arch-ctx-accessor ratchets guard their contracts.
//
// TWO rules:
//   R1 top-level `const {...} = require('electron')` (a require at column 0). Lazy requires INSIDE a
//      function are indented -> allowed (that is the GUI-only pattern B1 introduced).
//   R2 `app.getPath('userData'|'temp')` anywhere except the ONE resolver (data-dir.js).
// Allowlists are explicit and intentionally tiny; adding a file here is a deliberate decision.
const fs = require('fs');
const path = require('path');

// src/headless.js is the no-window entry point itself — the file most important to keep Electron-free
// — so it is scanned alongside src/main + src/mcp. When ROOTS contains a FILE, walk() is skipped and
// the file is scanned directly (the flatMap below only walks directories).
const SRC = path.join(__dirname, '..', 'src');
// Both no-GUI entry points (headless + CLI) are scanned alongside src/main + src/mcp — they are the
// files that MUST stay Electron-free.
const ROOTS = [path.join(SRC, 'main'), path.join(SRC, 'mcp'), path.join(SRC, 'headless.js'), path.join(SRC, 'cli.js')];

// GUI-only modules that legitimately keep Electron access (never reachable headless).
const TOPLEVEL_ALLOW = new Set(['app-lifecycle.js']);
const GETPATH_ALLOW = new Set(['data-dir.js', 'app-lifecycle.js']);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p, out); }
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

// A top-level destructure is a `const ... = require('electron')` starting at column 0 (no indent).
const TOPLEVEL_ELECTRON = /^const\s+\{[^}]*\}\s*=\s*require\(['"]electron['"]\)/;
// Data paths that MUST go through dataDir()/tempDir().
const APP_GETPATH = /app\.getPath\(\s*['"](userData|temp)['"]\s*\)/;

let violations = [];
const files = ROOTS.flatMap(r => {
  if (!fs.existsSync(r)) return [];
  // A ROOT may be a single FILE (src/headless.js) or a directory -> walk it.
  return fs.statSync(r).isFile() ? [r] : walk(r);
});
for (const file of files) {
  const base = path.basename(file);
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    const n = i + 1;
    // Skip comment-only lines: B1's explanatory comments mention app.getPath('userData')/
    // require('electron') and must not be flagged as real code.
    const t = line.trim();
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
    if (TOPLEVEL_ELECTRON.test(line) && !TOPLEVEL_ALLOW.has(base)) {
      violations.push(`${path.relative(path.join(__dirname, '..'), file)}:${n}  top-level require('electron') -> use a lazy require or dataDir()`);
    }
    if (APP_GETPATH.test(line) && !GETPATH_ALLOW.has(base)) {
      violations.push(`${path.relative(path.join(__dirname, '..'), file)}:${n}  app.getPath('userData'|'temp') -> use dataDir()/tempDir()`);
    }
  });
}

console.log(`scanned ${files.length} source file(s) under src/main + src/mcp`);
if (violations.length) {
  console.log('FAIL headless guard — the backend is being re-welded to Electron:');
  for (const v of violations) console.log('  ' + v);
  process.exit(1);
}
console.log('PASS headless guard: no top-level electron require, no app.getPath(userData/temp) outside data-dir.js');
