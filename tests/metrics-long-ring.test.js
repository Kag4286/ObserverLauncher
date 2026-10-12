// v5.3.0: the coarse 10s metrics ring that feeds the 1h/6h Performance chart ranges. pushHistory
// feeds BOTH rings from the same sample, so they can never drift. Pure + synchronous.
const assert = require('assert');
const { pushHistory, METRICS_HISTORY_CAP, METRICS_LONG_CAP, METRICS_LONG_INTERVAL_MS } = require('../src/main/server-metrics.js');

let passed = 0;
function ok(name, cond) { assert(cond, `FAIL: ${name}`); console.log(`PASS ${name}`); passed++; }

const ctx = {};
const sample = (t) => ({ t, tps: 20, mspt: 4, cpu: 30, ram: 50, players: 1 });

// first push seeds both rings
pushHistory(ctx, sample(1000));
ok('first push -> history has 1', ctx.metricsHistory.length === 1);
ok('first push -> long has 1', ctx.metricsLong.length === 1);

// a second push within the long interval only lands in the raw ring
pushHistory(ctx, sample(1000 + METRICS_LONG_INTERVAL_MS - 1));
ok('within interval -> history 2', ctx.metricsHistory.length === 2);
ok('within interval -> long still 1', ctx.metricsLong.length === 1);

// a push AT/after the interval lands in both
pushHistory(ctx, sample(1000 + METRICS_LONG_INTERVAL_MS));
ok('at interval -> history 3', ctx.metricsHistory.length === 3);
ok('at interval -> long 2', ctx.metricsLong.length === 2);

// long ring caps at METRICS_LONG_CAP
const ctx2 = {};
for (let i = 0; i < METRICS_LONG_CAP + 50; i++) pushHistory(ctx2, sample(i * METRICS_LONG_INTERVAL_MS));
ok('long ring capped', ctx2.metricsLong.length === METRICS_LONG_CAP);
ok('history ring capped', ctx2.metricsHistory.length === METRICS_HISTORY_CAP);
ok('long keeps the NEWEST sample', ctx2.metricsLong[ctx2.metricsLong.length - 1].t === (METRICS_LONG_CAP + 49) * METRICS_LONG_INTERVAL_MS);

console.log(`\n${passed} passed, 0 failed`);
process.exit(0);
