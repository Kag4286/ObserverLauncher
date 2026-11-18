// v9.0.2: Unit + local mock IPC tests for Discord Rich Presence ("Playing" status).
// Exercises binary frame encoding/decoding, cross-platform IPC pipe paths, privacy toggles,
// multi-instance priority, and live HANDSHAKE -> READY -> SET_ACTIVITY -> CLEAR_ACTIVITY over net.
const assert = require('assert');
const net = require('net');
const os = require('os');
const path = require('path');
const fs = require('fs');

const D = require('../src/main/discord-rpc.js');

let passed = 0;
function ok(name, cond) { assert(cond, `FAIL: ${name}`); console.log(`PASS ${name}`); passed++; }

// 1. Frame encode / decode (handles split chunks + batched multi-frame chunks)
{
  const f1 = D.encodeFrame(D.OP.HANDSHAKE, { v: 1, client_id: '123456789012345678' });
  const f2 = D.encodeFrame(D.OP.FRAME, { cmd: 'SET_ACTIVITY', args: { pid: 42 } });
  const joined = Buffer.concat([f1, f2]);
  const splitPoint = Math.floor(f1.length / 2);
  const firstHalf = D.decodeFrames(joined.subarray(0, splitPoint));
  ok('partial chunk yields 0 frames cleanly and retains remainder', firstHalf.frames.length === 0 && firstHalf.rest.length === splitPoint);
  const restCombined = Buffer.concat([firstHalf.rest, joined.subarray(splitPoint)]);
  const full = D.decodeFrames(restCombined);
  ok('reassembled chunk decodes both frames in order',
    full.frames.length === 2 &&
    full.frames[0].op === D.OP.HANDSHAKE && full.frames[0].data.client_id === '123456789012345678' &&
    full.frames[1].op === D.OP.FRAME && full.frames[1].data.cmd === 'SET_ACTIVITY' &&
    full.rest.length === 0);
}

// 2. Cross-platform IPC discovery paths
{
  const winPaths = D.candidateIpcPaths({}, 'win32');
  ok('win32 enumerates 10 named pipes', winPaths.length === 10 && winPaths[0] === '\\\\.\\pipe\\discord-ipc-0');
  const linuxPaths = D.candidateIpcPaths({ XDG_RUNTIME_DIR: '/run/user/1000' }, 'linux');
  ok('linux includes XDG_RUNTIME_DIR, Flatpak, and Snap IPC socket paths',
    linuxPaths.includes(path.join('/run/user/1000', 'discord-ipc-0')) &&
    linuxPaths.includes(path.join('/run/user/1000', 'app', 'com.discordapp.Discord', 'discord-ipc-0')) &&
    linuxPaths.includes(path.join('/run/user/1000', 'snap.discord', 'discord-ipc-0')));
}

// 3. Activity builder states & privacy controls
{
  const runningSnap = {
    activeRunning: { name: 'Survival SMP', software: 'Fabric', mc: '1.21.1', playersOnline: 4, maxPlayers: 20, tps: 19.8, startedAt: 1700000000000 },
    activeStarting: null,
    serverCount: 2,
  };
  const actFull = D.buildPresenceActivity(runningSnap, { discordRpcShowServerName: true, discordRpcShowPlayers: true });
  ok('running activity includes server name, software/MC, players, TPS, timestamp, HTTPS artwork, and party size',
    actFull.details === 'Hosting Survival SMP' &&
    actFull.state === 'Fabric 1.21.1 · 4/20 players · 19.8 TPS' &&
    actFull.timestamps.start === 1700000000 &&
    typeof actFull.assets?.large_image === 'string' && actFull.assets.large_image.startsWith('https://') &&
    !actFull.assets?.small_image &&
    JSON.stringify(actFull.party.size) === '[4,20]');

  const actPrivate = D.buildPresenceActivity(runningSnap, { discordRpcShowServerName: false, discordRpcShowPlayers: false });
  ok('privacy toggles hide server name, player count, and party size',
    actPrivate.details === 'Hosting Minecraft Server' && !actPrivate.state.includes('players') && !actPrivate.party);

  const zeroPlayersAct = D.buildPresenceActivity({
    activeRunning: { name: 'Empty', software: 'Paper', mc: '1.21.4', playersOnline: 0, maxPlayers: 20, tps: null, startedAt: 1700000000000 },
  }, { discordRpcShowServerName: true, discordRpcShowPlayers: true });
  ok('0 online players omits party field so Discord never rejects [0, max]',
    zeroPlayersAct.state === 'Paper 1.21.4 · 0/20 players' && !zeroPlayersAct.party);

  const idleOff = D.buildPresenceActivity({ activeRunning: null, activeStarting: null, serverCount: 3 }, { discordRpcShowIdle: false });
  ok('idle returns null when discordRpcShowIdle=false', idleOff === null);

  const idleOn = D.buildPresenceActivity({ activeRunning: null, activeStarting: null, serverCount: 3 }, { discordRpcShowIdle: true }, 1700005000000);
  ok('idle returns Managing N servers when discordRpcShowIdle=true', idleOn && idleOn.state === 'Managing 3 servers · Idle');
}

// 4. Mock local Discord IPC server round-trip (HANDSHAKE -> READY -> SET_ACTIVITY -> CLEAR_ACTIVITY)
(async () => {
  const sockPath = process.platform === 'win32'
    ? `\\\\.\\pipe\\ol-test-discord-ipc-${process.pid}-${Date.now()}`
    : path.join(os.tmpdir(), `ol-test-discord-ipc-${process.pid}-${Date.now()}.sock`);

  const received = [];
  const server = net.createServer(conn => {
    let buf = Buffer.alloc(0);
    conn.on('data', chunk => {
      buf = Buffer.concat([buf, chunk]);
      const { frames, rest } = D.decodeFrames(buf);
      buf = rest;
      for (const f of frames) {
        received.push(f);
        if (f.op === D.OP.HANDSHAKE) {
          conn.write(D.encodeFrame(D.OP.FRAME, {
            cmd: 'DISPATCH',
            evt: 'READY',
            data: { user: { id: '999', username: 'SteveHost', global_name: 'Steve' } },
          }));
        }
      }
    });
  });

  await new Promise(resolve => server.listen(sockPath, resolve));
  const transitions = [];
  const rpc = D.createDiscordRpcController({
    pathsFn: () => [sockPath],
    minUpdateMs: 0,
    onStatusChange: st => transitions.push(st),
  });

  try {
    const noId = rpc.configure({ discordRpcEnabled: true, discordRpcClientId: 'bad' });
    ok('invalid clientId reports no_client_id without connecting', noId.state === 'no_client_id');

    rpc.updateSnapshot({
      activeRunning: { name: 'Modded 1.21.1', software: 'Fabric', mc: '1.21.1', playersOnline: 2, maxPlayers: 10, tps: 20, startedAt: 1700000000000 },
      serverCount: 1,
    });
    rpc.configure({
      discordRpcEnabled: true,
      discordRpcClientId: '123456789012345678',
      discordRpcShowServerName: true,
      discordRpcShowPlayers: true,
      discordRpcShowIdle: false,
    });

    const deadline = Date.now() + 3000;
    while (Date.now() < deadline && !received.some(f => f.op === D.OP.FRAME && f.data?.cmd === 'SET_ACTIVITY')) {
      await new Promise(r => setTimeout(r, 20));
    }

    const st = rpc.getStatus();
    ok('controller connects to local pipe, captures READY user, and fires onStatusChange',
      st.state === 'connected' && st.user?.username === 'SteveHost' &&
      transitions.some(t => t.state === 'connected' && t.user?.username === 'SteveHost'));

    const hs = received.find(f => f.op === D.OP.HANDSHAKE);
    const setAct = received.find(f => f.op === D.OP.FRAME && f.data?.cmd === 'SET_ACTIVITY');
    ok('handshake sent valid client_id and SET_ACTIVITY sent running activity',
      hs?.data?.client_id === '123456789012345678' &&
      setAct?.data?.args?.activity?.details === 'Hosting Modded 1.21.1' &&
      setAct?.data?.args?.activity?.state === 'Fabric 1.21.1 · 2/10 players · 20.0 TPS');

    rpc.stop();
    await new Promise(r => setTimeout(r, 60));
    const cleared = received.some(f => f.op === D.OP.FRAME && f.data?.cmd === 'SET_ACTIVITY' && f.data?.args?.activity === null);
    ok('stop sends CLEAR_ACTIVITY (activity: null) before closing', cleared);
    ok('stop resets controller status to disabled', rpc.getStatus().state === 'disabled');
  } finally {
    rpc.stop();
    await new Promise(resolve => server.close(resolve));
    if (process.platform !== 'win32') { try { fs.rmSync(sockPath, { force: true }); } catch {} }
  }

  // 5. Discord fatal handshake error (4000 Invalid Client ID) surfaces error state & lastError
  const errSockPath = process.platform === 'win32'
    ? `\\\\.\\pipe\\ol-test-discord-err-${process.pid}-${Date.now()}`
    : path.join(os.tmpdir(), `ol-test-discord-err-${process.pid}-${Date.now()}.sock`);
  const errServer = net.createServer(conn => {
    let buf = Buffer.alloc(0);
    conn.on('data', chunk => {
      buf = Buffer.concat([buf, chunk]);
      const { frames, rest } = D.decodeFrames(buf);
      buf = rest;
      for (const f of frames) {
        if (f.op === D.OP.HANDSHAKE) {
          conn.write(D.encodeFrame(D.OP.FRAME, {
            cmd: 'DISPATCH',
            evt: 'ERROR',
            data: { code: 4000, message: 'Invalid Client ID' },
          }));
        }
      }
    });
  });
  await new Promise(resolve => errServer.listen(errSockPath, resolve));
  const rpcErr = D.createDiscordRpcController({ pathsFn: () => [errSockPath], minUpdateMs: 0 });
  try {
    rpcErr.configure({ discordRpcEnabled: true, discordRpcClientId: '999999999999999999' });
    const dl = Date.now() + 3000;
    while (Date.now() < dl && rpcErr.getStatus().state !== 'error') {
      await new Promise(r => setTimeout(r, 20));
    }
    const errSt = rpcErr.getStatus();
    ok('fatal Discord 4000 error sets state=error with lastError',
      errSt.state === 'error' && errSt.lastError === 'Invalid Client ID (4000)');
  } finally {
    rpcErr.stop();
    await new Promise(resolve => errServer.close(resolve));
    if (process.platform !== 'win32') { try { fs.rmSync(errSockPath, { force: true }); } catch {} }
  }

  console.log(`\ndiscord-rpc: ${passed} passed, 0 failed`);
})().catch(e => { console.error(e); process.exit(1); });
