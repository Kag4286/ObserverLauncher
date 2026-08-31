// Verify: (1) suppression regex catches all auto-poll response shapes, (2) parseServerLine still
// extracts MSPT/players from the /tick query output, (3) non-poll lines are NOT suppressed.
const sf = require('../src/main/server-files.js');
const SUPPRESS = /(players online|TPS from last|The game is running|Target tick rate:|Average time per tick:|Percentiles:)/i;

let pass = 0, fail = 0;
const ck = (n, c) => c ? (pass++, console.log('PASS', n)) : (fail++, console.log('FAIL', n));

// suppression
ck('suppress: running normally', SUPPRESS.test('8:42:26 PM [20:42:26 INFO]: The game is running normally'));
ck('suppress: target tick rate', SUPPRESS.test('8:42:26 PM [20:42:26 INFO]: Target tick rate: 20.0 per second.'));
ck('suppress: average tick', SUPPRESS.test('8:42:26 PM Average time per tick: 0.8ms (Target: 50.0ms)'));
ck('suppress: percentiles', SUPPRESS.test('8:42:26 PM [20:42:26 INFO]: Percentiles: P50: 0.7ms P95: 1.7ms P99: 2.9ms. Sample: 100'));
ck('suppress: list response', SUPPRESS.test('There are 2 of a max of 20 players online: A, B'));
ck('suppress: tps response', SUPPRESS.test('TPS from last 5s, 10s, 1m, 5m, 15m: *20.0, 20.0, 20.0, 20.0, 20.0'));
ck('NOT suppressed: user chat', !SUPPRESS.test('Steve joined the game'));
ck('NOT suppressed: ban response', !SUPPRESS.test('Banned Steve: griefing'));
ck('NOT suppressed: warn line', !SUPPRESS.test('[Server/WARN]: Can\'t keep up!'));

// parsing — live object fed exactly the lines from the user's console
const live = { tps: null, mspt: null, players: [] };
let sent = null;
const send = (ch, data) => { if (ch === 'server:live') sent = JSON.parse(JSON.stringify(data)); };
sf.parseServerLine('[20:42:26 INFO]: There are 2 of a max of 20 players online: Alice, Bob', live, send);
sf.parseServerLine('TPS from last 5s, 10s, 1m, 5m, 15m: *20.0, 20.0, 20.0, 20.0, 20.0', live, send);
sf.parseServerLine('Average time per tick: 0.8ms (Target: 50.0ms)', live, send);
ck('mspt parsed from "Average time per tick"', live.mspt === 0.8);
ck('tps parsed', live.tps === 20);
ck('players parsed', live.players.join(',') === 'Alice,Bob');
// "Target tick rate: 20.0" must NOT poison mspt
const before = live.mspt;
sf.parseServerLine('Target tick rate: 20.0 per second.', live, send);
ck('target-tick-rate does not set mspt', live.mspt === before);
sf.parseServerLine('Percentiles: P50: 0.5ms P95: 0.9ms P99: 28.7ms. Sample: 100', live, send);
ck('percentiles line does not change mspt', live.mspt === before);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
