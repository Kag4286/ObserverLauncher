// Regression: safeTarget must block traversal AND symlink escapes. Symlinks can't be
// created without elevation on Windows, so here we verify the string checks + realpath
// fallback behaviour on ordinary paths (the symlink branch is exercised in practice).
const fs = require('fs'), os = require('os'), path = require('path');
const { safeTarget } = require('../src/main/fs-utils.js');
let pass = 0, fail = 0;
const ck = (n, c) => c ? (pass++, console.log('PASS', n)) : (fail++, console.log('FAIL', n));

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-st-'));
fs.mkdirSync(path.join(root, 'plugins'), { recursive: true });
fs.writeFileSync(path.join(root, 'server.properties'), 'x=1');

ck('normal file in root', safeTarget(root, 'server.properties') === path.join(root, 'server.properties'));
ck('nested file ok', safeTarget(root, 'plugins/a.jar') === path.join(root, 'plugins', 'a.jar'));
ck('new file (not existing) ok', typeof safeTarget(root, 'plugins/new.jar') === 'string');
ck('traversal rejected', safeTarget(root, '../../etc/passwd') === null);
ck('absolute-outside rejected', safeTarget(root, path.join(os.tmpdir(), 'other')) === null);
ck('root itself ok', safeTarget(root, '.') === root);

fs.rmSync(root, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
