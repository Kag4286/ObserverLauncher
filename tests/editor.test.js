// Editor backend tests: open/save/list with all safety rails.
const fs = require('fs'), os = require('os'), path = require('path');
const ed = require('../src/main/editor.js');
let pass = 0, fail = 0;
const ck = (n, c) => c ? (pass++, console.log('PASS', n)) : (fail++, console.log('FAIL', n));

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-ed-'));
fs.mkdirSync(path.join(root, 'config', 'essentials'), { recursive: true });
fs.mkdirSync(path.join(root, 'plugins'), { recursive: true });
fs.mkdirSync(path.join(root, 'world'), { recursive: true });
fs.writeFileSync(path.join(root, 'server.properties'), 'motd=hello\nmax-players=20\n');
fs.writeFileSync(path.join(root, 'config', 'essentials', 'config.yml'), 'spawn:\n  x: 0\n');
fs.writeFileSync(path.join(root, 'plugins', 'plugin.jar'), Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0, 1, 1]));
fs.writeFileSync(path.join(root, 'world', 'level.dat'), Buffer.from([0x10, 0, 0, 0, 0, 1, 0, 0, 2]));
fs.writeFileSync(path.join(root, 'huge.log'), 'x'.repeat(9 * 1024 * 1024));
fs.mkdirSync(path.join(root, 'libraries', 'com'), { recursive: true });
fs.writeFileSync(path.join(root, 'libraries', 'com', 'guava.yml'), 'a: 1');
fs.writeFileSync(path.join(root, 'notes.txt'), 'hello');

// open
const o1 = ed.openFile(root, 'server.properties');
ck('open text ok', o1.ok && o1.content.includes('motd=hello') && !o1.readOnly);
ck('open returns slash path', o1.rel === 'server.properties');
const o2 = ed.openFile(root, 'config/essentials/config.yml');
ck('open nested ok', o2.ok && o2.rel === 'config/essentials/config.yml');
const o3 = ed.openFile(root, 'plugins/plugin.jar');
ck('binary jar rejected', !o3.ok && o3.error === 'binary');
const o4 = ed.openFile(root, 'world/level.dat');
ck('binary dat rejected', !o4.ok && o4.error === 'binary');
const o5 = ed.openFile(root, 'huge.log');
ck('>8MB refused', !o5.ok && o5.error === 'tooBig' && o5.size > ed.MAX_VIEW);
const o6 = ed.openFile(root, '../../etc/passwd');
ck('traversal rejected', !o6.ok && o6.error === 'notFound');
const o7 = ed.openFile(root, 'nope.yml');
ck('missing -> notFound', !o7.ok && o7.error === 'notFound');

// save: normal, conflict, force, tooBig
const s1 = ed.saveFile(root, 'server.properties', 'motd=edited\n', o1.mtime, false);
ck('save ok + new mtime', s1.ok && s1.mtime > o1.mtime);
ck('atomic write applied', fs.readFileSync(path.join(root, 'server.properties'), 'utf8') === 'motd=edited\n');
const s2 = ed.saveFile(root, 'server.properties', 'motd=other\n', o1.mtime, false);
ck('stale mtime -> conflict', !s2.ok && s2.conflict && !!s2.mtime);
const s3 = ed.saveFile(root, 'server.properties', 'motd=forced\n', o1.mtime, true);
ck('force overwrite ok', s3.ok);
const s4 = ed.saveFile(root, 'server.properties', 'y'.repeat(3 * 1024 * 1024), s3.mtime, false);
ck('>2MB save rejected', !s4.ok && s4.error === 'tooBigSave');
ck('rejected save left file intact', fs.readFileSync(path.join(root, 'server.properties'), 'utf8') === 'motd=forced\n');

// list: allowlist, skip dirs, sizes
const l1 = ed.listFiles(root);
const paths = l1.files.map(f => f.path);
ck('lists properties', paths.includes('server.properties'));
ck('lists nested yml', paths.includes('config/essentials/config.yml'));
ck('lists txt', paths.includes('notes.txt'));
ck('skips libraries/', !paths.some(p => p.startsWith('libraries/')));
ck('skips huge.log (>8MB)', !paths.includes('huge.log'));
ck('skips jars/dats (allowlist)', !paths.some(p => p.endsWith('.jar') || p.endsWith('.dat')));
ck('sorted by path', JSON.stringify(paths) === JSON.stringify([...paths].sort((a, b) => a.localeCompare(b))));

fs.rmSync(root, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
