// mc-compat.js — Minecraft version compatibility, cross-patch bridges, and range parsing (v6.1.6).
//
// WHY: naive equality/includes checks fail in real-world Minecraft modding:
// 1. Authors often keep older filename tags (e.g. mod-1.16.4.jar) while internal metadata (mods.toml)
//    declares [1.16.4, 1.16.5] or [1.16.4, 1.17). Naive AI/launcher checks report false incompatibilities.
// 2. Certain Minecraft patch updates (1.16.4 <-> 1.16.5, 1.20 <-> 1.20.1, 1.19.1 <-> 1.19.2) are 100%
//    binary, protocol, and network compatible. Forge/Fabric run them interchangeably.
// 3. Maven / Semver ranges in mods.toml ([[dependencies.minecraft]] versionRange) and fabric.mod.json
//    must be accurately evaluated against the server's Minecraft version.

const { compareVersions, isComparableVersion } = require('./version-compare.js');

// Known cross-patch binary and network compatible groups in Minecraft history.
// Mods built for one patch in a group run identically on another without breaking changes.
const MC_COMPAT_GROUPS = [
  ['1.16.4', '1.16.5'],
  ['1.20', '1.20.1'],
  ['1.19.1', '1.19.2'],
  ['1.18', '1.18.1'],
  ['1.15.1', '1.15.2'],
  ['1.21', '1.21.1'],
  ['1.21.2', '1.21.3'],
  ['26.1', '26.1.1'],
];

// Normalize trailing zero segments (e.g. 1.21.0 -> 1.21, 26.1.0 -> 26.1)
function normalizeMcVersion(v) {
  if (!v) return '';
  return String(v).trim().replace(/^(\d+\.\d+)\.0$/, '$1');
}

// Check if two Minecraft versions belong to the same cross-patch compatibility group.
function areMcMinorCompatible(v1, v2) {
  if (!v1 || !v2) return false;
  const s1 = normalizeMcVersion(v1);
  const s2 = normalizeMcVersion(v2);
  if (s1 === s2) return true;
  for (const group of MC_COMPAT_GROUPS) {
    if (group.includes(s1) && group.includes(s2)) return true;
  }
  return false;
}

// Get all versions compatible with a given Minecraft version (itself + cross-patch peers).
function getMcCompatPeers(version) {
  if (!version) return [];
  const raw = String(version).trim();
  const v = normalizeMcVersion(raw);
  const peers = new Set([raw, v]);
  for (const group of MC_COMPAT_GROUPS) {
    if (group.includes(v) || group.includes(raw)) {
      for (const item of group) {
        peers.add(item);
        peers.add(normalizeMcVersion(item));
      }
    }
  }
  return Array.from(peers);
}

// Test if targetMc satisfies a single constraint condition like ">=1.16.4", "<1.17", "=1.16.5".
function testSimpleConstraint(targetMc, op, bound) {
  if (!targetMc || !bound) return false;
  const tNorm = normalizeMcVersion(targetMc);
  const bNorm = normalizeMcVersion(bound);
  if ((op === '=' || op === '==') && tNorm === bNorm) return true;
  const cmp = compareVersions(targetMc, bound);
  if (op === '>=') return cmp >= 0 || tNorm === bNorm;
  if (op === '<=') return cmp <= 0 || tNorm === bNorm;
  if (op === '>') return cmp > 0 && tNorm !== bNorm;
  if (op === '<') return cmp < 0 && tNorm !== bNorm;
  if (op === '=' || op === '==') return cmp === 0 || tNorm === bNorm;
  return cmp === 0 || tNorm === bNorm;
}

// Test whether a single Minecraft version strictly satisfies a declared range string.
// Range formats supported:
//   - Maven / Forge: "[1.16.4, 1.16.5]", "[1.16.4, 1.17)", "[1.16.4,)", "(,1.16.5]", "[1.16.4]"
//   - NPM / Fabric: ">=1.16.4 <=1.16.5", ">=1.16.4", "~1.16.4", "^1.16.4", "*"
//   - Bare version: "1.16.4"
function testMcVersionAgainstRange(targetMc, rangeStr) {
  if (!targetMc) return false;
  if (!rangeStr || rangeStr === '*' || rangeStr === 'any' || rangeStr === 'none') return true;

  const raw = String(rangeStr).trim();
  if (!raw) return true;

  // 1. Maven / Forge interval bracket syntax: [min, max], [min, max), [min,), (,max]
  const mavenMatch = raw.match(/^([\[\(])\s*([^,\]\)]*)\s*,\s*([^,\]\)]*)\s*([\]\)])$/);
  if (mavenMatch) {
    const [, leftBracket, minVer, maxVer, rightBracket] = mavenMatch;
    let ok = true;
    if (minVer && isComparableVersion(minVer)) {
      const cmp = compareVersions(targetMc, minVer);
      ok = ok && (leftBracket === '[' ? cmp >= 0 : cmp > 0);
    }
    if (maxVer && isComparableVersion(maxVer)) {
      const cmp = compareVersions(targetMc, maxVer);
      ok = ok && (rightBracket === ']' ? cmp <= 0 : cmp < 0);
    }
    return ok;
  }

  // Exact bracket: "[1.16.4]"
  const exactBracket = raw.match(/^\[\s*([^,\]\)]+)\s*\]$/);
  if (exactBracket) {
    if (normalizeMcVersion(targetMc) === normalizeMcVersion(exactBracket[1])) return true;
    return compareVersions(targetMc, exactBracket[1]) === 0;
  }

  // 2. Semver tilde: "~1.16.4" -> >= 1.16.4 < 1.17.0
  if (raw.startsWith('~')) {
    const base = raw.slice(1).trim();
    const parts = base.split('.');
    if (parts.length >= 2) {
      const major = parts[0];
      const minor = parseInt(parts[1], 10);
      const nextMinor = `${major}.${minor + 1}`;
      return compareVersions(targetMc, base) >= 0 && compareVersions(targetMc, nextMinor) < 0;
    }
    return compareVersions(targetMc, base) >= 0;
  }

  // 3. Semver caret: "^1.16.4", "^26.1"
  if (raw.startsWith('^')) {
    const base = raw.slice(1).trim();
    const parts = base.split('.');
    if (parts[0] === '1' && parts.length >= 2) {
      const nextMinor = `1.${parseInt(parts[1], 10) + 1}`;
      return compareVersions(targetMc, base) >= 0 && compareVersions(targetMc, nextMinor) < 0;
    }
    if (Number(parts[0]) >= 26 && parts.length >= 2) {
      // 2026+ calendar versioning: drops are 26.1, 26.2, 26.3
      const nextDrop = `${parts[0]}.${parseInt(parts[1], 10) + 1}`;
      return compareVersions(targetMc, base) >= 0 && compareVersions(targetMc, nextDrop) < 0;
    }
    return compareVersions(targetMc, base) >= 0;
  }

  // 4. Comparison tokens separated by spaces, e.g. ">=1.16.4 <=1.16.5"
  const tokens = raw.split(/\s+/).filter(Boolean);
  if (tokens.length > 1 || /^[><=]/.test(tokens[0] || '')) {
    let allPassed = true;
    for (const token of tokens) {
      const m = token.match(/^(>=|<=|>|<|==|=)?\s*([0-9a-zA-Z._-]+)$/);
      if (!m) continue;
      const op = m[1] || '=';
      const bound = m[2];
      if (!testSimpleConstraint(targetMc, op, bound)) {
        allPassed = false;
        break;
      }
    }
    return allPassed;
  }

  // 5. Bare version string: "1.16.4"
  if (normalizeMcVersion(targetMc) === normalizeMcVersion(raw)) return true;
  return compareVersions(targetMc, raw) === 0;
}

// Determines if serverMc is compatible with declared modVersionsOrRange.
// Evaluates both direct range satisfaction AND cross-patch compatibility bridges.
function areMcVersionsCompatible(serverMc, modVersionsOrRange) {
  if (!serverMc || !modVersionsOrRange) return true; // unknown is never a hard rejection

  // Array of game versions, e.g. ["1.16.4", "1.16.5"] from Modrinth/CurseForge
  if (Array.isArray(modVersionsOrRange)) {
    if (!modVersionsOrRange.length) return true;
    if (modVersionsOrRange.includes(serverMc)) return true;
    // Check if any declared version is cross-patch compatible with serverMc
    const peers = getMcCompatPeers(serverMc);
    for (const v of modVersionsOrRange) {
      if (peers.includes(String(v).trim())) return true;
    }
    return false;
  }

  const range = String(modVersionsOrRange).trim();
  if (!range) return true;

  // Direct range test
  if (testMcVersionAgainstRange(serverMc, range)) return true;

  // Cross-patch bridge: if any peer version (e.g. 1.16.4 for 1.16.5) satisfies the range,
  // then the mod runs on this server via Forge/Fabric cross-patch compatibility.
  const peers = getMcCompatPeers(serverMc);
  for (const peer of peers) {
    if (peer !== serverMc && testMcVersionAgainstRange(peer, range)) {
      return true;
    }
  }

  return false;
}

// Detailed analysis of mod compatibility with the server Minecraft version.
// Returns an object containing boolean compatibility, classification status, and human/AI note.
function checkMcCompat(serverMc, declaredRangeOrVersions, options = {}) {
  const opts = options || {};
  const server = serverMc ? String(serverMc).trim() : null;
  const declared = declaredRangeOrVersions;

  const res = (compatible, status, declaredRange, note) => ({
    compatible,
    status,
    serverMc: server,
    declaredRange,
    note
  });

  if (!server) {
    return res(true, 'unknown', declared ? String(declared) : null, 'Server Minecraft version is undetermined; compatibility check deferred.');
  }

  if (!declared) {
    return res(true, 'unknown', null, 'No Minecraft version declared in mod metadata.');
  }

  // Array of versions
  if (Array.isArray(declared)) {
    const list = declared.map(x => String(x).trim());
    if (list.includes(server)) {
      return res(true, 'exact', list.join(', '), `Server ${server} is explicitly supported by mod.`);
    }
    const peers = getMcCompatPeers(server).filter(p => p !== server);
    const matchedPeer = peers.find(p => list.includes(p));
    if (matchedPeer) {
      return res(true, 'cross-patch', list.join(', '), `Mod declares support for ${matchedPeer}, which is binary/network compatible with server ${server}.`);
    }
    return res(false, 'incompatible', list.join(', '), `Mod targets [${list.join(', ')}], which does not match server ${server}.`);
  }

  const rangeStr = String(declared).trim();

  // Test direct range satisfaction
  if (testMcVersionAgainstRange(server, rangeStr)) {
    const isExact = compareVersions(server, rangeStr) === 0;
    return res(true, isExact ? 'exact' : 'range', rangeStr, isExact ? `Mod is built exactly for Minecraft ${server}.` : `Server ${server} satisfies declared range ${rangeStr}.`);
  }

  // Test cross-patch compatibility
  const peers = getMcCompatPeers(server).filter(p => p !== server);
  for (const peer of peers) {
    if (testMcVersionAgainstRange(peer, rangeStr)) {
      return res(true, 'cross-patch', rangeStr, `Mod declares range ${rangeStr} (covers ${peer}); Minecraft ${peer} is binary/network compatible with server ${server}.`);
    }
  }

  return res(false, 'incompatible', rangeStr, `Mod requires Minecraft range ${rangeStr}, incompatible with server ${server}.`);
}

module.exports = {
  MC_COMPAT_GROUPS,
  areMcMinorCompatible,
  getMcCompatPeers,
  testMcVersionAgainstRange,
  areMcVersionsCompatible,
  checkMcCompat,
};
