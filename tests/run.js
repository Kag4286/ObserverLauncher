// Test runner — executes every tests/*.test.js and fails fast on any failure.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const dir = __dirname;
const files = fs.readdirSync(dir).filter(f => f.endsWith('.test.js')).sort();
let failed = 0;
console.log(`Running ${files.length} test file(s)...\n`);
for (const f of files) {
  const r = spawnSync(process.execPath, [path.join(dir, f)], { stdio: 'inherit' });
  if (r.status !== 0) { failed++; console.log(`\n✗ ${f} FAILED\n`); }
}
console.log(failed ? `\n${failed} test file(s) failed.` : '\nAll test files passed.');
process.exit(failed ? 1 : 0);
