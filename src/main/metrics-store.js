// metrics-store.js — persistent on-disk history for server metrics (5.4.0; v6.0.0 D1 long retention).
//
// WHY: the in-memory metricsLong ring resets on every app restart, so a 24h chart needs disk
// persistence. v6.0.0 also wants 7d / 30d ranges; storing raw 10s samples for 30 days would be a
// huge file, so this module keeps THREE tiers, each its own file:
//   <dataDir>/metrics/<id>.jsonl     raw 10s samples, kept 24h        (the existing store)
//   <dataDir>/metrics/<id>.1m.jsonl  one averaged sample per MINUTE,  kept 7 days
//   <dataDir>/metrics/<id>.1h.jsonl  one averaged sample per HOUR,    kept 30 days
// A rollup sample is closed (appended) when its minute/hour changes, so a 30d file is ~720 lines.
// loadSamples picks the tier that fits the requested window. Raw writes are BUFFERED (flush 1/min);
// rollups are a single small append per minute/hour. Bad lines are skipped, never fatal.
const fs = require('fs');
const path = require('path');
const { dataDir } = require('./data-dir.js');
const { writeFileAtomic } = require('./fs-utils.js');

const RETENTION_MS = 24 * 60 * 60 * 1000;          // raw: 24h
const RETENTION_MINUTE_MS = 7 * 24 * 60 * 60 * 1000; // 1m rollup: 7 days
const RETENTION_HOUR_MS = 30 * 24 * 60 * 60 * 1000;  // 1h rollup: 30 days
const FLUSH_INTERVAL_MS = 60 * 1000;
const TRIM_INTERVAL_MS = 60 * 60 * 1000;
// Trim the raw file once it holds more than this many lines (2x the 24h sample count).
const TRIM_LINE_THRESHOLD = 17280;
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
// Trim thresholds for the rollups: a little over the kept window in lines, so a trim runs rarely.
const MINUTE_TRIM_LINES = 2 * (RETENTION_MINUTE_MS / MINUTE_MS); // ~20160
const HOUR_TRIM_LINES = 2 * (RETENTION_HOUR_MS / HOUR_MS);       // ~1440

// Only [A-Za-z0-9_-] is allowed in a file name. Instance ids are 4 random bytes hex, so this is
// belt-and-braces: a future id scheme or a hand-edited store can never escape the metrics folder.
function safeId(id) {
  const s = String(id == null ? '' : id).trim();
  if (/^[A-Za-z0-9_-]{1,64}$/.test(s)) return s;
  return 'x' + require('crypto').createHash('sha1').update(s || 'default').digest('hex').slice(0, 16);
}

function metricsDir() {
  const dir = path.join(dataDir(), 'metrics');
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* best-effort; append will surface a real error */ }
  return dir;
}

function metricsPath(id) { return path.join(metricsDir(), safeId(id) + '.jsonl'); }
function minutePath(id) { return path.join(metricsDir(), safeId(id) + '.1m.jsonl'); }
function hourPath(id) { return path.join(metricsDir(), safeId(id) + '.1h.jsonl'); }

// id -> buffer state. `lines` is the buffered raw samples; `minute`/`hour` are the OPEN rollup
// accumulators for this instance.
const buffers = new Map();

function bufferFor(id) {
  const key = safeId(id);
  let b = buffers.get(key);
  if (!b) { b = { lines: [], lastFlush: Date.now(), lastTrim: Date.now(), minute: null, hour: null }; buffers.set(key, b); }
  return b;
}

function flushBuffer(key, b) {
  if (!b.lines.length) return;
  const payload = b.lines.join('\n') + '\n';
  b.lines = [];
  b.lastFlush = Date.now();
  try { fs.appendFileSync(metricsPath(key), payload); } catch { /* disk full / permission: drop this batch, keep sampling */ }
}

// Average the numeric fields of one sample into a rollup accumulator, tracking which fields had a
// value (so a metric the server never reported stays null instead of becoming a fake 0).
function accum(acc, sample) {
  for (const k of ['tps', 'mspt', 'cpu', 'ram', 'players']) {
    const v = sample[k];
    if (typeof v === 'number' && Number.isFinite(v)) { acc.sum[k] += v; acc.seen[k] = true; }
  }
  acc.n += 1;
}
function freshAcc(t, sizeMs) {
  const bucket = Math.floor(t / sizeMs) * sizeMs;
  return { bucket, t: bucket, n: 0, sum: { tps: 0, mspt: 0, cpu: 0, ram: 0, players: 0 }, seen: {} };
}
function accToSample(acc) {
  if (!acc || acc.n === 0) return null;
  const out = { t: acc.t };
  for (const k of ['tps', 'mspt', 'cpu', 'ram', 'players']) out[k] = acc.seen[k] ? +(acc.sum[k] / acc.n).toFixed(3) : null;
  return out;
}
function closeAcc(file, acc) {
  const s = accToSample(acc);
  if (!s) return;
  try { fs.appendFileSync(file, JSON.stringify(s) + '\n'); } catch { /* drop this bucket */ }
}

// Roll one sample into the minute and hour accumulators, closing the previous bucket when it ends.
function rollup(b, key, sample) {
  const t = Number(sample.t);
  // minute bucket
  const mBucket = Math.floor(t / MINUTE_MS) * MINUTE_MS;
  if (!b.minute || b.minute.bucket !== mBucket) {
    if (b.minute && b.minute.n > 0) closeAcc(minutePath(key), b.minute);
    b.minute = freshAcc(t, MINUTE_MS);
  }
  accum(b.minute, sample);
  // hour bucket
  const hBucket = Math.floor(t / HOUR_MS) * HOUR_MS;
  if (!b.hour || b.hour.bucket !== hBucket) {
    if (b.hour && b.hour.n > 0) closeAcc(hourPath(key), b.hour);
    b.hour = freshAcc(t, HOUR_MS);
  }
  accum(b.hour, sample);
}

// Buffer one sample. Writes raw only when the flush interval has elapsed; closes a rollup bucket
// when the minute/hour changes; trims hourly. Safe to call at the 10s sample rate.
function recordSample(id, sample) {
  if (!sample || !Number.isFinite(Number(sample.t))) return;
  const key = safeId(id);
  const b = bufferFor(key);
  try { b.lines.push(JSON.stringify(sample)); } catch { return; }
  const now = Date.now();
  if (now - b.lastFlush >= FLUSH_INTERVAL_MS) flushBuffer(key, b);
  try { rollup(b, key, sample); } catch {}
  if (now - b.lastTrim >= TRIM_INTERVAL_MS) {
    b.lastTrim = now;
    try { trimStore(key, RETENTION_MS); } catch {}
    try { trimFile(minutePath(key), RETENTION_MINUTE_MS, MINUTE_TRIM_LINES); } catch {}
    try { trimFile(hourPath(key), RETENTION_HOUR_MS, HOUR_TRIM_LINES); } catch {}
  }
}

// Flush every pending buffer AND close the open rollup buckets (so the last minute/hour is saved
// on quit instead of being lost). Call on app quit.
function flushAll() {
  for (const [key, b] of buffers) {
    try { flushBuffer(key, b); } catch { /* ignore */ }
    try { if (b.minute && b.minute.n > 0) { closeAcc(minutePath(key), b.minute); b.minute = null; } } catch {}
    try { if (b.hour && b.hour.n > 0) { closeAcc(hourPath(key), b.hour); b.hour = null; } } catch {}
  }
}

// Normalise a parsed line into the sample shape (numeric fields or null).
function normSample(s) {
  return { t: Number(s.t), tps: s.tps ?? null, mspt: s.mspt ?? null, cpu: s.cpu ?? null, ram: s.ram ?? null, players: s.players ?? null };
}
function readFileSamples(file, cutoff) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return []; }
  const out = [];
  for (const line of text.split('\n')) {
    if (!line) continue;
    let s; try { s = JSON.parse(line); } catch { continue; }
    if (!s || !Number.isFinite(Number(s.t))) continue;
    if (Number(s.t) < cutoff) continue;
    out.push(normSample(s));
  }
  return out;
}

// Load samples for a window, from the tier that fits it: raw <=24h, 1m <=7d, 1h <=30d. Oldest first.
// Skips blank/corrupt lines. Returns [] on any error.
function loadSamples(id, maxAgeMs) {
  const age = Number(maxAgeMs) || RETENTION_MS;
  const file = age <= RETENTION_MS ? metricsPath(id)
    : age <= RETENTION_MINUTE_MS ? minutePath(id)
    : hourPath(id);
  const cutoff = Date.now() - age;
  const out = readFileSamples(file, cutoff);
  out.sort((a, b) => a.t - b.t);
  return out;
}

// Rewrite a JSONL file keeping only samples newer than keepMs. Atomic (writeFileAtomic). No-ops when
// the file is missing or below `minLines` (so a short file is never rewritten).
function trimFile(file, keepMs, minLines) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return; }
  const lines = text.split('\n').filter(Boolean);
  if (lines.length < (minLines || TRIM_LINE_THRESHOLD)) return;
  const cutoff = Date.now() - (Number(keepMs) || RETENTION_MS);
  const kept = [];
  for (const line of lines) {
    let s; try { s = JSON.parse(line); } catch { continue; }
    if (s && Number.isFinite(Number(s.t)) && Number(s.t) >= cutoff) kept.push(line);
  }
  // Never let a trim wipe a store that is young but somehow large: keep the newest line regardless.
  if (!kept.length && lines.length) kept.push(lines[lines.length - 1]);
  writeFileAtomic(file, kept.join('\n') + (kept.length ? '\n' : ''));
}

// Rewrite the raw store keeping only samples newer than keepMs (legacy signature kept for callers).
function trimStore(id, keepMs) { trimFile(metricsPath(id), keepMs, TRIM_LINE_THRESHOLD); }

// Drop all three files + any buffered state when an instance is removed.
function deleteStore(id) {
  const key = safeId(id);
  buffers.delete(key);
  for (const f of [metricsPath(key), minutePath(key), hourPath(key)]) { try { fs.rmSync(f, { force: true }); } catch { /* ignore */ } }
}

// Test-only: clear all buffers so one test cannot leak into the next.
function _resetBuffers() { buffers.clear(); }

module.exports = {
  metricsDir, metricsPath, minutePath, hourPath, recordSample, flushAll, loadSamples, trimStore, trimFile, deleteStore,
  RETENTION_MS, RETENTION_MINUTE_MS, RETENTION_HOUR_MS, FLUSH_INTERVAL_MS, TRIM_INTERVAL_MS, TRIM_LINE_THRESHOLD,
  MINUTE_TRIM_LINES, HOUR_TRIM_LINES, _resetBuffers,
};
