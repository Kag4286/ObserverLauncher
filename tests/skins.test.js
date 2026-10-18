// v6.0.0 Track B: skins.js pure parsing logic.
const assert = require('assert');
const S = require('../src/main/skins.js');

let passed = 0;
function ok(name, cond) { assert(cond, `FAIL: ${name}`); console.log(`PASS ${name}`); passed++; }

// parseSkinUrl
const dummyB64 = Buffer.from(JSON.stringify({
  textures: { SKIN: { url: 'http://textures.minecraft.net/texture/123' } }
})).toString('base64');

const profile = { properties: [{ name: 'textures', value: dummyB64 }] };
ok('parses skin url', S.parseSkinUrl(profile) === 'http://textures.minecraft.net/texture/123');
ok('missing textures -> null', S.parseSkinUrl({}) === null);
ok('missing properties -> null', S.parseSkinUrl({ properties: [] }) === null);
ok('bad base64 -> null', S.parseSkinUrl({ properties: [{ name: 'textures', value: 'not-b64' }] }) === null);
ok('invalid json -> null', S.parseSkinUrl({ properties: [{ name: 'textures', value: Buffer.from('not json').toString('base64') }] }) === null);

console.log(`\n${passed} passed, 0 failed`);
