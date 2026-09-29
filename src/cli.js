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
const { auditLog } = require('./mcp/server.js');
const docker = require('./main/docker.js');
const fs = require('fs');
const path = require('path');
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
  docker     Generate a Dockerfile + docker-compose.yml: docker create --type <t> [--ram 4G].
  set-folder Set the active instance's server folder: set-folder <path>.
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
async function run(argv, { print = true, foreground = false } = {}) {
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

  // Local command: set-folder -> set THIS instance's server folder (the CLI equivalent of picking a
  // folder in the GUI). Safe on the CLI because the person running it owns the machine — unlike MCP,
  // which forbids serverPath by design. Needed for headless/Docker where there is no GUI to pick one.
  if (cmdName === 'set-folder') {
    const folder = flags._[1] || flags.path;
    if (!folder) { errlog('Usage: observer set-folder <path> [--instance <id>]'); return { ok: false, code: 2, error: 'missing folder' }; }
    let rt; try { rt = createHeadless(); await initHeadless(rt.ctx); } catch (e) { errlog(`Could not start the backend: ${e?.message || e}`); return { ok: false, code: 1, error: String(e) }; }
    try {
      const abs = path.resolve(String(folder));
      if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) { errlog(`Not a folder: ${abs}`); return { ok: false, code: 1, error: 'not a folder' }; }
      // FIX (v3.1.0 review): honour --instance (same class as the P1 bug). Resolve the id and write
      // the folder into THAT instance's settings (saveSettingsFor), not always the active one.
      const { saveSettings, saveSettingsFor, resolveInstanceId } = require('./main/settings.js');
      const flat = { serverPath: abs };
      if (flags.instance) {
        const resolved = resolveInstanceId(String(flags.instance));
        if (!resolved) { errlog(`Unknown instance "${flags.instance}". Run \`observer list\`.`); return { ok: false, code: 2, error: `unknown instance ${flags.instance}` }; }
        saveSettingsFor(resolved, { ...require('./main/settings.js').loadSettingsFor(resolved), ...flat });
      } else {
        saveSettings({ ...require('./main/settings.js').loadSettings(), ...flat });
      }
      // FIX (v3.1.0 review): this changes the root for every file operation — audit it (write tier),
      // like every other CLI write/destroy action (P2).
      try { auditLog('set_folder', 'write', { ok: true, serverPath: abs }); } catch {}
      if (flags.json) log(JSON.stringify({ ok: true, serverPath: abs }));
      else log(`server folder set to ${abs}`);
      return { ok: true, code: 0, result: { serverPath: abs } };
    } catch (e) { errlog(`Could not set the folder: ${e?.message || e}`); return { ok: false, code: 1, error: String(e) }; }
    finally { try { await stop(rt.ctx); } catch {} }
  }

  // Local command: docker create -> write a Dockerfile + compose + .dockerignore + README.
  if (cmdName === 'docker') {
    const sub = flags._[1];
    if (sub !== 'create') { errlog('Usage: observer docker create --type <paper|fabric|...> [--version latest] [--ram 4] [--port 25565] [--mods a,b] [--out <dir>]'); return { ok: false, code: 2, error: 'unknown docker subcommand' }; }
    const outDir = flags.out ? String(flags.out) : `docker-${flags.type || 'paper'}`;
    const opts = { type: flags.type, version: flags.version, ram: flags.ram, port: flags.port, javaVersion: flags.java, mods: flags.mods ? String(flags.mods).split(',') : [] };
    const norm = docker.normalizeOpts(opts);
    try {
      fs.mkdirSync(outDir, { recursive: true });
      const written = [];
      const write = (name, content) => { const p = path.join(outDir, name); fs.writeFileSync(p, content); written.push(name); };
      write('Dockerfile', docker.dockerfile(opts));
      write('docker-compose.yml', docker.composeFile(opts));
      write('.dockerignore', docker.dockerignore());
      write('README.docker.md', docker.readme(opts));
      if (flags.json) log(JSON.stringify({ ok: true, outDir, type: norm.type, version: norm.version, ram: norm.ram, port: norm.port, files: written }));
      else { log(`Generated Docker setup in ${outDir}/:`); for (const f of written) log('  ' + f); log(`\nNext: cd ${outDir} && docker compose up -d`); }
      return { ok: true, code: 0, result: { outDir, files: written } };
    } catch (e) { errlog(`Could not write the Docker files: ${e?.message || e}`); return { ok: false, code: 1, error: e?.message || String(e) }; }
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
    // P1 (v3.1.0 fix): `--instance` must actually target that instance. tool.handler() reads
    // per-instance ctx accessors via AsyncLocalStorage (ctx.inst()), so the handler MUST run inside
    // runInInstance(targetId) — otherwise every command silently hit the ACTIVE instance (the flag
    // was documented but ignored). Mirrors server.js callTool's instance resolution.
    let runId = rt.ctx.activeInstanceId;
    if (args.instance) {
      const { resolveInstanceId } = require('./main/settings.js');
      const resolved = resolveInstanceId(String(args.instance));
      if (!resolved) { errlog(`Unknown instance "${args.instance}". Run \`observer list\`.`); return { ok: false, code: 2, error: `unknown instance ${args.instance}` }; }
      runId = resolved;
    }
    const result = await rt.ctx.runInInstance(runId, () => tool.handler(rt.ctx, args));
    // P2 (v3.1.0 fix): the CLI bypasses callTool, so write/destroy actions were never audit-logged
    // — a `read_audit_log` after `observer stop`/`install` showed nothing, contradicting the audit
    // story. Record them here (same auditLog server.js uses).
    if (tool.risk !== 'read') { try { auditLog(cmd.tool, tool.risk, result); } catch {} }
    if (flags.json) log(JSON.stringify(result));
    else printHuman(cmdName, result, log, errlog);
    const ok = !(result && result.ok === false);
    // `start` FOREGROUND (v3.1.0): the JVM is a CHILD of this CLI process, so if the CLI exited the
    // server would be orphaned (stdio broken). In program mode we keep the terminal attached, forward
    // Ctrl+C/SIGTERM to a graceful stop, and only return once the server is down. Tests call run()
    // without `foreground`, so they still return immediately.
    if (foreground && cmdName === 'start' && ok) {
      log('server running in the foreground — press Ctrl+C to stop.');
      // Resolve on a signal (user stops it) OR when the server process exits on its own (crash /
      // clean stop), so a dead JVM never leaves the terminal hanging with no message.
      await new Promise((resolve) => {
        let done = false;
        const finish = (why) => { if (done) return; done = true; clearInterval(poll); try { console.error(`[observer] ${why}`); } catch {} resolve(); };
        const onSig = async () => { try { await stop(rt.ctx); } catch {} finish('stopped by signal.'); };
        process.once('SIGINT', onSig);
        process.once('SIGTERM', onSig);
        // Poll ~1s: the server is gone once ctx.serverProcess is null AND status is stopped.
        const poll = setInterval(() => {
          try {
            if (!rt.ctx.serverProcess && rt.ctx.serverStatus === 'stopped') finish('server process exited.');
          } catch {}
        }, 1000);
      });
    }
    return { ok, code: ok ? 0 : 1, result };
  } catch (e) {
    errlog(`Command failed: ${e?.message || e}`);
    return { ok: false, code: 1, error: e?.message || String(e) };
  } finally {
    // Do NOT tear down a foreground `start` from the finally (the signal handler already stopped it);
    // stop() is idempotent, but skipping keeps the intent clear.
    if (!(foreground && cmdName === 'start')) { try { await stop(rt.ctx); } catch {} }
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
  // P3 (v3.1.0 polish): a bare 'ok' threw away the useful part of the result. Surface the file that
  // was installed/backed up, or the resulting status, so one line of output is actually informative.
  if (cmdName === 'install') { log(`installed ${d.name || d.filename || ''}${d.version ? ' (' + d.version + ')' : ''}`.trim()); return; }
  if (cmdName === 'backup') { log(d.file ? `backup created: ${d.file}` : 'backup created'); return; }
  if (cmdName === 'start') { log(`server ${d.status || 'starting'}`); return; }
  if (cmdName === 'stop') { log(`server ${d.status || 'stopping'}`); return; }
  if (cmdName === 'players') { const n = (d.online || d.players || []).length; log(`${n} online`); return; }
  if (cmdName === 'doctor') { log(d.summary || 'health report ready (use --json for full output)'); return; }
  log('ok');
}

module.exports = { run, COMMANDS, parseArgs, USAGE };

// Auto-run only as a program, not when required by a test. `start` runs in the foreground so the
// terminal stays attached to the server (the JVM is this process's child).
if (require.main === module) {
  const argv = process.argv.slice(2);
  const foreground = argv[0] === 'start';
  run(argv, { foreground }).then(r => process.exit(r.code)).catch(e => { console.error(e); process.exit(1); });
}
