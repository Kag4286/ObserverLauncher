const fs = require('fs');
const path = require('path');
const os = require('os');
const { app } = require('electron');
const { writeFileAtomic } = require('./fs-utils.js');

const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');
// One-time safety copy written before the v3->v4 migration. loadSettings() must backup
// BEFORE migrating: a failed migration returns defaults on throw (legacy behaviour),
// so without a backup a migration bug would silently wipe the user's config.
const backupPathV3 = () => path.join(app.getPath('userData'), 'settings.v3.bak.json');

function defaultMemoryGB() {
  const totalGB = os.totalmem() / (1024 ** 3);
  const max = Math.max(2, Math.min(8, Math.floor(totalGB / 2)));
  const min = Math.max(1, Math.min(2, Math.floor(max / 2)));
  return { min, max };
}
const { migrate, latestVersion, PER_INSTANCE_KEYS } = require('./migrations.js');
const { wrapStore, unwrapStore } = require('./secrets.js');

// B1 (v2.1.0): Electron safeStorage for secrets at rest. Lazily required so tests (which mock
// 'electron' without safeStorage) get null and values stay plaintext, unchanged from before.
function getSafeStorage() {
  try { const { safeStorage } = require('electron'); return safeStorage || null; } catch { return null; }
}

// Per-instance defaults for the FLAT view. Used when there is no instance at all
// (fresh install / last instance deleted) so callers still read a usable memoryMax
// instead of undefined.
function defaultInstanceFields() {
  const { min, max } = defaultMemoryGB();
  return {
    serverPath: '', javaPath: '', memoryMin: min, memoryMax: max, jvmArgs: '',
    autoEula: true, autoRestart: false, autoRestartMaxAttempts: 3, autoRestartDelaySeconds: 5,
    autoBackupMinutes: 0, backupRetention: 10,
    scheduleEnabled: false, scheduleStartTime: '', scheduleStopTime: '', scheduleDays: [],
    autoTunnel: false, tunnelAddress: '',
    rconPort: 0, rconPassword: '',
  };
}

// Global (non-instance) defaults. This is the shape of a fresh settings store.
function defaultGlobal() {
  return {
    version: latestVersion,
    onboarded: false, locale: 'en',
    mcpEnabled: false, mcpAutoAllowWrite: false, mcpReadOnly: false,
    playitPath: '', motionLevel: 'full', curseforgeApiKey: '',
  };
}

// The flat shape every existing caller expects: GLOBAL keys + the ACTIVE instance's
// per-instance keys, all at the top level. Does NOT expose `instances`/`activeInstanceId`
// (that keeps saveSettings unambiguous: a flat object has no instances array).
function flattenActive(s) {
  const inst = (Array.isArray(s.instances) && s.instances.length)
    ? (s.instances.find(i => i.id === s.activeInstanceId) || s.instances[0])
    : null;
  const out = { ...defaultInstanceFields(), ...s, ...(inst || {}) };
  delete out.instances;
  delete out.activeInstanceId;
  return out;
}

// Inverse of flattenActive: take the flat object a caller passed, write its per-instance
// keys into the ACTIVE instance (or materialise a first one), and return the NESTED store.
function nestInstances(flat) {
  const raw = loadSettingsRaw();
  const s = { ...flattenActive(raw), ...flat }; // caller's values win
  const inst = {};
  for (const k of PER_INSTANCE_KEYS) if (k in s) inst[k] = s[k];
  let instances = Array.isArray(raw.instances) ? raw.instances.map(i => ({ ...i })) : [];
  let activeInstanceId = raw.activeInstanceId;
  if (!instances.length) {
    inst.id = 'default';
    inst.name = inst.name || (inst.serverPath ? path.basename(String(inst.serverPath)) : '') || 'Server 1';
    instances = [inst];
    activeInstanceId = 'default';
  } else {
    if (!activeInstanceId || !instances.some(i => i.id === activeInstanceId)) activeInstanceId = instances[0].id;
    instances = instances.map(i => i.id === activeInstanceId ? { ...i, ...inst } : i);
    const active = instances.find(i => i.id === activeInstanceId);
    if (active && !active.name) active.name = inst.serverPath ? path.basename(String(inst.serverPath)) : 'Server 1';
  }
  const out = { ...defaultGlobal(), ...s };
  for (const k of PER_INSTANCE_KEYS) delete out[k];
  delete out.instances;
  delete out.activeInstanceId;
  out.instances = instances;
  out.activeInstanceId = activeInstanceId;
  return { ...out, version: latestVersion };
}

// Raw read (no migration, no flatten) — internal use only.
function loadSettingsRaw() {
  try { return unwrapStore(JSON.parse(fs.readFileSync(settingsPath(), 'utf8')), getSafeStorage()); } catch { return {}; }
}

// The id of the ACTIVE instance (v4+ stores). flattenActive() strips
// activeInstanceId from the flat view, so runtime code that needs to key
// persistent state (pid/startedAt) by instance uses this accessor. Falls back to
// 'default' (single-instance / pre-v4 callers).
function getActiveInstanceId() {
  const raw = loadSettingsRaw();
  if (Array.isArray(raw.instances) && raw.instances.length) {
    return raw.activeInstanceId || raw.instances[0].id || 'default';
  }
  return 'default';
}

// The full NESTED store (global keys + instances[] + activeInstanceId), migrated
// and backed up. Context seeding (ctx.seedInstances) needs the instances array,
// which flattenActive() deliberately hides, so this is the accessor for it.
function loadSettingsStore() {
  let raw;
  try {
    raw = unwrapStore(JSON.parse(fs.readFileSync(settingsPath(), 'utf8')), getSafeStorage());
  } catch {
    // No file yet (first run) or unreadable JSON -> defaults. Nothing to lose here.
    return defaultGlobal();
  }
  const rawVersion = Number(raw.version) || 1;
  try {
    // VERSION GATE (one-way door): a store written by a NEWER app must not be
    // downgraded. Keep the raw values and warn.
    if (rawVersion > latestVersion) {
      try { console.warn(`[settings] settings.json is version ${rawVersion} (this build supports ${latestVersion}); some settings may be ignored.`); } catch {}
      return raw;
    }
    // BACKUP BEFORE MIGRATING v3 -> v4 (never overwrite an earlier backup).
    if (rawVersion === 3 && !fs.existsSync(backupPathV3())) {
      try { writeFileAtomic(backupPathV3(), JSON.stringify(raw, null, 2)); } catch {}
    }
    const migrated = migrate(raw);
    if (migrated.version !== rawVersion) {
      try { saveSettings(migrated); } catch {}
    }
    return migrated;
  } catch (error) {
    // MIGRATION FAILURE: prefer the ORIGINAL settings over defaults. Legacy code
    // returned defaults here, which would silently wipe a user's config on a bug.
    try { console.warn('[settings] migration failed; keeping the original settings:', error?.message || error); } catch {}
    return raw;
  }
}

function loadSettings() {
  return flattenActive(loadSettingsStore());
}

// M11: flatten a SPECIFIC instance (not the active one) into the flat view, so an MCP tool can
// target an instance by id. Unknown id -> the active instance. Never throws.
function loadSettingsFor(instanceId) {
  const store = loadSettingsStore();
  if (!instanceId || !Array.isArray(store.instances)) return flattenActive(store);
  const inst = store.instances.find(i => i.id === instanceId);
  if (!inst) return flattenActive(store);
  const out = { ...defaultInstanceFields(), ...store, ...inst };
  delete out.instances;
  delete out.activeInstanceId;
  return out;
}

// M11: resolve an optional instance param to a real id. Unknown -> null (caller errors).
function resolveInstanceId(instanceId) {
  const store = loadSettingsStore();
  const ids = Array.isArray(store.instances) ? store.instances.map(i => i.id) : [];
  if (!instanceId) return store.activeInstanceId || ids[0] || 'default';
  return ids.includes(instanceId) ? instanceId : null;
}

// --- v2.0.0 multi-instance CRUD (Phase B) ---
// These operate on the NESTED store directly (saveSettings accepts a nested object when it
// has instances[]). id = 4 random bytes hex, stable across rename; name is display-only.
function newInstanceId() {
  return require('crypto').randomBytes(4).toString('hex');
}

// Lightweight list for the rail + Q2 tunnel overview: id/name/serverPath + the two
// per-instance tunnel fields the overview table needs. No secrets, no big fields
// (tunnelAddress/autoTunnel are not sensitive — the address is meant to be shared).
function listInstances() {
  const store = loadSettingsStore();
  const instances = (Array.isArray(store.instances) ? store.instances : [])
    .map(i => ({ id: i.id, name: i.name || '', serverPath: i.serverPath || '', tunnelAddress: i.tunnelAddress || '', autoTunnel: !!i.autoTunnel }));
  return { instances, activeInstanceId: store.activeInstanceId || (instances[0] && instances[0].id) || null };
}

// Add an instance with fresh per-instance defaults. Refuses a folder already owned by another
// instance: two processes on one serverPath corrupt the world.
function addInstance({ name, serverPath } = {}) {
  const store = loadSettingsStore();
  const instances = Array.isArray(store.instances) ? store.instances.map(i => ({ ...i })) : [];
  const sp = String(serverPath || '');
  if (sp && instances.some(i => i.serverPath === sp)) {
    return { ok: false, error: 'That folder is already used by another instance.' };
  }
  const id = newInstanceId();
  const inst = {
    ...defaultInstanceFields(), id,
    name: String(name || '').trim() || (sp ? path.basename(sp) : '') || `Server ${instances.length + 1}`,
    serverPath: sp,
  };
  instances.push(inst);
  saveSettings({ ...store, instances, activeInstanceId: store.activeInstanceId || id });
  return { ok: true, id, instance: inst };
}

// Make an instance active. The caller re-seeds ctx (seedInstances merges runtime state).
function switchInstance(id) {
  const store = loadSettingsStore();
  const instances = Array.isArray(store.instances) ? store.instances : [];
  if (!instances.some(i => i.id === id)) return { ok: false, error: 'No such instance.' };
  saveSettings({ ...store, activeInstanceId: id });
  return { ok: true, activeInstanceId: id };
}

function renameInstance(id, name) {
  const store = loadSettingsStore();
  const instances = Array.isArray(store.instances) ? store.instances.map(i => ({ ...i })) : [];
  const inst = instances.find(i => i.id === id);
  if (!inst) return { ok: false, error: 'No such instance.' };
  inst.name = String(name || '').trim().slice(0, 60) || inst.name || 'Server';
  saveSettings({ ...store, instances });
  return { ok: true, id, name: inst.name };
}

// Remove an instance from the list ONLY — never touches the folder on disk. If it was active,
// falls back to the first remaining instance (or null -> first-run UI).
function removeInstance(id) {
  const store = loadSettingsStore();
  const before = Array.isArray(store.instances) ? store.instances : [];
  if (!before.some(i => i.id === id)) return { ok: false, error: 'No such instance.' };
  const instances = before.filter(i => i.id !== id).map(i => ({ ...i }));
  let activeInstanceId = store.activeInstanceId;
  if (activeInstanceId === id) activeInstanceId = (instances[0] && instances[0].id) || null;
  saveSettings({ ...store, instances, activeInstanceId });
  return { ok: true, instances: instances.map(i => ({ id: i.id, name: i.name || '', serverPath: i.serverPath || '', tunnelAddress: i.tunnelAddress || '', autoTunnel: !!i.autoTunnel })), activeInstanceId };
}

function saveSettings(settings) {
  // Accept either a fully nested store (has instances[]) or the flat view (normal
  // callers). flattenActive strips instances, so a flat object is unambiguous.
  const nested = Array.isArray(settings.instances)
    ? { ...settings, version: latestVersion }
    : nestInstances(settings);
  const encrypted = wrapStore({ ...nested, version: latestVersion }, getSafeStorage());
  writeFileAtomic(settingsPath(), JSON.stringify(encrypted, null, 2));
}

// M12 (MCP fix): write the flat per-instance view into a SPECIFIC instance, not the active one.
// MCP tools run inside runInInstance(target) but loadSettings/saveSettings always resolve the
// ACTIVE instance, so get_settings/set_setting with an `instance` arg used to read/write the wrong
// server. This generalises nestInstances() to a chosen id. Global (non-instance) keys still land
// at the top level. Unknown id / no instances -> falls back to the active behaviour (never throws).
function saveSettingsFor(instanceId, flat) {
  const raw = loadSettingsRaw();
  const instances = Array.isArray(raw.instances) ? raw.instances.map(i => ({ ...i })) : [];
  const target = instanceId ? instances.find(i => i.id === instanceId) : null;
  if (!target) return saveSettings(flat);
  const s = { ...flattenActive(raw), ...flat }; // caller's values win
  const inst = {};
  for (const k of PER_INSTANCE_KEYS) if (k in s) inst[k] = s[k];
  const next = instances.map(i => i.id === target.id ? { ...i, ...inst } : i);
  const out = { ...defaultGlobal(), ...s };
  for (const k of PER_INSTANCE_KEYS) delete out[k];
  delete out.instances;
  delete out.activeInstanceId;
  out.instances = next;
  out.activeInstanceId = raw.activeInstanceId || next[0].id;
  const encrypted = wrapStore({ ...out, version: latestVersion }, getSafeStorage());
  writeFileAtomic(settingsPath(), JSON.stringify(encrypted, null, 2));
}

module.exports = { settingsPath, backupPathV3, defaultMemoryGB, loadSettings, loadSettingsFor, loadSettingsStore, saveSettings, saveSettingsFor, flattenActive, nestInstances, getActiveInstanceId, resolveInstanceId, listInstances, addInstance, switchInstance, renameInstance, removeInstance };
