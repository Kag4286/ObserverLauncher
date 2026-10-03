// datapack.js (v3.3.0): helpers to inspect + validate a Minecraft datapack.
//
// WHY: a datapack declares the pack_format it targets in pack.mcmeta. Installing one built for a
// different pack_format either silently does nothing or crashes world load, and the AI/user had no
// way to check. The PURE part (parsePackMeta/formatRange/classifyFormat) is testable; readPackFormat
// does the I/O for both a FOLDER datapack (pack.mcmeta file) and a .zip datapack (zip entry, via
// jar-read which reads any zip).
const fs = require('fs');
const path = require('path');

// pack_format -> the Minecraft range it belongs to. Conservative: only versions we are sure of. A
// format NOT in this table is reported as UNKNOWN (never guessed), so the tool cannot give a wrong
// 'ok' on a future/modded version.
const FORMAT_RANGES = [
  { fmt: 4, mc: '1.14–1.14.4' },
  { fmt: 5, mc: '1.15–1.16.1' },
  { fmt: 6, mc: '1.16.2–1.16.5' },
  { fmt: 7, mc: '1.17–1.17.1' },
  { fmt: 8, mc: '1.18–1.18.2' },
  { fmt: 9, mc: '1.19–1.19.3' },
  { fmt: 10, mc: '1.19.4' },
  { fmt: 12, mc: '1.20–1.20.1' },
  { fmt: 15, mc: '1.20.2' },
  { fmt: 18, mc: '1.20.3–1.20.4' },
  { fmt: 22, mc: '1.20.5–1.20.6' },
  { fmt: 32, mc: '1.21' },
  { fmt: 41, mc: '1.21.1' },
];
// MC version -> the pack_format a datapack must declare. Best-effort; only the versions above.
const MC_TO_FORMAT = {
  '1.14': 4, '1.14.4': 4, '1.15': 5, '1.15.2': 5, '1.16.1': 5, '1.16.2': 6, '1.16.5': 6,
  '1.17': 7, '1.17.1': 7, '1.18': 8, '1.18.2': 8, '1.19': 9, '1.19.3': 9, '1.19.4': 10,
  '1.20': 12, '1.20.1': 12, '1.20.2': 15, '1.20.3': 18, '1.20.4': 18, '1.20.5': 22, '1.20.6': 22,
  '1.21': 32, '1.21.1': 41,
};

// PURE: parse a pack.mcmeta JSON text. Returns { format, supported, error? }. `pack.pack_format` is
// the declared format; `pack.supported_formats` (1.20.2+) may be a number or [min,max].
function parsePackMeta(text) {
  let obj;
  try { obj = JSON.parse(text); } catch { return { format: null, supported: null, error: 'pack.mcmeta is not valid JSON.' }; }
  const pack = obj && obj.pack;
  if (!pack || typeof pack !== 'object') return { format: null, supported: null, error: 'pack.mcmeta has no "pack" object.' };
  const fmt = Number(pack.pack_format);
  let supported = null;
  if (Array.isArray(pack.supported_formats)) supported = pack.supported_formats.map(Number);
  else if (Number.isFinite(Number(pack.supported_formats))) supported = [Number(pack.supported_formats), Number(pack.supported_formats)];
  return { format: Number.isFinite(fmt) ? fmt : null, supported, error: null };
}

// PURE: the MC range a pack_format belongs to, or null when unknown.
function formatRange(fmt) {
  const n = Number(fmt);
  const hit = FORMAT_RANGES.find(r => r.fmt === n);
  return hit ? { min: n, max: n, label: hit.mc } : null;
}
// PURE: the pack_format the given MC version expects, or null when unknown.
function formatForMc(mc) {
  const v = String(mc || '').trim();
  return MC_TO_FORMAT[v] != null ? MC_TO_FORMAT[v] : null;
}

// PURE verdict. meta = parsePackMeta() result; mc = server MC version (e.g. '1.20.1').
// Returns { level: 'ok'|'warn'|'unknown', expected?, declared?, note }.
function classifyFormat(meta, mc) {
  if (!meta || meta.format == null) return { level: 'unknown', note: 'No pack_format declared (or pack.mcmeta missing).' };
  const expected = formatForMc(mc);
  const range = formatRange(meta.format);
  const supported = Array.isArray(meta.supported) ? meta.supported : null;
  // supported_formats spans a range the pack accepts - honour it first.
  if (supported && supported.length === 2 && expected != null && expected >= supported[0] && expected <= supported[1]) {
    return { level: 'ok', declared: meta.format, expected, note: `Pack supports formats ${supported[0]}–${supported[1]}; server ${mc} needs ${expected}.` };
  }
  if (expected == null) return { level: 'unknown', declared: meta.format, note: `Server MC ${mc || 'unknown'} is not in the known pack_format table - check manually.` };
  if (meta.format === expected) return { level: 'ok', declared: meta.format, expected, note: `Pack format ${meta.format} matches server ${mc}.` };
  if (range) return { level: 'warn', declared: meta.format, expected, note: `Pack is for ${range.label} (format ${meta.format}) but this server is ${mc} (needs format ${expected}).` };
  return { level: 'warn', declared: meta.format, expected, note: `Pack format ${meta.format} does not match server ${mc} (needs format ${expected}).` };
}

// IO: read pack.mcmeta from a FOLDER datapack (a file) or a .zip datapack (a zip entry).
// Returns { ok, text } or { ok:false, error }.
function readPackMeta(targetAbs, isDir) {
  if (isDir) {
    const f = path.join(targetAbs, 'pack.mcmeta');
    try { return { ok: true, text: fs.readFileSync(f, 'utf8') }; } catch { return { ok: false, error: 'No pack.mcmeta in this datapack folder.' }; }
  }
  try { const { readJarEntry } = require('./jar-read.js'); const r = readJarEntry(targetAbs, 'pack.mcmeta'); return r.ok ? { ok: true, text: r.content } : { ok: false, error: 'No pack.mcmeta in this .zip.' }; }
  catch (e) { return { ok: false, error: e?.message || 'Could not read the .zip.' }; }
}

module.exports = { FORMAT_RANGES, MC_TO_FORMAT, parsePackMeta, formatRange, formatForMc, classifyFormat, readPackMeta };
