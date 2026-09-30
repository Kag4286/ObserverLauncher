// modpack-publish.js - build a modpack.json into a distributable archive (v3.2.0 Phase D3).
//
// WHY: verify/build prove a pack is consistent and buildable, but the roadmap's last step is SHIPPING
// it - attach the built server folder to a GitHub Release so a user can download a ready-to-run pack.
// This script does the build + archive; the workflow (.github/workflows/modpack-publish.yml) uploads
// the resulting .tar.gz to the release for the pushed tag.
//
// Cross-platform by design: it writes a tar.gz with Node's zlib + a tiny hand-rolled tar writer, so
// there is NO dependency on the `zip`/`tar` CLI (Windows has no zip; runners may lack it). Pure and
// testable - the archive step takes a folder and returns a Buffer.
//
// Run: node scripts/modpack-publish.js [manifest.json ...] [--out dist]
//   (no manifest args -> finds every modpack.json outside node_modules/.git)
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

// --- minimal tar.gz writer -------------------------------------------------
// Writes a POSIX ustar archive of { name, data } entries and gzips it. Directory entries are omitted
// (a file whose name is 'mods/foo.jar' extracts into mods/ automatically).
function tarGz(entries) {
  const blocks = [];
  const now = Math.floor(Date.now() / 1000);
  for (const e of entries) {
    const header = Buffer.alloc(512);
    header.write(e.name.slice(0, 100), 0, 'utf8');
    header.write('0000644\0', 100, 'ascii');            // mode
    header.write('0000000\0', 108, 'ascii');            // uid
    header.write('0000000\0', 116, 'ascii');            // gid
    header.write(e.data.length.toString(8).padStart(11, '0') + '\0', 124, 'ascii'); // size (octal)
    header.write(now.toString(8).padStart(11, '0') + '\0', 136, 'ascii');           // mtime (octal)
    header.write('        ', 148, 'ascii');             // checksum placeholder
    header.write('0', 156, 'ascii');                    // typeflag: regular file
    header.write('ustar\0', 257, 'ascii');              // magic
    header.write('00', 263, 'ascii');                   // version
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += header[i];
    header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'ascii'); // checksum
    blocks.push(header);
    const padded = Buffer.alloc(Math.ceil(e.data.length / 512) * 512);
    e.data.copy(padded);
    blocks.push(padded);
  }
  blocks.push(Buffer.alloc(1024)); // two zero blocks = end of archive
  return zlib.gzipSync(Buffer.concat(blocks));
}

// Recursively collect { name (relative, POSIX), data } for every file under dir.
function collect(dir, prefix, out) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, ent.name);
    const rel = prefix ? prefix + '/' + ent.name : ent.name;
    if (ent.isDirectory()) collect(abs, rel, out);
    else if (ent.isFile()) out.push({ name: rel, data: fs.readFileSync(abs) });
  }
  return out;
}

// Find every modpack.json outside node_modules/.git (the same pathspec quirk as modpack-ci.yml).
function findManifests(root) {
  const out = [];
  const walk = (d) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      if (ent.name === 'node_modules' || ent.name === '.git') continue;
      const abs = path.join(d, ent.name);
      if (ent.isDirectory()) walk(abs);
      else if (ent.name === 'modpack.json') out.push(abs);
    }
  };
  walk(root);
  return out;
}

async function main() {
  const argv = process.argv.slice(2);
  const outIdx = argv.indexOf('--out');
  const outDir = outIdx >= 0 ? path.resolve(argv[outIdx + 1]) : path.resolve('dist');
  const manifests = argv.filter((a, i) => a !== '--out' && i !== outIdx + 1 && a.endsWith('.json'));
  const list = manifests.length ? manifests.map(a => path.resolve(a)) : findManifests(path.resolve('.'));
  if (!list.length) { console.log('No modpack.json found - nothing to publish.'); return; }

  fs.mkdirSync(outDir, { recursive: true });
  const { run } = require('../src/cli.js');
  const results = [];
  let failed = 0;
  for (const manifestPath of list) {
    let manifest;
    try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); }
    catch (e) { console.error(`SKIP ${manifestPath}: ${e.message}`); failed++; continue; }
    const slug = String(manifest.name || 'modpack').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'modpack';
    const version = String(manifest.version || '0.0.0');
    const buildDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ol-publish-'));
    // Resolve over the network (CI has it) then build - the CLI refuses a partially resolved pack.
    const built = await run(['modpack', 'build', manifestPath, '--out', buildDir, '--json'], { print: false });
    if (!built || !built.ok) { console.error(`BUILD FAILED ${manifestPath}: ${JSON.stringify(built && built.result)}`); fs.rmSync(buildDir, { recursive: true, force: true }); failed++; continue; }
    const entries = collect(buildDir, '', []);
    const zip = tarGz(entries);
    const outFile = path.join(outDir, `${slug}-${version}.tar.gz`);
    fs.writeFileSync(outFile, zip);
    fs.rmSync(buildDir, { recursive: true, force: true });
    results.push({ manifest: path.relative(process.cwd(), manifestPath), file: outFile, bytes: zip.length, files: entries.length });
    console.log(`PUBLISH ${slug}-${version}.tar.gz (${entries.length} files, ${zip.length} bytes)`);
  }
  console.log(JSON.stringify({ ok: failed === 0, artifacts: results, failed }));
  process.exit(failed ? 1 : 0);
}

// Exported for tests; auto-runs only as a program.
module.exports = { tarGz, collect };
if (require.main === module) main();
