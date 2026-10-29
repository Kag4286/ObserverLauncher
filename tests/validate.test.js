// Validators for IPC security fixes (port / player / backup / archive).
const assert = require('assert');
const {
  isValidPort,
  isSafePlayerName,
  isSafeReason,
  isSafeConsoleCommand,
  isSafeBackupName,
  isSafeArchiveEntry,
  isSafeWorldName,
  isSafeUuid,
  hostFromHeader,
  isSafeDownloadUrl,
} = require('../src/main/validate.js');

let passed = 0;
function ok(name, cond) {
  assert(cond, `FAIL: ${name}`);
  console.log(`PASS ${name}`);
  passed++;
}

// Ports — firewall injection guard
ok('port 25565 valid', isValidPort(25565) === 25565);
ok('port string "80" valid', isValidPort('80') === 80);
ok('port 0 rejected', isValidPort(0) === null);
ok('port 70000 rejected', isValidPort(70000) === null);
ok('port injection rejected', isValidPort('80; Remove-Item C:\\') === null);
ok('port float rejected', isValidPort(80.5) === null);
ok('port empty rejected', isValidPort('') === null);

// Player names — stdin command injection guard
ok('Notch valid', isSafePlayerName('Notch') === true);
ok('xX_Steve_99 valid', isSafePlayerName('xX_Steve_99') === true);
ok('newline injection rejected', isSafePlayerName('Notch\nstop') === false);
ok('semicolon rejected', isSafePlayerName('a; say hi') === false);
ok('space rejected', isSafePlayerName('a b') === false);
ok('too short rejected', isSafePlayerName('ab') === false);
ok('too long rejected', isSafePlayerName('a'.repeat(17)) === false);
ok('non-string rejected', isSafePlayerName(null) === false);

// Reasons — ban reason appended to `ban <name> <reason>`
ok('empty reason ok', isSafeReason('') === true);
ok('normal reason ok', isSafeReason('Griefing spawn') === true);
ok('reason newline rejected', isSafeReason('bad\nstop') === false);
ok('reason too long rejected', isSafeReason('x'.repeat(201)) === false);

// Console commands — single-line only
ok('normal command ok', isSafeConsoleCommand('kick Notch') === true);
ok('multiline rejected', isSafeConsoleCommand('kick Notch\nstop') === false);
ok('CRLF rejected', isSafeConsoleCommand('say hi\r\nstop') === false);
ok('blank rejected', isSafeConsoleCommand('   ') === false);

// Backup names — must stay inside observerlauncher-backups
ok('world backup ok', isSafeBackupName('world-backup-2026-01-01.zip') === true);
ok('traversal rejected', isSafeBackupName('../world/x.zip') === false);
ok('subdir rejected', isSafeBackupName('a/b.zip') === false);
ok('backslash rejected', isSafeBackupName('a\\b.zip') === false);
ok('non-zip rejected', isSafeBackupName('server.properties') === false);
ok('dot rejected', isSafeBackupName('..') === false);

// Archive entries — zip-slip guard
ok('world/level.dat ok', isSafeArchiveEntry('world/level.dat') === true);
ok('absolute unix rejected', isSafeArchiveEntry('/etc/passwd') === false);
ok('absolute win rejected', isSafeArchiveEntry('C:/Windows/evil') === false);
ok('dotdot rejected', isSafeArchiveEntry('../evil.sh') === false);
ok('nested dotdot rejected', isSafeArchiveEntry('world/../../evil') === false);

// World names — flag injection guard for zip/tar
ok('world ok', isSafeWorldName('world') === true);
ok('world_nether ok', isSafeWorldName('world_nether') === true);
ok('dash-flag rejected', isSafeWorldName('-rf') === false);
ok('slash rejected', isSafeWorldName('a/b') === false);
ok('dotdot rejected', isSafeWorldName('..') === false);

// Player UUIDs — path-traversal guard for <world>/playerdata/<uuid>.dat
ok('uuid dashed ok', isSafeUuid('069a79f4-44e9-4726-a5be-fca90e38aaf5') === true);
ok('uuid no-dash ok', isSafeUuid('069a79f444e94726a5befca90e38aaf5') === true);
ok('uuid uppercase ok', isSafeUuid('069A79F4-44E9-4726-A5BE-FCA90E38AAF5') === true);
ok('uuid with slash rejected', isSafeUuid('../../etc/passwd') === false);
ok('uuid short rejected', isSafeUuid('abc') === false);
ok('uuid empty rejected', isSafeUuid('') === false);
ok('uuid null rejected', isSafeUuid(null) === false);
ok('uuid non-hex rejected', isSafeUuid('zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz') === false);

// hostFromHeader: the Host-header host parser (MCP + remote guards).
ok('host: plain ipv4', hostFromHeader('127.0.0.1') === '127.0.0.1');
ok('host: ipv4 with port', hostFromHeader('127.0.0.1:8080') === '127.0.0.1');
ok('host: localhost', hostFromHeader('localhost:8000') === 'localhost');
ok('host: ipv6 literal with port', hostFromHeader('[::1]:8080') === '::1');
ok('host: ipv6 literal no port', hostFromHeader('[::1]') === '::1');
ok('host: hostname', hostFromHeader('evil.example.com') === 'evil.example.com');
ok('host: empty', hostFromHeader('') === '');
ok('host: null -> empty', hostFromHeader(null) === '');

// isSafeDownloadUrl: SSRF guards (IPv4 & IPv6 loopback, private, link-local, multicast)
ok('download: public https ok', isSafeDownloadUrl('https://cdn.modrinth.com/data/xyz') === true);
ok('download: forgecdn ok', isSafeDownloadUrl('https://mediafilez.forgecdn.net/files/123/mod.jar') === true);
ok('download: github releases ok', isSafeDownloadUrl('https://github.com/user/repo/releases/download/v1/mod.jar') === true);
ok('download: public ipv4 ok', isSafeDownloadUrl('http://8.8.8.8/file.jar') === true);
ok('download: localhost rejected', isSafeDownloadUrl('http://localhost/x') === false);
ok('download: .localhost rejected', isSafeDownloadUrl('http://api.localhost/x') === false);
ok('download: .local rejected', isSafeDownloadUrl('http://router.local/x') === false);
ok('download: 127.0.0.1 rejected', isSafeDownloadUrl('http://127.0.0.1/x') === false);
ok('download: 10.x rejected', isSafeDownloadUrl('http://10.0.0.1/x') === false);
ok('download: 192.168.x rejected', isSafeDownloadUrl('http://192.168.1.1/x') === false);
ok('download: 172.16.x rejected', isSafeDownloadUrl('http://172.16.0.1/x') === false);
ok('download: link-local 169.254.x rejected', isSafeDownloadUrl('http://169.254.169.254/latest') === false);
ok('download: 0.0.0.0 rejected', isSafeDownloadUrl('http://0.0.0.0/') === false);
ok('download: ipv4 multicast rejected', isSafeDownloadUrl('http://224.0.0.1/') === false);
ok('download: ipv4 reserved rejected', isSafeDownloadUrl('http://240.0.0.1/') === false);
ok('download: ipv6 loopback [::1] rejected', isSafeDownloadUrl('http://[::1]/') === false);
ok('download: ipv6 unspecified [::] rejected', isSafeDownloadUrl('http://[::]/') === false);
ok('download: ipv6 expanded loopback rejected', isSafeDownloadUrl('http://[0:0:0:0:0:0:0:1]/') === false);
ok('download: ipv6 link-local [fe80::1] rejected', isSafeDownloadUrl('http://[fe80::1]/') === false);
ok('download: ipv6 unique-local [fc00::1] rejected', isSafeDownloadUrl('http://[fc00::1]/') === false);
ok('download: ipv6 unique-local [fd12::1] rejected', isSafeDownloadUrl('http://[fd12:3456:789a::1]/') === false);
ok('download: ipv6 multicast [ff02::1] rejected', isSafeDownloadUrl('http://[ff02::1]/') === false);
ok('download: ipv4-mapped loopback rejected', isSafeDownloadUrl('http://[::ffff:127.0.0.1]/') === false);
ok('download: ipv4-mapped private rejected', isSafeDownloadUrl('http://[::ffff:192.168.1.1]/') === false);
ok('download: file:// rejected', isSafeDownloadUrl('file:///etc/passwd') === false);
ok('download: invalid url rejected', isSafeDownloadUrl('not a url') === false);

console.log(`\n${passed} passed, 0 failed`);
