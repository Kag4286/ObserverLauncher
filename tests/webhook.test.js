// v6.0.0 F1: webhook payload building + subscription gating + SSRF URL check. `fire` is tested with an
// injected fetchFn so no network is touched.
const assert = require('assert');
const W = require('../src/main/webhook.js');

let passed = 0;
function ok(name, cond) { assert(cond, `FAIL: ${name}`); console.log(`PASS ${name}`); passed++; }

ok('events list', JSON.stringify(W.EVENTS) === JSON.stringify(['start', 'stop', 'crash', 'player_join']));

// message builder
ok('start message', W.buildMessage({ type: 'start', instance: 'Survival' }) === '[Survival] Server started.');
ok('crash message with detail', W.buildMessage({ type: 'crash', instance: 'S', detail: 'out-of-memory' }).includes('out-of-memory'));
ok('player join message', W.buildMessage({ type: 'player_join', player: 'Steve' }).includes('Steve'));

// payload formats
ok('discord payload has content', W.buildPayload({ type: 'start' }, 'discord').content === 'Server started.');
ok('generic payload shape', (() => { const p = W.buildPayload({ type: 'stop', instance: 'S' }, 'generic'); return p.event === 'stop' && p.instance === 'S' && typeof p.timestamp === 'number'; })());

// URL safety (SSRF: reject localhost/private, accept public)
ok('public https ok', W.isSafeWebhookUrl('https://discord.com/api/webhooks/123/abc') === true);
ok('localhost rejected', W.isSafeWebhookUrl('http://localhost/x') === false);
ok('127.0.0.1 rejected', W.isSafeWebhookUrl('http://127.0.0.1/x') === false);
ok('file:// rejected', W.isSafeWebhookUrl('file:///etc/passwd') === false);
ok('empty rejected', W.isSafeWebhookUrl('') === false);

(async () => {
  // no url -> not sent
  ok('no url -> no send', (await W.fire({}, { type: 'start' }, { fetchFn: async () => ({ status: 204 }) })).sent === false);
  // unsafe url -> not sent
  ok('unsafe url -> no send', (await W.fire({ webhookUrl: 'http://127.0.0.1/x' }, { type: 'start' }, { fetchFn: async () => ({ status: 204 }) })).sent === false);
  // unsubscribed event -> not sent, fetch never called
  let called = 0;
  const r1 = await W.fire({ webhookUrl: 'https://discord.com/api/webhooks/1/a', webhookEvents: ['crash'] }, { type: 'start' }, { fetchFn: async () => { called++; return { status: 204 }; } });
  ok('unsubscribed -> no send', r1.sent === false && called === 0);
  // subscribed + safe -> sent, body is the discord payload
  let body = null, gotUrl = null;
  const r2 = await W.fire({ webhookUrl: 'https://discord.com/api/webhooks/1/a', webhookEvents: ['start'], webhookFormat: 'discord' }, { type: 'start', instance: 'S' }, { fetchFn: async (u, o) => { gotUrl = u; body = JSON.parse(o.body); return { status: 204 }; } });
  ok('subscribed -> sent', r2.sent === true && r2.status === 204);
  ok('sent to the url', gotUrl === 'https://discord.com/api/webhooks/1/a');
  ok('sent body is discord content', body && body.content === '[S] Server started.');
  // a fetch rejection is swallowed -> sent:false, never throws
  const r3 = await W.fire({ webhookUrl: 'https://discord.com/api/webhooks/1/a', webhookEvents: ['start'] }, { type: 'start' }, { fetchFn: async () => { throw new Error('offline'); } });
  ok('network error -> sent false, no throw', r3.sent === false && /offline/.test(r3.reason));

  console.log(`\n${passed} passed, 0 failed`);
})().catch(e => { console.error(e); process.exit(1); });
