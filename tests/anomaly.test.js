// v6.0.0 D3 + D4: TPS anomaly + memory-leak detection. Both live in 00-core.js as pure helpers,
// so this test runs the whole file in a VM with a minimal DOM stub and exercises them directly.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0;
function ok(name, cond) { assert(cond, `FAIL: ${name}`); console.log(`PASS ${name}`); passed++; }

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'js', '00-core.js'), 'utf8');
const noop = () => {};
const sandbox = {
  document: { querySelector: () => null, querySelectorAll: () => [], addEventListener: noop, createElement: () => ({ style:{}, classList:{add:noop,remove:noop,toggle:noop}, appendChild:noop }), body:{appendChild:noop} },
  window: { addEventListener: noop, LOCALES: { en: {} }, innerWidth: 1200, innerHeight: 800 },
  navigator: { clipboard: { writeText: async () => {} } },
  requestAnimationFrame: () => 0, cancelAnimationFrame: noop,
  performance: { now: () => 0 },
  matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop, addListener: noop, removeListener: noop }),
  setTimeout, clearTimeout, console,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
const { detectTpsAnomaly, detectMemoryLeak } = sandbox;

ok('detectTpsAnomaly exported', typeof detectTpsAnomaly === 'function');
ok('detectMemoryLeak exported', typeof detectMemoryLeak === 'function');

// helper: build N samples of the given tps
const flat = (n, tps, mspt = 20, players = 1, ram = 40) => Array.from({ length: n }, (_, i) => ({ t: i * 10000, tps, mspt, players, ram }));

// --- D3 ---
ok('flat series -> no anomaly', detectTpsAnomaly(flat(40, 20)) === null);
ok('too few samples -> no anomaly', detectTpsAnomaly(flat(5, 20)) === null);
ok('empty -> no anomaly', detectTpsAnomaly([]) === null);
ok('non-array -> no anomaly', detectTpsAnomaly(null) === null);

// Sharp drop: 40 samples of 20 TPS, then 1 of 10 -> anomaly.
{
  const s = flat(40, 20);
  s.push({ t: 400000, tps: 10, mspt: 20, players: 1, ram: 40 });
  const r = detectTpsAnomaly(s);
  ok('sharp drop -> anomaly', r && r.cause === 'unknown');
  ok('dropPct rounded', r && r.dropPct === 50);
  ok('current accurate', r && r.current === 10);
  ok('baseline accurate', r && r.baseline === 20);
}
// 20 -> 16: drop of 20% (meets threshold) AND 16 < minTps (17) -> MUST flag.
{
  const s = flat(40, 20);
  s.push({ t: 400000, tps: 16, mspt: 20, players: 1, ram: 40 });
  ok('drop to 16 (20% drop, below minTps) -> anomaly', detectTpsAnomaly(s) !== null);
}
// 20 -> 17: drop of only 15% (below 20% threshold) -> MUST not flag.
{
  const s = flat(40, 20);
  s.push({ t: 400000, tps: 17, mspt: 20, players: 1, ram: 40 });
  ok('drop to 17 (15% drop) -> no anomaly', detectTpsAnomaly(s) === null);
}
// 20 -> 18: 18 > minTps -> MUST not flag even at 10% drop.
{
  const s = flat(40, 20);
  s.push({ t: 400000, tps: 18, mspt: 20, players: 1, ram: 40 });
  ok('drop to 18 (10% drop) -> no anomaly', detectTpsAnomaly(s) === null);
}
// Cause: mspt > 45 -> tick.
{
  const s = flat(40, 20);
  s.push({ t: 400000, tps: 10, mspt: 60, players: 1, ram: 40 });
  const r = detectTpsAnomaly(s);
  ok('cause tick when mspt high', r && r.cause === 'tick');
}
// Cause: 3+ players more than baseline -> players.
{
  const s = flat(40, 20, 20, 1, 40);
  s.push({ t: 400000, tps: 10, mspt: 20, players: 5, ram: 40 });
  const r = detectTpsAnomaly(s);
  ok('cause players when player count jumps', r && r.cause === 'players');
}
// Cause: ram near ceiling -> memory.
{
  const s = flat(40, 20, 20, 1, 40);
  s.push({ t: 400000, tps: 10, mspt: 20, players: 1, ram: 90 });
  const r = detectTpsAnomaly(s);
  ok('cause memory when ram high', r && r.cause === 'memory');
}
// All null tps -> no crash, no anomaly.
ok('all-null tps -> no anomaly', detectTpsAnomaly(Array.from({ length: 40 }, (_, i) => ({ t: i, tps: null }))) === null);

// --- D4 ---
const H = 60 * 60 * 1000;
const ramp = (hours, startRam, ratePct) => {
  const steps = Math.round(hours * 6); // 10-min samples
  const out = [];
  for (let i = 0; i < steps; i++) {
    const t = i * (H / 6);
    const ram = startRam * Math.pow(1 + ratePct / 100, i / 6);
    out.push({ t, ram });
  }
  return out;
};
ok('flat ram -> no leak', detectMemoryLeak(Array.from({ length: 18 }, (_, i) => ({ t: i * H / 6, ram: 50 }))) === null);
ok('empty -> no leak', detectMemoryLeak([]) === null);
ok('short span -> no leak', detectMemoryLeak(ramp(1, 50, 5)) === null);
ok('non-monotonic -> no leak', detectMemoryLeak([
  { t: 0, ram: 50 }, { t: H, ram: 60 }, { t: 2 * H, ram: 40 }, { t: 3 * H, ram: 60 }, { t: 4 * H, ram: 55 },
]) === null);
{
  const r = detectMemoryLeak(ramp(3, 50, 5));
  ok('steady 5%/h over 3h -> leak', r && r.growthPerHour >= 2);
  ok('leak has from/to numbers', r && typeof r.from === 'number' && typeof r.to === 'number');
  ok('leak hours ~2.8', r && Math.abs(r.hours - 17 / 6) < 0.15);
}
{
  // Slow drift below the threshold (1%/h) should NOT flag.
  const r = detectMemoryLeak(ramp(4, 50, 1));
  ok('1%/h drift -> no leak', r === null);
}
// Samples with null ram are ignored, not treated as 0.
ok('null-ram rows ignored', detectMemoryLeak([...ramp(3, 50, 5), { t: 4 * H, ram: null }]) !== null);

console.log(`\n${passed} passed, 0 failed`);
