// v8.0.1: Verify exact parity between src/mcp/tools.js and src/mcp/bridge.js STATIC_TOOLS,
// plus bounded readConfig() validation in bridge.js.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { TOOLS } = require('../src/mcp/tools.js');
const { STATIC_TOOLS, readConfig } = require('../src/mcp/bridge.js');

let pass = 0, fail = 0;
function check(label, cond) {
  if (cond) { pass++; }
  else { fail++; console.error('FAIL:', label); }
}

const liveNames = TOOLS.map(t => t.name);
const staticNames = STATIC_TOOLS.map(t => t.name);

check('TOOLS and STATIC_TOOLS have identical count (80)', liveNames.length === staticNames.length && liveNames.length === 80);
check('Every tool in tools.js exists in STATIC_TOOLS', liveNames.every(n => staticNames.includes(n)));
check('Every tool in STATIC_TOOLS exists in tools.js', staticNames.every(n => liveNames.includes(n)));
check('Sorted tool sets are identical with no duplicates',
  new Set(liveNames).size === liveNames.length &&
  new Set(staticNames).size === staticNames.length &&
  JSON.stringify([...liveNames].sort()) === JSON.stringify([...staticNames].sort())
);

// Verify README.md mentions 80 server-management tools
const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
check('README.md documents 80 server-management tools', /exposes 80 server-management tools/i.test(readme));

// Test readConfig() bounds (Item 5)
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-bridge-cfg-'));
const prevEnv = process.env.OBSERVER_MCP_USERDATA;
process.env.OBSERVER_MCP_USERDATA = tmpDir;
try {
  const cfgFile = path.join(tmpDir, 'mcp-bridge.json');

  // 1. Valid config
  const validToken = 'a'.repeat(64);
  fs.writeFileSync(cfgFile, JSON.stringify({ port: 41234, token: validToken }));
  const c1 = readConfig();
  check('readConfig accepts valid config', c1 && c1.port === 41234 && c1.token === validToken);

  // 2. Oversized config (>4096 bytes)
  fs.writeFileSync(cfgFile, JSON.stringify({ port: 41234, token: validToken, junk: 'x'.repeat(5000) }));
  check('readConfig rejects config > 4096 bytes', readConfig() === null);

  // 3. Empty token
  fs.writeFileSync(cfgFile, JSON.stringify({ port: 41234, token: '' }));
  check('readConfig rejects empty token', readConfig() === null);

  // 4. Token too long (>256 chars)
  fs.writeFileSync(cfgFile, JSON.stringify({ port: 41234, token: 'a'.repeat(300) }));
  check('readConfig rejects overly long token', readConfig() === null);

  // 5. Invalid port
  fs.writeFileSync(cfgFile, JSON.stringify({ port: 70000, token: validToken }));
  check('readConfig rejects out-of-range port', readConfig() === null);
} finally {
  if (prevEnv === undefined) delete process.env.OBSERVER_MCP_USERDATA;
  else process.env.OBSERVER_MCP_USERDATA = prevEnv;
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
}

console.log(`mcp-bridge-tools-sync: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
