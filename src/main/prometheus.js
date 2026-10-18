// prometheus.js — Prometheus /metrics endpoint for Grafana scrape (v6.0.0 F4).
//
// WHY: a self-hoster who already runs Grafana wants TPS/RAM/players in the same dashboard as
// the rest of their machine. This exposes those numbers in the Prometheus text exposition format
// on a SECOND loopback port, never on the remote port. Read-only: it never starts, stops or edits
// anything. No token (loopback only), but the same Host + Origin guard as remote.js so a browser
// on the same machine cannot be tricked into scraping it via DNS rebinding.
//
// Format reference: https://prometheus.io/docs/instrumenting/exposition_formats/
//   # HELP <name> <description>
//   # TYPE <name> gauge
//   <name>{label="value"} <number>
//
// The FORMAT is a pure function of the snapshot array so it is unit-tested without a server.
const http = require('http');
const { originOk, ipIsLoopback } = require('./http-guard.js');

// Pure: escape a label value per the Prometheus spec (backslash, double-quote, newline).
function escapeLabel(v) {
  return String(v == null ? '' : v).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

// Pure: render one instance row into the four metric families. A null value is OMITTED (Prometheus
// treats a missing sample as 'no data', which is what a stopped server actually is).
//   row = { id, name, group, status, running, tps, mspt, cpu, ram, players, uptimeMs }
function renderInstance(row) {
  const labels = `instance="${escapeLabel(row.id)}",name="${escapeLabel(row.name || row.id)}",group="${escapeLabel(row.group || '')}"`;
  const lines = [];
  const push = (name, value) => {
    if (value == null || !Number.isFinite(Number(value))) return;
    lines.push(`${name}{${labels}} ${Number(value)}`);
  };
  // status is an ENUM as a number: 0 stopped, 1 starting, 2 running, 3 stopping. A Grafana panel can
  // colour by it and a stopped server is a real value (unlike TPS, which is absent while stopped).
  const statusNum = row.status === 'running' ? 2 : row.status === 'starting' ? 1 : row.status === 'stopping' ? 3 : 0;
  lines.push(`observerlauncher_server_status{${labels}} ${statusNum}`);
  push('observerlauncher_tps', row.tps);
  push('observerlauncher_mspt', row.mspt);
  push('observerlauncher_cpu_percent', row.cpu);
  push('observerlauncher_ram_percent', row.ram);
  push('observerlauncher_players', row.players);
  push('observerlauncher_uptime_seconds', row.uptimeMs ? Math.floor(Number(row.uptimeMs) / 1000) : null);
  return lines;
}

// Pure: render the whole /metrics body. `rows` is the array buildSnapshots returns (instances-snapshot).
// `version` is included as an info metric with a constant value of 1 (the conventional Prometheus
// way to expose build labels without a real sample).
function renderMetrics(rows, version) {
  const out = [];
  out.push('# HELP observerlauncher_info Build info for the launcher itself.');
  out.push('# TYPE observerlauncher_info gauge');
  out.push(`observerlauncher_info{version="${escapeLabel(version || 'dev')}"} 1`);
  out.push('# HELP observerlauncher_server_status 0=stopped 1=starting 2=running 3=stopping.');
  out.push('# TYPE observerlauncher_server_status gauge');
  out.push('# HELP observerlauncher_tps Server ticks per second (absent while stopped).');
  out.push('# TYPE observerlauncher_tps gauge');
  out.push('# HELP observerlauncher_mspt Server milliseconds per tick (absent while stopped).');
  out.push('# TYPE observerlauncher_mspt gauge');
  out.push('# HELP observerlauncher_cpu_percent Server CPU percent (absent while stopped).');
  out.push('# TYPE observerlauncher_cpu_percent gauge');
  out.push('# HELP observerlauncher_ram_percent Server heap use against the allocated max (absent while stopped).');
  out.push('# TYPE observerlauncher_ram_percent gauge');
  out.push('# HELP observerlauncher_players Online player count.');
  out.push('# TYPE observerlauncher_players gauge');
  out.push('# HELP observerlauncher_uptime_seconds Seconds since the server reached running (absent while stopped).');
  out.push('# TYPE observerlauncher_uptime_seconds gauge');
  const seriesLines = [];
  for (const r of (Array.isArray(rows) ? rows : [])) seriesLines.push(...renderInstance(r));
  // No per-family interleaving: emit each series line grouped under its family header. Prometheus
  // accepts any order; grouping matches the header block above for readability.
  const families = ['observerlauncher_server_status', 'observerlauncher_tps', 'observerlauncher_mspt', 'observerlauncher_cpu_percent', 'observerlauncher_ram_percent', 'observerlauncher_players', 'observerlauncher_uptime_seconds'];
  for (const fam of families) {
    for (const line of seriesLines) if (line.startsWith(fam + '{')) out.push(line);
  }
  return out.join('\n') + '\n';
}

// Guard order (same shape as remote.js): Origin/Host -> loopback IP -> handler. No token because
// the endpoint binds 127.0.0.1 only and never leaves the machine. An empty Origin (curl, Grafana's
// node exporter scraper) is allowed; a cross-origin browser Origin is refused.
function createPrometheusServer(opts) {
  const o = opts || {};
  const hostHdr = require('./validate.js').hostFromHeader;
  const server = http.createServer((req, res) => {
    if (!originOk(req)) { res.writeHead(403); return res.end('forbidden'); }
    const h = hostHdr(req.headers['host']);
    const hostOk = !h || h === '127.0.0.1' || h === 'localhost' || h === '::1' || h === '[::1]';
    if (!hostOk) { res.writeHead(403); return res.end('forbidden'); }
    if (!ipIsLoopback(req)) { res.writeHead(403); return res.end('forbidden'); }
    if (req.method !== 'GET' || req.url !== '/metrics') { res.writeHead(404); return res.end('not found'); }
    let body;
    try { body = renderMetrics(o.snapshot && o.snapshot(), o.version); }
    catch { res.writeHead(500); return res.end('scrape failed'); }
    res.writeHead(200, { 'content-type': 'text/plain; version=0.0.4; charset=utf-8', 'cache-control': 'no-cache' });
    res.end(body);
  });
  return {
    server,
    port: () => (server.address() && server.address().port) || 0,
    listen: () => new Promise((resolve, reject) => { server.once('error', reject); server.listen(Number(o.port) || 0, '127.0.0.1', () => resolve(server.address().port)); }),
    close: () => { try { server.close(); } catch {} },
  };
}

// Lifecycle: build + start the loopback server from settings. Uses the SAME snapshot builder as the
// cross-instance dashboard (instances-snapshot.js buildSnapshots) so the two views cannot drift.
async function startPrometheus(ctx) {
  const { loadSettings } = require('./settings.js');
  let s; try { s = loadSettings(); } catch { s = {}; }
  if (!s.prometheusEnabled) return null;
  const { buildSnapshots } = require('./instances-snapshot.js');
  const { listInstances } = require('./settings.js');
  const version = (() => { try { return require('../../package.json').version; } catch { return 'dev'; } })();
  const srv = createPrometheusServer({
    port: Number(s.prometheusPort) || 0,
    version,
    snapshot: () => {
      const list = listInstances().instances;
      return buildSnapshots(list, (id) => (ctx.instances ? ctx.instances.get(id) : null));
    },
  });
  const port = await srv.listen();
  ctx.prometheusServer = srv; ctx.prometheusPort = port;
  return { port };
}
function stopPrometheus(ctx) {
  try { if (ctx.prometheusServer) ctx.prometheusServer.close(); } catch {}
  ctx.prometheusServer = null; ctx.prometheusPort = 0;
}

module.exports = { escapeLabel, renderInstance, renderMetrics, createPrometheusServer, startPrometheus, stopPrometheus };
