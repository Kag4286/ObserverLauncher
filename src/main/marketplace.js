// Marketplace handlers (remote catalog search/install).
// Owns: market:versions/search/detail/install. Progress events go through
// ctx.send so the renderer wiring is untouched.
const fs = require('fs');
const path = require('path');
const { serverFiles } = require('./server-files.js');
const { safeTarget, recordManifestEntry } = require('./fs-utils.js');
const { json, download, marketplaceError } = require('./http.js');
function registerMarketplace(ipcMain, ctx) {
  ipcMain.handle('market:versions', async () => {
    try {
      const versions = await json('https://api.modrinth.com/v2/tag/game_version');
      const releases = versions.filter(x => x.version_type === 'release').sort((a, b) => new Date(b.date) - new Date(a.date));
      return { ok: true, versions: releases.map(x => x.version) };
    } catch (error) { return marketplaceError(error); }
  });

  ipcMain.handle('market:search', async (_, { source, kind, query, version, sort, offset }) => {
    const skip = Math.max(0, Number(offset) || 0);
    try {
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
      const page = Math.floor(skip / 20) + 1;
      const data = await json(`https://api.spiget.org/v2/search/resources/${encodeURIComponent(query || 'plugin')}?size=20&page=${page}&sort=${sort === 'latest' ? '-releaseDate' : '-downloads'}`);
      return { ok: true, total: null, items: data.map(x => ({ source: 'spigot', id: String(x.id), title: x.name, author: x.author?.username || 'Spigot author', description: x.tag || x.description || '', downloads: x.downloads || 0, version })) };
    } catch (error) { return marketplaceError(error); }
  });

  ipcMain.handle('market:detail', async (_, item) => {
    try {
      if (!item || item.source !== 'modrinth') {
        return { ok: true, title: item?.title || '', description: item?.description || '', icon: item?.icon || '', author: item?.author || '', env: item?.env || null, loaders: item?.loaders || null, versions: null };
      }
      const proj = await json(`https://api.modrinth.com/v2/project/${encodeURIComponent(item.id)}`);
      const versions = await json(`https://api.modrinth.com/v2/project/${encodeURIComponent(item.id)}/version`);
      const map = v => {
        const f = (v.files || []).find(x => x.primary) || (v.files || [])[0] || {};
        return { id: v.id, number: v.version_number, name: v.name || v.version_number, date: v.date_published, gameVersions: v.game_versions || [], loaders: v.loaders || [], size: f.size || 0 };
      };
      return { ok: true, title: proj.title, description: proj.description, body: String(proj.body || '').slice(0, 1500), icon: proj.icon_url || item.icon || '', author: item.author || (proj.owner || ''), env: item.env || null, loaders: item.loaders || null, versions: versions.map(map) };
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
      let url, filename;
      if (item.source === 'modrinth') {
        const versions = await json(`https://api.modrinth.com/v2/project/${encodeURIComponent(item.id)}/version`);
        const wantedLoaders = { plugin: ['paper', 'spigot', 'purpur', 'folia', 'bukkit'], forge: ['forge', 'neoforge'], fabric: ['fabric', 'quilt'], datapack: ['datapack', 'minecraft'] }[kind];
        const byVersion = versions.filter(v => !item.version || (v.game_versions || []).includes(item.version));
        let target = null;
        if (item.versionId) target = versions.find(v => v.id === item.versionId) || null;
        if (!target) {
          target = byVersion.find(v => (v.loaders || []).some(l => wantedLoaders.includes(l))) || byVersion[0] || versions[0];
        }
        if (!target?.files?.[0]) throw new Error('No downloadable version was found.');
        url = target.files.find(f => f.primary)?.url || target.files[0].url;
        filename = target.files.find(f => f.primary)?.filename || target.files[0].filename;
      } else if (item.source === 'hangar') {
        const [owner, slug] = String(item.id).split('/');
        const versions = await json(`https://hangar.papermc.io/api/v1/projects/${encodeURIComponent(owner)}/${encodeURIComponent(slug)}/versions?limit=20`);
        const target = (versions.result || []).find(v => v.downloads?.PAPER?.downloadUrl);
        const file = target?.downloads?.PAPER;
        if (!file) throw new Error('No Paper download was found for this Hangar project.');
        url = file.downloadUrl;
        filename = file.fileInfo?.name || `${slug}.jar`;
      } else if (item.source === 'spigot') {
        url = `https://api.spiget.org/v2/resources/${encodeURIComponent(item.id)}/download`;
        filename = `${item.title.replace(/[^\w.-]+/g, '_')}.jar`;
      } else throw new Error('Unsupported marketplace source.');
      const dest = path.join(destDir, path.basename(filename));
      await download(url, dest, (received, total) => ctx.send('market:progress', { phase: 'file', name: filename, received, total }));
      recordManifestEntry(ctx.currentServerPath, { kind, fileName: path.basename(filename), sourceUrl: url, source: item.source, title: item.title, installedAt: new Date().toISOString() });
      return { ok: true, files: serverFiles(ctx.currentServerPath), name: filename };
    } catch (error) { return marketplaceError(error); }
  });
}

module.exports = { registerMarketplace };
