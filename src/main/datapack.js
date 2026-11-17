// datapack.js (v3.3.0): helpers to inspect + validate a Minecraft datapack.
//
// WHY: a datapack declares the pack_format it targets in pack.mcmeta. Installing one built for a
// different pack_format either silently does nothing or crashes world load, and the AI/user had no
// way to check. The PURE part (parsePackMeta/formatRange/classifyFormat) is testable; readPackFormat
// does the I/O for both a FOLDER datapack (pack.mcmeta file) and a .zip datapack (zip entry, via
// jar-read which reads any zip).
const fs = require('fs');
const path = require('path');
const { parseLenientJson } = require('./mod-metadata.js');

// Official Minecraft Java Edition Data Pack pack_format table (1.13 through 26.3).
// NOTE: Data pack pack_format differs from Resource Pack pack_format (e.g. 1.21–1.21.1 data = 48, 1.20.5–1.20.6 data = 41).
// A format NOT in this table is reported as UNKNOWN rather than guessed.
const FORMAT_RANGES = [
  { fmt: 4, mc: '1.13–1.14.4' },
  { fmt: 5, mc: '1.15–1.16.1' },
  { fmt: 6, mc: '1.16.2–1.16.5' },
  { fmt: 7, mc: '1.17–1.17.1' },
  { fmt: 8, mc: '1.18–1.18.1' },
  { fmt: 9, mc: '1.18.2' },
  { fmt: 10, mc: '1.19–1.19.3' },
  { fmt: 12, mc: '1.19.4' },
  { fmt: 15, mc: '1.20–1.20.1' },
  { fmt: 18, mc: '1.20.2' },
  { fmt: 26, mc: '1.20.3–1.20.4' },
  { fmt: 41, mc: '1.20.5–1.20.6' },
  { fmt: 48, mc: '1.21–1.21.1' },
  { fmt: 57, mc: '1.21.2–1.21.3' },
  { fmt: 61, mc: '1.21.4' },
  { fmt: 71, mc: '1.21.5' },
  { fmt: 80, mc: '1.21.6' },
  { fmt: 81, mc: '1.21.7–1.21.8' },
  { fmt: 88.0, mc: '1.21.9–1.21.10' },
  { fmt: 94.1, mc: '1.21.11' },
  // 1.21.9+ (25w31a) introduced major.minor formats & min_format / max_format.
  { fmt: 101.1, mc: '26.1–26.1.2' },
  { fmt: 107.1, mc: '26.2' },
  { fmt: 121.0, mc: '26.3' },
];
// MC version -> the data pack pack_format expected by the server.
const MC_TO_FORMAT = {
  '1.13': 4, '1.13.1': 4, '1.13.2': 4,
  '1.14': 4, '1.14.1': 4, '1.14.2': 4, '1.14.3': 4, '1.14.4': 4,
  '1.15': 5, '1.15.1': 5, '1.15.2': 5, '1.16': 5, '1.16.1': 5,
  '1.16.2': 6, '1.16.3': 6, '1.16.4': 6, '1.16.5': 6,
  '1.17': 7, '1.17.1': 7,
  '1.18': 8, '1.18.1': 8, '1.18.2': 9,
  '1.19': 10, '1.19.1': 10, '1.19.2': 10, '1.19.3': 10, '1.19.4': 12,
  '1.20': 15, '1.20.1': 15, '1.20.2': 18,
  '1.20.3': 26, '1.20.4': 26,
  '1.20.5': 41, '1.20.6': 41,
  '1.21': 48, '1.21.1': 48,
  '1.21.2': 57, '1.21.3': 57, '1.21.4': 61, '1.21.5': 71, '1.21.6': 80,
  '1.21.7': 81, '1.21.8': 81, '1.21.9': 88.0, '1.21.10': 88.0, '1.21.11': 94.1,
  '26.1': 101.1, '26.1.1': 101.1, '26.1.2': 101.1, '26.2': 107.1, '26.3': 121.0,
};

// Normalise a format value (number or [major, minor] array) to a float. 1.21.9+ splits the format
// into major.minor, e.g. [101, 1] or 101.1.
function normalizeFormat(v) {
  if (Array.isArray(v)) return v.length ? Number(v[0]) + (Number(v[1]) || 0) / 10 : null;
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Parse into exact [major, minor] tuple for comparison. Per Minecraft Wiki 1.21.9+, a scalar integer
// or single-element [N] in `max_format` matches any minor of major N (minor = Infinity).
function toFormatTuple(v, isMaxScalarWildcard = false) {
  if (Array.isArray(v)) {
    if (!v.length) return null;
    const maj = Number(v[0]);
    if (!Number.isFinite(maj)) return null;
    if (v.length === 1) return [maj, isMaxScalarWildcard ? Infinity : 0];
    const min = Number(v[1]);
    return [maj, Number.isFinite(min) ? min : 0];
  }
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const maj = Math.trunc(n);
  if (Number.isInteger(n) && isMaxScalarWildcard) return [maj, Infinity];
  const min = Number.isInteger(n) ? 0 : Math.round((n - maj) * 10);
  return [maj, min];
}

function cmpTuple(a, b) {
  if (a[0] !== b[0]) return a[0] - b[0];
  return a[1] - b[1];
}

// Parse legacy `supported_formats`: int, [min, max], or { min_inclusive, max_inclusive }.
function parseSupportedFormats(sf) {
  if (Array.isArray(sf)) {
    const arr = sf.map(normalizeFormat).filter(n => n != null);
    if (arr.length === 2) return arr;
    if (arr.length === 1) return [arr[0], arr[0]];
    return null;
  }
  if (sf && typeof sf === 'object') {
    const lo = normalizeFormat(sf.min_inclusive);
    const hi = normalizeFormat(sf.max_inclusive);
    if (lo != null && hi != null) return [lo, hi];
    return null;
  }
  const single = normalizeFormat(sf);
  return single != null ? [single, single] : null;
}

// PURE: parse a pack.mcmeta JSON text. Returns { format, supported, rangeTuples?, error? }.
// 1.21.9+ (26.x) uses min_format / max_format; older packs use pack_format / supported_formats.
function parsePackMeta(text) {
  let obj;
  try { obj = parseLenientJson(text); } catch { return { format: null, supported: null, error: 'pack.mcmeta is not valid JSON.' }; }
  const pack = obj && obj.pack;
  if (!pack || typeof pack !== 'object') return { format: null, supported: null, error: 'pack.mcmeta has no "pack" object.' };
  // 1.21.9+ (26.x) shape.
  const minFmt = normalizeFormat(pack.min_format);
  const maxFmt = normalizeFormat(pack.max_format);
  if (minFmt != null && maxFmt != null) {
    return {
      format: minFmt,
      supported: [minFmt, maxFmt],
      rangeTuples: [toFormatTuple(pack.min_format, false), toFormatTuple(pack.max_format, true)],
      error: null,
    };
  }
  // Legacy shape (1.13 – 1.21.8).
  const supported = parseSupportedFormats(pack.supported_formats);
  const fmt = normalizeFormat(pack.pack_format) ?? minFmt ?? (supported ? supported[0] : null);
  return { format: fmt, supported, error: null };
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

// PURE verdict. meta = parsePackMeta() result; mc = server MC version (e.g. '1.21.1').
// Returns { level: 'ok'|'warn'|'unknown', expected?, declared?, note }.
function classifyFormat(meta, mc) {
  if (!meta || meta.format == null) return { level: 'unknown', note: 'No pack_format declared (or pack.mcmeta missing).' };
  const expected = formatForMc(mc);
  const range = formatRange(meta.format);
  const supported = Array.isArray(meta.supported) ? meta.supported : null;
  const tuples = Array.isArray(meta.rangeTuples) && meta.rangeTuples.length === 2
    ? meta.rangeTuples
    : (supported && supported.length === 2
        ? [toFormatTuple(supported[0], false), toFormatTuple(supported[1], false)]
        : null);
  if (tuples && tuples[0] && tuples[1] && expected != null) {
    const expTuple = toFormatTuple(expected, false);
    if (expTuple && cmpTuple(expTuple, tuples[0]) >= 0 && cmpTuple(expTuple, tuples[1]) <= 0) {
      const r0 = formatRange(supported[0])?.label;
      const r1 = formatRange(supported[1])?.label;
      const mcSpan = r0 && r1 ? ` (${r0 === r1 ? r0 : `${r0} to ${r1}`})` : '';
      return { level: 'ok', declared: meta.format, expected, note: `Pack supports formats ${supported[0]}–${supported[1]}${mcSpan}; server ${mc} needs ${expected}.` };
    }
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

module.exports = { FORMAT_RANGES, MC_TO_FORMAT, normalizeFormat, parsePackMeta, formatRange, formatForMc, classifyFormat, readPackMeta };
