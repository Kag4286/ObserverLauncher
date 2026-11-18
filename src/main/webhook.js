// webhook.js — Discord/webhook notifications for server events (v6.0.0 F1, upgraded v9.0.2).
//
// WHY: self-hosted servers often run unattended; hosts want rich, legible alerts on Discord when
// servers start, stop, crash, finish backups, suffer TPS drops, or players join/leave.
// Delivery is rate-limit aware, SSRF-guarded, and fail-silent in background lifecycle hooks.
const EVENTS = ['start', 'stop', 'crash', 'player_join', 'player_leave', 'backup', 'tps_low', 'tunnel'];

const EVENT_META = {
  start:        { color: 0x22C55E, title: 'Server Started' },
  stop:         { color: 0x64748B, title: 'Server Stopped' },
  crash:        { color: 0xEF4444, title: 'Server Crashed' },
  player_join:  { color: 0x10B981, title: 'Player Joined' },
  player_leave: { color: 0xF59E0B, title: 'Player Left' },
  backup:       { color: 0x3B82F6, title: 'World Backup Complete' },
  tps_low:      { color: 0xF97316, title: 'Low TPS Alert' },
  tunnel:       { color: 0x8B5CF6, title: 'Public Tunnel Ready' },
};

const TPS_LOW_COOLDOWN_MS = 10 * 60 * 1000;
const _tpsCooldowns = new Map();

// SSRF guard: accept only public http(s) URLs.
function isSafeWebhookUrl(url) {
  try { return require('./validate.js').isSafeDownloadUrl(url) === true; } catch { return false; }
}

function formatDurationMs(ms) {
  const sec = Math.max(0, Math.floor(Number(ms) / 1000));
  if (!Number.isFinite(sec) || sec <= 0) return null;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatSizeBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n >= 1024 ** 3) return `${(n / (1024 ** 3)).toFixed(2)} GB`;
  if (n >= 1024 ** 2) return `${(n / (1024 ** 2)).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

// Validate optional crash mention config: role snowflake, 'here', or 'everyone'.
function resolveCrashMention(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  if (/^@?here$/i.test(s)) return { content: '@here', allowed_mentions: { parse: ['everyone'] } };
  if (/^@?everyone$/i.test(s)) return { content: '@everyone', allowed_mentions: { parse: ['everyone'] } };
  const roleMatch = s.match(/^(?:<@&)?(\d{17,21})>?$/);
  if (roleMatch) {
    const id = roleMatch[1];
    return { content: `<@&${id}>`, allowed_mentions: { roles: [id] } };
  }
  return null;
}

// PURE: build a human-readable line for an event (used by generic + discord_compact formats).
function buildMessage(ev) {
  const e = ev || {};
  const inst = e.instance ? `[${e.instance}] ` : '';
  switch (e.type) {
    case 'start': return `${inst}Server started.`;
    case 'stop': return `${inst}Server stopped.`;
    case 'crash': return `${inst}Server crashed${e.detail ? ': ' + e.detail : '.'}`;
    case 'player_join': return `${inst}${e.player || 'A player'} joined the server.`;
    case 'player_leave': return `${inst}${e.player || 'A player'} left the server.`;
    case 'backup': return `${inst}${e.auto ? 'Auto-backup' : 'Backup'} created${e.detail ? ': ' + e.detail : '.'}`;
    case 'tps_low': return `${inst}TPS dropped to ${e.tps != null ? Number(e.tps).toFixed(1) : '?'}${e.mspt != null ? ` (${Math.round(Number(e.mspt))} ms MSPT)` : ''}.`;
    case 'tunnel': return `${inst}Public tunnel ready${e.detail ? ': ' + e.detail : '.'}`;
    default: return `${inst}${e.type || 'event'}`;
  }
}

function buildEmbed(ev, opts = {}) {
  const e = ev || {};
  const meta = EVENT_META[e.type] || { color: 0x22C55E, title: e.type || 'Server Event' };
  const ts = Number(e.timestamp) || Date.now();
  const fields = [];

  if (e.software || e.mc) {
    fields.push({ name: 'Environment', value: [e.software, e.mc].filter(Boolean).join(' · '), inline: true });
  }
  if (e.playersOnline != null) {
    const pText = e.maxPlayers ? `${e.playersOnline} / ${e.maxPlayers}` : String(e.playersOnline);
    fields.push({ name: 'Players', value: pText, inline: true });
  }
  if (e.uptimeMs) {
    const dur = formatDurationMs(e.uptimeMs);
    if (dur) fields.push({ name: 'Uptime', value: dur, inline: true });
  }
  if (e.type === 'tps_low' && (e.tps != null || e.mspt != null)) {
    const tpsStr = e.tps != null ? `${Number(e.tps).toFixed(1)} TPS` : '';
    const msptStr = e.mspt != null ? `${Math.round(Number(e.mspt))} ms` : '';
    fields.push({ name: 'Tick Health', value: [tpsStr, msptStr].filter(Boolean).join(' · '), inline: true });
  }
  if (e.type === 'backup') {
    fields.push({ name: 'Type', value: e.auto ? 'Scheduled / Auto' : 'Manual', inline: true });
    const sz = formatSizeBytes(e.sizeBytes);
    if (sz) fields.push({ name: 'Archive Size', value: sz, inline: true });
  }
  if (e.type === 'crash' && e.hint) {
    fields.push({ name: 'Diagnosis', value: String(e.hint).slice(0, 240), inline: false });
  }

  let description;
  if (e.type === 'player_join') description = `**${e.player || 'A player'}** joined the server.`;
  else if (e.type === 'player_leave') description = `**${e.player || 'A player'}** left the server.`;
  else if (e.type === 'crash') description = e.detail ? `Cause: \`${e.detail}\`` : 'Unexpected server exit detected.';
  else if (e.type === 'backup') description = e.detail ? `Saved \`${e.detail}\`` : 'World backup finished.';
  else if (e.type === 'tunnel') description = e.detail ? `Address: \`${e.detail}\`` : 'Tunnel is online.';
  else description = e.detail || buildMessage({ ...e, instance: '' });

  const embed = {
    title: e.instance ? `[${e.instance}] ${meta.title}` : meta.title,
    description,
    color: meta.color,
    timestamp: new Date(ts).toISOString(),
    footer: { text: `ObserverLauncher${e.instance ? ` · ${e.instance}` : ''}` },
  };
  if (fields.length) embed.fields = fields;

  if ((e.type === 'player_join' || e.type === 'player_leave') && e.player && opts.playerAvatars !== false) {
    const nameClean = String(e.player).trim();
    if (/^[\w.-]{1,16}$/.test(nameClean)) {
      embed.thumbnail = { url: `https://mc-heads.net/avatar/${encodeURIComponent(nameClean)}/64` };
    }
  }
  return embed;
}

// Build the JSON body for the endpoint. Supports 'discord' (Rich Embed), 'discord_compact'
// (plain { content }), and 'generic' (flat JSON).
function buildPayload(ev, format, opts = {}) {
  const e = ev || {};
  const fmt = String(format || 'discord');
  const message = buildMessage(e);
  if (fmt === 'generic') {
    return {
      event: e.type || 'event',
      instance: e.instance || null,
      message,
      player: e.player || null,
      detail: e.detail || null,
      software: e.software || null,
      mc: e.mc || null,
      playersOnline: e.playersOnline ?? null,
      maxPlayers: e.maxPlayers ?? null,
      uptimeMs: e.uptimeMs ?? null,
      tps: e.tps ?? null,
      timestamp: Number(e.timestamp) || Date.now(),
    };
  }
  const username = String(opts.username || '').trim().slice(0, 80);
  const mention = e.type === 'crash' ? resolveCrashMention(opts.crashMention) : null;
  if (fmt === 'discord_compact') {
    const body = {
      content: mention ? `${mention.content} ${message}` : message,
    };
    if (mention) body.allowed_mentions = mention.allowed_mentions;
    if (username) body.username = username;
    return body;
  }
  const body = { embeds: [buildEmbed(e, opts)] };
  if (mention) {
    body.content = mention.content;
    body.allowed_mentions = mention.allowed_mentions;
  }
  if (username) body.username = username;
  return body;
}

function parseRetryAfterMs(res, jsonBody) {
  if (jsonBody && Number.isFinite(Number(jsonBody.retry_after))) {
    return Math.min(10000, Math.max(250, Math.ceil(Number(jsonBody.retry_after) * 1000)));
  }
  const hdr = res && res.headers && (typeof res.headers.get === 'function' ? res.headers.get('retry-after') : res.headers['retry-after']);
  const n = Number(hdr);
  if (Number.isFinite(n) && n > 0) {
    return Math.min(10000, Math.max(250, Math.ceil(n > 60 ? n : n * 1000)));
  }
  return 1000;
}

function shouldCooldownEvent(ev, o) {
  if (!ev || ev.type !== 'tps_low' || o.ignoreCooldown) return false;
  const key = `${ev.instanceId || ev.instance || 'default'}:tps_low`;
  const now = Number(o.now) || Date.now();
  const prev = _tpsCooldowns.get(key);
  if (prev !== undefined && now - prev < TPS_LOW_COOLDOWN_MS) return true;
  _tpsCooldowns.set(key, now);
  return false;
}

function clearCooldowns() { _tpsCooldowns.clear(); }

async function postWithRedirects(url, body, doFetch, timeoutMs) {
  const MAX_REDIRECTS = 3;
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    let curUrl = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const res = await doFetch(curUrl, {
        method: 'POST',
        redirect: 'manual',
        headers: { 'content-type': 'application/json' },
        body,
        signal: controller ? controller.signal : undefined,
      });
      if (res && res.status >= 300 && res.status < 400) {
        try { if (res.body && typeof res.body.cancel === 'function') res.body.cancel(); } catch {}
        const loc = res.headers && (typeof res.headers.get === 'function' ? res.headers.get('location') : res.headers.location);
        if (!loc) return { sent: false, status: res.status, reason: 'redirect without location' };
        let nextUrl;
        try { nextUrl = new URL(loc, curUrl).href; } catch { return { sent: false, reason: 'invalid redirect url' }; }
        if (!isSafeWebhookUrl(nextUrl)) return { sent: false, reason: 'unsafe redirect' };
        if (hop === MAX_REDIRECTS) return { sent: false, reason: 'too many redirects' };
        curUrl = nextUrl;
        continue;
      }
      if (res && res.status === 429) {
        let parsed = null;
        try { if (typeof res.json === 'function') parsed = await res.json(); } catch {}
        return { sent: false, status: 429, retryAfterMs: parseRetryAfterMs(res, parsed), reason: 'HTTP 429 rate limited' };
      }
      if (res && typeof res.status === 'number' && res.status >= 400) {
        let msg = `HTTP ${res.status}`;
        try {
          if (typeof res.json === 'function') {
            const j = await res.json();
            if (j && j.message) msg = `HTTP ${res.status}: ${j.message}`;
          }
        } catch {}
        return { sent: false, status: res.status, reason: msg };
      }
      return { sent: true, status: res && res.status };
    }
    return { sent: false, reason: 'too many redirects' };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Serial dispatch queue to avoid bursting Discord's per-webhook bucket during rapid lifecycle events.
let _dispatchChain = Promise.resolve();
let _lastDispatchAt = 0;

function enqueueSend(fn, spacingMs) {
  const run = _dispatchChain.then(async () => {
    const gap = Math.max(0, spacingMs - (Date.now() - _lastDispatchAt));
    if (gap > 0) await new Promise(r => setTimeout(r, gap));
    try { return await fn(); }
    finally { _lastDispatchAt = Date.now(); }
  });
  _dispatchChain = run.catch(() => {});
  return run;
}

// Fire a webhook for one event. Injectable `fetchFn` + `opts` so tests run completely offline.
async function fire(settings, ev, opts) {
  const o = opts || {};
  const s = settings || {};
  const url = String(s.webhookUrl || '').trim();
  if (!url) return { sent: false, reason: 'no url' };
  if (!isSafeWebhookUrl(url)) return { sent: false, reason: 'unsafe url' };
  const subs = Array.isArray(s.webhookEvents) ? s.webhookEvents : EVENTS;
  if (!subs.includes(ev && ev.type)) return { sent: false, reason: 'not subscribed' };
  if (shouldCooldownEvent(ev, o)) return { sent: false, reason: 'cooldown' };
  const doFetch = o.fetchFn || (typeof fetch === 'function' ? fetch : null);
  if (!doFetch) return { sent: false, reason: 'no fetch' };

  const body = JSON.stringify(buildPayload(ev, s.webhookFormat, {
    username: s.webhookUsername,
    crashMention: s.webhookCrashMention,
    playerAvatars: s.webhookPlayerAvatars,
  }));
  const timeoutMs = Number(o.timeoutMs) || 8000;
  const spacingMs = Number.isFinite(Number(o.spacingMs)) ? Number(o.spacingMs) : 150;

  return enqueueSend(async () => {
    try {
      let res = await postWithRedirects(url, body, doFetch, timeoutMs);
      if (res.status === 429 && res.retryAfterMs && !o.noRetry) {
        const waitMs = Number.isFinite(Number(o.retryWaitMs)) ? Number(o.retryWaitMs) : res.retryAfterMs;
        if (waitMs > 0) await new Promise(r => setTimeout(r, waitMs));
        res = await postWithRedirects(url, body, doFetch, timeoutMs);
      }
      return res;
    } catch (e) {
      return { sent: false, reason: e?.message || 'request failed' };
    }
  }, spacingMs);
}

// Enrich an event from runtime `ctx` (active instance name, software, MC, player count, uptime)
// and fire fail-silently without blocking any caller. Single shared helper across lifecycle/backups/metrics/tunnels.
function fireForContext(ctx, ev, opts) {
  try {
    const s = require('./settings.js').loadSettings();
    if (!s || !s.webhookUrl) return;
    const instId = typeof ctx.inst === 'function' ? ctx.inst() : null;
    const instance = (() => {
      try { return require('./settings.js').listInstances().instances.find(i => i.id === instId)?.name || ''; }
      catch { return ''; }
    })();
    const enriched = { ...ev, instance, instanceId: instId || undefined };
    if (enriched.software === undefined || enriched.mc === undefined || enriched.maxPlayers === undefined) {
      try {
        if (ctx.currentServerPath) {
          const files = require('./server-files.js').serverFiles(ctx.currentServerPath);
          const target = require('./server-compat.js').detectServerTarget(ctx.currentServerPath, files);
          if (enriched.software === undefined && target?.loader) enriched.software = target.loader[0].toUpperCase() + target.loader.slice(1);
          if (enriched.mc === undefined && target?.mc && target.mc !== 'latest') enriched.mc = target.mc;
          if (enriched.maxPlayers === undefined) {
            const mp = Number(files?.properties?.['max-players']);
            if (Number.isFinite(mp) && mp > 0) enriched.maxPlayers = mp;
          }
        }
      } catch {}
    }
    if (enriched.playersOnline === undefined && Array.isArray(ctx?.live?.players)) {
      enriched.playersOnline = ctx.live.players.length;
    }
    if (enriched.uptimeMs === undefined && ctx?.startedAt > 0 && ev?.type === 'stop') {
      enriched.uptimeMs = Date.now() - ctx.startedAt;
    }
    fire(s, enriched, opts).catch(() => {});
  } catch {}
}

module.exports = {
  EVENTS,
  EVENT_META,
  TPS_LOW_COOLDOWN_MS,
  isSafeWebhookUrl,
  resolveCrashMention,
  buildMessage,
  buildEmbed,
  buildPayload,
  clearCooldowns,
  fire,
  fireForContext,
};
