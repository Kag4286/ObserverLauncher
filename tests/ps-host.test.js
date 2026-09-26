// 2.4.0: the persistent PowerShell host. Skipped on non-Windows (the module no-ops there).
const assert = require('assert');
const psHost = require('../src/main/platform/ps-host.js');
let pass = 0, fail = 0;
const check = (n, c) => c ? (pass++, console.log('PASS', n)) : (fail++, console.log('FAIL', n));

(async () => {
  if (!psHost.IS_WIN) { console.log('SKIP: not Windows'); process.exit(0); }
  // 1) basic run returns stdout
  const a = await psHost.run('Write-Output "hello"');
  check('basic run returns stdout', String(a).includes('hello'));
  // 2) two concurrent runs do not clobber each other (queue works)
  const [b, c] = await Promise.all([
    psHost.run('Start-Sleep -Milliseconds 200; Write-Output "slow"'),
    psHost.run('Write-Output "fast"'),
  ]);
  check('concurrent: slow got slow', String(b).includes('slow'));
  check('concurrent: fast got fast', String(c).includes('fast'));
  // 3) a throwing command is caught, host survives
  const errOut = await psHost.run('throw "boom"');
  check('throw -> #ERR#', String(errOut).includes('#ERR#boom'));
  const after = await psHost.run('Write-Output "alive"');
  check('host survives a throw', String(after).includes('alive'));
  // 4) a real process metric query (shape: "<mem>|<cpu>")
  const m = await psHost.run('$p=Get-Process -Id ' + process.pid + ' -ErrorAction SilentlyContinue; if($p){ "$([math]::Round($p.WorkingSet64/1MB,2))|$([math]::Round($p.TotalProcessorTime.TotalSeconds,3))" }');
  check('metrics shape has a pipe', String(m).includes('|'));
  // 5) gone pid -> empty (no exit, host stays up)
  const gone = await psHost.run('$p=Get-Process -Id 999999 -ErrorAction SilentlyContinue; if(-not $p){ return }; "x"');
  check('gone pid -> empty', !String(gone).includes('x'));
  const still = await psHost.run('Write-Output "still-alive"');
  check('host alive after gone pid', String(still).includes('still-alive'));
  psHost.dispose();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
