// src/main/curseforge.js — CurseForge integration (pure helpers + thin API wrappers).
//
// WHY THIS IS DIFFERENT from Modrinth/Hangar/Spigot: CurseForge (Overwolf) requires an API key
// that its Terms of Service forbid sharing — so this app never bundles one. The USER pastes their
// own key in Settings and it is only ever sent to api.curseforge.com. Also, since 10/2024 authors
// can opt OUT of third-party distribution: for those projects the API returns no downloadUrl and
// no launcher may auto-install them. This module models that honestly (cfFileInstallable) so the
// UI can offer a manual fallback instead of pretending.
//
// The decision logic here is PURE (no network, no Electron) so it is unit-testable.
const CF_BASE = 'https://api.curseforge.com/v1';
const CF_GAME_ID = 432; // Minecraft

// Resolve many CF file ids in one batched call. Returns an array of file objects (downloadUrl,
// fileName, hashes, modId, ...). Needs the user's key (headers). Chunked to respect the API limit.
async function resolveCfFileIds(fileIds, headers) {
  const { json } = require('./http.js');
  const ids = [...new Set((fileIds || []).map(Number).filter(Boolean))];
  const out = [];
  for (let i = 0; i < ids.length; i += 1000) {
    const chunk = ids.slice(i, i + 1000);
    const r = await json(`${CF_BASE}/mods/files`, headers, 'POST', JSON.stringify({ fileIds: chunk }));
    for (const f of (r.data || [])) out.push(f);
  }
  return out;
}

// CurseForge classId per content kind. Values verified against the CF v1 API docs; unknown kinds
// fall back to Mods. (5=Bukkit Plugins, 6=Mods, 4471=Modpacks, 6945=Data Packs.)
const CLASS_ID = { plugin: 5, mod: 6, forge: 6, neoforge: 6, fabric: 6, modpack: 4471, datapack: 6945 };
function classIdForKind(kind) { return CLASS_ID[kind] || CLASS_ID.mod; }

// CurseForge modLoader type ids. 0=Any, 1=Forge, 4=Fabric, 5=Quilt, 6=NeoForge.
const LOADER_ID = { any: 0, forge: 1, fabric: 4, quilt: 5, neoforge: 6 };
function loaderIdFor(loader) { return LOADER_ID[String(loader || '').toLowerCase()] ?? 0; }

// A CF file is installable by a third party ONLY when the API returned a downloadUrl. When an
// author disabled distribution, downloadUrl is null / isAvailable is false — we must NOT synthesize
// a CDN url (that would circumvent the author's choice and breach the ToS). Pure + testable.
function cfFileInstallable(file) {
  if (!file) return { ok: false, reason: 'missing' };
  if (file.isAvailable === false) return { ok: false, reason: 'blocked' };
  const url = file.downloadUrl;
  if (!url || typeof url !== 'string') return { ok: false, reason: 'blocked' };
  return { ok: true, url };
}

// Shape a CF /mods/search or /mods/{id} hit into the SAME item shape the other three sources use,
// so the renderer never needs to know which registry a row came from.
function mapCfItem(hit) {
  const latest = (hit && hit.latestFiles) || [];
  const primary = latest[0] || null;
  const authors = (hit && hit.authors) || [];
  return {
    source: 'curseforge',
    id: String(hit.id),
    title: hit.name || String(hit.id),
    author: authors[0]?.name || 'CurseForge author',
    description: hit.summary || '',
    icon: hit.logo?.thumbnailUrl || hit.logo?.url || '',
    downloads: hit.downloadCount || 0,
    version: '',
    env: null,
    loaders: [],
    date: hit.dateModified || hit.dateCreated || null,
    // Whether the newest file can be auto-installed (drives the Install vs Open-page button).
    blocked: primary ? !cfFileInstallable(primary).ok : false,
    projectUrl: hit.links?.websiteUrl || `https://www.curseforge.com/minecraft/mc-mods/${hit.slug || hit.id}`,
  };
}

// Pick the newest file that matches the wanted game version and loader, from a CF /files list.
// Order in the CF response is newest-first, but we sort defensively. Pure.
function pickCfFile(files, gameVersion, loaderId) {
  const list = (files || []).slice();
  list.sort((a, b) => new Date(b.fileDate || 0) - new Date(a.fileDate || 0));
  const matches = f => {
    const gv = f.gameVersions || [];
    if (gameVersion && !gv.includes(gameVersion)) return false;
    if (loaderId) {
      const hasLoader = f.modLoader != null ? Number(f.modLoader) === Number(loaderId) : true;
      if (!hasLoader) return false;
    }
    return true;
  };
  return list.find(matches) || list[0] || null;
}

// ---- CurseForge MODPACK manifest (manifest.json inside a CF .zip) ----
// CurseForge packs are NOT .mrpack: they carry manifest.json with {projectID,fileID} pairs and no
// direct URLs, so the files must be resolved through the CF API. These helpers parse the manifest
// and split resolved files into installable vs blocked. Pure (no network/Electron).

// Parse a CurseForge manifest.json. Returns { ok, name, version, mc, loaders:[{id,primary}], files }.
// Rejects anything that is not a Minecraft modpack manifest so a random manifest.json can't be
// misread as a pack.
function parseCfManifest(json) {
  if (!json || typeof json !== 'object') return { ok: false, reason: 'notObject' };
  if (json.manifestType !== 'minecraftModpack') return { ok: false, reason: 'notModpack' };
  const mc = json.minecraft || {};
  const files = Array.isArray(json.files) ? json.files.filter(f => f && (f.projectID || f.fileID)) : [];
  return {
    ok: true,
    name: json.name || 'CurseForge modpack',
    version: json.version || '',
    mc: mc.version || null,
    loaders: Array.isArray(mc.modLoaders) ? mc.modLoaders : [],
    files: files.map(f => ({ projectID: Number(f.projectID) || null, fileID: Number(f.fileID) || null, required: f.required !== false })),
    overrides: json.overrides || 'overrides',
  };
}

// Map a CF loader id like 'forge-47.2.0' / 'fabric-0.15.0' / 'neoforge-20.4.1' / 'quilt-0.20' to
// { loader, version } using the SAME loader names the compat + folder logic already speak. Pure.
function cfLoaderFromManifest(loaders) {
  const list = Array.isArray(loaders) ? loaders : [];
  const primary = list.find(l => l && l.primary) || list[0] || null;
  const id = String((primary && primary.id) || '').toLowerCase();
  if (!id) return { loader: 'unknown', version: null, raw: null };
  const m = id.match(/^([a-z]+)-?(.*)$/);
  const kind = m ? m[1] : id;
  const version = m ? (m[2] || null) : null;
  const known = ['forge', 'neoforge', 'fabric', 'quilt'];
  return { loader: known.includes(kind) ? kind : 'unknown', version, raw: id };
}

// Split resolved CF files into installable (has a downloadUrl) vs blocked (author disabled
// distribution). Each side carries what the caller needs: url/filename/hashes for install, and
// projectID/name/pageUrl for the manual-download list. Pure.
function partitionCfFiles(files) {
  const installable = [], blocked = [];
  for (const f of (files || [])) {
    const inst = cfFileInstallable(f);
    const sha1 = (f.hashes || []).find(h => Number(h.algo) === 1)?.value || null; // 1 = SHA1 in CF
    const entry = { projectID: f.modId ?? f.projectID ?? null, fileID: f.id ?? f.fileID ?? null, fileName: f.fileName || null, hashes: { sha1 }, pageUrl: f.pageUrl || null, name: f.displayName || f.fileName || null };
    if (inst.ok) installable.push({ ...entry, url: inst.url });
    else blocked.push(entry);
  }
  return { installable, blocked };
}

// Verify user-dropped files against the blocked list (Prism-style): for each blocked entry, look
// for a file in <root>/mods (or world/datapacks) whose SHA1 matches, else fall back to filename.
// Returns { verified, missing }. Pure-ish (reads the server folder) so it is unit-testable with a
// temp dir. `destFolder` is relative to root, e.g. 'mods'.
function verifyBlockedFiles(root, blocked, destFolder) {
  const fs = require('fs');
  const path = require('path');
  const { fileHashes, safeTarget } = require('./fs-utils.js');
  const dir = safeTarget(root, destFolder || 'mods');
  const listing = (() => { try { return fs.readdirSync(dir); } catch { return []; } })();
  const hashCache = new Map();
  const hashOf = name => {
    if (hashCache.has(name)) return hashCache.get(name);
    let h = null;
    try { const fp = path.join(dir, name); if (fs.statSync(fp).isFile()) h = fileHashes(fp).sha1; } catch {}
    hashCache.set(name, h);
    return h;
  };
  const verified = [], missing = [];
  for (const b of (blocked || [])) {
    const wantSha = b.hashes?.sha1 || null;
    const wantName = b.fileName || null;
    let hit = null;
    if (wantSha) hit = listing.find(n => hashOf(n) === wantSha) || null;
    if (!hit && wantName && listing.includes(wantName)) hit = wantName;
    if (hit) verified.push({ ...b, matchedFile: hit });
    else missing.push(b);
  }
  return { verified, missing };
}

// Map a CurseForge file's `dependencies` array to a normalized list. IMPORTANT: CurseForge does
// NOT publish an official value table for relationType, so this mapping is best-effort and may be
// wrong for some entries. We only trust the three that are widely used in practice, and mark every
// entry `uncertain:true` so callers surface it rather than silently auto-installing. Pure.
//   3 = RequiredDependency, 2 = OptionalDependency, 5 = Incompatible (commonly observed)
const CF_RELATION = { 2: 'optional', 3: 'required', 5: 'incompatible' };
function cfDependencies(file) {
  const deps = (file && file.dependencies) || [];
  return deps.map(d => ({
    projectId: d && d.modId != null ? String(d.modId) : null,
    type: CF_RELATION[Number(d && d.relationType)] || 'unknown',
    uncertain: !CF_RELATION[Number(d && d.relationType)],
  })).filter(d => d.projectId);
}

// Map a CF file object to the SAME version shape the renderer's version picker uses for Modrinth
// ({ id, number, name, date, gameVersions, loaders, size, blocked }). CF files carry no loader list
// and no per-version dependency graph, so `loaders` is left empty and `blocked` marks files the
// author disabled for third-party downloads (the picker disables those). Pure.
function mapCfFileToVersion(file) {
  if (!file) return null;
  const sha1 = (file.hashes || []).find(h => Number(h.algo) === 1)?.value || null;
  return {
    id: String(file.id),
    number: file.displayName || file.fileName || String(file.id),
    name: file.displayName || file.fileName || String(file.id),
    date: file.fileDate || null,
    gameVersions: file.gameVersions || [],
    loaders: [],
    size: file.fileLength || 0,
    sha1,
    blocked: !cfFileInstallable(file).ok,
    dependencies: [],
  };
}

module.exports = { CF_BASE, CF_GAME_ID, classIdForKind, loaderIdFor, cfFileInstallable, mapCfItem, pickCfFile, parseCfManifest, cfLoaderFromManifest, partitionCfFiles, resolveCfFileIds, verifyBlockedFiles, cfDependencies, mapCfFileToVersion };
