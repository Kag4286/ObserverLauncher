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

async function getProcessMetrics(pid) {
  const script = `$p=Get-Process -Id ${Number(pid)} -ErrorAction SilentlyContinue;if(-not $p){ exit 1 };$c=0;try{$c=$p.TotalProcessorTime.TotalSeconds}catch{try{$c=$p.CPU}catch{}};try{ $ws=$p.WorkingSet64 }catch{ $ws=0 }; if($ws -eq 0){ try{ $ws=(Get-CimInstance Win32_Process -Filter "ProcessId=${Number(pid)}" -ErrorAction SilentlyContinue).WorkingSetSize }catch{} }; "$([math]::Round($ws/1MB))|$c"`;
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
  const paths = worlds.map(w => psQuote(require('path').join(serverPath, w))).join(',');
  const r = await runPowerShell(`Compress-Archive -LiteralPath @(${paths}) -DestinationPath ${psQuote(destZip)} -Force`, 300000);
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

async function restoreBackup({ destPath, zipPath }) {
  const r = await runPowerShell(`Expand-Archive -LiteralPath ${psQuote(zipPath)} -DestinationPath ${psQuote(destPath)} -Force`, 300000);
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

async function allowFirewall(port) {
  const ruleName = `ObserverLauncher-${port}`;
  const innerScript = `if (-not (Get-NetFirewallRule -DisplayName '${ruleName.replace(/'/g, "''")}' -ErrorAction SilentlyContinue)) { New-NetFirewallRule -DisplayName '${ruleName.replace(/'/g, "''")}' -Direction Inbound -Protocol TCP -LocalPort ${port} -Action Allow -ErrorAction Stop }`;
  const encoded = Buffer.from(innerScript, 'utf16le').toString('base64');
  const outer = `$p = Start-Process powershell -ArgumentList '-NoProfile -EncodedCommand ${encoded}' -Verb RunAs -Wait -PassThru; exit $p.ExitCode`;
  const r = await runPowerShell(outer, 120000);
  return r.ok ? { ok: true } : { ok: false, error: r.error || 'Could not create firewall rule — UAC dismissed or rule exists.' };
}

module.exports = { findJavaDescendant, getProcessMetrics, createBackup, restoreBackup, allowFirewall };
