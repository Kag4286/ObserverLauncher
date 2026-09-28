#!/usr/bin/env node
// cli.js — the `observer` command-line interface (v3.0.0 Phase B5/B6).
//
// WHY: the backend already runs headless (src/headless.js) and every MCP tool is a plain function
// (tools.js handler(ctx, args)). This CLI is the thinnest possible surface over that: one command ->
// one tool. It intentionally calls tool.handler() DIRECTLY (not server.js callTool), because a human
// typing a command at a terminal IS the confirmation — the write/destroy confirm gate exists to stop
// an unattended AI, not the person running the CLI.
//
// Usage: observer <command> [options]        (see COMMANDS / --help)
// Node-only, no dependencies. Exposes run(argv) so tests drive it in-process.
const { createHeadless, initHeadless, stop } = require('./headless.js');
const { getTool } = require('./mcp/tools.js');
const { listTemplates, resolveTemplate, templatePlan } = require('./main/templates.js');
const pkg = require('../package.json');

// command -> { tool, needs, build(args) }. build() turns parsed flags into the tool's args object.
const COMMANDS = {
  status: { tool: 'get_status', desc: 'Show server status, folder, jar and Java info.' },
  players: { tool: 'list_players', desc: 'List online/whitelisted/banned/op players.' },
  logs: { tool: 'read_console', desc: 'Show recent console lines.', build: (f) => ({ lines: f.lines ? Number(f.lines) : 200 }) },
  start: { tool: 'start_server', desc: 'Start the server.' },
  stop: { tool: 'stop_server', desc: 'Gracefully stop the server.' },
  backup: { tool: 'create_backup', desc: 'Create a world backup (ZIP).' },
  doctor: { tool: 'doctor_report', desc: 'Full health report (diagnose + console + perf).' },
  list: { tool: 'list_instances', desc: 'List configured server instances.' },
  install: {
    tool: 'install_from_market',
    desc: 'Install a plugin/mod from a marketplace.',
    // f._ is [commandName, ...positionals] -> the id is f._[1].
    build: (f) => ({ id: f._[1], kind: f.kind || 'plugin', source: f.source || 'modrinth', ...(f.version ? { version: f.version } : {}) }),
    requires: (f) => (f._[1] ? null : 'install requires a project id, e.g. observer install luckperms'),
  },
};

const USAGE = `ObserverLauncher CLI (observer) v${pkg.version}

Usage: observer <command> [options]

Commands:
  templates  List server templates (survival-5, creative-build, modded-performance).
  init       Print the step plan for a template: init --template <id>.
${Object.entries(COMMANDS).map(([n, c]) => `  ${n.padEnd(10)} ${c.desc}`).join('\n')}

Options:
  --json            Print the raw JSON result (for scripts).
  --instance <id>   Target a specific instance id.
  -h, --help        Show this help.
  --version         Print the CLI version.

Environment:
  OBSERVER_DATA_DIR       Data folder (default: platform userData dir).
  OBSERVER_CONFIRM_MODE   Confirm policy (default: auto-deny).
`;

// Parse argv (minus node + script) into { _: positionals, ...flags }. Supports --k v, --k=v, --flag.
function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) { out[a.slice(2, eq)] = a.slice(eq + 1); continue; }
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('-')) { out[key] = next; i++; }
      else out[key] = true;
    } else if (a === '-h') {
      out.help = true;
    } else {
      out._.push(a);
    }
  }
  return out;
}

// Run one command. Returns { ok, code, result }. code is the process exit code (0 ok, 1 tool
// failure, 2 usage error). Never throws — boot/run errors become { ok:false }.
async function run(argv, { print = true } = {}) {
  const flags = parseArgs(argv);
  const log = (...a) => { if (print) console.log(...a); };
  const errlog = (...a) => { if (print) console.error(...a); };

  if (flags.version) { log(pkg.version); return { ok: true, code: 0 }; }
  const cmdName = flags._[0];
  if (flags.help || !cmdName) { log(USAGE); return { ok: !cmdName || !!flags.help, code: cmdName || flags.help ? 0 : 2 }; }

  // Local (non-tool) commands: templates + init. They need no backend boot.
  if (cmdName === 'templates') {
    const list = listTemplates();
    if (flags.json) log(JSON.stringify(list));
    else for (const t of list) log(`${t.id.padEnd(20)} ${t.name}  [${t.software} ${t.version}, ${t.memoryGB}GB]`);
    return { ok: true, code: 0, result: list };
  }
  if (cmdName === 'init') {
    const id = flags.template || flags._[1];
    if (!id) { errlog('init requires --template <id>. Run `observer templates` to list ids.'); return { ok: false, code: 2, error: 'missing --template' }; }
    if (!resolveTemplate(id)) { errlog(`Unknown template: ${id}. Run \`observer templates\`.`); return { ok: false, code: 2, error: `unknown template ${id}` }; }
    const plan = templatePlan(id);
    if (flags.json) log(JSON.stringify(plan));
    else {
      log(`Plan for template "${id}" (${plan.steps.length} steps):`);
      for (const s of plan.steps) log(`  - ${s.step}: ${s.tool} ${JSON.stringify(s.args)}`);
      log('\nExecute the steps with the matching MCP tools / wizard, or run with --json to script them.');
    }
    return { ok: true, code: 0, result: plan };
  }

  const cmd = COMMANDS[cmdName];
  if (!cmd) { errlog(`Unknown command: ${cmdName}`); log(USAGE); return { ok: false, code: 2, error: `Unknown command: ${cmdName}` }; }
  if (cmd.requires) { const miss = cmd.requires(flags); if (miss) { errlog(miss); return { ok: false, code: 2, error: miss }; } }

  const tool = getTool(cmd.tool);
  if (!tool) { errlog(`Internal error: tool "${cmd.tool}" is not registered.`); return { ok: false, code: 1, error: `missing tool ${cmd.tool}` }; }

  let rt;
  try {
    rt = createHeadless();
    await initHeadless(rt.ctx);
  } catch (e) {
    errlog(`Could not start the backend: ${e?.message || e}`);
    return { ok: false, code: 1, error: e?.message || String(e) };
  }

  try {
    const args = cmd.build ? cmd.build(flags) : {};
    if (flags.instance) args.instance = String(flags.instance);
    const result = await tool.handler(rt.ctx, args);
    if (flags.json) log(JSON.stringify(result));
    else printHuman(cmdName, result, log, errlog);
    const ok = !(result && result.ok === false);
    return { ok, code: ok ? 0 : 1, result };
  } catch (e) {
    errlog(`Command failed: ${e?.message || e}`);
    return { ok: false, code: 1, error: e?.message || String(e) };
  } finally {
    try { stop(rt.ctx); } catch {}
  }
}

// Human-readable one-line summary per command (JSON mode bypasses this).
// Tools return { ok, result: {...} }; unwrap that envelope here so the CLI prints the payload.
function printHuman(cmdName, result, log, errlog) {
  if (result && result.ok === false) { errlog(`Error: ${result.error || 'command failed'}`); return; }
  const d = (result && result.result && typeof result.result === 'object') ? result.result : result || {};
  if (cmdName === 'status') { log(`status: ${d.status} — ${d.running ? 'running' : 'stopped'} (${d.serverPath || 'no folder'})`); return; }
  if (cmdName === 'list') { for (const i of d.instances || []) log(`${i.active ? '*' : ' '} ${i.id}  ${i.name || ''}  ${i.serverPath || ''}`); return; }
  if (cmdName === 'logs') { for (const l of d.lines || []) log(typeof l === 'string' ? l : (l.text || '')); return; }
  log('ok');
}

module.exports = { run, COMMANDS, parseArgs, USAGE };

// Auto-run only as a program, not when required by a test.
if (require.main === module) {
  run(process.argv.slice(2)).then(r => process.exit(r.code)).catch(e => { console.error(e); process.exit(1); });
}
