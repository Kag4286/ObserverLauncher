// tests/skinsrestorer.test.js — SkinsRestorer FILE-backend reader.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { srDirOf, skinUuidFor, readSkinFile } = require('../src/main/skinsrestorer.js');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('PASS', name); }
  catch (e) { fail++; console.log('FAIL', name, '-', e.message); }
}

// Build a fake server root with the exact on-disk shape the spike observed.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-'));
const sr = path.join(root, 'plugins', 'SkinsRestorer');
fs.mkdirSync(path.join(sr, 'players'), { recursive: true });
fs.mkdirSync(path.join(sr, 'skins'), { recursive: true });

const PLAYER = 'b0cf4491-6290-39ec-b08a-cbb3cfde652c';
const SKIN = '230a9e15-5a8c-413d-9a71-3596a941211d';

// A textures property: base64 of { textures: { SKIN: { url, metadata } } }.
function texturesValue(url, model) {
  const inner = { textures: { SKIN: { url } } };
  if (model) inner.textures.SKIN.metadata = { model };
  return Buffer.from(JSON.stringify(inner), 'utf8').toString('base64');
}

// Player file: only carries the assigned skin identifier (no value).
fs.writeFileSync(path.join(sr, 'players', `${PLAYER}.player`), JSON.stringify({
  uniqueId: PLAYER,
  skinIdentifier: { identifier: SKIN, type: 'PLAYER' },
  offlineModeWarningDismissed: false,
  history: [],
  dataVersion: 2,
}));

// Skin file: carries the base64 value.
fs.writeFileSync(path.join(sr, 'skins', `${SKIN}.playerskin`), JSON.stringify({
  uniqueId: SKIN,
  lastKnownName: 'TheBoxKag',
  value: texturesValue('http://textures.minecraft.net/texture/abc123', null),
  signature: 'sig',
  timestamp: 1,
  dataVersion: 1,
}));

// A slim skin for the model test.
const SLIM = '11111111-2222-3333-4444-555555555555';
fs.writeFileSync(path.join(sr, 'skins', `${SLIM}.playerskin`), JSON.stringify({
  uniqueId: SLIM,
  value: texturesValue('http://textures.minecraft.net/texture/slim', 'slim'),
  dataVersion: 1,
}));

// A malformed skin file.
fs.writeFileSync(path.join(sr, 'skins', 'bad.playerskin'), '{not json');

// A player with no skin assignment.
fs.writeFileSync(path.join(sr, 'players', 'nobody.player'), JSON.stringify({ uniqueId: 'nobody' }));

try {
  t('srDirOf finds the plugin folder', () => {
    assert.ok(srDirOf(root));
  });

  t('srDirOf returns null when the plugin is absent', () => {
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'nosr-'));
    try { assert.strictEqual(srDirOf(other), null); } finally { fs.rmSync(other, { recursive: true, force: true }); }
  });

  t('skinUuidFor reads the identifier (dashed uuid)', () => {
    assert.strictEqual(skinUuidFor(srDirOf(root), PLAYER), SKIN);
  });

  t('skinUuidFor accepts an undashed uuid', () => {
    assert.strictEqual(skinUuidFor(srDirOf(root), PLAYER.replace(/-/g, '')), SKIN);
  });

  t('skinUuidFor returns null for an unknown player', () => {
    assert.strictEqual(skinUuidFor(srDirOf(root), '00000000-0000-0000-0000-000000000000'), null);
  });

  t('skinUuidFor returns null when the player has no identifier', () => {
    assert.strictEqual(skinUuidFor(srDirOf(root), 'nobody'), null);
  });

  t('readSkinFile decodes the url and defaults to classic', () => {
    const info = readSkinFile(srDirOf(root), SKIN);
    assert.ok(info);
    assert.strictEqual(info.url, 'http://textures.minecraft.net/texture/abc123');
    assert.strictEqual(info.model, 'classic');
  });

  t('readSkinFile reports slim', () => {
    assert.strictEqual(readSkinFile(srDirOf(root), SLIM).model, 'slim');
  });

  t('readSkinFile returns null for a malformed file', () => {
    assert.strictEqual(readSkinFile(srDirOf(root), 'bad'), null);
  });

  t('readSkinFile returns null for a missing file', () => {
    assert.strictEqual(readSkinFile(srDirOf(root), 'missing'), null);
  });

  t('readSkinFile is safe on null input', () => {
    assert.strictEqual(readSkinFile(null, null), null);
  });
} finally { fs.rmSync(root, { recursive: true, force: true }); }

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
