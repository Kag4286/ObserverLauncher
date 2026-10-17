// properties-history.js — keep a short rolling history of server.properties edits (v6.0.0 G2).
//
// WHY: before v6.0.0 every save overwrote server.properties in place with no way back, so a wrong
// value (or a plugin line the UI did not understand) was gone for good. This stores a snapshot
// BEFORE each changed save, in the per-instance data dir (never inside the server folder, so a
// snapshot cannot be scanned as a plugin). The user can list snapshots, see a line diff against the
// current file, and restore one (which itself snapshots the current file first, so a restore is
// reversible too).
//
// Layout: <dataDir>/properties-history/<instanceId>.jsonl  one { t, content } per line, oldest
// first. Kept small (MAX_SNAPSHOTS). Content is the full server.properties text; the file is tiny.
const fs = require('fs');
const path = require('path');
const { dataDir } = require('./data-dir.js');
const { writeFileAtomic } = require('./fs-utils.js');

const MAX_SNAPSHOTS = 20;

function safeId(id) {
  const s = String(id == null ? '' : id).trim();
  if (/^[A-Za-z0-9_-]{1,64}$/.test(s)) return s;
  return 'x' + require('crypto').createHash('sha1').update(s || 'default').digest('hex').slice(0, 16);
}
function historyDir() {
  const d = path.join(dataDir(), 'properties-history');
  try { fs.mkdirSync(d, { recursive: true }); } catch {}
  return d;
}
function historyPath(id) { return path.join(historyDir(), safeId(id) + '.jsonl'); }

function readAll(id) {
  let text;
  try { text = fs.readFileSync(historyPath(id), 'utf8'); } catch { return []; }
  const out = [];
  for (const line of text.split('\n')) {
    if (!line) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    if (o && typeof o.content === 'string' && Number.isFinite(Number(o.t))) out.push({ t: Number(o.t), content: o.content });
  }
  return out;
}
function writeAll(id, list) {
  const trimmed = list.slice(-MAX_SNAPSHOTS);
  writeFileAtomic(historyPath(id), trimmed.map(o => JSON.stringify(o)).join('\n') + (trimmed.length ? '\n' : ''));
}

// Save a snapshot of `content` for this instance. Skips a no-op when the newest snapshot is byte-equal
// (so repeated saves of an unchanged file do not fill the history). Returns { ok, skipped? }.
function recordSnapshot(id, content) {
  const text = String(content == null ? '' : content);
  const list = readAll(id);
  if (list.length && list[list.length - 1].content === text) return { ok: true, skipped: true };
  list.push({ t: Date.now(), content: text });
  writeAll(id, list);
  return { ok: true };
}

// Metadata-only list (no content) for the UI, newest first: { t, size }.
function listSnapshots(id) {
  return readAll(id).slice().reverse().map(o => ({ t: o.t, size: o.content.length }));
}

// Get one snapshot's full content by timestamp. Returns { ok, content } or { ok:false }.
function getSnapshot(id, t) {
  const hit = readAll(id).find(o => o.t === Number(t));
  return hit ? { ok: true, content: hit.content } : { ok: false, error: 'That snapshot no longer exists.' };
}

// Simple line diff (old -> new): returns { added, removed, lines:[{type:'-'|'+'|' ', text}] } using an
// LCS so unchanged lines are marked ' '. Caps the input so a pathological file cannot blow memory.
function diffLines(oldText, newText) {
  const a = String(oldText || '').split(/\r?\n/).slice(0, 4000);
  const b = String(newText || '').split(/\r?\n/).slice(0, 4000);
  const n = a.length, m = b.length;
  // LCS table (n*m up to 4000*4000 is too big; keep it bounded by trimming to a practical size).
  const A = a.slice(0, 1500), B = b.slice(0, 1500);
  const N = A.length, M = B.length;
  const dp = Array.from({ length: N + 1 }, () => new Int32Array(M + 1));
  for (let i = N - 1; i >= 0; i--) for (let j = M - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const lines = []; let added = 0, removed = 0, i = 0, j = 0;
  while (i < N && j < M) {
    if (A[i] === B[j]) { lines.push({ type: ' ', text: A[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { lines.push({ type: '-', text: A[i] }); removed++; i++; }
    else { lines.push({ type: '+', text: B[j] }); added++; j++; }
  }
  while (i < N) { lines.push({ type: '-', text: A[i] }); removed++; i++; }
  while (j < M) { lines.push({ type: '+', text: B[j] }); added++; j++; }
  return { added, removed, lines, truncated: a.length > N || b.length > M };
}

// Delete an instance's history (called when the instance is removed).
function deleteHistory(id) { try { fs.rmSync(historyPath(id), { force: true }); } catch {} }

module.exports = { MAX_SNAPSHOTS, historyPath, recordSnapshot, listSnapshots, getSnapshot, diffLines, deleteHistory, readAll };
