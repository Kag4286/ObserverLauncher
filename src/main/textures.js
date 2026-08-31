// tex:// — version-aware item/block icon protocol.
//
// Why: item icons used to be hardcoded to the single bundled set (assets/textures/26.2), so a
// future Minecraft version (e.g. 26.3) with new items showed blank icons until a new launcher
// release shipped new PNGs. This module serves icons through tex://<version|auto>/item|x/<id>.png:
//   1. userData/textures/<version>/<kind>/<file>   — on-demand cache, filled from (2)
//   2. raw.githubusercontent.com/PrismarineJS/minecraft-assets (data/<v>/items|blocks/) —
//      fetched lazily PER ICON on first miss (no bulk download), then cached forever.
// A miss serves a transparent 1x1 placeholder (200) while the real icon downloads in the
// background; the very next render shows it. NOTE: brand-new versions appear upstream only
// after PrismarineJS extracts them; until then icons stay transparent.
// NO Mojang assets are bundled in this repository — everything is fetched to the user's
// machine at runtime from the public PrismarineJS mirror.
//
// Mojang asset note: textures are fetched to the USER'S machine at runtime from the public
// PrismarineJS mirror — nothing is redistributed inside this repository.

const { app, net, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const DEFAULT_VERSION = '26.1'; // newest version the PrismarineJS mirror reliably has
const RAW_BASE = 'https://raw.githubusercontent.com/PrismarineJS/minecraft-assets/master/data';

let serverNames = () => [];
let notifyIcon = null;
const inflight = new Set();

// 1×1 transparent PNG — served on a cache miss instead of a 404 so the DevTools console isn't
// spammed with failed icon loads while the real icon downloads in the background.
const PLACEHOLDER_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

function broadcast(channel, payload) {
  if (typeof notifyIcon === 'function') { notifyIcon(channel, payload); return; }
  for (const w of BrowserWindow.getAllWindows()) { try { w.webContents.send(channel, payload); } catch {} }
}
function init({ serverNames: getNames, notify }) {
  if (typeof getNames === 'function') serverNames = getNames;
  if (typeof notify === 'function') notifyIcon = notify;
}

// "paper-26.3.jar" → "26.3", "minecraft_server.1.21.4.jar" → "1.21.4", else null.
function detectMcVersion(names) {
  for (const n of names || []) {
    const m = String(n).match(/\b(1\.\d{1,2}(?:\.\d{1,2})?|26\.\d{1,2}(?:\.\d{1,2})?)\b/);
    if (m) return m[1];
  }
  return null;
}

function cacheRoot() { return path.join(app.getPath('userData'), 'textures'); }

// kind is the renderer's singular form ('item'|'block'); both cache and bundled use that layout.
function resolveLocal(version, kind, file) {
  if (!version) return null;
  const p = path.join(cacheRoot(), version, kind, file);
  try { if (fs.existsSync(p) && fs.statSync(p).isFile()) return p; } catch {}
  return null;
}

function pngResponse(file) {
  try { return new Response(fs.readFileSync(file), { headers: { 'content-type': 'image/png' } }); }
  catch { return new Response('', { status: 404 }); }
}

function handle(request) {
  let u;
  try { u = new URL(request.url); } catch { return new Response('', { status: 400 }); }
  const parts = decodeURIComponent(u.pathname).split('/').filter(Boolean);
  if (parts.length !== 2) return new Response('', { status: 400 });
  const [kind, rawFile] = parts;
  if (kind !== 'item' && kind !== 'block') return new Response('', { status: 400 });
  const file = String(rawFile).toLowerCase();
  if (!/^[a-z0-9_-]+\.png$/.test(file) || file.includes('..')) return new Response('', { status: 400 });

  const version = u.hostname === 'auto'
    ? (detectMcVersion(serverNames()) || DEFAULT_VERSION)
    : u.hostname;

  const local = resolveLocal(version, kind, file);
  if (local) return pngResponse(local);

  queueRemote(version, kind, file); // fire-and-forget: next render hits the cache
  // Transparent 1×1 instead of 404: no console error spam, no broken-image flash. The renderer
  // re-renders icon grids when the real icon lands (icons:update event + ?e= cache-buster).
  return new Response(PLACEHOLDER_PNG, { headers: { 'content-type': 'image/png', 'cache-control': 'no-store' } });
}

function queueRemote(version, kind, file) {
  const key = `${version}/${kind}/${file}`;
  if (inflight.has(key)) return;
  inflight.add(key);
  (async () => {
    const folder = kind === 'item' ? 'items' : 'blocks'; // upstream uses plural names
    const url = `${RAW_BASE}/${encodeURIComponent(version)}/${folder}/${encodeURIComponent(file)}`;
    const r = await net.fetch(url);
    if (!r.ok) return;
    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf.length) return;
    const dest = path.join(cacheRoot(), version, kind, file);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, buf);
    broadcast('icons:update', { rel: `${version}/${kind}/${file}` });
  })().catch(() => {}).finally(() => inflight.delete(key));
}

module.exports = { init, handle, detectMcVersion };
