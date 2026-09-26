// 2.4.0: spark prints TPS / tick-durations as a HEADER line then a VALUES line. Verify
// parseServerLine consumes both and fills live.tps / live.mspt.
const assert = require('assert');
const { parseServerLine } = require('../src/main/server-files.js');
let pass = 0, fail = 0;
const check = (n, c) => c ? (pass++, console.log('PASS', n)) : (fail++, console.log('FAIL', n));

const P = '[14:17:44] [spark-worker-pool-1-thread-3/INFO] [minecraft/MinecraftServer]: ';
function run(lines) {
  const live = { tps: null, mspt: null, players: [] };
  for (const l of lines) parseServerLine(l, live, () => {});
  return live;
}

// spark two-line TPS: header then values
let live = run([
  P + 'TPS from last 5s, 10s, 1m, 5m, 15m:',
  P + '20.0, *20.0, *20.0, *20.0, *20.0',
]);
check('spark tps parsed from values line', live.tps === 20);

// spark two-line tick durations -> MSPT = median (2nd value)
live = run([
  P + 'Tick durations (min/med/95%ile/max ms) from last 10s, 1m:',
  P + ' 3.5/5.9/29.3/146.3;  3.5/5.9/29.3/146.3',
]);
check('spark mspt parsed as median', live.mspt === 5.9);

// a lagging server reports < 20 TPS
live = run([
  P + 'TPS from last 1m, 5m, 15m:',
  P + '18.4, 19.1, 19.7',
]);
check('spark lagging tps = 18.4', live.tps === 18.4);

// header alone does NOT set a value (must not read the header's own numbers, e.g. "10s")
live = run([ P + 'TPS from last 5s, 10s, 1m, 5m, 15m:' ]);
check('header alone leaves tps null', live.tps === null);

// unrelated line after a header must not be swallowed as the value
live = run([
  P + 'Tick durations (min/med/95%ile/max ms) from last 10s, 1m:',
  P + 'Done (1.2s)! For help, type "help"',
]);
check('non-numeric next line -> mspt stays null', live.mspt === null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
