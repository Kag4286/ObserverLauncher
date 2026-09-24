// src/mcp/modpack-plan.js — pure helpers for the MCP modpack planner/assembler.
//
// WHY: an AI can already install one item at a time, but building a whole modpack that way means
// one GUI confirmation per file (30 mods = 30 dialogs) and no upfront compatibility view. This
// module holds the PURE decision logic (folder mapping, compatibility, dependency de-duplication)
// so it is unit-testable without network or Electron; the tools in tools.js do the I/O.
//
// Design rule: the AI chooses WHAT (ids/source/version) and this code decides HOW. The AI never
// supplies a raw URL or hash — those are always resolved here from the registry.
const path = require('path');

// Where a given kind installs, relative to the server root. Mirrors the mapping the GUI
// (marketplace.js market:install) and the MCP install tools already use, so nothing drifts.
function folderForKind(kind, levelName) {
  if (kind === 'datapack') return path.join(levelName || 'world', 'datapacks');
  if (kind === 'mod' || kind === 'forge' || kind === 'fabric' || kind === 'neoforge') return 'mods';
  return 'plugins';
}

// Fabric and Quilt are interchangeable at the loader level; so are Forge/NeoForge only loosely —
// we keep them distinct (NeoForge is not a drop-in for a Forge-only mod in general).
const LOADER_FAMILY = {
  paper: ['paper', 'spigot', 'purpur', 'folia', 'bukkit'],
  forge: ['forge'],
  neoforge: ['neoforge'],
  fabric: ['fabric', 'quilt'],
  quilt: ['fabric', 'quilt'],
};

// Compatibility of one resolved item against the detected server.
//   item:   { kind, gameVersions?: string[], loaders?: string[], env?: { server?: string } }
//   server: { mc: string|null, loader: string|null }  (from modpacks.detectServerCompat)
// Returns { ok, warnings: string[] } where warnings use stable codes the tool maps to text.
function itemCompat(item, server) {
  const warnings = [];
  const srv = server || {};
  const it = item || {};
  // MC version mismatch: only when BOTH sides are known (unknown is not a warning).
  if (srv.mc && Array.isArray(it.gameVersions) && it.gameVersions.length && !it.gameVersions.includes(srv.mc)) warnings.push('mc');
  // Loader mismatch: only meaningful for mod-like kinds and a known server loader.
  const fam = LOADER_FAMILY[srv.loader];
  if (fam && Array.isArray(it.loaders) && it.loaders.length) {
    const ok = it.loaders.some(l => fam.includes(l));
    if (!ok) warnings.push('loader');
  }
  // Modrinth marks server-unsupported mods explicitly; installing those does nothing or breaks start.
  if (it.env && it.env.server === 'unsupported') warnings.push('clientOnly');
  return { ok: warnings.length === 0, warnings };
}

// De-duplicate a planned list by (source, id) keeping the first occurrence. Order-preserving so the
// plan reads top-down as the user will see it.
function dedupeById(items) {
  const seen = new Set();
  const out = [];
  for (const it of items || []) {
    const key = (it.source || 'modrinth') + ':' + String(it.id || '');
    if (!it.id || seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

// Cap a plan so a runaway goal/dependency walk cannot queue an unbounded batch. Pure guard so the
// tool can report what it trimmed.
function capPlan(items, max) {
  const lim = Math.max(1, Number(max) || 50);
  const list = items || [];
  return { items: list.slice(0, lim), trimmed: Math.max(0, list.length - lim) };
}

// Item-vs-ITEM conflict detection for a plan (A3). The per-item itemCompat() only compares an
// item against the SERVER; two items can still clash with each other (same project twice at
// different versions, two files landing on the same path, or a Modrinth 'incompatible' relation).
// Pure so it is unit-testable. Returns { conflicts: [{ code, a, b, detail }] }.
function planConflicts(items) {
  const list = items || [];
  const conflicts = [];
  // (1) same (source, id) resolved to two different versions.
  const byKey = new Map();
  for (const it of list) {
    const key = (it.source || 'modrinth') + ':' + String(it.id || '');
    const prev = byKey.get(key);
    if (prev && prev.version && it.version && prev.version !== it.version) {
      conflicts.push({ code: 'duplicate-version', a: prev.id, b: it.id, detail: `${key} planned at both ${prev.version} and ${it.version}` });
    }
    if (!prev) byKey.set(key, it);
  }
  // (2) two different projects writing the SAME file (folder + filename) - one overwrites the other.
  const byFile = new Map();
  for (const it of list) {
    if (!it.filename) continue;
    const fileKey = String(it.folder || '') + '/' + String(it.filename).toLowerCase();
    const prev = byFile.get(fileKey);
    if (prev && ((prev.source || 'modrinth') + ':' + prev.id) !== ((it.source || 'modrinth') + ':' + it.id)) {
      conflicts.push({ code: 'duplicate-file', a: prev.id, b: it.id, detail: `${fileKey} would be written by two projects` });
    }
    if (!prev) byFile.set(fileKey, it);
  }
  // (3) Modrinth relationType 'incompatible' surfaced earlier as a warning on the entry.
  for (const it of list) {
    if (Array.isArray(it.warnings) && it.warnings.includes('incompatible')) {
      conflicts.push({ code: 'incompatible', a: it.id, b: null, detail: `${(it.source || 'modrinth') + ':' + it.id} declares an incompatible relation` });
    }
  }
  return { conflicts };
}

// Plan-LEVEL warnings that need the whole list (A5). itemCompat stays item-vs-server; this looks
// across the plan + a couple of server facts the caller passes in. Pure. Returns { warnings: [] }
// with stable codes.
//   opts: { hasProxy?: boolean, serverJava?: number|null }
function planWarnings(items, server, opts) {
  const list = items || [];
  const o = opts || {};
  const srv = server || {};
  const warnings = [];
  const isModLike = it => ['mod', 'forge', 'fabric', 'neoforge'].includes(it.kind);
  // (a) Fabric/Quilt server with mods but no Fabric API in the plan -> many mods silently no-op.
  if (['fabric', 'quilt'].includes(srv.loader)) {
    const mods = list.filter(isModLike);
    const hasApi = list.some(it => /fabric[-_ ]?api/i.test(String(it.id || '') + ' ' + String(it.title || '') + ' ' + String(it.filename || '')));
    if (mods.length && !hasApi) warnings.push({ code: 'fabricApiMissing', detail: 'Fabric/Quilt server has mods but no Fabric API in the plan.' });
  }
  // (b) A proxy (Velocity/Bungee) does not load server mods itself - those belong on the backend.
  if (o.hasProxy && list.some(isModLike)) warnings.push({ code: 'proxy', detail: 'A proxy config was found; server mods install on the backend server, not the proxy.' });
  // (c) Java requirement per item, only when both the registry field and server Java are known.
  if (Number.isInteger(o.serverJava)) {
    for (const it of list) {
      if (Number.isInteger(it.javaRequired) && it.javaRequired > o.serverJava) {
        warnings.push({ code: 'java', detail: `${(it.source || 'modrinth') + ':' + it.id} needs Java ${it.javaRequired}+, server has ${o.serverJava}.` });
      }
    }
  }
  return { warnings };
}

module.exports = { folderForKind, itemCompat, dedupeById, capPlan, planConflicts, planWarnings, LOADER_FAMILY };
