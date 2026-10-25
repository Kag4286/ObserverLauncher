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
  return { jar: null, launchScript: null, target: { mc: null, loader: 'unknown', software: 'unknown' }, plugins: [], mods: [], datapacks: [], datapackFolder: null, worlds: [], backups: [], knownPlayers: [], whitelist: [], banned: [], ops: [], hasSpigotConfig: false, properties: {}, geyser: false };
}
// server.properties is read by Java's java.util.Properties, which decodes a backslash escape
// before the game ever sees the value. The most common one by far is \uXXXX, used for the
// section sign that carries the MOTD's colour codes: the file holds the six ASCII characters
// "\u00a7" and the server shows a coloured "§".
//
// The launcher used to read the file line by line, so it showed the raw escape text in the
// properties grid and the MOTD preview rendered the literal "\u00a7" instead of the colours the
// player actually sees. These two helpers are the exact inverse of each other and follow Java's
// rules, so a value read, edited and written back keeps its meaning.
//
// PURE (no I/O) so they are unit-tested directly.
const PROPS_ESCAPES = { n: '\n', r: '\r', t: '\t', f: '\f' };
function decodePropertiesValue(raw) {
  const s = String(raw == null ? '' : raw);
  if (s.indexOf('\\') < 0) return s;
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c !== '\\') { out += c; continue; }
    const n = s[++i];
    if (n === undefined) break;               // a trailing backslash: Java drops it
    if (n === 'u') {
      // \uXXXX, exactly four hex digits. Java reads a malformed one as a literal 'u'.
      const hex = s.slice(i + 1, i + 5);
      if (/^[0-9a-fA-F]{4}$/.test(hex)) { out += String.fromCharCode(parseInt(hex, 16)); i += 4; continue; }
      out += 'u';
      continue;
    }
    if (n in PROPS_ESCAPES) { out += PROPS_ESCAPES[n]; continue; }
    out += n;                                  // \\ \= \: \# \! and \x -> x
  }
  return out;
}
function encodePropertiesValue(value) {
  const s = String(value == null ? '' : value);
  let out = '';
  for (const c of s) {
    if (c === '\\') { out += '\\\\'; continue; }
    if (c === '\n') { out += '\\n'; continue; }
    if (c === '\r') { out += '\\r'; continue; }
    if (c === '\t') { out += '\\t'; continue; }
    if (c === '\f') { out += '\\f'; continue; }
    // Anything above printable ASCII goes out as \uXXXX. server.properties is read as
    // ISO-8859-1, so a raw UTF-8 byte would be read as two garbage characters.
    if (c.charCodeAt(0) > 0x7e) { out += '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'); continue; }
    out += c;
  }
  return out;
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
  // The values are decoded the way Java's Properties would, so the grid and the MOTD preview
  // show what the server actually gets (a colour-coded MOTD, not the escape text).
  try { for (const line of fs.readFileSync(path.join(root, 'server.properties'), 'utf8').split(/\r?\n/)) { const i = line.indexOf('='); if (i > 0 && !line.startsWith('#')) properties[line.slice(0, i)] = decodePropertiesValue(line.slice(i + 1)); } } catch {}
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
  // CB1 (v3.3.0): an unzipped datapack is a DIRECTORY in <level-name>/datapacks. The old filter
  // matched only .zip/.jar, so a folder datapack was invisible to the GUI + MCP. Include folders
  // too (plugins/mods are always jars, so they are left alone).
  // CB6 (v3.3.0): a DISABLED content file is <name>.jar.disabled — it must still be listed (else
  // it becomes invisible and can never be re-enabled). The `(\.disabled)?` keeps disabled entries
  // in the same arrays; consumers can tell them apart by the suffix.
  const datapackEntries = [
    ...fileNames(datapackFolder).filter(x => /\.(zip|jar)(\.disabled)?$/i.test(x)),
    ...dirNames(datapackFolder),
  ];
  const plugins = fileNames('plugins').filter(x => /\.jar(\.disabled)?$/i.test(x));
  const mods = fileNames('mods').filter(x => /\.jar(\.disabled)?$/i.test(x));
  // v5.7.0 GEYSER: GeyserMC (Bedrock <-> Java) lets Bedrock players join a Java server. It ships
  // as a plugin (plugins/Geyser-Spigot.jar) or a mod (mods/geyser-neoforge-*.jar); Floodgate is
  // its companion for auth. Either name present (enabled OR .disabled) marks the server as a
  // Bedrock-crossplay candidate, which the Overview surfaces with UDP-tunnel guidance.
  const geyser = [...plugins, ...mods].some(x => /(^|\/)geyser|floodgate/i.test(x));
  let target = { mc: null, loader: 'unknown', software: 'unknown' };
  try {
    const { detectServerTarget } = require('./server-compat.js');
    const dt = detectServerTarget(root, { jar, launchScript, hasSpigotConfig });
    let soft = dt.loader;
    const name = String(jar || launchScript || '').toLowerCase();
    if (/purpur/.test(name)) soft = 'purpur';
    else if (/leaf/.test(name)) soft = 'leaf';
    else if (/folia/.test(name)) soft = 'folia';
    else if (/paper/.test(name)) soft = 'paper';
    else if (/spigot/.test(name) || hasSpigotConfig) soft = 'spigot';
    else if (/velocity|bungee|waterfall/.test(name)) soft = 'velocity';
    target = { mc: dt.mc || null, loader: dt.loader || 'unknown', software: soft || dt.loader || 'unknown' };
  } catch {}
  return { jar, launchScript, target, plugins, mods, datapacks: datapackEntries, datapackFolder, worlds, backups, knownPlayers, whitelist, banned, ops, hasSpigotConfig, properties, geyser };
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
      // The value arrives DECODED (the grid showed the real character), so it has to be encoded
      // back on the way out. Otherwise a MOTD the user edited with a real "§" would be written
      // as UTF-8 and read back as two garbage characters by the server.
      return `${key}=${encodePropertiesValue(value)}`;
    }
    return line;
  });
  if (outLines.length && outLines[outLines.length - 1] === '') outLines.pop(); // avoid a growing blank tail from the trailing-newline split
  for (const [key, value] of remaining) outLines.push(`${key}=${encodePropertiesValue(value)}`);
  return outLines.join(eol) + eol;
}
// BUGFIX (item count showing as undefined): 1.21.5+ / 26.x item stacks use
// lowercase `count`; pre-1.20.5 files used `Count`. Normalize both here.
//
// 1.20.5 moved item NBT into a `components` compound; older files keep it under `tag`. Both are
// read so durability / enchantments / the anvil name show up on every server version.
// Vanilla max durability. Only OVERRIDDEN values are stored in the item itself, so a plain
// undamaged sword has no `damage` field and the bar must be derived from the id.
// Armor and tools are deliberately SEPARATE tables: one shared `diamond` key collides (528 for a
// chestplate vs 1561 for a sword) and the later literal would silently win, showing every
// diamond chestplate as a 1561-durability bar.
const ARMOR_MAX = {
  // index order: helmet, chestplate, leggings, boots
  leather: [55, 80, 75, 65], chainmail: [165, 240, 225, 195], iron: [165, 240, 225, 195],
  golden: [77, 112, 105, 91], diamond: [363, 528, 495, 429], netherite: [407, 592, 555, 481],
  copper: [121, 176, 165, 143],
};
const TOOL_MAX = {
  // every sword / pickaxe / axe / shovel / hoe of a material shares one value
  wooden: 59, stone: 131, copper: 190, iron: 250, golden: 32, diamond: 1561, netherite: 2031,
};
const MISC_MAX = {
  bow: 384, crossbow: 465, trident: 250, elytra: 432, shield: 336, fishing_rod: 64, shears: 238,
  flint_and_steel: 64, mace: 500, carrot_on_a_stick: 25, warped_fungus_on_a_stick: 100,
  brush: 64, wolf_armor: 64, turtle_helmet: 275,
};
const ARMOR_ORDER = ['helmet', 'chestplate', 'leggings', 'boots'];
const TOOL_ORDER = ['sword', 'pickaxe', 'axe', 'shovel', 'hoe'];
function maxDamageFor(id) {
  const path = String(id || '').split(':').pop();
  if (MISC_MAX[path] !== undefined) return MISC_MAX[path];
  const [mat, kind] = path.split('_');
  if (!kind) return undefined;
  if (TOOL_ORDER.includes(kind) && TOOL_MAX[mat] !== undefined) return TOOL_MAX[mat];
  if (ARMOR_ORDER.includes(kind) && ARMOR_MAX[mat]) return ARMOR_MAX[mat][ARMOR_ORDER.indexOf(kind)];
  return undefined;
}
// A text component is either a plain string or a {text, extra[], translate} tree. Some writers
// serialize the whole component as a JSON string, so parse that first. The inspector shows the
// rendered name, so walk the tree rather than dumping raw JSON at the user.
function textOf(value) {
  if (value == null) return undefined;
  if (typeof value === 'string') {
    const s = value.trim();
    if (s.startsWith('{') || s.startsWith('[')) { try { return textOf(JSON.parse(s)); } catch { /* plain text */ } }
    return s || undefined;
  }
  if (Array.isArray(value)) return value.map(textOf).filter(Boolean).join('') || undefined;
  if (typeof value !== 'object') return String(value);
  let out = typeof value.text === 'string' ? value.text : (typeof value.translate === 'string' ? value.translate : '');
  if (Array.isArray(value.extra)) out += value.extra.map(textOf).filter(Boolean).join('');
  return out || undefined;
}
const LEGACY_ENCHANT_IDS = {
  0: 'protection', 1: 'fire_protection', 2: 'feather_falling', 3: 'blast_protection', 4: 'projectile_protection',
  5: 'respiration', 6: 'aqua_affinity', 7: 'thorns', 8: 'depth_strider', 9: 'frost_walker', 10: 'binding_curse',
  16: 'sharpness', 17: 'smite', 18: 'bane_of_arthropods', 19: 'knockback', 20: 'fire_aspect', 21: 'looting', 22: 'sweeping',
  32: 'efficiency', 33: 'silk_touch', 34: 'unbreaking', 35: 'fortune',
  48: 'power', 49: 'punch', 50: 'flame', 51: 'infinity',
  61: 'luck_of_the_sea', 62: 'lure', 65: 'loyalty', 66: 'impaling', 67: 'riptide', 68: 'channeling',
  70: 'mending', 71: 'vanishing_curse',
  52: 'multishot', 53: 'quick_charge', 54: 'piercing',
};
const LEGACY_ITEM_IDS = {
  1: 'stone', 2: 'grass_block', 3: 'dirt', 4: 'cobblestone', 5: 'oak_planks', 7: 'bedrock', 12: 'sand', 13: 'gravel',
  14: 'gold_ore', 15: 'iron_ore', 16: 'coal_ore', 17: 'oak_log', 18: 'oak_leaves', 19: 'sponge', 20: 'glass',
  35: 'white_wool', 41: 'gold_block', 42: 'iron_block', 46: 'tnt', 47: 'bookshelf', 48: 'mossy_cobblestone',
  49: 'obsidian', 50: 'torch', 54: 'chest', 56: 'diamond_ore', 57: 'diamond_block', 58: 'crafting_table', 61: 'furnace',
  256: 'iron_shovel', 257: 'iron_pickaxe', 258: 'iron_axe', 259: 'flint_and_steel', 260: 'apple', 261: 'bow', 262: 'arrow',
  263: 'coal', 264: 'diamond', 265: 'iron_ingot', 266: 'gold_ingot', 267: 'iron_sword', 268: 'wooden_sword', 269: 'wooden_shovel',
  270: 'wooden_pickaxe', 271: 'wooden_axe', 272: 'stone_sword', 273: 'stone_shovel', 274: 'stone_pickaxe', 275: 'stone_axe',
  276: 'diamond_sword', 277: 'diamond_shovel', 278: 'diamond_pickaxe', 279: 'diamond_axe', 280: 'stick', 281: 'bowl',
  282: 'mushroom_stew', 283: 'golden_sword', 284: 'golden_shovel', 285: 'golden_pickaxe', 286: 'golden_axe', 287: 'string',
  288: 'feather', 289: 'gunpowder', 290: 'wooden_hoe', 291: 'stone_hoe', 292: 'iron_hoe', 293: 'diamond_hoe', 294: 'golden_hoe',
  295: 'wheat_seeds', 296: 'wheat', 297: 'bread', 298: 'leather_helmet', 299: 'leather_chestplate', 300: 'leather_leggings',
  301: 'leather_boots', 302: 'chainmail_helmet', 303: 'chainmail_chestplate', 304: 'chainmail_leggings', 305: 'chainmail_boots',
  306: 'iron_helmet', 307: 'iron_chestplate', 308: 'iron_leggings', 309: 'iron_boots', 310: 'diamond_helmet', 311: 'diamond_chestplate',
  312: 'diamond_leggings', 313: 'diamond_boots', 314: 'golden_helmet', 315: 'golden_chestplate', 316: 'golden_leggings', 317: 'golden_boots',
  318: 'flint', 319: 'porkchop', 320: 'cooked_porkchop', 322: 'golden_apple', 325: 'bucket', 326: 'water_bucket', 327: 'lava_bucket',
  331: 'redstone', 332: 'snowball', 339: 'paper', 340: 'book', 341: 'slime_ball', 344: 'egg', 345: 'compass', 346: 'fishing_rod',
  347: 'clock', 348: 'glowstone_dust', 349: 'cod', 350: 'cooked_cod', 351: 'dye', 352: 'bone', 353: 'sugar', 357: 'cookie',
  364: 'cooked_beef', 365: 'chicken', 366: 'cooked_chicken', 367: 'rotten_flesh', 368: 'ender_pearl', 369: 'blaze_rod',
  370: 'ghast_tear', 371: 'gold_nugget', 372: 'nether_wart', 373: 'potion', 374: 'glass_bottle', 375: 'spider_eye',
  376: 'fermented_spider_eye', 377: 'blaze_powder', 378: 'magma_cream', 381: 'ender_eye', 382: 'glistering_melon_slice',
  384: 'experience_bottle', 385: 'fire_charge', 388: 'emerald', 391: 'carrot', 392: 'potato', 393: 'baked_potato',
  394: 'poisonous_potato', 395: 'map', 396: 'golden_carrot', 397: 'skeleton_skull', 398: 'carrot_on_a_stick', 399: 'nether_star',
  400: 'pumpkin_pie', 401: 'firework_rocket', 402: 'firework_star', 403: 'enchanted_book', 420: 'lead', 421: 'name_tag',
  442: 'shield', 443: 'elytra', 449: 'totem_of_undying', 450: 'shulker_shell', 452: 'iron_nugget', 453: 'knowledge_book',
};
function enchantmentsOf(components, tag, newKey, oldKey) {
  const out = [];
  const push = (id, lvl) => {
    if (id === undefined || id === null) return;
    let sId = String(id);
    if (typeof id === 'number' || /^\d+$/.test(sId)) {
      const mapped = LEGACY_ENCHANT_IDS[Number(id)];
      sId = mapped ? `minecraft:${mapped}` : `minecraft:enchantment_${id}`;
    } else if (!sId.includes(':')) {
      sId = `minecraft:${sId}`;
    }
    out.push({ id: sId, level: Number(lvl) || 1 });
  };
  const modern = components && components[newKey];
  if (modern && typeof modern === 'object') {
    const levels = modern.levels && typeof modern.levels === 'object' ? modern.levels : modern;
    for (const [id, lvl] of Object.entries(levels)) if (typeof lvl === 'number') push(id, lvl);
  }
  const legacyList = (tag && (tag[oldKey] || (oldKey === 'Enchantments' ? (tag.ench || tag.enchantments) : (oldKey === 'StoredEnchantments' ? tag.stored_enchantments : null)))) || [];
  for (const e of legacyList) {
    if (e && (e.id !== undefined || e.Id !== undefined)) {
      push(e.id ?? e.Id, e.lvl ?? e.level ?? e.Lvl ?? 1);
    }
  }
  return out;
}
function stackOf(item) {
  if (!item || typeof item !== 'object') return { id: item?.id, count: item?.count ?? item?.Count ?? 1 };
  let rawId = item.id;
  if (typeof rawId === 'number' || (typeof rawId === 'string' && /^\d+$/.test(rawId))) {
    rawId = LEGACY_ITEM_IDS[Number(rawId)] ? `minecraft:${LEGACY_ITEM_IDS[Number(rawId)]}` : `minecraft:item_${rawId}`;
  }
  const out = { id: rawId, count: item.count ?? item.Count ?? 1 };
  const components = item.components || {};
  const tag = item.tag || {};
  const max = components['minecraft:max_damage'] ?? tag.MaxDamage ?? tag.maxDamage ?? maxDamageFor(out.id);
  const damage = components['minecraft:damage'] ?? tag.Damage ?? tag.damage;
  if (typeof damage === 'number' && damage > 0 && typeof max === 'number' && max > 0) {
    out.durability = { remaining: Math.max(0, max - damage), max };
  }
  const enchants = enchantmentsOf(components, tag, 'minecraft:enchantments', 'Enchantments');
  if (enchants.length) out.enchantments = enchants;
  const stored = enchantmentsOf(components, tag, 'minecraft:stored_enchantments', 'StoredEnchantments');
  if (stored.length) out.storedEnchantments = stored;
  const custom = textOf(components['minecraft:custom_name']) ?? textOf(tag.display && tag.display.Name);
  if (custom) out.customName = custom;
  return out;
}
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
    const offhandItem = raw.find(x => x.Slot === -106 || x.Slot === 150 || x.Slot === 40);
    offhand = offhandItem ? stackOf(offhandItem) : null;
  }
  const enderChest = (simple.EnderItems || simple.ender_items || []).map(x => ({ slot: x.Slot, ...stackOf(x) }));
  // v4.0.0: active potion/status effects live in the NBT `active_effects` list (Id / Amplifier / Duration).
  const effects = (simple.active_effects || simple.ActiveEffects || []).map(e => ({
    name: e.Id ?? e.id ?? e.Name ?? 'unknown',
    amplifier: e.Amplifier ?? e.amplifier ?? 0,
    duration: e.Duration ?? e.duration ?? 0,
  }));
  // v4.0.0: per-player statistics live in <world>/stats/<uuid>.json (a Minecraft stats JSON keyed by
  // category, e.g. minecraft:custom -> { minecraft:deaths: N }). Read defensively; missing -> {}.
  let stats = {};
  try {
    const statsFile = path.join(path.dirname(file), '..', 'stats', `${path.basename(file).replace(/\.dat$/, '')}.json`);
    if (fs.existsSync(statsFile)) stats = JSON.parse(fs.readFileSync(statsFile, 'utf8')) || {};
  } catch { stats = {}; }
  let dim = simple.Dimension ?? 'minecraft:overworld';
  if (dim === 0 || dim === '0') dim = 'minecraft:overworld';
  else if (dim === -1 || dim === '-1') dim = 'minecraft:the_nether';
  else if (dim === 1 || dim === '1') dim = 'minecraft:the_end';
  return { file, parsed, type: parsed.type, data: { health: simple.Health ?? null, food: simple.foodLevel ?? null, saturation: simple.foodSaturationLevel ?? null, xpLevel: simple.XpLevel ?? 0, xpTotal: simple.XpTotal ?? 0, gameType: simple.playerGameType ?? 0, dimension: dim, pos: simple.Pos || [], inventory: mainInventory, armor, offhand, enderChest, effects, stats } };
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
module.exports = { serverFiles, emptyServerFiles, detectSoftware, readEula, writeEula, buildPropertiesContent, findPlayerDataFile, readPlayerData, parseServerLine, stackOf, maxDamageFor, decodePropertiesValue, encodePropertiesValue };
