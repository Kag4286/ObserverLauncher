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
        // 2.2.0 (option 1a): the newest version often only has ALPHA/BETA builds, so "Latest" must
        // resolve to the newest STABLE build, not versions[0]. Return per-version stability for the
        // picker (status) AND a stable `latest` so the default download always works.
        const { listFillVersionsWithStatus, resolveStableVersion } = require('./adapters/papermc.js');
        const v = await listFillVersions(s);
        let status = [];
        let stableLatest = null;
        try {
          status = await listFillVersionsWithStatus(s);
          stableLatest = status.find(x => x.stable)?.version || null;
          if (!stableLatest) { const r = await resolveStableVersion(s); stableLatest = r?.version || null; }
        } catch {}
        return { ok: true, versions: v, latest: stableLatest || v[0] || null, stableLatest, status, raw: false };
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
        // 2.2.0 FIX: the maven <latest> is frequently a -beta (NeoForge's is), and the list spans
        // EVERY MC version (1700+ entries), so "Latest" could install a beta for the wrong MC and
        // the installer would fail. Prefer the newest NON-prerelease; annotate each entry with its
        // MC version + stable flag so the version step can group/filter. A prerelease is any tag
        // with a hyphen (e.g. 26.3.0.16-beta).
        const all = [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map(m => m[1]).reverse(); // newest first
        // Pure helpers (src/main/forge-versions.js) so the MC-label mapping is unit-tested.
        const { isPrerelease, annotateVersions } = require('./forge-versions.js');
        const latest = all.find(v => !isPrerelease(v)) || all[0] || null;
        const versions = annotateVersions(all);
        return { ok: true, versions: all, latest, raw: true, annotated: versions };
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

  ipcMain.handle('wizard:create', async (_, args) => {
    const { software, version } = args || {};
    // 2.2.0 CRITICAL: the renderer passes the TARGET instance id explicitly. The IPC proxy pins
    // ALS to whatever activeInstanceId was at dispatch time, which after a fresh Add-instance can
    // still be the PREVIOUS instance - so the folder check/download would otherwise run against the
    // wrong server (the reported 'wizard sees another server's purpur.jar' bug). Run explicitly in
    // the caller's instance.
    const runId = (args && args.instance) ? String(args.instance) : ctx.inst();
    return await ctx.runInInstance(runId, async () => {
    try {
      if (ctx.serverProcess) return { ok: false, error: 'Stop the current server before using the wizard.' };
      if (ctx.buildProcess) return { ok: false, error: 'A build is already running for this folder — check the Console tab for progress.' };
      // DEFENSE (2.2.0): always resolve the folder from THIS instance's own settings, not just
      // ctx.currentServerPath. That accessor is per-instance, but if any earlier handler left it
      // stale we would otherwise check/download into the WRONG instance's folder (the reported
      // 'wizard sees another server's purpur.jar'). loadSettings() is the ACTIVE instance's flat
      // view, and this handler already runs inside runInInstance(ctx.inst()).
      let targetPath = ctx.currentServerPath;
      try { const s = require('./settings.js').loadSettingsFor(ctx.inst()); if (s && s.serverPath) targetPath = s.serverPath; } catch {}
      if (!targetPath) return { ok: false, error: 'Choose and apply an empty server folder first.' };
      ctx.currentServerPath = targetPath;
      fs.mkdirSync(targetPath, { recursive: true });
      const contents = fs.readdirSync(ctx.currentServerPath);
      // BUGFIX (2.2.0): a Forge/NeoForge INSTALLER jar (neoforge-<ver>-installer.jar) left behind by
      // a previous failed/retried install is NOT a server jar. The old check matched any '.jar', so
      // retrying in a folder that only holds the leftover installer wrongly failed with 'already
      // contains a server jar'. Ignore installer jars here.
      const serverJar = contents.find(x => /\.jar$/i.test(x) && !/-installer\.jar$/i.test(x));
      if (serverJar) return { ok: false, error: `This folder already contains a server jar (${serverJar}). Choose an empty folder to avoid overwriting it.` };
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
  });

  // Cancel a wizard download in progress (the AbortController created in wizard:create).
  ipcMain.handle('wizard:cancel', async () => {
    if (ctx.wizardAbort) { try { ctx.wizardAbort.abort(); } catch {} return { ok: true }; }
    return { ok: false, error: 'No wizard download is running.' };
  });
}

module.exports = { RESOLVERS, registerWizard };
