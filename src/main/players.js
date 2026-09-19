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
const { isSafePlayerName, isSafeReason, isSafeUuid } = require('./validate.js');

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
async function readPlayer(ctx, uuid) {
  if (!isSafeUuid(uuid)) return { ok: false, error: 'Invalid player UUID.' };
  try { return { ok: true, ...(await readPlayerData(ctx.currentServerPath, uuid)) }; }
  catch (error) { return { ok: false, error: error?.message || `Unknown error reading player data for UUID ${uuid}.` }; }
}
async function whitelistToggle(ctx, { uuid, name, add }) {
  if (!ctx.currentServerPath) return { ok: false, error: 'Choose a server folder first.' };
  const bad = checkPlayerInput({ name, uuid });
  if (bad) return { ok: false, error: bad };
  if (ctx.serverProcess) {
    ctx.serverProcess.stdin.write(`whitelist ${add ? 'add' : 'remove'} ${name}\r\n`);
    ctx.appendLog(`> whitelist ${add ? 'add' : 'remove'} ${name}`, 'command');
  } else {
    let list = readJsonList(ctx.currentServerPath, 'whitelist.json').filter(x => x.uuid !== uuid);
    if (add) list.push({ uuid, name });
    writeJsonList(ctx.currentServerPath, 'whitelist.json', list);
  }
  return { ok: true, files: serverFiles(ctx.currentServerPath) };
}
async function banToggle(ctx, { uuid, name, ban, reason }) {
  if (!ctx.currentServerPath) return { ok: false, error: 'Choose a server folder first.' };
  const bad = checkPlayerInput({ name, reason, uuid });
  if (bad) return { ok: false, error: bad };
  if (ctx.serverProcess) {
    const cmd = ban ? `ban ${name} ${reason || ''}`.trim() : `pardon ${name}`;
    ctx.serverProcess.stdin.write(cmd + '\r\n');
    ctx.appendLog(`> ${cmd}`, 'command');
  } else {
    let list = readJsonList(ctx.currentServerPath, 'banned-players.json').filter(x => x.uuid !== uuid);
    if (ban) list.push({ uuid, name, created: new Date().toISOString(), source: 'ObserverLauncher', expires: 'forever', reason: reason || 'Banned by an operator.' });
    writeJsonList(ctx.currentServerPath, 'banned-players.json', list);
  }
  return { ok: true, files: serverFiles(ctx.currentServerPath) };
}
async function opToggle(ctx, { uuid, name, op }) {
  if (!ctx.currentServerPath) return { ok: false, error: 'Choose a server folder first.' };
  const bad = checkPlayerInput({ name, uuid });
  if (bad) return { ok: false, error: bad };
  if (ctx.serverProcess) {
    const cmd = op ? `op ${name}` : `deop ${name}`;
    ctx.serverProcess.stdin.write(cmd + '\r\n');
    ctx.appendLog(`> ${cmd}`, 'command');
  } else {
    let list = readJsonList(ctx.currentServerPath, 'ops.json').filter(x => x.uuid !== uuid);
    if (op) list.push({ uuid, name, level: 4, bypassesPlayerLimit: false });
    writeJsonList(ctx.currentServerPath, 'ops.json', list);
  }
  return { ok: true, files: serverFiles(ctx.currentServerPath) };
}

function registerPlayers(ipcMain, ctx) {
  ipcMain.handle('player:read', async (_, uuid) => readPlayer(ctx, uuid));
  ipcMain.handle('player:whitelist-toggle', async (_, args) => whitelistToggle(ctx, args));
  ipcMain.handle('player:ban-toggle', async (_, args) => banToggle(ctx, args));
  ipcMain.handle('player:op-toggle', async (_, args) => opToggle(ctx, args));

  ipcMain.handle('player:save', async (_, { uuid, changes, clearInventory }) => {
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
      fs.writeFileSync(player.file, zlib.gzipSync(nbt.writeUncompressed(player.parsed.parsed, player.type)));
      return { ok: true, backup: path.basename(backup), data: (await readPlayerData(ctx.currentServerPath, uuid)).data };
    } catch (error) { return marketplaceError(error); }
  });
}

module.exports = { registerPlayers, readPlayer, whitelistToggle, banToggle, opToggle, checkPlayerInput };
