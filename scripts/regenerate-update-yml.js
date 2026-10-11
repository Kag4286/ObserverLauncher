// regenerate-update-yml.js - refresh electron-updater metadata AFTER code signing (v5.3.0).
//
// WHY (SignPath handoff): electron-builder writes latest.yml / latest-linux.yml with the sha512 +
// size of the UNSIGNED installer. Authenticode signing rewrites the PE file, so its SHA-512 changes.
// electron-updater verifies that hash before installing and rejects a mismatch as a corrupt download.
// This script recomputes sha512 + size from the SIGNED file and patches ONLY those fields, leaving
// version/path/releaseDate untouched - a byte-minimal, reviewable diff.
//
// Idempotent: running it on an unsigned artifact reproduces the hash electron-builder already wrote
// (a harmless no-op). Dependency-free: it never parses the whole YAML, so no js-yaml is required.
//
// Run: node scripts/regenerate-update-yml.js [--dist dist]
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function sha512b64(file) {
  return crypto.createHash('sha512').update(fs.readFileSync(file)).digest('base64');
}

// Patch the sha512 + size fields of one yml against its referenced artifact. Keeps every other line
// intact (top-level sha512, indented files[].sha512, and any size fields).
function patchYml(ymlPath, artifact) {
  let text = fs.readFileSync(ymlPath, 'utf8');
  const hash = sha512b64(artifact);
  const size = fs.statSync(artifact).size;
  text = text.replace(/^sha512:\s*\S+/m, `sha512: ${hash}`);
  text = text.replace(/^size:\s*\d+/m, `size: ${size}`);
  text = text.replace(/(\n\s+sha512:\s*)\S+/g, `$1${hash}`);
  text = text.replace(/(\n\s+size:\s*)\d+/g, `$1${size}`);
  fs.writeFileSync(ymlPath, text);
  console.log(`  patched ${path.basename(ymlPath)} -> ${path.basename(artifact)} size=${size} sha512=${hash.slice(0, 20)}...`);
}

function main() {
  const args = process.argv.slice(2);
  const distIdx = args.indexOf('--dist');
  const dist = path.resolve(distIdx >= 0 ? args[distIdx + 1] : 'dist');
  if (!fs.existsSync(dist)) {
    console.log(`regenerate-update-yml: no dist folder at ${dist} - nothing to do.`);
    return;
  }
  const ymls = fs.readdirSync(dist).filter((f) => /^latest(-linux)?\.yml$/.test(f));
  if (ymls.length === 0) {
    console.log('regenerate-update-yml: no latest*.yml found - nothing to do.');
    return;
  }
  for (const yml of ymls) {
    const ymlPath = path.join(dist, yml);
    const text = fs.readFileSync(ymlPath, 'utf8');
    // The artifact this yml points at: files[].url first, then the top-level path.
    const m = text.match(/^\s*-?\s*url:\s*(\S+)/m) || text.match(/^path:\s*(\S+)/m);
    const artifact = m ? path.join(dist, path.basename(m[1])) : null;
    if (!artifact || !fs.existsSync(artifact)) {
      console.warn(`  ! ${yml}: referenced artifact not found (${m ? m[1] : 'no url'}) - skipped`);
      continue;
    }
    patchYml(ymlPath, artifact);
  }
}

main();
