// v6.0.0 F1 / v9.0.2: webhook payload building (Rich Embeds + compact + generic),
// subscription gating, rate-limit retry, cooldowns, secrets encryption, and SSRF URL check.
const assert = require('assert');
const W = require('../src/main/webhook.js');
const S = require('../src/main/secrets.js');

let passed = 0;
function ok(name, cond) { assert(cond, `FAIL: ${name}`); console.log(`PASS ${name}`); passed++; }

ok('events list includes all 8 lifecycle/health events',
  JSON.stringify(W.EVENTS) === JSON.stringify(['start', 'stop', 'crash', 'player_join', 'player_leave', 'backup', 'tps_low', 'tunnel']));

// message builder
ok('start message', W.buildMessage({ type: 'start', instance: 'Survival' }) === '[Survival] Server started.');
ok('crash message with detail', W.buildMessage({ type: 'crash', instance: 'S', detail: 'out-of-memory' }).includes('out-of-memory'));
ok('player join message', W.buildMessage({ type: 'player_join', player: 'Steve' }).includes('Steve'));
ok('player leave message', W.buildMessage({ type: 'player_leave', player: 'Steve' }).includes('left the server'));
ok('backup message', W.buildMessage({ type: 'backup', auto: true, detail: 'world.zip' }).includes('Auto-backup'));
ok('tps_low message', W.buildMessage({ type: 'tps_low', tps: 13.4, mspt: 72 }).includes('13.4'));
ok('tunnel message', W.buildMessage({ type: 'tunnel', detail: 'abc.ply.gg:25565' }).includes('abc.ply.gg:25565'));

// Rich embed payload (default 'discord' format)
{
  const p = W.buildPayload({
    type: 'start', instance: 'Survival', software: 'Fabric', mc: '1.21.1', playersOnline: 3, maxPlayers: 20,
  }, 'discord', { username: 'ObsBot' });
  ok('discord format emits embeds array with emerald start color', Array.isArray(p.embeds) && p.embeds[0].color === 0x22C55E);
  ok('discord embed includes structured Environment & Players fields',
    p.embeds[0].fields.some(f => f.name === 'Environment' && f.value.includes('Fabric') && f.value.includes('1.21.1')) &&
    p.embeds[0].fields.some(f => f.name === 'Players' && f.value === '3 / 20'));
  ok('discord payload forwards optional custom username', p.username === 'ObsBot');
}

// Join embed includes mc-heads avatar when enabled and omits when disabled
{
  const joinWithAvatar = W.buildPayload({ type: 'player_join', player: 'Steve' }, 'discord', { playerAvatars: true });
  ok('player_join embed attaches mc-heads thumbnail', joinWithAvatar.embeds[0].thumbnail?.url === 'https://mc-heads.net/avatar/Steve/64');
  const joinNoAvatar = W.buildPayload({ type: 'player_join', player: 'Steve' }, 'discord', { playerAvatars: false });
  ok('player_join omits thumbnail when playerAvatars=false', !joinNoAvatar.embeds[0].thumbnail);
}

// Crash mention applies ONLY on crash, never on start
{
  const crashMentioned = W.buildPayload({ type: 'crash', detail: 'out-of-memory', hint: 'Raise Xmx' }, 'discord', { crashMention: '123456789012345678' });
  ok('crash embed attaches role mention + Diagnosis field',
    crashMentioned.content === '<@&123456789012345678>' &&
    crashMentioned.allowed_mentions?.roles?.includes('123456789012345678') &&
    crashMentioned.embeds[0].fields.some(f => f.name === 'Diagnosis' && f.value === 'Raise Xmx'));
  const startNoMention = W.buildPayload({ type: 'start' }, 'discord', { crashMention: '123456789012345678' });
  ok('start embed does not ping crash role', !startNoMention.content);
}

// Compact & generic payload formats
ok('discord_compact payload preserves single-line content', W.buildPayload({ type: 'start' }, 'discord_compact').content === 'Server started.');
ok('generic payload shape', (() => {
  const p = W.buildPayload({ type: 'stop', instance: 'S', uptimeMs: 120000 }, 'generic');
  return p.event === 'stop' && p.instance === 'S' && p.uptimeMs === 120000 && typeof p.timestamp === 'number';
})());

// secrets.js includes webhookUrl in GLOBAL_SECRET_KEYS
ok('secrets.js wraps webhookUrl at rest', S.GLOBAL_SECRET_KEYS.includes('webhookUrl') && S.needsWrap({ webhookUrl: 'https://discord.com/api/webhooks/1/secret' }));

// URL safety (SSRF: reject localhost/private, accept public)
ok('public https ok', W.isSafeWebhookUrl('https://discord.com/api/webhooks/123/abc') === true);
ok('localhost rejected', W.isSafeWebhookUrl('http://localhost/x') === false);
ok('127.0.0.1 rejected', W.isSafeWebhookUrl('http://127.0.0.1/x') === false);
ok('file:// rejected', W.isSafeWebhookUrl('file:///etc/passwd') === false);
ok('empty rejected', W.isSafeWebhookUrl('') === false);

(async () => {
  const url = 'https://discord.com/api/webhooks/1/a';
  ok('no url -> no send', (await W.fire({}, { type: 'start' }, { spacingMs: 0, fetchFn: async () => ({ status: 204 }) })).sent === false);
  ok('unsafe url -> no send', (await W.fire({ webhookUrl: 'http://127.0.0.1/x' }, { type: 'start' }, { spacingMs: 0, fetchFn: async () => ({ status: 204 }) })).sent === false);

  let called = 0;
  const r1 = await W.fire({ webhookUrl: url, webhookEvents: ['crash'] }, { type: 'start' }, { spacingMs: 0, fetchFn: async () => { called++; return { status: 204 }; } });
  ok('unsubscribed -> no send', r1.sent === false && called === 0);

  let body = null, gotUrl = null;
  const r2 = await W.fire({ webhookUrl: url, webhookEvents: ['start'], webhookFormat: 'discord' }, { type: 'start', instance: 'S', software: 'Paper', mc: '1.21.4' }, {
    spacingMs: 0,
    fetchFn: async (u, o) => { gotUrl = u; body = JSON.parse(o.body); return { status: 204 }; },
  });
  ok('subscribed -> sent rich embed', r2.sent === true && r2.status === 204 && gotUrl === url && Array.isArray(body?.embeds) && body.embeds[0].title === '[S] Server Started');

  // HTTP 404 returns sent:false with error reason
  const r404 = await W.fire({ webhookUrl: url, webhookEvents: ['start'] }, { type: 'start' }, {
    spacingMs: 0,
    fetchFn: async () => ({ status: 404, json: async () => ({ message: 'Unknown Webhook' }) }),
  });
  ok('HTTP 404 from Discord -> sent:false with message', r404.sent === false && r404.status === 404 && /Unknown Webhook/.test(r404.reason));

  // HTTP 429 retries once and succeeds
  let attempts429 = 0;
  const r429 = await W.fire({ webhookUrl: url, webhookEvents: ['start'] }, { type: 'start' }, {
    spacingMs: 0,
    retryWaitMs: 1,
    fetchFn: async () => {
      attempts429++;
      if (attempts429 === 1) return { status: 429, headers: { get: k => (k === 'retry-after' ? '0.01' : null) }, json: async () => ({ retry_after: 0.01 }) };
      return { status: 204 };
    },
  });
  ok('HTTP 429 retries once and succeeds', r429.sent === true && attempts429 === 2);

  // tps_low cooldown prevents spam within 10 minutes
  W.clearCooldowns();
  let tpsHits = 0;
  const tpsFetch = async () => { tpsHits++; return { status: 204 }; };
  const t1 = await W.fire({ webhookUrl: url, webhookEvents: ['tps_low'] }, { type: 'tps_low', instanceId: 'srv1', tps: 12.1 }, { spacingMs: 0, now: 10000, fetchFn: tpsFetch });
  const t2 = await W.fire({ webhookUrl: url, webhookEvents: ['tps_low'] }, { type: 'tps_low', instanceId: 'srv1', tps: 11.8 }, { spacingMs: 0, now: 20000, fetchFn: tpsFetch });
  const t3 = await W.fire({ webhookUrl: url, webhookEvents: ['tps_low'] }, { type: 'tps_low', instanceId: 'srv1', tps: 11.5 }, { spacingMs: 0, now: 10000 + W.TPS_LOW_COOLDOWN_MS + 1, fetchFn: tpsFetch });
  ok('tps_low enforces 10m cooldown per instance', t1.sent === true && t2.sent === false && t2.reason === 'cooldown' && t3.sent === true && tpsHits === 2);

  // Network error swallowed
  const rErr = await W.fire({ webhookUrl: url, webhookEvents: ['start'] }, { type: 'start' }, { spacingMs: 0, fetchFn: async () => { throw new Error('offline'); } });
  ok('network error -> sent false, no throw', rErr.sent === false && /offline/.test(rErr.reason));

  console.log(`\n${passed} passed, 0 failed`);
})().catch(e => { console.error(e); process.exit(1); });
