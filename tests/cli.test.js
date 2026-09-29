// cli.test.js — the `observer` CLI surface (v3.0.0 Phase B5/B6).
//
// WHY: the CLI is the human-facing headless entry point. This drives run() in-process (no spawn) to
// prove command routing, --json output, arg parsing and error/usage handling all work with no Electron.
const fs = require('fs');
const os = require('os');
const path = require('path');

// Isolate the data dir before anything reads it.
const tmpData = fs.mkdtempSync(path.join(os.tmpdir(), 'ol-cli-'));
process.env.OBSERVER_DATA_DIR = tmpData;

const cli = require('../src/cli.js');

let pass = 0, fail = 0;
const check = (name, cond, detail) => cond ? (pass++, console.log('PASS', name)) : (fail++, console.log('FAIL', name + (detail ? ' — ' + detail : '')));

(async () => {
  // 1) --version
  {
    const r = await cli.run(['--version'], { print: false });
    check('--version exits 0', r.ok === true && r.code === 0);
  }

  // 2) --help prints usage, exit 0
  {
    const r = await cli.run(['--help'], { print: false });
    check('--help exits 0', r.ok === true && r.code === 0);
  }

  // 3) no args -> usage, exit 2
  {
    const r = await cli.run([], { print: false });
    check('no command -> usage exit 2', r.code === 2);
  }

  // 4) unknown command -> exit 2, no throw
  {
    const r = await cli.run(['frobnicate'], { print: false });
    check('unknown command -> exit 2', r.ok === false && r.code === 2, JSON.stringify(r));
  }

  // 5) status --json runs the get_status tool and returns a result envelope.
  {
    const r = await cli.run(['status', '--json'], { print: false });
    check('status runs + ok', r.ok === true && r.code === 0, JSON.stringify(r));
    check('status result has status field', r.result && r.result.result && typeof r.result.result.status === 'string', JSON.stringify(r.result));
  }

  // 6) install without id -> usage error (requires check).
  {
    const r = await cli.run(['install'], { print: false });
    check('install without id -> exit 2', r.code === 2, JSON.stringify(r));
  }

  // 7) parseArgs handles --k=v, --k v and positionals.
  {
    const f = cli.parseArgs(['install', 'luckperms', '--kind=mod', '--source', 'hangar', '--json']);
    check('parseArgs positionals', f._[0] === 'install' && f._[1] === 'luckperms', JSON.stringify(f));
    check('parseArgs --k=v', f.kind === 'mod', JSON.stringify(f));
    check('parseArgs --k v', f.source === 'hangar', JSON.stringify(f));
    check('parseArgs bare flag', f.json === true);
  }

  // 7b) templates + init local commands (Phase D).
  {
    const t = await cli.run(['templates', '--json'], { print: false });
    check('templates --json lists templates', t.ok === true && Array.isArray(t.result) && t.result.length >= 3, JSON.stringify(t.result && t.result.length));
    const i = await cli.run(['init', '--template', 'survival-5', '--json'], { print: false });
    check('init --template --json returns a plan', i.ok === true && i.result && Array.isArray(i.result.steps) && i.result.steps.length > 0, JSON.stringify(i.result && i.result.steps && i.result.steps.length));
    const bad = await cli.run(['init', '--template', 'nope'], { print: false });
    check('init unknown template -> exit 2', bad.code === 2, JSON.stringify(bad));
    const miss = await cli.run(['init'], { print: false });
    check('init without --template -> exit 2', miss.code === 2);
  }

  // 7c) P1/P2 (v3.1.0): --instance resolution + write/destroy audit logging.
  {
    // Seed 2 instances so resolveInstanceId has something to resolve.
    fs.writeFileSync(path.join(tmpData, 'settings.json'), JSON.stringify({
      version: 4, instances: [
        { id: 'alpha', name: 'Alpha', serverPath: path.join(tmpData, 'a') },
        { id: 'beta', name: 'Beta', serverPath: path.join(tmpData, 'b') },
      ], activeInstanceId: 'alpha',
    }, null, 2));
    const bad = await cli.run(['status', '--instance', 'nope', '--json'], { print: false });
    check('P1: unknown --instance -> exit 2', bad.code === 2, JSON.stringify(bad));
    const good = await cli.run(['status', '--instance', 'beta', '--json'], { print: false });
    check('P1: valid --instance runs ok', good.ok === true && good.code === 0, JSON.stringify(good));

    // P2: a write/destroy command (backup has no folder here -> ok:false) must still be AUDITED.
    const auditFile = path.join(tmpData, 'mcp-audit.log');
    try { fs.rmSync(auditFile, { force: true }); } catch {}
    await cli.run(['backup', '--json'], { print: false });
    let body = '';
    try { body = fs.readFileSync(auditFile, 'utf8'); } catch {}
    check('P2: CLI write command is written to the audit log', /create_backup/.test(body), body.slice(0, 120));
  }

  // 8) every COMMAND maps to a real registered tool (registry drift guard).
  {
    const { getTool } = require('../src/mcp/tools.js');
    const missing = Object.entries(cli.COMMANDS).filter(([, c]) => !getTool(c.tool)).map(([n, c]) => `${n}->${c.tool}`);
    check('every CLI command maps to a registered tool', missing.length === 0, missing.join(', '));
  }

  try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch {}
  console.log(fail ? `\n${fail} check(s) failed.` : `\nAll cli checks passed (${pass}).`);
  process.exit(fail ? 1 : 0);
})();
