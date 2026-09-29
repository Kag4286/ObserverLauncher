// stability.js — persistent run-stability state + auto-rollback decision (v3.2.0 Phase D4).
//
// WHY: the roadmap's auto-rollback ("a crash within N min of start = roll back") needs a PERSISTENT
// stability record. Today `restartAttempts`/`manualStop` live only in memory, so a crash that takes the
// launcher down with it (or a container restart) loses the evidence and the next boot looks clean.
// This module records, per instance, when a run started and how it ended, on disk — separate from
// settings.json (settings:save rewrites the whole file from renderer state, so a counter there would
// race and be lost; same rationale as runtime-state.js).
//
// Split for testability:
//   - classifyRun() / decideRollback() are PURE (record in -> decision out; no I/O).
//   - noteStart() / noteExit() / getRecord() do the disk I/O via dataDir() + writeFileAtomic.
// The lifecycle/deploy WIRING (call noteStart on spawn, noteExit on exit, act on decideRollback) is
// intentionally NOT here — this module only provides the state + the decision, so a caller (lifecycle
// or a CI deploy step) can adopt it without re-deriving the rules.
const fs = require('fs');
const path = require('path');
const { dataDir } = require('./data-dir.js');
const { writeFileAtomic } = require('./fs-utils.js');

// A run that survives at least this long is considered STABLE (a crash before it = unstable). 2 minutes
// is past the slow-start window (world gen / mod loading) but short enough to catch a real crash-loop.
const STABLE_MS = 120000;
// Roll back once this many UNSTABLE runs happen in a row.
const MAX_UNSTABLE = 2;

const stabilityPath = () => path.join(dataDir(), 'stability.json');

function readAll() {
  try {
    const o = JSON.parse(fs.readFileSync(stabilityPath(), 'utf8'));
    if (o && typeof o === 'object' && o.instances && typeof o.instances === 'object') return o;
  } catch {}
  return { instances: {} };
}

function writeAll(state) {
  try { writeFileAtomic(stabilityPath(), JSON.stringify(state, null, 2)); } catch {}
}

// PURE: given a run record and the clock, was the LAST run stable? A run with no startedAt, or one that
// has not yet run long enough AND has not ended, is 'unknown' (not counted). Returns 'stable' |
// 'unstable' | 'unknown'.
//   record: { startedAt?: number, endedAt?: number|null, lastExitCode?: number|null }
function classifyRun(record, now, opts) {
  const o = opts || {};
  const stableMs = Number.isFinite(o.stableMs) ? o.stableMs : STABLE_MS;
  const r = record || {};
  if (!Number.isFinite(r.startedAt)) return 'unknown';
  // Still running: stable as soon as it has crossed the threshold, otherwise unknown (too early to say).
  if (!Number.isFinite(r.endedAt)) return (now - r.startedAt >= stableMs) ? 'stable' : 'unknown';
  return (r.endedAt - r.startedAt >= stableMs) ? 'stable' : 'unstable';
}

// PURE: should the instance roll back? Yes when the last run was unstable AND the consecutive-unstable
// streak has reached the cap. A 'stable' run resets the streak (the caller does that via noteExit).
//   record: { unstableStreak?: number, lastOutcome?: 'stable'|'unstable'|'unknown' }
function decideRollback(record, opts) {
  const o = opts || {};
  const maxUnstable = Math.max(1, Number(o.maxUnstable) || MAX_UNSTABLE);
  const r = record || {};
  if (r.lastOutcome !== 'unstable') return { rollback: false, reason: 'last-run-stable-or-unknown' };
  if ((Number(r.unstableStreak) || 0) < maxUnstable) return { rollback: false, reason: 'below-threshold' };
  return { rollback: true, reason: `unstable ${r.unstableStreak} runs in a row` };
}

// Record a run START. Keeps the existing streak; clears the previous end.
function noteStart(instanceId, info) {
  const key = String(instanceId || 'default');
  const s = readAll();
  const prev = s.instances[key] || {};
  s.instances[key] = { ...prev, startedAt: (info && info.at) || Date.now(), endedAt: null, lastExitCode: null };
  writeAll(s);
}

// Record a run END. Updates the streak: a stable run resets it, an unstable run increments it. Returns
// the updated record so a caller can immediately evaluate decideRollback().
function noteExit(instanceId, info) {
  const key = String(instanceId || 'default');
  const o = info || {};
  const now = Number.isFinite(o.at) ? o.at : Date.now();
  const s = readAll();
  const r = s.instances[key] || {};
  r.endedAt = now;
  r.lastExitCode = (o.code === undefined ? null : o.code);
  const outcome = classifyRun(r, now, o);
  r.lastOutcome = outcome;
  if (outcome === 'unstable') r.unstableStreak = (Number(r.unstableStreak) || 0) + 1;
  else if (outcome === 'stable') r.unstableStreak = 0;
  s.instances[key] = r;
  writeAll(s);
  return r;
}

function getRecord(instanceId) {
  return readAll().instances[String(instanceId || 'default')] || null;
}

module.exports = { STABLE_MS, MAX_UNSTABLE, stabilityPath, classifyRun, decideRollback, noteStart, noteExit, getRecord };
