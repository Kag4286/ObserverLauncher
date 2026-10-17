// v6.0.0 G5: user templates - save captures the config, list/delete/find work, validation is shared
// with the built-in templates. Uses OBSERVER_DATA_DIR so the store writes to a temp dir.
const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(os.tmpdir(), 'ob-tpl-' + Date.now());
fs.mkdirSync(dataDir, { recursive: true });
process.env.OBSERVER_DATA_DIR = dataDir;
const T = require('../src/main/template-store.js');
const { validateTemplate } = require('../src/main/templates.js');

let passed = 0;
function ok(name, cond) { assert(cond, `FAIL: ${name}`); console.log(`PASS ${name}`); passed++; }

ok('empty store -> []', T.listUserTemplates().length === 0);

// save a template from a config
const r = T.saveTemplate({ name: 'My Survival', software: 'paper', memoryGB: 6, port: 25565, properties: { 'max-players': '5', 'view-distance': '8' } });
ok('save ok', r.ok === true);
ok('save returns a user template', r.template.user === true && r.template.id.startsWith('user-'));
ok('save keeps the config overrides', r.template.configOverrides['max-players'] === '5');
ok('saved template passes validateTemplate', validateTemplate(r.template).ok === true);
ok('list has one', T.listUserTemplates().length === 1);

// a template without a name is refused
ok('no name -> refuse', T.saveTemplate({ software: 'paper', memoryGB: 4, port: 25565 }).ok === false);

// re-saving the same name updates rather than duplicating
const r2 = T.saveTemplate({ name: 'My Survival', software: 'purpur', memoryGB: 8, port: 25565, properties: {} });
ok('re-save keeps one entry', r2.ok && T.listUserTemplates().length === 1);
ok('re-save updated software', T.listUserTemplates()[0].software === 'purpur');
ok('re-save kept the same id', r2.template.id === r.template.id);

// find by id
ok('findUserTemplate works', T.findUserTemplate(r.template.id)?.software === 'purpur');
ok('find unknown -> null', T.findUserTemplate('nope') === null);

// delete
const d = T.deleteTemplate(r.template.id);
ok('delete ok', d.ok === true && T.listUserTemplates().length === 0);
ok('delete unknown -> not ok', T.deleteTemplate('nope').ok === false);

fs.rmSync(dataDir, { recursive: true, force: true });
console.log(`\n${passed} passed, 0 failed`);
