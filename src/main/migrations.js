// Settings migrations — versioned, forward-only.
// Each migration is a function (settings) => newSettings.
// Version is stored as settings.version (integer). Latest version is MIGRATIONS.length.

const migrations = [
  // v1 -> v2: add version field and ensure new defaults for 0.10
  (s) => ({ version: 2, ...s, version: 2 }),
  // v2 -> v3 (1.1.0): auto-backup retention — how many auto snapshots to keep on disk.
  // Manual backups are never pruned; only world-backup-auto-*.zip files are.
  (s) => ({ ...s, version: 3, backupRetention: s.backupRetention ?? 10 }),
];

function migrate(settings) {
  let current = Number(settings.version) || 1;
  let out = { ...settings };
  for (let i = current - 1; i < migrations.length; i++) {
    const fn = migrations[i];
    if (typeof fn === 'function') {
      out = fn(out);
      out.version = i + 2; // next version
    }
  }
  // ensure latest version is set
  out.version = migrations.length + 1;
  return out;
}

module.exports = { migrations, migrate, latestVersion: migrations.length + 1 };
