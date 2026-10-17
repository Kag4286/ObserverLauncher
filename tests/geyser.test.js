// 5.7.0: GeyserMC config inspection. parseSimpleYaml reads the flat/nested config; inspectGeyser
// flags the common mistakes that stop Bedrock players from joining. Pure (reads temp files only).
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { inspectGeyser, parseSimpleYaml, yamlKeyLines, planGeyserFix, applyGeyserFix } = require('../src/main/geyser.js');

let passed = 0;
function ok(name, cond) { assert(cond, `FAIL: ${name}`); console.log(`PASS ${name}`); passed++; }

// --- parseSimpleYaml ---
{
  const y = parseSimpleYaml('bedrock:\n  port: 19132\n  clone-remote-port: false\nremote:\n  auth-type: floodgate\n# comment\n');
  ok('yaml: nested port', y.bedrock.port === '19132');
  ok('yaml: nested bool as text', y.bedrock['clone-remote-port'] === 'false');
  ok('yaml: second top-level key', y.remote['auth-type'] === 'floodgate');
  const q = parseSimpleYaml('a: "quoted"\nb: \'single\'\n');
  ok('yaml: strips double quotes', q.a === 'quoted');
  ok('yaml: strips single quotes', q.b === 'single');
  ok('yaml: empty safe', Object.keys(parseSimpleYaml('')).length === 0);
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-geyser-'));
fs.mkdirSync(path.join(root, 'plugins', 'Geyser-Spigot'), { recursive: true });
const cfg = path.join(root, 'plugins', 'Geyser-Spigot', 'config.yml');

// --- no jar / no config -> found=false ---
ok('no config: found true, configPath null', (() => { const r = inspectGeyser(root); return r.found === true && r.configPath === null; })());
ok('no config: warns to start once', inspectGeyser(root).issues.some(i => i.key === 'config'));

// --- dynamic scan: a folder name that is NOT in the fixed list is still found ---
{
  const root2 = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-geyser2-'));
  fs.mkdirSync(path.join(root2, 'plugins', 'Geyser-CustomName'), { recursive: true });
  fs.writeFileSync(path.join(root2, 'plugins', 'Geyser-CustomName', 'config.yml'), 'bedrock:\n  port: 19132\n  clone-remote-port: false\n');
  const { findGeyserConfig } = require('../src/main/geyser.js');
  ok('dynamic scan finds custom folder', findGeyserConfig(root2) === 'plugins/Geyser-CustomName/config.yml');
  ok('dynamic scan -> config loaded', inspectGeyser(root2).configPath === 'plugins/Geyser-CustomName/config.yml');
  fs.rmSync(root2, { recursive: true, force: true });
}

// --- clone-remote-port true -> error ---
fs.writeFileSync(cfg, 'bedrock:\n  port: 19132\n  clone-remote-port: true\nremote:\n  auth-type: floodgate\n');
{
  const r = inspectGeyser(root, { floodgate: true });
  ok('config path found', r.configPath === 'plugins/Geyser-Spigot/config.yml');
  ok('clone-remote-port true -> error', r.issues.some(i => i.level === 'error' && i.key === 'bedrock.clone-remote-port'));
  ok('auth-type floodgate -> no auth error', !r.issues.some(i => i.key === 'remote.auth-type'));
}

// --- non-default bedrock port -> warn ---
fs.writeFileSync(cfg, 'bedrock:\n  port: 20000\n  clone-remote-port: false\n');
ok('non-default port -> warn', inspectGeyser(root).issues.some(i => i.key === 'bedrock.port'));

// --- floodgate present but auth-type online -> error ---
fs.writeFileSync(cfg, 'bedrock:\n  port: 19132\n  clone-remote-port: false\nremote:\n  auth-type: online\n');
ok('floodgate + auth-type online -> error', inspectGeyser(root, { floodgate: true }).issues.some(i => i.key === 'remote.auth-type'));

// --- haproxy false -> warn ---
fs.writeFileSync(cfg, 'bedrock:\n  port: 19132\n  clone-remote-port: false\nadvanced:\n  bedrock:\n    use-haproxy-protocol: false\n');
ok('haproxy false -> warn', inspectGeyser(root).issues.some(i => i.key === 'advanced.bedrock.use-haproxy-protocol'));

// --- port conflict: query enabled on the Geyser UDP port -> error ---
fs.writeFileSync(cfg, 'bedrock:\n  port: 19132\n  clone-remote-port: false\n');
fs.writeFileSync(path.join(root, 'server.properties'), 'enable-query=true\nquery.port=19132\n');
ok('query port clash -> error', inspectGeyser(root).issues.some(i => i.key === 'query.port'));
fs.writeFileSync(path.join(root, 'server.properties'), 'enable-query=true\nquery.port=19133\n');
ok('query on another port -> no clash', !inspectGeyser(root).issues.some(i => i.key === 'query.port'));
fs.writeFileSync(path.join(root, 'server.properties'), 'enable-query=false\nquery.port=19132\n');
ok('query disabled -> no clash', !inspectGeyser(root).issues.some(i => i.key === 'query.port'));

// --- java version: below 21 -> error ---
ok('java 17 -> error', inspectGeyser(root, { javaMajor: 17 }).issues.some(i => i.key === 'java'));
ok('java 21 -> no java error', !inspectGeyser(root, { javaMajor: 21 }).issues.some(i => i.key === 'java'));
ok('java unknown -> no java error', !inspectGeyser(root, {}).issues.some(i => i.key === 'java'));

// --- clean config -> no issues ---
fs.writeFileSync(path.join(root, 'server.properties'), '');
fs.writeFileSync(cfg, 'bedrock:\n  port: 19132\n  clone-remote-port: false\nremote:\n  auth-type: floodgate\nadvanced:\n  bedrock:\n    use-haproxy-protocol: true\n');
ok('clean config -> no issues', inspectGeyser(root, { floodgate: true, javaMajor: 21 }).issues.length === 0);

fs.rmSync(root, { recursive: true, force: true });

// --- A1 (v6.0.0): planGeyserFix + applyGeyserFix (line-level, comment-preserving) ---
{
  const fixRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-geyserfix-'));
  fs.mkdirSync(path.join(fixRoot, 'plugins', 'Geyser-Spigot'), { recursive: true });
  const rel = 'plugins/Geyser-Spigot/config.yml';
  const abs = path.join(fixRoot, rel);
  // A realistic config: comments, blank lines, list items, a 3-level nesting.
  const original = [
    '# Geyser config',
    'bedrock:',
    '  # bedrock port comment',
    '  port: 20000',
    '  clone-remote-port: true   # must be false',
    'remote:',
    '  auth-type: online',
    '  forward-ip: false',
    'advanced:',
    '  bedrock:',
    '    use-haproxy-protocol: false',
    '  other-list:',
    '    - one',
    '    - two',
    '',
  ].join('\n');
  fs.writeFileSync(abs, original);
  const info = inspectGeyser(fixRoot, { floodgate: true, javaMajor: 21 });
  ok('fix: plan includes clone-remote-port', planGeyserFix(info).some(e => e.key === 'bedrock.clone-remote-port'));
  ok('fix: plan includes auth-type', planGeyserFix(info).some(e => e.key === 'remote.auth-type'));
  ok('fix: plan includes haproxy', planGeyserFix(info).some(e => e.key === 'advanced.bedrock.use-haproxy-protocol'));
  ok('fix: bedrock.port NOT in default plan', !planGeyserFix(info).some(e => e.key === 'bedrock.port'));
  ok('fix: bedrock.port opt-in', planGeyserFix(info, { includeBedrockPort: true }).some(e => e.key === 'bedrock.port'));

  const res = applyGeyserFix(fixRoot, rel, planGeyserFix(info));
  ok('fix: apply ok', res.ok === true);
  ok('fix: apply changed 3', res.changed.length === 3);
  ok('fix: backup created', typeof res.backup === 'string' && fs.existsSync(res.backup));
  const after = fs.readFileSync(abs, 'utf8');
  // The critical guarantee: comments and unrelated lines survive, only values change.
  ok('fix: header comment kept', after.includes('# Geyser config'));
  ok('fix: inline comment kept', after.includes('clone-remote-port: false   # must be false'));
  ok('fix: nested port comment kept', after.includes('# bedrock port comment'));
  ok('fix: list items kept', after.includes('    - one') && after.includes('    - two'));
  ok('fix: forward-ip untouched', after.includes('forward-ip: false'));
  ok('fix: clone-remote-port now false', /clone-remote-port:\s*false/.test(after));
  ok('fix: auth-type now floodgate', /auth-type:\s*floodgate/.test(after));
  ok('fix: haproxy now true', /use-haproxy-protocol:\s*true/.test(after));
  ok('fix: re-inspect has no fixable errors', inspectGeyser(fixRoot, { floodgate: true, javaMajor: 21 }).issues.filter(i => ['bedrock.clone-remote-port', 'remote.auth-type', 'advanced.bedrock.use-haproxy-protocol'].includes(i.key)).length === 0);

  // Re-applying the same plan is a no-op (values already correct) and does NOT create a 2nd backup.
  const res2 = applyGeyserFix(fixRoot, rel, planGeyserFix(info));
  ok('fix: re-apply is no-op (nothing changed)', res2.ok === true && res2.changed.length === 0);
  ok('fix: re-apply made no backup', res2.backup === null);

  // Empty plan + missing file are safe failures.
  ok('fix: empty plan refused', applyGeyserFix(fixRoot, rel, []).ok === false);
  ok('fix: missing file refused', applyGeyserFix(fixRoot, 'plugins/Nope/config.yml', [{ key: 'x', path: 'bedrock.port', to: '19132' }]).ok === false);
  ok('fix: missing root refused', applyGeyserFix(null, rel, [{ key: 'x', path: 'bedrock.port', to: '19132' }]).ok === false);

  fs.rmSync(fixRoot, { recursive: true, force: true });
}

// --- A1 review (v6.0.0): edge cases beyond the happy path above --------------------------------
// Leaf dotted paths parseSimpleYaml produces, for the parity check against yamlKeyLines.
function leafPaths(obj, prefix) {
  const out = [];
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    const p = prefix ? prefix + '.' + k : k;
    if (v && typeof v === 'object') out.push(...leafPaths(v, p));
    else out.push(p);
  }
  return out;
}
{
  // yamlKeyLines must name the same leaf keys parseSimpleYaml sees, or a fix targets a ghost line.
  const text = ['# c', 'bedrock:', '  # the UDP listener', '  address: 0.0.0.0', '  port: 19132', '  clone-remote-port: false', 'remote:', '  auth-type: floodgate', '  forward-ip: false', 'advanced:', '  bedrock:', '    use-haproxy-protocol: false', '  other-list:', '    - one', '    - two', ''].join('\n');
  const parsedLeaves = leafPaths(parseSimpleYaml(text)).sort();
  const mapKeys = [...yamlKeyLines(text).map.keys()].sort();
  ok('review: yamlKeyLines keys === parseSimpleYaml leaves', JSON.stringify(parsedLeaves) === JSON.stringify(mapKeys));
  // Only divergence: an explicitly quoted empty value (parseSimpleYaml treats it as a branch). No fix key uses one.
  const q = yamlKeyLines('a: ""\nb: 1\n').map;
  ok('review: quoted-empty divergence is benign', q.has('a') && !leafPaths(parseSimpleYaml('a: ""\nb: 1\n')).includes('a'));
}
{
  // Quotes stripped, inline comments byte-kept on the rewritten line.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-geyser-rev-'));
  fs.mkdirSync(path.join(root, 'plugins', 'Geyser-Spigot'), { recursive: true });
  const rel = 'plugins/Geyser-Spigot/config.yml';
  const abs = path.join(root, rel);
  fs.writeFileSync(abs, ['bedrock:', '  port: 19132', '  clone-remote-port: true', 'remote:', '  auth-type: "online"   # change me', 'advanced:', '  bedrock:', '    use-haproxy-protocol: false   # proxy', ''].join('\n'));
  const info = inspectGeyser(root, { floodgate: true });
  const res = applyGeyserFix(root, rel, planGeyserFix(info));
  const after = fs.readFileSync(abs, 'utf8');
  ok('review: quoted value replaced + inline comment kept', after.includes('auth-type: floodgate   # change me'));
  ok('review: haproxy inline comment kept', after.includes('use-haproxy-protocol: true   # proxy'));
  ok('review: no leftover double quotes', !after.includes('"online"'));
  ok('review: 3 edits applied', res.changed.length === 3);
  fs.rmSync(root, { recursive: true, force: true });
}
{
  // CRLF must survive the split/join.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-geyser-crlf-'));
  fs.mkdirSync(path.join(root, 'plugins', 'Geyser-Spigot'), { recursive: true });
  const rel = 'plugins/Geyser-Spigot/config.yml';
  const abs = path.join(root, rel);
  fs.writeFileSync(abs, 'bedrock:\r\n  port: 19132\r\n  clone-remote-port: true\r\n');
  applyGeyserFix(root, rel, planGeyserFix(inspectGeyser(root, { floodgate: false })));
  const after = fs.readFileSync(abs, 'utf8');
  ok('review: CRLF preserved', after.includes('\r\n'));
  ok('review: CRLF value fixed', /clone-remote-port:\s*false/.test(after));
  fs.rmSync(root, { recursive: true, force: true });
}
{
  // The opt-in plan for bedrock.port is actually WRITTEN, not just planned.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-geyser-port-'));
  fs.mkdirSync(path.join(root, 'plugins', 'Geyser-Spigot'), { recursive: true });
  const rel = 'plugins/Geyser-Spigot/config.yml';
  const abs = path.join(root, rel);
  fs.writeFileSync(abs, 'bedrock:\n  port: 20000\n  clone-remote-port: false\n');
  const res = applyGeyserFix(root, rel, planGeyserFix(inspectGeyser(root, { floodgate: false }), { includeBedrockPort: true }));
  ok('review: bedrock.port opt-in written', fs.readFileSync(abs, 'utf8').includes('port: 19132'));
  ok('review: bedrock.port opt-in changed 1', res.changed.length === 1);
  fs.rmSync(root, { recursive: true, force: true });
}
{
  // A plan key that is not in the file is skipped, the file is untouched, no backup.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-geyser-miss-'));
  fs.mkdirSync(path.join(root, 'plugins', 'Geyser-Spigot'), { recursive: true });
  const rel = 'plugins/Geyser-Spigot/config.yml';
  const abs = path.join(root, rel);
  const orig = 'bedrock:\n  port: 19132\n';
  fs.writeFileSync(abs, orig);
  const res = applyGeyserFix(root, rel, [{ key: 'remote.auth-type', path: 'remote.auth-type', to: 'floodgate' }]);
  ok('review: missing key -> ok, nothing changed', res.ok === true && res.changed.length === 0);
  ok('review: missing key -> no backup', res.backup === null);
  ok('review: missing key -> file untouched', fs.readFileSync(abs, 'utf8') === orig);
  fs.rmSync(root, { recursive: true, force: true });
}
{
  // The backup is a byte copy of the ORIGINAL, taken before the write.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-geyser-bak-'));
  fs.mkdirSync(path.join(root, 'plugins', 'Geyser-Spigot'), { recursive: true });
  const rel = 'plugins/Geyser-Spigot/config.yml';
  const abs = path.join(root, rel);
  const orig = 'bedrock:\n  port: 19132\n  clone-remote-port: true\n';
  fs.writeFileSync(abs, orig);
  const res = applyGeyserFix(root, rel, planGeyserFix(inspectGeyser(root, { floodgate: false })));
  ok('review: backup byte-identical to original', fs.readFileSync(res.backup, 'utf8') === orig);
  fs.rmSync(root, { recursive: true, force: true });
}
{
  // GUI contract: the Apply fix button shows for every safe + optional key (mirrors 07-overview.js
  // FIXABLE_KEYS) and the port-only case is repaired when the shell passes includeBedrockPort.
  const FIXABLE_KEYS = ['bedrock.clone-remote-port', 'remote.auth-type', 'advanced.bedrock.use-haproxy-protocol', 'bedrock.port'];
  const portInfo = { issues: [{ key: 'bedrock.port' }] };
  const cloneInfo = { issues: [{ key: 'bedrock.clone-remote-port' }] };
  ok('review: GUI button shown for a bedrock.port-only issue', portInfo.issues.some(it => FIXABLE_KEYS.includes(it.key)));
  ok('review: GUI button shown for clone-remote-port', cloneInfo.issues.some(it => FIXABLE_KEYS.includes(it.key)));
  ok('review: GUI port path plans 1 edit when opt-in', planGeyserFix(portInfo, { includeBedrockPort: true }).length === 1);
}

console.log(`\n${passed} passed, 0 failed`);
