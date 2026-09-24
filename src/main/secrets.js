// B1 (v2.1.0): encrypt secrets at rest via Electron safeStorage (DPAPI / libsecret / Keychain).
//
// On disk a secret is stored as either:
//   'safe:<base64>'  - encrypted by the OS keyring (preferred)
//   'plain:<value>'  - NOT encrypted (headless Linux with no keyring, or safeStorage unavailable)
// A legacy value with neither prefix is treated as plaintext and re-wrapped on the next save.
//
// WHY prefix instead of a separate file: settings.json is rewritten whole by settings:save, so a
// parallel secrets file would race and drift. The prefix keeps one source of truth and makes the
// migration idempotent (an already-'safe:' value is never re-encrypted).
//
// These helpers take a safeStorage-LIKE object ({isEncryptionAvailable, encryptString,
// decryptString}) so they are pure and unit-testable without Electron.
const GLOBAL_SECRET_KEYS = ['curseforgeApiKey'];
const INSTANCE_SECRET_KEYS = ['rconPassword'];

function isWrapped(v) { return typeof v === 'string' && (v.startsWith('safe:') || v.startsWith('plain:')); }

// Wrap a single plaintext value. '' stays '' (a missing secret is not a secret); an already-wrapped
// value passes through unchanged.
function wrapValue(storage, plain) {
  if (typeof plain !== 'string' || plain === '') return plain;
  if (isWrapped(plain)) return plain;
  try {
    if (storage && typeof storage.isEncryptionAvailable === 'function' && storage.isEncryptionAvailable()) {
      return 'safe:' + Buffer.from(storage.encryptString(plain)).toString('base64');
    }
  } catch { /* fall through to plain */ }
  return 'plain:' + plain;
}

// Unwrap a stored value back to plaintext. A 'safe:' value that cannot be decrypted (settings were
// copied from another machine / keyring reset) returns '' rather than leaking ciphertext as a
// password. A legacy value is returned as-is.
function unwrapValue(storage, stored) {
  if (typeof stored !== 'string') return stored;
  if (stored.startsWith('safe:')) {
    try { return storage.decryptString(Buffer.from(stored.slice(5), 'base64')); }
    catch { return ''; }
  }
  if (stored.startsWith('plain:')) return stored.slice(6);
  return stored;
}

function mapSecrets(store, fn) {
  if (!store || typeof store !== 'object') return store;
  const out = { ...store };
  for (const k of GLOBAL_SECRET_KEYS) if (k in out) out[k] = fn(out[k]);
  if (Array.isArray(out.instances)) out.instances = out.instances.map(i => {
    const inst = { ...i };
    for (const k of INSTANCE_SECRET_KEYS) if (k in inst) inst[k] = fn(inst[k]);
    return inst;
  });
  return out;
}

// Encrypt every secret in a nested store (idempotent). Call right before writing settings.json.
function wrapStore(store, storage) { return mapSecrets(store, v => wrapValue(storage, v)); }
// Decrypt every secret in a nested store. Call right after reading settings.json.
function unwrapStore(store, storage) { return mapSecrets(store, v => unwrapValue(storage, v)); }

// True when any secret in the store is still legacy plaintext (no prefix) -> caller re-saves once.
function needsWrap(store) {
  if (!store || typeof store !== 'object') return false;
  for (const k of GLOBAL_SECRET_KEYS) if (typeof store[k] === 'string' && store[k] && !isWrapped(store[k])) return true;
  if (Array.isArray(store.instances)) {
    for (const i of store.instances) {
      for (const k of INSTANCE_SECRET_KEYS) if (typeof i[k] === 'string' && i[k] && !isWrapped(i[k])) return true;
    }
  }
  return false;
}

module.exports = { GLOBAL_SECRET_KEYS, INSTANCE_SECRET_KEYS, isWrapped, wrapValue, unwrapValue, wrapStore, unwrapStore, needsWrap };
