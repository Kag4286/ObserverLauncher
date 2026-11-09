const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { isSamePath, sanitizeStoreInstances, addInstance, removeInstance, resolveInstanceId } = require('../src/main/settings.js');

console.log('--- Testing isSamePath ---');

// 1. Path normalization & Windows case insensitivity
assert.strictEqual(isSamePath('C:\\Games\\Minecraft', 'C:\\Games\\Minecraft'), true, 'Exact match should be true');
if (process.platform === 'win32') {
  assert.strictEqual(isSamePath('C:\\games\\minecraft', 'c:\\GAMES\\MINECRAFT'), true, 'Win32 case-insensitive match');
  assert.strictEqual(isSamePath('C:/games/minecraft/', 'c:\\games\\minecraft'), true, 'Mixed slashes and trailing slash match');
}
assert.strictEqual(isSamePath('C:\\games\\mc1', 'C:\\games\\mc2'), false, 'Different paths should be false');
assert.strictEqual(isSamePath('', 'C:\\games\\mc1'), false, 'Empty path should be false');
assert.strictEqual(isSamePath(null, undefined), false, 'Null / undefined should be false');
console.log('PASS: isSamePath tests passed');

console.log('--- Testing sanitizeStoreInstances ---');

// 2. Auto-heal legacy path and id-less instance
const legacyStore = {
  activeInstanceId: 'inst-1',
  instances: [
    {
      path: 'C:\\\\Users\\\\Test\\\\Server1',
      name: 'Server 1'
    }
  ]
};

const changed1 = sanitizeStoreInstances(legacyStore);
assert.strictEqual(changed1, true, 'sanitizeStoreInstances should report change for legacy entry');
assert.strictEqual(legacyStore.instances.length, 1);
assert.strictEqual(legacyStore.instances[0].serverPath, 'C:\\Users\\Test\\Server1', 'path should be normalized to serverPath');
assert.strictEqual(typeof legacyStore.instances[0].path, 'undefined', 'legacy path property should be removed');
assert.ok(legacyStore.instances[0].id, 'Instance should be assigned an id');
assert.strictEqual(legacyStore.activeInstanceId, legacyStore.instances[0].id, 'activeInstanceId should update to valid id');
console.log('PASS: Auto-heal legacy path & missing id passed');

// 3. Deduplication of same-path instances (exact replica of user bug scenario)
const duplicateStore = {
  activeInstanceId: 'active-2',
  instances: [
    {
      path: 'C:\\\\Users\\\\PC\\\\Downloads\\\\Servertest',
      name: 'Servertest'
    },
    {
      serverPath: 'C:\\Users\\PC\\Downloads\\Servertest',
      id: 'active-2',
      name: 'Servertest (2)',
      memoryMax: 7
    }
  ]
};

const changed2 = sanitizeStoreInstances(duplicateStore);
assert.strictEqual(changed2, true, 'sanitizeStoreInstances should heal duplicates');
assert.strictEqual(duplicateStore.instances.length, 1, 'Should dedup to 1 instance');
assert.strictEqual(duplicateStore.instances[0].name, 'Servertest', 'Should recover the clean base name');
assert.strictEqual(duplicateStore.instances[0].id, 'active-2', 'Should retain activeInstanceId');
assert.strictEqual(duplicateStore.instances[0].memoryMax, 7, 'Should preserve configured settings');
assert.strictEqual(duplicateStore.activeInstanceId, 'active-2', 'activeInstanceId should point to surviving instance');
console.log('PASS: Deduplication of same-path instances passed');

console.log('All instance heal & path tests passed!');
