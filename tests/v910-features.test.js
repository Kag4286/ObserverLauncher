// tests/v910-features.test.js — Comprehensive unit & documentation parity tests for v9.1.0:
//   - Track B: B1 (scheduler adopted/RCON stop + escalation), B2 (Pumpkin native metrics),
//              B3 (backups save-off/all/on via RCON on adopted servers), B4 (Pumpkin validateStart)
//   - Track C: C3 (gui-doctor resolveMissingDep / installResolvedDep)
//   - Track D: D1 (multi-rule scheduler, countdown milestones, persistent scheduler-state),
//              D2 (gui-doctor scanServerDoctor / applyServerDoctorFixes),
//              D3 (server-upgrade preflight + transactional executeUpgrade & jar restore)
//   - Track A: README.md parity check verifying all 18 backfilled features + CLI + MCP + security.
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const Module = require('module');
const os = require('os');
const path = require('path');

const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-v910-'));
process.env.OBSERVER_DATA_DIR = path.join(tmpBase, 'data');
fs.mkdirSync(process.env.OBSERVER_DATA_DIR, { recursive: true });

let metricsResult = { memoryMB: 180, cpuTime: 2.5 };
let javaDescendantCalls = 0;
let serverDescendantCalls = 0;

const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') {
    return { app: { getPath: () => process.env.OBSERVER_DATA_DIR } };
  }
  if (request === './platform' || request.endsWith('/platform') || request.endsWith('platform/index.js')) {
    return {
      getProcessMetrics: async () => metricsResult,
      findJavaDescendant: async () => { javaDescendantCalls++; return null; },
      findServerDescendant: async () => { serverDescendantCalls++; return null; },
      getProcessInfo: async () => null,
      createBackup: async ({ destZip }) => {
        fs.mkdirSync(path.dirname(destZip), { recursive: true });
        fs.writeFileSync(destZip, 'PK-stub');
        return { ok: true };
      },
    };
  }
  return origLoad.apply(this, arguments);
};

const scheduler = require('../src/main/scheduler.js');
const { metricsTick } = require('../src/main/server-metrics.js');
const { createBackupInternal } = require('../src/main/backups.js');
const { validateStart } = require('../src/main/java.js');
const guiDoctor = require('../src/main/gui-doctor.js');
const serverUpgrade = require('../src/main/server-upgrade.js');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('PASS', name); }
  else { fail++; console.log('FAIL', name); }
}

(async () => {
  // ===== B1: scheduler.stopServerInternal uses requestStop (adopted RCON + escalation) =====
  {
    const rconCmds = [];
    const ctx = {
      serverStatus: 'running',
      serverProcess: { pid: 5555, adopted: true, stdin: null },
      rcon: { connected: true, exec: async cmd => { rconCmds.push(cmd); return 'ok'; } },
      restartTimer: null,
      shutdownTimer: null,
      manualStop: false,
      inst: () => 'inst-b1',
      runInInstance: (id, fn) => fn(),
      setServerStatus: s => { ctx.serverStatus = s; },
      appendLog: () => {},
    };
    const r = await scheduler.stopServerInternal(ctx);
    const armedTimer = !!ctx.shutdownTimer;
    clearInterval(ctx.shutdownTimer);
    ctx.shutdownTimer = null;
    check('B1: stopServerInternal succeeds on adopted server (stdin=null)', r && r.ok === true);
    check('B1: stopServerInternal sends stop via RCON', rconCmds.includes('stop'));
    check('B1: stopServerInternal arms graceful escalation timer', armedTimer);
    check('B1: stopServerInternal sets status to stopping', ctx.serverStatus === 'stopping');
  }

  // ===== B2: metricsTick treats Pumpkin as native (never hunts java descendant) =====
  {
    javaDescendantCalls = 0;
    serverDescendantCalls = 0;
    const sent = [];
    const ctx = {
      serverProcess: { pid: 8888 },
      monitoredPid: null,
      previousCpu: null,
      currentSoftware: 'pumpkin',
      live: { tps: null, mspt: null, players: [] },
      inst: () => 'inst-b2',
      send: (ch, data) => sent.push({ ch, data }),
    };
    const st = { consecutiveMisses: 0, lastMetrics: { serverMemory: 0, cpu: 0 }, javaRetryCount: 0, idleTicks: 0, sampling: false };
    await metricsTick(ctx, st);
    check('B2: Pumpkin sets monitoredPid directly on first tick', ctx.monitoredPid === 8888);
    check('B2: Pumpkin uses native path (zero findJavaDescendant calls)', javaDescendantCalls === 0 && serverDescendantCalls === 1);
    check('B2: Pumpkin reports live serverMemory', st.lastMetrics.serverMemory === 180);
  }

  // ===== B3: createBackupInternal routes save-off/all/on via RCON for adopted servers =====
  {
    const srvDir = path.join(tmpBase, 'srv-b3');
    fs.mkdirSync(path.join(srvDir, 'world'), { recursive: true });
    fs.writeFileSync(path.join(srvDir, 'world', 'level.dat'), 'stub');
    const rconCmds = [];
    const ctx = {
      currentServerPath: srvDir,
      backupInProgress: false,
      serverProcess: { pid: 7777, adopted: true, stdin: null },
      rcon: { connected: true, exec: async cmd => { rconCmds.push(cmd); return 'ok'; } },
      appendLog: () => {},
    };
    const br = await createBackupInternal(ctx, { auto: true });
    check('B3: backup succeeds on adopted server without stdin', br && br.ok === true);
    check('B3: backup flushed save-off/save-all/save-on via RCON',
      rconCmds[0] === 'save-off' && rconCmds[1] === 'save-all' && rconCmds[2] === 'save-on');
  }

  // ===== B4: validateStart accepts Pumpkin native config without requiring Java =====
  {
    const srvDir = path.join(tmpBase, 'srv-b4');
    fs.mkdirSync(srvDir, { recursive: true });
    const fakeInfo = {
      jar: null, launchScript: null, nativeBinary: null,
      hasHorizonConfig: false, hasPumpkinConfig: true, engineType: 'java',
    };
    const err = validateStart({ serverPath: srvDir }, { ok: false }, () => fakeInfo);
    check('B4: validateStart skips Java requirement for Pumpkin config folder', err === null);
  }

  // ===== D1: Multi-rule scheduler, countdown warnings & persistent lastFired =====
  {
    check('D1: countdownMilestones(300)', JSON.stringify(scheduler.countdownMilestones(300)) === JSON.stringify([300, 120, 60, 30, 10, 5]));
    check('D1: countdownMilestones(60)', JSON.stringify(scheduler.countdownMilestones(60)) === JSON.stringify([60, 30, 10, 5]));
    check('D1: countdownMilestones(45)', JSON.stringify(scheduler.countdownMilestones(45)) === JSON.stringify([45, 30, 10, 5]));
    check('D1: countdownMilestones(0) empty', scheduler.countdownMilestones(0).length === 0);
    check('D1: formatCountdownLabel 300 -> 5m, 30 -> 30s', scheduler.formatCountdownLabel(300) === '5m' && scheduler.formatCountdownLabel(30) === '30s');

    const rules = scheduler.sanitizeScheduleRules([
      { id: 'r1', action: 'backup', time: '04:00', days: ['mon', 3] },
      { id: 'r2', action: 'command', time: '12:00', command: 'say Hello' },
      { id: 'bad-nl', action: 'command', time: '12:00', command: 'say ok\nstop' },
      { id: 'bad-act', action: 'rmrf', time: '12:00' },
      { id: 'bad-time', action: 'backup', time: '99:99' },
    ]);
    check('D1: sanitizeScheduleRules keeps 2 valid rules and rejects multiline/bad rules', rules.length === 2 && rules[0].id === 'r1' && rules[1].id === 'r2');

    const at = (h, m, s = 5) => new Date(2026, 5, 3, h, m, s); // Wednesday (day 3)
    check('D1: shouldFire restart fires when running', scheduler.shouldFire('restart', { enabled: true, restartTime: '04:30', days: [3] }, at(4, 30, 10), {}, 'running'));
    check('D1: shouldFire restart skipped during backup', !scheduler.shouldFire('restart', { enabled: true, restartTime: '04:30', days: [3] }, at(4, 30, 10), {}, 'running', { backupInProgress: true }));
    check('D1: shouldFireRule command fires when running', scheduler.shouldFireRule(rules[1], at(12, 0, 10), {}, 'running'));
    check('D1: shouldFireRule command skipped when stopped', !scheduler.shouldFireRule(rules[1], at(12, 0, 10), {}, 'stopped'));
    check('D1: shouldFireRule backup fires even when stopped', scheduler.shouldFireRule(rules[0], at(4, 0, 10), {}, 'stopped'));

    // Countdown skips immediately when 0 players online and skipIfEmpty=true
    let stopCalls = 0;
    const announced = [];
    const ctxEmpty = { serverStatus: 'running', live: { players: [] }, appendLog: () => {} };
    await scheduler.runCountdownThen(ctxEmpty, {
      action: 'restart', countdownSec: 60, skipIfEmpty: true, settings: { serverPath: '' },
      sendCmd: async (_c, cmd) => announced.push(cmd),
      stopFn: async () => { stopCalls++; return { ok: true }; },
      wait: async () => {},
    });
    check('D1: runCountdownThen skips countdown when 0 players online', stopCalls === 1 && announced.length === 0);

    // Countdown announces milestones when players are online
    stopCalls = 0;
    const ctxPlayers = { serverStatus: 'running', live: { players: ['Alex'] }, appendLog: () => {} };
    await scheduler.runCountdownThen(ctxPlayers, {
      action: 'restart', countdownSec: 60, skipIfEmpty: true, settings: { serverPath: '' },
      sendCmd: async (_c, cmd) => announced.push(cmd),
      stopFn: async () => { stopCalls++; return { ok: true }; },
      wait: async () => {},
    });
    check('D1: runCountdownThen broadcasts 4 milestones (1m/30s/10s/5s) then stops',
      stopCalls === 1 && announced.length === 4 && /1m/.test(announced[0]) && /5s/.test(announced[3]));

    // Persistent scheduler state prevents double-fire after restart
    const stateFile = path.join(tmpBase, 'scheduler-state.json');
    const cmdsRun = [];
    const tickCtx1 = {
      serverStatus: 'running', backupInProgress: false, live: { players: [] },
      inst: () => 'inst-persist', appendLog: () => {},
    };
    const settingsD1 = {
      scheduleEnabled: true, scheduleStartTime: '', scheduleStopTime: '', scheduleRestartTime: '',
      scheduleDays: [], scheduleCountdownSec: 0, scheduleSkipCountdownIfEmpty: true,
      scheduleRules: [{ id: 'daily-say', enabled: true, time: '12:00', days: [], action: 'command', command: 'say Hi' }],
    };
    await scheduler.schedulerTick(tickCtx1, at(12, 0, 10), settingsD1, { stateFile, sendCmd: async (_c, cmd) => cmdsRun.push(cmd) });
    // Simulate app restart with fresh ctx (no in-memory schedulerLastFired) inside the same 90s window
    const tickCtx2 = {
      serverStatus: 'running', backupInProgress: false, live: { players: [] },
      inst: () => 'inst-persist', appendLog: () => {},
    };
    await scheduler.schedulerTick(tickCtx2, at(12, 0, 40), settingsD1, { stateFile, sendCmd: async (_c, cmd) => cmdsRun.push(cmd) });
    check('D1: persisted scheduler-state prevents double-fire across restart', cmdsRun.length === 1 && cmdsRun[0] === 'say Hi');
  }

  // ===== C3 & D2: gui-doctor resolveMissingDep, installResolvedDep, scan & apply =====
  {
    const srvDir = path.join(tmpBase, 'srv-doc');
    fs.mkdirSync(path.join(srvDir, 'mods'), { recursive: true });
    fs.writeFileSync(path.join(srvDir, 'fabric-server-launch.jar'), 'stub');
    const ctx = { currentServerPath: srvDir, serverProcess: null, serverStatus: 'stopped' };

    const resDep = await guiDoctor.resolveMissingDep(ctx, { modId: 'fabric-api' }, {
      findMarketProject: async () => ({ ok: true, item: { id: 'P7dR8mSH', title: 'Fabric API', slug: 'fabric-api', source: 'modrinth' } }),
    });
    check('C3: resolveMissingDep resolves package metadata', resDep.ok && resDep.item.id === 'P7dR8mSH' && resDep.item.title === 'Fabric API');

    const instDep = await guiDoctor.installResolvedDep(ctx, { id: 'P7dR8mSH', title: 'Fabric API', kind: 'mod' }, {
      resolveMarketDownload: async () => ({ url: 'https://cdn.modrinth.com/fabric-api.jar', filename: 'fabric-api-0.100.jar', versionId: 'v1', hashes: {} }),
      download: async (_url, dest) => { fs.writeFileSync(dest, 'jar-bytes'); },
      verifyFileHash: () => ({ ok: true }),
    });
    check('C3: installResolvedDep writes jar and updates files', instDep.ok && fs.existsSync(path.join(srvDir, 'mods', 'fabric-api-0.100.jar')));

    const scanRes = await guiDoctor.scanServerDoctor(ctx, {
      tools: {
        getTool: name => name === 'propose_fix'
          ? { handler: async () => ({ ok: true, result: { healthy: false, server: { mc: '1.21.1', loader: 'fabric' }, plan: [{ action: 'change_port', risk: 'write', reason: 'Port busy', args: { key: 'server-port', value: '25566' } }], summary: '1 fix' } }) }
          : { handler: async () => ({ ok: true, result: { checks: [{ id: 'port-busy', level: 'error', detail: 'Port 25565 busy' }] } }) },
      },
    });
    check('D2: scanServerDoctor returns structured plan & checks', scanRes.ok && scanRes.plan.length === 1 && scanRes.checks.length === 1);

    const badAction = await guiDoctor.applyServerDoctorFixes(ctx, [{ action: 'arbitrary_shell', args: {} }]);
    check('D2: applyServerDoctorFixes rejects unknown actions', badAction.ok === false);

    const runningRefuse = await guiDoctor.applyServerDoctorFixes(
      { ...ctx, serverProcess: { pid: 123 } },
      [{ action: 'restore_backup', args: {} }]
    );
    check('D2: applyServerDoctorFixes refuses destructive restore while running', runningRefuse.ok === false);
  }

  // ===== D3: server-upgrade preflight + transactional executeUpgrade =====
  {
    const srvDir = path.join(tmpBase, 'srv-upg');
    fs.mkdirSync(path.join(srvDir, 'plugins'), { recursive: true });
    fs.mkdirSync(path.join(srvDir, 'world'), { recursive: true });
    fs.writeFileSync(path.join(srvDir, 'paper-1.20.4-496.jar'), 'old-paper-jar');
    fs.writeFileSync(path.join(srvDir, 'world', 'level.dat'), 'stub');
    fs.writeFileSync(path.join(srvDir, 'plugins', 'CompatPlugin.jar'), 'old-p1');
    fs.writeFileSync(path.join(srvDir, 'plugins', 'LegacyPlugin.jar'), 'old-p2');
    fs.writeFileSync(path.join(srvDir, 'plugins', 'ManualDrop.jar'), 'manual');
    fs.writeFileSync(path.join(srvDir, 'observerlauncher-manifest.json'), JSON.stringify([
      { kind: 'plugin', fileName: 'CompatPlugin.jar', projectId: 'compat-1', source: 'modrinth', title: 'CompatPlugin' },
      { kind: 'plugin', fileName: 'LegacyPlugin.jar', projectId: 'legacy-2', source: 'modrinth', title: 'LegacyPlugin' },
    ]));

    const ctx = {
      currentServerPath: srvDir,
      serverStatus: 'stopped',
      serverProcess: null,
      javaInfo: { ok: true, version: '17.0.10' },
      appendLog: () => {},
    };

    const pf = await serverUpgrade.preflightUpgrade(ctx, { targetVersion: '1.21.4' }, {
      javaVersionFor: async () => 21,
      resolveMarket: async ({ id }) => id === 'compat-1'
        ? { versionId: 'v214', versionNumber: '2.0.0', filename: 'CompatPlugin-2.0.jar', url: 'https://cdn.modrinth.com/c.jar' }
        : null,
    });
    check('D3: preflight detects Paper software and flags Java 17 < 21', pf.ok && pf.software === 'paper' && pf.javaRequired === 21 && pf.javaOk === false);
    check('D3: preflight classifies compatible/incompatible/untracked accurately',
      pf.compatible.length === 1 && pf.incompatible.length === 1 && pf.untracked.length === 1);

    // Failure case: download throws -> old server jar MUST be restored transactionally!
    const failRun = await serverUpgrade.executeUpgrade(ctx, { targetVersion: '1.21.4', createBackup: false, updateContent: false }, {
      resolveServerBuild: async () => ({ url: 'https://api.papermc.io/paper-1.21.4.jar', name: 'paper-1.21.4-50.jar' }),
      download: async () => { throw new Error('network dropped'); },
    });
    check('D3: failed download aborts and restores archived server jar',
      failRun.ok === false && fs.existsSync(path.join(srvDir, 'paper-1.20.4-496.jar')));

    // Happy path: backup + SHA-256 verified jar + content update + auto-disable incompatible
    const newJarBytes = Buffer.from('new-paper-1.21.4-jar');
    const newJarSha = crypto.createHash('sha256').update(newJarBytes).digest('hex');
    const okRun = await serverUpgrade.executeUpgrade(ctx, {
      targetVersion: '1.21.4',
      createBackup: true,
      updateContent: true,
      disableIncompatible: true,
      incompatibleFiles: [{ kind: 'plugin', fileName: 'LegacyPlugin.jar' }],
    }, {
      createBackup: async () => ({ ok: true, name: 'world-backup-preupgrade.zip' }),
      resolveServerBuild: async () => ({ url: 'https://api.papermc.io/paper-1.21.4.jar', name: 'paper-1.21.4-50.jar', sha256: newJarSha }),
      download: async (_u, dest) => { fs.writeFileSync(dest, newJarBytes); },
      applyUpdates: async () => ({ ok: true, updated: [{ from: 'CompatPlugin.jar', to: 'CompatPlugin-2.0.jar' }], errors: [] }),
    });
    check('D3: executeUpgrade completes backup, replaces jar, updates content, disables incompatible',
      okRun.ok === true
      && okRun.backupName === 'world-backup-preupgrade.zip'
      && okRun.newJar === 'paper-1.21.4-50.jar'
      && fs.existsSync(path.join(srvDir, 'paper-1.21.4-50.jar'))
      && !fs.existsSync(path.join(srvDir, 'paper-1.20.4-496.jar'))
      && okRun.updatedContent.length === 1
      && fs.existsSync(path.join(srvDir, 'plugins', 'LegacyPlugin.jar.disabled')));
  }

  // ===== Track A: README.md parity check (all 18 mandatory backfilled features + CLI + MCP + security) =====
  {
    const readme = fs.readFileSync(path.join(__dirname, '../README.md'), 'utf8');
    const mustContain = [
      'docs/release-9.1.',
      'BuildTools',
      'survival-5',
      'modded-performance',
      'Orphan Process',
      '3-tier telemetry',
      'Start-All / Stop-All',
      '120-second stability timer',
      'Datapack ZIP Validator',
      'DataPacks.Enabled',
      'SHA-256',
      'SkinsRestorer',
      'Player Analytics',
      'clone worlds',
      'reset Nether',
      '20-snapshot history',
      'mtime conflict guard',
      'ui://observerlauncher/dashboard',
      'observer://guides/mod-stacks',
      'plan_modpack',
      'assemble_modpack',
      'mcp-audit.log',
      'observer logs',
      'observer metrics',
      'observer cmd',
      'observer templates',
      'observer modpack verify',
      'observer modpack build',
      'assertPublicHost',
      '0o600',
      'Server Doctor',
      'Upgrade Assistant',
      'countdown broadcast warnings',
    ];
    const missing = mustContain.filter(needle => !readme.includes(needle));
    check(`Track A: README.md contains all ${mustContain.length} mandatory capability markers (missing: ${missing.join(', ') || 'none'})`, missing.length === 0);
  }

  try { fs.rmSync(tmpBase, { recursive: true, force: true }); } catch {}
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => {
  try { fs.rmSync(tmpBase, { recursive: true, force: true }); } catch {}
  console.error('FAIL:', e);
  process.exit(1);
});
