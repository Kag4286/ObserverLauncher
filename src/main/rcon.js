// v2.0.0 (M6): a minimal, dependency-free Source-RCON client.
//
// WHY: the current console path writes commands to the server's stdin. stdin is per-process and
// can DEADLOCK under load, and it is tied to the process handle (so it is lost on a crash / for a
// background instance). RCON is the Minecraft-standard protocol, lifecycle-independent, and routes
// by PORT — which fits multi-instance: every instance gets its own rconPort + password.
//
// Packet layout (little-endian):
//   int32 length   = byte length of (id + type + body + 2 NUL)
//   int32 id       = request id (echoed back)
//   int32 type     = 3 auth | 2 auth-response / exec-command | 0 response-value
//   bytes body     = ASCII command / response
//   byte  NUL      = body terminator
//   byte  NUL      = extra pad
//
// SECURITY: bind/connect 127.0.0.1 only, never 0.0.0.0. The password is per-instance random.
const net = require('net');

const TYPE = { RESPONSE: 0, COMMAND: 2, AUTH: 3 };

// Pure: build one RCON packet as a Buffer.
function encodePacket(id, type, body) {
  const payload = Buffer.from(String(body == null ? '' : body), 'utf8');
  const len = 4 + 4 + payload.length + 2; // id + type + body + 2 NUL
  const buf = Buffer.allocUnsafe(4 + len);
  buf.writeInt32LE(len, 0);
  buf.writeInt32LE(id | 0, 4);
  buf.writeInt32LE(type | 0, 8);
  payload.copy(buf, 12);
  buf.writeUInt8(0, 12 + payload.length);
  buf.writeUInt8(0, 13 + payload.length);
  return buf;
}

// Pure: try to decode ONE packet from `buf` at `offset`. Returns {id,type,body,size} or null when
// the buffer does not yet hold a full packet (TCP can split/merge). `size` = bytes consumed.
function decodePacket(buf, offset) {
  offset = offset || 0;
  if (!Buffer.isBuffer(buf) || buf.length - offset < 4) return null;
  const len = buf.readInt32LE(offset);
  if (len < 10 || buf.length - offset < 4 + len) return null;
  const id = buf.readInt32LE(offset + 4);
  const type = buf.readInt32LE(offset + 8);
  const bodyStart = offset + 12;
  const bodyEnd = bodyStart + (len - 10); // len - (id4+type4+2 NUL)
  const body = buf.toString('utf8', bodyStart, bodyEnd);
  return { id, type, body, size: 4 + len };
}

// A tiny promise-based RCON client. One instance == one server connection. Not reusable after
// close(); connect() again for a new socket.
class RconClient {
  constructor(opts) {
    opts = opts || {};
    this.host = opts.host || '127.0.0.1';
    this.port = Number(opts.port) || 25575;
    this.password = String(opts.password || '');
    this.timeoutMs = Number(opts.timeoutMs) || 5000;
    this.socket = null;
    this.connected = false;
    this._buf = Buffer.alloc(0);
    this._nextId = 1;
    this._pending = new Map(); // id -> {resolve, reject, timer}
  }

  connect() {
    return new Promise((resolve, reject) => {
      if (this.socket) return reject(new Error('RCON client already connected.'));
      const sock = net.connect({ host: this.host, port: this.port });
      this.socket = sock;
      let settled = false;
      const fail = e => { if (!settled) { settled = true; try { sock.destroy(); } catch {} this.socket = null; reject(e); } };
      sock.setTimeout(this.timeoutMs);
      sock.once('error', fail);
      sock.once('timeout', () => fail(new Error('RCON connection timed out.')));
      sock.once('connect', async () => {
        sock.setTimeout(0);
        sock.on('data', d => this._onData(d));
        sock.on('error', () => this._flushPending(new Error('RCON socket error.')));
        sock.on('close', () => { this.connected = false; this._flushPending(new Error('RCON connection closed.')); });
        try {
          const id = this._send(TYPE.AUTH, this.password);
          const resp = await this._await(id);
          if (resp.id === -1) return fail(new Error('RCON authentication failed (wrong password).'));
          this.connected = true; settled = true; resolve(true);
        } catch (e) { fail(e); }
      });
    });
  }

  _send(type, body) {
    const id = this._nextId++;
    const pkt = encodePacket(id, type, body);
    this.socket.write(pkt);
    return id;
  }

  _await(id) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this._pending.delete(id); reject(new Error('RCON request timed out.')); }, this.timeoutMs);
      this._pending.set(id, { resolve, reject, timer });
    });
  }

  _onData(chunk) {
    this._buf = Buffer.concat([this._buf, chunk]);
    let off = 0, pkt;
    while ((pkt = decodePacket(this._buf, off))) {
      off += pkt.size;
      // Auth failure: the server answers with id -1 (not the request id), so no pending promise
      // is keyed to it. Reject every in-flight request with a clear auth error.
      if (pkt.id === -1) { this._flushPending(new Error('RCON authentication failed (wrong password).')); continue; }
      const p = this._pending.get(pkt.id);
      if (p) { clearTimeout(p.timer); this._pending.delete(pkt.id); p.resolve(pkt); }
    }
    if (off > 0) this._buf = this._buf.slice(off);
  }

  _flushPending(err) { for (const [, p] of this._pending) { clearTimeout(p.timer); p.reject(err); } this._pending.clear(); }

  // Send a console command and resolve its text response. Multiple response packets are NOT
  // reassembled (Minecraft sends one); a larger multi-packet response is out of scope for now.
  async exec(command) {
    if (!this.connected) throw new Error('RCON is not connected.');
    const id = this._send(TYPE.COMMAND, command);
    const resp = await this._await(id);
    return resp.body;
  }

  close() {
    this.connected = false;
    this._flushPending(new Error('RCON client closed.'));
    try { if (this.socket) this.socket.destroy(); } catch {}
    this.socket = null;
  }
}

// M6: per-instance credentials. A random port (in a private, non-conflicting range) + a random
// password so RCON is never left with Minecraft's default/blank credentials. bind is 127.0.0.1 only.
const crypto = require('crypto');
function makeRconCreds() {
  const port = 25575 + Math.floor(Math.random() * 425); // 25575..25999
  const password = crypto.randomBytes(16).toString('hex');
  return { port, password };
}

// Ensure server.properties enables RCON with the given port/password. `props` is the parsed
// properties object, `writeProps(next)` persists it. Returns the {port,password} actually used
// (existing values win so a user's own RCON config is never overwritten). Pure-ish: no I/O here.
function desiredRconProps(props, existingPort, existingPassword) {
  props = props || {};
  const curPort = Number(props['rcon.port']);
  const curPass = String(props['rcon.password'] || '');
  let port = Number.isInteger(curPort) && curPort > 0 ? curPort : (Number(existingPort) || 0);
  let password = curPass || String(existingPassword || '');
  if (!port) { const c = makeRconCreds(); port = c.port; }
  if (!password) password = makeRconCreds().password;
  const next = {
    'enable-rcon': 'true',
    'rcon.port': String(port),
    'rcon.password': password,
  };
  return { port, password, next };
}

module.exports = { TYPE, encodePacket, decodePacket, RconClient, makeRconCreds, desiredRconProps };
