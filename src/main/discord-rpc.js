// discord-rpc.js — Pure-Node local Discord Rich Presence IPC client (v9.0.2).
//
// Connects directly to Discord Desktop's local named pipe (Windows) or Unix socket (Linux/macOS)
// with zero external npm dependencies and zero network calls. Fail-silent when Discord is not
// installed or running. Pure framing + activity builders are exported for isolated unit testing.
const net = require('net');
const path = require('path');

const OP = {
  HANDSHAKE: 0,
  FRAME: 1,
  CLOSE: 2,
  PING: 3,
  PONG: 4,
};

const VALID_CLIENT_ID_RE = /^\d{17,21}$/;
const DEFAULT_MIN_UPDATE_MS = 5000;
const DEFAULT_HANDSHAKE_TIMEOUT_MS = 3000;
const RECONNECT_STEPS_MS = [5000, 15000, 30000, 60000];
const FATAL_ERROR_CODES = new Set([4000, 4002, 4003, 4009]);
const DEFAULT_LARGE_IMAGE_URL = 'https://raw.githubusercontent.com/Kag4286/ObserverLauncher/main/build/icon.png';

// Encode one Discord IPC packet: 4-byte LE op + 4-byte LE byteLength + UTF-8 JSON body.
function encodeFrame(op, payload) {
  const json = typeof payload === 'string' ? payload : JSON.stringify(payload || {});
  const body = Buffer.from(json, 'utf8');
  const head = Buffer.alloc(8);
  head.writeUInt32LE(Number(op) >>> 0, 0);
  head.writeUInt32LE(body.length >>> 0, 4);
  return Buffer.concat([head, body]);
}

// Decode all complete Discord IPC frames from an incoming buffer chunk, keeping trailing remainder.
function decodeFrames(buf) {
  const frames = [];
  let offset = 0;
  const src = Buffer.isBuffer(buf) ? buf : Buffer.alloc(0);
  while (offset + 8 <= src.length) {
    const op = src.readUInt32LE(offset);
    const len = src.readUInt32LE(offset + 4);
    if (len > 4 * 1024 * 1024) {
      // Corrupt/oversized frame: discard remaining buffer safely.
      return { frames, rest: Buffer.alloc(0), error: 'frame-too-large' };
    }
    if (offset + 8 + len > src.length) break;
    const raw = src.toString('utf8', offset + 8, offset + 8 + len);
    let data = raw;
    try { data = JSON.parse(raw); } catch {}
    frames.push({ op, data });
    offset += 8 + len;
  }
  return { frames, rest: offset > 0 ? src.subarray(offset) : src };
}

// Candidate local Discord IPC paths across Windows named pipes and POSIX runtime sockets.
function candidateIpcPaths(env = process.env, platform = process.platform) {
  const paths = [];
  if (platform === 'win32') {
    for (let i = 0; i < 10; i++) paths.push(`\\\\.\\pipe\\discord-ipc-${i}`);
    return paths;
  }
  const roots = [
    env.XDG_RUNTIME_DIR,
    env.TMPDIR,
    env.TMP,
    env.TEMP,
    '/tmp',
  ].filter(Boolean);
  const dirs = new Set();
  for (const r of roots) {
    dirs.add(r);
    dirs.add(path.join(r, 'app', 'com.discordapp.Discord'));
    dirs.add(path.join(r, 'snap.discord'));
  }
  for (let i = 0; i < 10; i++) {
    for (const d of dirs) paths.push(path.join(d, `discord-ipc-${i}`));
  }
  return paths;
}

function clampText(str, maxLen = 128) {
  const s = String(str || '').trim();
  if (!s) return '';
  return s.length > maxLen ? s.slice(0, maxLen - 1) + '…' : s;
}

function isValidClientId(id) {
  return VALID_CLIENT_ID_RE.test(String(id || '').trim());
}

// Build a Discord RPC Activity object from a normalized multi-instance snapshot and privacy settings.
function buildPresenceActivity(snapshot, settings = {}, nowMs = Date.now()) {
  const snap = snapshot || {};
  const s = settings || {};
  const showName = s.discordRpcShowServerName !== false;
  const showPlayers = s.discordRpcShowPlayers !== false;
  const showIdle = !!s.discordRpcShowIdle;

  if (snap.activeRunning) {
    const r = snap.activeRunning;
    const label = [r.software, r.mc].filter(Boolean).join(' ');
    const details = clampText(showName && r.name ? `Hosting ${r.name}` : 'Hosting Minecraft Server');
    const parts = [];
    if (label) parts.push(label);
    const online = Math.max(0, Number(r.playersOnline) || 0);
    const maxP = Number(r.maxPlayers) || 0;
    if (showPlayers) {
      parts.push(maxP > 0 ? `${online}/${maxP} players` : `${online} player${online === 1 ? '' : 's'} online`);
    }
    if (r.tps != null && Number.isFinite(Number(r.tps))) {
      parts.push(`${Number(r.tps).toFixed(1)} TPS`);
    }
    const state = clampText(parts.join(' · ') || 'Online');
    const activity = {
      details,
      state,
      assets: {
        large_image: DEFAULT_LARGE_IMAGE_URL,
        large_text: label ? `ObserverLauncher · ${label}` : 'ObserverLauncher',
      },
    };
    if (Number(r.startedAt) > 0) {
      activity.timestamps = { start: Math.floor(Number(r.startedAt) / 1000) };
    }
    // Discord rejects party.size[0] === 0; only include party counts when >= 1 player is online.
    if (showPlayers && online >= 1 && maxP >= online) {
      activity.party = { id: 'observerlauncher-host', size: [online, maxP] };
    }
    return activity;
  }

  if (snap.activeStarting) {
    const st = snap.activeStarting;
    const label = [st.software, st.mc].filter(Boolean).join(' ');
    return {
      details: clampText(showName && st.name ? `Starting ${st.name}…` : 'Starting Minecraft Server…'),
      state: clampText(label || 'Preparing world…'),
      assets: {
        large_image: DEFAULT_LARGE_IMAGE_URL,
        large_text: 'ObserverLauncher',
      },
    };
  }

  if (!showIdle) return null;
  const n = Math.max(0, Number(snap.serverCount) || 0);
  return {
    details: 'ObserverLauncher',
    state: clampText(n > 0 ? `Managing ${n} server${n === 1 ? '' : 's'} · Idle` : 'Ready to host'),
    timestamps: { start: Math.floor((Number(snap.appStartedAt) || nowMs) / 1000) },
    assets: {
      large_image: DEFAULT_LARGE_IMAGE_URL,
      large_text: 'ObserverLauncher',
    },
  };
}

function readServerMetaForPath(serverPath, metaCache) {
  const root = String(serverPath || '').trim();
  if (!root) return { software: '', mc: '', maxPlayers: 0, folderName: '' };
  const cached = metaCache.get(root);
  if (cached && Date.now() - cached.at < 30000) return cached.info;
  let software = '';
  let mc = '';
  let maxPlayers = 0;
  try {
    const { serverFiles } = require('./server-files.js');
    const { detectServerTarget } = require('./server-compat.js');
    const f = serverFiles(root);
    const t = detectServerTarget(root, f);
    if (t && t.loader) software = t.loader[0].toUpperCase() + t.loader.slice(1);
    if (t && t.mc && t.mc !== 'latest') mc = t.mc;
    const mp = Number(f && f.properties && f.properties['max-players']);
    if (Number.isFinite(mp) && mp > 0) maxPlayers = mp;
  } catch {}
  const info = { software, mc, maxPlayers, folderName: path.basename(root) || '' };
  metaCache.set(root, { at: Date.now(), info });
  return info;
}

function collectPresenceSnapshot(ctx, metaCache = new Map(), appStartedAt = Date.now()) {
  if (!ctx || !ctx.instances) {
    return { activeRunning: null, activeStarting: null, serverCount: 0, appStartedAt };
  }
  let nameMap = new Map();
  let configuredCount = 0;
  try {
    const list = require('./settings.js').listInstances();
    for (const i of list.instances || []) nameMap.set(i.id, i.name || '');
    configuredCount = (list.instances || []).length;
  } catch {}

  const order = [];
  if (ctx.activeInstanceId && ctx.instances.has(ctx.activeInstanceId)) order.push(ctx.activeInstanceId);
  for (const id of ctx.instances.keys()) if (!order.includes(id)) order.push(id);

  let activeRunning = null;
  let activeStarting = null;
  for (const id of order) {
    const st = ctx.instances.get(id);
    if (!st) continue;
    const meta = readServerMetaForPath(st.currentServerPath, metaCache);
    const name = nameMap.get(id) || meta.folderName || '';
    if (!activeRunning && st.serverStatus === 'running') {
      activeRunning = {
        id,
        name,
        software: meta.software,
        mc: meta.mc,
        playersOnline: Array.isArray(st.live && st.live.players) ? st.live.players.length : 0,
        maxPlayers: meta.maxPlayers,
        tps: st.live && st.live.tps != null ? st.live.tps : null,
        startedAt: st.startedAt || 0,
      };
      break;
    }
    if (!activeStarting && st.serverStatus === 'starting') {
      activeStarting = { id, name, software: meta.software, mc: meta.mc };
    }
  }
  return {
    activeRunning,
    activeStarting: activeRunning ? null : activeStarting,
    serverCount: Math.max(configuredCount, ctx.instances.size),
    appStartedAt,
  };
}

function createDiscordRpcController(opts = {}) {
  const connectFn = opts.connectFn || (p => net.createConnection(p));
  const pathsFn = opts.pathsFn || (() => candidateIpcPaths());
  const minUpdateMs = Number.isFinite(opts.minUpdateMs) ? opts.minUpdateMs : DEFAULT_MIN_UPDATE_MS;
  const handshakeTimeoutMs = Number.isFinite(opts.handshakeTimeoutMs) ? opts.handshakeTimeoutMs : DEFAULT_HANDSHAKE_TIMEOUT_MS;
  const onStatusChange = typeof opts.onStatusChange === 'function' ? opts.onStatusChange : null;
  const appStartedAt = opts.appStartedAt || Date.now();
  const metaCache = new Map();

  let cfg = {
    enabled: false,
    clientId: '',
    discordRpcShowIdle: true,
    discordRpcShowServerName: true,
    discordRpcShowPlayers: true,
  };
  let socket = null;
  let recvBuf = Buffer.alloc(0);
  let state = 'disabled'; // 'disabled' | 'no_client_id' | 'connecting' | 'connected' | 'waiting' | 'error'
  let user = null;
  let lastError = null;
  let lastEmittedKey = '';
  let reconnectTimer = null;
  let syncTimer = null;
  let hsTimer = null;
  let retryIdx = 0;
  let seq = 0;
  let lastSentAt = 0;
  let lastPayloadJson = null;
  let latestSnapshot = { activeRunning: null, activeStarting: null, serverCount: 0, appStartedAt };
  let destroyed = false;

  function emitStatus() {
    const st = getStatus();
    const key = `${st.enabled}|${st.state}|${st.user?.id || st.user?.username || ''}|${st.lastError || ''}`;
    if (key === lastEmittedKey) return st;
    lastEmittedKey = key;
    if (onStatusChange) {
      try { onStatusChange(st); } catch {}
    }
    return st;
  }

  function setState(nextState, nextErr) {
    state = nextState;
    if (nextErr !== undefined) lastError = nextErr;
    emitStatus();
  }

  function clearTimers() {
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    if (syncTimer) { clearTimeout(syncTimer); syncTimer = null; }
    if (hsTimer) { clearTimeout(hsTimer); hsTimer = null; }
  }

  function closeSocket(sendClear = false) {
    if (hsTimer) { clearTimeout(hsTimer); hsTimer = null; }
    const s = socket;
    socket = null;
    recvBuf = Buffer.alloc(0);
    user = null;
    lastPayloadJson = null;
    if (!s) return;
    try {
      if (sendClear && s.writable) {
        s.write(encodeFrame(OP.FRAME, { cmd: 'SET_ACTIVITY', args: { pid: process.pid, activity: null }, nonce: `ol-clr-${++seq}` }));
        s.write(encodeFrame(OP.CLOSE, {}));
      }
    } catch {}
    try { s.destroy(); } catch {}
  }

  function sendFrame(op, payload) {
    if (!socket || !socket.writable) return false;
    try {
      socket.write(encodeFrame(op, payload));
      return true;
    } catch {
      return false;
    }
  }

  function pushActivityNow() {
    if (syncTimer) { clearTimeout(syncTimer); syncTimer = null; }
    if (state !== 'connected' || !cfg.enabled) return;
    const activity = buildPresenceActivity(latestSnapshot, cfg);
    const packet = {
      cmd: 'SET_ACTIVITY',
      args: { pid: process.pid, activity: activity || null },
      nonce: `ol-${++seq}`,
    };
    const serialized = JSON.stringify(activity || null);
    if (serialized === lastPayloadJson) return;
    lastPayloadJson = serialized;
    lastSentAt = Date.now();
    sendFrame(OP.FRAME, packet);
  }

  function scheduleSync() {
    if (state !== 'connected' || !cfg.enabled) return;
    const elapsed = Date.now() - lastSentAt;
    if (elapsed >= minUpdateMs) {
      pushActivityNow();
      return;
    }
    if (!syncTimer) {
      syncTimer = setTimeout(() => {
        syncTimer = null;
        pushActivityNow();
      }, Math.max(50, minUpdateMs - elapsed));
      try { if (syncTimer.unref) syncTimer.unref(); } catch {}
    }
  }

  function scheduleReconnect() {
    if (destroyed || !cfg.enabled || !isValidClientId(cfg.clientId) || state === 'error') return;
    if (reconnectTimer) return;
    setState('waiting');
    const delay = RECONNECT_STEPS_MS[Math.min(retryIdx, RECONNECT_STEPS_MS.length - 1)];
    retryIdx++;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connectNext();
    }, delay);
    try { if (reconnectTimer.unref) reconnectTimer.unref(); } catch {}
  }

  function formatRpcError(data) {
    const errData = (data && typeof data === 'object') ? data : {};
    const code = Number(errData.code) || 0;
    const msg = String(errData.message || '').trim() || 'Discord RPC rejected connection';
    return { code, message: code ? `${msg} (${code})` : msg };
  }

  function tryPath(list, idx) {
    if (destroyed || !cfg.enabled || !isValidClientId(cfg.clientId) || state === 'error') return;
    if (idx >= list.length) {
      scheduleReconnect();
      return;
    }
    let settled = false;
    let sock;
    try {
      sock = connectFn(list[idx]);
    } catch {
      return tryPath(list, idx + 1);
    }
    socket = sock;
    recvBuf = Buffer.alloc(0);

    const clearHsTimer = () => { if (hsTimer) { clearTimeout(hsTimer); hsTimer = null; } };

    const onFail = () => {
      clearHsTimer();
      if (settled) return;
      settled = true;
      const wasConnected = state === 'connected';
      if (socket === sock) {
        socket = null;
        user = null;
        lastPayloadJson = null;
      }
      try { sock.destroy(); } catch {}
      if (destroyed || !cfg.enabled || state === 'error') return;
      if (wasConnected) scheduleReconnect();
      else tryPath(list, idx + 1);
    };

    const failWithRpcPayload = payload => {
      const { code, message } = formatRpcError(payload);
      lastError = message;
      if (!FATAL_ERROR_CODES.has(code)) return onFail();
      clearHsTimer();
      settled = true;
      if (socket === sock) { socket = null; user = null; lastPayloadJson = null; }
      try { sock.destroy(); } catch {}
      setState('error', message);
    };

    sock.once('connect', () => {
      if (destroyed || !cfg.enabled || socket !== sock) return onFail();
      recvBuf = Buffer.alloc(0);
      clearHsTimer();
      hsTimer = setTimeout(() => {
        if (!settled && socket === sock) onFail();
      }, handshakeTimeoutMs);
      try { if (hsTimer.unref) hsTimer.unref(); } catch {}
      sendFrame(OP.HANDSHAKE, { v: 1, client_id: cfg.clientId });
    });

    sock.on('data', chunk => {
      if (socket !== sock) return;
      recvBuf = Buffer.concat([recvBuf, chunk]);
      const { frames, rest, error } = decodeFrames(recvBuf);
      recvBuf = rest;
      if (error) return onFail();
      for (const f of frames) {
        if (f.op === OP.PING) { sendFrame(OP.PONG, f.data || {}); continue; }
        if (f.op === OP.CLOSE) {
          if (f.data && (f.data.message || f.data.code)) return failWithRpcPayload(f.data);
          return onFail();
        }
        if (f.op === OP.FRAME && f.data && typeof f.data === 'object') {
          if (f.data.cmd === 'DISPATCH' && f.data.evt === 'READY') {
            clearHsTimer();
            settled = true;
            retryIdx = 0;
            const u = f.data.data && f.data.data.user;
            user = u ? {
              id: u.id ? String(u.id) : null,
              username: u.username ? String(u.username) : null,
              globalName: u.global_name ? String(u.global_name) : null,
            } : null;
            setState('connected', null);
            pushActivityNow();
          } else if (f.data.evt === 'ERROR') {
            return failWithRpcPayload(f.data.data);
          }
        }
      }
    });

    sock.on('error', onFail);
    sock.on('close', onFail);
  }

  function connectNext() {
    if (destroyed || !cfg.enabled || !isValidClientId(cfg.clientId)) return;
    if (socket) return;
    setState('connecting', null);
    const list = pathsFn();
    if (!list.length) return scheduleReconnect();
    tryPath(list, 0);
  }

  function configure(settings = {}) {
    const enabled = !!settings.discordRpcEnabled;
    const clientId = String(settings.discordRpcClientId || '').trim();
    const clientChanged = clientId !== cfg.clientId;
    cfg = {
      enabled,
      clientId,
      discordRpcShowIdle: settings.discordRpcShowIdle !== undefined ? !!settings.discordRpcShowIdle : true,
      discordRpcShowServerName: settings.discordRpcShowServerName !== false,
      discordRpcShowPlayers: settings.discordRpcShowPlayers !== false,
    };

    if (!enabled) {
      clearTimers();
      closeSocket(true);
      setState('disabled', null);
      return getStatus();
    }
    if (!isValidClientId(clientId)) {
      clearTimers();
      closeSocket(true);
      setState('no_client_id', null);
      return getStatus();
    }
    if (clientChanged && socket) {
      clearTimers();
      closeSocket(true);
    }
    if (!socket) {
      clearTimers();
      retryIdx = 0;
      connectNext();
    } else {
      scheduleSync();
    }
    return getStatus();
  }

  function reconnect() {
    if (destroyed) return getStatus();
    clearTimers();
    closeSocket(true);
    retryIdx = 0;
    if (!cfg.enabled) {
      setState('disabled', null);
      return getStatus();
    }
    if (!isValidClientId(cfg.clientId)) {
      setState('no_client_id', null);
      return getStatus();
    }
    connectNext();
    return getStatus();
  }

  function updateFromContext(ctx) {
    latestSnapshot = collectPresenceSnapshot(ctx, metaCache, appStartedAt);
    scheduleSync();
  }

  function updateSnapshot(snapshot) {
    latestSnapshot = snapshot || latestSnapshot;
    scheduleSync();
  }

  function stop() {
    destroyed = true;
    clearTimers();
    closeSocket(true);
    setState('disabled', null);
  }

  function getStatus() {
    return {
      enabled: cfg.enabled,
      state,
      user,
      hasClientId: isValidClientId(cfg.clientId),
      lastError,
    };
  }

  return { configure, reconnect, updateFromContext, updateSnapshot, pushActivityNow, stop, getStatus };
}

module.exports = {
  OP,
  VALID_CLIENT_ID_RE,
  encodeFrame,
  decodeFrames,
  candidateIpcPaths,
  isValidClientId,
  buildPresenceActivity,
  collectPresenceSnapshot,
  createDiscordRpcController,
};
