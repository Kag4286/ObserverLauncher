// boot-harness.js — shared pieces for the two Linux boot-smoke scripts
// (linux-full-boot.js + modpack-boot-smoke.js). Extracted so the temp-env setup, the Paper fetch,
// the boot/wait/stop flow and the PASS/FAIL checker live ONCE (gotcha #20 — they were copied).
//
// Both scripts stay separate (different flows: one boots a bare server, one builds a pack first), but
// the mechanical harness is common. NOT run by `npm test` — only in the gated CI jobs.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { resolvePaperWithRetry, isServiceOutage } = require('./paper-fetch.js');

const sleep = ms => new Promise(r => setTimeout(r, ms));

// PASS/FAIL counter. Returns { check, state }; state.failures is the running count.
function makeChecker() {
  const state = { failures: 0 };
  const check = (name, cond, detail) => cond
    ? console.log('PASS ' + name)
    : (state.failures++, console.log('FAIL ' + name + (detail ? ' — ' + detail : '')));
  return { check, state };
}

// Isolated temp dirs + a pre-written settings.json so the headless backend points at OUR folder.
// Returns { root, dataDir, serverDir, cleanup }.
function setupTempEnv(prefix, instanceName) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const dataDir = path.join(root, 'data');
  const serverDir = path.join(root, 'server');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(serverDir, { recursive: true });
  process.env.OBSERVER_DATA_DIR = dataDir;
  process.env.OBSERVER_CONFIRM_MODE = 'auto-deny';
  fs.writeFileSync(path.join(dataDir, 'settings.json'), JSON.stringify({
    version: 4, onboarded: true, mcpEnabled: false,
    instances: [{ id: 'default', name: instanceName, serverPath: serverDir, autoEula: true, memoryMin: 1, memoryMax: 2, rconPort: 0, rconPassword: '' }],
    activeInstanceId: 'default',
  }, null, 2));
  const cleanup = () => { try { fs.rmSync(root, { recursive: true, force: true }); } catch {} };
  return { root, dataDir, serverDir, cleanup };
}

// Resolve + download a Java-matched Paper jar (pin 26.2 / JDK 25). Returns { ok, dl } or
// { ok:false, outage:true, error } when PaperMC is down (the caller SKIPs, does not fail).
async function fetchPaper(serverDir) {
  const { downloadFillProject } = require('../src/main/adapters/papermc.js');
  const { download } = require('../src/main/http.js');
  let dl;
  try { dl = await resolvePaperWithRetry(downloadFillProject, '26.2'); }
  catch (e) {
    if (isServiceOutage(e)) return { ok: false, outage: true, error: e.message };
    throw e;
  }
  await download(dl.url, path.join(serverDir, dl.name), null, null, { maxBytes: 1024 * 1024 * 1024 });
  return { ok: true, dl };
}

// Wait until the headless server reports running + printed `Done (`. Returns true on success.
async function waitForDone(ctx) {
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    const buf = (ctx.consoleBuffer || []).map(l => l.text || '').join('\n');
    if (/Done \(|Done in/.test(buf) && ctx.serverStatus === 'running') return true;
    if (ctx.serverStatus === 'stopped' && buf.length) return false; // died early
    await sleep(1000);
  }
  return false;
}

// Graceful stop, then wait for the process to disappear. Returns true when gone.
async function stopAndWait(shim, ctx) {
  await shim.invoke('server:stop');
  const stopDeadline = Date.now() + 60000;
  while (Date.now() < stopDeadline && ctx.serverProcess) await sleep(1000);
  return !ctx.serverProcess;
}

// Best-effort: kill any java still running from OUR temp server dir, so a crashed run leaves none.
function killLeftover(serverDir) {
  try { spawnSync('pkill', ['-f', serverDir], { stdio: 'ignore' }); } catch {}
}

module.exports = { sleep, makeChecker, setupTempEnv, fetchPaper, waitForDone, stopAndWait, killLeftover };
