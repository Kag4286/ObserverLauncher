const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const nbt = require('prismarine-nbt');
const { readJsonList } = require('./fs-utils.js');

// Per-`live` state for the spark two-line (header -> values) parsing. WeakMap so it never leaks
// and is scoped to each instance's live object.
const _sparkPending = new WeakMap();

// FEATURE: servers running online-mode=false (very common for local/test hosting) save playerdata
// under an "offline" UUID derived from the player's name — NOT the online UUID stored in
// usercache.json. This reproduces Minecraft's own algorithm (UUID v3, name-based, MD5 of
// "OfflinePlayer:<name>") so the inspector can still find the .dat file in that case.
function offlineUUID(name) {
  const hash = crypto.createHash('md5').update(`OfflinePlayer:${name}`, 'utf8').digest();
  hash[6] = (hash[6] & 0x0f) | 0x30; hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function findPlayerDataFile(root, properties, uuid, name) {
  const ids = [String(uuid), String(uuid).replace(/-/g, '')];
  if (name) { const off = offlineUUID(name); ids.push(off, off.replace(/-/g, '')); }
  let worldDirs = [];
  try { worldDirs = fs.readdirSync(root, { withFileTypes: true }).filter(x => x.isDirectory()).map(x => x.name); } catch {}
  const names = [properties?.['level-name'] || 'world', 'world', ...worldDirs];
  const uniqueWorlds = [...new Set(names)];
  // BUGFIX (confirmed against a real Minecraft 26.2 server): the classic playerdata folder is
  // <world>/playerdata/<uuid>.dat, but newer Minecraft versions (26.x) moved it to
  // <world>/players/data/<uuid>.dat. Both are tried so this works on old and new servers alike.
  const subpaths = [['playerdata'], ['players', 'data']];
  for (const world of uniqueWorlds) for (const sub of subpaths) for (const id of ids) {
    const file = path.join(root, world, ...sub, `${id}.dat`);
    if (fs.existsSync(file)) return file;
  }
  findPlayerDataFile.lastSearch = { worlds: uniqueWorlds, ids, subpaths: subpaths.map(s => s.join('/')) };
  return null;
}
function emptyServerFiles() {
  return { jar: null, launchScript: null, plugins: [], mods: [], datapacks: [], datapackFolder: null, worlds: [], backups: [], knownPlayers: [], whitelist: [], banned: [], ops: [], hasSpigotConfig: false, properties: {} };
}
function serverFiles(root) {
  if (!root || !fs.existsSync(root)) return emptyServerFiles();
  const list = p => fs.existsSync(p) ? fs.readdirSync(p, { withFileTypes: true }) : [];
  const names = list(root).filter(x => x.isFile() && /\.jar$/i.test(x.name)).map(x => x.name);
  const runnable = names.filter(x => !/(installer|universal|shim|buildtools)/i.test(x)); const launchScript = list(root).find(x => x.isFile() && /^run\.(bat|sh)$/i.test(x.name))?.name || null;
  const jar = runnable.find(x => /spigot/i.test(x)) || runnable.find(x => /(purpur|paper|leaf|folia|velocity|craftbukkit|forge|fabric|server)/i.test(x)) || runnable[0] || null;
  const fileNames = folder => list(path.join(root, folder)).filter(x => x.isFile()).map(x => x.name);
  const dirNames = folder => list(path.join(root, folder)).filter(x => x.isDirectory()).map(x => x.name);
  let properties = {};
  try { for (const line of fs.readFileSync(path.join(root, 'server.properties'), 'utf8').split(/\r?\n/)) { const i = line.indexOf('='); if (i > 0 && !line.startsWith('#')) properties[line.slice(0, i)] = line.slice(i + 1); } } catch {}
  let knownPlayers = [];
  try { const cache = JSON.parse(fs.readFileSync(path.join(root, 'usercache.json'), 'utf8')); knownPlayers = cache.map(x => ({ name: x.name, uuid: x.uuid, hasData: !!findPlayerDataFile(root, properties, x.uuid, x.name) })).filter(x => x.name); } catch {}
  const hasSpigotConfig = fs.existsSync(path.join(root, 'spigot.yml')) || fs.existsSync(path.join(root, 'bukkit.yml'));
  // FEATURE: read whitelist/banned-players/ops so the Players tab can categorize Online/Offline/Whitelisted/Banned.
  const whitelist = readJsonList(root, 'whitelist.json');
  const banned = readJsonList(root, 'banned-players.json');
  const ops = readJsonList(root, 'ops.json');
  const levelName = properties['level-name'] || 'world';
  const allDirs = dirNames('');
  // BUGFIX: previously only recognized a world folder named exactly "world" (or *_nether/*_the_end),
  // so changing level-name in server.properties broke world/datapack/backup detection. Now it
  // prioritizes the actual level-name plus its _nether/_the_end variants, while still keeping the
  // default world/world_nether/world_the_end cases so nothing gets missed.
  const worldCandidates = new Set([
    levelName, `${levelName}_nether`, `${levelName}_the_end`,
    'world', 'world_nether', 'world_the_end',
  ]);
  // BUGFIX: the suffix branch used to be `/regex/.test(x) && allDirs.includes(x)` — includes() was
  // always true inside a filter over allDirs itself, so ANY folder ending in _nether/_the_end counted
  // as a world. The redundant condition is gone; candidates from level-name stay exact-match.
  const worlds = allDirs.filter(x => worldCandidates.has(x) || /_nether$|_the_end$/i.test(x));
  const datapackFolder = path.join(levelName, 'datapacks');
  const backupNames = fileNames('observerlauncher-backups').filter(x => /\.zip$/i.test(x)).sort().reverse();
  const backups = backupNames.map(name => { try { const st = fs.statSync(path.join(root, 'observerlauncher-backups', name)); return { name, size: st.size, mtime: st.mtimeMs }; } catch { return { name, size: 0, mtime: 0 }; } });
  return { jar, launchScript, plugins: fileNames('plugins').filter(x => /\.jar$/i.test(x)), mods: fileNames('mods').filter(x => /\.jar$/i.test(x)), datapacks: fileNames(datapackFolder).filter(x => /\.(zip|jar)$/i.test(x)), datapackFolder, worlds, backups, knownPlayers, whitelist, banned, ops, hasSpigotConfig, properties };
}
function detectSoftware(info) {
  const name = String(info.jar || info.launchScript || '');
  if (/velocity|bungee|waterfall/i.test(name)) return 'proxy';
  if (/paper|purpur|leaf|folia/i.test(name)) return 'paper-like';
  if (info.hasSpigotConfig) return 'paper-like';
  if (/forge|neoforge/i.test(name) || info.launchScript) return 'forge';
  if (/fabric|quilt/i.test(name)) return 'fabric';
  return 'vanilla';
}
function readEula(root) { try { return /eula\s*=\s*true/i.test(fs.readFileSync(path.join(root, 'eula.txt'), 'utf8')); } catch { return false; } }
function writeEula(root) { fs.writeFileSync(path.join(root, 'eula.txt'), '# Accepted by ObserverLauncher\neula=true\n'); }
// BUGFIX: properties:save used to rebuild server.properties from scratch using ONLY the keys the UI
// grid knows about (Object.entries(props).map(([k,v]) => `${k}=${v}`).join(...)) — any property NOT
// in that fixed list (a value added by a plugin, a custom line, comments, blank-line formatting) was
// silently dropped on every save. This edits the ORIGINAL file text in place: known keys get their
// value swapped, every other line (comments, unrecognized keys, blank lines, ordering) is left
// untouched, and only keys that don't exist in the file yet are appended at the end. Returns just the
// new text — writing it out (atomically) is the caller's job.
function buildPropertiesContent(root, props) {
  let original = ''; try { original = fs.readFileSync(path.join(root, 'server.properties'), 'utf8'); } catch {}
  const eol = original.includes('\r\n') ? '\r\n' : '\n';
  const lines = original.length ? original.split(/\r?\n/) : [];
  // SECURITY: server.properties is line-based, so a key or value containing a newline would inject
  // extra config lines, and a __proto__/constructor key is a prototype-pollution vector. Drop any
  // such entry here (the one choke point shared by the IPC grid AND the MCP set_property tool).
  const safeProps = {};
  for (const [k, v] of Object.entries(props || {})) {
    const key = String(k), val = String(v == null ? '' : v);
    if (!/^[A-Za-z0-9._-]+$/.test(key)) continue;
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    if (/[\r\n]/.test(val)) continue;
    safeProps[key] = val;
  }
  const remaining = new Map(Object.entries(safeProps));
  const outLines = lines.map(line => {
    const i = line.indexOf('=');
    if (i > 0 && !line.startsWith('#') && remaining.has(line.slice(0, i))) {
      const key = line.slice(0, i), value = remaining.get(key); remaining.delete(key);
      return `${key}=${value}`;
    }
    return line;
  });
  if (outLines.length && outLines[outLines.length - 1] === '') outLines.pop(); // avoid a growing blank tail from the trailing-newline split
  for (const [key, value] of remaining) outLines.push(`${key}=${value}`);
  return outLines.join(eol) + eol;
}
// BUGFIX (item count showing as undefined): 1.21.5+ / 26.x item stacks use
// lowercase `count`; pre-1.20.5 files used `Count`. Normalize both here.
function stackOf(item) { return { id: item.id, count: item.count ?? item.Count ?? 1 }; }
async function readPlayerData(root, uuid, name) {
  if (!root) throw new Error('No server folder is selected.');
  const files = serverFiles(root);
  // Name can be supplied directly (lookup by name) or resolved from usercache when we have a uuid.
  const knownName = name || files?.knownPlayers?.find(p => String(p.uuid) === String(uuid))?.name;
  const file = findPlayerDataFile(root, files.properties, uuid, knownName);
  if (!file) {
    // FEATURE: online and offline (name-derived) UUIDs are both tried above via offlineUUID() —
    // this only fires when neither matched a .dat file on disk. Shows exactly what was searched
    // so a "not found" is diagnosable at a glance instead of a generic dead end.
    const onlineMode = files.properties['online-mode'];
    const search = findPlayerDataFile.lastSearch;
    throw new Error(
      `No player data file found for ${knownName || 'this player'}. Checked world folder(s) ` +
      `[${search?.worlds?.join(', ') || '?'}] under [${search?.subpaths?.join(', ') || 'playerdata'}] for UUID(s) [${search?.ids?.join(', ') || uuid}]. ` +
      `Common causes: this player has never joined this world yet (no data saved), the data is in ` +
      `a different server folder, or online-mode was switched` +
      `${onlineMode !== undefined ? ` (currently online-mode=${onlineMode})` : ''} since they last played.`
    );
  }
  const parsed = await nbt.parse(fs.readFileSync(file)); const simple = nbt.simplify(parsed.parsed);
  // FEATURE: previously only read the combined "Inventory" tag (36 main slots + armor + offhand all
  // mixed together) — there was no way to separate worn armor, the offhand slot, or the Ender Chest
  // (which lives in its own NBT tag, "EnderItems").
  //
  // BUGFIX (armor + offhand always showed empty on 1.21.5+/26.x servers): Minecraft 1.21.5 moved
  // players' worn armor and off-hand item OUT of Inventory and into a top-level `equipment`
  // compound keyed by slot name (head/chest/legs/feet/offhand). The old code only looked at the
  // legacy Inventory slots (100-103 armor, -106 offhand), which those versions no longer write, so
  // armor came back empty and offhand null. Read the modern `equipment` tag first, and keep the
  // legacy slot scan as a fallback for older servers. Item stacks also moved from `Count` to
  // lowercase `count` — stackOf() normalizes both.
  const raw = simple.Inventory || [];
  const armorNames = { 100: 'Boots', 101: 'Leggings', 102: 'Chestplate', 103: 'Helmet' };
  const mainInventory = raw.filter(x => x.Slot >= 0 && x.Slot <= 35).map(x => ({ slot: x.Slot, ...stackOf(x) }));
  let armor, offhand;
  if (simple.equipment) {
    const eq = simple.equipment;
    const equipNames = { feet: 'Boots', legs: 'Leggings', chest: 'Chestplate', head: 'Helmet' };
    armor = Object.entries(equipNames)
      .filter(([k]) => eq[k])
      .map(([k, label]) => ({ slot: label, ...stackOf(eq[k]) }))
      .sort((a, b) => Object.values(armorNames).indexOf(a.slot) - Object.values(armorNames).indexOf(b.slot));
    offhand = eq.offhand ? stackOf(eq.offhand) : null;
  } else {
    armor = raw.filter(x => x.Slot in armorNames).map(x => ({ slot: armorNames[x.Slot], ...stackOf(x) })).sort((a, b) => Object.values(armorNames).indexOf(a.slot) - Object.values(armorNames).indexOf(b.slot));
    const offhandItem = raw.find(x => x.Slot === -106); offhand = offhandItem ? stackOf(offhandItem) : null;
  }
  const enderChest = (simple.EnderItems || simple.ender_items || []).map(x => ({ slot: x.Slot, ...stackOf(x) }));
  return { file, parsed, type: parsed.type, data: { health: simple.Health ?? null, food: simple.foodLevel ?? null, saturation: simple.foodSaturationLevel ?? null, xpLevel: simple.XpLevel ?? 0, xpTotal: simple.XpTotal ?? 0, gameType: simple.playerGameType ?? 0, dimension: simple.Dimension ?? 'unknown', pos: simple.Pos || [], inventory: mainInventory, armor, offhand, enderChest } };
}
function parseServerLine(text, live, send) {
  // Strip Minecraft color codes (§a) AND ANSI escape codes (\u001b[31m etc.) that servers/plugins inject.
  const clean = String(text).replace(/§./g, '').replace(/\u001b\[[0-9;]*m/g, '');
  let changed = false;
  const list = clean.match(/There are (\d+) of a max of \d+ players online(?::\s*(.*))?/i);
  if (list) { live.players = list[2] ? list[2].split(',').map(x => x.trim()).filter(Boolean) : []; changed = true; }
  const joined = clean.match(/:\s+([\w.-]+) joined the game/i); if (joined && !live.players.includes(joined[1])) { live.players.push(joined[1]); changed = true; }
  const left = clean.match(/:\s+([\w.-]+) left the game/i); if (left) { const before = live.players.length; live.players = live.players.filter(x => x !== left[1]); if (live.players.length !== before) changed = true; }
  // --- spark (`spark tps`) splits a HEADER and its VALUES across two lines: ---
  //   [..] TPS from last 5s, 10s, 1m, 5m, 15m:
  //   [..] 20.0, *20.0, *20.0, *20.0, *20.0
  //   [..] Tick durations (min/med/95%ile/max ms) from last 10s, 1m:
  //   [..]  3.5/5.9/29.3/146.3;  3.5/5.9/29.3/146.3
  // The single-line patterns below cannot see those, so remember the header and consume the NEXT
  // line. State is keyed per `live` (WeakMap) so multiple instances never cross-contaminate.
  const pend = _sparkPending.get(live) || {};
  const body = clean.replace(/^(\[[^\]]*\]\s*:?\s*)+/, '').trim();
  if (pend.tps) {
    const nums = body.match(/\d+(?:\.\d+)?/g);
    if (nums && nums.length) { const v = Number(nums[0]); if (Number.isFinite(v) && v >= 0 && v <= 25 && v !== live.tps) { live.tps = v; changed = true; } }
    pend.tps = false; _sparkPending.set(live, pend);
    if (changed && typeof send === 'function') send('server:live', live);
    return;
  }
  if (pend.mspt) {
    const m = body.match(/([\d.]+)\/([\d.]+)\/([\d.]+)\/([\d.]+)/);
    if (m) { const v = Number(m[2]); if (Number.isFinite(v) && v >= 0 && v < 10000 && v !== live.mspt) { live.mspt = v; changed = true; } }
    pend.mspt = false; _sparkPending.set(live, pend);
    if (changed && typeof send === 'function') send('server:live', live);
    return;
  }
  // A spark header ends with a colon and has NO numbers after it; flag it and wait one line.
  if (/^TPS from last[^:]*:\s*$/i.test(body)) { pend.tps = true; _sparkPending.set(live, pend); return; }
  if (/^Tick durations[^:]*:\s*$/i.test(body)) { pend.mspt = true; _sparkPending.set(live, pend); return; }
  // Paper/Purpur/Leaf/Folia panel can emit:
  //   TPS from last 5s, 10s, 1m, 5m, 15m: *20.0, 20.0, 20.0, 20.0, 20.0
  //   TPS from last 1m, 5m, 15m: *20.0, 20.0, 20.0
  // Forge/NeoForge "/forge tps" emits:
  //   Dim 0 : Mean tick time: 12.345 ms. Mean TPS: 20.0
  //   Overall: Mean tick time: 12.345 ms. Mean TPS: 20.0
  //   TPS: 20.0 MSPT: 12.3   (combined line on newer Forge)
  const combined = clean.match(/TPS:\s*\*?([\d.]+).*?MSPT:\s*([\d.]+)/i);
  if (combined) {
    const t = Number(combined[1]), m = Number(combined[2]);
    if (Number.isFinite(t) && t !== live.tps) { live.tps = t; changed = true; }
    if (Number.isFinite(m) && m !== live.mspt) { live.mspt = m; changed = true; }
  }
  // Dedicated TPS patterns (skipped if combined already matched to avoid double-fire on same line)
  const tps = combined ? null : (
    clean.match(/Current TPS[^:]*:\s*\*?([\d.]+)/i) ||
    clean.match(/Server TPS[^:]*:\s*\*?([\d.]+)/i) ||
    clean.match(/Mean TPS[^:]*:\s*\*?([\d.]+)/i) ||
    clean.match(/Overall[^:]*Mean TPS[^:]*:\s*\*?([\d.]+)/i) ||
    clean.match(/TPS from last[^:]*:\s*\*?([\d.]+)/i) ||
    clean.match(/TPS[:\s]+\*?([\d.]+)/i) ||
    clean.match(/tps[=:]\s*([\d.]+)/i) ||
    clean.match(/\b(\d{1,2}\.\d{1,2})\s*TPS\b/i)
  );
  if (tps) {
    const v = Number(tps[1]);
    if (Number.isFinite(v) && v >= 0 && v <= 25 && v !== live.tps) { live.tps = v; changed = true; }
  }
  // MSPT patterns — Paper 1.20.2+ "tick query" uses "Average time per tick: Xms (Target: 50.00ms)"
  // Must capture the FIRST ms value (actual), not the Target in parentheses.
  const mspt = combined ? null : (
    clean.match(/Average time per tick:\s*([\d.]+)\s*ms/i) ||
    clean.match(/Actual MSPT[^:]*:\s*([\d.]+)\s*ms/i) ||
    clean.match(/Mean tick time:\s*([\d.]+)\s*ms/i) ||
    clean.match(/Overall[^:]*Mean tick time[^:]*:\s*([\d.]+)\s*ms/i) ||
    clean.match(/MSPT:\s*([\d.]+)\s*ms/i) ||
    clean.match(/tick times?[^:]*:\s*([\d.]+)\s*ms/i) ||
    clean.match(/MSPT[:\s]+\*?([\d.]+)/i) ||
    clean.match(/([\d.]+)\s*ms\/tick/i) ||
    clean.match(/tick:\s*([\d.]+)/i) ||
    clean.match(/Tick durations[^:]*:\s*[\d.]+\/([\d.]+)/i)
  );
  if (mspt) {
    const v = Number(mspt[1]);
    if (Number.isFinite(v) && v >= 0 && v < 10000 && v !== live.mspt) { live.mspt = v; changed = true; }
  }
  if (changed && typeof send === 'function') send('server:live', live);
}
module.exports = { serverFiles, emptyServerFiles, detectSoftware, readEula, writeEula, buildPropertiesContent, findPlayerDataFile, readPlayerData, parseServerLine };
