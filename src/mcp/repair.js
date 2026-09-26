// src/mcp/repair.js — v2.5.0 Autonomous Server Doctor: PURE planning logic.
//
// WHY: doctor.js DETECTS problems (port busy, missing mod dep, RAM pressure, crash loop). This
// module turns a detected problem into a STRUCTURED repair plan the AI can show the user before
// anything is changed. Execution is a separate step (apply_fix) so nothing happens without a
// confirm - the user asked for "suggest + confirm", never silent auto-fix.
//
// Design rule: this file is pure (no Electron, no network, no I/O). The tools in tools.js gather
// the facts and call proposeRepair(); apply_fix executes the approved plan via existing tools.

// Fix action codes (stable strings the AI + GUI can act on).
const ACTION = {
  CHANGE_PORT: 'change_port',           // set server-port + restart
  INSTALL_DEPENDENCY: 'install_dependency', // install a missing mod dep via marketplace
  TUNE_PERFORMANCE: 'tune_performance', // lower view-distance / raise memory
  RESTORE_BACKUP: 'restore_backup',     // roll back to the newest backup
};

// Risk per action: 'write' (safe-ish, reversible by hand) or 'destroy' (overwrites/restarts).
// apply_fix is always confirmed by the user; this only labels the impact in the plan.
const ACTION_RISK = {
  [ACTION.CHANGE_PORT]: 'write',
  [ACTION.INSTALL_DEPENDENCY]: 'write',
  [ACTION.TUNE_PERFORMANCE]: 'write',
  [ACTION.RESTORE_BACKUP]: 'destroy',
};

// ---- crash loop detection (pure) ----
// A crash loop = N+ crash reports whose mtime falls within `windowMs`. Reports are {mtime} (ms).
function detectCrashLoop(reports, opts) {
  const o = opts || {};
  const min = Number(o.min) || 3;              // >=3 crashes
  const windowMs = Number(o.windowMs) || 60 * 60 * 1000; // within the last hour
  const now = Number(o.now) || Date.now();
  const list = Array.isArray(reports) ? reports.filter(r => r && Number.isFinite(r.mtime)) : [];
  const recent = list.filter(r => now - r.mtime <= windowMs);
  if (recent.length < min) return { loop: false, count: recent.length, windowMs };
  // newest first so the caller can offer to roll back to the backup BEFORE the loop began.
  recent.sort((a, b) => b.mtime - a.mtime);
  return { loop: true, count: recent.length, windowMs, newest: recent[0], oldest: recent[recent.length - 1] };
}

// ---- RAM-leak / pressure heuristic (pure) ----
// Given a metrics history [{t, ram, tps, mspt, players}] and a limitMB, detect a steady upward
// RAM trend that does not come back down (a leak) OR sustained high usage. Returns
// { pressure, leak, firstRam, lastRam, growthPct, avgPct }.
function detectRamPressure(history, limitMB, opts) {
  const o = opts || {};
  const rows = (Array.isArray(history) ? history : []).filter(r => r && Number.isFinite(r.ram));
  if (!limitMB || rows.length < 5) return { pressure: false, leak: false, samples: rows.length };
  const first = rows[0].ram, last = rows[rows.length - 1].ram;
  const avgPct = Math.round(rows.reduce((s, r) => s + r.ram, 0) / rows.length / limitMB * 100);
  const growthPct = first > 0 ? Math.round((last - first) / first * 100) : 0;
  // Monotonic-ish climb: compare the first third vs the last third of the window.
  const third = Math.max(1, Math.floor(rows.length / 3));
  const early = rows.slice(0, third).reduce((s, r) => s + r.ram, 0) / third;
  const late = rows.slice(-third).reduce((s, r) => s + r.ram, 0) / third;
  const climbing = late > early * 1.15 && last > first * 1.15; // +15%
  const high = avgPct >= (Number(o.highPct) || 90);
  // pressure = already high OR steadily climbing. leak = a steady climb that does not come back
  // down (the classic leak signature), independent of whether it has hit the limit yet.
  return { pressure: high || climbing, leak: climbing, firstRam: first, lastRam: last, growthPct, avgPct, samples: rows.length };
}

// ---- plan builder (pure) ----
// facts = {
//   issues: [{ id, level, detail, fix }],            // from diagnoseFromData
//   port: { port, free, suggestedPort, holder },      // from check_port
//   missingDeps: [{ modId, neededBy }],               // from check_mod_compat
//   crashLoop: { loop, count },                       // from detectCrashLoop
//   ram: { pressure, leak, avgPct, growthPct },       // from detectRamPressure
//   newestBackup: 'name.zip' | null,
// }
// Returns { plan: [ { action, risk, reason, args } ], summary } - empty plan = nothing to fix.
function proposeRepair(facts) {
  const f = facts || {};
  const plan = [];
  const issueIds = new Set((f.issues || []).map(i => i && i.id).filter(Boolean));

  // 1) Port conflict -> change server-port (+ restart).
  const port = f.port || {};
  if (port.free === false) {
    const target = Number.isInteger(port.suggestedPort) ? port.suggestedPort : (Number(port.port) || 25565) + 1;
    plan.push({ action: ACTION.CHANGE_PORT, risk: ACTION_RISK[ACTION.CHANGE_PORT], reason: port.hint || `Port ${port.port} is in use.`, args: { key: 'server-port', value: String(target), restart: true } });
  } else if (issueIds.has('port-busy')) {
    // diagnose flagged it but we have no concrete port facts -> still propose a port change.
    plan.push({ action: ACTION.CHANGE_PORT, risk: ACTION_RISK[ACTION.CHANGE_PORT], reason: 'The server port is already in use.', args: { key: 'server-port', value: String((Number(port.port) || 25565) + 1), restart: true } });
  }

  // 2) Missing required mod dependency -> install it (via marketplace).
  for (const dep of (f.missingDeps || [])) {
    if (!dep || !dep.modId) continue;
    plan.push({ action: ACTION.INSTALL_DEPENDENCY, risk: ACTION_RISK[ACTION.INSTALL_DEPENDENCY], reason: dep.neededBy ? `Mod "${dep.modId}" is required by "${dep.neededBy}".` : `Required mod dependency "${dep.modId}" is missing.`, args: { query: dep.modId, kind: 'mod' } });
  }

  // 3) RAM pressure / leak -> suggest tuning (view-distance, memory). Suggest-only in spirit, but
  //    it still executes a config change on confirm, so it is a write action.
  const ram = f.ram || {};
  if (ram.pressure) {
    const why = ram.leak ? `Memory is climbing steadily (${ram.growthPct}% over the window, ~${ram.avgPct}% of the limit) - looks like a leak or an undersized heap.` : `Memory is running high (~${ram.avgPct}% of the limit).`;
    const args = { lowerViewDistance: true };
    if (ram.leak) args.suggestMemoryIncrease = true;
    plan.push({ action: ACTION.TUNE_PERFORMANCE, risk: ACTION_RISK[ACTION.TUNE_PERFORMANCE], reason: why, args });
  }

  // 4) Crash loop -> propose rolling back to the newest backup.
  const cl = f.crashLoop || {};
  if (cl.loop) {
    plan.push({ action: ACTION.RESTORE_BACKUP, risk: ACTION_RISK[ACTION.RESTORE_BACKUP], reason: `${cl.count} crashes in the last hour - the server is in a crash loop.`, args: { name: f.newestBackup || null, restart: true } });
  }

  const summary = plan.length === 0
    ? 'No automatic fix is suggested for the current state.'
    : `${plan.length} fix(es) proposed. Each needs your confirmation before it runs.`;
  return { plan, summary, requiresConfirm: plan.length > 0 };
}

// ---- mod-name matching (v2.5.0 fix: Doctor proposed a dep it could not install) ----
// Modrinth full-text search does NOT match a run-together name against a spaced project title
// (query 'alexsmobs' -> 0 hits, but 'Alex Mobs' -> hits). The Doctor only knows the modId from jar
// metadata (often a slugified name), so apply_fix must try query variants and then a direct slug
// lookup before giving up. These are pure so they are unit-tested.
function normName(s) { return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, ''); }

// Generate query variants from a modId-ish string: the raw value, spaced/normalised forms, and a
// guessed hyphenated slug. Order = most-likely first. Deduped, capped small.
function candidateQueries(query) {
  const q = String(query == null ? '' : query).trim();
  const out = [];
  const add = v => { const s = String(v || '').trim(); if (s && !out.includes(s)) out.push(s); };
  add(q);
  // 'alexs-mobs' -> 'alexs mobs'; 'alexsmobs' stays
  add(q.replace(/[-_]+/g, ' '));
  // split a run-together lowercase name into words at best effort: insert a space before the last
  // capital, else split known 's' boundaries is unreliable -> just offer a camel-ish split of a
  // trailing 's' plural (alexsmobs -> alexs mobs) since that pattern is common for MC mod ids.
  const spaced = q.replace(/([a-z])([A-Z])/g, '$1 $2');
  add(spaced);
  const pluralSplit = q.replace(/([a-z])s([a-z])/i, '$1s $2');
  add(pluralSplit);
  return out.slice(0, 4);
}

// Score how well a marketplace hit matches the requested query. Returns { best, ambiguous }.
// best = the clear winner, or null when nothing matches / the result is ambiguous (do NOT blind-pick
// the top hit - the caller surfaces the candidate list instead of installing the wrong mod).
function pickBestMatch(query, items) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return { best: null, ambiguous: false, candidates: [] };
  const want = normName(query);
  const scored = list.map(it => {
    const id = normName(it && it.id);
    const title = normName(it && it.title);
    let score = 0;
    if (id && id === want) score = 3;
    else if (title && title === want) score = 3;
    else if (id && (id.includes(want) || want.includes(id))) score = 2;
    else if (title && (title.includes(want) || want.includes(title))) score = 2;
    return { it, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const top = scored[0];
  if (!top || top.score === 0) return { best: null, ambiguous: false, candidates: list.slice(0, 5) };
  // A clear exact match, or a substring match with no rival of equal score -> safe to use.
  const ties = scored.filter(s => s.score === top.score).length;
  if (top.score === 3 || ties === 1) return { best: top.it, ambiguous: false, candidates: [top.it] };
  return { best: null, ambiguous: true, candidates: scored.slice(0, 5).map(s => s.it) };
}

module.exports = { ACTION, ACTION_RISK, detectCrashLoop, detectRamPressure, proposeRepair, candidateQueries, pickBestMatch, normName };
