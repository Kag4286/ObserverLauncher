// modpack-manifest.js — modpack.json schema + static verification (v3.2.0, CI/CD for modpacks).
//
// WHY: 3.0.0-3.1.0 made a server runnable headless + in Docker, and the MCP planner (modpack-plan.js)
// can already resolve, filter and de-duplicate a batch of mods. What was missing is a DECLARATIVE,
// version-controlled description of a modpack ("modpack.json") that CI can verify on every PR BEFORE
// anything downloads a gigabyte of jars. This module is the pure core of that: it validates the
// schema and cross-checks a manifest against an already-RESOLVED item list + a target server.
//
// PURE by design (no network, no Electron): resolution (calling Modrinth/Hangar) happens in the
// caller; here we only reason about the data. This mirrors modpack-plan.js so it is unit-testable in
// `npm test` and usable from both the CLI and a GitHub Action.
//
// Layers reuse (do NOT re-implement):
//   - modpack-plan.js: itemCompat / filterPlan / planConflicts / planWarnings / dedupeById / capPlan /
//     missingDependencies.
//   - server-compat.js: versionMatchesServer (the HARD loader/MC gate filterPlan needs).
const plan = require('../mcp/modpack-plan.js');
const { versionMatchesServer } = require('./server-compat.js');

// Loaders a manifest may declare. Matches the adapter/software ids used everywhere else.
const KNOWN_LOADERS = ['vanilla', 'paper', 'purpur', 'leaf', 'folia', 'spigot', 'fabric', 'quilt', 'forge', 'neoforge', 'proxy'];
// Kinds a manifest item may declare. Matches folderForKind's inputs.
const KNOWN_KINDS = ['mod', 'plugin', 'datapack', 'modpack'];
// Hard cap on items so a runaway manifest cannot queue an unbounded batch (mirrors capPlan default).
const MAX_ITEMS = 500;

// Validate the modpack.json SCHEMA only (shape, required fields, enum membership). No registry access.
// Returns { ok, errors: [{ code, path, detail }] }. Stable `code`s so CI can grep them.
function validateManifest(manifest) {
  const errors = [];
  const add = (code, path, detail) => errors.push({ code, path, detail });
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    add('not-an-object', '', 'modpack.json must be a JSON object.');
    return { ok: false, errors };
  }
  if (typeof manifest.name !== 'string' || !manifest.name.trim()) add('name-missing', 'name', 'name is required (non-empty string).');
  if (typeof manifest.version !== 'string' || !manifest.version.trim()) add('version-missing', 'version', 'version is required (non-empty string).');
  if (manifest.minecraft !== undefined && (typeof manifest.minecraft !== 'string' || !manifest.minecraft.trim())) {
    add('minecraft-invalid', 'minecraft', 'minecraft must be a non-empty string when present.');
  }
  if (manifest.loader !== undefined && !KNOWN_LOADERS.includes(String(manifest.loader))) {
    add('loader-unknown', 'loader', `loader "${manifest.loader}" is not one of: ${KNOWN_LOADERS.join(', ')}.`);
  }
  if (manifest.items !== undefined && !Array.isArray(manifest.items)) {
    add('items-not-array', 'items', 'items must be an array when present.');
  }
  const items = Array.isArray(manifest.items) ? manifest.items : [];
  if (items.length > MAX_ITEMS) add('items-too-many', 'items', `items has ${items.length} entries; the maximum is ${MAX_ITEMS}.`);
  items.forEach((it, i) => {
    const p = `items[${i}]`;
    if (!it || typeof it !== 'object' || Array.isArray(it)) { add('item-not-object', p, 'each item must be an object.'); return; }
    if (typeof it.id !== 'string' || !it.id.trim()) add('item-id-missing', p + '.id', 'item id is required (non-empty string).');
    if (it.kind !== undefined && !KNOWN_KINDS.includes(String(it.kind))) {
      add('item-kind-unknown', p + '.kind', `kind "${it.kind}" is not one of: ${KNOWN_KINDS.join(', ')}.`);
    }
    if (it.source !== undefined && (typeof it.source !== 'string' || !it.source.trim())) add('item-source-invalid', p + '.source', 'source must be a non-empty string when present.');
  });
  return { ok: errors.length === 0, errors };
}

// Normalize a manifest item into the shape the plan helpers expect. `resolved` (if given) is the
// matching item returned by the registry resolver (carrying gameVersions/loaders/filename/folder/...)
// keyed by source+id; we overlay it so hard filtering has real metadata to work with. When nothing is
// resolved yet (offline verify) we still pass the declared item through, just without registry facts.
function mergeResolved(item, resolvedByKey) {
  const source = item.source || 'modrinth';
  const key = source + ':' + String(item.id);
  const r = resolvedByKey.get(key) || {};
  return { ...item, ...r, source, id: item.id, kind: item.kind || r.kind || 'mod' };
}

// Verify a manifest against the target server. `resolved` is an array of registry-resolved items
// (may be empty for a schema-only / offline check). `server` is { mc, loader } from
// detectServerTarget (or read from the manifest when the server is unknown).
//   opts: { declaredDeps?: [{from,modId,mandatory,...}], present?: string[], serverJava?: number|null,
//           maxItems?: number }
// Returns a stable report object; `ok` is true when there are no schema errors AND no hard rejects AND
// no conflicts (warnings alone do NOT fail unless the caller passes strict).
function verifyManifest(manifest, resolved, server, opts) {
  const o = opts || {};
  const schema = validateManifest(manifest);
  const report = {
    ok: false,
    schema,
    server: null,
    accepted: [],
    rejected: [],
    conflicts: [],
    warnings: [],
    missingDependencies: [],
    trimmed: 0,
    summary: { items: 0, accepted: 0, rejected: 0, conflicts: 0, warnings: 0 },
  };
  if (!schema.ok) { report.summary.items = (manifest && Array.isArray(manifest.items)) ? manifest.items.length : 0; return report; }

  // The server target: prefer an explicit detector result, else derive it from the manifest itself.
  const srv = server || { mc: manifest.minecraft || null, loader: manifest.loader || null };
  report.server = srv;

  // De-dup declared items by (source,id), cap, then overlay resolved metadata.
  const declared = plan.dedupeById(manifest.items || []);
  const capped = plan.capPlan(declared, o.maxItems || MAX_ITEMS);
  report.trimmed = capped.trimmed;
  const resolvedByKey = new Map();
  for (const r of (resolved || [])) {
    if (!r || !r.id) continue;
    resolvedByKey.set((r.source || 'modrinth') + ':' + String(r.id), r);
  }
  const merged = capped.items.map(it => mergeResolved(it, resolvedByKey));

  // HARD loader/MC gate: rejected items are a FAILURE (installing them breaks startup).
  const filtered = plan.filterPlan(merged, srv, versionMatchesServer);
  report.accepted = filtered.accepted;
  report.rejected = filtered.rejected;

  // Item-vs-item conflicts (same file, duplicate version, declared incompatible).
  report.conflicts = plan.planConflicts(filtered.accepted).conflicts;

  // Plan-level warnings (fabric API missing, proxy + mods, per-item Java requirement).
  report.warnings = plan.planWarnings(filtered.accepted, srv, { hasProxy: o.hasProxy, serverJava: o.serverJava }).warnings;

  // Declared jar-metadata dependencies vs the set already present + the plan ids themselves.
  if (Array.isArray(o.declaredDeps) && o.declaredDeps.length) {
    const present = new Set((o.present || []).map(String));
    for (const it of filtered.accepted) { present.add(String(it.id)); present.add(String(it.id).toLowerCase()); }
    report.missingDependencies = plan.missingDependencies(o.declaredDeps, present);
  }

  report.summary = {
    items: merged.length,
    accepted: filtered.accepted.length,
    rejected: filtered.rejected.length,
    conflicts: report.conflicts.length,
    warnings: report.warnings.length + report.missingDependencies.length,
  };
  report.ok = filtered.rejected.length === 0 && report.conflicts.length === 0 && report.missingDependencies.length === 0;
  return report;
}

// One-line human summary for the CLI / CI log.
function summarizeReport(report) {
  if (!report) return 'no report';
  if (!report.schema.ok) return `SCHEMA INVALID — ${report.schema.errors.length} error(s)`;
  const s = report.summary;
  const bits = [`${s.accepted}/${s.items} items ok`];
  if (s.rejected) bits.push(`${s.rejected} rejected`);
  if (s.conflicts) bits.push(`${s.conflicts} conflict(s)`);
  if (report.missingDependencies.length) bits.push(`${report.missingDependencies.length} missing dep(s)`);
  if (s.warnings) bits.push(`${s.warnings} warning(s)`);
  return bits.join(' · ');
}

module.exports = { KNOWN_LOADERS, KNOWN_KINDS, MAX_ITEMS, validateManifest, verifyManifest, summarizeReport };
