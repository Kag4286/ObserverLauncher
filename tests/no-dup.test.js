// no-dup.test.js — guards against AI-induced duplicate code (see .agent/memory.md gotcha #20).
//
// WHY: this codebase has repeatedly been hit by copy-paste/hallucinated duplicates — an 11-line
// teardown block copied into BOTH the 'error' and 'exit' handlers, a CSS selector repeated 7x, a
// zip/tar spawn wrapper duplicated verbatim, and two rAF-coalesce helpers that were byte-identical
// in the editor + world map. Manual review missed them.
//
// SCOPE: src/ and scripts/ (production + CI scripts). tests/ is intentionally NOT scanned — test
// files legitimately repeat setup boilerplate. website/ is gitignored, so it is skipped too.
//
// CHECKS:
//   1. CSS: the same (selector, body) pair appears 2+ times in ONE file. @-rules (@keyframes /
//      @media) are handled: keyframe from/to repeats are normal and skipped, while a rule INSIDE a
//      @media is compared by its own selector+body (a different body = complementary, not a dup).
//   2. JS within one file: the same 4+ consecutive significant lines appear twice.
//   3. JS across files: the same 6+ consecutive significant lines appear in 2+ DIFFERENT files.
//      The window is deliberately LONGER than the in-file one: 2-3 shared lines are almost always
//      benign boilerplate (require / module.exports / try-catch), so a cross-file match must be a
//      substantial block to be worth flagging. This is what catches a helper copied between modules.
//
// KNOWN-BENIGN repeats go in an ALLOW_* list with a reason. Add an entry ONLY after reading the
// region and confirming the occurrences are intentionally complementary, never to hide a real dup.
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');
const SCRIPTS = path.join(__dirname, '..', 'scripts');

// --- known-benign allowlist. key = '<basename>::<selector>' for CSS,
//     '<basename>::<first line of block>' for in-file JS, '<first line of block>' for cross-file JS.
//     A trailing '*' matches by prefix.
const ALLOW_CSS = [
  // '05-market.css::.market-item', // two COMPLEMENTARY blocks, verified not identical (gotcha #20)
];
const ALLOW_JS = [
  // three TEMPLATE data literals legitimately share software/version/memoryGB/port — data, not
  // copied logic. Verified by reading templates.js (TEMPLATES array).
  'templates.js::software: \'paper\',',
];
const ALLOW_XFILE = [
  // headless.js + main.js are TWO composition roots that DELIBERATELY register the same feature
  // modules (one for the GUI, one for the window-less backend). Same lines, by design - not debt.
  "require('./main/server-lifecycle.js')",
  'registerServer(ipcWrap, ctx);',
  // The two Linux boot-smoke scripts share a shell try/catch/finally tail; the real logic already
  // lives in scripts/boot-harness.js - only the surrounding try/catch shape remains.
  'const gone = await stopAndWait(rt.shim, rt.ctx);',
];

function walk(dir, exts, out) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, exts, out);
    else if (exts.some((x) => e.name.endsWith(x))) out.push(p);
  }
  return out;
}

function norm(s) { return s.replace(/\s+/g, ' ').trim(); }

// A "significant" line = non-empty, not comment-only, and has at least one identifier char. Both
// the in-file and cross-file JS checks use this so they agree on what counts as code.
function significantLines(src) {
  const out = [];
  for (const line of String(src).split('\n')) {
    const t = line.trim();
    if (!t) continue;
    if (/^(\/\/|\*|\/\*)/.test(t)) continue;
    if (!/[A-Za-z0-9_]/.test(t)) continue;
    out.push(t);
  }
  return out;
}

// Brace-aware CSS rule extractor. Returns leaf rules { sel, body } with @-rules and @keyframes
// contents excluded (their from/to repeats are normal, not duplication).
function cssRules(css) {
  css = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  const stack = [];
  let buf = '';
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (c === '{') {
      const parentKF = stack.length ? stack[stack.length - 1].inKF : false;
      stack.push({ prelude: buf.trim(), body: '', kids: 0, inKF: parentKF || /@keyframes/i.test(buf) });
      buf = '';
    } else if (c === '}') {
      const f = stack.pop();
      if (stack.length) {
        const p = stack[stack.length - 1];
        p.kids++;
        p.body += f.prelude + '{' + f.body + '}';
      }
      if (f.kids === 0 && !f.inKF && !/^@/.test(f.prelude) && f.prelude) {
        rules.push({ sel: norm(f.prelude), body: norm(f.body) });
      }
      buf = '';
    } else if (stack.length) {
      // Inside a rule: declarations belong to the CURRENT frame's body. Without this the leaf
      // body stays empty and every repeated selector false-flags as a duplicate.
      stack[stack.length - 1].body += c;
    } else {
      buf += c;
    }
  }
  return rules;
}

function allowed(list, key) {
  return list.some((a) => (a.endsWith('*') ? key.startsWith(a.slice(0, -1)) : a === key));
}
// Cross-file allowlist matches when an entry is a SUBSTRING of the whole block key, so an entry can
// name a distinctive phrase anywhere in the block instead of only its first line.
function allowedX(list, key) {
  return list.some((a) => key.includes(a));
}

// Mark the covered line positions so shifted windows that overlap an already-reported block are
// not reported again.
function markCovered(consumed, start, width) { for (let k = 0; k < width; k++) consumed.add(start + k); }
function allCovered(consumed, positions) { return positions.every((p) => consumed.has(p)); }

const failures = [];

// --- 1. CSS: duplicate (selector, body) within one file ---
const cssFiles = walk(path.join(SRC, 'renderer', 'css'), ['.css'], []);
for (const file of cssFiles) {
  const base = path.basename(file);
  const rules = cssRules(fs.readFileSync(file, 'utf8'));
  const seen = new Map();
  for (const r of rules) {
    const key = r.sel + '\u0000' + r.body;
    seen.set(key, (seen.get(key) || 0) + 1);
  }
  for (const [key, n] of seen) {
    if (n < 2) continue;
    const sel = key.split('\u0000')[0];
    if (allowed(ALLOW_CSS, base + '::' + sel)) continue;
    failures.push(`DUPLICATE CSS in ${base}: selector "${sel}" with an identical body appears ${n}x`);
  }
}

// JS files to scan: src/ (recursive) + scripts/ (recursive).
const jsFiles = walk(SRC, ['.js'], []).concat(walk(SCRIPTS, ['.js'], []));

// --- 2. JS: the same 4+ consecutive significant lines appear twice in ONE file ---
const W = 4;
for (const file of jsFiles) {
  const base = path.basename(file);
  const sig = significantLines(fs.readFileSync(file, 'utf8'));
  const index = new Map(); // block key -> [start positions]
  for (let i = 0; i + W <= sig.length; i++) {
    const key = sig.slice(i, i + W).join('\n');
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(i);
  }
  const consumed = new Set();
  for (const [key, positions] of index) {
    if (positions.length < 2) continue;
    if (allCovered(consumed, positions)) continue;
    // Mark covered BEFORE deciding to report, so an allowlisted block still suppresses the shifted
    // windows that overlap it (otherwise the next 1-line-shifted key re-reports the same region).
    const isAllowed = allowed(ALLOW_JS, base + '::' + sig[positions[0]]);
    for (const p of positions) markCovered(consumed, p, W);
    if (isAllowed) continue;
    failures.push(`DUPLICATE JS in ${base}: ${W}+ identical consecutive lines at lines #${positions[0]} and #${positions[1]}:\n` +
      key.split('\n').map((l) => '      ' + l).join('\n'));
  }
}

// --- 3. JS: the same 6+ consecutive significant lines in 2+ DIFFERENT files (cross-file copy) ---
const XW = 6;
const xIndex = new Map(); // block key -> [{ base, i }]
for (const file of jsFiles) {
  const base = path.basename(file);
  const sig = significantLines(fs.readFileSync(file, 'utf8'));
  for (let i = 0; i + XW <= sig.length; i++) {
    const key = sig.slice(i, i + XW).join('\n');
    if (!xIndex.has(key)) xIndex.set(key, []);
    xIndex.get(key).push({ base, i });
  }
}
const xConsumed = new Map(); // base -> Set of covered start positions
for (const [key, hits] of xIndex) {
  const files = new Set(hits.map((h) => h.base));
  if (files.size < 2) continue; // in-file dups are handled above
  const covered = (h) => { const s = xConsumed.get(h.base); return s && s.has(h.i); };
  if (hits.every(covered)) continue;
  // Mark covered BEFORE deciding to report (see the in-file loop) so an allowlisted cross-file block
  // also suppresses the shifted windows overlapping it.
  const isAllowed = allowedX(ALLOW_XFILE, key);
  for (const h of hits) {
    if (!xConsumed.has(h.base)) xConsumed.set(h.base, new Set());
    markCovered(xConsumed.get(h.base), h.i, XW);
  }
  if (isAllowed) continue;
  failures.push(`DUPLICATE JS across files (${[...files].join(', ')}): ${XW}+ identical lines:\n` +
    key.split('\n').map((l) => '      ' + l).join('\n'));
}

console.log(`no-dup scan: ${cssFiles.length} CSS file(s), ${jsFiles.length} JS file(s) (src + scripts)`);
if (failures.length) {
  for (const f of failures) console.log('  FAIL ' + f);
  console.log(`FAIL no-dup: ${failures.length} duplicate block(s) found — extract a shared helper (gotcha #20).`);
  process.exit(1);
}
console.log('PASS no-dup: no duplicated CSS selectors or copied JS blocks in src/ + scripts/.');
