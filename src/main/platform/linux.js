const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

function exec(cmd, args, timeout = 10000) {
  return new Promise(resolve => {
    execFile(cmd, args, { timeout }, (error, stdout, stderr) => {
      resolve({ ok: !error, stdout: stdout || '', stderr: stderr || '', error: error ? (stderr || error.message) : null });
    });
  });
}

// Shared spawn+timeout wrapper for the zip/tar archive tools (used by createBackup AND createArchive,
// which had this block copied verbatim). Resolves { ok, error } - an early kill or a non-zero exit is
// a failure, never a throw.
function runArchiveTool(cmd, args, cwd, timeoutMs = 300000) {
  return new Promise(resolve => {
    const { spawn } = require('child_process');
    const proc = spawn(cmd, args, { cwd });
    let stderr = '';
    let settled = false;
    const done = v => { if (!settled) { settled = true; clearTimeout(timer); resolve(v); } };
    const timer = setTimeout(() => { try { proc.kill(); } catch {} done({ ok: false, error: `${cmd} timed out` }); }, timeoutMs);
    proc.stderr.on('data', d => { stderr += d.toString(); });
    proc.on('error', err => done({ ok: false, error: err.message }));
    proc.on('close', code => done(code === 0 ? { ok: true } : { ok: false, error: stderr || `${cmd} exited with ${code}` }));
  });
}

// BUGFIX: `ps -o cputime=` can output [DD-]HH:MM:SS once a process has used more than
// 24 hours of CPU time (common for a Minecraft server left running for days). The old
// `split(':')` parser silently produced NaN and a permanent 0% CPU reading after that
// point. This helper handles DD-HH:MM:SS, HH:MM:SS, and MM:SS formats.
function parseCpuTime(raw) {
  const s = String(raw || '').trim();
  if (!s || !/^[\d.-]+(?::\d{1,2}){1,2}$/.test(s)) return 0;
  let days = 0;
  let rest = s;
  const dash = s.indexOf('-');
  if (dash !== -1) {
    days = Number(s.slice(0, dash)) || 0;
    rest = s.slice(dash + 1);
  }
  const segs = rest.split(':').map(Number).reverse();
  let total = 0;
  total += segs[0] || 0; // seconds
  total += (segs[1] || 0) * 60; // minutes
  total += (segs[2] || 0) * 3600; // hours
  total += days * 86400;
  return total;
}

// Breadth-first walk from rootPid collecting every descendant that isJava(pid) says is a java
// process. getChildren(pid) yields that process's direct children. Shared by the /proc and ps
// paths of findJavaDescendant so the two traversals cannot drift apart (gotcha #20).
function collectJavaPids(rootPid, isJava, getChildren) {
  const queue = [Number(rootPid)];
  const visited = new Set();
  const found = [];
  while (queue.length) {
    const cur = queue.shift();
    if (visited.has(cur)) continue;
    visited.add(cur);
    if (isJava(cur)) found.push(cur);
    for (const pid of getChildren(cur)) queue.push(pid);
  }
  return found;
}

// Walk /proc to find matching descendant, or use ps
async function findLinuxDescendant(rootPid, filterFn) {
  try {
    const all = fs.readdirSync('/proc').filter(n => /^\d+$/.test(n)).map(n => Number(n));
    const map = new Map();
    for (const pid of all) {
      try {
        const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
        const m = stat.match(/^\d+ \((.+)\) \S (\d+)/);
        if (m) map.set(pid, { comm: m[1], ppid: Number(m[2]) });
      } catch {}
    }
    const childrenOf = (pid) => { const a = []; for (const [p, info] of map.entries()) if (info.ppid === pid) a.push(p); return a; };
    const candidates = collectJavaPids(rootPid, pid => { const n = map.get(pid); return !!(n && filterFn(n.comm)); }, childrenOf);
    if (candidates.length) {
      let best = candidates[0], bestRss = 0;
      for (const pid of candidates) {
        try {
          const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
          const m = status.match(/VmRSS:\s+(\d+)\s+kB/);
          const rss = m ? Number(m[1]) : 0;
          if (rss > bestRss) { bestRss = rss; best = pid; }
        } catch {}
      }
      return best;
    }
  } catch {}
  const r = await exec('ps', ['-eo', 'pid,ppid,comm', '--no-headers']);
  if (!r.ok) return null;
  const lines = r.stdout.trim().split('\n').map(l => {
    const m = l.trim().match(/^(\d+)\s+(\d+)\s+(\S+)/);
    return m ? { pid: Number(m[1]), ppid: Number(m[2]), comm: m[3] } : null;
  }).filter(Boolean);
  const map = new Map(lines.map(n => [n.pid, n]));
  const childrenOf = (pid) => { const a = []; for (const n of lines) if (n.ppid === pid) a.push(n.pid); return a; };
  const cands = collectJavaPids(rootPid, pid => { const n = map.get(pid); return !!(n && filterFn(n.comm)); }, childrenOf);
  return cands[0] || null;
}

function findJavaDescendant(rootPid) {
  return findLinuxDescendant(rootPid, comm => /^java$/.test(comm));
}

function findServerDescendant(rootPid) {
  return findLinuxDescendant(rootPid, () => true).then(id => id || Number(rootPid));
}

// Process identity for orphan cleanup (v2.0.0). /proc/<pid>/stat field 22 is the
// process start time in clock ticks since boot; /proc/stat btime is the boot time
// in epoch seconds -> an absolute creation time, unique per process lifetime. Used
// to detect PID REUSE before killing (tier-3 orphan must NEVER be killed). A zombie
// (state 'Z') is already terminated -> reported as not alive. Returns
// { alive, name, startTimeMs } or null if the pid is not running.
function getProcessInfo(pid) {
  const n = Number(pid);
  if (!Number.isFinite(n) || n <= 0) return null;
  let stat;
  try { stat = fs.readFileSync(`/proc/${n}/stat`, 'utf8'); } catch { return null; }
  // comm (field 2) is wrapped in the FIRST '(' and LAST ')' and may contain spaces.
  const open = stat.indexOf('(');
  const close = stat.lastIndexOf(')');
  if (open === -1 || close === -1) return null;
  const comm = stat.slice(open + 1, close);
  const rest = stat.slice(close + 2).trim().split(/\s+/);
  if (rest[0] === 'Z') return null; // zombie = already exited, nothing to kill
  // rest[0] = state (field 3) -> field N is rest[N - 3]; starttime is field 22.
  const startTicks = Number(rest[19]);
  let btimeSec = 0;
  try {
    const m = fs.readFileSync('/proc/stat', 'utf8').match(/^btime\s+(\d+)/m);
    if (m) btimeSec = Number(m[1]);
  } catch {}
  const HZ = 100; // CLK_TCK is 100 on essentially every Linux; only used for PID-reuse detection.
  const startTimeMs = Number.isFinite(startTicks) && btimeSec ? Math.round((btimeSec + startTicks / HZ) * 1000) : null;
  return { alive: true, name: comm, startTimeMs };
}

async function getProcessMetrics(pid) {
  // Try /proc first
  try {
    const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
    const rssMatch = status.match(/VmRSS:\s+(\d+)\s+kB/);
    const rssKB = rssMatch ? Number(rssMatch[1]) : 0;
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    // utime (14) + stime (15) are in clock ticks
    const parts = stat.split(' ');
    // comm may contain spaces, so find the last ')' then split after
    const after = stat.substring(stat.lastIndexOf(')') + 2).split(' ');
    // after[11] = utime, after[12] = stime (0-indexed after the split, but need correct)
    // Simpler: use ps for cpu
    const ps = await exec('ps', ['-p', String(pid), '-o', 'cputime=', '--no-headers']);
    let cpuTime = 0;
    if (ps.ok) {
      cpuTime = parseCpuTime(ps.stdout);
    }
    return { memoryMB: Math.round(rssKB / 1024), cpuTime };
  } catch {
    // fallback ps
    const r = await exec('ps', ['-p', String(pid), '-o', 'rss=,cputime=', '--no-headers']);
    if (!r.ok) return null;
    const m = r.stdout.trim().match(/^(\d+)\s+(\S+)/);
    if (!m) return null;
    const rssKB = Number(m[1]);
    const cpuTime = parseCpuTime(m[2]);
    return { memoryMB: Math.round(rssKB / 1024), cpuTime };
  }
}

async function createBackup({ serverPath, worlds, destZip }) {
  // BUGFIX: the first zip/tar attempt used to run WITHOUT cwd=serverPath while the world folder
  // names are relative — so it failed EVERY time ("cannot stat world") and every backup silently
  // paid for a doomed process before falling back to a retry that did set cwd. Run whichever tool
  // is available directly with the right working directory; no doomed first attempt.
  // SECURITY: world names come from disk scanning but are still validated — a name starting
  // with `-` would be parsed as a CLI flag, and `/` or `..` would archive outside serverPath.
  const { isSafeWorldName } = require('../validate.js');
  const safeWorlds = Array.isArray(worlds) ? worlds.filter(isSafeWorldName) : [];
  if (!safeWorlds.length) return { ok: false, error: 'No valid world folders to back up.' };
  const hasZip = await exec('which', ['zip']).then(r => r.ok);
  const hasTar = await exec('which', ['tar']).then(r => r.ok);
  if (!hasZip && !hasTar) return { ok: false, error: 'Backup needs either "zip" or "tar" on this system — install one (e.g. sudo apt install zip) and try again.' };
  const cmd = hasZip ? 'zip' : 'tar';
  const args = hasZip ? ['-r', destZip, '--', ...safeWorlds] : ['-czf', destZip, '--', ...safeWorlds];
  return runArchiveTool(cmd, args, serverPath);
}

// SECURITY (zip-slip + polyglot defense): list entries AND record which tool parsed the archive,
// then extract ONLY with that exact format tool — never fall back from unzip to tar on a polyglot.
async function extractVerifiedArchive(archivePath, destDir, label) {
  const { isSafeArchiveEntry } = require('../validate.js');
  let listed = null;
  try { listed = await listArchiveEntriesWithFormat(archivePath); } catch { listed = null; }
  if (!listed || !listed.entries) return { ok: false, error: `Could not read the ${label} to verify it is safe (unsupported or corrupt format) — stopped.` };
  const bad = listed.entries.find(e => !isSafeArchiveEntry(e));
  if (bad) return { ok: false, error: `${label} contains an unsafe path ("${bad}") — stopped for safety.` };
  if (listed.format === 'zip') {
    const r = await exec('unzip', ['-o', '--', archivePath, '-d', destDir], 300000);
    return r.ok ? { ok: true } : { ok: false, error: r.error || `Could not extract zip ${label} (unzip failed).` };
  }
  const r = await exec('tar', ['--no-same-owner', '-xzf', archivePath, '-C', destDir], 300000);
  return r.ok ? { ok: true } : { ok: false, error: r.error || `Could not extract tar ${label}.` };
}

async function restoreBackup({ destPath, zipPath }) {
  return extractVerifiedArchive(zipPath, destPath, 'backup archive');
}

async function listArchiveEntriesWithFormat(zipPath) {
  const zipList = await exec('unzip', ['-Z1', zipPath], 30000);
  if (zipList.ok && zipList.stdout.trim()) {
    // Reject archives containing symlinks (zipinfo -Z -l starts symlink mode lines with 'l')
    const zipModes = await exec('unzip', ['-Z', '-l', zipPath], 30000);
    if (zipModes.ok && (zipModes.stdout || '').split(/\r?\n/).some(line => /^l[rwx-]{9}/i.test(line.trim()))) {
      return { format: 'zip', entries: ['../symlink-rejected'] };
    }
    return { format: 'zip', entries: zipList.stdout.split(/\r?\n/).map(s => s.trim()).filter(Boolean) };
  }
  const tarList = await exec('tar', ['-tzf', zipPath], 30000);
  if (tarList.ok && tarList.stdout.trim()) {
    const tarModes = await exec('tar', ['-tvzf', zipPath], 30000);
    if (tarModes.ok && (tarModes.stdout || '').split(/\r?\n/).some(line => /^[lh][rwx-]{9}/i.test(line.trim()))) {
      return { format: 'tar', entries: ['../symlink-rejected'] };
    }
    return { format: 'tar', entries: tarList.stdout.split(/\r?\n/).map(s => s.trim()).filter(Boolean) };
  }
  return null;
}

// Backward-compatible wrapper returning entry array or null.
async function listArchiveEntries(zipPath) {
  const listed = await listArchiveEntriesWithFormat(zipPath);
  return listed ? listed.entries : null;
}

async function allowFirewall(port) {
  const { isValidPort } = require('../validate.js');
  const p = isValidPort(port);
  if (p === null) return { ok: false, error: 'Invalid port.' };
  return {
    ok: false,
    error: `On Linux, please allow port ${p}/tcp manually: sudo ufw allow ${p}/tcp  — or configure your firewall/iptables. The launcher does not request sudo automatically.`
  };
}

module.exports = { findJavaDescendant, findServerDescendant, getProcessInfo, getProcessMetrics, createBackup, restoreBackup, allowFirewall, listArchiveEntries, extractArchive, createArchive };

// Cross-platform archive helpers (Linux side). .zip -> unzip, .tar.gz/.tgz -> tar.
async function extractArchive(archivePath, destDir) {
  return extractVerifiedArchive(archivePath, destDir, 'archive');
}
async function createArchive(srcPath, destArchive) {
  // srcPath is the staging folder; archive its CONTENTS into destArchive.
  const hasZip = await exec('which', ['zip']).then(r => r.ok);
  const args = hasZip ? ['-r', destArchive, '.'] : ['-czf', destArchive, '.'];
  const cmd = hasZip ? 'zip' : 'tar';
  return runArchiveTool(cmd, args, srcPath);
}
