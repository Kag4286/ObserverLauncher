// v6.0.0 D2: the crash-analysis payload the teardown pushes to the renderer is built from three pure
// doctor functions. This test writes a real crash report to a temp server folder and verifies the
// pieces produce the shape the renderer expects: category + confidence + hints + description + cause.
const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');
const doctor = require('../src/mcp/doctor.js');

let passed = 0;
function ok(name, cond) { assert(cond, `FAIL: ${name}`); console.log(`PASS ${name}`); passed++; }

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-crash-'));
fs.mkdirSync(path.join(root, 'crash-reports'), { recursive: true });
const report = [
  '---- Minecraft Crash Report ----',
  'Description: Ticking entity',
  'Minecraft Version: 1.21.4',
  'java.lang.OutOfMemoryError: Java heap space',
  '\tat net.minecraft.server.MinecraftServer.tick(MinecraftServer.java:1)',
  'Caused by: java.lang.OutOfMemoryError: Java heap space',
].join('\n');
fs.writeFileSync(path.join(root, 'crash-reports', 'crash-2026-01-01_00.00.00-server.txt'), report);

// The teardown finds the newest report then classifies + summarises it.
const latest = doctor.latestCrashReport(root);
ok('latestCrashReport finds the file', !!latest && /crash-.*\.txt$/.test(latest.name));
const text = fs.readFileSync(latest.file, 'utf8');
const cls = doctor.classifyCrash(text);
const sum = doctor.summarizeCrashText(text);
ok('classify -> out-of-memory', cls.category === 'out-of-memory' && cls.confidence === 'high');
ok('hints non-empty', Array.isArray(cls.hints) && cls.hints.length > 0);
ok('summary description', sum.description === 'Ticking entity');
ok('summary version', sum.version === '1.21.4');
ok('summary cause has the exception', sum.cause.some(l => /OutOfMemoryError/.test(l)));

// No crash-reports folder -> latestCrashReport is null (the teardown simply skips the banner).
const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-crash2-'));
ok('no reports -> null', doctor.latestCrashReport(empty) === null);
fs.rmSync(empty, { recursive: true, force: true });

fs.rmSync(root, { recursive: true, force: true });
console.log(`\n${passed} passed, 0 failed`);
