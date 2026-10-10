// Settings migrations — versioned, forward-only.
// Each migration is a function (settings) => newSettings.
// Version is stored as settings.version (integer). Latest version is MIGRATIONS.length + 1.
const path = require('path');

// Per-instance keys (v4+). SINGLE SOURCE OF TRUTH: the v3->v4 migration moves these
// out of the top level into instances[], and settings.js uses the same list to
// flatten the active instance for existing callers and to re-nest on save. Keep in
// sync with the deep dive in docs/v2.0.0-plan.md.
const PER_INSTANCE_KEYS = [
  'serverPath', 'javaPath', 'memoryMin', 'memoryMax', 'jvmArgs',
  'autoEula', 'autoRestart', 'autoRestartMaxAttempts', 'autoRestartDelaySeconds',
  'autoBackupMinutes', 'backupRetention',
  'scheduleEnabled', 'scheduleStartTime', 'scheduleStopTime', 'scheduleDays',
  'autoTunnel', 'tunnelAddress',
  // v2.0.0 M6: per-instance RCON (rconPort 0 = not assigned yet; rconPassword '' = none).
  'rconPort', 'rconPassword',
  // 4.5.0: per-instance appearance — accent palette key ('' = brand default) + avatar art seed.
  'accent', 'artSeed',
];

const migrations = [
  // v1 -> v2: add version field and ensure new defaults for 0.10
  (s) => ({ version: 2, ...s, version: 2 }),
  // v2 -> v3 (1.1.0): auto-backup retention — how many auto snapshots to keep on disk.
  // Manual backups are never pruned; only world-backup-auto-*.zip files are.
  (s) => ({ ...s, version: 3, backupRetention: s.backupRetention ?? 10 }),
  // v3 -> v4 (2.0.0): single-server -> multi-instance. Global keys stay at the top
  // level; per-instance keys move into instances[0] (the migrated instance keeps the
  // fixed id 'default', recognisable in a backup/rollback). DEFENSIVE: must never
  // throw — loadSettings() falls back to defaults on throw, which would silently
  // wipe the user's config. Idempotent: a store that already has instances[] passes
  // through unchanged.
  (s) => {
    if (Array.isArray(s.instances) && s.instances.length) return { ...s, version: 4 };
    const out = { ...s };
    if (!s.serverPath) {
      // Never configured a server folder -> nothing to migrate into an instance.
      // settings.js flattenActive() still supplies per-instance defaults for the flat view.
      for (const k of PER_INSTANCE_KEYS) delete out[k];
      out.instances = [];
      out.activeInstanceId = null;
      return { ...out, version: 4 };
    }
    const name = path.basename(String(s.serverPath)) || 'Server 1';
    const inst = { id: 'default', name };
    for (const k of PER_INSTANCE_KEYS) inst[k] = s[k];
    for (const k of PER_INSTANCE_KEYS) delete out[k];
    out.instances = [inst];
    out.activeInstanceId = 'default';
    return { ...out, version: 4 };
  },
  // v4 -> v5 (4.5.0): per-instance appearance — an accent palette key ('' = brand default) and a
  // numeric seed for the generated instance avatar. DEFENSIVE + idempotent: a store whose instances
  // already carry the keys passes through; existing instances get the defaults via the spread order
  // (later keys win, so a real value survives, a missing one gets '' / 0).
  (s) => {
    const out = { ...s, version: 5 };
    if (Array.isArray(out.instances)) {
      // Normalise explicitly: a v3->v4 instance already carries the keys as `undefined`
      // (PER_INSTANCE_KEYS copied them from a store that had none), so a spread default
      // would be clobbered. Coerce a missing/invalid value to the real default.
      out.instances = out.instances.map(i => ({
        ...i,
        accent: typeof i.accent === 'string' ? i.accent : '',
        artSeed: Number.isFinite(Number(i.artSeed)) ? Number(i.artSeed) : 0,
      }));
    }
    return out;
  },
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

module.exports = { migrations, migrate, latestVersion: migrations.length + 1, PER_INSTANCE_KEYS };
