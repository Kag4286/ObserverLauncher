// Security regression: download URLs inside an untrusted .mrpack must not point at file://,
// localhost, or private/link-local IPs (SSRF / local file read).
const assert = require('assert');
const { isSafeDownloadUrl } = require('../src/main/validate.js');
let passed = 0;
function ok(name, cond) { assert(cond, `FAIL: ${name}`); console.log(`PASS ${name}`); passed++; }

ok('https public ok', isSafeDownloadUrl('https://cdn.modrinth.com/data/x.jar') === true);
ok('http public ok', isSafeDownloadUrl('http://example.com/a') === true);
ok('github ok', isSafeDownloadUrl('https://github.com/a/b/releases/download/v1/x.jar') === true);

ok('file:// rejected', isSafeDownloadUrl('file:///etc/passwd') === false);
ok('localhost rejected', isSafeDownloadUrl('http://localhost:8080/x') === false);
ok('127.0.0.1 rejected', isSafeDownloadUrl('http://127.0.0.1/x') === false);
ok('0.0.0.0 rejected', isSafeDownloadUrl('http://0.0.0.0/x') === false);
ok('10.x rejected', isSafeDownloadUrl('http://10.0.0.5/x') === false);
ok('192.168.x rejected', isSafeDownloadUrl('http://192.168.1.1/x') === false);
ok('172.16.x rejected', isSafeDownloadUrl('http://172.16.0.1/x') === false);
ok('172.31.x rejected', isSafeDownloadUrl('http://172.31.5.5/x') === false);
ok('172.32.x allowed', isSafeDownloadUrl('http://172.32.0.1/x') === true);
ok('169.254 metadata rejected', isSafeDownloadUrl('http://169.254.169.254/latest/meta-data') === false);
ok('100.64 CGNAT rejected', isSafeDownloadUrl('http://100.64.0.1/x') === false);
ok('::1 rejected', isSafeDownloadUrl('http://[::1]/x') === false);
ok('.local rejected', isSafeDownloadUrl('http://printer.local/x') === false);
ok('ftp rejected', isSafeDownloadUrl('ftp://example.com/x') === false);
ok('garbage rejected', isSafeDownloadUrl('not a url') === false);
ok('empty rejected', isSafeDownloadUrl('') === false);
ok('undefined rejected', isSafeDownloadUrl(undefined) === false);

console.log(`\n${passed} passed, 0 failed`);
