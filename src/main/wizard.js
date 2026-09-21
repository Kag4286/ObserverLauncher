// Create-server wizard handlers (extracted from main.js — behaviour unchanged).
//
// Owns: wizard:versions/java-check/create. Forge/NeoForge run their installer,
// Spigot compiles via BuildTools (long-lived buildProcess tracked on ctx),
// everything else resolves through a per-software adapter then downloads.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { serverFiles } = require('./server-files.js');
const { json, download, marketplaceError, withTimeout } = require('./http.js');
const { requiredJavaForJar } = require('./java.js');
const { downloadFillProject, listFillVersions } = require('./adapters/papermc.js');
const mojang = require('./adapters/mojang.js');

const RESOLVERS = {
  vanilla: (v) => require('./adapters/vanilla.js').resolve(v),
  paper: (v) => downloadFillProject('paper', v),
  folia: (v) => downloadFillProject('folia', v),
  velocity: (v) => downloadFillProject('velocity', v),
  fabric: (v) => require('./adapters/fabric.js').resolve(v),
  purpur: (v) => require('./adapters/purpur.js').resolve(v),
  leaf: (v) => require('./adapters/leaf.js').resolve(v),
};

function registerWizard(ipcMain, ctx) {
  ipcMain.handle('wizard:versions', async (_, software) => {
    try {
      const s = String(software || 'vanilla');
      if (s === 'vanilla') {
        const m = await json('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json');
        const v = m.versions.filter(x => x.version_type === 'release').map(x => x.id);
        return { ok: true, versions: v, latest: v[0] || null, raw: false };
      }
      if (s === 'paper' || s === 'folia' || s === 'velocity') {
        const v = await listFillVersions(s);
        return { ok: true, versions: v, latest: v[0] || null, raw: false };
      }
      if (s === 'purpur') {
        const p = await json('https://api.purpurmc.org/v2/purpur');
        const v = [...(p.versions || [])].reverse();
        return { ok: true, versions: v, latest: v[0] || null, raw: false };
      }
      if (s === 'leaf') {
        const p = await json('https://api.leafmc.one/v2/projects/leaf');
        const v = [...(p.versions || [])].reverse();
        return { ok: true, versions: v, latest: v[0] || null, raw: false };
      }
      if (s === 'fabric') {
        const g = await json('https://meta.fabricmc.net/v2/versions/game');
        const v = g.filter(x => x.stable).map(x => x.version);
        return { ok: true, versions: v, latest: v[0] || null, raw: false };
      }
      if (s === 'forge' || s === 'neoforge') {
        const maven = s === 'neoforge' ? 'https://maven.neoforged.net/releases/net/neoforged/neoforge' : 'https://maven.minecraftforge.net/net/minecraftforge/forge';
        const { signal, cancel } = withTimeout(15000);
        const xml = await (await fetch(`${maven}/maven-metadata.xml`, { signal }).finally(cancel)).text();
        const latest = xml.match(/<latest>([^<]+)<\/latest>/)?.[1] || null;
        const all = [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map(m => m[1]).reverse();
        return { ok: true, versions: all, latest, raw: true };
      }
      if (s === 'spigot') {
        const m = await json('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json');
        const v = m.versions.filter(x => x.version_type === 'release').map(x => x.id);
        return { ok: true, versions: v, latest: 'latest', raw: false, note: 'BuildTools accepts any release Mojang publishes — very old ones may fail to compile.' };
      }
      return { ok: false, error: `Unknown software "${s}".` };
    } catch (error) { return { ok: false, error: error?.message || 'Could not load the version list.' }; }
  });

  ipcMain.handle('wizard:java-check', async (_, { software, version }) => {
    try {
      const v = String(version || '').trim();
      if (!v || v === 'latest') return { ok: true, source: 'none', java: null, exact: false };
      let mcId = v;
      if (software === 'forge' || software === 'neoforge') {
        const forgeStyle = v.match(/^(1\.\d{1,2}(?:\.\d{1,2})?)-/);
        if (forgeStyle) mcId = forgeStyle[1];
        else {
          const major = v.match(/^(\d{2})\./);
          mcId = major ? `1.${major[1]}` : null;
        }
      }
      if (mcId) {
        const java = await mojang.javaVersionFor(mcId);
        if (java) return { ok: true, source: 'mojang', java, exact: mcId === v, mcId };
      }
      return { ok: true, source: 'mapping', java: requiredJavaForJar(mcId || v), exact: false };
    } catch (error) { return { ok: false, error: error?.message || 'Could not verify the Java requirement.' }; }
  });

  ipcMain.handle('wizard:create', async (_, { software, version }) => {
    try {
      if (ctx.serverProcess) return { ok: false, error: 'Stop the current server before using the wizard.' };
      if (ctx.buildProcess) return { ok: false, error: 'A build is already running for this folder — check the Console tab for progress.' };
      if (!ctx.currentServerPath) return { ok: false, error: 'Choose and apply an empty server folder first.' };
      fs.mkdirSync(ctx.currentServerPath, { recursive: true });
      const contents = fs.readdirSync(ctx.currentServerPath);
      if (contents.some(x => /\.jar$/i.test(x))) return { ok: false, error: 'This folder already contains a server jar. Choose an empty folder to avoid overwriting it.' };
      const targetVersion = version?.trim();
      const onProgress = (received, total) => ctx.send('wizard:progress', { received, total });
      // Cancellation: a single AbortController per wizard run; wizard:cancel aborts it.
      ctx.wizardAbort = new AbortController();
      const signal = ctx.wizardAbort.signal;

      if (software === 'forge' || software === 'neoforge') {
        const r = await require('./adapters/forge.js').install({ software, version: targetVersion, javaInfo: ctx.javaInfo, serverPath: ctx.currentServerPath, onProgress });
        return { ok: true, files: serverFiles(ctx.currentServerPath), name: r.name, version: r.version };
      }

      if (software === 'spigot') {
        if (!ctx.javaInfo?.ok) throw new Error('Java is required to run BuildTools. Set a valid Java path first.');
        const gitOk = await new Promise(res => require('child_process').execFile('git', ['--version'], { windowsHide: true }, (e) => res(!e)));
        if (!gitOk) throw new Error('Git is not installed or not on PATH — BuildTools needs Git to compile Spigot. Install Git from https://git-scm.com and try again.');
        // BuildTools COMPILES Spigot, so it needs a full JDK (javac), not just the JRE that runs
        // a server. Catch this here instead of failing minutes into the build.
        const javacOk = await new Promise(res => require('child_process').execFile(ctx.javaInfo.path.replace(/java(\.exe)?$/i, 'javac$1'), ['-version'], { windowsHide: true }, (e) => res(!e)));
        if (!javacOk) throw new Error('Spigot\'s BuildTools needs a full JDK (javac), but only a JRE was found. Install a JDK (e.g. Temurin or OpenJDK) and point Settings > Java at its bin folder, then try again.');
        const resolvedVersion = targetVersion || 'latest';
        await require('./adapters/spigot.js').fetchBuildTools(ctx.currentServerPath, onProgress);
        ctx.appendLog(`BuildTools started for Spigot ${resolvedVersion} — this compiles from source and can take several minutes. Requires Git to be installed.`, 'system');
        ctx.buildProcess = spawn(ctx.javaInfo.path, require('./adapters/spigot.js').spawnArgs(resolvedVersion), { cwd: ctx.currentServerPath, windowsHide: true });
        ctx.buildProcess.stdout.on('data', d => d.toString().split(/\r?\n/).filter(Boolean).forEach(x => ctx.appendLog(x, 'system')));
        ctx.buildProcess.stderr.on('data', d => d.toString().split(/\r?\n/).filter(Boolean).forEach(x => ctx.appendLog(x, 'system')));
        ctx.buildProcess.on('exit', code => {
          ctx.buildProcess = null;
          if (code === 0) ctx.appendLog('BuildTools finished — the Spigot server jar is ready in this folder.', 'system');
          else ctx.appendLog(`BuildTools exited with code ${code} — the Spigot build failed. Scroll up in this log for the real error (missing Git is the most common cause).`, 'error');
          ctx.send('wizard:build-done', { ok: code === 0, files: serverFiles(ctx.currentServerPath) });
        });
        ctx.buildProcess.on('error', error => {
          ctx.buildProcess = null;
          ctx.appendLog(`BuildTools could not be started: ${error.message}`, 'error');
          ctx.send('wizard:build-done', { ok: false, files: serverFiles(ctx.currentServerPath) });
        });
        return { ok: true, building: true, name: 'BuildTools (Spigot)', version: resolvedVersion };
      }

      const resolver = RESOLVERS[software] || RESOLVERS.purpur;
      const { url, name, version: resolvedVersion, sha256 } = await resolver(targetVersion);
      const dest = path.join(ctx.currentServerPath, name);
      // Server software jars (vanilla/paper/purpur/leaf/fabric) are tens of MB; 1 GB is a generous
      // ceiling that still stops a hostile/redirected URL from filling the disk.
      await download(url, dest, onProgress, signal, { maxBytes: 1024 * 1024 * 1024 });
      if (sha256) {
        try {
          const got = crypto.createHash('sha256').update(fs.readFileSync(dest)).digest('hex');
          if (got !== String(sha256).toLowerCase()) { fs.rmSync(dest, { force: true }); throw new Error(`Downloaded ${name} failed its SHA-256 checksum and was deleted — check your connection and retry.`); }
        } catch (e) { if (String(e?.message || '').includes('checksum')) throw e; }
      }
      return { ok: true, files: serverFiles(ctx.currentServerPath), name, version: resolvedVersion };
    } catch (error) { ctx.buildProcess = null; return marketplaceError(error); }
    finally { ctx.wizardAbort = null; }
  });

  // Cancel a wizard download in progress (the AbortController created in wizard:create).
  ipcMain.handle('wizard:cancel', async () => {
    if (ctx.wizardAbort) { try { ctx.wizardAbort.abort(); } catch {} return { ok: true }; }
    return { ok: false, error: 'No wizard download is running.' };
  });
}

module.exports = { RESOLVERS, registerWizard };
