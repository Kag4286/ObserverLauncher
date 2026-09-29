// docker.test.js — Docker generator + `observer docker create` (v3.1.0 Phase D). PURE, no Docker needed.
//
// WHY: the headless core already runs with no window; Docker is the packaging on top. The generated
// Dockerfile/compose must bake a JDK, run the headless entry point, mount the server + data volumes,
// and healthcheck. This locks that contract without a Docker daemon.
const fs = require('fs');
const os = require('os');
const path = require('path');

const docker = require('../src/main/docker.js');
const cli = require('../src/cli.js');

let pass = 0, fail = 0;
const check = (name, cond, detail) => cond ? (pass++, console.log('PASS', name)) : (fail++, console.log('FAIL', name + (detail ? ' — ' + detail : '')));

// normalizeOpts: defaults + clamps.
{
  const o = docker.normalizeOpts({});
  check('defaults: paper / latest / 4G / 25565 / java 21', o.type === 'paper' && o.version === 'latest' && o.ram === 4 && o.port === 25565 && o.javaVersion === 21, JSON.stringify(o));
  check('unknown type falls back to paper', docker.normalizeOpts({ type: 'nope' }).type === 'paper');
  check('ram clamped 1..64', docker.normalizeOpts({ ram: 999 }).ram === 64 && docker.normalizeOpts({ ram: -5 }).ram === 1);
  check('ram 0/missing -> default 4', docker.normalizeOpts({ ram: 0 }).ram === 4);
  check('bad port -> 25565', docker.normalizeOpts({ port: 99999 }).port === 25565);
  check('mods split/filtered', JSON.stringify(docker.normalizeOpts({ mods: ['a', ' ', 'b'] }).mods) === JSON.stringify(['a', 'b']));
}

// Dockerfile contract.
{
  const df = docker.dockerfile({ type: 'fabric', ram: 6, port: 25566, javaVersion: 21 });
  check('Dockerfile uses a temurin JRE base', /FROM eclipse-temurin:21-jre/.test(df));
  check('Dockerfile runs the headless entry point', /ENTRYPOINT \["node", "src\/headless.js"\]/.test(df));
  check('Dockerfile sets OBSERVER_DATA_DIR', /OBSERVER_DATA_DIR=\/data/.test(df));
  check('Dockerfile has a HEALTHCHECK', /HEALTHCHECK/.test(df));
  check('Dockerfile EXPOSEs the port', /EXPOSE 25566/.test(df));
  check('Dockerfile installs nodejs + zip/unzip', /nodejs zip unzip/.test(df));
}

// compose contract.
{
  const c = docker.composeFile({ type: 'paper', port: 25565 });
  check('compose maps the port', /"25565:25565"/.test(c));
  check('compose mounts ./server and ./data', /- .\/server:\/server/.test(c) && /- .\/data:\/data/.test(c));
  check('compose sets OBSERVER_DATA_DIR env', /OBSERVER_DATA_DIR: \/data/.test(c));
  check('compose restart policy', /restart: unless-stopped/.test(c));
  check('compose healthcheck uses the CLI', /src\/cli.js", "status/.test(c));
}

// .dockerignore must exclude local data/server + secrets.
{
  const di = docker.dockerignore();
  check('.dockerignore excludes data + server + node_modules', /(^|\n)data(\n|$)/.test(di) && /(^|\n)server(\n|$)/.test(di) && /node_modules/.test(di));
}

(async () => {
  // CLI: docker create writes 4 files (in-process).
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ol-docker-'));
  process.env.OBSERVER_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ol-docker-data-'));
  const out = path.join(dir, 'gen');
  const r = await cli.run(['docker', 'create', '--type', 'paper', '--ram', '4', '--out', out, '--json'], { print: false });
  check('docker create exits 0', r.ok === true && r.code === 0, JSON.stringify(r));
  for (const f of ['Dockerfile', 'docker-compose.yml', '.dockerignore', 'README.docker.md']) {
    check('wrote ' + f, fs.existsSync(path.join(out, f)));
  }
  // unknown subcommand -> usage error.
  const bad = await cli.run(['docker', 'nope'], { print: false });
  check('docker unknown subcommand -> exit 2', bad.code === 2);

  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  console.log(fail ? `\n${fail} check(s) failed.` : `\nAll docker checks passed (${pass}).`);
  process.exit(fail ? 1 : 0);
})();
