// metrics-store.js — persistent on-disk history for the coarse 10s metrics ring (5.4.0).
//
// WHY: the in-memory metricsLong ring resets on every app restart, so a 24h chart is impossible
// without disk persistence. This module appends samples to a per-instance JSONL file, reloads them
// on boot, and trims old lines. Writes are BUFFERED and flushed at most once per minute so a 10s
// sample rate does not mean 8640 tiny writes/day — it is ~1440 flush operations instead.
//
// Layout: <dataDir>/metrics/<instanceId>.jsonl. One JSON object per line, same shape pushHistory
// already uses ({t, tps, mspt, cpu, ram, players}). Append-only; a periodic trim rewrites the file
// atomically to keep only the retained window. Bad lines are skipped, never fatal.
const fs = require('fs');
const path = require('path');
const { dataDir } = require('./data-dir.js');
const { writeFileAtomic } = require('./fs-utils.js');

// 24h at one sample / 10s = 8640 samples. Keep a little headroom so a trim is not racing the cap.
const RETENTION_MS = 24 * 60 * 60 * 1000;
const FLUSH_INTERVAL_MS = 60 * 1000;
const TRIM_INTERVAL_MS = 60 * 60 * 1000;
// Trim once the file holds more than this many lines (2x the 24h sample count).
const TRIM_LINE_THRESHOLD = 17280;

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

function metricsPath(id) {
  return path.join(metricsDir(), safeId(id) + '.jsonl');
}

// id -> { lines: string[], lastFlush: number, lastTrim: number }
const buffers = new Map();

function bufferFor(id) {
  const key = safeId(id);
  let b = buffers.get(key);
  if (!b) { b = { lines: [], lastFlush: Date.now(), lastTrim: Date.now() }; buffers.set(key, b); }
  return b;
}

function flushBuffer(key, b) {
  if (!b.lines.length) return;
  const payload = b.lines.join('\n') + '\n';
  b.lines = [];
  b.lastFlush = Date.now();
  try { fs.appendFileSync(metricsPath(key), payload); } catch { /* disk full / permission: drop this batch, keep sampling */ }
}

// Buffer one sample. Writes only when the flush interval has elapsed, and trims hourly. Safe to call
// at the 10s sample rate: the common path is a single array push.
function recordSample(id, sample) {
  if (!sample || !Number.isFinite(Number(sample.t))) return;
  const key = safeId(id);
  const b = bufferFor(key);
  try { b.lines.push(JSON.stringify(sample)); } catch { return; }
  const now = Date.now();
  if (now - b.lastFlush >= FLUSH_INTERVAL_MS) flushBuffer(key, b);
  if (now - b.lastTrim >= TRIM_INTERVAL_MS) { b.lastTrim = now; try { trimStore(key, RETENTION_MS); } catch { /* non-fatal */ } }
}

// Flush every pending buffer. Call on app quit so the last minute is not lost.
function flushAll() {
  for (const [key, b] of buffers) { try { flushBuffer(key, b); } catch { /* ignore */ } }
}

// Load samples newer than maxAgeMs, oldest first. Skips blank/corrupt lines. Returns [] on any error.
function loadSamples(id, maxAgeMs) {
  const file = metricsPath(id);
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return []; }
  const cutoff = Date.now() - (Number(maxAgeMs) || RETENTION_MS);
  const out = [];
  for (const line of text.split('\n')) {
    if (!line) continue;
    let s; try { s = JSON.parse(line); } catch { continue; }
    if (!s || !Number.isFinite(Number(s.t))) continue;
    if (Number(s.t) < cutoff) continue;
    out.push({ t: Number(s.t), tps: s.tps ?? null, mspt: s.mspt ?? null, cpu: s.cpu ?? null, ram: s.ram ?? null, players: s.players ?? null });
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

// Rewrite the file keeping only samples newer than keepMs. Atomic (writeFileAtomic), so a crash
// mid-trim cannot truncate the store. No-ops when the file is missing or small enough to skip.
function trimStore(id, keepMs) {
  const file = metricsPath(id);
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return; }
  const lines = text.split('\n').filter(Boolean);
  if (lines.length < TRIM_LINE_THRESHOLD) return;
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

// Drop the file + any buffered lines when an instance is removed.
function deleteStore(id) {
  const key = safeId(id);
  buffers.delete(key);
  try { fs.rmSync(metricsPath(key), { force: true }); } catch { /* ignore */ }
}

// Test-only: clear all buffers so one test cannot leak into the next.
function _resetBuffers() { buffers.clear(); }

module.exports = {
  metricsDir, metricsPath, recordSample, flushAll, loadSamples, trimStore, deleteStore,
  RETENTION_MS, FLUSH_INTERVAL_MS, TRIM_INTERVAL_MS, TRIM_LINE_THRESHOLD, _resetBuffers,
};
