// Marketplace handlers (remote catalog search/install).
// Owns: market:versions/search/detail/install. Progress events go through
// ctx.send so the renderer wiring is untouched.
const fs = require('fs');
const path = require('path');
const { serverFiles } = require('./server-files.js');
const { safeTarget, recordManifestEntry } = require('./fs-utils.js');
const { json, download, marketplaceError } = require('./http.js');
const cf = require('./curseforge.js');

// CurseForge needs the user's own API key (ToS forbids sharing one). Returns the header object, or
// null when no key is set — callers then treat CurseForge as unavailable rather than erroring.
function cfHeaders() {
  try { const { loadSettings } = require('./settings.js'); const key = String(loadSettings().curseforgeApiKey || '').trim(); return key ? { 'x-api-key': key } : null; }
  catch { return null; }
}

// Pure marketplace search shared by the IPC handler (GUI) and the MCP search_marketplace tool, so
// both support the same three sources and never drift. Caller is responsible for try/catch.
async function searchMarket(opts) {
  const { source = 'modrinth', kind = 'plugin', query = '', version = '', sort = 'downloads', offset = 0 } = opts || {};
  const skip = Math.max(0, Number(offset) || 0);
  if (source === 'modrinth') {
    const loaderGroups = {
      plugin: ['loaders:paper', 'loaders:spigot', 'loaders:purpur', 'loaders:folia', 'loaders:bukkit'],
      forge: ['loaders:forge', 'loaders:neoforge'],
      fabric: ['loaders:fabric', 'loaders:quilt'],
    };
    const index = sort === 'latest' ? 'newest' : sort === 'downloads' ? 'downloads' : 'relevance';
    let lastTotal = null;
    const runSearch = async filters => {
      const facets = encodeURIComponent(JSON.stringify(filters));
      const data = await json(`https://api.modrinth.com/v2/search?query=${encodeURIComponent(query || '')}&limit=20&offset=${skip}&index=${index}&facets=${facets}`);
      lastTotal = data.total_hits ?? null;
      return data.hits || [];
    };
    let hits, relaxed = null;
    if (kind === 'modpack') {
      hits = await runSearch([['project_type:modpack']]);
    } else if (kind === 'datapack') {
      hits = await runSearch([['project_type:datapack']]);
      if (!hits.length && skip === 0) { hits = await runSearch([['project_type:mod'], ['loaders:datapack']]); if (hits.length) relaxed = 'loader'; }
      if (!hits.length && skip === 0) { hits = await runSearch([['project_type:mod'], ['categories:datapack']]); if (hits.length) relaxed = 'loader'; }
    } else {
      const loaderGroup = loaderGroups[kind] || loaderGroups.plugin;
      let filters = [['project_type:mod'], loaderGroup];
      if (version) filters.push([`versions:${version}`]);
      hits = await runSearch(filters);
      if (!hits.length && skip === 0 && version) { hits = await runSearch([['project_type:mod'], loaderGroup]); if (hits.length) relaxed = 'version'; }
      if (!hits.length && skip === 0) { hits = await runSearch([['project_type:mod']]); if (hits.length) relaxed = 'loader'; }
    }
    return { ok: true, relaxed, total: lastTotal, items: hits.map(x => ({ source, id: x.project_id, title: x.title, author: x.author, description: x.description, icon: x.icon_url, downloads: x.downloads, version, env: x.env || null, loaders: x.loaders || [], date: x.date_created || null })) };
  }
  if (source === 'hangar') {
    const order = sort === 'downloads' ? '-downloads' : sort === 'latest' ? '-updatedAt' : '-stars';
    const data = await json(`https://hangar.papermc.io/api/v1/projects?query=${encodeURIComponent(query || '')}&limit=20&offset=${skip}&sort=${encodeURIComponent(order)}`);
    const rows = data.result || data.projects || [];
    return { ok: true, total: data.pagination?.count ?? null, items: rows.map(x => ({ source, id: `${x.namespace?.owner || x.namespace}/${x.name || x.slug}`, title: x.name || x.slug, author: x.namespace?.owner || x.owner || 'Hangar', description: x.description || '', downloads: x.stats?.downloads || 0, version })) };
  }
  if (source === 'spigot') {
    const page = Math.floor(skip / 20) + 1;
    const data = await json(`https://api.spiget.org/v2/search/resources/${encodeURIComponent(query || 'plugin')}?size=20&page=${page}&sort=${sort === 'latest' ? '-releaseDate' : '-downloads'}`);
    return { ok: true, total: null, items: data.map(x => ({ source: 'spigot', id: String(x.id), title: x.name, author: x.author?.username || 'Spigot author', description: x.tag || x.description || '', downloads: x.downloads || 0, version })) };
  }
  if (source === 'curseforge') {
    const headers = cfHeaders();
    if (!headers) { const e = new Error('CurseForge API key not set. Add your own key in Settings to search CurseForge.'); e.code = 'noKey'; throw e; }
    const classId = cf.classIdForKind(kind);
    const loaderId = cf.loaderIdFor(kind === 'fabric' ? 'fabric' : kind === 'forge' ? 'forge' : kind === 'neoforge' ? 'neoforge' : 'any');
    const params = new URLSearchParams({ gameId: String(cf.CF_GAME_ID), classId: String(classId), searchFilter: query || '', sortField: sort === 'latest' ? '3' : '2', sortOrder: 'desc', index: String(skip), pageSize: '20' });
    if (version) params.set('gameVersion', version);
    if (loaderId) params.set('modLoaderType', String(loaderId));
    const data = await json(`${cf.CF_BASE}/mods/search?${params.toString()}`, headers);
    const rows = data.data || [];
    return { ok: true, total: data.pagination?.totalCount ?? null, items: rows.map(x => ({ ...cf.mapCfItem(x), version })) };
  }
}

// Pure-ish download resolver shared by the IPC handler AND the MCP install_from_market tool, so
// BOTH support Modrinth + Hangar + Spigot and the version/loader picking never drifts. Throws on
// failure. Returns { url, filename, source }.
async function resolveMarketDownload(item) {
  const kind = ['forge', 'fabric', 'datapack', 'mod', 'modpack'].includes(item.kind) ? item.kind : 'plugin';
  if (item.source === 'modrinth' || !item.source) {
    const versions = await json(`https://api.modrinth.com/v2/project/${encodeURIComponent(item.id)}/version`);
    const wantedLoaders = { plugin: ['paper', 'spigot', 'purpur', 'folia', 'bukkit'], forge: ['forge', 'neoforge'], mod: ['forge', 'neoforge'], fabric: ['fabric', 'quilt'], datapack: ['datapack', 'minecraft'], modpack: ['forge', 'neoforge', 'fabric', 'quilt'] }[kind];
    const byVersion = versions.filter(v => !item.version || (v.game_versions || []).includes(item.version));
    let target = item.versionId ? versions.find(v => v.id === item.versionId) : null;
    if (!target) target = byVersion.find(v => (v.loaders || []).some(l => wantedLoaders.includes(l))) || byVersion[0] || versions[0];
    if (!target?.files?.[0]) throw new Error('No downloadable version was found.');
    const f = target.files.find(x => x.primary) || target.files[0];
    // Extra metadata (non-breaking: GUI/MCP install callers ignore it) so the MCP modpack planner
    // can check compatibility and follow required dependencies WITHOUT re-fetching or duplicating
    // the version-picking logic here.
    return {
      url: f.url, filename: f.filename, source: 'modrinth', size: f.size || 0,
      versionNumber: target.version_number || null,
      gameVersions: target.game_versions || [],
      loaders: target.loaders || [],
      dependencies: (target.dependencies || []).filter(d => d && d.project_id).map(d => ({ projectId: d.project_id, versionId: d.version_id || null, type: d.dependency_type || 'required' })),
    };
  }
  if (item.source === 'hangar') {
    const [owner, slug] = String(item.id).split('/');
    const versions = await json(`https://hangar.papermc.io/api/v1/projects/${encodeURIComponent(owner)}/${encodeURIComponent(slug)}/versions?limit=20`);
    const target = (versions.result || []).find(v => v.downloads?.PAPER?.downloadUrl);
    const file = target?.downloads?.PAPER;
    if (!file) throw new Error('No Paper download was found for this Hangar project.');
    return { url: file.downloadUrl, filename: file.fileInfo?.name || `${slug}.jar`, source: 'hangar', size: file.fileInfo?.sizeBytes || file.fileInfo?.size || 0 };
  }
  if (item.source === 'spigot') {
    const title = String(item.title || item.id || 'plugin').replace(/[^\w.-]+/g, '_');
    return { url: `https://api.spiget.org/v2/resources/${encodeURIComponent(item.id)}/download`, filename: `${title}.jar`, source: 'spigot' };
  }
  if (item.source === 'curseforge') {
    const headers = cfHeaders();
    if (!headers) throw new Error('CurseForge API key not set.');
    const files = await json(`${cf.CF_BASE}/mods/${encodeURIComponent(item.id)}/files?pageSize=50`, headers);
    const wanted = cf.loaderIdFor(kind === 'fabric' ? 'fabric' : kind === 'forge' ? 'forge' : 'neoforge');
    // Honour an explicit versionId (the version picker) before falling back to the newest match.
    let file = item.versionId ? (files.data || []).find(f => String(f.id) === String(item.versionId)) : null;
    if (!file) file = cf.pickCfFile(files.data || [], item.version || '', wanted);
    const inst = cf.cfFileInstallable(file);
    if (!inst.ok) { const e = new Error('blocked'); e.code = 'blocked'; throw e; }
    // dependencies: mapped best-effort (CF has no official relationType table — see cfDependencies).
    return { url: inst.url, filename: file.fileName, source: 'curseforge', size: file.fileLength || 0, versionNumber: file.displayName || null, gameVersions: file.gameVersions || [], loaders: [], dependencies: cf.cfDependencies(file) };
  }
  throw new Error('Unsupported marketplace source.');
}

function registerMarketplace(ipcMain, ctx) {
  ipcMain.handle('market:versions', async () => {
    try {
      const versions = await json('https://api.modrinth.com/v2/tag/game_version');
      const releases = versions.filter(x => x.version_type === 'release').sort((a, b) => new Date(b.date) - new Date(a.date));
      return { ok: true, versions: releases.map(x => x.version) };
    } catch (error) { return marketplaceError(error); }
  });

  ipcMain.handle('market:search', async (_, opts) => {
    try { return await searchMarket(opts); } catch (error) { return marketplaceError(error); }
  });

  ipcMain.handle('market:detail', async (_, item) => {
    try {
      if (item && item.source === 'curseforge') {
        // CurseForge DOES expose a per-file list, so the version picker works here too — with the
        // same shape the Modrinth path returns. Needs the user's key. Files the author blocked for
        // third-party downloads are marked `blocked` so the picker can disable them.
        const headers = cfHeaders();
        if (!headers) return { ok: true, title: item.title || '', description: item.description || '', icon: item.icon || '', author: item.author || '', env: null, loaders: null, versions: null, projectUrl: item.projectUrl || null };
        const files = await json(`${cf.CF_BASE}/mods/${encodeURIComponent(item.id)}/files?pageSize=50`, headers);
        const versions = (files.data || []).map(cf.mapCfFileToVersion).filter(Boolean);
        versions.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
        return { ok: true, title: item.title || '', description: item.description || '', icon: item.icon || '', author: item.author || '', env: null, loaders: null, versions, projectUrl: item.projectUrl || null };
      }
      if (!item || item.source !== 'modrinth') {
        // Other sources (Hangar/Spigot) have no rich detail endpoint here; return the fields we have.
        return { ok: true, title: item?.title || '', description: item?.description || '', icon: item?.icon || '', author: item?.author || '', env: item?.env || null, loaders: item?.loaders || null, versions: null, projectUrl: item?.projectUrl || null };
      }
      const proj = await json(`https://api.modrinth.com/v2/project/${encodeURIComponent(item.id)}`);
      const versions = await json(`https://api.modrinth.com/v2/project/${encodeURIComponent(item.id)}/version`);
      const map = v => {
        const f = (v.files || []).find(x => x.primary) || (v.files || [])[0] || {};
        return { id: v.id, number: v.version_number, name: v.name || v.version_number, date: v.date_published, gameVersions: v.game_versions || [], loaders: v.loaders || [], size: f.size || 0,
          dependencies: (v.dependencies || []).filter(d => d && d.project_id).map(d => ({ projectId: d.project_id, versionId: d.version_id || null, type: d.dependency_type || 'required' })) };
      };
      const mapped = versions.map(map);
      // DEPENDENCY METADATA: version.dependencies only carries project ids. Batch-fetch the titles so
      // the modal can show a human name instead of a raw id. Best-effort — a failed lookup still
      // returns the ids, the UI falls back to "project <id>".
      const depIds = [...new Set(mapped.flatMap(v => v.dependencies.filter(d => d.type === 'required' || d.type === 'incompatible').map(d => d.projectId)))];
      const depMeta = {};
      if (depIds.length) {
        try {
          const arr = await json(`https://api.modrinth.com/v2/projects?ids=${encodeURIComponent(JSON.stringify(depIds))}`);
          for (const p of arr || []) depMeta[p.id] = { title: p.title, slug: p.slug, icon: p.icon_url || null };
        } catch {}
      }
      for (const v of mapped) for (const d of v.dependencies) { const m = depMeta[d.projectId]; if (m) { d.title = m.title; d.slug = m.slug; d.icon = m.icon; } }
      const sourceUrl = proj.source_url || proj.wiki_url || proj.issues_url || null;
      const projectUrl = `https://modrinth.com/project/${encodeURIComponent(proj.slug || item.id)}`;
      return { ok: true, title: proj.title, description: proj.description, body: String(proj.body || '').slice(0, 1500), icon: proj.icon_url || item.icon || '', author: item.author || (proj.owner || ''), env: item.env || null, loaders: item.loaders || null, versions: mapped, sourceUrl, projectUrl };
    } catch (error) { return { ok: false, error: marketplaceError(error).error }; }
  });

  ipcMain.handle('market:install', async (_, item) => {
    try {
      if (!ctx.currentServerPath) return { ok: false, error: 'Choose and apply a server folder first.' };
      const kind = ['forge', 'fabric', 'datapack'].includes(item.kind) ? item.kind : 'plugin';
      const levelName = serverFiles(ctx.currentServerPath).properties['level-name'] || 'world';
      const destFolders = { plugin: 'plugins', forge: 'mods', fabric: 'mods', datapack: path.join(levelName, 'datapacks') };
      const destDir = safeTarget(ctx.currentServerPath, destFolders[kind]);
      fs.mkdirSync(destDir, { recursive: true });
      const { url, filename } = await resolveMarketDownload(item);
      // SECURITY (SSRF): the download URL comes from a remote registry API. Validate it is a public
      // http(s) host BEFORE fetching (same guard modpacks + the MCP install path already use), so a
      // crafted API entry pointing at file://, localhost or a private range can never be fetched.
      const { isSafeDownloadUrl } = require('./validate.js');
      if (!isSafeDownloadUrl(url)) return { ok: false, error: 'Refused: the download URL is not on an allowlisted public host.' };
      const dest = path.join(destDir, path.basename(filename));
      // A single plugin/mod jar is normally well under 100 MB; cap at 512 MB.
      await download(url, dest, (received, total) => ctx.send('market:progress', { phase: 'file', name: filename, received, total }), null, { maxBytes: 512 * 1024 * 1024 });
      recordManifestEntry(ctx.currentServerPath, { kind, fileName: path.basename(filename), sourceUrl: url, source: item.source, title: item.title, installedAt: new Date().toISOString() });
      return { ok: true, files: serverFiles(ctx.currentServerPath), name: filename };
    } catch (error) {
      // A CurseForge project whose author disabled third-party distribution returns no download URL.
      // Surface it distinctly so the UI can offer the manual fallback instead of a generic error.
      if (error && error.code === 'blocked') return { ok: false, blocked: true, error: 'This CurseForge project does not allow third-party downloads. Open its page and install it manually.', projectUrl: item.projectUrl || null };
      return marketplaceError(error);
    }
  });

  // Whether a CurseForge API key is configured — the renderer shows/hides the CurseForge source.
  ipcMain.handle('market:curseforge-status', async () => {
    try { return { ok: true, hasKey: !!cfHeaders() }; } catch { return { ok: true, hasKey: false }; }
  });

  // Open a project's homepage / source / issues link in the system browser. SECURITY: only allow
  // https to a small set of trusted mod-registry / code hosts (a malicious item could otherwise
  // pass file:// or an arbitrary site). Mirrors the allowlist approach used for Playit claim URLs.
  ipcMain.handle('market:open-external', async (_, rawUrl) => {
    const { shell } = require('electron');
    let u;
    try { u = new URL(String(rawUrl)); } catch { return { ok: false, error: 'Invalid link.' }; }
    if (u.protocol !== 'https:') return { ok: false, error: 'Only https links can be opened.' };
    const host = u.hostname.toLowerCase();
    const allowed = ['modrinth.com', 'hangar.papermc.io', 'spigotmc.org', 'github.com', 'gitlab.com', 'bitbucket.org', 'curseforge.com'];
    if (!allowed.some(h => host === h || host.endsWith('.' + h))) return { ok: false, error: 'This link is not on the allowlist.' };
    try { await shell.openExternal(u.href); return { ok: true }; } catch (e) { return { ok: false, error: e?.message || 'Could not open the link.' }; }
  });
}

// A2 (v2.1.0): version list for a project from the SAME sources search uses, so an AI can pick an
// exact versionId before install. Modrinth has a rich version list; Hangar + CurseForge are mapped
// to the same { id, number, gameVersions, loaders, date } shape. Caller is responsible for try/catch.
async function listMarketVersions(opts) {
  const item = opts || {};
  const id = String(item.id || '');
  if (!id) throw new Error('id is required.');
  const source = ['modrinth', 'hangar', 'curseforge'].includes(item.source) ? item.source : 'modrinth';
  if (source === 'modrinth') {
    const r = await json('https://api.modrinth.com/v2/project/' + encodeURIComponent(id) + '/version');
    return (r || []).map(v => ({ id: v.id, number: v.version_number, gameVersions: v.game_versions || [], loaders: v.loaders || [], date: v.date_published, size: (v.files || []).find(f => f.primary)?.size || (v.files || [])[0]?.size || 0 }));
  }
  if (source === 'hangar') {
    const [owner, slug] = String(id).split('/');
    if (!owner || !slug) throw new Error('Hangar id must be owner/slug.');
    const data = await json(`https://hangar.papermc.io/api/v1/projects/${encodeURIComponent(owner)}/${encodeURIComponent(slug)}/versions?limit=25`);
    return (data.result || []).map(v => ({ id: v.name, number: v.name, gameVersions: v.platformDependencies?.PAPER ? [v.platformDependencies.PAPER] : [], loaders: ['paper'], date: v.createdAt || null }));
  }
  // curseforge
  const headers = cfHeaders();
  if (!headers) { const e = new Error('CurseForge API key not set. Add your own key in Settings.'); e.code = 'noKey'; throw e; }
  const files = await json(`${cf.CF_BASE}/mods/${encodeURIComponent(id)}/files?pageSize=50`, headers);
  const versions = (files.data || []).map(cf.mapCfFileToVersion).filter(Boolean);
  versions.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
  return versions;
}

module.exports = { registerMarketplace, searchMarket, resolveMarketDownload, listMarketVersions };
