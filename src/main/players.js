// Player management handlers (extracted from main.js — behaviour unchanged).
//
// Owns: player:read/save, whitelist/ban/op toggles (online via console
// command, offline via direct JSON edit on disk).
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const nbt = require('prismarine-nbt');
const { serverFiles, readPlayerData } = require('./server-files.js');
const { readJsonList, writeJsonList, safeTarget } = require('./fs-utils.js');
const { marketplaceError } = require('./http.js');
const { isSafePlayerName, isSafeReason, isSafeUuid, isSafeIp } = require('./validate.js');

// WARNING FIX: serverProcess can exit between the `if (ctx.serverProcess)` check and the write,
// and a pipe that just closed makes stdin.write throw — which rejected the IPC and left the UI
// with no toast. Returns false instead so the caller can surface a clear message.
function writeCmd(ctx, cmd) {
  try {
    if (!ctx.serverProcess || !ctx.serverProcess.stdin || !ctx.serverProcess.stdin.writable) return false;
    ctx.serverProcess.stdin.write(cmd + '\r\n');
    ctx.appendLog(`> ${cmd}`, 'command');
    return true;
  } catch { return false; }
}
function checkPlayerInput({ name, reason, uuid }) {
  // SECURITY (console injection): names are interpolated into stdin commands
  // (`whitelist add ${name}`, `ban ${name} ...`). A name like `Notch\nstop`
  // would execute a second command. Enforce Java-username shape up front.
  if (!isSafePlayerName(name)) return 'Invalid player name — use 3-16 letters, numbers or underscores.';
  if (reason !== undefined && !isSafeReason(reason)) return 'Invalid reason — must be under 200 characters with no line breaks.';
  // SECURITY (path traversal): uuid is joined into <world>/playerdata/<uuid>.dat. Manual
  // actions send null (no known uuid yet); any real uuid must be a plain UUID.
  if (uuid !== null && uuid !== undefined && !isSafeUuid(uuid)) return 'Invalid player UUID.';
  return null;
}

// ---- Pure player actions (shared by the IPC handlers AND the MCP tools) ----
// Extracted so src/mcp/tools.js reuses the exact same validated logic.
async function readPlayer(ctx, uuid, name) {
  // Accept a UUID, or a name (resolved to the offline UUID on disk). Need at least one.
  const hasUuid = isSafeUuid(uuid);
  const hasName = typeof name === 'string' && name.length >= 1 && name.length <= 16;
  if (!hasUuid && !hasName) return { ok: false, error: 'Provide a valid player UUID or a name.' };
  if (uuid && !hasUuid) return { ok: false, error: 'Invalid player UUID.' };
  try { return { ok: true, ...(await readPlayerData(ctx.currentServerPath, hasUuid ? uuid : null, hasName ? name : undefined)) }; }
  catch (error) { return { ok: false, error: error?.message || `Unknown error reading player data.` }; }
}
async function whitelistToggle(ctx, { uuid, name, add }) {
  if (!ctx.currentServerPath) return { ok: false, error: 'Choose a server folder first.' };
  const bad = checkPlayerInput({ name, uuid });
  if (bad) return { ok: false, error: bad };
  if (ctx.serverProcess) {
    if (!writeCmd(ctx, `whitelist ${add ? 'add' : 'remove'} ${name}`)) return { ok: false, error: 'The server just stopped — could not send the command.' };
  } else {
    let list = readJsonList(ctx.currentServerPath, 'whitelist.json').filter(x => x.uuid !== uuid);
    if (add) list.push({ uuid, name });
    writeJsonList(ctx.currentServerPath, 'whitelist.json', list);
  }
  return { ok: true, files: serverFiles(ctx.currentServerPath) };
}
async function banToggle(ctx, { uuid, name, ban, reason, ip }) {
  if (!ctx.currentServerPath) return { ok: false, error: 'Choose a server folder first.' };
  const byIp = !!(ip && String(ip).trim());
  // SECURITY: an IP is interpolated into `ban-ip ${ip}` — validate it (name path is validated too).
  if (byIp && !isSafeIp(String(ip).trim())) return { ok: false, error: 'Invalid IP address.' };
  // IP ban: name is just a label (often blank), so only validate the reason + the IP (done above).
  const bad = byIp ? (isSafeReason(reason) ? null : 'Invalid reason — must be under 200 characters with no line breaks.') : checkPlayerInput({ name, reason, uuid });
  if (bad) return { ok: false, error: bad };
  if (ctx.serverProcess) {
    let cmd;
    if (byIp) cmd = ban ? `ban-ip ${String(ip).trim()}${reason ? ' ' + reason : ''}` : `pardon-ip ${String(ip).trim()}`;
    else cmd = ban ? `ban ${name} ${reason || ''}`.trim() : `pardon ${name}`;
    if (!writeCmd(ctx, cmd)) return { ok: false, error: 'The server just stopped — could not send the command.' };
  } else if (byIp) {
    // Offline IP ban: edit banned-ips.json directly (same shape the server writes).
    let list = readJsonList(ctx.currentServerPath, 'banned-ips.json').filter(x => x.ip !== String(ip).trim());
    if (ban) list.push({ ip: String(ip).trim(), created: new Date().toISOString(), source: 'ObserverLauncher', expires: 'forever', reason: reason || 'Banned by an operator.' });
    writeJsonList(ctx.currentServerPath, 'banned-ips.json', list);
  } else {
    let list = readJsonList(ctx.currentServerPath, 'banned-players.json').filter(x => x.uuid !== uuid);
    if (ban) list.push({ uuid, name, created: new Date().toISOString(), source: 'ObserverLauncher', expires: 'forever', reason: reason || 'Banned by an operator.' });
    writeJsonList(ctx.currentServerPath, 'banned-players.json', list);
  }
  return { ok: true, files: serverFiles(ctx.currentServerPath) };
}
async function opToggle(ctx, { uuid, name, op, level }) {
  if (!ctx.currentServerPath) return { ok: false, error: 'Choose a server folder first.' };
  const bad = checkPlayerInput({ name, uuid });
  if (bad) return { ok: false, error: bad };
  // Permission level 1-4 (4 = full op). Default 4 for backward compatibility.
  const lvl = (level === undefined || level === null) ? 4 : Number(level);
  if (op && (!Number.isInteger(lvl) || lvl < 1 || lvl > 4)) return { ok: false, error: 'Operator level must be 1-4.' };
  if (ctx.serverProcess) {
    // NOTE: vanilla `/op <name>` always grants level 4 — the server has no level argument online.
    const cmd = op ? `op ${name}` : `deop ${name}`;
    if (!writeCmd(ctx, cmd)) return { ok: false, error: 'The server just stopped — could not send the command.' };
  } else {
    let list = readJsonList(ctx.currentServerPath, 'ops.json').filter(x => x.uuid !== uuid);
    if (op) list.push({ uuid, name, level: lvl, bypassesPlayerLimit: false });
    writeJsonList(ctx.currentServerPath, 'ops.json', list);
  }
  return { ok: true, files: serverFiles(ctx.currentServerPath) };
}

function registerPlayers(ipcMain, ctx) {
  ipcMain.handle('player:read', async (_, uuid) => readPlayer(ctx, uuid));
  ipcMain.handle('player:whitelist-toggle', async (_, args) => whitelistToggle(ctx, args));
  ipcMain.handle('player:ban-toggle', async (_, args) => banToggle(ctx, args));
  ipcMain.handle('player:op-toggle', async (_, args) => opToggle(ctx, args));

  ipcMain.handle('player:save', async (_, args) => savePlayer(ctx, args));
}

// Pure: apply validated edits to a player's .dat (backup first). Shared by IPC + MCP.
async function savePlayer(ctx, { uuid, changes, clearInventory }) {
    try {
      if (ctx.serverProcess) return { ok: false, error: 'Stop the server before editing player data.' };
      // SECURITY: uuid is joined into the player .dat path — reject non-UUID input up front.
      if (!isSafeUuid(uuid)) return { ok: false, error: 'Invalid player UUID.' };
      const clampedFields = [['health', 0, 20], ['food', 0, 20], ['saturation', 0, 20], ['xpLevel', 0, 2000000000], ['xpTotal', 0, 2000000000]];
      const v = {};
      for (const [key, min, max] of clampedFields) {
        const raw = changes[key];
        if (raw === undefined || raw === null || raw === '') continue;
        const n = Number(raw);
        if (!Number.isFinite(n)) return { ok: false, error: `"${raw}" is not a valid number for ${key}.` };
        if (n < min || n > max) return { ok: false, error: `${key} must be between ${min} and ${max} (got ${n}).` };
        v[key] = n;
      }
      if (changes.gameType !== undefined && changes.gameType !== null && changes.gameType !== '') {
        const gt = Number(changes.gameType);
        if (!Number.isInteger(gt) || gt < 0 || gt > 3) return { ok: false, error: 'Game mode must be 0 (Survival), 1 (Creative), 2 (Adventure), or 3 (Spectator).' };
        v.gameType = gt;
      }
      const player = await readPlayerData(ctx.currentServerPath, uuid);
      const root = player.parsed.parsed.value;
      const set = (key, type, value) => { if (value !== undefined) root[key] = { type, value }; };
      set('Health', 'float', v.health);
      set('foodLevel', 'int', v.food);
      set('foodSaturationLevel', 'float', v.saturation);
      set('XpLevel', 'int', v.xpLevel);
      set('XpTotal', 'int', v.xpTotal);
      set('playerGameType', 'int', v.gameType);
      // BUGFIX: on 1.21.5+/26.x servers the worn armor and off-hand item live in the
      // top-level `equipment` compound, NOT in Inventory — so clearing only Inventory
      // left armor + offhand untouched (the button's label promised otherwise).
      // Clear `equipment` too when it exists; legacy files simply don't have the tag.
      if (clearInventory) {
        root.Inventory = { type: 'list', value: { type: 'compound', value: [] } };
        if (root.equipment) root.equipment = { type: 'compound', value: {} };
      }
      const backupDir = safeTarget(ctx.currentServerPath, 'observerlauncher-backups');
      fs.mkdirSync(backupDir, { recursive: true });
      const backup = path.join(backupDir, `playerdata-${uuid}-${new Date().toISOString().replace(/[:.]/g, '-')}.dat`);
      fs.copyFileSync(player.file, backup);
      // ATOMIC: a plain writeFileSync can leave a truncated .dat if the app is killed mid-write —
      // the file being written is the one that breaks. writeFileAtomic writes a temp then renames.
      const { writeFileAtomic } = require('./fs-utils.js');
      writeFileAtomic(player.file, zlib.gzipSync(nbt.writeUncompressed(player.parsed.parsed, player.type)));
      return { ok: true, backup: path.basename(backup), data: (await readPlayerData(ctx.currentServerPath, uuid)).data };
    } catch (error) { return marketplaceError(error); }
}

module.exports = { registerPlayers, readPlayer, whitelistToggle, banToggle, opToggle, savePlayer, checkPlayerInput };
