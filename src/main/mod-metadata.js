// 2.3.0: parse a mod jar's OWN declared metadata so the modpack planner can catch REQUIRED
// dependencies that the registry (Modrinth) does not expose — e.g. Kotlin for Forge, which
// particle_core needs but which is not listed as a Modrinth dependency of particle_core.
//
// Also surfaces client/server environment so the AI does not have to guess whether a mod is
// client-only (installing those on a server does nothing or crashes startup).
//
// Pure parsing (string in -> object out) so it is unit-testable; jar-read.js does the I/O.

// --- neoforge.mods.toml / mods.toml (TOML-ish) ---
// We only need the [[dependencies.<modid>]] blocks and their mandatory/modId/versionRange fields.
// A full TOML parser is overkill; these files are machine-generated and regular.
function parseTomlDependencies(toml) {
  const deps = [];
  const lines = String(toml || '').split(/\r?\n/);
  let inDep = false;
  let cur = null;
  // BUGFIX (v2.3.1): NeoForge/Forge default `mandatory` to TRUE, BUT only when `type` is not
  // "optional". A block with type="optional" (e.g. modernfix's JEI integration) is NOT required and
  // must not be reported as a missing dependency. mandatory wins when set explicitly; otherwise it
  // is derived from type (optional -> false, required/absent -> true).
  const flush = () => {
    if (cur && cur.modId) {
      const t = String(cur.type || '').toLowerCase();
      // v2.3.1: four NeoForge/Forge relation types. `optional`/`discouraged` are not required;
      // `incompatible` means the mod must NOT be present (a CONFLICT, not a missing dep).
      cur.optional = t === 'optional' || t === 'discouraged';
      cur.incompatible = t === 'incompatible';
      if (cur.mandatory === undefined) cur.mandatory = !cur.optional && !cur.incompatible;
      deps.push(cur);
    }
    cur = null;
  };
  for (const raw of lines) {
    const line = raw.trim();
    const header = line.match(/^\[\[\s*dependencies(?:\.([\w.-]+))?\s*\]\]$/i);
    if (header) { flush(); inDep = true; continue; }
    if (/^\[/.test(line)) { flush(); inDep = false; continue; }
    if (!inDep) continue;
    const kv = line.match(/^([\w]+)\s*=\s*(.+?)\s*$/);
    if (!kv) continue;
    const key = kv[1].toLowerCase();
    let val = kv[2].replace(/^["']|["']$/g, '').replace(/\s*#.*$/, '').trim();
    if (key === 'modid') { if (!cur) cur = {}; cur.modId = val; }
    else if (key === 'mandatory') { if (!cur) cur = {}; cur.mandatory = /true/i.test(val); }
    else if (key === 'versionrange') { if (!cur) cur = {}; cur.versionRange = val; }
    else if (key === 'type') { if (!cur) cur = {}; cur.type = val; }
    else if (key === 'reason') { if (!cur) cur = {}; cur.reason = val; }
  }
  flush();
  return deps;
}

// --- fabric.mod.json ---
function parseFabricDependencies(json) {
  const deps = [];
  const obj = json && typeof json === 'object' ? json : {};
  for (const [k, v] of Object.entries(obj.depends || {})) {
    // 'minecraft', 'fabricloader', 'java' are platform deps, not mods to install.
    if (['minecraft', 'fabricloader', 'java', 'fabric-api'].includes(k)) continue;
    deps.push({ modId: k, mandatory: true, versionRange: typeof v === 'string' ? v : '*', type: 'fabric' });
  }
  for (const [k, v] of Object.entries(obj.breaks || {})) deps.push({ modId: k, mandatory: false, incompatible: true, versionRange: typeof v === 'string' ? v : '*', type: 'fabric' });
  return deps;
}

// Environment: Fabric declares obj.environment; NeoForge uses [[mods]] displayTest = 'IGNORE_SERVER_VERSION' etc.
function fabricEnv(json) {
  const e = String((json && json.environment) || '').toLowerCase();
  if (e === 'client') return 'client';
  if (e === 'server') return 'server';
  if (e === '*') return 'both';
  return null;
}

// v2.3.1: normalize client/server environment into a single 4-bucket model the modpack tools can
// act on. SOURCES, most trustworthy first:
//   - Modrinth env: { client: 'required'|'optional'|'unsupported', server: same }
//   - Fabric environment: 'client' | 'server' | '*'
// NOTE: NeoForge/Forge `displayTest` is NOT a side marker (it only controls the client/server
// version-mismatch warning), so we deliberately do NOT derive env from it — that was a v2.3.0 bug.
// Returns 'client-only' | 'server-only' | 'both' | 'unknown'.
function normalizeEnv(modrinthEnv, fabricEnvironment) {
  const e = modrinthEnv && typeof modrinthEnv === 'object' ? modrinthEnv : null;
  if (e && (e.client || e.server)) {
    const c = String(e.client || ''); const s = String(e.server || '');
    const cOk = c === 'required' || c === 'optional';
    const sOk = s === 'required' || s === 'optional';
    if (s === 'unsupported' && cOk) return 'client-only';
    if (c === 'unsupported' && sOk) return 'server-only';
    if (sOk && cOk) return 'both';
    if (sOk) return 'server-only';
    if (cOk) return 'client-only';
  }
  const f = String(fabricEnvironment || '').toLowerCase();
  if (f === 'client') return 'client-only';
  if (f === 'server') return 'server-only';
  if (f === '*') return 'both';
  return 'unknown';
}

// BUGFIX (v2.3.1): derive a mod id from the FILE NAME as a last resort. Some mods (Kotlin for
// Forge ships kotlinforforge-5.12.0-all.jar) keep their descriptor where we do not look, so
// modId came back null and the dependency checker wrongly reported them as MISSING even though the
// jar is installed. The filename id lets present-set matching still work. Strips a trailing
// version / -all / -universal / loader suffix.
function modIdFromFilename(name) {
  let s = String(name || '').replace(/\.jar$/i, '');
  s = s.replace(/-(all|universal|server|common|fabric|forge|neoforge|quilt)$/i, '');
  s = s.replace(/[-_]\d[\w.+\-]*$/, ''); // drop -1.2.3 / _5.12.0-all style suffixes
  s = s.replace(/[-_](mc)?\d+(\.\d+)*$/i, '');
  return s || null;
}

// v2.3.1: derive the LOADER from the file name as a last resort. Some jars (Kotlin for Forge's
// kotlinforforge-5.12.0-all.jar uses a non-standard layout) have no readable mods.toml, so loader
// came back null and the field was dropped. Only used when the jar metadata yielded nothing.
function loaderFromFilename(name) {
  const s = String(name || '').toLowerCase();
  if (/neoforge/.test(s)) return 'neoforge';
  if (/forge/.test(s)) return 'forge';
  if (/quilt/.test(s)) return 'quilt';
  if (/fabric/.test(s)) return 'fabric';
  return null;
}

// Classify a jar by reading the entries it MIGHT have. `read` is a function (name) -> { ok, content }.
// `fileName` (optional) is used only to derive a modId when the descriptor is unreadable/missing.
// Returns { loader, env, modId, dependencies:[{modId, mandatory, versionRange}] } — loader null if unknown.
function classifyJar(read, fileName) {
  const out = { loader: null, env: null, envHint: null, modId: null, dependencies: [] };
  const finish = () => {
    if (!out.modId) out.modId = modIdFromFilename(fileName);
    // loader from the FILE NAME is a guess (a jar may be multi-loader or misnamed), so flag it —
    // callers must NOT treat a guessed loader as an authoritative mismatch.
    if (!out.loader) { out.loader = loaderFromFilename(fileName); if (out.loader) out.loaderGuessed = true; }
    return out;
  };
  const neo = read('META-INF/neoforge.mods.toml');
  if (neo && neo.ok) {
    out.loader = 'neoforge';
    const mid = String(neo.content).match(/modId\s*=\s*["']([^"']+)["']/i);
    if (mid) out.modId = mid[1];
    out.dependencies = parseTomlDependencies(neo.content);
    // displayTest is a WEAK side hint (it primarily controls the version-mismatch warning):
    //   IGNORE_SERVER_VERSION / IGNORE_ALL_VERSION -> the mod does not need to be on the server.
    // Stored as `envHint` (NOT authoritative `env`) so a real Modrinth/Fabric value always wins.
    const dt = String(neo.content).match(/displayTest\s*=\s*["']([^"']+)["']/i);
    if (dt && /IGNORE_(SERVER|ALL)/i.test(dt[1])) out.envHint = 'client-only';
    return finish();
  }
  const forge = read('META-INF/mods.toml');
  if (forge && forge.ok) {
    out.loader = 'forge';
    const mid = String(forge.content).match(/modId\s*=\s*["']([^"']+)["']/i);
    if (mid) out.modId = mid[1];
    out.dependencies = parseTomlDependencies(forge.content);
    return finish();
  }
  const fab = read('fabric.mod.json');
  if (fab && fab.ok) {
    out.loader = 'fabric';
    try {
      const j = JSON.parse(fab.content);
      out.modId = j.id || null;
      out.env = normalizeEnv(null, fabricEnv(j));
      out.dependencies = parseFabricDependencies(j);
    } catch { /* malformed json -> keep empty deps */ }
    return finish();
  }
  // Quilt uses quilt.mod.json and is Fabric-compatible.
  const quilt = read('quilt.mod.json');
  if (quilt && quilt.ok) { out.loader = 'quilt'; return finish(); }
  return finish();
}

module.exports = { parseTomlDependencies, parseFabricDependencies, classifyJar, fabricEnv, normalizeEnv, modIdFromFilename, loaderFromFilename };
