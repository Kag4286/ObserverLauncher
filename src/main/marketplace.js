// Marketplace handlers (remote catalog search/install).
// Owns: market:versions/search/detail/install. Progress events go through
// ctx.send so the renderer wiring is untouched.
const fs = require('fs');
const path = require('path');
const { serverFiles } = require('./server-files.js');
const { safeTarget, recordManifestEntry } = require('./fs-utils.js');
const { json, download, marketplaceError } = require('./http.js');
const cf = require('./curseforge.js');
const { normalizeEnv } = require('./mod-metadata.js');

// Is this file a ZIP (and therefore a jar)? A jar starts with the local-file-header signature
// "PK\x03\x04". Reading four bytes is enough and never loads the whole file into memory.
function isZipFile(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(4);
    const read = fs.readSync(fd, head, 0, 4, 0);
    if (read < 4) return false;
    return head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
  } catch { return false; }
  finally { if (fd !== undefined) try { fs.closeSync(fd); } catch {} }
}

// CurseForge needs the user's own API key (ToS forbids sharing one). Returns the header object, or
// null when no key is set — callers then treat CurseForge as unavailable rather than erroring.
function cfHeaders() {
  try { const { loadSettings } = require('./settings.js'); const key = String(loadSettings().curseforgeApiKey || '').trim(); return key ? { 'x-api-key': key } : null; }
  catch { return null; }
}

// Pure marketplace search shared by the IPC handler (GUI) and the MCP search_marketplace tool, so
// both support the same three sources and never drift. Caller is responsible for try/catch.
async function searchMarket(opts) {
  const { source = 'modrinth', kind = 'plugin', query = '', version = '', sort = 'downloads', offset = 0, loader = '', category = '' } = opts || {};
  const skip = Math.max(0, Number(offset) || 0);
  if (source === 'modrinth') {
    const loaderGroups = {
      plugin: ['loaders:paper', 'loaders:spigot', 'loaders:purpur', 'loaders:folia', 'loaders:bukkit'],
      neoforge: ['loaders:neoforge'],
      forge: ['loaders:forge'],
      fabric: ['loaders:fabric', 'loaders:quilt'],
      quilt: ['loaders:quilt', 'loaders:fabric'],
      proxy: ['loaders:velocity', 'loaders:waterfall', 'loaders:bungeecord'],
      mod: ['loaders:forge', 'loaders:neoforge', 'loaders:fabric', 'loaders:quilt'],
    };
    const explicit = ['neoforge', 'forge', 'fabric', 'quilt', 'paper', 'velocity', 'proxy'].includes(loader)
      ? (['velocity', 'proxy'].includes(loader) ? ['loaders:velocity', 'loaders:waterfall', 'loaders:bungeecord'] : [`loaders:${loader}`])
      : null;
    const catMap = {
      qol: ['categories:quality-of-life', 'categories:utility'],
      perf: ['categories:optimization'],
      optimization: ['categories:optimization'],
      admin: ['categories:utility', 'categories:management', 'categories:administration'],
      security: ['categories:management', 'categories:protection', 'categories:utility'],
      economy: ['categories:economy'],
      worldgen: ['categories:worldgen', 'categories:adventure'],
      library: ['categories:library'],
    };
    const catFacets = catMap[category] || (category ? [`categories:${category}`] : null);
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
      const loaderGroup = explicit || loaderGroups[loader] || loaderGroups[kind] || loaderGroups.plugin;
      let filters = [['project_type:mod'], loaderGroup];
      if (version) filters.push([`versions:${version}`]);
      if (catFacets) filters.push(catFacets);
      hits = await runSearch(filters);
      if (!hits.length && skip === 0 && catFacets) {
        const fNoCat = [['project_type:mod'], loaderGroup];
        if (version) fNoCat.push([`versions:${version}`]);
        hits = await runSearch(fNoCat);
        if (hits.length) relaxed = 'category';
      }
      if (!hits.length && skip === 0 && version) { hits = await runSearch([['project_type:mod'], loaderGroup]); if (hits.length) relaxed = 'version'; }
      if (!hits.length && skip === 0) { hits = await runSearch([['project_type:mod']]); if (hits.length) relaxed = 'loader'; }
    }
    const KNOWN_LOADERS = ['datapack', 'fabric', 'quilt', 'neoforge', 'forge', 'paper', 'purpur', 'spigot', 'folia', 'bukkit', 'velocity', 'waterfall', 'bungeecord', 'vanilla'];
    const mapHit = x => {
      const hitLoaders = (x.loaders && x.loaders.length) ? x.loaders : (x.categories || []).map(c => String(c).toLowerCase()).filter(c => KNOWN_LOADERS.includes(c));
      const hitEnv = { client: x.client_side || null, server: x.server_side || null, normalized: normalizeEnv({ client: x.client_side, server: x.server_side }) };
      return { source, id: x.project_id, title: x.title, author: x.author, description: x.description, icon: x.icon_url, downloads: x.downloads, version, env: hitEnv, loaders: hitLoaders, date: x.date_created || null };
    };
    return { ok: true, relaxed, total: lastTotal, items: hits.map(mapHit) };
  }
  if (source === 'hangar') {
    // BUGFIX (6.0.1): the sort field was "updatedAt", which Hangar does not accept. Its search
    // takes stars, downloads, views, newest, updated, recent_views, recent_downloads and slug.
    // An unknown field is answered with a 400, so sorting by "latest" always failed. The field
    // is "updated" (the one Hangar's own UI calls "Recently Updated").
    const order = sort === 'downloads' ? '-downloads' : sort === 'latest' ? '-updated' : '-stars';
    const data = await json(`https://hangar.papermc.io/api/v1/projects?query=${encodeURIComponent(query || '')}&limit=20&offset=${skip}&sort=${encodeURIComponent(order)}`);
    const rows = data.result || data.projects || [];
    // BUGFIX (v4.0.0): Hangar hits carry an avatarUrl (often root-relative) — without mapping it to
    // `icon`, the renderer fell back to the generic placeholder, so Hangar rows had no real icon.
    const hangarIcon = u => !u ? null : (String(u).startsWith('http') ? String(u) : 'https://hangar.papermc.io' + String(u));
    return { ok: true, total: data.pagination?.count ?? null, items: rows.map(x => ({ source, id: `${x.namespace?.owner || x.namespace}/${x.name || x.slug}`, title: x.name || x.slug, author: x.namespace?.owner || x.owner || 'Hangar', description: x.description || '', downloads: x.stats?.downloads || 0, icon: hangarIcon(x.avatarUrl || x.iconUrl || x.icon), version })) };
  }
  if (source === 'spigot') {
    const page = Math.floor(skip / 20) + 1;
    const data = await json(`https://api.spiget.org/v2/search/resources/${encodeURIComponent(query || 'plugin')}?size=20&page=${page}&sort=${sort === 'latest' ? '-releaseDate' : '-downloads'}`);

    // CONFIRMED via a real Spiget response (scripts/spigot-probe.js): `icon.url` IS present but is a
    // ROOT-RELATIVE path with NO leading slash, e.g. "data/resource_icons/62/62325.jpg?1564519207".
    // The old code did `'https://www.spigotmc.org' + url` -> "...orgdata/..." (missing slash) -> the
    // image 404'd. The SEARCH `author` is only {id} (no name) — that stays resolved lazily.
    const spigotIcon = x => {
      const ic = x && x.icon;
      const raw = (ic && (ic.url || (typeof ic === 'string' ? ic : null))) || null;
      if(raw){
        const s = String(raw);
        return s.startsWith('http') ? s : 'https://www.spigotmc.org/' + s.replace(/^\/+/, '');
      }
      // Fallback: icon.data is a base64 PNG on the same object — usable directly as a data URL.
      if(ic && ic.data) return 'data:image/png;base64,' + String(ic.data);
      return null;
    };
    const spigotAuthor = x => {
      const a = x && x.author;
      if(!a) return null;
      return a.username || a.name || null; // search results carry only {id} -> null (resolved lazily)
    };
    return { ok: true, total: null, items: data.map(x => ({ source: 'spigot', id: String(x.id), title: x.name, author: spigotAuthor(x), description: x.tag || x.description || '', downloads: x.downloads || 0, icon: spigotIcon(x), version })) };
  }
  if (source === 'curseforge') {
    const headers = cfHeaders();
    if (!headers) { const e = new Error('CurseForge API key not set. Add your own key in Settings to search CurseForge.'); e.code = 'noKey'; throw e; }
    const classId = cf.classIdForKind(kind);
    const targetLoader = loader || (kind === 'fabric' ? 'fabric' : kind === 'neoforge' ? 'neoforge' : kind === 'forge' ? 'forge' : 'any');
    const loaderId = cf.loaderIdFor(targetLoader);
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
    const isVel = item && (item.software === 'velocity' || item.loader === 'velocity' || item.loader === 'proxy');
    let wantedLoaders;
    if (kind === 'datapack' || (item && item.loader === 'datapack')) wantedLoaders = ['datapack', 'minecraft'];
    else if (item && item.loader === 'neoforge') wantedLoaders = ['neoforge'];
    else if (item && item.loader === 'forge') wantedLoaders = ['forge'];
    else if (item && (item.loader === 'fabric' || item.loader === 'quilt')) wantedLoaders = ['fabric', 'quilt'];
    else if (item && item.loader === 'paper') wantedLoaders = ['paper', 'spigot', 'purpur', 'folia', 'bukkit'];
    else if (isVel) wantedLoaders = ['velocity', 'waterfall', 'bungeecord'];
    else {
      wantedLoaders = { plugin: ['paper', 'spigot', 'purpur', 'folia', 'bukkit'], neoforge: ['neoforge'], forge: ['forge'], mod: ['neoforge', 'forge', 'fabric', 'quilt'], fabric: ['fabric', 'quilt'], datapack: ['datapack', 'minecraft'], modpack: ['neoforge', 'forge', 'fabric', 'quilt'] }[kind] || ['paper', 'spigot', 'purpur', 'folia', 'bukkit'];
    }
    const byVersion = versions.filter(v => !item.version || (v.game_versions || []).includes(item.version));
    let target = item.versionId ? versions.find(v => v.id === item.versionId) : null;
    if (target && item.loader && !item.allowIncompatible && Array.isArray(target.loaders) && target.loaders.length) {
      if (kind === 'datapack' || target.loaders.includes('datapack')) {
        // Datapacks are universally compatible with all server loaders
      } else {
        const match = target.loaders.some(l => wantedLoaders.includes(l));
        if (!match) {
          throw new Error(`The selected build (${target.version_number || target.id}) supports ${target.loaders.join('/')}, which is incompatible with your ${item.loader} server.`);
        }
      }
    }
    if (!target) target = byVersion.find(v => (v.loaders || []).some(l => wantedLoaders.includes(l))) || null;
    // BUGFIX (v3.3.1): the old fallback `|| byVersion[0] || versions[0]` silently installed a
    // MISMATCHED jar (e.g. a Floodgate NeoForge build onto a Paper/Purpur server) that then crashed
    // the server on start. When the registry told us the loaders (so we KNOW a build exists) and NONE
    // matches this server's loader family, refuse instead of guessing. Datapack/modpack keep the old
    // fallback because their `loaders` field is not a server-loader contract (datapack packs list
    // 'datapack'/'minecraft'; modpacks bundle their own loader).
    if (!target) {
      const loaderSensitive = kind === 'plugin' || kind === 'mod' || kind === 'forge' || kind === 'fabric';
      const someWithLoaders = byVersion.some(v => Array.isArray(v.loaders) && v.loaders.length);
      if (loaderSensitive && someWithLoaders) {
        const found = [...new Set(byVersion.flatMap(v => v.loaders || []))].filter(Boolean).join(', ');
        throw new Error(`No ${kind} build matches this server's loader (available: ${found || 'none'}). Refusing to install a mismatched jar — pass the exact versionId or install manually.`);
      }
      target = byVersion[0] || versions[0];
    }
    if (!target?.files?.[0]) throw new Error('No downloadable version was found.');
    const f = target.files.find(x => x.primary) || target.files[0];
    // Extra metadata (non-breaking: GUI/MCP install callers ignore it) so the MCP modpack planner
    // can check compatibility and follow required dependencies WITHOUT re-fetching or duplicating
    // the version-picking logic here.
    return {
      url: f.url, filename: f.filename, source: 'modrinth', size: f.size || 0,
      hashes: f.hashes || null,
      // CB2 (v3.3.0): identity for the manifest so a later check_updates can re-query the registry.
      projectId: item.id,
      versionId: target.id || null,
      gameVersion: item.version || (target.game_versions && target.game_versions[0]) || null,
      versionNumber: target.version_number || null,
      gameVersions: target.game_versions || [],
      loaders: target.loaders || [],
      dependencies: (target.dependencies || []).filter(d => d && d.project_id).map(d => ({ projectId: d.project_id, versionId: d.version_id || null, type: d.dependency_type || 'required' })),
    };
  }
  if (item.source === 'hangar') {
    const [owner, slug] = String(item.id).split('/');
    const versions = await json(`https://hangar.papermc.io/api/v1/projects/${encodeURIComponent(owner)}/${encodeURIComponent(slug)}/versions?limit=25`);
    const isVel = item && (item.software === 'velocity' || item.loader === 'velocity' || item.loader === 'proxy');
    const pickFile = v => isVel ? (v.downloads?.VELOCITY || v.downloads?.PAPER || v.downloads?.WATERFALL) : (v.downloads?.PAPER || v.downloads?.VELOCITY || v.downloads?.WATERFALL);
    const list = (versions.result || []).filter(v => pickFile(v)?.downloadUrl);
    let target = null;
    if (item.versionId) {
      target = list.find(v => v.name === item.versionId || String(v.id) === String(item.versionId)) || null;
    }
    if (!target && item.version) {
      target = list.find(v => (v.platformDependencies?.PAPER || v.platformDependencies?.VELOCITY || []).includes(item.version)) || null;
    }
    if (!target) target = list[0] || null;
    const file = target ? pickFile(target) : null;
    if (!file) throw new Error('No Paper or Velocity download was found for this Hangar project.');
    const hangarHashes = file.fileInfo?.sha256Hash ? { sha256: file.fileInfo.sha256Hash } : null;
    return {
      url: file.downloadUrl,
      filename: file.fileInfo?.name || `${slug}.jar`,
      source: 'hangar',
      size: file.fileInfo?.sizeBytes || file.fileInfo?.size || 0,
      hashes: hangarHashes,
      projectId: item.id,
      versionId: target?.name || (target?.id != null ? String(target.id) : null),
      gameVersion: item.version || (target?.platformDependencies?.PAPER && target.platformDependencies.PAPER[0]) || null,
      versionNumber: target?.name || null,
    };
  }
  if (item.source === 'spigot') {
    // Spiget only serves ONE download endpoint: /v2/resources/{id}/download, and it always
    // returns the resource's latest build. The version-specific endpoint
    // (/v2/resources/{id}/versions/{versionId}/download) answers 403 for every version of every
    // resource, with any user agent, so asking for a chosen build could never work. Verified
    // against the live API for resource 94387:
    //   /v2/resources/94387/download                    -> 200, 201871 bytes, a real jar
    //   /v2/resources/94387/versions/409737/download    -> 403
    //   /v2/resources/94387/versions/<uuid>/download    -> 404
    // The version picker therefore stays a READ-ONLY hint for Spigot: it shows which builds
    // exist and which Minecraft versions the resource declares, and the install always fetches
    // the latest build. The version id is kept out of the URL on purpose.
    const title = String(item.title || item.id || 'plugin').replace(/[^\w.-]+/g, '_');
    const url = `https://api.spiget.org/v2/resources/${encodeURIComponent(item.id)}/download`;
    return { url, filename: `${title}.jar`, source: 'spigot', projectId: item.id, versionId: null, gameVersion: item.version || null, latestBuild: true };
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
    // CurseForge returns hashes as [{ value, algo }]: algo 1 = sha1, algo 2 = md5.
    let cfHashes = null;
    try {
      const list = Array.isArray(file.hashes) ? file.hashes : [];
      const sha1 = list.find(h => Number(h.algo) === 1)?.value;
      const md5 = list.find(h => Number(h.algo) === 2)?.value;
      if (sha1 || md5) cfHashes = { ...(sha1 ? { sha1: String(sha1).toLowerCase() } : {}), ...(md5 ? { md5: String(md5).toLowerCase() } : {}) };
    } catch {}
    return { url: inst.url, filename: file.fileName, source: 'curseforge', size: file.fileLength || 0, hashes: cfHashes, projectId: item.id, versionId: file.id != null ? String(file.id) : null, gameVersion: item.version || (file.gameVersions && file.gameVersions[0]) || null, versionNumber: file.displayName || null, gameVersions: file.gameVersions || [], loaders: [], dependencies: cf.cfDependencies(file) };
  }
  throw new Error('Unsupported marketplace source.');
}

// Shared detail-response shape for a source whose version API is a flat list. Hangar and Spigot each
// need the same four closing lines around their own fetch, and the no-dup guard flags a copy.
// `fetchVersions()` returns the raw array; `mapOne(v)` turns one entry into the modal's shape.
function emptyDetail(item) {
  return { ok: true, title: (item && item.title) || '', description: (item && item.description) || '', icon: (item && item.icon) || '', author: (item && item.author) || '', env: null, loaders: null, versions: null, projectUrl: (item && item.projectUrl) || null };
}
function buildDetail({ title, description, icon, author, loaders, versions, sourceUrl, projectUrl, item, versionPickable }) {
  return {
    ok: true,
    title: title || (item && item.title) || '',
    description: description || (item && item.description) || '',
    icon: icon || (item && item.icon) || '',
    author: author || (item && item.author) || '',
    env: null,
    loaders: loaders || null,
    versions,
    // FALSE for a source whose registry cannot install a chosen build: the picker would promise
    // something the download cannot deliver. The renderer hides it and explains instead.
    versionPickable: versionPickable !== false,
    sourceUrl: sourceUrl || null,
    projectUrl: projectUrl || (item && item.projectUrl) || null,
  };
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

  // v4.0.0: Spiget SEARCH returns no icon + no author NAME (only author.id). This lazily fills both
  // for a PAGE of ids so the search itself stays instant: the renderer shows the rows first, then
  // calls this once and patches the cards in place as data arrives. Optimised: a bounded concurrency
  // pool (5 in flight) + two in-memory caches (resource, author) so re-searching/paging is free.
  // Bounded (LRU-ish) caches: these hold icon URLs / base64 data + author names across the whole
  // app session, so an unbounded Map would grow on every marketplace browse. Cap at 200 entries and
  // drop the oldest (Map preserves insertion order) when full.
  const SPIGOT_CACHE_MAX = 200;
  const spigotResCache = new Map();    // id -> { icon, authorId }
  const spigotAuthorCache = new Map(); // authorId -> name | null
  const lruSet = (map, key, val) => { if (map.has(key)) map.delete(key); map.set(key, val); if (map.size > SPIGOT_CACHE_MAX) map.delete(map.keys().next().value); };
  async function poolMap(items, limit, fn) {
    const out = new Array(items.length);
    let next = 0;
    const run = async () => { while (next < items.length) { const idx = next++; out[idx] = await fn(items[idx]); } };
    await Promise.all(Array.from({ length: Math.min(limit, items.length || 1) }, run));
    return out;
  }
  ipcMain.handle('market:spigot-details', async (_, ids) => {
    const list = (Array.isArray(ids) ? ids : []).slice(0, 40).map(String);
    const rows = await poolMap(list, 5, async (id) => {
      try {
        let r = spigotResCache.get(id);
        if (!r) {
          const d = await json(`https://api.spiget.org/v2/resources/${encodeURIComponent(id)}`);
          const ic = d && d.icon;
          const raw = (ic && (ic.url || (typeof ic === 'string' ? ic : null))) || null;
          let icon = null;
          if(raw){ const s = String(raw); icon = s.startsWith('http') ? s : 'https://www.spigotmc.org/' + s.replace(/^\/+/, ''); }
          else if(ic && ic.data) icon = 'data:image/png;base64,' + String(ic.data);
          r = { icon, authorId: (d && d.author && d.author.id != null) ? String(d.author.id) : null };
          lruSet(spigotResCache, id, r);
        }
        let author = null;
        if (r.authorId) {
          if (spigotAuthorCache.has(r.authorId)) author = spigotAuthorCache.get(r.authorId);
          else {
            try { const a = await json(`https://api.spiget.org/v2/authors/${encodeURIComponent(r.authorId)}`); author = (a && a.name) || null; }
            catch { author = null; }
            lruSet(spigotAuthorCache, r.authorId, author);
          }
        }
        return { id, icon: r.icon, author };
      } catch { return { id, icon: null, author: null }; }
    });
    const details = {};
    for (const r of rows) if (r) details[r.id] = { icon: r.icon, author: r.author };
    return { ok: true, details };
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
      if (item && item.source === 'hangar') {
        // v6.0.0: Hangar has a real project + version endpoint, so the install modal gets the same
        // treatment Modrinth already had: a source link, the project page, a version list, and the
        // game versions that build declares. The shape was verified against the live API (a project
        // exposes settings.links[] -> links[], and each version carries platformDependencies.PAPER
        // as the game-version array plus downloads.PAPER.fileInfo).
        const [owner, slug] = String(item.id).split('/');
        if (!owner || !slug) return emptyDetail(item);
        let proj = {};
        try { proj = await json(`https://hangar.papermc.io/api/v1/projects/${encodeURIComponent(owner)}/${encodeURIComponent(slug)}`); } catch { proj = {}; }
        // Flatten the nested links groups and pick the first Source / Issues URL as the source link.
        const allLinks = [];
        for (const grp of (proj.settings && proj.settings.links) || []) for (const l of grp.links || []) allLinks.push({ name: String(l.name || ''), url: String(l.url || '') });
        const sourceLink = allLinks.find(l => /^(source|issues|github|gitlab|code)$/i.test(l.name)) || allLinks.find(l => /github\.com|gitlab\.com/i.test(l.url)) || null;
        const projectUrl = `https://hangar.papermc.io/${encodeURIComponent(owner)}/${encodeURIComponent(slug)}`;
        let versions = [];
        try {
          const vres = await json(`https://hangar.papermc.io/api/v1/projects/${encodeURIComponent(owner)}/${encodeURIComponent(slug)}/versions?limit=25`);
          const isVel = item && (item.software === 'velocity' || item.loader === 'velocity' || item.loader === 'proxy');
          const pickDl = v => (isVel ? (v.downloads?.VELOCITY || v.downloads?.PAPER || v.downloads?.WATERFALL) : (v.downloads?.PAPER || v.downloads?.VELOCITY || v.downloads?.WATERFALL)) || null;
          versions = (vres.result || [])
            .filter(v => v.downloads && pickDl(v)?.downloadUrl)
            .map(v => {
              const dl = pickDl(v);
              const gv = (v.platformDependencies && (v.platformDependencies.PAPER || v.platformDependencies.VELOCITY || v.platformDependencies.WATERFALL)) || [];
              const ld = Object.keys(v.downloads || {}).map(k => k.toLowerCase());
              return {
                id: v.name,
                number: v.name,
                gameVersions: gv,
                loaders: ld.length ? ld : ['paper'],
                date: v.createdAt || null,
                size: (dl?.fileInfo && dl.fileInfo.sizeBytes) || 0,
                dependencies: [],
              };
            });
        } catch { versions = []; }
        return buildDetail({ item, title: proj.name, description: proj.description, icon: proj.avatarUrl, author: (proj.memberNames && proj.memberNames[0]), loaders: ['paper', 'velocity'], versions, sourceUrl: sourceLink ? sourceLink.url : null, projectUrl });
      }
      if (item && item.source === 'spigot') {
        // v6.0.0: SpigotMC's API DOES expose a resource's versions, its tested Minecraft versions,
        // and a sourceCodeLink. The old code assumed it had none, so a Spigot install showed no
        // version picker and no source link. Shape verified against the live API: the resource
        // carries { testedVersions: [], sourceCodeLink }, and /resources/{id}/versions returns
        // [{ id, name, releaseDate, downloads }].
        const id = String(item.id || '');
        if (!id) return emptyDetail(item);
        let res = {};
        try { res = await json(`https://api.spiget.org/v2/resources/${encodeURIComponent(id)}`); } catch { res = {}; }
        // BUGFIX (v6.0.0 follow-up): search results only carry the author's NUMERIC id, so
        // item.author is always null for Spigot and the modal showed "Unknown author" for every
        // project. The search card fills it in lazily, but the item object handed to the modal is
        // the raw search row, so that fix never reached this path. Resolve the name here.
        // Same lazy gap for the icon: Spiget search returns no icon, the grid fills it in after the
        // fact, and the modal is opened from the raw row, so it showed an empty frame. The resource
        // fetch above carries the icon, so use it.
        let iconUrl = item.icon || '';
        if (!iconUrl && res.icon) {
          const raw = res.icon.url || (typeof res.icon === 'string' ? res.icon : null);
          if (raw) { const s = String(raw); iconUrl = s.startsWith('http') ? s : 'https://www.spigotmc.org/' + s.replace(/^\/+/, ''); }
          else if (res.icon.data) iconUrl = 'data:image/png;base64,' + String(res.icon.data);
        }
        let authorName = item.author || '';
        if (!authorName && res.author && res.author.id != null) {
          try {
            const a = await json(`https://api.spiget.org/v2/authors/${encodeURIComponent(String(res.author.id))}`);
            authorName = (a && a.name) || '';
          } catch { /* leave blank; the UI falls back to its own unknown-author label */ }
        }
        const tested = Array.isArray(res.testedVersions) ? res.testedVersions : [];
        const projectUrl = `https://www.spigotmc.org/resources/${encodeURIComponent(id)}/`;
        let versions = [];
        try {
          const list = await json(`https://api.spiget.org/v2/resources/${encodeURIComponent(id)}/versions?size=25&sort=-releaseDate`);
          versions = (Array.isArray(list) ? list : []).map(v => ({
            id: String(v.id),
            number: String(v.name || v.id),
            // A Spigot version's own MC list is not exposed; the resource-level testedVersions is the
            // best available signal, so every row shares it. That is honest: the picker still lets
            // the user choose a build, it just cannot claim per-build MC support.
            gameVersions: tested,
            loaders: ['paper', 'spigot', 'bukkit'],
            date: v.releaseDate ? new Date(v.releaseDate * 1000).toISOString() : null,
            size: 0,
            dependencies: [],
          }));
        } catch { versions = []; }
        return buildDetail({ item, title: res.name, description: res.tag, icon: iconUrl, author: authorName, loaders: ['paper', 'spigot', 'bukkit'], versions, sourceUrl: res.sourceCodeLink || null, projectUrl, versionPickable: false });
      }
      if (!item || item.source !== 'modrinth') {
        // Anything else (an unknown source) keeps just the fields the search already returned.
        return emptyDetail(item);
      }
      const proj = await json(`https://api.modrinth.com/v2/project/${encodeURIComponent(item.id)}`);
      const versions = await json(`https://api.modrinth.com/v2/project/${encodeURIComponent(item.id)}/version`);
      const map = v => {
        const f = (v.files || []).find(x => x.primary) || (v.files || [])[0] || {};
        return { id: v.id, number: v.version_number, name: v.name || v.version_number, date: v.date_published, gameVersions: v.game_versions || [], loaders: v.loaders || [], size: f.size || 0, versionType: v.version_type || 'release',
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
      const projectLoaders = (proj.loaders && proj.loaders.length) ? proj.loaders : (item.loaders || []);
      const projectEnv = {
        client: proj.client_side || item.env?.client || null,
        server: proj.server_side || item.env?.server || null,
        normalized: normalizeEnv({ client: proj.client_side || item.env?.client, server: proj.server_side || item.env?.server })
      };
      const sourceUrl = proj.source_url || proj.wiki_url || proj.issues_url || null;
      const projectUrl = `https://modrinth.com/project/${encodeURIComponent(proj.slug || item.id)}`;
      return { ok: true, title: proj.title, description: proj.description, body: String(proj.body || '').slice(0, 1500), icon: proj.icon_url || item.icon || '', author: item.author || (proj.owner || ''), env: projectEnv, loaders: projectLoaders, versions: mapped, sourceUrl, projectUrl };
    } catch (error) { return { ok: false, error: marketplaceError(error).error }; }
  });

  ipcMain.handle('market:install', async (_, item) => {
    try {
      if (!ctx.currentServerPath) return { ok: false, error: 'Choose and apply a server folder first.' };
      const kind = ['forge', 'fabric', 'neoforge', 'mod', 'datapack'].includes(item.kind) ? item.kind : 'plugin';
      const levelName = serverFiles(ctx.currentServerPath).properties['level-name'] || 'world';
      // BUGFIX (v3.0.0): a 'mod' (or neoforge) item was NOT in the kind list, so it fell through to
      // 'plugin' and a mod jar landed in plugins/ where the mod loader never sees it. Map every mod
      // loader to mods/ (mirrors the MCP install_from_market path).
      const destFolders = { plugin: 'plugins', forge: 'mods', fabric: 'mods', neoforge: 'mods', mod: 'mods', datapack: path.join(levelName, 'datapacks') };
      const destDir = safeTarget(ctx.currentServerPath, destFolders[kind]);
      fs.mkdirSync(destDir, { recursive: true });
      const { url, filename, hashes, projectId, versionId, gameVersion, versionNumber } = await resolveMarketDownload(item);
      // SECURITY (SSRF): the download URL comes from a remote registry API. Validate it is a public
      // http(s) host BEFORE fetching (same guard modpacks + the MCP install path already use), so a
      // crafted API entry pointing at file://, localhost or a private range can never be fetched.
      const { isSafeDownloadUrl } = require('./validate.js');
      if (!isSafeDownloadUrl(url)) return { ok: false, error: 'Refused: the download URL is not on an allowlisted public host.' };
      const dest = path.join(destDir, path.basename(filename));
      // A single plugin/mod jar is normally well under 100 MB; cap at 512 MB.
      await download(url, dest, (received, total) => ctx.send('market:progress', { phase: 'file', name: filename, received, total }), null, { maxBytes: 512 * 1024 * 1024 });
      // SECURITY (supply-chain): verify the file against the registry's hash before keeping it.
      const { verifyFileHash } = require('./fs-utils.js');
      const vh = verifyFileHash(dest, hashes);
      if (!vh.ok) { try { fs.rmSync(dest, { force: true }); } catch {} return { ok: false, error: `${vh.error} The file was deleted — retry, or install manually from the project page.` }; }
      // A jar is a ZIP, so it starts with the "PK" signature. Without this check a registry that
      // answers 200 with an HTML error page (or a captcha wall) is saved as "<name>.jar" and
      // reported as a SUCCESSFUL install. The server then cannot load it and the user has to
      // work out why the plugin is not working. A file that is not a zip is deleted and reported
      // as the failure it is. The check runs BEFORE the manifest entry, so a rejected file is
      // never recorded as installed.
      if (!isZipFile(dest)) {
        try { fs.rmSync(dest, { force: true }); } catch {}
        return { ok: false, error: 'The registry did not return a plugin file (the download was not a jar). Nothing was installed - try again or download it from the project page.' };
      }
      recordManifestEntry(ctx.currentServerPath, { kind, fileName: path.basename(filename), sourceUrl: url, source: item.source, title: item.title, env: item.env || undefined, projectId: projectId || item.id, versionId: versionId || undefined, gameVersion: gameVersion || undefined, version: versionNumber || undefined, installedAt: new Date().toISOString() });
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
    // 4.0.0: extended for the New Server wizard's "Learn more" links (official software sites).
    const allowed = ['modrinth.com', 'hangar.papermc.io', 'spigotmc.org', 'github.com', 'gitlab.com', 'bitbucket.org', 'curseforge.com', 'papermc.io', 'purpurmc.org', 'leafmc.one', 'fabricmc.net', 'neoforged.net', 'minecraftforge.net', 'minecraft.net'];
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
  const limit = Math.min(Math.max(1, Number(item.limit) || 25), 100);
  const filterVer = item.version || item.gameVersion || null;
  const filterLoader = item.loader || null;

  if (source === 'modrinth') {
    const r = await json('https://api.modrinth.com/v2/project/' + encodeURIComponent(id) + '/version');
    let mapped = (r || []).map(v => ({ id: v.id, number: v.version_number, gameVersions: v.game_versions || [], loaders: v.loaders || [], date: v.date_published, size: (v.files || []).find(f => f.primary)?.size || (v.files || [])[0]?.size || 0 }));
    if (filterVer) mapped = mapped.filter(v => (v.gameVersions || []).includes(filterVer));
    if (filterLoader) mapped = mapped.filter(v => (v.loaders || []).includes(filterLoader));
    return mapped.slice(0, limit);
  }
  if (source === 'hangar') {
    const [owner, slug] = String(id).split('/');
    if (!owner || !slug) throw new Error('Hangar id must be owner/slug.');
    const data = await json(`https://hangar.papermc.io/api/v1/projects/${encodeURIComponent(owner)}/${encodeURIComponent(slug)}/versions?limit=${limit}`);
    let mapped = (data.result || []).map(v => {
      const gv = (v.platformDependencies && (v.platformDependencies.PAPER || v.platformDependencies.VELOCITY || v.platformDependencies.WATERFALL)) || [];
      return { id: v.name, number: v.name, gameVersions: Array.isArray(gv) ? gv : (gv ? [gv] : []), loaders: ['paper'], date: v.createdAt || null };
    });
    if (filterVer) mapped = mapped.filter(v => (v.gameVersions || []).includes(filterVer));
    return mapped.slice(0, limit);
  }
  // curseforge
  const headers = cfHeaders();
  if (!headers) { const e = new Error('CurseForge API key not set. Add your own key in Settings.'); e.code = 'noKey'; throw e; }
  const files = await json(`${cf.CF_BASE}/mods/${encodeURIComponent(id)}/files?pageSize=${Math.min(limit, 50)}`, headers);
  let versions = (files.data || []).map(cf.mapCfFileToVersion).filter(Boolean);
  versions.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
  if (filterVer) versions = versions.filter(v => (v.gameVersions || []).includes(filterVer));
  if (filterLoader) versions = versions.filter(v => (v.loaders || []).includes(filterLoader));
  return versions.slice(0, limit);
}

// v2.5.0 (Doctor fix): resolve a modId-ish string to a REAL Modrinth project, without blindly
// installing the top search hit. Steps: (1) try query variants ('alexsmobs' -> 'alexs mobs');
// (2) try a direct /v2/project/{slug} lookup for each candidate (handles slug-only projects that
// full-text search misses); (3) score hits with pickBestMatch and REFUSE when ambiguous so the AI
// surfaces candidates instead of installing the wrong mod. Returns { ok, item } or { ok:false, ... }.
// `loader` (optional) is passed straight to searchMarket so a mod is matched for the right loader.
async function findMarketProject(query, opts) {
  const o = opts || {};
  const { candidateQueries, pickBestMatch } = require('../mcp/repair.js');
  const variants = candidateQueries(query);
  if (!variants.length) return { ok: false, error: 'No query given.' };
  // 1) direct slug lookup first - cheapest and most exact. A project slug is lowercase, no spaces.
  const slug = String(query || '').toLowerCase().replace(/[^a-z0-9-]/g, '');
  if (slug) {
    try {
      const p = await json(`https://api.modrinth.com/v2/project/${encodeURIComponent(slug)}`);
      if (p && p.id) return { ok: true, item: { source: 'modrinth', id: p.id, title: p.title, slug: p.slug } };
    } catch { /* 404 is expected for most ids - fall through to search */ }
  }
  // 2) search each variant, score the pooled hits.
  const pooled = [];
  const seen = new Set();
  for (const v of variants) {
    let s;
    try { s = await searchMarket({ source: 'modrinth', kind: 'mod', query: v, loader: o.loader || '' }); }
    catch { continue; }
    for (const it of (s && s.items) || []) { if (it && it.id && !seen.has(it.id)) { seen.add(it.id); pooled.push(it); } }
    // Stop as soon as a variant already gave a clear winner.
    const early = pickBestMatch(query, pooled);
    if (early.best) return { ok: true, item: early.best };
  }
  const pick = pickBestMatch(query, pooled);
  if (pick.best) return { ok: true, item: pick.best };
  if (pick.ambiguous) return { ok: false, ambiguous: true, candidates: pick.candidates.map(c => ({ id: c.id, title: c.title })), error: `Multiple mods match "${query}" - pick one by id.` };
  return { ok: false, candidates: pick.candidates.map(c => ({ id: c.id, title: c.title })), error: `No mod found matching "${query}".` };
}

module.exports = { registerMarketplace, searchMarket, resolveMarketDownload, listMarketVersions, findMarketProject, isZipFile };
