// src/main/gui-doctor.js — v9.1.0 GUI Server Doctor & 1-click missing-dependency bridge.
//
// Reuses the battle-tested pure diagnosis/repair engine (src/mcp/repair.js + src/mcp/tools.js)
// and marketplace resolver (src/main/marketplace.js) so GUI users get the exact same Suggest +
// Confirm repair workflow without requiring MCP to be enabled.
const fs = require('fs');
const path = require('path');
const { serverFiles } = require('./server-files.js');
const { detectServerTarget } = require('./server-compat.js');
const { safeTarget, verifyFileHash, recordManifestEntry } = require('./fs-utils.js');
const { contentFolder } = require('./content-ops.js');
const { ACTION } = require('../mcp/repair.js');

const ALLOWED_DOCTOR_ACTIONS = new Set(Object.values(ACTION));

// Resolve a missing mod/plugin dependency to a concrete Modrinth candidate without installing.
async function resolveMissingDep(ctx, opts = {}, deps = {}) {
  if (!ctx || !ctx.currentServerPath) return { ok: false, error: 'Choose a server folder first.' };
  const modId = String(opts.modId || '').trim();
  if (!modId) return { ok: false, error: 'Missing dependency id.' };
  const info = serverFiles(ctx.currentServerPath);
  const target = detectServerTarget(ctx.currentServerPath, info);
  const loader = opts.loader || (['neoforge', 'forge', 'fabric', 'quilt'].includes(target.loader) ? target.loader : '');
  const kind = opts.kind || (loader ? 'mod' : (info.plugins.length && !info.mods.length ? 'plugin' : 'mod'));
  const findFn = deps.findMarketProject || require('./marketplace.js').findMarketProject;
  const found = await findFn(modId, { loader });
  if (!found || !found.ok || !found.item) {
    return {
      ok: false,
      ambiguous: !!(found && found.ambiguous),
      candidates: (found && found.candidates) || [],
      error: (found && found.error) || `No package found matching "${modId}".`,
    };
  }
  return {
    ok: true,
    item: {
      id: found.item.id,
      title: found.item.title || modId,
      slug: found.item.slug || null,
      source: found.item.source || 'modrinth',
      kind,
      loader: loader || null,
      version: target.mc || null,
    },
  };
}

// Install a user-confirmed missing dependency into mods/ or plugins/ with hash verification.
async function installResolvedDep(ctx, opts = {}, deps = {}) {
  if (!ctx || !ctx.currentServerPath) return { ok: false, error: 'Choose a server folder first.' };
  if (ctx.serverProcess) return { ok: false, error: 'Stop the server before installing dependencies — a running server locks jar files.' };
  const id = String(opts.id || '').trim();
  if (!id) return { ok: false, error: 'Missing project id.' };
  const root = ctx.currentServerPath;
  const info = serverFiles(root);
  const target = detectServerTarget(root, info);
  const loader = opts.loader || (['neoforge', 'forge', 'fabric', 'quilt'].includes(target.loader) ? target.loader : undefined);
  const kind = ['plugin', 'mod', 'datapack'].includes(opts.kind) ? opts.kind : (loader ? 'mod' : 'plugin');
  const source = opts.source === 'hangar' || opts.source === 'spigot' || opts.source === 'curseforge' ? opts.source : 'modrinth';
  const version = opts.version || target.mc || undefined;

  const resolveFn = deps.resolveMarketDownload || require('./marketplace.js').resolveMarketDownload;
  const downloadFn = deps.download || require('./http.js').download;
  const verifyFn = deps.verifyFileHash || verifyFileHash;

  const dl = await resolveFn({ id, source, kind: loader || kind, version, loader });
  if (!dl || !dl.url) return { ok: false, error: 'Could not resolve a compatible download for this dependency.' };

  const levelName = info.properties['level-name'] || 'world';
  const folder = contentFolder(kind, levelName);
  const fileName = path.basename(dl.filename || `${id}.jar`);
  const dest = safeTarget(root, path.join(folder, fileName));
  if (!dest) return { ok: false, error: 'Unsafe destination path.' };

  fs.mkdirSync(path.dirname(dest), { recursive: true });
  await downloadFn(dl.url, dest, null, null, { maxBytes: 512 * 1024 * 1024 });
  const vh = verifyFn(dest, dl.hashes);
  if (!vh || !vh.ok) {
    try { fs.rmSync(dest, { force: true }); } catch {}
    return { ok: false, error: (vh && vh.error) || 'Hash verification failed.' };
  }
  recordManifestEntry(root, {
    kind,
    fileName,
    sourceUrl: dl.url,
    source,
    title: opts.title || dl.title || id,
    projectId: id,
    versionId: dl.versionId != null ? String(dl.versionId) : undefined,
    gameVersion: version,
    version: dl.versionNumber || undefined,
    installedAt: new Date().toISOString(),
  });
  return { ok: true, fileName, title: opts.title || id, files: serverFiles(root) };
}

// Run full Server Doctor diagnosis + structured repair plan for the GUI (read-only).
async function scanServerDoctor(ctx, deps = {}) {
  if (!ctx || !ctx.currentServerPath) return { ok: false, error: 'Choose a server folder first.' };
  const toolsMod = deps.tools || require('../mcp/tools.js');
  const proposeTool = toolsMod.getTool('propose_fix');
  const diagTool = toolsMod.getTool('diagnose_server');
  if (!proposeTool) return { ok: false, error: 'Doctor engine is unavailable.' };

  const [propRes, diagRes] = await Promise.all([
    proposeTool.handler(ctx, {}),
    diagTool ? diagTool.handler(ctx, {}).catch(() => null) : Promise.resolve(null),
  ]);
  if (!propRes || !propRes.ok) {
    return { ok: false, error: (propRes && propRes.error) || 'Doctor scan failed.' };
  }
  const r = propRes.result || {};
  const checks = (diagRes && diagRes.ok && diagRes.result && Array.isArray(diagRes.result.checks)) ? diagRes.result.checks : [];
  return {
    ok: true,
    server: r.server || { mc: null, loader: null },
    healthy: r.healthy !== false && (!Array.isArray(r.plan) || r.plan.length === 0),
    checks,
    diagnosis: r.diagnosis || {},
    plan: Array.isArray(r.plan) ? r.plan : [],
    summary: r.summary || '',
  };
}

// Execute user-confirmed Doctor actions via the shared MCP apply_fix engine.
async function applyServerDoctorFixes(ctx, actions, deps = {}) {
  if (!ctx || !ctx.currentServerPath) return { ok: false, error: 'Choose a server folder first.' };
  const list = Array.isArray(actions) ? actions.filter(a => a && ALLOWED_DOCTOR_ACTIONS.has(a.action)) : [];
  if (!list.length) return { ok: false, error: 'No valid repair actions specified.' };
  if (ctx.serverProcess) {
    const needsStop = list.some(a => a.action === ACTION.RESTORE_BACKUP || a.action === ACTION.INSTALL_DEPENDENCY);
    if (needsStop) return { ok: false, error: 'Stop the server before installing dependencies or restoring a backup.' };
  }
  const toolsMod = deps.tools || require('../mcp/tools.js');
  const applyTool = toolsMod.getTool('apply_fix');
  if (!applyTool) return { ok: false, error: 'Doctor apply engine is unavailable.' };

  const res = await applyTool.handler(ctx, { actions: list });
  if (!res || !res.ok) return { ok: false, error: (res && res.error) || 'Could not apply fixes.' };
  return {
    ok: true,
    ...(res.result || {}),
    files: serverFiles(ctx.currentServerPath),
  };
}

function registerDoctor(ipcMain, ctx) {
  ipcMain.handle('content:resolve-dep', async (_, payload) => {
    try { return await resolveMissingDep(ctx, payload || {}); }
    catch (e) { return { ok: false, error: e?.message || 'Could not resolve dependency.' }; }
  });
  ipcMain.handle('content:install-dep', async (_, payload) => {
    try { return await installResolvedDep(ctx, payload || {}); }
    catch (e) { return { ok: false, error: e?.message || 'Could not install dependency.' }; }
  });
  ipcMain.handle('doctor:scan', async () => {
    try { return await scanServerDoctor(ctx); }
    catch (e) { return { ok: false, error: e?.message || 'Could not scan server health.' }; }
  });
  ipcMain.handle('doctor:apply', async (_, payload) => {
    try { return await applyServerDoctorFixes(ctx, payload && payload.actions); }
    catch (e) { return { ok: false, error: e?.message || 'Could not apply server fixes.' }; }
  });
}

module.exports = {
  ALLOWED_DOCTOR_ACTIONS,
  resolveMissingDep,
  installResolvedDep,
  scanServerDoctor,
  applyServerDoctorFixes,
  registerDoctor,
};
