// src/main/horizon-prepare.js — Full automation for Horizon Dedicated Server game resources
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { download, json } = require('./http.js');
const { dataDir } = require('./data-dir.js');

const HORIZON_VERSION = '26.3';
const MANIFEST_URL = 'https://piston-meta.mojang.com/v1/packages/5df1795e16eea19d75b923d66ecca9ce183353c5/26.3.json';

function hasHorizonResources(serverPath) {
  if (!serverPath) return false;
  const p1 = path.join(serverPath, 'resources', 'horizon-resources.json');
  const p2 = path.join(serverPath, '.local', 'horizon-client', HORIZON_VERSION, 'horizon-resources.json');
  try {
    if (fs.existsSync(p1) && fs.statSync(p1).size > 0) return true;
    if (fs.existsSync(p2) && fs.statSync(p2).size > 0) return true;
  } catch {}
  return false;
}

function getHorizonSharedCacheDir() {
  return path.join(dataDir(), 'cache', `horizon-resources-${HORIZON_VERSION}`);
}

function getHorizonMinecraftCacheDir() {
  return path.join(dataDir(), 'cache', 'horizon-minecraft');
}

function findLocalMinecraftDir() {
  const home = os.homedir();
  const candidates = [];
  if (process.platform === 'win32') {
    const appdata = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    candidates.push(
      path.join(appdata, '.minecraft'),
      path.join(appdata, 'ATLauncher'),
      path.join(appdata, 'PrismLauncher'),
      path.join(home, 'curseforge', 'minecraft', 'Install')
    );
  } else if (process.platform === 'darwin') {
    candidates.push(
      path.join(home, 'Library', 'Application Support', 'minecraft'),
      path.join(home, 'Library', 'Application Support', 'ATLauncher'),
      path.join(home, 'Library', 'Application Support', 'PrismLauncher')
    );
  } else {
    candidates.push(
      path.join(home, '.minecraft'),
      path.join(home, '.local', 'share', 'ATLauncher'),
      path.join(home, '.local', 'share', 'PrismLauncher')
    );
  }

  for (const dir of candidates) {
    const verJson = path.join(dir, 'versions', HORIZON_VERSION, `${HORIZON_VERSION}.json`);
    const clientJar = path.join(dir, 'versions', HORIZON_VERSION, `${HORIZON_VERSION}.jar`);
    if (fs.existsSync(verJson) && fs.existsSync(clientJar)) {
      return dir;
    }
  }
  return null;
}

async function downloadMissingGameFiles(mcCacheDir, onProgress) {
  fs.mkdirSync(mcCacheDir, { recursive: true });
  const verDir = path.join(mcCacheDir, 'versions', HORIZON_VERSION);
  fs.mkdirSync(verDir, { recursive: true });

  const manifestPath = path.join(verDir, `${HORIZON_VERSION}.json`);
  let manifest = null;
  if (fs.existsSync(manifestPath)) {
    try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch {}
  }
  if (!manifest) {
    onProgress?.('Fetching Minecraft 26.3 version manifest...');
    manifest = await json(MANIFEST_URL);
    require('./fs-utils.js').writeFileAtomic(manifestPath, JSON.stringify(manifest, null, 2));
  }

  const clientPath = path.join(verDir, `${HORIZON_VERSION}.jar`);
  if (!fs.existsSync(clientPath) || fs.statSync(clientPath).size === 0) {
    onProgress?.('Downloading Minecraft 26.3 client JAR (39 MB)...');
    await download(manifest.downloads.client.url, clientPath, null, null);
  }

  const serverPath = path.join(mcCacheDir, 'server.jar');
  if (!fs.existsSync(serverPath) || fs.statSync(serverPath).size === 0) {
    onProgress?.('Downloading Minecraft 26.3 server JAR (59 MB)...');
    await download(manifest.downloads.server.url, serverPath, null, null);
  }

  const { safeTarget } = require('./fs-utils.js');
  const libDir = path.join(mcCacheDir, 'libraries');
  const libs = (manifest.libraries || []).filter(l => l.downloads && l.downloads.artifact && l.downloads.artifact.path);
  let missing = libs.filter(l => {
    const relPath = l.downloads.artifact.path.replace(/\//g, path.sep);
    const p = safeTarget(libDir, relPath);
    return !p || !fs.existsSync(p) || fs.statSync(p).size === 0;
  });

  if (missing.length > 0) {
    onProgress?.(`Downloading ${missing.length} Minecraft libraries...`);
    let completed = libs.length - missing.length;
    const poolSize = 12;

    async function worker(items) {
      for (const item of items) {
        const relPath = item.downloads.artifact.path.replace(/\//g, path.sep);
        const dest = safeTarget(libDir, relPath);
        if (!dest) continue; // SECURITY (zip-slip/path-traversal): refuse paths escaping libraries root
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        await download(item.downloads.artifact.url, dest, null, null);
        completed++;
        if (completed % 20 === 0 || completed === libs.length) {
          onProgress?.(`Downloading libraries (${completed}/${libs.length})...`);
        }
      }
    }

    const chunks = Array.from({ length: poolSize }, () => []);
    missing.forEach((lib, i) => chunks[i % poolSize].push(lib));
    await Promise.all(chunks.map(chunk => worker(chunk)));
  }

  return { mcDir: mcCacheDir, serverJar: serverPath };
}

function findJava25() {
  // Check portable runtime managed by launcher first (<dataDir>/jre25)
  try {
    const launcherJre = path.join(dataDir(), 'jre25');
    const launcherBin = path.join(launcherJre, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
    if (fs.existsSync(launcherBin)) return launcherJre;
  } catch {}
  if (process.env.JAVA_HOME) {
    const bin = path.join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
    if (fs.existsSync(bin)) return process.env.JAVA_HOME;
  }
  if (process.platform === 'win32') {
    const standard = ['C:\\Program Files\\Java\\jdk-25', 'C:\\Program Files\\Eclipse Adoptium\\jdk-25', 'C:\\Program Files\\Microsoft\\jdk-25'];
    for (const p of standard) {
      if (fs.existsSync(path.join(p, 'bin', 'java.exe'))) return p;
    }
  }
  return null;
}

async function prepareHorizonServer(serverPath, onProgress = null, ctx = null) {
  if (!serverPath || !fs.existsSync(serverPath)) {
    return { ok: false, error: 'Invalid server folder path.' };
  }

  if (hasHorizonResources(serverPath)) {
    return { ok: true, cached: true };
  }

  const sharedCache = getHorizonSharedCacheDir();
  const cacheManifest = path.join(sharedCache, 'horizon-resources.json');
  if (fs.existsSync(cacheManifest)) {
    onProgress?.('Deploying prepared Horizon resources from shared cache...');
    const localTarget = path.join(serverPath, '.local', 'horizon-client', HORIZON_VERSION);
    const resTarget = path.join(serverPath, 'resources');
    fs.mkdirSync(path.dirname(localTarget), { recursive: true });
    fs.cpSync(sharedCache, localTarget, { recursive: true });
    fs.mkdirSync(resTarget, { recursive: true });
    fs.cpSync(sharedCache, resTarget, { recursive: true });
    return { ok: true, fromCache: true };
  }

  const prepareBinName = process.platform === 'win32' ? 'horizon-prepare.exe' : 'horizon-prepare';
  const prepareBin = path.join(serverPath, prepareBinName);
  if (!fs.existsSync(prepareBin)) {
    return { ok: false, error: `horizon-prepare binary not found in "${serverPath}".` };
  }
  if (process.platform !== 'win32') {
    try { fs.chmodSync(prepareBin, 0o755); } catch {}
  }

  // Ensure research-lock.json exists in serverPath
  const lockPath = path.join(serverPath, 'research-lock.json');
  if (!fs.existsSync(lockPath)) {
    try {
      const lockData = await json('https://raw.githubusercontent.com/horizon-rust/horizon/main/research-lock.json');
      require('./fs-utils.js').writeFileAtomic(lockPath, JSON.stringify(lockData, null, 2));
    } catch (e) {
      return { ok: false, error: `Missing research-lock.json: ${e?.message || e}` };
    }
  }

  let mcDir = findLocalMinecraftDir();
  let serverJar = null;

  if (mcDir) {
    onProgress?.(`Found local Minecraft installation at "${mcDir}". Checking server JAR...`);
    const localServer = path.join(serverPath, 'server.jar');
    const cacheServer = path.join(getHorizonMinecraftCacheDir(), 'server.jar');
    if (fs.existsSync(localServer)) {
      serverJar = localServer;
    } else if (fs.existsSync(cacheServer)) {
      serverJar = cacheServer;
    } else {
      onProgress?.('Downloading Minecraft 26.3 server JAR...');
      const cacheDir = getHorizonMinecraftCacheDir();
      fs.mkdirSync(cacheDir, { recursive: true });
      const dl = await downloadMissingGameFiles(cacheDir, onProgress);
      serverJar = dl.serverJar;
    }
  } else {
    onProgress?.('Downloading required Minecraft 26.3 game assets & libraries for Horizon...');
    const cacheDir = getHorizonMinecraftCacheDir();
    const dl = await downloadMissingGameFiles(cacheDir, onProgress);
    mcDir = dl.mcDir;
    serverJar = dl.serverJar;
  }

  const javaHome = findJava25();
  const env = { ...process.env };
  if (javaHome) env.JAVA_HOME = javaHome;

  onProgress?.('Running horizon-prepare to compile game definitions & parity models...');
  if (ctx && typeof ctx.appendLog === 'function') {
    ctx.appendLog('Starting horizon-prepare to generate resources from Minecraft 26.3...', 'system');
  }

  const args = [
    '--prepare',
    '--minecraft-dir', mcDir,
    '--server-jar', serverJar,
    '--root', serverPath,
  ];

  const exitCode = await new Promise((resolve) => {
    const proc = spawn(prepareBin, args, { cwd: serverPath, env });
    proc.stdout.on('data', d => {
      const line = d.toString().trim();
      if (line) {
        onProgress?.(line);
        if (ctx && typeof ctx.appendLog === 'function') ctx.appendLog(line, 'system');
      }
    });
    proc.stderr.on('data', d => {
      const line = d.toString().trim();
      if (line) {
        if (ctx && typeof ctx.appendLog === 'function') ctx.appendLog(line, 'stderr');
      }
    });
    proc.on('close', code => resolve(code));
    proc.on('error', err => {
      if (ctx && typeof ctx.appendLog === 'function') ctx.appendLog(`horizon-prepare error: ${err.message}`, 'stderr');
      resolve(1);
    });
  });

  if (exitCode !== 0 && !hasHorizonResources(serverPath)) {
    return { ok: false, error: `horizon-prepare failed with exit code ${exitCode}. Check logs for details.` };
  }

  // Populate shared cache and root resources/
  const generatedDir = path.join(serverPath, '.local', 'horizon-client', HORIZON_VERSION);
  const rootResDir = path.join(serverPath, 'resources');
  if (fs.existsSync(generatedDir)) {
    try {
      fs.mkdirSync(sharedCache, { recursive: true });
      fs.cpSync(generatedDir, sharedCache, { recursive: true });
      fs.mkdirSync(rootResDir, { recursive: true });
      fs.cpSync(generatedDir, rootResDir, { recursive: true });
    } catch {}
  }

  onProgress?.('Horizon game files prepared successfully.');
  return { ok: true };
}

module.exports = {
  hasHorizonResources,
  getHorizonSharedCacheDir,
  getHorizonMinecraftCacheDir,
  findLocalMinecraftDir,
  downloadMissingGameFiles,
  prepareHorizonServer,
  HORIZON_VERSION,
};

