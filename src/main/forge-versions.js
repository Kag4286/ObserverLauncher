// 2.2.0 (Phase 3): pure helpers for Forge/NeoForge version lists. Extracted from wizard.js so the
// MC-label mapping (the '21.1.251 -> 1.21.1' fix) is unit-testable without Electron or network.

// A prerelease tag is any version containing a hyphen (e.g. 26.3.0.16-beta).
function isPrerelease(v) { return /-/.test(String(v || '')); }

// Map a Forge/NeoForge maven version tag to its Minecraft version label.
//   NeoForge 26.3.0.16    -> 26.3   (calendar scheme, 4+ dot parts)
//   NeoForge 21.1.251     -> 1.21.1 (major.minor -> 1.MAJOR.MINOR)
//   Forge    1.21.1-52.0.1 -> 1.21.1 (old scheme)
//   unknown -> null (the picker skips entries with no mc)
function mcFor(v) {
  const s = String(v || '');
  if (/^\d+\.\d+\.\d+\.\d+/.test(s)) { const p = s.split('.'); return `${p[0]}.${p[1]}`; }
  if (/^\d{2}\.\d/.test(s)) { const p = s.split('.'); return `1.${p[0]}.${p[1]}`; }
  const m = s.match(/^(1\.\d{1,2}(?:\.\d{1,2})?)-/); return m ? m[1] : null;
}

// Annotate a raw (newest-first) version list into [{ v, stable, mc }].
function annotateVersions(list) {
  return (Array.isArray(list) ? list : []).map(v => ({ v, stable: !isPrerelease(v), mc: mcFor(v) }));
}

// Numeric MC-version comparator (26.3 > 1.21.1 > 1.21). Newest-first when used directly as an
// Array.sort comparator. Orders API lists that arrive unsorted (e.g. Leaf's versions[]).
function compareMc(a, b) {
  const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (y[i] || 0) - (x[i] || 0); if (d) return d; }
  return 0;
}
function sortMcVersionsDesc(list) { return (Array.isArray(list) ? list.slice() : []).sort(compareMc); }

module.exports = { isPrerelease, mcFor, annotateVersions, compareMc, sortMcVersionsDesc };
