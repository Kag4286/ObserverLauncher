// B3 (3.3.0): the auto-poll TPS cadence. shouldPollTps() decides whether the (expensive) TPS
// command is sent this tick - every tick while TPS is unknown or lagging, every 3rd tick while
// healthy. Pure, so no timers are needed here (the interval itself stays in startAutoPoll).
const { shouldPollTps } = require('../src/main/server-poll.js');
let pass = 0, fail = 0;
const ck = (n, c) => c ? (pass++, console.log('PASS', n)) : (fail++, console.log('FAIL', n));

// unknown TPS -> always poll (get a first reading fast)
ck('null tps tick 1 -> poll', shouldPollTps(1, null) === true);
ck('null tps tick 2 -> poll', shouldPollTps(2, null) === true);
// lagging -> always poll
ck('19.4 (lagging) tick 2 -> poll', shouldPollTps(2, 19.4) === true);
ck('0 tps tick 2 -> poll', shouldPollTps(2, 0) === true);
// healthy -> every 3rd tick only
ck('20 tps tick 1 -> poll (first reading)', shouldPollTps(1, 20) === true);
ck('20 tps tick 2 -> skip', shouldPollTps(2, 20) === false);
ck('20 tps tick 3 -> skip', shouldPollTps(3, 20) === false);
ck('20 tps tick 4 -> poll', shouldPollTps(4, 20) === true);
ck('20 tps tick 7 -> poll', shouldPollTps(7, 20) === true);
// boundary: exactly 19.5 is healthy
ck('19.5 tick 2 -> healthy (skip)', shouldPollTps(2, 19.5) === false);
ck('19.49 tick 2 -> lagging (poll)', shouldPollTps(2, 19.49) === true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
