// MCP Server Doctor — diagnostics that turn an AI client into a real server manager.
//
// Design: the ANALYSIS is pure (no Electron, no I/O) so every check is unit-testable; thin
// wrappers read the actual ctx/files and feed the pure functions. All output is English, using
// a fixed {id, level: 'ok'|'warn'|'error'|'info', detail, fix?} shape the AI can act on.
const fs = require('fs');
const path = require('path');
const net = require('net');

// ---- Console log analysis ----
// Minecraft logs are noisy; a naive "contains ERROR" scan is useless (every startup prints some).
// We classify by severity, then GROUP by a normalised signature (numbers/hex/timestamps stripped)
// so 400 identical stack-trace lines collapse to one entry with a count.
const CONSOLE_RULES = [
  { re: /OutOfMemoryError|Java heap space|GC overhead limit/i, level: 'error', id: 'oom', label: 'Out of memory', fix: 'Lower view-distance/simulation-distance or raise Maximum memory (RAM) in Settings; a memory leak from a plugin is also possible.' },
  { re: /Could not reserve enough space|unable to create .*thread|unable to allocate/i, level: 'error', id: 'alloc', label: 'JVM could not allocate memory', fix: 'Close other apps or lower the RAM allocation - the machine is out of free memory.' },
  { re: /Address already in use|bind.*failed|Failed to bind/i, level: 'error', id: 'port-busy', label: 'Server port already in use', fix: 'Another process is using the port. Stop the other server or change server-port in server.properties.' },
  { re: /UnsupportedClassVersionError|class file version/i, level: 'error', id: 'java-version', label: 'Wrong Java version', fix: 'Install the Java version the server jar needs (Settings shows the requirement) and point Settings > Java at it.' },
  { re: /NoClassDefFoundError|ClassNotFoundException/i, level: 'error', id: 'missing-class', label: 'Missing class', fix: 'A plugin/mod is missing a dependency or is corrupt. Check the plugin/mod list and its required dependencies.' },
  { re: /Exception|Caused by:|at [\w.$]+\(/i, level: 'error', id: 'exception', label: 'Java exception', fix: 'Read the full stack trace in the Console tab; usually caused by a plugin/mod.' },
  { re: /Failed to load|Failed to start|Cannot load|Error loading/i, level: 'error', id: 'load-fail', label: 'Load failure', fix: 'A plugin/mod/world failed to load. Check the Console tab and recently changed files.' },
  { re: /Can't keep up|running \d+ms behind|overloaded/i, level: 'warn', id: 'lag', label: 'Server cannot keep up (lag)', fix: 'Reduce view-distance, remove heavy plugins, or allocate more RAM.' },
  { re: /\[WARN\]|WARNING/i, level: 'warn', id: 'warn', label: 'Warning', fix: null },
];
// Strip volatile numbers so 100 stack-trace lines with different line numbers collapse to one key.
function signatureOf(line) {
  return String(line)
    .replace(/§./g, '')
    .replace(/\u001b\[[0-9;]*m/g, '')
    .replace(/\b\d{2}:\d{2}:\d{2}\b/g, 'T')
    .replace(/\b0x[0-9a-fA-F]+\b/g, 'H')
    .replace(/\b\d+\b/g, 'N')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}
// Pure: scan an array of {text, type} log lines, return ranked issue groups + a severity tally.
function analyzeConsoleLines(lines) {
  const groups = new Map();
  let errors = 0, warns = 0;
  for (const l of lines || []) {
    const text = String(l && l.text != null ? l.text : l || '');
    let hit = null;
    for (const rule of CONSOLE_RULES) { if (rule.re.test(text)) { hit = rule; break; } }
    if (!hit) continue;
    if (hit.level === 'error') errors++; else if (hit.level === 'warn') warns++;
    const key = hit.id + '|' + signatureOf(text);
    const g = groups.get(key) || { id: hit.id, level: hit.level, label: hit.label, fix: hit.fix, sample: text.slice(0, 300), count: 0, last: text.slice(0, 300) };
    g.count++;
    g.last = text.slice(0, 300);
    groups.set(key, g);
  }
  const issues = [...groups.values()].sort((a, b) => (a.level === 'error' ? 0 : 1) - (b.level === 'error' ? 0 : 1) || b.count - a.count);
  return { errors, warns, issues };
}

// ---- Crash report summarising ----
// A crash-report has a header then "Description: ..." then a stack trace. We pull the useful bits
// (description, first few Caused by / at lines) instead of returning the whole file.
function summarizeCrashText(text) {
  const lines = String(text || '').split(/\r?\n/);
  const out = { description: null, version: null, mods: null, cause: [], size: lines.length };
  for (const line of lines) {
    const d = line.match(/^Description:\s*(.+)$/i); if (d) out.description = d[1].trim();
    const v = line.match(/^Minecraft Version:\s*(.+)$/i); if (v) out.version = v[1].trim();
  }
  // The first few "Caused by" / exception / "at ..." lines = the real cause chain.
  for (const line of lines) {
    const t = line.trim();
    if (/^Caused by:/i.test(t) || /Exception|Error:/.test(t) || /^at [\w.$]+\(/.test(t)) {
      if (out.cause.length < 12) out.cause.push(t.slice(0, 240));
    }
  }
  return out;
}
// Pick the newest crash report file in <root>/crash-reports (or null).
function latestCrashReport(root) {
  if (!root) return null;
  const dir = path.join(root, 'crash-reports');
  let files;
  try { files = fs.readdirSync(dir).filter(f => /crash-.*\.txt$/i.test(f)); } catch { return null; }
  if (!files.length) return null;
  const withTime = files.map(f => { let m = 0; try { m = fs.statSync(path.join(dir, f)).mtimeMs; } catch {} return { f, m }; }).sort((a, b) => b.m - a.m);
  return { file: path.join(dir, withTime[0].f), name: withTime[0].f, mtime: withTime[0].m };
}

// ---- server.properties validation ----
// Pure: takes the parsed properties object, returns check entries. `worldDirs` = existing top-level
// folder names, used to confirm level-name points at a real world.
function validateProperties(props, worldDirs) {
  props = props || {};
  const checks = [];
  const add = (id, ok, detail, fix) => checks.push({ id, level: ok ? 'ok' : 'warn', detail, fix: ok ? null : fix });
  const port = Number(props['server-port']);
  add('port', Number.isInteger(port) && port >= 1 && port <= 65535, `server-port = ${props['server-port'] ?? '(unset, default 25565)'}`, 'server-port must be 1-65535.');
  const lvl = props['level-name'] || 'world';
  const hasWorld = !worldDirs || worldDirs.includes(lvl);
  add('level-name', hasWorld, `level-name = ${lvl}`, `No folder named "${lvl}" exists - the server will generate a new world on start.`);
  const vd = Number(props['view-distance']);
  add('view-distance', !Number.isFinite(vd) || (vd >= 3 && vd <= 32), `view-distance = ${props['view-distance'] ?? '(unset, default 10)'}`, 'view-distance above 32 is a common lag cause; keep it 6-12 for multiplayer.');
  const mp = Number(props['max-players']);
  add('max-players', !Number.isFinite(mp) || mp >= 1, `max-players = ${props['max-players'] ?? '(unset, default 20)'}`, 'max-players should be at least 1.');
  const sim = Number(props['simulation-distance']);
  add('simulation-distance', !Number.isFinite(sim) || (sim >= 3 && sim <= 32), `simulation-distance = ${props['simulation-distance'] ?? '(unset, default 10)'}`, 'simulation-distance above 32 is very heavy; keep it <= view-distance.');
  return checks;
}

// ---- Port availability ----
// Bind-test on 127.0.0.1: if WE can bind it, nothing else holds it. Never binds 0.0.0.0 (would
// briefly expose a port) and always releases immediately.
function checkPortFree(port) {
  return new Promise(resolve => {
    const p = Number(port);
    if (!Number.isInteger(p) || p < 1 || p > 65535) return resolve({ ok: false, free: null, error: 'Invalid port.' });
    const srv = net.createServer();
    let settled = false;
    const done = r => { if (settled) return; settled = true; try { srv.close(); } catch {} resolve(r); };
    srv.once('error', e => done({ ok: true, free: false, detail: `Port ${p} is in use (${e.code || e.message}).` }));
    srv.once('listening', () => done({ ok: true, free: true, detail: `Port ${p} is free.` }));
    try { srv.listen(p, '127.0.0.1'); } catch (e) { done({ ok: false, free: null, error: e?.message || String(e) }); }
    setTimeout(() => done({ ok: false, free: null, error: 'Port check timed out.' }), 3000);
  });
}

// ---- Composite health check ----
// Pure-ish: receives everything already gathered so it is testable without Electron. Each check
// has a level; `healthy` = no 'error' checks.
function diagnoseFromData(d) {
  d = d || {};
  const checks = [];
  const push = (id, level, detail, fix) => checks.push({ id, level, detail, fix: fix || null });
  // folder / jar
  if (!d.serverPath) push('server-folder', 'error', 'No server folder selected.', 'Choose a server folder in Settings.');
  else if (!d.hasJar && !d.hasLaunchScript) push('server-jar', 'error', 'No runnable server jar or run.bat/run.sh found.', 'Use the Create server wizard to download a server jar.');
  else push('server-jar', 'ok', `Runnable: ${d.jar || d.launchScript}.`);
  // java
  if (!d.java || !d.java.ok) push('java', 'error', 'Java was not detected.', 'Set a valid Java path in Settings, or use Install Java automatically.');
  else {
    if (d.javaRequired && d.javaMajor != null && d.javaMajor < d.javaRequired) push('java-version', 'error', `Server jar needs Java ${d.javaRequired}+ but detected Java ${d.javaMajor}.`, 'Install the required Java version and point Settings > Java at it.');
    else push('java', 'ok', `Java ${d.java.version} (${d.java.arch || 'unknown arch'}).`);
    if (d.java.arch === '32-bit' && Number(d.memoryMax) > 2) push('java-arch', 'warn', '32-bit Java cannot reliably use more than ~2GB of RAM.', 'Install 64-bit Java, or lower Maximum memory to 2GB or less.');
  }
  // eula
  push('eula', d.eulaAccepted ? 'ok' : 'warn', d.eulaAccepted ? 'EULA accepted.' : 'EULA not accepted yet.', d.eulaAccepted ? null : 'Accept the Minecraft EULA (Settings) or the server will refuse to start.');
  // port
  if (d.portFree === false) push('port', 'error', `Server port ${d.port} is already in use.`, 'Stop the other server or change server-port in server.properties.');
  else if (d.portFree === true) push('port', 'ok', `Server port ${d.port} is free.`);
  // world
  if (Array.isArray(d.worlds) && d.worlds.length) push('world', 'ok', `${d.worlds.length} world folder(s) found.`);
  else push('world', 'warn', 'No world folder found yet.', 'The server will generate a new world on first start.');
  // backups
  if (Array.isArray(d.backups) && d.backups.length) push('backup', 'ok', `${d.backups.length} backup(s) available.`);
  else push('backup', 'warn', 'No backups yet.', 'Create a backup before big changes; enable auto-backups in Settings.');
  // crash reports
  if (d.lastCrash) push('crash', 'warn', `Recent crash report: ${d.lastCrash}.`, 'Run explain_crash to see the cause.');
  const healthy = !checks.some(c => c.level === 'error');
  return { healthy, checks };
}

module.exports = {
  CONSOLE_RULES,
  signatureOf,
  analyzeConsoleLines,
  summarizeCrashText,
  latestCrashReport,
  validateProperties,
  checkPortFree,
  diagnoseFromData,
};
