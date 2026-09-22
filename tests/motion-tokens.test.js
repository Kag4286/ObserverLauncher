// motion-tokens.test.js — guards the motion contract in docs/motion.md against drift.
//
// The contract says animations should use the duration/easing TOKENS (var(--dur-*), var(--ease-*))
// rather than ad-hoc values, so the app feels consistent and Lite mode can neutralise motion in one
// place. That contract is prose; nothing enforced it, so new CSS could quietly ignore it.
//
// A hard rule ("every transition must use a token") would fail today: ~60 older rules still use
// literal durations. Refactoring all of them is out of scope for a hardening release and risks
// visual regressions. So this is a RATCHET: it measures the number of literal durations and fails
// only if the count goes UP, keeping the debt from growing while allowing it to shrink over time.
const fs = require('fs');
const path = require('path');

const cssDir = path.join(__dirname, '..', 'src', 'renderer', 'css');
const files = fs.readdirSync(cssDir).filter(f => f.endsWith('.css'));

// A "literal duration" is a time value written directly (e.g. .12s, 200ms) inside a
// transition/animation shorthand, as opposed to var(--dur-*). We count occurrences, not rules.
const DURATION = /(^|[\s:(,])(\d*\.?\d+)(m?s)(?=[\s,;)]|$)/g;

let total = 0;
const perFile = {};
for (const f of files) {
  const src = fs.readFileSync(path.join(cssDir, f), 'utf8');
  // Only look at lines that actually declare motion, so background-position/gradient stops etc.
  // (which can contain s/ms-like tokens) don't inflate the count.
  let n = 0;
  for (const line of src.split('\n')) {
    if (!/transition|animation/.test(line)) continue;
    if (/transition\s*:\s*none|animation\s*:\s*none/.test(line)) continue;
    const m = line.match(DURATION);
    if (m) n += m.length;
  }
  if (n) { perFile[f] = n; total += n; }
}

// Baseline measured for 1.5.0. Lower it when you convert literal durations to tokens; never raise
// it without a comment explaining why a new literal is unavoidable.
const BASELINE = 124;
const SLACK = 0;

console.log('literal motion durations per CSS file:');
for (const [f, n] of Object.entries(perFile).sort()) console.log(`  ${f}: ${n}`);
console.log(`total literal durations: ${total}`);

const ok = total <= BASELINE + SLACK;
console.log(ok
  ? `PASS motion tokens: ${total} literal durations (<= ${BASELINE + SLACK} baseline)`
  : `FAIL motion tokens: ${total} literal durations exceeds baseline ${BASELINE + SLACK} — use var(--dur-*) from 01-tokens.css`);
process.exit(ok ? 0 : 1);
