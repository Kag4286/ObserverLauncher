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

console.log(`\n${passed} passed, 0 failed`);
