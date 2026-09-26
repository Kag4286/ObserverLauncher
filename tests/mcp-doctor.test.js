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

// ---- Phase C: PII scrub + regex budget ----
ck('scrubPII masks IPv4', doctor.scrubPII('connect 192.168.1.10:25565') === 'connect [ip]:25565');
ck('scrubPII masks email', doctor.scrubPII('mail me at a.b@example.com') === 'mail me at [email]');
ck('scrubPII null-safe', doctor.scrubPII(null) === '');
ck('scrubPII leaves normal text', doctor.scrubPII('Done (1.2s)!') === 'Done (1.2s)!');
// P3 (v2.1.0): IPv6 coverage + IPv4 range check + timestamp safety.
ck('scrubPII masks IPv6 full form', doctor.scrubPII('2001:0db8:85a3:0000:0000:8a2e:0370:7334') === '[ip]');
ck('scrubPII masks IPv6 compressed', doctor.scrubPII('fe80::1c2b:3d4e:5f60:7a8b') === '[ip]');
ck('scrubPII leaves a log timestamp alone', doctor.scrubPII('[12:34:56] done') === '[12:34:56] done');
ck('scrubPII leaves short clock alone', doctor.scrubPII('at 10:30 ok') === 'at 10:30 ok');
ck('scrubPII leaves invalid IPv4 (999.x) alone', doctor.scrubPII('999.1.1.1') === '999.1.1.1');
ck('scrubPII still masks a real IPv4', doctor.scrubPII('host 192.168.1.10 up') === 'host [ip] up');
ck('scrubPII masks IPv4 + IPv6 together', doctor.scrubPII('a 10.0.0.1 b ::1 c') === 'a [ip] b [ip] c');
// A huge line is capped at REGEX_MAX_LINE so a regex cannot scan an unbounded string.
const huge = { text: 'X'.repeat(doctor.REGEX_MAX_LINE + 5000) + ' OutOfMemoryError', type: 'error' };
const hugeAn = doctor.analyzeConsoleLines([huge]);
ck('analyze handles a huge line (no hang, capped)', hugeAn !== undefined && typeof hugeAn.errors === 'number');
// budgetMs: a tiny budget stops the scan early (partial result, timedOut flag).
const many = Array.from({ length: 5000 }, () => ({ text: 'Caused by: x at net.Foo(Foo.java:1)', type: 'error' }));
const t0 = Date.now();
const capped = doctor.analyzeConsoleLines(many, { budgetMs: 0 });
ck('analyze budget stops early', capped.timedOut === true && (Date.now() - t0) < 2000);

// ---- classifyCrash (C1) ----
ck('OOM -> out-of-memory high', doctor.classifyCrash('java.lang.OutOfMemoryError: Java heap space').category === 'out-of-memory' && doctor.classifyCrash('java.lang.OutOfMemoryError: Java heap space').confidence === 'high');
ck('UnsupportedClassVersion -> java-version', doctor.classifyCrash('java.lang.UnsupportedClassVersionError: class file version 65.0').category === 'java-version');
ck('mixin error -> mixin-conflict', doctor.classifyCrash('org.spongepowered.asm.mixin.MixinApplyError: Mixin failed to apply').category === 'mixin-conflict');
ck('Missing deps -> mod-dependency', doctor.classifyCrash('Missing or unsupported mandatory dependencies: mod x requires y').category === 'mod-dependency');
ck('NoClassDefFoundError -> mod-dependency medium', doctor.classifyCrash('java.lang.NoClassDefFoundError: net/foo/Bar').category === 'mod-dependency' && doctor.classifyCrash('java.lang.NoClassDefFoundError: net/foo/Bar').confidence === 'medium');
ck('BindException -> port-conflict', doctor.classifyCrash('java.net.BindException: Address already in use').category === 'port-conflict');
ck('zip header -> corrupt-jar', doctor.classifyCrash('java.util.zip.ZipException: zip END header not found').category === 'corrupt-jar');
ck('generic text -> unknown low', doctor.classifyCrash('everything is fine').category === 'unknown' && doctor.classifyCrash('everything is fine').confidence === 'low');
ck('classifyCrash null-safe', doctor.classifyCrash(null).category === 'unknown');
ck('every category has hints', doctor.classifyCrash('OutOfMemoryError').hints.length > 0);
ck('priority: OOM beats generic', doctor.classifyCrash('OutOfMemoryError ... at net.Foo(Foo.java:1)').category === 'out-of-memory');

// ---- scanLogForMissingDeps (v2.3.0) ----
const neoLog = [
  '[12:00:00] [main/INFO] Loading mods',
  '[12:00:01] [main/ERROR] Missing or unsupported mandatory dependencies:',
  "\tMod ID: 'fzzy_config', Requested by: 'particle_core', Version range: '[0.1,)', Acceptable versions: *",
  "\tMod ID: 'kotlinforforge', Requested by: 'particle_core', Version range: '*'",
  '',
  '[12:00:02] [main/WARN] Skipping jar /mods/memoryleakfix-forge.jar because it is for Minecraft Forge',
].join('\n');
const scan = doctor.scanLogForMissingDeps(neoLog);
ck('scan finds fzzy_config', scan.missingDeps.some(d => d.modId === 'fzzy_config'));
ck('scan finds kotlinforforge', scan.missingDeps.some(d => d.modId === 'kotlinforforge'));
ck('scan records requestedBy', scan.missingDeps.find(d => d.modId === 'fzzy_config').requestedBy === 'particle_core');
ck('scan finds skipped forge jar', scan.skippedJars.some(s => /memoryleakfix/.test(s.jar) && /Forge/i.test(s.forLoader)));
ck('scan clean log -> empty', doctor.scanLogForMissingDeps('all good here').missingDeps.length === 0);
ck('scan null-safe', doctor.scanLogForMissingDeps(null).missingDeps.length === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
