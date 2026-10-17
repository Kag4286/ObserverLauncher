// webhook.js — Discord/webhook notifications for server events (v6.0.0 F1).
//
// WHY: a self-hosted server often runs unattended; the user wants to know when it starts, stops,
// crashes, or a player joins. This posts a small JSON body to a user-configured webhook URL. It is
// FIRE-AND-FORGET and fail-silent: a webhook never blocks a server action and never surfaces an
// error in the console (a wrong URL must not spam). Only http(s) URLs are accepted (no file://).
// The event list + the text builder are PURE so they are unit-tested without a network.
// Events the user can subscribe to.
const EVENTS = ['start', 'stop', 'crash', 'player_join'];

// PURE: is this a safe webhook URL? https/http on a real host, never a local/private IP (SSRF) unless
// the user explicitly allows it. We reuse isSafeDownloadUrl's public-host rule (loopback/private
// rejected) so a webhook cannot be pointed at an internal service; a LAN webhook would be blocked, which
// is the safe default.
function isSafeWebhookUrl(url) {
  try { return require('./validate.js').isSafeDownloadUrl(url) === true; } catch { return false; }
}

// PURE: build the human-readable line for an event. `ev` = { type, instance, detail? }.
function buildMessage(ev) {
  const e = ev || {};
  const inst = e.instance ? `[${e.instance}] ` : '';
  switch (e.type) {
    case 'start': return `${inst}Server started.`;
    case 'stop': return `${inst}Server stopped.`;
    case 'crash': return `${inst}Server crashed${e.detail ? ': ' + e.detail : '.'}`;
    case 'player_join': return `${inst}${e.player || 'A player'} joined the server.`;
    default: return `${inst}${e.type || 'event'}`;
  }
}

// Build the JSON body for the endpoint. Supports a Discord-style { content } body (the common case)
// and a generic { event, instance, message, timestamp } shape for any other receiver. `format` is
// 'discord' | 'generic'.
function buildPayload(ev, format) {
  const e = ev || {};
  const message = buildMessage(e);
  if (String(format) === 'generic') {
    return { event: e.type || 'event', instance: e.instance || null, message, player: e.player || null, timestamp: Date.now() };
  }
  return { content: message };
}

// Fire a webhook for one event. `settings` = { webhookUrl, webhookEvents:[...], webhookFormat? }. Sends
// ONLY when the URL is set, safe, and the event type is subscribed. Returns { sent, reason? }.
// Injectable `fetchFn` + `opts` so tests never hit the network.
async function fire(settings, ev, opts) {
  const o = opts || {};
  const s = settings || {};
  const url = String(s.webhookUrl || '').trim();
  if (!url) return { sent: false, reason: 'no url' };
  if (!isSafeWebhookUrl(url)) return { sent: false, reason: 'unsafe url' };
  const subs = Array.isArray(s.webhookEvents) ? s.webhookEvents : EVENTS;
  if (!subs.includes(ev && ev.type)) return { sent: false, reason: 'not subscribed' };
  const doFetch = o.fetchFn || (typeof fetch === 'function' ? fetch : null);
  if (!doFetch) return { sent: false, reason: 'no fetch' };
  const body = JSON.stringify(buildPayload(ev, s.webhookFormat));
  try {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), Number(o.timeoutMs) || 8000) : null;
    const res = await doFetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body, signal: controller ? controller.signal : undefined });
    if (timer) clearTimeout(timer);
    return { sent: true, status: res && res.status };
  } catch (e) {
    return { sent: false, reason: e?.message || 'request failed' };
  }
}

module.exports = { EVENTS, isSafeWebhookUrl, buildMessage, buildPayload, fire };
