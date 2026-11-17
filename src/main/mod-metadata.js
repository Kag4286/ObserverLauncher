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
      const side = String(cur.side || '').toUpperCase();
      // v2.3.1: four NeoForge/Forge relation types. `optional`/`discouraged` are not required;
      // `incompatible` means the mod must NOT be present (a CONFLICT, not a missing dep).
      // Also ignore side="CLIENT" requirements on dedicated servers (e.g. client HUD/shader integrations).
      cur.optional = t === 'optional' || t === 'discouraged' || side === 'CLIENT';
      cur.incompatible = t === 'incompatible';
      if (side === 'CLIENT') cur.mandatory = false;
      else if (cur.mandatory === undefined) cur.mandatory = !cur.optional && !cur.incompatible;
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
    const qm = kv[2].match(/^"([^"]*)"|^'([^']*)'/);
    let val = qm ? (qm[1] !== undefined ? qm[1] : qm[2]) : kv[2].replace(/\s*#.*$/, '').trim().replace(/^["']|["']$/g, '').trim();
    if (key === 'modid') { if (!cur) cur = {}; cur.modId = val; }
    else if (key === 'mandatory') { if (!cur) cur = {}; cur.mandatory = /true/i.test(val); }
    else if (key === 'versionrange') { if (!cur) cur = {}; cur.versionRange = val; }
    else if (key === 'type') { if (!cur) cur = {}; cur.type = val; }
    else if (key === 'side') { if (!cur) cur = {}; cur.side = val; }
    else if (key === 'reason') { if (!cur) cur = {}; cur.reason = val; }
  }
  flush();
  return deps;
}

// --- fabric.mod.json ---
function stringifyFabricConstraint(v) {
  if (Array.isArray(v)) return v.map(x => String(x || '').trim()).filter(Boolean).join(' || ') || '*';
  return typeof v === 'string' && v.trim() ? v.trim() : '*';
}

function parseFabricDependencies(json) {
  const deps = [];
  const obj = json && typeof json === 'object' ? json : {};
  for (const [k, v] of Object.entries(obj.depends || {})) {
    // 'minecraft', 'fabricloader', 'java', and 'fabric-api'/'fabric' platform aliases are checked
    // separately (missing Fabric API is flagged only if neither fabric-api nor fabric sub-modules exist).
    const low = String(k || '').toLowerCase();
    if (['minecraft', 'fabricloader', 'java', 'fabric-api', 'fabric'].includes(low)) continue;
    deps.push({ modId: k, mandatory: true, versionRange: stringifyFabricConstraint(v), type: 'fabric' });
  }
  for (const [k, v] of Object.entries(obj.breaks || {})) {
    deps.push({ modId: k, mandatory: false, incompatible: true, versionRange: stringifyFabricConstraint(v), type: 'fabric' });
  }
  for (const [k, v] of Object.entries(obj.conflicts || {})) {
    deps.push({ modId: k, mandatory: false, incompatible: true, versionRange: stringifyFabricConstraint(v), type: 'fabric' });
  }
  return deps;
}

// --- quilt.mod.json ---
function parseQuiltModJson(content) {
  const out = { modId: null, name: null, version: null, env: null, mcVersionRange: null, provides: [], dependencies: [], requiresFabricApi: false };
  try {
    const j = typeof content === 'object' ? content : parseLenientJson(content);
    const ql = (j && j.quilt_loader) || {};
    out.modId = ql.id || null;
    out.version = ql.version || null;
    out.name = (ql.metadata && ql.metadata.name) || out.modId || null;
    if (Array.isArray(ql.provides)) {
      out.provides = ql.provides.map(p => typeof p === 'string' ? p : (p && p.id)).filter(Boolean);
    }
    const deps = Array.isArray(ql.depends) ? ql.depends : [];
    for (const d of deps) {
      const id = typeof d === 'string' ? d : (d && d.id);
      if (!id) continue;
      const low = String(id).toLowerCase();
      const ver = typeof d === 'object' ? stringifyFabricConstraint(d.versions || d.version) : '*';
      if (low === 'minecraft') { out.mcVersionRange = ver; continue; }
      if (['quilt_loader', 'quilted_fabric_loader', 'fabricloader', 'java'].includes(low)) continue;
      if (low === 'fabric-api' || low === 'fabric' || low === 'quilted_fabric_api' || low === 'qsl') {
        out.requiresFabricApi = true;
        continue;
      }
      const optional = !!(typeof d === 'object' && d.optional);
      out.dependencies.push({ modId: id, mandatory: !optional, optional, versionRange: ver, type: 'quilt' });
    }
    const breaks = Array.isArray(ql.breaks) ? ql.breaks : [];
    for (const b of breaks) {
      const id = typeof b === 'string' ? b : (b && b.id);
      if (!id) continue;
      out.dependencies.push({ modId: id, mandatory: false, incompatible: true, versionRange: typeof b === 'object' ? stringifyFabricConstraint(b.versions || b.version) : '*', type: 'quilt' });
    }
    const mcSide = j && j.minecraft && j.minecraft.environment;
    if (mcSide === 'client' || mcSide === 'client_only') out.env = 'client-only';
    else if (mcSide === 'dedicated_server' || mcSide === 'server') out.env = 'server-only';
    else if (mcSide === '*') out.env = 'both';
  } catch {}
  return out;
}

// Lenient JSON parser for real-world mod/pack manifests (BOM, comments, trailing commas, unescaped newlines in strings).
function parseLenientJson(text) {
  const raw = String(text || '').replace(/^\uFEFF/, '');
  try { return JSON.parse(raw); } catch {}
  let out = '';
  let inStr = false;
  let esc = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (inStr) {
      if (esc) { out += ch; esc = false; continue; }
      if (ch === '\\') { out += ch; esc = true; continue; }
      if (ch === '"') { out += ch; inStr = false; continue; }
      const code = ch.charCodeAt(0);
      if (code < 0x20) {
        if (ch === '\n') out += '\\n';
        else if (ch === '\r') out += '\\r';
        else if (ch === '\t') out += '\\t';
        else out += '\\u' + code.toString(16).padStart(4, '0');
        continue;
      }
      out += ch;
      continue;
    }
    if (ch === '"') { out += ch; inStr = true; continue; }
    if (ch === '/' && raw[i + 1] === '/') {
      while (i < raw.length && raw[i] !== '\n') i++;
      out += '\n';
      continue;
    }
    if (ch === '/' && raw[i + 1] === '*') {
      i += 2;
      while (i < raw.length && !(raw[i] === '*' && raw[i + 1] === '/')) i++;
      i++;
      continue;
    }
    if (ch === ',') {
      let j = i + 1;
      while (j < raw.length && /\s/.test(raw[j])) j++;
      if (raw[j] === '}' || raw[j] === ']') continue;
    }
    out += ch;
  }
  return JSON.parse(out);
}

// CB3 (v3.3.0): the display name + version a mod/plugin jar DECLARES, so list_content can show a
// real version instead of a bare filename (the prerequisite for update checks). Pure parsers.
// FIRST [mods] / [[mods]] block (or inline mods = [{...}] table) of a (neo)forge mods.toml.
function parseTomlModInfo(toml) {
  const out = { modId: null, name: null, version: null };
  let inMods = false; const body = [];
  for (const raw of String(toml || '').split(/\r?\n/)) {
    if (/^\s*\[\[?\s*mods\s*\]\]?\s*$/i.test(raw)) { inMods = true; continue; }
    if (/^\s*\[/.test(raw)) { if (inMods) break; continue; }
    if (inMods) body.push(raw);
  }
  let text = body.join('\n');
  if (!text) {
    const inlineMatch = String(toml || '').match(/\bmods\s*=\s*\[([\s\S]*?)\]/i);
    text = inlineMatch ? inlineMatch[1] : String(toml || '');
  }
  const pick = re => { const m = text.match(re); return m ? m[1].replace(/^["']|["']$/g, '').trim() : null; };
  out.modId = pick(/\bmodId\s*=\s*["']([^"']+)["']/i);
  out.version = pick(/\bversion\s*=\s*["']([^"']+)["']/i);
  // v6.1.6: ignore unexpanded Gradle tokens like "${file.jarVersion}" so version resolves from manifest/filename.
  if (out.version && /^\$\{.*\}$/.test(out.version)) out.version = null;
  out.name = pick(/\b(?:displayName|name)\s*=\s*["']([^"']+)["']/i);
  return out;
}
// CB3: name + version from a bukkit/spigot plugin.yml (simple `key: value` lines).
function parsePluginYml(yml) {
  const out = { name: null, version: null };
  for (const raw of String(yml || '').split(/\r?\n/)) {
    const m = raw.match(/^\s*(name|version)\s*:\s*(.+?)\s*$/i);
    if (!m) continue;
    const v = m[2].replace(/^["']|["']$/g, '').trim();
    if (m[1].toLowerCase() === 'name' && !out.name) out.name = v;
    if (m[1].toLowerCase() === 'version' && !out.version) out.version = v;
  }
  return out;
}
// CB3: Implementation-Title / Implementation-Version from a MANIFEST.MF.
function parseManifestMf(mf) {
  const out = { name: null, version: null, mcVersionRange: null };
  const text = String(mf || '');
  const t = text.match(/^Implementation-Title\s*:\s*(.+)$/im);
  const v = text.match(/^Implementation-Version\s*:\s*(.+)$/im);
  const mc = text.match(/^Minecraft-Version\s*:\s*(.+)$/im);
  if (t) out.name = t[1].trim();
  if (v) {
    const val = v[1].trim();
    if (!/^\$\{.*\}$/.test(val)) out.version = val;
  }
  if (mc) {
    const mcv = mc[1].trim();
    if (/\b1\.\d+/.test(mcv)) out.mcVersionRange = mcv;
  }
  return out;
}

// v6.1.6: Forge 1.7.10 - 1.12.2 legacy mod descriptor (mcmod.info JSON array or object).
function parseMcModInfo(content) {
  const out = { modId: null, name: null, version: null, mcVersionRange: null, dependencies: [] };
  if (!content) return out;
  try {
    const data = typeof content === 'object' ? content : parseLenientJson(content);
    const list = Array.isArray(data) ? data : (Array.isArray(data.modList) ? data.modList : [data]);
    const first = list[0] || {};
    out.modId = first.modid || first.modId || null;
    out.name = first.name || null;
    let v = first.version || null;
    if (v && /^\$\{.*\}$/.test(v)) v = null;
    out.version = v;
    out.mcVersionRange = first.mcversion || null;
    const req = first.requiredMods || first.dependencies || [];
    if (Array.isArray(req)) {
      for (const r of req) {
        if (typeof r === 'string') {
          const id = r.replace(/@.*$/, '').trim();
          if (id && !['minecraft', 'forge'].includes(id.toLowerCase())) {
            out.dependencies.push({ modId: id, mandatory: true, versionRange: '*' });
          }
        }
      }
    }
  } catch {}
  return out;
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

function readJarJarPaths(read) {
  const out = [];
  const jj = read('META-INF/jarjar/metadata.json');
  if (jj && jj.ok) {
    try {
      const data = parseLenientJson(jj.content);
      for (const j of (data && data.jars) || []) {
        if (j && j.path) out.push(String(j.path));
      }
    } catch {}
  }
  return out;
}

function emptyLoaderProfile(loader) {
  return {
    loader, env: null, envHint: null, modId: null, name: null, version: null,
    mcVersionRange: null, provides: [], embeddedJarPaths: [], requiresFabricApi: false,
    dependencies: []
  };
}

function parseTomlProfile(content, loaderName) {
  const p = emptyLoaderProfile(loaderName);
  const mid = String(content).match(/modId\s*=\s*["']([^"']+)["']/i);
  if (mid) p.modId = mid[1];
  const info = parseTomlModInfo(content);
  if (info.modId) p.modId = info.modId;
  p.name = info.name || null;
  p.version = info.version || null;
  p.dependencies = parseTomlDependencies(content);
  const mcDep = p.dependencies.find(d => String(d.modId || '').toLowerCase() === 'minecraft');
  if (mcDep && mcDep.versionRange) p.mcVersionRange = mcDep.versionRange;
  if (loaderName === 'neoforge') {
    const dt = String(content).match(/displayTest\s*=\s*["']([^"']+)["']/i);
    if (dt && /IGNORE_(SERVER|ALL)/i.test(dt[1])) p.envHint = 'client-only';
  }
  return p;
}

function parseFabricProfile(content) {
  const p = emptyLoaderProfile('fabric');
  try {
    const j = parseLenientJson(content);
    p.modId = j.id || null;
    p.name = j.name || null;
    p.version = j.version || null;
    p.env = normalizeEnv(null, fabricEnv(j));
    if (Array.isArray(j.provides)) p.provides = j.provides.filter(x => typeof x === 'string' && x.trim()).map(x => x.trim());
    if (Array.isArray(j.jars)) p.embeddedJarPaths = j.jars.map(x => x && x.file).filter(Boolean);
    const depKeys = Object.keys(j.depends || {}).map(k => k.toLowerCase());
    if (depKeys.some(k => k === 'fabric-api' || k === 'fabric')) p.requiresFabricApi = true;
    p.dependencies = parseFabricDependencies(j);
    if (j.depends && j.depends.minecraft) {
      p.mcVersionRange = stringifyFabricConstraint(j.depends.minecraft);
    }
  } catch { /* malformed json -> keep empty deps */ }
  return p;
}

function applyFallbackFields(target, fallback) {
  if (!target.modId && fallback.modId) target.modId = fallback.modId;
  if (!target.name && fallback.name) target.name = fallback.name;
  if (!target.version && fallback.version) target.version = fallback.version;
  if (!target.mcVersionRange && fallback.mcVersionRange) target.mcVersionRange = fallback.mcVersionRange;
  target.mcSource = target.mcVersionRange ? 'metadata' : (target.mcHint ? 'filename' : null);
  return target;
}

// Pick the descriptor matching `serverLoader` (or its compatible LOADER_FAMILY) when a universal/multi-loader
// jar ships multiple descriptors (e.g. neoforge.mods.toml + fabric.mod.json).
function selectLoaderProfile(cls, serverLoader) {
  if (!cls || !serverLoader || !cls.loaderProfiles) return cls;
  const { LOADER_FAMILY } = require('./server-compat.js');
  const fam = LOADER_FAMILY[serverLoader];
  if (!fam || !fam.length) return cls;
  const order = [serverLoader, ...fam.filter(l => l !== serverLoader)];
  const chosen = order.find(l => cls.loaderProfiles[l]);
  if (!chosen || chosen === cls.loader) return cls;
  const profile = cls.loaderProfiles[chosen];
  const merged = {
    ...cls,
    ...profile,
    loaders: cls.loaders,
    loaderProfiles: cls.loaderProfiles,
    embeddedIds: cls.embeddedIds,
    embeddedJarPaths: cls.embeddedJarPaths,
    mcHint: cls.mcHint,
    loaderGuessed: false
  };
  return applyFallbackFields(merged, cls._fallback || { modId: modIdFromFilename(cls._fileName) });
}

// Classify a jar by reading ALL metadata descriptors it contains (so multi-loader/universal jars
// expose all supported loaders via `loaders` / `loaderProfiles` and can be matched to the active server).
function classifyJar(read, fileName) {
  const out = {
    ...emptyLoaderProfile(null),
    loaders: [],
    loaderProfiles: {},
    mcHint: null,
    mcSource: null,
    _fileName: fileName || null
  };

  const neo = read('META-INF/neoforge.mods.toml');
  if (neo && neo.ok) out.loaderProfiles.neoforge = parseTomlProfile(neo.content, 'neoforge');

  const forge = read('META-INF/mods.toml');
  if (forge && forge.ok) out.loaderProfiles.forge = parseTomlProfile(forge.content, 'forge');

  const fab = read('fabric.mod.json');
  if (fab && fab.ok) out.loaderProfiles.fabric = parseFabricProfile(fab.content);

  const quilt = read('quilt.mod.json');
  if (quilt && quilt.ok) {
    const pq = parseQuiltModJson(quilt.content);
    out.loaderProfiles.quilt = { ...emptyLoaderProfile('quilt'), ...pq };
  }

  // v6.1.6: Forge 1.7.10 - 1.12.2 legacy mod descriptor (mcmod.info)
  if (!out.loaderProfiles.forge && !out.loaderProfiles.neoforge) {
    const mcinfo = read('mcmod.info');
    if (mcinfo && mcinfo.ok) {
      const parsed = parseMcModInfo(mcinfo.content);
      out.loaderProfiles.forge = { ...emptyLoaderProfile('forge'), ...parsed };
    }
  }

  out.loaders = Object.keys(out.loaderProfiles);
  if (out.loaders.length) {
    Object.assign(out, out.loaderProfiles[out.loaders[0]]);
  }

  const fallback = { modId: modIdFromFilename(fileName), name: null, version: null, mcVersionRange: null };
  const yml = read('plugin.yml');
  if (yml && yml.ok) { const p = parsePluginYml(yml.content); fallback.name = p.name || null; fallback.version = p.version || null; }
  const mf = read('META-INF/MANIFEST.MF');
  if (mf && mf.ok) {
    const p = parseManifestMf(mf.content);
    fallback.name = fallback.name || p.name || null;
    fallback.version = fallback.version || p.version || null;
    if (p.mcVersionRange) fallback.mcVersionRange = p.mcVersionRange;
  }
  out._fallback = fallback;

  if (!out.loader) {
    out.loader = loaderFromFilename(fileName);
    if (out.loader) out.loaderGuessed = true;
  }

  const allEmbedded = new Set(readJarJarPaths(read));
  for (const p of Object.values(out.loaderProfiles)) {
    for (const ep of p.embeddedJarPaths || []) allEmbedded.add(ep);
  }
  out.embeddedJarPaths = [...allEmbedded];

  const { mcFromName } = require('./server-compat.js');
  const hint = mcFromName(fileName);
  if (hint) out.mcHint = hint;

  return applyFallbackFields(out, fallback);
}

module.exports = { parseLenientJson, parseTomlDependencies, parseFabricDependencies, parseQuiltModJson, classifyJar, selectLoaderProfile, fabricEnv, normalizeEnv, modIdFromFilename, loaderFromFilename, parseTomlModInfo, parsePluginYml, parseManifestMf, parseMcModInfo };
