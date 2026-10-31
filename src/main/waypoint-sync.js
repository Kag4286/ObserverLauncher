// src/main/waypoint-sync.js — Import and export waypoints for Xaero's Minimap & JourneyMap (v7.0.0Z Track 2).
const fs = require('fs');
const path = require('path');
const { readWaypoints, writeWaypoints } = require('./worldmap.js');
const { writeFileAtomic } = require('./fs-utils.js');

const XAERO_HEX = [
  '#000000', '#0000AA', '#00AA00', '#00AAAA',
  '#AA0000', '#AA00AA', '#FFAA00', '#AAAAAA',
  '#555555', '#5555FF', '#55FF55', '#55FFFF',
  '#FF5555', '#FF55FF', '#FFFF55', '#FFFFFF',
];

function hexToRgb(hex) {
  const clean = String(hex || '').replace('#', '').trim();
  if (clean.length === 3) {
    const r = parseInt(clean[0] + clean[0], 16);
    const g = parseInt(clean[1] + clean[1], 16);
    const b = parseInt(clean[2] + clean[2], 16);
    return { r, g, b };
  }
  if (clean.length >= 6) {
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    return { r, g, b };
  }
  return { r: 59, g: 130, b: 246 };
}

function findClosestXaeroColor(hex) {
  const { r, g, b } = hexToRgb(hex);
  let bestIdx = 9; // default light blue
  let bestDist = Infinity;
  for (let i = 0; i < XAERO_HEX.length; i++) {
    const c = hexToRgb(XAERO_HEX[i]);
    const dist = (r - c.r) ** 2 + (g - c.g) ** 2 + (b - c.b) ** 2;
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function parseXaero(text, defaultDim = 'overworld') {
  if (typeof text !== 'string') return [];
  const lines = text.split(/\r?\n/);
  const out = [];
  let seq = 1;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const parts = trimmed.split(':');
    if (parts[0] !== 'waypoint' || parts.length < 6) continue;
    const name = parts[1] || 'Waypoint';
    const x = Number(parts[3]);
    const y = Number(parts[4]);
    const z = Number(parts[5]);
    if (!Number.isFinite(x) || !Number.isFinite(z)) continue;
    const colorIdx = parseInt(parts[6], 10);
    const color = (Number.isInteger(colorIdx) && colorIdx >= 0 && colorIdx < XAERO_HEX.length)
      ? XAERO_HEX[colorIdx]
      : '#3B82F6';
    out.push({
      id: `xaero_${Date.now()}_${seq++}`,
      name,
      x: Math.round(x),
      y: Number.isFinite(y) ? Math.round(y) : 64,
      z: Math.round(z),
      color,
      dim: defaultDim,
    });
  }
  return out;
}

function serializeXaero(waypoints) {
  const list = Array.isArray(waypoints) ? waypoints : [];
  const lines = [
    '#',
    '#waypoint:name:initials:x:y:z:color:disabled:type:setrotation:rotate_on_tp:tp_yaw:visibility_type',
    '#',
  ];
  for (const w of list) {
    const name = String(w.name || 'Waypoint').replace(/:/g, '_');
    const init = name.charAt(0).toUpperCase() || 'W';
    const x = Math.round(w.x || 0);
    const y = Math.round(w.y ?? 64);
    const z = Math.round(w.z || 0);
    const col = findClosestXaeroColor(w.color);
    lines.push(`waypoint:${name}:${init}:${x}:${y}:${z}:${col}:false:0:0:false:0:0`);
  }
  return lines.join('\r\n') + '\r\n';
}

function parseJourneyMap(input, defaultDim = 'overworld') {
  let data = input;
  if (typeof input === 'string') {
    try { data = JSON.parse(input); } catch { return []; }
  }
  const arr = Array.isArray(data) ? data : [data];
  const out = [];
  let seq = 1;
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const x = Number(item.x);
    const z = Number(item.z);
    if (!Number.isFinite(x) || !Number.isFinite(z)) continue;
    const y = Number.isFinite(Number(item.y)) ? Math.round(Number(item.y)) : 64;
    const name = String(item.name || item.id || 'Waypoint');
    let r = item.r ?? 59, g = item.g ?? 130, b = item.b ?? 246;
    const hex = `#${Math.max(0, Math.min(255, r)).toString(16).padStart(2, '0')}${Math.max(0, Math.min(255, g)).toString(16).padStart(2, '0')}${Math.max(0, Math.min(255, b)).toString(16).padStart(2, '0')}`;
    let dim = defaultDim;
    if (Array.isArray(item.dimensions) && item.dimensions.length) {
      const d = String(item.dimensions[0]);
      if (d.includes('nether')) dim = 'nether';
      else if (d.includes('end')) dim = 'end';
      else dim = 'overworld';
    }
    out.push({
      id: `jm_${Date.now()}_${seq++}`,
      name,
      x: Math.round(x),
      y,
      z: Math.round(z),
      color: hex,
      dim,
    });
  }
  return out;
}

function serializeJourneyMap(waypoints) {
  const list = Array.isArray(waypoints) ? waypoints : [];
  const jmList = list.map(w => {
    const rgb = hexToRgb(w.color);
    const dimId = w.dim === 'nether' ? 'minecraft:the_nether' : w.dim === 'end' ? 'minecraft:the_end' : 'minecraft:overworld';
    return {
      id: String(w.name || 'Waypoint').toLowerCase().replace(/\s+/g, '_'),
      name: String(w.name || 'Waypoint'),
      icon: 'waypoint-normal.png',
      x: Math.round(w.x || 0),
      y: Math.round(w.y ?? 64),
      z: Math.round(w.z || 0),
      r: rgb.r,
      g: rgb.g,
      b: rgb.b,
      enable: true,
      type: 'Normal',
      origin: 'observerlauncher',
      dimensions: [dimId],
    };
  });
  return JSON.stringify(jmList, null, 2);
}

function mergeWaypoints(existing, incoming) {
  const merged = [...(Array.isArray(existing) ? existing : [])];
  let added = 0;
  for (const inc of incoming) {
    if (!inc || !Number.isFinite(inc.x) || !Number.isFinite(inc.z)) continue;
    const exists = merged.some(e => {
      const sameDim = (e.dim || 'overworld') === (inc.dim || 'overworld');
      const dist = Math.hypot((e.x || 0) - inc.x, (e.z || 0) - inc.z);
      const sameName = String(e.name || '').toLowerCase() === String(inc.name || '').toLowerCase();
      return sameDim && (dist < 2 || sameName);
    });
    if (!exists) {
      merged.push(inc);
      added++;
    }
  }
  return { merged, addedCount: added };
}

async function importWaypoints(root, { format, data, dim = 'overworld' }) {
  if (!root) return { ok: false, error: 'No server folder selected.' };
  let parsed = [];
  if (format === 'xaero') {
    parsed = parseXaero(String(data || ''), dim);
  } else if (format === 'journeymap') {
    parsed = parseJourneyMap(data, dim);
  } else {
    // Autodetect: JSON vs text
    const str = String(data || '').trim();
    if (str.startsWith('{') || str.startsWith('[')) {
      parsed = parseJourneyMap(str, dim);
    } else {
      parsed = parseXaero(str, dim);
    }
  }
  if (!parsed.length) return { ok: false, error: 'No valid waypoints found in imported data.' };
  const current = readWaypoints(root);
  const { merged, addedCount } = mergeWaypoints(current, parsed);
  const writeRes = writeWaypoints(root, merged);
  if (!writeRes.ok) return writeRes;
  return { ok: true, added: addedCount, total: merged.length, waypoints: merged };
}

async function exportWaypoints(root, { format = 'xaero', dim = null }) {
  if (!root) return { ok: false, error: 'No server folder selected.' };
  let all = readWaypoints(root);
  if (dim) {
    all = all.filter(w => (w.dim || 'overworld') === dim);
  }
  if (format === 'journeymap') {
    return { ok: true, format: 'journeymap', data: serializeJourneyMap(all), count: all.length };
  }
  return { ok: true, format: 'xaero', data: serializeXaero(all), count: all.length };
}

module.exports = {
  XAERO_HEX,
  hexToRgb,
  findClosestXaeroColor,
  parseXaero,
  serializeXaero,
  parseJourneyMap,
  serializeJourneyMap,
  mergeWaypoints,
  importWaypoints,
  exportWaypoints,
};

