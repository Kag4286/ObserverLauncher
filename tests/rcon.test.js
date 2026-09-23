// v2.0.0 (M6): Source-RCON client. Pure packet encode/decode + a real RconClient against a tiny
// in-process mock RCON server (auth + exec round-trip). No external deps.
const assert = require('assert');
const net = require('net');
const { TYPE, encodePacket, decodePacket, RconClient, makeRconCreds, desiredRconProps } = require('../src/main/rcon.js');

let passed = 0;
function ok(name, cond) { assert(cond, `FAIL: ${name}`); console.log(`PASS ${name}`); passed++; }

// ---- pure: encode -> decode round-trip ----
const pkt = encodePacket(7, TYPE.COMMAND, 'list');
const dec = decodePacket(pkt, 0);
ok('encode/decode id', dec.id === 7);
ok('encode/decode type', dec.type === TYPE.COMMAND);
ok('encode/decode body', dec.body === 'list');
ok('decode size matches buffer', dec.size === pkt.length);

// partial buffer -> null (TCP can split packets)
ok('partial -> null', decodePacket(pkt.slice(0, 6), 0) === null);
ok('too short -> null', decodePacket(Buffer.from([1, 2]), 0) === null);

// two packets concatenated: decode one, then the next at the right offset
const two = Buffer.concat([encodePacket(1, TYPE.COMMAND, 'a'), encodePacket(2, TYPE.COMMAND, 'b')]);
const d1 = decodePacket(two, 0);
const d2 = decodePacket(two, d1.size);
ok('concat #1 body', d1.body === 'a');
ok('concat #2 body', d2.body === 'b');

// ---- integration: mock RCON server ----
function startMockRcon(password, respond) {
  const srv = net.createServer(sock => {
    let buf = Buffer.alloc(0);
    let authed = false;
    sock.on('data', chunk => {
      buf = Buffer.concat([buf, chunk]);
      let off = 0, p;
      while ((p = decodePacket(buf, off))) {
        off += p.size;
        if (p.type === TYPE.AUTH) {
          authed = p.body === password;
          // auth-response: same id on success, -1 on failure
          sock.write(encodePacket(authed ? p.id : -1, TYPE.COMMAND, ''));
        } else if (p.type === TYPE.COMMAND && authed) {
          sock.write(encodePacket(p.id, TYPE.RESPONSE, respond(p.body)));
        }
      }
      if (off) buf = buf.slice(off);
    });
  });
  return new Promise(res => srv.listen(0, '127.0.0.1', () => res({ srv, port: srv.address().port })));
}

(async () => {
  const { srv, port } = await startMockRcon('s3cret', cmd => `> ${cmd}`);

  const good = new RconClient({ port, password: 's3cret' });
  await good.connect();
  ok('connect ok', good.connected === true);
  const r1 = await good.exec('list');
  ok('exec returns response', r1 === '> list');
  const r2 = await good.exec('tps');
  ok('exec #2', r2 === '> tps');
  good.close();
  ok('close -> not connected', good.connected === false);

  const bad = new RconClient({ port, password: 'wrong' });
  let authErr = null;
  try { await bad.connect(); } catch (e) { authErr = e; }
  ok('wrong password rejects', !!authErr && /auth/i.test(authErr.message));
  bad.close();

  srv.close();

  // ---- creds + desiredRconProps ----
  const c1 = makeRconCreds();
  ok('creds port in range', c1.port >= 25575 && c1.port <= 25999);
  ok('creds password hex 32', /^[0-9a-f]{32}$/.test(c1.password));
  const c2 = makeRconCreds();
  ok('creds random (two differ)', c1.password !== c2.password);

  // Existing user RCON config is preserved (never overwritten).
  const keep = desiredRconProps({ 'enable-rcon': 'true', 'rcon.port': '25580', 'rcon.password': 'mine' }, 0, '');
  ok('existing port preserved', keep.port === 25580);
  ok('existing password preserved', keep.password === 'mine');
  ok('next sets enable-rcon true', keep.next['enable-rcon'] === 'true');
  // No existing config -> generates a fresh port + password.
  const gen = desiredRconProps({}, 0, '');
  ok('generated port set', gen.port > 0 && gen.password.length === 32);

  // ---- sendConsoleCommand: RCON first, stdin fallback ----
  const { sendConsoleCommand } = require('../src/main/server-lifecycle.js');
  const fakeCtx = { lastManualCommandAt: 0, appendLog: () => {}, serverProcess: null, rcon: null };
  // RCON connected -> uses rcon, no stdin.
  let rconUsed = null;
  fakeCtx.rcon = { connected: true, exec: async c => { rconUsed = c; return 'ok'; } };
  const viaRcon = await sendConsoleCommand(fakeCtx, 'list');
  ok('send via rcon', viaRcon.ok === true && viaRcon.via === 'rcon' && rconUsed === 'list');
  // RCON absent -> stdin fallback.
  fakeCtx.rcon = null;
  let wrote = null;
  fakeCtx.serverProcess = { stdin: { writable: true, write: c => { wrote = c; } } };
  const viaStdin = await sendConsoleCommand(fakeCtx, 'tps');
  ok('send via stdin fallback', viaStdin.ok === true && viaStdin.via === 'stdin' && wrote === 'tps\r\n');
  // Nothing available -> error.
  fakeCtx.serverProcess = null;
  const none = await sendConsoleCommand(fakeCtx, 'list');
  ok('send with no transport -> error', none.ok === false);

  console.log(`\n${passed} passed, 0 failed`);
})().catch(e => { console.error(e); process.exit(1); });
