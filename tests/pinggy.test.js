// v6.0.0 A2.2: Pinggy adapter pure helpers + spawnPinggy with a fake child (no real ssh).
// The interface was MEASURED in SP1 (docs/v6.0.0-sp1.md); these tests pin it.
const assert = require('assert');
const {
  buildPinggyArgs, parsePinggyAddress, isPinggyBanner, spawnPinggy, PINGGY_FREE_HOST,
  DUMMY_PASSWORD, findSshBinary,
} = require('../src/main/pinggy.js');

let passed = 0;
function ok(name, cond) { assert(cond, `FAIL: ${name}`); console.log(`PASS ${name}`); passed++; }

// --- buildPinggyArgs: exact flags for tcp and udp ---
{
  const a = buildPinggyArgs(25599, 'tcp');
  ok('argv: uses free host', a.includes(`tcp@${PINGGY_FREE_HOST}`));
  ok('argv: ssh port 443', a[a.indexOf('-p') + 1] === '443');
  ok('argv: no pseudo-tty', a.includes('-T'));
  ok('argv: R0 remote forward with local port', a.includes('-R0:localhost:25599'));
  ok('argv: StrictHostKeyChecking accept-new', a.includes('StrictHostKeyChecking=accept-new'));
  // No BatchMode: the free tier needs password auth, and BatchMode disables it. The password is
  // answered by an SSH_ASKPASS helper instead (see spawnPinggy).
  ok('argv: NO BatchMode (password auth must stay enabled)', !a.some(x => /BatchMode/i.test(x)));
  ok('argv: ServerAliveInterval 30', a.includes('ServerAliveInterval=30'));
  ok('argv: ExitOnForwardFailure yes', a.includes('ExitOnForwardFailure=yes'));
  const u = buildPinggyArgs(19132, 'udp');
  ok('argv: udp user', u.includes(`udp@${PINGGY_FREE_HOST}`));
  ok('argv: udp local port', u.includes('-R0:localhost:19132'));
  ok('argv: proto case-insensitive', buildPinggyArgs(25565, 'TCP').includes(`tcp@${PINGGY_FREE_HOST}`));
  ok('argv: bad port throws', (() => { try { buildPinggyArgs(0, 'tcp'); return false; } catch { return true; } })());
  ok('argv: bad proto throws', (() => { try { buildPinggyArgs(25565, 'http'); return false; } catch { return true; } })());
}

// --- parsePinggyAddress: the EXACT SP1 lines ---
{
  const t = parsePinggyAddress('tcp://tsdcx-103-216-221-97.run.pinggy-free.link:39069');
  ok('parse: tcp host', t && t.host === 'tsdcx-103-216-221-97.run.pinggy-free.link');
  ok('parse: tcp port', t && t.port === 39069);
  ok('parse: tcp proto', t && t.proto === 'tcp');
  const u = parsePinggyAddress('udp://toqpo-103-216-221-97.run.pinggy-free.link:41140');
  ok('parse: udp host', u && u.host === 'toqpo-103-216-221-97.run.pinggy-free.link');
  ok('parse: udp port', u && u.port === 41140);
  ok('parse: udp proto', u && u.proto === 'udp');
  ok('parse: embedded in a sentence', !!parsePinggyAddress('Your address is tcp://x.y.z:1234 enjoy'));
  ok('parse: no address -> null', parsePinggyAddress('Allocated port 3 for remote forward') === null);
  ok('parse: empty -> null', parsePinggyAddress('') === null);
  ok('parse: port out of range -> null', parsePinggyAddress('tcp://x.y:99999') === null);
}

// --- isPinggyBanner: recognises the known noise, not the address ---
{
  ok('banner: Allocated port', isPinggyBanner('Allocated port 3 for remote forward to localhost:25599'));
  ok('banner: not authenticated', isPinggyBanner('You are not authenticated.'));
  ok('banner: expires', isPinggyBanner('Your tunnel will expire in 60 minutes.'));
  ok('banner: upgrade', isPinggyBanner('Upgrade to Pinggy Pro to get unrestricted tunnels.'));
  ok('banner: NOT the address', !isPinggyBanner('tcp://tsdcx-103-216-221-97.run.pinggy-free.link:39069'));
}

// --- spawnPinggy sets the SSH_ASKPASS env so password auth works without a console ---
{
  const { EventEmitter } = require('events');
  const c = new EventEmitter(); c.stdout = new EventEmitter(); c.stderr = new EventEmitter(); c.stdin = { writable: true, write() {}, end() {} };
  let capturedEnv = null;
  const r = spawnPinggy({ sshBinary: 'ssh', localPort: 25599, proto: 'tcp', spawnFn: (bin, args, opts) => { capturedEnv = opts && opts.env; return c; } });
  ok('spawn: SSH_ASKPASS set', !!(capturedEnv && capturedEnv.SSH_ASKPASS));
  ok('spawn: SSH_ASKPASS_REQUIRE=force', !!(capturedEnv && capturedEnv.SSH_ASKPASS_REQUIRE === 'force'));
  c.emit('exit', 0); // settle the pending promise and clear its 25s timer
  r.addressPromise.catch(() => {});
}

// --- spawnPinggy with a fake child: address arrives on stdout ---
function fakeChild() {
  const { EventEmitter } = require('events');
  const c = new EventEmitter();
  c.stdout = new EventEmitter();
  c.stderr = new EventEmitter();
  c.stdin = { writable: true, written: '', write(s) { this.written += s; }, end() { this.ended = true; } };
  return c;
}
{
  let spawnedWith = null;
  const child = fakeChild();
  const spawnFn = (bin, args) => { spawnedWith = { bin, args }; return child; };
  const r = spawnPinggy({ sshBinary: '/fake/ssh', localPort: 25599, proto: 'tcp', spawnFn });
  ok('spawn: returns ok + child', r.ok === true && r.child === child);
  ok('spawn: used the given ssh binary', spawnedWith.bin === '/fake/ssh');
  ok('spawn: piped dummy password', child.stdin.written.startsWith(DUMMY_PASSWORD));
  ok('spawn: closed stdin after password', child.stdin.ended === true);
  // Simulate the banner + address lines arriving.
  child.stdout.emit('data', Buffer.from('Allocated port 3 for remote forward to localhost:25599\n'));
  child.stdout.emit('data', Buffer.from('tcp://abc-1-2-3-4.run.pinggy-free.link:39069\n'));
  r.addressPromise.then(res => {
    ok('spawn: address resolved', res.ok === true && res.address.host === 'abc-1-2-3-4.run.pinggy-free.link' && res.address.port === 39069);
    finishAll();
  });
}

// --- spawnPinggy: address on STDERR also works; exit before address -> error ---
function fakeChild2() {
  const { EventEmitter } = require('events');
  const c = new EventEmitter();
  c.stdout = new EventEmitter();
  c.stderr = new EventEmitter();
  c.stdin = { writable: true, write() {}, end() {} };
  return c;
}
const pending = [];
{
  const child = fakeChild2();
  const r = spawnPinggy({ sshBinary: 'ssh', localPort: 19132, proto: 'udp', spawnFn: () => child });
  child.stderr.emit('data', Buffer.from('udp://zzz-9-9-9-9.run.pinggy-free.link:41140\n'));
  pending.push(r.addressPromise.then(res => ok('spawn: address on stderr resolves', res.ok && res.address.port === 41140)));
}
{
  const child = fakeChild2();
  const r = spawnPinggy({ sshBinary: 'ssh', localPort: 25599, proto: 'tcp', spawnFn: () => child });
  child.emit('exit', 255);
  pending.push(r.addressPromise.then(res => ok('spawn: exit before address -> error', res.ok === false && /exited/.test(res.error))));
}

// --- findSshBinary: returns a path string or null (depends on the machine, so only shape) ---
{
  const b = findSshBinary();
  ok('findSshBinary: string or null', b === null || typeof b === 'string');
}

function finishAll() {
  Promise.all(pending).then(() => {
    console.log(`\n${passed} passed, 0 failed`);
  }).catch(e => { console.error(e); process.exit(1); });
}
