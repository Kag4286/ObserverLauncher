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

// B1 (v3.0.0): no top-level electron require (throws in plain Node). dataDir() resolves the cache
// root; net/BrowserWindow are required LAZILY inside the GUI-only paths that actually use them.
const fs = require('fs');
const path = require('path');
const { dataDir } = require('./data-dir.js');
const { singleton: modsIndex } = require('./mods-index.js');

const RAW_BASE = 'https://raw.githubusercontent.com/PrismarineJS/minecraft-assets/master/data';
// item/block icons; armor layer 1 (helmet/chest/boots) and layer 2 (leggings); itemmod reads a
// texture from the server's own mods/*.jar (the mirror is vanilla-only, so a modded server's
// inventory was all text labels before this).
const KINDS = ['item', 'block', 'armor', 'armorlegs', 'itemmod'];

// The mirror lags the game: 26.3 shipped but PrismarineJS had only extracted up to 26.1, so a
// request for data/26.3/items/diamond_sword.png 404s and EVERY icon renders blank. Item textures
// change very little between patch releases, so fall back to the newest version the mirror DOES
// have. Ordered newest-first; the first entry is the fallback target.
const MIRROR_VERSIONS = ['26.1', '1.21.11', '1.21.10', '1.21.9', '1.21.8', '1.21.7', '1.21.6', '1.21.5', '1.21.4', '1.21.1', '1.20.2'];
const DEFAULT_VERSION = MIRROR_VERSIONS[0];

// Which mirror version to fetch from for a server running `wanted`. The exact version if the
// mirror has it, otherwise the NEAREST one it does -- picking the newest overall would send a
// 1.21.2 server all the way to 26.1 when 1.21.4 is one patch away.
function mirrorVersion(wanted) {
  const v = String(wanted || '');
  if (!v) return DEFAULT_VERSION;
  if (MIRROR_VERSIONS.includes(v)) return v;
  const key = parseVersion(v);
  if (!key) return DEFAULT_VERSION;
  let best = null, bestDist = Infinity;
  for (const cand of MIRROR_VERSIONS) {
    const c = parseVersion(cand);
    if (!c) continue;
    // Same major.minor line first (1.21.2 -> 1.21.4), then anything, nearest by distance.
    const sameLine = c.major === key.major && c.minor === key.minor;
    const dist = sameLine ? Math.abs(c.patch - key.patch) : 1000 + Math.abs(c.major - key.major) * 100 + Math.abs(c.minor - key.minor);
    if (dist < bestDist) { bestDist = dist; best = cand; }
  }
  return best || DEFAULT_VERSION;
}
function parseVersion(v) {
  const m = /^(\d+)\.(\d+)(?:\.(\d+))?/.exec(String(v || ''));
  if (!m) return null;
  return { major: +m[1], minor: +m[2], patch: +(m[3] || 0) };
}

let serverNames = () => [];
let notifyIcon = null;
let modsDirOf = () => null;
const inflight = new Set();

// 1×1 TRANSPARENT PNG — served on a cache miss instead of a 404 so the DevTools console isn't
// spammed with failed icon loads while the real icon downloads in the background.
//
// The previous constant decoded to a solid BLUE pixel (RGBA 0,0,255,127), not a transparent
// one, so every unresolved icon rendered as a flat blue square — which is exactly what the
// Player Inspector showed for a whole inventory on a server whose version the mirror lacks.
// Verified: this one inflates to scanline [0,0,0,0,0] -> RGBA(0,0,0,0).
const PLACEHOLDER_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=',
  'base64'
);

function broadcast(channel, payload) {
  if (typeof notifyIcon === 'function') { notifyIcon(channel, payload); return; }
  try {
    const { BrowserWindow } = require('electron');
    if (!BrowserWindow) return;
    for (const w of BrowserWindow.getAllWindows()) { try { w.webContents.send(channel, payload); } catch {} }
  } catch { /* headless: no windows to notify */ }
}
function init({ serverNames: getNames, notify, modsDir }) {
  if (typeof getNames === 'function') serverNames = getNames;
  if (typeof notify === 'function') notifyIcon = notify;
  // A getter, not a path: the active instance can change while the app runs, so the mods folder
  // must be re-read per request. Returning null disables the itemmod kind gracefully.
  if (typeof modsDir === 'function') modsDirOf = modsDir;
}

// "paper-26.3.jar" → "26.3", "minecraft_server.1.21.4.jar" → "1.21.4", else null.
function detectMcVersion(names) {
  for (const n of names || []) {
    const m = String(n).match(/\b(1\.\d{1,2}(?:\.\d{1,2})?|26\.\d{1,2}(?:\.\d{1,2})?)\b/);
    if (m) return m[1];
  }
  return null;
}

function cacheRoot() { return path.join(dataDir(), 'textures'); }

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
  // Split BEFORE decoding: an itemmod name may contain an encoded slash (%2F), and decoding the
  // whole pathname first would turn it into a path separator and break the two-part shape.
  const parts = u.pathname.split('/').filter(Boolean).map(s => { try { return decodeURIComponent(s); } catch { return s; } });
  if (parts.length !== 2) return new Response('', { status: 400 });
  const [kind, rawFile] = parts;
  if (!KINDS.includes(kind)) return new Response('', { status: 400 });
  // itemmod files are written as <namespace>_<name>.png because a tex:// path segment cannot
  // contain a slash. Every other kind keeps the strict lower-case name-only pattern.
  const file = String(rawFile).toLowerCase();
  const fileOk = kind === 'itemmod'
    ? /^[a-z0-9_.-]+~[a-z0-9_./-]+\.png$/.test(file) && !file.includes('..')
    : /^[a-z0-9_-]+\.png$/.test(file) && !file.includes('..');
  if (!fileOk) return new Response('', { status: 400 });

  const version = u.hostname === 'auto'
    ? (detectMcVersion(serverNames()) || DEFAULT_VERSION)
    : u.hostname;

  const local = resolveLocal(version, kind, file);
  if (local) return pngResponse(local);

  // Mod textures come from a jar on disk, not the network. Try it synchronously: the index is
  // session-cached and a hit is instant, so the first paint of an inventory renders correctly
  // without the placeholder flash the remote path needs.
  if (kind === 'itemmod') {
    const buf = readModTexture(file);
    if (buf && buf.length) {
      const dest = path.join(cacheRoot(), version, kind, file);
      try { fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, buf); } catch {}
      return new Response(buf, { headers: { 'content-type': 'image/png', 'cache-control': 'no-store' } });
    }
    return new Response(PLACEHOLDER_PNG, { headers: { 'content-type': 'image/png', 'cache-control': 'no-store' } });
  }

  queueRemote(version, kind, file); // fire-and-forget: next render hits the cache
  // Transparent 1×1 instead of 404: no console error spam, no broken-image flash. The renderer
  // re-renders icon grids when the real icon lands (icons:update event + ?e= cache-buster).
  return new Response(PLACEHOLDER_PNG, { headers: { 'content-type': 'image/png', 'cache-control': 'no-store' } });
}

// Mojang moved the humanoid armor textures in 1.21.2:
//   before 1.21.2  textures/models/armor/<mat>_layer_1.png   (+ _layer_2 = leggings)
//   1.21.2+        textures/entity/equipment/humanoid/<mat>.png (+ humanoid_leggings/)
// The mirror keeps the same split, so a 1.21.4+ server 404s on the OLD path -- which is exactly
// what the player inspector asked for, so the 3D model rendered with no armor at all.
// Compare (major, minor, patch) numerically: "1.9.4" must not sort above "1.21.2", and 26.x must.
function newArmorLayout(version) {
  const m = /^(\d+)\.(\d+)(?:\.(\d+))?/.exec(String(version || ''));
  if (!m) return true; // unrecognised id (custom build) -> try the current layout, then the old
  const major = +m[1], minor = +m[2], patch = +(m[3] || 0);
  if (major !== 1) return major > 1;
  if (minor !== 21) return minor > 21;
  return patch >= 2;
}

// [directory, filename suffix] pairs to try, this version's own layout first. The second entry
// is the other layout, so a jar whose version was misdetected (renamed jar, custom id) still
// gets its armor -- one reload later, since a miss only queues a background fetch.
function armorCandidates(version, legs) {
  const layer = legs ? 2 : 1;
  const build = modern => modern
    ? [`entity/equipment/${legs ? 'humanoid_leggings' : 'humanoid'}`, '']
    : ['models/armor', `_layer_${layer}`];
  return newArmorLayout(version) ? [build(true), build(false)] : [build(false), build(true)];
}

function queueRemote(version, kind, file) {
  const key = `${version}/${kind}/${file}`;
  if (inflight.has(key)) return;
  inflight.add(key);
  (async () => {
    const mat = file.replace(/\.png$/, '');
    // Mirror version first, then the fallback (26.3 -> 26.1). Each may also need the other
    // armor layout, so build the full candidate list up front and stop at the first hit.
    const targets = [version, mirrorVersion(version)].filter((v, i, a) => v && a.indexOf(v) === i);
    const urls = [];
    for (const v of targets) {
      if (kind === 'armor' || kind === 'armorlegs') {
        for (const [dir, sfx] of armorCandidates(v, kind === 'armorlegs')) {
          urls.push([`${RAW_BASE}/${encodeURIComponent(v)}/${dir}/${mat}${sfx}.png`, v]);
        }
      } else {
        const folder = kind === 'item' ? 'items' : kind === 'block' ? 'blocks' : null;
        if (!folder) return;
        urls.push([`${RAW_BASE}/${encodeURIComponent(v)}/${folder}/${file}`, v]);
      }
    }
    // Cache under the version the renderer asked for, so the next request hits resolveLocal
    // without another round trip.
    for (const [url] of urls) {
      if (await fetchInto(url, kind, file, version)) {
        broadcast('icons:update', { rel: `${version}/${kind}/${file}` });
        return;
      }
    }
  })().catch(() => {}).finally(() => inflight.delete(key));
}

async function fetchInto(url, kind, file, version) {
  // GUI-only: net is an Electron module. Headless has no icon fetcher, so the request is skipped.
  const { net } = require('electron');
  if (!net || typeof net.fetch !== 'function') return false;
  let r;
  try { r = await net.fetch(url); } catch { return false; }
  if (!r.ok) return false;
  const buf = Buffer.from(await r.arrayBuffer());
  if (!buf.length) return false;
  const dest = path.join(cacheRoot(), version, kind, file);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
  return true;
}

// Split an itemmod filename `<namespace>~<name>.png` back into its parts. The tilde is the
// separator because it is not valid in a resource location, so it cannot appear inside the
// namespace or the item name (both allow underscores: cofh_core, diamond_sword). Returns null on
// a malformed name.
function splitModFile(file) {
  const base = String(file || '').replace(/\.png$/, '');
  const i = base.indexOf('~');
  if (i <= 0 || i === base.length - 1) return null;
  return { namespace: base.slice(0, i), name: base.slice(i + 1) };
}

// Read a mod texture through the singleton index. The dir comes from the getter because the active
// instance can change; readTexture caches per session and drops the cache on a folder signature
// change, so a mod update is picked up on the next request.
function readModTexture(file) {
  const parts = splitModFile(file);
  if (!parts) return null;
  let dir = null;
  try { dir = modsDirOf(); } catch { dir = null; }
  modsIndex.setModsDir(dir);
  return modsIndex.readTexture(parts.namespace, parts.name);
}

module.exports = { init, handle, detectMcVersion, newArmorLayout, armorCandidates, mirrorVersion, MIRROR_VERSIONS, splitModFile };
