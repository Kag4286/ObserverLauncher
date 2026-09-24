// B1 (v2.1.0): secrets at rest. Pure test of src/main/secrets.js with a fake safeStorage, so no
// Electron / no OS keyring is needed. Covers the safe:/plain: contract + the nested-store walk.
const assert = require('assert');
const S = require('../src/main/secrets.js');

let passed = 0;
function ok(name, cond) { assert(cond, `FAIL: ${name}`); console.log(`PASS ${name}`); passed++; }

// A reversible fake keyring: encryptString -> reverse the string, so a round-trip is verifiable and
// wrong-password / different-machine behaviour can be simulated.
const fakeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: s => Buffer.from(String(s).split('').reverse().join('')),
  decryptString: b => Buffer.from(b).toString().split('').reverse().join(''),
};
const noStorage = { isEncryptionAvailable: () => false };

// --- wrapValue ---
ok('empty stays empty', S.wrapValue(fakeStorage, '') === '');
ok('non-string passes through', S.wrapValue(fakeStorage, null) === null);
ok('already safe: untouched', S.wrapValue(fakeStorage, 'safe:abc') === 'safe:abc');
ok('already plain: untouched', S.wrapValue(fakeStorage, 'plain:abc') === 'plain:abc');
const wrapped = S.wrapValue(fakeStorage, 'hunter2');
ok('fresh value becomes safe:', wrapped.startsWith('safe:'));
ok('safe: round-trips', S.unwrapValue(fakeStorage, wrapped) === 'hunter2');
ok('no keyring -> plain: prefix', S.wrapValue(noStorage, 'hunter2') === 'plain:hunter2');
ok('plain: unwraps', S.unwrapValue(noStorage, 'plain:hunter2') === 'hunter2');
ok('legacy (no prefix) unwraps as-is', S.unwrapValue(fakeStorage, 'legacySecret') === 'legacySecret');

// A 'safe:' value that cannot be decrypted (different machine) -> '' (never leak ciphertext).
const brokenStorage = { isEncryptionAvailable: () => true, encryptString: s => Buffer.from(s), decryptString: () => { throw new Error('wrong key'); } };
ok('undecryptable safe: -> empty', S.unwrapValue(brokenStorage, 'safe:AAAA') === '');

// --- wrapStore / unwrapStore on a NESTED store (global + per-instance secrets) ---
const store = {
  version: 4, locale: 'en', curseforgeApiKey: 'cf-key',
  instances: [
    { id: 'default', name: 'A', rconPassword: 'rconA', serverPath: '/a' },
    { id: 'b', name: 'B', rconPassword: 'rconB', serverPath: '/b' },
  ],
  activeInstanceId: 'default',
};
const enc = S.wrapStore(store, fakeStorage);
ok('global key wrapped', enc.curseforgeApiKey.startsWith('safe:'));
ok('instance[0] rcon wrapped', enc.instances[0].rconPassword.startsWith('safe:'));
ok('instance[1] rcon wrapped', enc.instances[1].rconPassword.startsWith('safe:'));
ok('non-secret untouched', enc.locale === 'en' && enc.instances[0].serverPath === '/a');
const dec = S.unwrapStore(enc, fakeStorage);
ok('global round-trips', dec.curseforgeApiKey === 'cf-key');
ok('instance[0] round-trips', dec.instances[0].rconPassword === 'rconA');
ok('instance[1] round-trips', dec.instances[1].rconPassword === 'rconB');
ok('wrapStore is idempotent', S.wrapStore(enc, fakeStorage).instances[0].rconPassword === enc.instances[0].rconPassword);

// --- needsWrap ---
ok('needsWrap true for legacy plaintext', S.needsWrap({ curseforgeApiKey: 'raw' }) === true);
ok('needsWrap false when wrapped', S.needsWrap(enc) === false);
ok('needsWrap false for empty', S.needsWrap({ curseforgeApiKey: '' }) === false);
ok('needsWrap scans instances', S.needsWrap({ instances: [{ rconPassword: 'raw' }] }) === true);

// --- a mock safeStorage whose isEncryptionAvailable throws must fall back, never throw ---
const angryStorage = { isEncryptionAvailable: () => { throw new Error('boom'); } };
ok('throwing isEncryptionAvailable -> plain:', S.wrapValue(angryStorage, 'x') === 'plain:x');

console.log(`\n${passed} passed, 0 failed`);
