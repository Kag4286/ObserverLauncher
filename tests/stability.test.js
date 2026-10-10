// stability.test.js — persistent run-stability state + auto-rollback decision (v3.2.0 Phase D4).
// PURE classify/decide + disk I/O into a temp OBSERVER_DATA_DIR.
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpData = fs.mkdtempSync(path.join(os.tmpdir(), 'ol-stability-'));
process.env.OBSERVER_DATA_DIR = tmpData;

const st = require('../src/main/stability.js');

let pass = 0, fail = 0;
const check = (name, cond, detail) => cond ? (pass++, console.log('PASS', name)) : (fail++, console.log('FAIL', name + (detail ? ' — ' + detail : '')));

// classifyRun (pure)
check('classify: no startedAt -> unknown', st.classifyRun({}, Date.now()) === 'unknown');
check('classify: still running, past threshold -> stable', st.classifyRun({ startedAt: 0, endedAt: null }, 200000, { stableMs: 120000 }) === 'stable');
check('classify: still running, too early -> unknown', st.classifyRun({ startedAt: 0, endedAt: null }, 50000, { stableMs: 120000 }) === 'unknown');
check('classify: ended early -> unstable', st.classifyRun({ startedAt: 0, endedAt: 30000 }, 30000, { stableMs: 120000 }) === 'unstable');
check('classify: ended late -> stable', st.classifyRun({ startedAt: 0, endedAt: 200000 }, 200000, { stableMs: 120000 }) === 'stable');

// decideRollback (pure)
check('decide: last stable -> no rollback', st.decideRollback({ lastOutcome: 'stable', unstableStreak: 5 }).rollback === false);
check('decide: unknown -> no rollback', st.decideRollback({ lastOutcome: 'unknown', unstableStreak: 5 }).rollback === false);
check('decide: unstable below threshold -> no rollback', st.decideRollback({ lastOutcome: 'unstable', unstableStreak: 1 }, { maxUnstable: 2 }).rollback === false);
check('decide: unstable at threshold -> rollback', st.decideRollback({ lastOutcome: 'unstable', unstableStreak: 2 }, { maxUnstable: 2 }).rollback === true);
check('decide: reason mentions the streak', /2 runs/.test(st.decideRollback({ lastOutcome: 'unstable', unstableStreak: 2 }, { maxUnstable: 2 }).reason));

// noteStart / noteExit (disk)
{
  st.noteStart('inst1', { at: 1000 });
  const r0 = st.getRecord('inst1');
  check('noteStart records startedAt + clears endedAt', r0.startedAt === 1000 && r0.endedAt === null);

  // A stable run resets the streak.
  const r1 = st.noteExit('inst1', { at: 1000 + 200000, code: 0, stableMs: 120000 });
  check('noteExit stable -> streak 0', r1.lastOutcome === 'stable' && r1.unstableStreak === 0, JSON.stringify(r1));

  // Two unstable runs in a row -> streak 2 -> decideRollback true.
  st.noteStart('inst1', { at: 5000 });
  const u1 = st.noteExit('inst1', { at: 20000, code: 1, stableMs: 120000 });
  check('noteExit unstable #1 -> streak 1', u1.unstableStreak === 1, JSON.stringify(u1));
  st.noteStart('inst1', { at: 30000 });
  const u2 = st.noteExit('inst1', { at: 40000, code: 1, stableMs: 120000 });
  check('noteExit unstable #2 -> streak 2', u2.unstableStreak === 2, JSON.stringify(u2));
  check('decideRollback now true', st.decideRollback(u2).rollback === true);

  // Persistence: a fresh read (new process would see the same file) still has the streak.
  const persisted = JSON.parse(fs.readFileSync(st.stabilityPath(), 'utf8'));
  check('state persisted to stability.json', persisted.instances.inst1.unstableStreak === 2);

  check('getRecord unknown id -> null', st.getRecord('nope') === null);
  check('stabilityPath lives in OBSERVER_DATA_DIR', st.stabilityPath().startsWith(tmpData));
}

// v4.4.0: a MANUAL stop must not count as an unstable run (3 quick Start->Stop cycles used to log
// "unstable 3 runs in a row - rollback recommended" with no crash).
{
  check('classify: manual -> manual', st.classifyRun({ startedAt: 0, endedAt: 5000 }, 5000, { manual: true }) === 'manual');

  // Two quick manual stops in a row: streak must stay 0, never trips the warning.
  st.noteStart('inst2', { at: 1000 });
  const m1 = st.noteExit('inst2', { at: 5000, code: 0, manual: true });
  check('manual stop does not increment streak', (m1.unstableStreak || 0) === 0, JSON.stringify(m1));
  st.noteStart('inst2', { at: 6000 });
  const m2 = st.noteExit('inst2', { at: 9000, code: 0, manual: true });
  check('second manual stop still streak 0', (m2.unstableStreak || 0) === 0, JSON.stringify(m2));
  check('manual stop never recommends rollback', st.decideRollback(m2).rollback === false);

  // A real crash streak survives a later manual stop (the streak is not reset by it).
  st.noteStart('inst3', { at: 1000 });
  st.noteExit('inst3', { at: 5000, code: 1, stableMs: 120000 }); // unstable #1
  st.noteStart('inst3', { at: 6000 });
  st.noteExit('inst3', { at: 9000, code: 1, stableMs: 120000 }); // unstable #2 -> streak 2
  st.noteStart('inst3', { at: 10000 });
  const afterManual = st.noteExit('inst3', { at: 11000, code: 0, manual: true });
  check('manual stop preserves a real crash streak', afterManual.unstableStreak === 2, JSON.stringify(afterManual));
  check('manual stop leaves lastOutcome on the real crash', afterManual.lastOutcome === 'unstable');
}

try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch {}
console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
