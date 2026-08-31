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

// Walk /proc to find java descendant, or use ps
async function findJavaDescendant(rootPid) {
  // Try reading /proc
  try {
    const all = fs.readdirSync('/proc').filter(n => /^\d+$/.test(n)).map(n => Number(n));
    const map = new Map(); // pid -> {ppid, comm}
    for (const pid of all) {
      try {
        const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
        // stat format: pid (comm) state ppid ...
        const m = stat.match(/^\d+ \((.+)\) \S (\d+)/);
        if (m) map.set(pid, { comm: m[1], ppid: Number(m[2]) });
      } catch {}
    }
    // BFS from root
    const queue = [Number(rootPid)];
    const visited = new Set();
    const candidates = [];
    while (queue.length) {
      const cur = queue.shift();
      if (visited.has(cur)) continue;
      visited.add(cur);
      const node = map.get(cur);
      if (node && /^java$/.test(node.comm)) candidates.push(cur);
      // find children
      for (const [pid, info] of map.entries()) {
        if (info.ppid === cur) queue.push(pid);
      }
    }
    if (candidates.length) {
      // pick one with largest rss
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
  // Fallback to ps
  const r = await exec('ps', ['-eo', 'pid,ppid,comm', '--no-headers']);
  if (!r.ok) return null;
  const lines = r.stdout.trim().split('\n').map(l => {
    const m = l.trim().match(/^(\d+)\s+(\d+)\s+(\S+)/);
    return m ? { pid: Number(m[1]), ppid: Number(m[2]), comm: m[3] } : null;
  }).filter(Boolean);
  const map = new Map(lines.map(n => [n.pid, n]));
  const queue = [Number(rootPid)];
  const visited = new Set();
  const cands = [];
  while (queue.length) {
    const cur = queue.shift();
    if (visited.has(cur)) continue;
    visited.add(cur);
    const node = map.get(cur);
    if (node && /^java$/.test(node.comm)) cands.push(cur);
    for (const n of lines) if (n.ppid === cur) queue.push(n.pid);
  }
  return cands[0] || null;
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
  const hasZip = await exec('which', ['zip']).then(r => r.ok);
  const cmd = hasZip ? 'zip' : 'tar';
  const args = hasZip ? ['-r', destZip, ...worlds] : ['-czf', destZip, ...worlds];
  return new Promise(resolve => {
    const { spawn } = require('child_process');
    const proc = spawn(cmd, args, { cwd: serverPath });
    let stderr = '';
    proc.stderr.on('data', d => { stderr += d.toString(); });
    proc.on('error', err => resolve({ ok: false, error: err.message }));
    proc.on('close', code => resolve(code === 0 ? { ok: true } : { ok: false, error: stderr || `${cmd} exited with ${code}` }));
    setTimeout(() => { try { proc.kill(); } catch {} resolve({ ok: false, error: `${cmd} timed out` }); }, 300000);
  });
}

async function restoreBackup({ destPath, zipPath }) {
  // try unzip first (handles both zip and tar.gz if bsdtar)
  const hasUnzip = await exec('which', ['unzip']).then(r => r.ok);
  if (hasUnzip) {
    const r = await exec('unzip', ['-o', zipPath, '-d', destPath], 300000);
    if (r.ok) return { ok: true };
    // fallback to tar
  }
  const r = await exec('tar', ['-xzf', zipPath, '-C', destPath], 300000);
  return r.ok ? { ok: true } : { ok: false, error: r.error || 'Could not extract backup (needs unzip or tar)' };
}

async function allowFirewall(port) {
  return {
    ok: false,
    error: `On Linux, please allow port ${port}/tcp manually: sudo ufw allow ${port}/tcp  — or configure your firewall/iptables. The launcher does not request sudo automatically.`
  };
}

module.exports = { findJavaDescendant, getProcessMetrics, createBackup, restoreBackup, allowFirewall };
