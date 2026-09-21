// mcp-doctor.test.js — pure helpers of the MCP Server Doctor (src/mcp/doctor.js).
const doctor = require('../src/mcp/doctor.js');
let pass = 0, fail = 0;
const ck = (n, c) => c ? (pass++, console.log('PASS', n)) : (fail++, console.log('FAIL', n));

// ---- signatureOf: volatile numbers collapse ----
ck('signature strips numbers', doctor.signatureOf('at net.Foo.bar(Foo.java:123)') === doctor.signatureOf('at net.Foo.bar(Foo.java:456)'));
ck('signature strips timestamps', doctor.signatureOf('[12:00:01] x') === doctor.signatureOf('[23:59:59] x'));
ck('signature strips hex', doctor.signatureOf('addr 0xDEADBEEF') === doctor.signatureOf('addr 0x1234'));
ck('signature differs on real text', doctor.signatureOf('Out of memory') !== doctor.signatureOf('Port busy'));

// ---- analyzeConsoleLines: grouping + severity ----
const lines = [
  { text: 'java.lang.OutOfMemoryError: Java heap space', type: 'error' },
  { text: 'java.lang.OutOfMemoryError: Java heap space', type: 'error' },
  { text: 'Caused by: java.lang.NullPointerException at net.Foo.bar(Foo.java:12)', type: 'error' },
  { text: '[WARN] something mild', type: 'warn' },
  { text: 'Done (1.234s)! For help, type "help"', type: 'server' },
];
const an = doctor.analyzeConsoleLines(lines);
ck('analyze counts errors', an.errors >= 3);
ck('analyze counts warns', an.warns >= 1);
ck('analyze groups duplicate OOM into one', an.issues.filter(i => i.id === 'oom').length === 1);
ck('analyze OOM group has count 2', (an.issues.find(i => i.id === 'oom') || {}).count === 2);
ck('analyze ranks error before warn', an.issues[0].level === 'error');
ck('analyze empty -> no issues', doctor.analyzeConsoleLines([]).issues.length === 0);
ck('analyze null-safe', doctor.analyzeConsoleLines(null).issues.length === 0);
ck('analyze OOM has fix advice', typeof (an.issues.find(i => i.id === 'oom') || {}).fix === 'string');

// ---- summarizeCrashText ----
const crash = [
  '---- Minecraft Crash Report ----',
  'Description: Ticking entity',
  'Minecraft Version: 1.21.4',
  'java.lang.RuntimeException: boom',
  '\tat net.minecraft.Foo.tick(Foo.java:1)',
  'Caused by: java.lang.NullPointerException',
  '\tat net.Foo.bar(Bar.java:2)',
].join('\n');
const cr = doctor.summarizeCrashText(crash);
ck('crash description parsed', cr.description === 'Ticking entity');
ck('crash version parsed', cr.version === '1.21.4');
ck('crash cause chain captured', cr.cause.length >= 2);
ck('crash cause has Caused by', cr.cause.some(c => /Caused by/.test(c)));
ck('crash summarize null-safe', doctor.summarizeCrashText('').size >= 0);

// ---- validateProperties ----
const vp = doctor.validateProperties({ 'server-port': '25565', 'level-name': 'world', 'view-distance': '10', 'max-players': '20', 'simulation-distance': '10' }, ['world']);
ck('validate: all ok when sane', vp.every(c => c.level === 'ok'));
const vpBad = doctor.validateProperties({ 'server-port': '99999', 'level-name': 'gone', 'view-distance': '99' }, ['world']);
ck('validate flags bad port', vpBad.find(c => c.id === 'port' && c.level === 'warn'));
ck('validate flags missing world', vpBad.find(c => c.id === 'level-name' && c.level === 'warn'));
ck('validate flags huge view-distance', vpBad.find(c => c.id === 'view-distance' && c.level === 'warn'));
ck('validate tolerates missing props', doctor.validateProperties({}, []).length > 0);

// ---- diagnoseFromData ----
const healthy = doctor.diagnoseFromData({ serverPath: '/s', hasJar: true, jar: 'paper.jar', java: { ok: true, version: '21', arch: '64-bit' }, javaRequired: 21, javaMajor: 21, eulaAccepted: true, port: 25565, portFree: true, worlds: ['world'], backups: [{ name: 'a.zip' }] });
ck('diagnose healthy -> healthy true', healthy.healthy === true);
ck('diagnose healthy -> no error checks', !healthy.checks.some(c => c.level === 'error'));
const broken = doctor.diagnoseFromData({ serverPath: '/s', hasJar: true, jar: 'paper.jar', java: { ok: false }, port: 25565, portFree: false });
ck('diagnose no-java -> error', broken.checks.some(c => c.id === 'java' && c.level === 'error'));
ck('diagnose port-busy -> error', broken.checks.some(c => c.id === 'port' && c.level === 'error'));
ck('diagnose broken -> healthy false', broken.healthy === false);
const noFolder = doctor.diagnoseFromData({});
ck('diagnose no folder -> error', noFolder.checks.some(c => c.id === 'server-folder' && c.level === 'error'));
const lowJava = doctor.diagnoseFromData({ serverPath: '/s', hasJar: true, jar: 'paper.jar', java: { ok: true, version: '17', arch: '64-bit' }, javaRequired: 21, javaMajor: 17 });
ck('diagnose Java too old -> error', lowJava.checks.some(c => c.id === 'java-version' && c.level === 'error'));
const bit32 = doctor.diagnoseFromData({ serverPath: '/s', hasJar: true, jar: 'paper.jar', java: { ok: true, version: '21', arch: '32-bit' }, memoryMax: 6 });
ck('diagnose 32-bit + high RAM -> warn', bit32.checks.some(c => c.id === 'java-arch' && c.level === 'warn'));
const crashWarn = doctor.diagnoseFromData({ serverPath: '/s', hasJar: true, jar: 'paper.jar', java: { ok: true, version: '21', arch: '64-bit' }, lastCrash: 'crash-2024.txt' });
ck('diagnose recent crash -> warn', crashWarn.checks.some(c => c.id === 'crash' && c.level === 'warn'));

// ---- tailLogFile / listCrashReports / resolveCrashReport (need a real temp tree) ----
const fs2 = require('fs'), os2 = require('os'), path2 = require('path');
const root2 = fs2.mkdtempSync(path2.join(os2.tmpdir(), 'ob-doc-'));
fs2.mkdirSync(path2.join(root2, 'logs'), { recursive: true });
fs2.mkdirSync(path2.join(root2, 'crash-reports'), { recursive: true });
fs2.writeFileSync(path2.join(root2, 'logs', 'latest.log'), Array.from({ length: 500 }, (_, i) => 'line ' + i).join('\n'));
const tail = doctor.tailLogFile(root2, { lines: 10 });
ck('tailLogFile ok', tail.ok === true);
ck('tailLogFile returns 10 lines', tail.lines.length === 10);
ck('tailLogFile last line is newest', tail.lines[9] === 'line 499');
ck('tailLogFile missing file -> error', doctor.tailLogFile(root2, { file: 'nope.log' }).ok === false);
ck('tailLogFile rejects path traversal', doctor.tailLogFile(root2, { file: '../../secret' }).ok === false);
// crash reports
fs2.writeFileSync(path2.join(root2, 'crash-reports', 'crash-2024-01-01_10.00.00-server.txt'), 'Description: old crash');
fs2.writeFileSync(path2.join(root2, 'crash-reports', 'crash-2024-02-01_10.00.00-server.txt'), 'Description: new crash');
const crashList = doctor.listCrashReports(root2);
ck('listCrashReports finds 2', crashList.length === 2);
ck('listCrashReports has size', crashList.every(r => typeof r.size === 'number' && r.size > 0));
ck('resolveCrashReport finds by name', !!doctor.resolveCrashReport(root2, 'crash-2024-01-01_10.00.00-server.txt'));
ck('resolveCrashReport rejects traversal', doctor.resolveCrashReport(root2, '../../x.txt') === null);
ck('resolveCrashReport rejects non-crash name', doctor.resolveCrashReport(root2, 'notacrash.txt') === null);
fs2.rmSync(root2, { recursive: true, force: true });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
