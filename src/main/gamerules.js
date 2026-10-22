// gamerules.js — read and write Minecraft world game rules (v6.0.0 G4).
//
// WHY: game rules (doDaylightCycle, keepInventory, randomTickSpeed, ...) live inside the world's
// level.dat, not in server.properties. There is no vanilla console command to LIST them all, and
// setting them one by one through /gamerule needs the server running. This module reads the whole
// GameRules compound and writes it back, so the UI can show every rule at once and save a batch.
//
// SAFETY: level.dat is the world. Every write copies it to level.dat.bak-<timestamp> FIRST, mutates
// only the GameRules compound, and writes atomically. The original compression (gzip for level.dat)
// is preserved. A rule name is restricted to [A-Za-z0-9_]{1,64} so a hostile value cannot inject a key.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const nbt = require('prismarine-nbt');
const { writeFileAtomic } = require('./fs-utils.js');

// Resolve <root>/<levelName>/level.dat, then the same candidates worldmap.readLevel uses.
function levelDatCandidates(root, levelName) {
  const name = String(levelName || 'world').replace(/[\\/]/g, '') || 'world';
  return [
    path.join(root, name, 'level.dat'),
    path.join(root, 'level.dat'),
  ];
}
function findLevelDat(root, levelName) {
  for (const p of levelDatCandidates(root, levelName)) { try { if (fs.existsSync(p)) return p; } catch {} }
  return null;
}

// A parsed NBT root is { type:'compound', name:'', value:{ Data:{type:'compound', name:'Data', value:{...}} } }.
// Return the Data compound's `value` object (the mutable map), or null when missing.
function dataCompound(rootTag) {
  const v = rootTag && rootTag.value;
  const d = v && v.Data;
  return d && d.value && typeof d.value === 'object' ? d.value : null;
}

// PURE: apply { name: value } to the simplified rules map. Values are coerced to strings (Minecraft
// stores every rule as a string). Returns { ok, rules, changed, skipped, error? }.
const RULE_RE = /^[A-Za-z0-9_]{1,64}$/;
function applyRuleChanges(current, changes) {
  const rules = { ...(current || {}) };
  const changed = [];
  const skipped = [];
  const src = changes && typeof changes === 'object' ? changes : {};
  for (const [k, v] of Object.entries(src)) {
    if (!RULE_RE.test(k)) { skipped.push(k); continue; }
    const val = String(v == null ? '' : v).trim();
    if (!val) { skipped.push(k); continue; }
    if (rules[k] === val) continue;
    rules[k] = val;
    changed.push({ name: k, value: val });
  }
  return { ok: true, rules, changed, skipped };
}

// SHARED: locate + read + parse level.dat and hand back the mutable Data compound. Both readers and
// writers use this so their guard/load sequence cannot drift (gotcha #20).
//   returns { ok:true, file, buf, rootTag, data, isGzip } | { ok:false, error:'noWorld'|'read'|'corrupt' }
async function loadLevel(root, levelName) {
  if (!root) return { ok: false, error: 'noWorld' };
  const file = findLevelDat(root, levelName);
  if (!file) return { ok: false, error: 'noWorld' };
  let buf; try { buf = fs.readFileSync(file); } catch { return { ok: false, error: 'read' }; }
  let parsed; try { parsed = await nbt.parse(buf); } catch { return { ok: false, error: 'corrupt' }; }
  const rootTag = parsed.parsed;
  const data = dataCompound(rootTag);
  if (!data) return { ok: false, error: 'corrupt' };
  // nbt.parse returns { type: 'big'|'little' } (the NBT PROTOCOL, not the compression); detect gzip
  // from the header so a write can preserve the exact format the game expects.
  const isGzip = buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b;
  return { ok: true, file, buf, rootTag, data, isGzip };
}

// PURE: a GameRules NBT compound tag -> a { name: string } map. Handles prismarine-nbt's
// { type:'string', value:'...' } shape and a bare primitive.
function rulesFromGr(grTag) {
  const gr = (grTag && grTag.value && typeof grTag.value === 'object') ? grTag.value : {};
  const rules = {};
  for (const [k, v] of Object.entries(gr)) rules[k] = (v && typeof v === 'object' && 'value' in v) ? String(v.value) : String(v);
  return rules;
}

// Read all game rules for a world. Returns { ok, rules:{name:string}, source } or { ok:false, error }.
async function readGameRules(root, levelName) {
  const L = await loadLevel(root, levelName);
  if (!L.ok) return L;
  return { ok: true, rules: rulesFromGr(L.data.GameRules), source: path.relative(root, L.file) };
}

// SHARED: serialize the (already-mutated) NBT tree back to disk, preserving the original
// compression. Both writeGameRules (G4) and datapack-order.writeDatapackOrder (C5c) write to
// level.dat, so the serialize+atomic-write sequence lives here once (no-dup guard). The caller is
// responsible for taking the backup BEFORE mutating; this function only writes.
// Returns { ok:true } or { ok:false, error }.
function saveLevelAtomic(L) {
  const { file, rootTag, isGzip } = L;
  let out;
  try {
    // Java level.dat is 'big'-endian NBT, usually gzip'd. Write uncompressed big-endian, then gzip
    // if the original was gzip (preserving the format the game expects).
    const raw = nbt.writeUncompressed(rootTag, 'big');
    out = isGzip ? zlib.gzipSync(raw) : raw;
  } catch (e) { return { ok: false, error: e?.message || 'Could not serialize level.dat.' }; }
  try { writeFileAtomic(file, out); } catch (e) { return { ok: false, error: e?.message || 'Could not write level.dat.' }; }
  return { ok: true };
}

const LEVEL_DAT_BACKUP_MAX = 5;
function backupLevelDat(file, maxKeep = LEVEL_DAT_BACKUP_MAX) {
  const backup = `${file}.bak-${Date.now()}`;
  try {
    fs.copyFileSync(file, backup);
    const dir = path.dirname(file);
    const base = path.basename(file);
    const pattern = new RegExp(`^${base.replace(/\./g, '\\.')}\\.bak-\\d+$`);
    const backups = fs.readdirSync(dir).filter(f => pattern.test(f)).sort();
    if (backups.length > maxKeep) {
      for (const old of backups.slice(0, backups.length - maxKeep)) {
        try { fs.rmSync(path.join(dir, old), { force: true }); } catch {}
      }
    }
    return { ok: true, backup };
  } catch {
    return { ok: false, error: 'backup' };
  }
}

// Write a batch of game-rule changes. Backs up level.dat first. Returns { ok, changed, skipped, backup }.
async function writeGameRules(root, levelName, changes) {
  const L = await loadLevel(root, levelName);
  if (!L.ok) return L;
  const { file, rootTag, data, isGzip } = L;
  const res = applyRuleChanges(rulesFromGr(data.GameRules), changes);
  if (!res.changed.length) return { ok: true, changed: [], skipped: res.skipped, backup: null };
  // Backup BEFORE mutating the file.
  const bRes = backupLevelDat(file);
  if (!bRes.ok) return bRes;
  const backup = bRes.backup;
  // Mutate the NBT tree: ensure a GameRules compound exists, then set each changed rule as a string tag.
  if (!data.GameRules || !data.GameRules.value || typeof data.GameRules.value !== 'object') {
    data.GameRules = { type: 'compound', name: 'GameRules', value: {} };
  }
  for (const c of res.changed) data.GameRules.value[c.name] = { type: 'string', value: c.value };
  const saved = saveLevelAtomic({ file, rootTag, isGzip });
  if (!saved.ok) return saved;
  return { ok: true, changed: res.changed, skipped: res.skipped, backup };
}

module.exports = { readGameRules, writeGameRules, applyRuleChanges, findLevelDat, loadLevel, saveLevelAtomic, backupLevelDat, RULE_RE };
