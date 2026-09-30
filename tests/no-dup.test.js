// no-dup.test.js — guards against AI-induced duplicate code (see .agent/memory.md gotcha #20).
//
// WHY: this codebase has repeatedly been hit by copy-paste/hallucinated duplicates — an 11-line
// teardown block copied into BOTH the 'error' and 'exit' handlers, a CSS selector repeated 7x, a
// zip/tar spawn wrapper duplicated verbatim. Manual review missed them; a bad pack or a silent
// regression can ship. This test scans the SOURCE at test time and fails when the SAME code block
// appears twice in one file, so the debt can never grow back silently.
//
// SCOPE: src/ only (production code). tests/ is intentionally NOT scanned — test files legitimately
// repeat setup boilerplate. website/ is gitignored, so it is skipped too.
//
// CHECKS:
//   1. CSS: the same (selector, body) pair appears 2+ times in ONE file. @-rules (@keyframes /
//      @media) are handled: keyframe from/to/to{opacity:1} repeats are normal and skipped, while a
//      rule INSIDE @media is compared by its own selector+body (a media override with a DIFFERENT
//      body is complementary, not a duplicate).
//   2. JS: the same 4+ consecutive non-trivial lines appear twice in ONE file (a copied block).
//
// KNOWN-BENIGN repeats go in ALLOW_CSS / ALLOW_JS with a reason. Add an entry ONLY after reading the
// region and confirming the two occurrences are intentionally complementary, never to hide a real dup.
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');

// --- known-benign allowlist (empty = none currently). key = '<basename>::<selector>' for CSS,
//     '<basename>::<first line of block>' for JS. A trailing '*' matches by prefix.
const ALLOW_CSS = [
  // '05-market.css::.market-item', // two COMPLEMENTARY blocks, verified not identical (gotcha #20)
];
const ALLOW_JS = [
  // three TEMPLATE data literals legitimately share software/version/memoryGB/port — data, not
  // copied logic. Verified by reading templates.js (TEMPLATES array).
  'templates.js::software: \'paper\',',
];

function walk(dir, exts, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, exts, out);
    else if (exts.some((x) => e.name.endsWith(x))) out.push(p);
  }
  return out;
}

function norm(s) { return s.replace(/\s+/g, ' ').trim(); }

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

// --- 2. JS: the same 4+ consecutive non-trivial lines twice in one file ---
const jsFiles = walk(SRC, ['.js'], []);
const W = 4;
for (const file of jsFiles) {
  const base = path.basename(file);
  const raw = fs.readFileSync(file, 'utf8').split('\n');
  // significant = non-empty, not comment-only, and has at least one identifier char
  const sig = [];
  for (const line of raw) {
    const t = line.trim();
    if (!t) continue;
    if (/^(\/\/|\*|\/\*)/.test(t)) continue;
    if (!/[A-Za-z0-9_]/.test(t)) continue;
    sig.push(t);
  }
  const seen = new Map();
  for (let i = 0; i + W <= sig.length; i++) {
    const key = sig.slice(i, i + W).join('\n');
    if (seen.has(key)) {
      if (!allowed(ALLOW_JS, base + '::' + sig[i])) {
        failures.push(`DUPLICATE JS in ${base}: 4+ identical consecutive lines at block #${seen.get(key)} and #${i}:\n` +
          key.split('\n').map((l) => '      ' + l).join('\n'));
      }
      break; // one report per file is enough to act on
    }
    seen.set(key, i);
  }
}

console.log(`no-dup scan: ${cssFiles.length} CSS file(s), ${jsFiles.length} JS file(s)`);
if (failures.length) {
  for (const f of failures) console.log('  FAIL ' + f);
  console.log(`FAIL no-dup: ${failures.length} duplicate block(s) found — extract a shared helper (gotcha #20).`);
  process.exit(1);
}
console.log('PASS no-dup: no duplicated CSS selectors or copied JS blocks in src/.');
