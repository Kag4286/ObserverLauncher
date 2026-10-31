// src/main/world-ops.js — Safe world operations (v7.0.0Z Track 2).
// Owns: rename world, edit display seed, purge dimension with backup, clone world.
const fs = require('fs');
const path = require('path');
const nbt = require('prismarine-nbt');
const { writeFileAtomic } = require('./fs-utils.js');
const { saveLevelAtomic, backupLevelDat, findLevelDat } = require('./gamerules.js');
const { serverFiles } = require('./server-files.js');

async function readAndBackupLevelDat(filePath) {
  backupLevelDat(filePath);
  const raw = fs.readFileSync(filePath);
  return await nbt.parse(raw);
}

function sanitizeWorldName(name) {
  if (typeof name !== 'string') return null;
  const s = name.trim();
  if (!s || s.length > 64 || s.includes('..') || /[\\/]/.test(s)) return null;
  return /^[a-zA-Z0-9_\- ]+$/.test(s) ? s : null;
}

function parseBigIntSeed(raw) {
  if (typeof raw === 'bigint') return raw;
  const s = String(raw || '').trim();
  if (/^-?\d+$/.test(s)) {
    try { return BigInt(s); } catch {}
  }
  // String hash fallback if not a plain integer
  let h = 0n;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31n + BigInt(s.charCodeAt(i))) & 0xFFFFFFFFFFFFFFFFn;
  }
  return (h > 0x7FFFFFFFFFFFFFFFn) ? h - 0x10000000000000000n : h;
}

async function renameWorld(root, currentName, newName) {
  if (!root) return { ok: false, error: 'No server directory specified.' };
  const safeCurr = sanitizeWorldName(currentName);
  const safeNew = sanitizeWorldName(newName);
  if (!safeCurr) return { ok: false, error: 'Invalid current world name.' };
  if (!safeNew) return { ok: false, error: 'Invalid new world name. Use 1-64 alphanumeric characters, spaces, dashes or underscores.' };

  const srcDir = path.join(root, safeCurr);
  const dstDir = path.join(root, safeNew);
  if (!fs.existsSync(srcDir)) return { ok: false, error: `World folder "${safeCurr}" does not exist.` };
  if (fs.existsSync(dstDir) && safeCurr.toLowerCase() !== safeNew.toLowerCase()) {
    return { ok: false, error: `Destination world folder "${safeNew}" already exists.` };
  }

  // 1. Update level.dat LevelName if level.dat exists
  const levelDatPath = findLevelDat(root, safeCurr);
  if (levelDatPath && fs.existsSync(levelDatPath)) {
    try {
      const parsed = await readAndBackupLevelDat(levelDatPath);
      const dataTag = parsed.parsed.value?.Data?.value;
      if (dataTag) {
        dataTag.LevelName = { type: 'string', value: safeNew };
        saveLevelAtomic({
          file: levelDatPath,
          rootTag: parsed.parsed,
          isGzip: parsed.type === 'gzip'
        });
      }
    } catch (e) {
      return { ok: false, error: 'Failed to update LevelName in level.dat: ' + (e?.message || e) };
    }
  }

  // 2. Rename main folder
  try {
    fs.renameSync(srcDir, dstDir);
  } catch (e) {
    return { ok: false, error: 'Failed to rename world directory: ' + (e?.message || e) };
  }

  // 3. Rename Paper/Spigot separate dimension folders if they exist
  for (const suffix of ['_nether', '_the_end']) {
    const oldDim = path.join(root, safeCurr + suffix);
    const newDim = path.join(root, safeNew + suffix);
    if (fs.existsSync(oldDim) && !fs.existsSync(newDim)) {
      try { fs.renameSync(oldDim, newDim); } catch {}
    }
  }

  // 4. Update server.properties level-name
  try {
    const propsPath = path.join(root, 'server.properties');
    if (fs.existsSync(propsPath)) {
      let content = fs.readFileSync(propsPath, 'utf8');
      if (/^level-name=.*/m.test(content)) {
        content = content.replace(/^level-name=.*/m, `level-name=${safeNew}`);
      } else {
        content += `\r\nlevel-name=${safeNew}`;
      }
      writeFileAtomic(propsPath, content);
    }
  } catch {}

  // 5. Update server.toml if horizon native server
  try {
    const tomlPath = path.join(root, 'server.toml');
    if (fs.existsSync(tomlPath)) {
      let toml = fs.readFileSync(tomlPath, 'utf8');
      if (/^\s*level_name\s*=.*/m.test(toml)) {
        toml = toml.replace(/^\s*level_name\s*=.*/m, `level_name = "${safeNew}"`);
        writeFileAtomic(tomlPath, toml);
      }
    }
  } catch {}

  return { ok: true, oldName: safeCurr, newName: safeNew, files: serverFiles(root) };
}

async function setWorldSeed(root, worldName, newSeedInput) {
  if (!root) return { ok: false, error: 'No server directory specified.' };
  const safeName = sanitizeWorldName(worldName) || 'world';
  const levelDatPath = findLevelDat(root, safeName);
  if (!levelDatPath || !fs.existsSync(levelDatPath)) {
    return { ok: false, error: `level.dat not found for world "${safeName}".` };
  }

  const seedBigInt = parseBigIntSeed(newSeedInput);
  try {
    const parsed = await readAndBackupLevelDat(levelDatPath);
    const dataTag = parsed.parsed.value?.Data?.value;
    if (!dataTag) return { ok: false, error: 'Invalid level.dat NBT structure.' };

    // Update RandomSeed
    dataTag.RandomSeed = { type: 'long', value: seedBigInt };

    // Update WorldGenSettings.seed if modern 1.16+
    if (dataTag.WorldGenSettings?.value) {
      dataTag.WorldGenSettings.value.seed = { type: 'long', value: seedBigInt };
    }

    const saveRes = saveLevelAtomic({
      file: levelDatPath,
      rootTag: parsed.parsed,
      isGzip: parsed.type === 'gzip'
    });
    if (!saveRes.ok) return saveRes;

    return { ok: true, seed: seedBigInt.toString() };
  } catch (e) {
    return { ok: false, error: 'Failed to update world seed: ' + (e?.message || e) };
  }
}

function resolveDimensionFolders(root, worldName, dim) {
  const safeName = sanitizeWorldName(worldName) || 'world';
  const dirs = [];
  const base = path.join(root, safeName);

  if (dim === 'nether') {
    dirs.push(path.join(base, 'DIM-1'));
    dirs.push(path.join(root, `${safeName}_nether`));
    dirs.push(path.join(base, 'dimensions', 'minecraft', 'the_nether'));
  } else if (dim === 'end') {
    dirs.push(path.join(base, 'DIM1'));
    dirs.push(path.join(root, `${safeName}_the_end`));
    dirs.push(path.join(base, 'dimensions', 'minecraft', 'the_end'));
  }
  return dirs.filter(d => fs.existsSync(d));
}

async function deleteDimension(root, worldName, dim) {
  if (!root) return { ok: false, error: 'No server directory specified.' };
  if (dim !== 'nether' && dim !== 'end') return { ok: false, error: 'Dimension must be "nether" or "end".' };
  const targets = resolveDimensionFolders(root, worldName, dim);
  if (!targets.length) {
    return { ok: false, error: `No dimension folder found for ${dim}.` };
  }

  // Backup dimension folder before deletion
  const backupsDir = path.join(root, 'backups');
  try { fs.mkdirSync(backupsDir, { recursive: true }); } catch {}
  const backupBase = path.join(backupsDir, `dim_backup_${dim}_${Date.now()}`);

  try {
    for (let i = 0; i < targets.length; i++) {
      const target = targets[i];
      const dest = targets.length > 1 ? `${backupBase}_${i}` : backupBase;
      fs.cpSync(target, dest, { recursive: true });
      fs.rmSync(target, { recursive: true, force: true });
    }
    return { ok: true, deleted: targets.map(t => path.basename(t)), backup: backupBase };
  } catch (e) {
    return { ok: false, error: 'Failed during dimension purge: ' + (e?.message || e) };
  }
}

async function cloneWorld(sourceRoot, worldName, targetRoot, targetWorldName) {
  if (!sourceRoot || !targetRoot) return { ok: false, error: 'Both source and target root are required.' };
  const safeSrc = sanitizeWorldName(worldName);
  const safeDst = sanitizeWorldName(targetWorldName) || safeSrc;
  if (!safeSrc) return { ok: false, error: 'Invalid source world name.' };
  if (!safeDst) return { ok: false, error: 'Invalid destination world name.' };

  const srcDir = path.join(sourceRoot, safeSrc);
  const dstDir = path.join(targetRoot, safeDst);
  if (!fs.existsSync(srcDir)) return { ok: false, error: `Source world "${safeSrc}" does not exist.` };
  if (fs.existsSync(dstDir)) return { ok: false, error: `Destination world "${safeDst}" already exists.` };

  try {
    fs.cpSync(srcDir, dstDir, { recursive: true });
    // Also copy Paper nether and end if present
    for (const suffix of ['_nether', '_the_end']) {
      const srcDim = path.join(sourceRoot, safeSrc + suffix);
      const dstDim = path.join(targetRoot, safeDst + suffix);
      if (fs.existsSync(srcDim) && !fs.existsSync(dstDim)) {
        try { fs.cpSync(srcDim, dstDim, { recursive: true }); } catch {}
      }
    }
    return { ok: true, clonedWorld: safeDst };
  } catch (e) {
    return { ok: false, error: 'Failed to copy world: ' + (e?.message || e) };
  }
}

module.exports = {
  sanitizeWorldName,
  parseBigIntSeed,
  renameWorld,
  setWorldSeed,
  deleteDimension,
  cloneWorld,
};

