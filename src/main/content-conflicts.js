// content-conflicts.js — Scan server mods and plugins for issues before start (v6.1.0).
// Identifies duplicate jars (same modId), wrong-loader jars, missing required dependencies,
// incompatible mod pairs, and client-only mods.
const fs = require('fs');
const path = require('path');
const { openJar, openJarFromBuffer } = require('./jar-read.js');
const { classifyJar, selectLoaderProfile } = require('./mod-metadata.js');
const { serverFiles } = require('./server-files.js');
const { detectServerTarget, LOADER_FAMILY } = require('./server-compat.js');
const { readJsonList } = require('./fs-utils.js');
const { missingDependencies, conflictingDependencies } = require('../mcp/modpack-plan.js');
const { checkMcCompat } = require('./mc-compat.js');

function extractEmbeddedIds(jar, cls) {
  const embeddedIds = new Set();
  if (!jar || typeof jar.readBuffer !== 'function') return [];
  const candidates = new Set((cls && cls.embeddedJarPaths) || []);
  if (typeof jar.list === 'function') {
    for (const entryName of jar.list()) {
      if (/^META-INF\/(?:jars|jarjar)\/[^/]+\.jar$/i.test(entryName)) candidates.add(entryName);
    }
  }
  let count = 0;
  for (const rel of candidates) {
    if (count >= 128) break;
    count++;
    const subRes = jar.readBuffer(rel);
    if (!subRes || !subRes.ok || !subRes.data) continue;
    try {
      const subJar = openJarFromBuffer(subRes.data);
      if (subJar.error) continue;
      const subCls = classifyJar(subJar.read, path.basename(rel));
      if (subCls.modId) embeddedIds.add(String(subCls.modId).toLowerCase());
      for (const p of subCls.provides || []) embeddedIds.add(String(p).toLowerCase());
    } catch {}
  }
  return Array.from(embeddedIds);
}

const _classifyCache = new Map();
function safeClassify(folder, fileName, serverLoader) {
  try {
    const filePath = path.join(folder, fileName);
    let mtime = null;
    let size = null;
    try {
      if (fs.existsSync(filePath)) {
        const st = fs.statSync(filePath);
        mtime = st.mtimeMs;
        size = st.size;
      }
    } catch {}
    let cls = null;
    if (mtime !== null && size !== null) {
      const cached = _classifyCache.get(filePath);
      if (cached && cached.mtime === mtime && cached.size === size) {
        cls = cached.cls;
      }
    }
    if (!cls) {
      const jar = openJar(filePath);
      if (jar && jar.error) {
        cls = { _jarError: jar.error, name: null, version: null, loader: null, modId: null };
      } else {
        cls = classifyJar(jar.read, fileName);
        cls.embeddedIds = extractEmbeddedIds(jar, cls);
      }
      if (mtime !== null && size !== null) _classifyCache.set(filePath, { mtime, size, cls });
    }
    if (cls._jarError) return cls;
    const out = serverLoader ? selectLoaderProfile({ ...cls }, serverLoader) : { ...cls };
    return out;
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

function collectFolderEntries(folder, fileList, kind, disabledScanned, issues, serverLoader) {
  const active = [];
  for (const name of fileList) {
    const isDisabled = /\.disabled$/i.test(name);
    const cls = safeClassify(folder, name, kind === 'mod' ? serverLoader : null);
    if (!cls) continue;
    if (isDisabled) {
      if (!cls._jarError) disabledScanned.push({ name, cls });
      continue;
    }
    if (cls._jarError) {
      issues.push({
        fileName: name,
        kind,
        type: 'corrupt-jar',
        detail: cls._jarError === 'not-a-zip'
          ? 'File is not a valid JAR/ZIP archive (corrupt or incomplete download).'
          : `Could not read JAR file (${cls._jarError}).`
      });
      continue;
    }
    active.push({ name, cls });
  }
  return active;
}

function recordModPresence(cls, name, state) {
  const mid = cls.modId ? String(cls.modId).toLowerCase() : null;
  if (mid) {
    state.present.add(mid);
    if (mid === 'fabric-api' || mid === 'fabric' || mid === 'quilted_fabric_api') {
      state.hasFabricApi = true;
      state.present.add('fabric-api');
      state.present.add('fabric');
    }
    if (!state.idToFiles.has(mid)) state.idToFiles.set(mid, []);
    state.idToFiles.get(mid).push({ fileName: name, kind: 'mod', title: cls.name || cls.modId });
  }
  for (const p of cls.provides || []) {
    const pid = String(p).toLowerCase();
    state.present.add(pid);
    if (pid === 'fabric-api' || pid === 'fabric') state.hasFabricApi = true;
  }
  for (const eid of cls.embeddedIds || []) state.present.add(String(eid).toLowerCase());
  if (cls.requiresFabricApi) state.fabricApiRequirers.push({ from: cls.modId || name, fileName: name });
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

  const scanned = [];
  const disabledScanned = [];
  const idToFiles = new Map();
  const present = new Set();
  const declared = [];
  const issues = [];
  const modState = { present, idToFiles, hasFabricApi: false, fabricApiRequirers: [] };

  // 1. Scan active mods (and capture disabled mod display metadata without flagging conflicts)
  const activeMods = collectFolderEntries(path.join(root, 'mods'), f.mods || [], 'mod', disabledScanned, issues, server.loader);
  for (const { name, cls } of activeMods) {
    if (!cls.env) cls.env = manifestEnv[String(name).toLowerCase()] || cls.envHint || null;
    scanned.push({ name, kind: 'mod', cls });
    recordModPresence(cls, name, modState);

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

    // v6.1.6: verify Minecraft version compatibility (respects cross-patch bridges).
    // Authoritative metadata (mods.toml/fabric.mod.json/mcmod.info) is used for hard conflict errors;
    // filename hints alone are not treated as hard conflicts.
    if (server.mc) {
      const mcCheck = checkMcCompat(server.mc, cls.mcVersionRange || cls.mcHint);
      cls.mcCompatibility = mcCheck;
      if (mcCheck.compatible === false && cls.mcSource === 'metadata') {
        issues.push({
          fileName: name,
          kind: 'mod',
          type: 'mc-incompatible',
          declaredRange: cls.mcVersionRange,
          serverMc: server.mc,
          detail: mcCheck.note || `Incompatible with Minecraft ${server.mc}.`
        });
      }
    }

    for (const d of cls.dependencies || []) {
      declared.push(normalizeDep(cls.modId || name, name, 'mod', d));
    }
  }

  // 2. Scan plugins (and capture disabled plugin metadata)
  const activePlugins = collectFolderEntries(path.join(root, 'plugins'), f.plugins || [], 'plugin', disabledScanned, issues);
  for (const { name, cls } of activePlugins) {
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
  if (['fabric', 'quilt'].includes(server.loader) && !modState.hasFabricApi && modState.fabricApiRequirers.length) {
    const firstReq = modState.fabricApiRequirers[0];
    const extraCount = modState.fabricApiRequirers.length - 1;
    missing.push({
      modId: 'fabric-api',
      versionRange: '*',
      neededBy: firstReq.fileName,
      neededByAll: [...new Set(modState.fabricApiRequirers.map(r => r.fileName).filter(Boolean))],
      detailSuffix: extraCount > 0 ? ` (needed by ${modState.fabricApiRequirers.length} mods)` : ''
    });
  }
  for (const m of missing) {
    const affectedFiles = Array.isArray(m.neededByAll) && m.neededByAll.length ? m.neededByAll : (m.neededBy ? [m.neededBy] : []);
    const multiSuffix = !m.detailSuffix && affectedFiles.length > 1 ? ` (needed by ${affectedFiles.length} mods)` : (m.detailSuffix || '');
    issues.push({
      fileName: m.neededBy,
      affectedFiles,
      type: 'missing-dep',
      requiredModId: m.modId,
      versionRange: m.versionRange,
      detail: `Missing required dependency: ${m.modId}${m.versionRange && m.versionRange !== '*' ? ` (${m.versionRange})` : ''}${multiSuffix}.`
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

  const metadata = {};
  for (const item of [...scanned, ...disabledScanned]) {
    if (item.cls && !item.cls._jarError) {
      metadata[item.name] = {
        name: item.cls.name || null,
        version: item.cls.version || null,
        loader: item.cls.loader || null,
        loaders: Array.isArray(item.cls.loaders) ? item.cls.loaders : (item.cls.loader ? [item.cls.loader] : []),
        modId: item.cls.modId || null,
        provides: Array.isArray(item.cls.provides) ? item.cls.provides : [],
        embeddedIds: Array.isArray(item.cls.embeddedIds) ? item.cls.embeddedIds : [],
      };
    }
  }

  return {
    ok: issues.length === 0,
    server: { mc: server.mc, loader: server.loader },
    scannedCount: scanned.length,
    issues,
    duplicates,
    missingDependencies: missing,
    conflicts,
    metadata
  };
}

module.exports = { scanContentConflicts, safeClassify, recordModPresence };
