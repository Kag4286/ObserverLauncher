// Tests for the pure helpers in src/main/tunnel.js. The live Playit service needs the real agent +
// internet, so the daemon orchestration is verified manually; these guard the validation/parsing
// that keeps a renderer string out of the command line and a non-playit URL out of openExternal.
const assert = require('assert');
const t = require('../src/main/tunnel.js');

let passed = 0;
function ok(name, cond) { assert(cond, `FAIL: ${name}`); console.log(`PASS ${name}`); passed++; }

// --- provider validation (only the enum is accepted) ---
ok('playit is a valid provider', t.isValidProvider('playit') === true);
ok('arbitrary string is not a provider', t.isValidProvider('rm -rf /') === false);
ok('empty is not a provider', t.isValidProvider('') === false);
ok('pinggy not shipped yet', t.isValidProvider('pinggy') === false);

// --- URL safety (only playit.gg https is opened externally) ---
ok('playit url is safe', t.isSafePlayitUrl('https://playit.gg/claim/abcd-1234') === true);
ok('www playit url is safe', t.isSafePlayitUrl('https://www.playit.gg/claim/x') === true);
ok('dashboard url is safe', t.isSafePlayitUrl('https://playit.gg/account/tunnels') === true);
ok('http url rejected', t.isSafePlayitUrl('http://playit.gg/claim/x') === false);
ok('non-playit host rejected', t.isSafePlayitUrl('https://evil.com/claim/x') === false);
ok('playit lookalike rejected', t.isSafePlayitUrl('https://playit.gg.evil.com/claim') === false);
ok('garbage url rejected', t.isSafePlayitUrl('not a url') === false);
ok('javascript url rejected', t.isSafePlayitUrl('javascript:alert(1)') === false);

// --- `playit status` parsing ---
ok('phase running parsed', t.parseServiceStatus('Phase: running') === 'running');
ok('phase stopped parsed', t.parseServiceStatus('playit service status:\n  Phase: stopped\n  PID: 0') === 'stopped');
ok('phase is case-insensitive', t.parseServiceStatus('phase: Running') === 'running');
ok('no phase -> null', t.parseServiceStatus('nonsense output') === null);
ok('empty -> null', t.parseServiceStatus('') === null);

// --- port resolution: falls back to 25565 when no server folder / properties ---
ok('no server path -> default port', t.resolveTargetPort({ currentServerPath: '' }) === 25565);

// --- Playit release asset selection (we ask GitHub, don't hardcode filenames) ---
const assets = [
  { name: 'playit-linux-amd64' },
  { name: 'playit-windows-x86_64.exe' },
  { name: 'playit-darwin-arm64' },
  { name: 'playit-windows-aarch64.exe' },
];
ok('picks windows amd64', t.pickPlayitAsset(assets, 'win32', 'x64').name === 'playit-windows-x86_64.exe');
ok('picks linux amd64', t.pickPlayitAsset(assets, 'linux', 'x64').name === 'playit-linux-amd64');
ok('picks darwin arm64', t.pickPlayitAsset(assets, 'darwin', 'arm64').name === 'playit-darwin-arm64');
ok('picks windows arm64', t.pickPlayitAsset(assets, 'win32', 'arm64').name === 'playit-windows-aarch64.exe');
ok('no assets -> null', t.pickPlayitAsset([], 'win32', 'x64') === null);
ok('garbage -> null', t.pickPlayitAsset(null, 'win32', 'x64') === null);

// --- ITEM 12 BUG FIX: prefer a runnable binary over the installer package ---
// GitHub lists playit-windows-x86_64-signed.msi BEFORE playit-windows-x86_64.exe; the old plain
// .find() picked the MSI and saved it as playit.exe, so the agent never ran.
const winAssets = [
  { name: 'playit-windows-x86_64-signed.msi' },
  { name: 'playit-windows-x86_64.exe' },
];
ok('windows picks .exe not .msi', t.pickPlayitAsset(winAssets, 'win32', 'x64').name === 'playit-windows-x86_64.exe');
// If only a package exists, it is still returned (better than nothing).
ok('windows falls back to .msi when only package', t.pickPlayitAsset([{ name: 'playit-windows-x86_64.msi' }], 'win32', 'x64').name === 'playit-windows-x86_64.msi');

// --- ITEM 12: SHA-256 verification sources ---
// asset.digest (from the GitHub API) wins over the pinned fallback.
const withDigest = { name: 'playit-cli-linux-amd64', digest: 'sha256:' + 'a'.repeat(64) };
ok('expectedSha256 uses asset.digest', t.expectedSha256(withDigest) === 'a'.repeat(64));
// No digest -> the pinned hash for that exact asset name.
ok('expectedSha256 falls back to pinned', t.expectedSha256({ name: 'playit-cli-linux-amd64' }) === t.PLAYIT_PINNED_SHA256['playit-cli-linux-amd64']);
// Unknown asset + no digest -> null (install proceeds unverified, logged).
ok('expectedSha256 unknown -> null', t.expectedSha256({ name: 'playit-future-thing' }) === null);
ok('expectedSha256 malformed digest -> null', t.expectedSha256({ name: 'x', digest: 'sha256:nothex' }) === null);
ok('pinned has windows exe hash', /^[0-9a-f]{64}$/.test(t.PLAYIT_PINNED_SHA256['playit-windows-x86_64.exe']));
// sha256File hashes a real temp file correctly (known vector: sha256('abc')).
const fs = require('fs'), os = require('os'), path = require('path');
const tmp = path.join(os.tmpdir(), 'ob-sha-test-' + Date.now() + '.bin');
fs.writeFileSync(tmp, 'abc');
ok('sha256File matches known vector', t.sha256File(tmp) === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
fs.rmSync(tmp, { force: true });

console.log(`\n${passed} passed, 0 failed`);
