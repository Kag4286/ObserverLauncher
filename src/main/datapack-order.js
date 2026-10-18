// datapack-order.js — read and write the datapack load order in level.dat (v6.0.0 C5c).
//
// WHY: Minecraft stores which datapacks are enabled and in what order in the world's level.dat,
// under Data.DataPacks.Enabled. There is no per-pack move-up/move-down command in vanilla (the
// /datapack command only enables/disables), and the order matters: a later entry overrides a
// function from an earlier one when both define the same thing. This module exposes that list so
// the GUI can reorder it with arrows, and writes it back the same safe way gamerules.js writes
// GameRules: gzip preserved, backup first, atomic write.
//
// A datapack entry is either 'vanilla' (built into the game), a namespaced builtin like 'fabric'
// (a mod-provided pack), or 'file/<name>' where <name> is the datapack file/folder name WITHOUT
// .zip. The GUI resolves 'file/<name>' against the world's datapacks/ folder.
const fs = require('fs');
const { loadLevel, saveLevelAtomic } = require('./gamerules.js');

const FILE_PREFIX = 'file/';

// PURE: turn a datapack file/folder name into the level.dat entry that names it. A name already
// prefixed is left alone. Empty / non-string -> null.
function buildPackEntry(name) {
  const s = String(name || '').trim();
  if (!s) return null;
  if (s.startsWith(FILE_PREFIX)) return s;
  return FILE_PREFIX + s;
}

// PURE: turn a level.dat entry back into the on-disk datapack name, or null when it is a builtin.
function parsePackEntry(entry) {
  const s = String(entry || '');
  if (!s) return null;
  if (s.startsWith(FILE_PREFIX)) return { kind: 'file', name: s.slice(FILE_PREFIX.length) };
  return { kind: s === 'vanilla' ? 'vanilla' : 'builtin', name: s };
}

// PURE: return a NEW enabled array with `name` moved one slot up (towards the end, where a pack has
// HIGHER priority) or down (towards the start). `name` is the entry as stored (e.g. 'file/foo').
// No-op when the move would leave the array, or when the entry is not present.
function reorderPack(enabled, name, direction) {
  const arr = Array.isArray(enabled) ? enabled.slice() : [];
  const idx = arr.indexOf(String(name || ''));
  if (idx < 0) return arr;
  // 'up' = later in the load order = higher priority = towards the END of the array.
  const target = direction === 'up' ? idx + 1 : direction === 'down' ? idx - 1 : idx;
  if (target < 0 || target >= arr.length || target === idx) return arr;
  const tmp = arr[idx]; arr[idx] = arr[target]; arr[target] = tmp;
  return arr;
}

// PURE: read the Enabled + Disabled lists out of a parsed Data compound. Missing tags -> [].
// Every entry is a plain string in prismarine-nbt (a list-of-string is { type:'string', value:[...] }).
function listsFromData(data) {
  const dp = data && data.DataPacks && data.DataPacks.value;
  const readList = (tag) => {
    if (!tag || !tag.value) return [];
    const v = tag.value;
    // prismarine-nbt represents a list as { type:'string', value:[...] }.
    if (Array.isArray(v)) return v.map(String);
    if (Array.isArray(v.value)) return v.value.map(String);
    return [];
  };
  return {
    enabled: readList(dp && dp.Enabled),
    disabled: readList(dp && dp.Disabled),
  };
}

// Read the current enabled + disabled datapack lists for a world. Read-only, no backup needed.
// Returns { ok, enabled, disabled, source } or the loadLevel error shape.
async function readDatapackOrder(root, levelName) {
  const L = await loadLevel(root, levelName);
  if (!L.ok) return L;
  const { enabled, disabled } = listsFromData(L.data);
  return { ok: true, enabled, disabled, source: require('path').relative(root, L.file) };
}

// Write a new enabled list. Backs up level.dat first. Preserves any Disabled list untouched.
// Returns { ok, enabled, backup } on success, or the loadLevel error shape.
async function writeDatapackOrder(root, levelName, enabled) {
  const L = await loadLevel(root, levelName);
  if (!L.ok) return L;
  const { file, rootTag, data, isGzip } = L;
  const arr = (Array.isArray(enabled) ? enabled : []).map(String);
  const cur = listsFromData(data).enabled;
  if (arr.length === cur.length && arr.every((v, i) => v === cur[i])) {
    return { ok: true, enabled: cur, backup: null };
  }
  const backup = `${file}.bak-${Date.now()}`;
  try { fs.copyFileSync(file, backup); } catch { return { ok: false, error: 'backup' }; }
  // Ensure DataPacks compound exists, and set Enabled as a list-of-string. Leave Disabled alone.
  if (!data.DataPacks || !data.DataPacks.value || typeof data.DataPacks.value !== 'object') {
    data.DataPacks = { type: 'compound', name: 'DataPacks', value: {} };
  }
  data.DataPacks.value.Enabled = { type: 'list', name: 'Enabled', value: { type: 'string', value: arr } };
  const saved = saveLevelAtomic({ file, rootTag, isGzip });
  if (!saved.ok) return saved;
  return { ok: true, enabled: arr, backup };
}

module.exports = { FILE_PREFIX, buildPackEntry, parsePackEntry, reorderPack, listsFromData, readDatapackOrder, writeDatapackOrder };
