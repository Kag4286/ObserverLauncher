// modpack-resolve.js — turn a modpack.json into a resolved item list for the static verifier
// (v3.2.0, CI/CD for modpacks).
//
// WHY: verifyManifest() in modpack-manifest.js only reasons about data - it needs RESOLVED items
// (with real gameVersions/loaders/filename) to run the HARD loader/MC gate and the same-file conflict
// check. This module does the network part. It deliberately does NOT re-implement any registry logic:
// it reuses marketplace.js resolveMarketDownload() (the SAME resolver the GUI install + the MCP
// install_from_market tool use), so a manifest verifies against exactly what would be installed.
//
// Design rule (mirrors modpack-plan.js): the manifest chooses WHAT (id/source/kind); the resolver
// decides HOW (url/hash/version) - a raw url or hash in the manifest is NEVER trusted.
//
// Testability: the per-item resolver is INJECTABLE (opts.resolve), so unit tests run against fixtures
// with no live network. Network calls (when used) go through marketplace.js -> http.js (SSRF-guarded).
const { folderForKind } = require('../mcp/modpack-plan.js');

// Normalize an item's kind to the set resolveMarketDownload expects (it defaults unknown to 'plugin';
// we keep 'mod' distinct so a mod jar lands in mods/, not plugins/).
function normalizeKind(kind) {
  return ['mod', 'plugin', 'datapack', 'modpack', 'forge', 'fabric', 'neoforge'].includes(kind) ? kind : 'mod';
}

// Resolve ONE manifest item to the shape verifyManifest() consumes. `resolve` is injected so tests can
// stub it. Returns the resolved item, or throws (the caller captures per-item errors).
//   item: { id, source?, kind?, version?, versionId?, title? }
//   deps: marketplace.resolveMarketDownload(item) -> { url, filename, source, gameVersions, loaders, ... }
async function resolveItem(item, resolve, levelName) {
  const source = item.source || 'modrinth';
  const kind = normalizeKind(item.kind);
  const dl = await resolve({ id: item.id, source, kind, version: item.version, versionId: item.versionId, title: item.title });
  return {
    id: item.id,
    source,
    kind,
    folder: folderForKind(kind, levelName),
    filename: dl.filename || null,
    url: dl.url || null,
    hashes: dl.hashes || null,
    size: dl.size || 0,
    version: dl.versionNumber || item.version || null,
    // The verifier's HARD gate needs these; the resolver already returns them for Modrinth/CurseForge.
    gameVersions: Array.isArray(dl.gameVersions) ? dl.gameVersions : [],
    loaders: Array.isArray(dl.loaders) ? dl.loaders : [],
    dependencies: Array.isArray(dl.dependencies) ? dl.dependencies : [],
  };
}

// Resolve every item in a manifest. Per-item failures are COLLECTED, not thrown, so verify can report
// the good items plus the ones that could not be resolved (a CurseForge key missing, a 404, ...).
//   opts: { resolve?: fn, levelName?: string, onProgress?: (done, total) => void }
// Returns { items: [...], errors: [{ id, source, code, error }] }.
async function resolveManifest(manifest, opts) {
  const o = opts || {};
  // Lazy default so this module has no hard dependency at require time (keeps it cheap to load in
  // headless/CI where no resolution happens).
  const resolve = o.resolve || require('./marketplace.js').resolveMarketDownload;
  const items = Array.isArray(manifest && manifest.items) ? manifest.items : [];
  const out = [];
  const errors = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i] || {};
    try {
      out.push(await resolveItem(it, resolve, o.levelName));
    } catch (e) {
      errors.push({ id: it.id || null, source: it.source || 'modrinth', code: (e && e.code) || null, error: (e && e.message) || String(e) });
    }
    if (typeof o.onProgress === 'function') o.onProgress(i + 1, items.length);
  }
  return { items: out, errors };
}

module.exports = { resolveManifest, resolveItem, normalizeKind };
