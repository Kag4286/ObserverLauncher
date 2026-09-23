// getProcessInfo (v2.0.0 prereq for orphan cleanup): given a pid, report whether it
// is alive, its image name, and its creation time (epoch ms). The creation time is
// what detects PID reuse so orphan cleanup never kills a recycled pid (tier 3).
const assert = require('assert');
const { spawn } = require('child_process');
const platform = require('../src/main/platform');

let passed = 0;
function ok(name, cond) { assert(cond, `FAIL: ${name}`); console.log(`PASS ${name}`); passed++; }

const waitExit = (child) => new Promise(res => child.once('exit', res));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  // Invalid / impossible pids must return null, never throw.
  ok('pid 0 -> null', await platform.getProcessInfo(0) === null);
  ok('pid -1 -> null', await platform.getProcessInfo(-1) === null);
  ok('pid "x" -> null', await platform.getProcessInfo('x') === null);
  ok('huge pid -> null', await platform.getProcessInfo(2 ** 31 - 1) === null);

  // A real long-lived child: identity must be reported.
  const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
  await sleep(250); // let the process table settle
  const info = await platform.getProcessInfo(child.pid);
  ok('live child -> alive object', !!info && info.alive === true);
  ok('live child name mentions node', !!info && /node/i.test(String(info.name)));
  ok('live child has a start time', !!info && Number.isFinite(info.startTimeMs) && info.startTimeMs > 0);

  // After the child is killed -> null (poll briefly; /proc can linger a tick).
  child.kill('SIGKILL');
  await waitExit(child);
  let gone = await platform.getProcessInfo(child.pid);
  for (let i = 0; i < 20 && gone !== null; i++) { await sleep(50); gone = await platform.getProcessInfo(child.pid); }
  ok('killed child -> null', gone === null);

  console.log(`\n${passed} passed, 0 failed`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
