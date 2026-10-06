// v3.3.1: (a) write tools return a LEAN result by default (verbose:true restores the old full
// snapshot), (b) install_from_market refuses a loader/MC mismatch + an older version, (c) the
// resolver no longer blindly falls back to an unrelated loader build.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { getTool, TOOLS } = require('../src/mcp/tools.js');

let pass = 0, fail = 0;
const ck = (n, c) => c ? (pass++, console.log('PASS', n)) : (fail++, console.log('FAIL', n));

const src = p => fs.readFileSync(path.join(__dirname, '..', 'src', ...p.split('/')), 'utf8');
const toolsSrc = src('mcp/tools.js');
const mpSrc = src('main/marketplace.js');

(async () => {
  // --- (a) lean results ---
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ol-guard-'));
  fs.writeFileSync(path.join(root, 'server.properties'), 'level-name=world\n');
  fs.mkdirSync(path.join(root, 'plugins'), { recursive: true });
  fs.writeFileSync(path.join(root, 'plugins', 'A.jar'), 'A');

  const del = getTool('delete_content');
  const rd = await del.handler({ currentServerPath: root }, { kind: 'plugin', name: 'A.jar' });
  ck('delete lean ok', rd && rd.ok === true);
  ck('delete lean has no files dump', rd && rd.result && !('files' in rd.result));
  ck('delete lean reports what changed', rd.result.deleted === 'A.jar' && rd.result.kind === 'plugin');

  fs.writeFileSync(path.join(root, 'plugins', 'B.jar'), 'B');
  const rdv = await del.handler({ currentServerPath: root }, { kind: 'plugin', name: 'B.jar', verbose: true });
  ck('delete verbose restores files', rdv && rdv.result && rdv.result.files && Array.isArray(rdv.result.files.plugins));

  fs.writeFileSync(path.join(root, 'plugins', 'C.jar'), 'C');
  const tog = getTool('toggle_content');
  const rt = await tog.handler({ currentServerPath: root }, { kind: 'plugin', name: 'C.jar', action: 'disable' });
  ck('toggle lean ok + no files', rt && rt.ok === true && rt.result && !('files' in rt.result));
  ck('toggle lean reports from/to', rt.result.from === 'C.jar' && rt.result.to === 'C.jar.disabled');
  const rtv = await tog.handler({ currentServerPath: root }, { kind: 'plugin', name: 'C.jar.disabled', action: 'enable', verbose: true });
  ck('toggle verbose restores files', rtv && rtv.result && rtv.result.files && Array.isArray(rtv.result.files.plugins));

  // --- (b) source-level guarantees for the install gates (network-bound, so assert the code) ---
  ck('install has force param', /force: \{ type: 'boolean'/.test(toolsSrc));
  ck('install has allowDowngrade param', /allowDowngrade: \{ type: 'boolean'/.test(toolsSrc));
  ck('install has verbose param', /verbose: \{ type: 'boolean'/.test(toolsSrc));
  ck('install runs loader/MC gate', /versionMatchesServer\(dl, server\)/.test(toolsSrc));
  ck('install downgrade gate compares versions', /compareVersions\(dl\.versionNumber, entry\.version\) < 0/.test(toolsSrc));
  ck('install manifest bug fixed (uses a not item)', !/env: item\.env/.test(toolsSrc) && /env: a\.env/.test(toolsSrc));
  ck('search_marketplace forwards loader', /loader = String\(a\.loader/.test(toolsSrc));

  // --- (c) resolver refuses a mismatched loader instead of byVersion[0] ---
  ck('resolver has no blind byVersion[0] fallback as target', !/target = byVersion\.find\([^)]*\) \|\| byVersion\[0\] \|\| versions\[0\]/.test(mpSrc));
  ck('resolver throws on loader mismatch', /No \$\{kind\} build matches this server's loader/.test(mpSrc));
  ck('resolver keeps datapack/modpack fallback', /target = byVersion\[0\] \|\| versions\[0\]/.test(mpSrc));
  ck('search_marketplace exposes loader param', /loader: STR\('neoforge\|forge\|fabric\|quilt/.test(toolsSrc));

  try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
