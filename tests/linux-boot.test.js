// linux-boot.test.js — exercises the PURE Linux platform functions on a REAL Linux kernel.
//
// WHY (v3.0.0 Phase A1a): the launcher supports Linux but is developed on Windows, and CI only
// proves the unit + Electron paths are green there — nothing boots a real process and reads real
// /proc + a real zip. src/main/platform/linux.js exports pure helpers (findJavaDescendant,
// getProcessInfo, getProcessMetrics, createBackup, restoreBackup) that only need child_process +
// fs + validate.js, NO Electron. So a plain Node test can verify the Linux-specific risk
// (procfs walk, btime/starttime parse, VmRSS metrics, zip round-trip, kill/reap) without the app.
//
// Skips cleanly on non-Linux (dev machine is Windows) and when java is absent (local runs).
// In CI the test job installs temurin JDK + zip/unzip so every branch runs for real.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const linux = require('../src/main/platform/linux.js');

// ---- tiny assert harness (no framework; matches tests/run.js exit-code convention) ----
let failures = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log(`PASS ${name}`);
  } else {
    failures++;
    console.log(`FAIL ${name}${detail ? ' — ' + detail : ''}`);
  }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
function which(bin) {
  return spawnSync('sh', ['-c', `command -v ${bin}`], { encoding: 'utf8' }).status === 0;
}
// STRICT: in CI the job installs a JDK + zip/unzip, so a missing tool means the test would
// silently verify NOTHING while still reporting green. In strict mode a skip counts as a failure
// so a misconfigured runner can never hide the gap. Local dev stays lenient (Windows/WSL boxes
// often lack java/zip and we do not want a red suite there).
const STRICT = !!(process.env.CI || process.env.OBSERVER_STRICT_LINUX_BOOT);
function skipOrFail(name, why) {
  if (STRICT) { failures++; console.log(`FAIL ${name} — ${why} (strict mode: CI must have the tool)`); }
  else console.log(`SKIP ${name}: ${why}`);
}

if (process.platform !== 'linux') {
  console.log(`SKIP linux-boot: not Linux (platform=${process.platform})`);
  process.exit(0);
}

(async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ol-linux-boot-'));
  let child = null;
  const cleanup = () => {
    if (child && child.pid && !child.killed) { try { child.kill('SIGKILL'); } catch {} }
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
  };
  process.on('exit', cleanup);

  try {
    // ---- 1) backup round-trip (independent of java; needs zip+unzip or tar) ----
    const hasZip = which('zip');
    const hasUnzip = which('unzip');
    const hasTar = which('tar');
    if ((hasZip && hasUnzip) || hasTar) {
      const serverPath = path.join(tmpRoot, 'server');
      fs.mkdirSync(path.join(serverPath, 'world'), { recursive: true });
      fs.writeFileSync(path.join(serverPath, 'world', 'level.dat'), 'LEVELDATA');
      fs.writeFileSync(path.join(serverPath, 'server.properties'), 'level-name=world\n');
      const destZip = path.join(tmpRoot, 'backup.zip');
      const bk = await linux.createBackup({ serverPath, worlds: ['world'], destZip });
      check('createBackup ok', bk.ok, bk.error);
      check('createBackup wrote archive', fs.existsSync(destZip) && fs.statSync(destZip).size > 0);
      const destPath = path.join(tmpRoot, 'restore');
      fs.mkdirSync(destPath, { recursive: true });
      const rs = await linux.restoreBackup({ destPath, zipPath: destZip });
      check('restoreBackup ok', rs.ok, rs.error);
      check('restoreBackup round-tripped level.dat',
        fs.existsSync(path.join(destPath, 'world', 'level.dat')));
    } else {
      skipOrFail('backup round-trip', 'no zip+unzip and no tar on this system');
    }

    // ---- 2) real java process + /proc walk + metrics + kill/reap ----
    const hasJava = which('java');
    const hasJavac = which('javac');
    if (!hasJava) {
      skipOrFail('java process checks', 'java not installed (install a JDK to run them)');
      console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed (java parts skipped).');
      process.exit(failures ? 1 : 0);
    }

    // Fixture: blocks on System.in.read() so it stays alive until we kill it (a plain
    // `java -version` exits too fast for the /proc walk to catch it).
    const src = 'public class OlFixture { public static void main(String[] a) throws Exception { System.in.read(); } }';
    const fixturePath = path.join(tmpRoot, 'OlFixture.java');
    fs.writeFileSync(fixturePath, src);

    let javaArgs;
    if (hasJavac) {
      const comp = spawnSync('javac', [fixturePath], { cwd: tmpRoot, encoding: 'utf8' });
      if (comp.status !== 0) {
        skipOrFail('java process checks', `javac failed (${comp.stderr || comp.error})`);
        console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed (java parts skipped).');
        process.exit(failures ? 1 : 0);
      }
      javaArgs = ['-cp', tmpRoot, 'OlFixture'];
    } else {
      // JDK 11+ single-file source launch (no javac on PATH).
      javaArgs = [fixturePath];
    }

    child = spawn('java', javaArgs, { stdio: ['pipe', 'ignore', 'ignore'] });
    const pid = child.pid;

    // Poll: java needs a moment to appear as a child named 'java'.
    let found = null;
    for (let i = 0; i < 50 && !found; i++) {
      found = await linux.findJavaDescendant(process.pid);
      if (!found) await sleep(200);
    }
    check('findJavaDescendant found the java child', found === pid,
      `expected pid ${pid}, got ${found}`);

    const info = linux.getProcessInfo(pid);
    check('getProcessInfo alive + name', !!info && info.alive === true && /java/i.test(info.name || ''),
      JSON.stringify(info));
    check('getProcessInfo startTimeMs > 0', !!info && Number.isFinite(info.startTimeMs) && info.startTimeMs > 0,
      info ? `startTimeMs=${info.startTimeMs}` : 'null');

    const metrics = await linux.getProcessMetrics(pid);
    check('getProcessMetrics memoryMB > 0', !!metrics && metrics.memoryMB > 0, JSON.stringify(metrics));
    check('getProcessMetrics cpuTime >= 0', !!metrics && metrics.cpuTime >= 0, JSON.stringify(metrics));

    // Kill + reap: getProcessInfo must report null once the process is gone (zombie or reaped).
    try { child.kill('SIGKILL'); } catch {}
    let gone = false;
    for (let i = 0; i < 50 && !gone; i++) {
      if (linux.getProcessInfo(pid) === null) gone = true;
      else await sleep(100);
    }
    check('getProcessInfo returns null after kill', gone);
  } catch (err) {
    failures++;
    console.log(`FAIL unexpected error — ${err && err.stack ? err.stack : err}`);
  } finally {
    cleanup();
  }

  console.log(failures ? `\n${failures} check(s) failed.` : '\nAll linux-boot checks passed.');
  process.exit(failures ? 1 : 0);
})();
