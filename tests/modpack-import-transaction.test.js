// The CurseForge modpack import was best-effort: the download loop had no transaction and no
// try/catch, so a download that failed on file 20 of 25 left the first 19 jars in mods/ with no
// way back. The .mrpack path was already transactional, which made the two paths drift.
//
// Three things are pinned here:
//   1. a failure part-way through rolls every installed file back out of the server folder
//   2. a successful import records a manifest entry for every file
//   3. the manifest is written only AFTER the transaction commits, so a rollback cannot leave
//      entries pointing at files that were deleted
//
// The network, the CurseForge API and the Electron dialog are all mocked; nothing leaves the
// machine and a temp folder stands in for the server.
const Module = require('module');
const fs = require('fs');
const os = require('os');
const path = require('path');

let pass = 0, fail = 0;
const check = (name, cond, detail) => cond ? (pass++, console.log('PASS', name)) : (fail++, console.log('FAIL', name + (detail ? ' -> ' + detail : '')));

// --- mocks -----------------------------------------------------------------
let failOn = null;          // 1-based index of the file whose download fails
let downloaded = [];
const realHttp = require('../src/main/http.js');
const realCf = require('../src/main/curseforge.js');

const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  const from = parent && parent.filename ? parent.filename : '';
  if (request === 'electron') {
    return {
      app: { getPath: () => path.join(os.tmpdir(), 'ob-cf-tx-userdata') },
      dialog: { showMessageBox: async () => ({ response: 1 }) },  // "Overwrite" / "Install anyway"
      BrowserWindow: { getAllWindows: () => [] },
    };
  }
  if (request === './http.js' && from.endsWith('modpacks.js')) {
    return {
      ...realHttp,
      download: async (url, dest, onProgress) => {
        downloaded.push(path.basename(dest));
        onProgress && onProgress(1, 1);
        if (failOn && downloaded.length === failOn) throw new Error('Simulated download failure');
        fs.writeFileSync(dest, 'jar-bytes');
        return 1;
      },
    };
  }
  if (request === './curseforge.js' && from.endsWith('modpacks.js')) {
    return {
      ...realCf,
      resolveCfFileIds: async () => ([
        { id: 1, modId: 11, fileName: 'alpha.jar', downloadUrl: 'https://media.example/alpha.jar' },
        { id: 2, modId: 12, fileName: 'beta.jar', downloadUrl: 'https://media.example/beta.jar' },
        { id: 3, modId: 13, fileName: 'gamma.jar', downloadUrl: 'https://media.example/gamma.jar' },
      ]),
    };
  }
  if (request === './settings.js' && from.endsWith('modpacks.js')) {
    return { loadSettings: () => ({ curseforgeApiKey: 'test-key' }) };
  }
  return origLoad.apply(this, arguments);
};

const modpacks = require('../src/main/modpacks.js');

const MANIFEST = 'observerlauncher-manifest.json';
const manifestOf = root => {
  try { return JSON.parse(fs.readFileSync(path.join(root, MANIFEST), 'utf8')); } catch { return []; }
};
// A jar can land in mods/ (mod loaders) or plugins/ (Paper/Spigot). The test asserts on the
// folder the pack actually targeted, so it has to be the right one.
const folderOf = root => {
  for (const f of ['mods', 'plugins']) if (fs.existsSync(path.join(root, f))) return f;
  return null;
};
const jarsIn = root => {
  const f = folderOf(root);
  if (!f) return [];
  try { return fs.readdirSync(path.join(root, f)).sort(); } catch { return []; }
};
const modsIn = root => {
  try { return fs.readdirSync(path.join(root, 'mods')).sort(); } catch { return []; }
};
const makeServer = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-cf-tx-'));
  fs.mkdirSync(path.join(root, 'mods'), { recursive: true });
  fs.writeFileSync(path.join(root, 'server.properties'), 'motd=hello\n');
  return root;
};
// A CurseForge manifest that resolves to three installable jars.
// `loaders` uses the real manifest.json shape: {id, primary}. cfLoaderFromManifest reads
// primary.id, so a bare string would resolve to loader "unknown" and land in plugins/.
const CF_INDEX = {
  name: 'Test Pack', mc: '1.21.1', loaders: [{ id: 'neoforge-47.2.0', primary: true }],
  files: [{ fileID: 1, projectID: 11 }, { fileID: 2, projectID: 12 }, { fileID: 3, projectID: 13 }],
  overrides: 'overrides',
};
const ctxFor = root => ({ currentServerPath: root, win: null, send: () => {} });

(async () => {
  // --- 1. a failure part-way through rolls everything back -----------------
  {
    const root = makeServer();
    const extractDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-cf-tx-ext-'));
    downloaded = []; failOn = 2;
    const r = await modpacks.importCfModpack(ctxFor(root), extractDir, CF_INDEX, null);
    failOn = null;
    check('failure returns ok:false', r.ok === false, JSON.stringify(r));
    check('failure reports the error', typeof r.error === 'string' && r.error.length > 0, r.error);
    check('failure reports a rolledBack count', typeof r.rolledBack === 'number' && r.rolledBack >= 1, String(r.rolledBack));
    check('the pack targeted mods/', folderOf(root) === 'mods', String(folderOf(root)));
    check('no jar left behind', jarsIn(root).length === 0, JSON.stringify(jarsIn(root)));
    check('the already-downloaded first jar was removed', !fs.existsSync(path.join(root, 'mods', 'alpha.jar')));
    check('no manifest written for a failed import', manifestOf(root).length === 0, JSON.stringify(manifestOf(root)));
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(extractDir, { recursive: true, force: true });
  }

  // --- 2. a successful import installs everything and records the manifest --
  {
    const root = makeServer();
    const extractDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-cf-tx-ext-'));
    downloaded = []; failOn = null;
    const r = await modpacks.importCfModpack(ctxFor(root), extractDir, CF_INDEX, null);
    check('success returns ok:true', r.ok === true, JSON.stringify(r));
    check('success reports 3 installed', r.installed === 3, String(r.installed));
    check('all three jars are in mods/', JSON.stringify(jarsIn(root)) === JSON.stringify(['alpha.jar', 'beta.jar', 'gamma.jar']), JSON.stringify(jarsIn(root)));
    const man = manifestOf(root);
    check('manifest has one entry per file', man.length === 3, JSON.stringify(man));
    check('manifest records the source', man.every(e => e.source === 'curseforge'), JSON.stringify(man.map(e => e.source)));
    check('manifest records the file name', man.some(e => e.fileName === 'beta.jar'), JSON.stringify(man.map(e => e.fileName)));
    check('manifest records the source url', man.every(e => typeof e.sourceUrl === 'string' && e.sourceUrl.startsWith('https://')));
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(extractDir, { recursive: true, force: true });
  }

  // --- 3. an existing jar with the same name is restored, not deleted -------
  {
    const root = makeServer();
    fs.writeFileSync(path.join(root, 'mods', 'alpha.jar'), 'PREVIOUS-BYTES');
    const extractDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-cf-tx-ext-'));
    downloaded = []; failOn = 3;
    const r = await modpacks.importCfModpack(ctxFor(root), extractDir, CF_INDEX, null);
    failOn = null;
    check('overwrite-then-fail returns ok:false', r.ok === false, JSON.stringify(r));
    check('the previous alpha.jar was restored', fs.readFileSync(path.join(root, 'mods', 'alpha.jar'), 'utf8') === 'PREVIOUS-BYTES');
    check('the newly written beta.jar was removed', !fs.existsSync(path.join(root, 'mods', 'beta.jar')));
    check('mods/ holds only the pre-existing file', JSON.stringify(modsIn(root)) === JSON.stringify(['alpha.jar']), JSON.stringify(modsIn(root)));
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(extractDir, { recursive: true, force: true });
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
