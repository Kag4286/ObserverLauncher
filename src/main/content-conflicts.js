// content-conflicts.js — Scan server mods and plugins for issues before start (v6.1.0).
// Identifies duplicate jars (same modId), wrong-loader jars, missing required dependencies,
// incompatible mod pairs, and client-only mods.
const path = require('path');
const { openJar } = require('./jar-read.js');
const { classifyJar } = require('./mod-metadata.js');
const { serverFiles } = require('./server-files.js');
const { detectServerTarget, LOADER_FAMILY } = require('./server-compat.js');
const { readJsonList } = require('./fs-utils.js');
const { missingDependencies, conflictingDependencies } = require('../mcp/modpack-plan.js');

function safeClassify(folder, fileName) {
  try {
    const jar = openJar(path.join(folder, fileName));
    return classifyJar(jar.read, fileName);
  } catch {
    return null;
  }
}

function normalizeDep(sourceName, fileName, kind, dep) {
  return {
    from: sourceName,
    fileName,
    kind,
    modId: dep.modId,
    mandatory: !!dep.mandatory,
    optional: !!dep.optional,
    incompatible: !!dep.incompatible,
    reason: dep.reason || null,
    versionRange: dep.versionRange
  };
}

async function scanContentConflicts(root, options = {}) {
  const f = options.files || serverFiles(root);
  const server = options.server || detectServerTarget(root, f);
  const families = LOADER_FAMILY[server.loader] || [];

  const manifestEnv = {};
  try {
    for (const e of readJsonList(root, 'observerlauncher-manifest.json')) {
      if (e && e.fileName && e.env) manifestEnv[String(e.fileName).toLowerCase()] = e.env;
    }
  } catch {}

  const modFiles = (f.mods || []).filter(name => !/\.disabled$/i.test(name));
  const pluginFiles = (f.plugins || []).filter(name => !/\.disabled$/i.test(name));

  const scanned = [];
  const idToFiles = new Map();
  const present = new Set();
  const declared = [];
  const issues = [];

  // 1. Scan mods
  const modsFolder = path.join(root, 'mods');
  for (const name of modFiles) {
    const cls = safeClassify(modsFolder, name);
    if (!cls) continue;
    if (!cls.env) cls.env = manifestEnv[String(name).toLowerCase()] || cls.envHint || null;
    scanned.push({ name, kind: 'mod', cls });

    const mid = cls.modId ? String(cls.modId).toLowerCase() : null;
    if (mid) {
      present.add(mid);
      if (!idToFiles.has(mid)) idToFiles.set(mid, []);
      idToFiles.get(mid).push({ fileName: name, kind: 'mod', title: cls.name || cls.modId });
    }

    if (cls.loader && !cls.loaderGuessed && families.length && !families.includes(cls.loader)) {
      issues.push({
        fileName: name,
        kind: 'mod',
        type: 'loader-mismatch',
        declaredLoader: cls.loader,
        serverLoader: server.loader,
        detail: `Declares ${cls.loader}, but server is ${server.loader}.`
      });
    }

    if (cls.env === 'client-only') {
      issues.push({
        fileName: name,
        kind: 'mod',
        type: 'client-only',
        detail: 'Client-only mod (has no server-side effect).'
      });
    }

    for (const d of cls.dependencies || []) {
      declared.push(normalizeDep(cls.modId || name, name, 'mod', d));
    }
  }

  // 2. Scan plugins
  const pluginsFolder = path.join(root, 'plugins');
  for (const name of pluginFiles) {
    const cls = safeClassify(pluginsFolder, name);
    if (!cls) continue;
    scanned.push({ name, kind: 'plugin', cls });
    const pid = (cls.name || cls.modId) ? String(cls.name || cls.modId).toLowerCase() : null;
    if (pid) {
      present.add(pid);
      if (!idToFiles.has(pid)) idToFiles.set(pid, []);
      idToFiles.get(pid).push({ fileName: name, kind: 'plugin', title: cls.name || cls.modId });
    }

    if (!['paper', 'proxy'].includes(server.loader) && server.loader !== 'vanilla') {
      issues.push({
        fileName: name,
        kind: 'plugin',
        type: 'loader-mismatch',
        declaredLoader: 'paper',
        serverLoader: server.loader,
        detail: `Plugin cannot run on a ${server.loader} server.`
      });
    }

    for (const d of cls.dependencies || []) {
      declared.push(normalizeDep(cls.name || name, name, 'plugin', d));
    }
  }

  // 3. Duplicates
  const duplicates = [];
  for (const [id, list] of idToFiles.entries()) {
    if (list.length > 1) {
      duplicates.push({
        id,
        title: list[0].title || id,
        files: list.map(x => x.fileName),
        kind: list[0].kind
      });
      for (const item of list) {
        issues.push({
          fileName: item.fileName,
          kind: item.kind,
          type: 'duplicate',
          detail: `Duplicate mod/plugin id "${id}" found in multiple files (${list.map(x => x.fileName).join(', ')}).`
        });
      }
    }
  }

  // 4. Missing dependencies & Incompatibilities
  const missing = missingDependencies(declared, present);
  for (const m of missing) {
    issues.push({
      fileName: m.neededBy,
      type: 'missing-dep',
      requiredModId: m.modId,
      versionRange: m.versionRange,
      detail: `Missing required dependency: ${m.modId}${m.versionRange && m.versionRange !== '*' ? ` (${m.versionRange})` : ''}.`
    });
  }

  const conflicts = conflictingDependencies(declared, present);
  for (const c of conflicts) {
    issues.push({
      fileName: c.declaredBy,
      type: 'conflict',
      conflictingModId: c.modId,
      reason: c.reason,
      detail: `Incompatible with installed mod: ${c.modId}${c.reason ? ` (${c.reason})` : ''}.`
    });
  }

  return {
    ok: issues.length === 0,
    server: { mc: server.mc, loader: server.loader },
    scannedCount: scanned.length,
    issues,
    duplicates,
    missingDependencies: missing,
    conflicts
  };
}

module.exports = { scanContentConflicts };
