// Tests for level.dat backup bounding / quota (v6.0.2).
// Verifies that repeatedly saving game rules or datapack order does not accumulate
// unbounded .bak files in the world directory.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { backupLevelDat } = require('../src/main/gamerules.js');

let pass = 0;
function ok(name, cond) { assert(cond, `FAIL: ${name}`); console.log(`PASS ${name}`); pass++; }

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-lvl-bak-'));
const levelDat = path.join(tmpDir, 'level.dat');
fs.writeFileSync(levelDat, 'dummy content');

// Create 8 backups with distinct timestamps
for (let i = 0; i < 8; i++) {
  // simulate slight delay or different timestamp if needed
  const res = backupLevelDat(levelDat, 5);
  ok(`backup ${i + 1} succeeded`, res.ok && typeof res.backup === 'string');
}

const remaining = fs.readdirSync(tmpDir).filter(f => /^level\.dat\.bak-\d+$/.test(f));
ok('capped at exactly 5 backups', remaining.length === 5);

// Clean up
fs.rmSync(tmpDir, { recursive: true, force: true });

console.log(`\n${pass} passed, 0 failed`);
