// version-compare.js (v3.3.1): natural version comparison so an install cannot silently DOWNGRADE.
//
// WHY: resolveMarketDownload only filtered by MC version + loader, so installing with a pinned
// version could fetch an OLDER build than what is already on disk (the manifest records the display
// version). compareVersions() is deliberately dependency-free and pure so it is unit-testable and
// reusable by the install gate + the content-update path.
//
// Comparison is "natural": a digit run compares numerically (1.10 > 1.9, not lexicographic), a
// non-digit run compares as a string. Returns -1 (a<b), 0 (equal), 1 (a>b). Never throws.
function compareVersions(a, b) {
  const pa = String(a == null ? '' : a).match(/\d+|\D+/g) || [];
  const pb = String(b == null ? '' : b).match(/\d+|\D+/g) || [];
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const x = pa[i] || '';
    const y = pb[i] || '';
    const nx = /^\d+$/.test(x);
    const ny = /^\d+$/.test(y);
    if (nx && ny) {
      const d = Number(x) - Number(y);
      if (d) return d > 0 ? 1 : -1;
    } else {
      // A semver pre-release/build suffix ("-beta", "+build") sorts BEFORE a missing segment, so
      // 1.0.0-beta < 1.0.0. Only relevant when the other side has no segment here.
      if (x && !y && /^[-+]/.test(x)) return -1;
      if (y && !x && /^[-+]/.test(y)) return 1;
      const d = x < y ? -1 : x > y ? 1 : 0;
      if (d) return d;
    }
  }
  return 0;
}

// True only when BOTH look like comparable versions (contain a digit). Guards the install gate from
// refusing on a name like "latest" vs "dev", where ordering is meaningless.
function isComparableVersion(v) {
  return /\d/.test(String(v == null ? '' : v));
}

module.exports = { compareVersions, isComparableVersion };
