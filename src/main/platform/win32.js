const { execFile } = require('child_process');
const { runPowerShell, psQuote } = require('../http.js');

// Find the real java.exe descendant of a root pid (handles cmd.exe -> java.exe via run.bat, and shim cases)
function findJavaDescendant(rootPid) {
  const script = `
$root=${Number(rootPid)}
try { $procs=Get-CimInstance Win32_Process -ErrorAction Stop | Select-Object ProcessId,ParentProcessId,Name,WorkingSetSize } catch { $procs=Get-WmiObject Win32_Process | Select-Object ProcessId,ParentProcessId,Name,WorkingSetSize }
if(-not $procs){ try{ $procs=Get-Process | Select-Object Id,@{N='ProcessId';E={$_.Id}},@{N='ParentProcessId';E={0}},@{N='Name';E={$_.ProcessName+'.exe'}},@{N='WorkingSetSize';E={$_.WorkingSet64}} }catch{} }
$queue=New-Object System.Collections.Generic.Queue[int]
$queue.Enqueue($root)
$visited=New-Object System.Collections.Generic.HashSet[int]
$candidates=New-Object System.Collections.Generic.List[object]
while($queue.Count -gt 0){
  $cur=$queue.Dequeue()
  if(-not $visited.Add($cur)){continue}
  $node=$procs | Where-Object { $_.ProcessId -eq $cur }
  if($node -and $node.Name -match '^java(w)?\\.exe$'){ $candidates.Add($node) }
  $procs | Where-Object { $_.ParentProcessId -eq $cur } | ForEach-Object { $queue.Enqueue($_.ProcessId) }
}
if($candidates.Count -gt 0){
  $best = $candidates | Sort-Object WorkingSetSize -Descending | Select-Object -First 1
  "$($best.ProcessId)"
} elseif((Get-Process -Id $root -ErrorAction SilentlyContinue).ProcessName -match '^java(w)?$'){ "$root" }
`.trim();
  return runPowerShell(script).then(r => {
    const id = parseInt(String(r.stdout).trim(), 10);
    return Number.isFinite(id) ? id : null;
  }).catch(()=>null);
}

// Process identity for orphan cleanup (v2.0.0). Returns { alive, name, startTimeMs }
// for a pid, or null if it is not running. startTimeMs (process creation time) is
// unique per process lifetime and is what lets orphan cleanup detect PID REUSE
// before killing: a reused pid (different creation time) must NEVER be killed.
async function getProcessInfo(pid) {
  const n = Number(pid);
  if (!Number.isFinite(n) || n <= 0) return null;
  const script = `[System.Threading.Thread]::CurrentThread.CurrentCulture=[cultureinfo]::InvariantCulture;
$p=Get-CimInstance Win32_Process -Filter "ProcessId=${n}" -ErrorAction SilentlyContinue;
if(-not $p){ exit 2 };
"$($p.Name)|$(([DateTimeOffset]$p.CreationDate).ToUnixTimeMilliseconds())"`;
  try {
    const r = await runPowerShell(script, 8000);
    if (!r.ok || !r.stdout || !r.stdout.trim()) return null;
    const [name, ms] = String(r.stdout).trim().split('|');
    const startTimeMs = Number(ms);
    return { alive: true, name: name || null, startTimeMs: Number.isFinite(startTimeMs) ? startTimeMs : null };
  } catch { return null; }
}

async function getProcessMetrics(pid) {
  // BUGFIX: PowerShell string output uses the CURRENT CULTURE — on a
  // vi-VN / de-DE / pt-BR system, TotalSeconds prints "45,6712" (comma).
  // Number("45,6712")===NaN, which poisoned the CPU calc into a permanent
  // 0% (previousCpu never updates). Force InvariantCulture so decimals are
  // always "." regardless of the user's Windows language.
  const script = `[System.Threading.Thread]::CurrentThread.CurrentCulture=[cultureinfo]::InvariantCulture;
$p=Get-Process -Id ${Number(pid)} -ErrorAction SilentlyContinue;if(-not $p){ exit 1 };$c=0;try{$c=$p.TotalProcessorTime.TotalSeconds}catch{try{$c=$p.CPU}catch{}};try{ $ws=$p.WorkingSet64 }catch{ $ws=0 }; if($ws -eq 0){ try{ $ws=(Get-CimInstance Win32_Process -Filter "ProcessId=${Number(pid)}" -ErrorAction SilentlyContinue).WorkingSetSize }catch{} }; "$([math]::Round($ws/1MB,2))|$([math]::Round($c,3))"`;
  const r = await runPowerShell(script);
  if (!r.stdout || !r.stdout.trim()) {
    // Fallback via wmic/tasklist if PowerShell Get-Process failed (e.g., 32/64-bit mismatch or policy)
    try{
      const { execFile } = require('child_process');
      const wmic = await new Promise(res=> execFile('wmic', ['process','where',`ProcessId=${Number(pid)}`,'get','WorkingSetSize','/value'], {windowsHide:true, timeout:4000}, (e,stdout)=> res(stdout||'')));
      const m=wmic.match(/WorkingSetSize=(\d+)/); if(m){ const mb=Math.round(Number(m[1])/1024/1024); return { memoryMB: mb, cpuTime: 0 }; }
    }catch{}
    return null;
  }
  const [memRaw, cpuRaw] = String(r.stdout).trim().split('|');
  const mem = Number(memRaw), cpu = Number(cpuRaw);
  if (!Number.isFinite(mem) && !Number.isFinite(cpu)) return null;
  return { memoryMB: Number.isFinite(mem) ? mem : 0, cpuTime: Number.isFinite(cpu) ? cpu : 0 };
}

async function createBackup({ serverPath, worlds, destZip }) {
  // PARITY with Linux: world names come from disk scanning but are still validated — a name
  // starting with `-` would be parsed as a CLI flag, `/` or `..` would archive outside serverPath.
  const { isSafeWorldName } = require('../validate.js');
  const safeWorlds = Array.isArray(worlds) ? worlds.filter(isSafeWorldName) : [];
  if (!safeWorlds.length) return { ok: false, error: 'No valid world folders to back up.' };
  const paths = safeWorlds.map(w => psQuote(require('path').join(serverPath, w))).join(',');
  const r = await runPowerShell(`Compress-Archive -LiteralPath @(${paths}) -DestinationPath ${psQuote(destZip)} -Force`, 300000);
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

async function restoreBackup({ destPath, zipPath }) {
  const r = await runPowerShell(`Expand-Archive -LiteralPath ${psQuote(zipPath)} -DestinationPath ${psQuote(destPath)} -Force`, 300000);
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

async function allowFirewall(port) {
  // BUGFIX (command injection): `port` arrives from the renderer and used to be
  // interpolated raw into `-LocalPort ${port}` inside an ELEVATED PowerShell
  // (UAC). A value like `80; Remove-Item C:\...` would run as admin. Validate
  // here too (defense in depth — the IPC layer already checks) and only ever
  // interpolate the coerced integer.
  const { isValidPort } = require('../validate.js');
  const p = isValidPort(port);
  if (p === null) return { ok: false, error: 'Invalid port.' };
  const ruleName = `ObserverLauncher-${p}`;
  const innerScript = `if (-not (Get-NetFirewallRule -DisplayName '${ruleName.replace(/'/g, "''")}' -ErrorAction SilentlyContinue)) { New-NetFirewallRule -DisplayName '${ruleName.replace(/'/g, "''")}' -Direction Inbound -Protocol TCP -LocalPort ${p} -Action Allow -ErrorAction Stop }`;
  const encoded = Buffer.from(innerScript, 'utf16le').toString('base64');
  const outer = `$p = Start-Process powershell -ArgumentList '-NoProfile -EncodedCommand ${encoded}' -Verb RunAs -Wait -PassThru; exit $p.ExitCode`;
  const r = await runPowerShell(outer, 120000);
  return r.ok ? { ok: true } : { ok: false, error: r.error || 'Could not create firewall rule — UAC dismissed or rule exists.' };
}

module.exports = { findJavaDescendant, getProcessInfo, getProcessMetrics, createBackup, restoreBackup, allowFirewall, extractArchive, createArchive };

// Cross-platform archive helpers used by the Java installer and .mrpack import/export.
// Windows side wraps PowerShell's Expand-Archive / Compress-Archive (unchanged behaviour).
async function extractArchive(archivePath, destDir) {
  // PARITY with Linux: list entries first and refuse the archive on the first unsafe path. .NET's
  // Expand-Archive already blocks traversal itself, but this makes the two platforms behave the
  // same and fails with a clear message instead of a partial extract.
  const { isSafeArchiveEntry } = require('../validate.js');
  try {
    const list = await runPowerShell(`Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::OpenRead(${psQuote(archivePath)}).Entries | ForEach-Object { $_.FullName }`, 30000);
    const entries = (list.stdout || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    const bad = entries.find(e => !isSafeArchiveEntry(e));
    if (bad) return { ok: false, error: `Archive contains an unsafe path ("${bad}") — extraction stopped for safety.` };
  } catch {}
  const r = await runPowerShell(`Expand-Archive -LiteralPath ${psQuote(archivePath)} -DestinationPath ${psQuote(destDir)} -Force`, 300000);
  return r.ok ? { ok: true } : { ok: false, error: r.error || 'Could not extract the archive.' };
}
async function createArchive(srcPath, destArchive) {
  // PARITY with Linux: archive the CONTENTS of srcPath, not the folder itself. Linux runs the tool
  // with cwd=srcPath and `.`; on Windows we append \* so a .mrpack has files at its root (Modrinth
  // format), not wrapped in a folder named after the staging dir.
  const r = await runPowerShell(`Compress-Archive -Path ${psQuote(srcPath + '\\*')} -DestinationPath ${psQuote(destArchive)} -Force`, 300000);
  return r.ok ? { ok: true } : { ok: false, error: r.error || 'Could not create the archive.' };
}
