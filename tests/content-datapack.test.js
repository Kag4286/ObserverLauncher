// CB1 (v3.3.0): an unzipped datapack is a DIRECTORY. It must (a) appear in serverFiles().datapacks
// and (b) be deletable (rmSync recursive, not unlinkSync which throws on a dir).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { serverFiles, emptyServerFiles } = require('../src/main/server-files.js');
const { TOOLS, getTool } = require('../src/mcp/tools.js');

let pass = 0, fail = 0;
const ck = (n, c) => c ? (pass++, console.log('PASS', n)) : (fail++, console.log('FAIL', n));

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ol-dp-'));
  const dpDir = path.join(root, 'world', 'datapacks');
  fs.mkdirSync(path.join(dpDir, 'MyDatapack', 'data'), { recursive: true });
  fs.writeFileSync(path.join(dpDir, 'pack.zip'), 'x');
  fs.writeFileSync(path.join(dpDir, 'legacy.jar'), 'x');

  const f = serverFiles(root);
  ck('folder datapack listed', (f.datapacks || []).includes('MyDatapack'));
  ck('zip datapack still listed', (f.datapacks || []).includes('pack.zip'));
  ck('jar datapack still listed', (f.datapacks || []).includes('legacy.jar'));
  ck('datapacks count is 3', (f.datapacks || []).length === 3);
  ck('empty server -> datapacks []', Array.isArray(emptyServerFiles().datapacks) && emptyServerFiles().datapacks.length === 0);

  // delete_content on a DIRECTORY datapack (would throw EISDIR with the old unlinkSync)
  const del = getTool('delete_content') || TOOLS.find(t => /delete_content/i.test(t.name));
  ck('delete_content tool exists', !!del);
  if (del) {
    const r = await del.handler({ currentServerPath: root }, { kind: 'datapack', name: 'MyDatapack' });
    ck('delete dir datapack -> ok', r && r.ok === true);
    ck('dir actually removed', !fs.existsSync(path.join(dpDir, 'MyDatapack')));
    // a file still deletes fine
    const r2 = await del.handler({ currentServerPath: root }, { kind: 'datapack', name: 'pack.zip' });
    ck('delete file datapack -> ok', r2 && r2.ok === true);
  }

  try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
