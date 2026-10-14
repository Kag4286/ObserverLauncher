// MCP resources (v5.0.0). SINGLE SOURCE OF TRUTH for both the static resource list and the
// RFC 6570 resource TEMPLATES — the bridge (offline fallback) and the server (resolver) both read
// from here, so they cannot drift (the old code had a hardcoded list in bridge.js AND a switch in
// server.js). Pure data + one resolver; no I/O except the delegate `call`.

// 5.5.0 MCP Apps (SEP-1865): the dashboard the `get_metrics_history` tool renders. A host that
// supports MCP Apps fetches this resource, shows it in a sandboxed iframe, and forwards the tool
// result over a postMessage JSON-RPC bridge. The page draws a small line chart per metric. It is
// deliberately dependency-free: the host handshake is hand-written so the app needs no bundler and
// the packaged build ships no node_modules. Data arrives as `structuredContent.samples`.
const UI_DASHBOARD_HTML = [
  '<!doctype html><html><head><meta charset="utf-8"><style>',
  ':root{--bg:#0C0D0F;--panel:#141619;--border:#24272c;--text:#F4F1EA;--dim:#A39F97;--accent:#22C55E;--warn:#d6a24a;--err:#ff3b5c}',
  '*{box-sizing:border-box}',
  'body{margin:0;font:13px system-ui;background:var(--bg);color:var(--text);padding:14px}',
  'h1{font-size:14px;margin:0 0 2px}',
  '.sub{color:var(--dim);font-size:12px;margin:0 0 12px}',
  '.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}',
  '@media(max-width:520px){.grid{grid-template-columns:1fr}}',
  '.card{background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:10px}',
  '.card h2{font-size:11px;margin:0 0 6px;letter-spacing:.06em;text-transform:uppercase;color:var(--dim);display:flex;justify-content:space-between;gap:8px}',
  '.card b{color:var(--text);font-variant-numeric:tabular-nums}',
  'canvas{width:100%;height:58px;display:block}',
  '.empty{color:var(--dim);padding:22px 0;text-align:center}',
  '.row{display:flex;align-items:flex-start;gap:8px;padding:8px 0;border-top:1px solid var(--border)}',
  '.row:first-child{border-top:0}',
  '.badge{flex-shrink:0;font:700 9px ui-monospace,monospace;letter-spacing:.06em;text-transform:uppercase;padding:2px 6px;border-radius:4px;border:1px solid var(--border);color:var(--dim)}',
  '.badge.ok{color:var(--accent);border-color:var(--accent)}',
  '.badge.warn{color:var(--warn);border-color:var(--warn)}',
  '.badge.error{color:var(--err);border-color:var(--err)}',
  '.row .body{min-width:0}',
  '.row .id{color:var(--dim);font-size:11px;text-transform:uppercase;letter-spacing:.04em}',
  '.row .detail{line-height:1.45}',
  '.row .fix{color:var(--dim);font-size:12px;margin-top:2px}',
  '.chips{display:flex;flex-wrap:wrap;gap:6px}',
  '.chip{font:600 11px system-ui;padding:3px 9px;border-radius:999px;border:1px solid var(--border);background:var(--panel);color:var(--text)}',
  '.chip.on{color:var(--accent);border-color:var(--accent)}',
  '.chips-title{font:700 10px system-ui;text-transform:uppercase;letter-spacing:.06em;color:var(--dim);margin:14px 0 6px}',
  '</style></head><body>',
  '<h1>ObserverLauncher</h1>',
  '<p class="sub" id="sub">Waiting for the tool result.</p>',
  '<div id="root"></div>',
  '<script>(function(){',
  'var METRICS=[',
  '{k:"tps",label:"TPS",fmt:function(v){return v.toFixed(2)},ref:20},',
  '{k:"mspt",label:"MSPT ms",fmt:function(v){return v.toFixed(1)},ref:null},',
  '{k:"cpu",label:"CPU %",fmt:function(v){return Math.round(v)+"%"},ref:null},',
  '{k:"ram",label:"RAM MB",fmt:function(v){return Math.round(v)+" MB"},ref:null},',
  '{k:"players",label:"Players",fmt:function(v){return String(Math.round(v))},ref:null}',
  '];',
  'function post(msg){try{parent.postMessage(msg,"*")}catch(e){}}',
  'post({jsonrpc:"2.0",id:1,method:"ui/initialize",params:{protocolVersion:"2026-01-26",appInfo:{name:"observerlauncher-dashboard",version:"5.6.0"}}});',
  'post({jsonrpc:"2.0",method:"ui/notifications/initialized"});',
  'function notifySize(){post({jsonrpc:"2.0",method:"ui/notifications/size-changed",params:{width:document.documentElement.scrollWidth,height:document.body.scrollHeight}});}',
  'function num(v){return typeof v==="number"&&isFinite(v)}',
  'function root(){return document.getElementById("root")}',
  'function setSub(t){document.getElementById("sub").textContent=t}',
  'function el(tag,cls,txt){var e=document.createElement(tag);if(cls)e.className=cls;if(txt!=null)e.textContent=txt;return e}',
  'function nameOf(x){if(x==null)return "";if(typeof x==="string")return x;return x.name||x.uuid||x.id||""}',
  'function draw(cv,vals,ref){',
  'var dpr=Math.min(window.devicePixelRatio||1,2);',
  'var w=cv.clientWidth||260,h=cv.clientHeight||58;',
  'cv.width=Math.max(1,Math.floor(w*dpr));cv.height=Math.max(1,Math.floor(h*dpr));',
  'var c=cv.getContext("2d");if(!c)return;c.setTransform(dpr,0,0,dpr,0,0);c.clearRect(0,0,w,h);',
  'var pts=vals.filter(num);if(pts.length<1)return;',
  'var lo=Math.min.apply(null,pts),hi=Math.max.apply(null,pts);',
  'if(num(ref)){lo=Math.min(lo,ref);hi=Math.max(hi,ref)}',
  'if(hi-lo<1e-6){hi=lo+1}',
  'var pad=6;',
  'var x=function(i){return pad+(w-pad*2)*(vals.length<2?0:i/(vals.length-1))};',
  'var y=function(v){return h-pad-(h-pad*2)*((v-lo)/(hi-lo))};',
  'if(num(ref)){c.strokeStyle="rgba(163,159,151,.35)";c.setLineDash([3,3]);c.beginPath();c.moveTo(pad,y(ref));c.lineTo(w-pad,y(ref));c.stroke();c.setLineDash([])}',
  'c.strokeStyle="#22C55E";c.lineWidth=1.6;c.lineJoin="round";c.beginPath();var started=false;',
  'for(var i=0;i<vals.length;i++){if(!num(vals[i])){started=false;continue}var px=x(i),py=y(vals[i]);if(!started){c.moveTo(px,py);started=true}else c.lineTo(px,py)}',
  'c.stroke();',
  '}',
  'function renderMetrics(sc){',
  'var r=root();r.className="grid";r.innerHTML="";',
  'var samples=Array.isArray(sc.samples)?sc.samples:[];',
  'if(!samples.length){r.className="";r.innerHTML="<div class=\'empty\'>No samples in this window.</div>";setSub("No metrics yet.");notifySize();return}',
  'var mins=sc.minutes||sc.spanMinutes||"";',
  'setSub(samples.length+" samples"+(mins?" over the last "+mins+" min":"")+" · updated "+new Date().toLocaleTimeString());',
  'METRICS.forEach(function(m){',
  'var vals=samples.map(function(s){return s?Number(s[m.k]):NaN});',
  'var last=null;for(var i=vals.length-1;i>=0;i--){if(num(vals[i])){last=vals[i];break}}',
  'var card=el("div","card");',
  'var h=el("h2");h.appendChild(el("span",null,m.label));h.appendChild(el("b",null,last==null?"—":m.fmt(last)));',
  'card.appendChild(h);var cv=el("canvas");card.appendChild(cv);',
  'r.appendChild(card);draw(cv,vals,m.ref);',
  '});',
  'notifySize();',
  '}',
  'function renderChecks(sc){',
  'var r=root();r.className="";r.innerHTML="";',
  'var checks=Array.isArray(sc.checks)?sc.checks:[];',
  'if(!checks.length){r.innerHTML="<div class=\'empty\'>No checks returned.</div>";setSub("No checks.");notifySize();return}',
  'var counts={error:0,warn:0,ok:0,info:0};checks.forEach(function(c){if(counts[c.level]!=null)counts[c.level]++});',
  'setSub(checks.length+" checks · "+counts.error+" error, "+counts.warn+" warn, "+counts.ok+" ok");',
  'checks.forEach(function(c){',
  'var row=el("div","row");',
  'row.appendChild(el("span","badge "+(c.level||"info"),(c.level||"info")));',
  'var body=el("div","body");',
  'if(c.id)body.appendChild(el("div","id",c.id));',
  'body.appendChild(el("div","detail",c.detail||""));',
  'if(c.fix)body.appendChild(el("div","fix","Fix: "+c.fix));',
  'row.appendChild(body);r.appendChild(row);',
  '});',
  'notifySize();',
  '}',
  'function renderPlayers(sc){',
  'var r=root();r.className="";r.innerHTML="";',
  'var groups=[["Online",sc.online,"on"],["Whitelist",sc.whitelist,""],["Operators",sc.ops,""],["Banned",sc.banned,""],["Known",sc.known,""]];',
  'var total=0;groups.forEach(function(g){total+=(g[1]||[]).length});',
  'if(!total){r.innerHTML="<div class=\'empty\'>No players recorded.</div>";setSub("No players.");notifySize();return}',
  'setSub((sc.online||[]).length+" online · "+total+" listed");',
  'groups.forEach(function(g){',
  'var list=Array.isArray(g[1])?g[1]:[];if(!list.length)return;',
  'r.appendChild(el("div","chips-title",g[0]+" ("+list.length+")"));',
  'var wrap=el("div","chips");',
  'list.forEach(function(p){wrap.appendChild(el("span","chip"+(g[2]?" "+g[2]:""),nameOf(p)))});',
  'r.appendChild(wrap);',
  '});',
  'notifySize();',
  '}',
  'function render(sc){',
  'if(sc&&Array.isArray(sc.samples))return renderMetrics(sc);',
  'if(sc&&Array.isArray(sc.checks))return renderChecks(sc);',
  'if(sc&&(Array.isArray(sc.online)||Array.isArray(sc.whitelist)||Array.isArray(sc.ops)||Array.isArray(sc.banned)))return renderPlayers(sc);',
  'root().innerHTML="<div class=\'empty\'>Nothing to display for this result.</div>";notifySize();',
  '}',
  'function extract(m){',
  'var cands=[m&&m.params&&m.params.result,m&&m.result,m&&m.params,m];',
  'for(var i=0;i<cands.length;i++){var c=cands[i];if(!c||typeof c!=="object")continue;',
  'var sc=c.structuredContent||c.structured_content||c;',
  'if(sc&&(Array.isArray(sc.samples)||Array.isArray(sc.checks)||Array.isArray(sc.online)||Array.isArray(sc.whitelist)))return sc;',
  'if(Array.isArray(c.samples)||Array.isArray(c.checks))return c}',
  'return null}',
  'window.addEventListener("message",function(ev){try{var sc=extract(ev.data);if(sc)render(sc)}catch(e){}});',
  'window.addEventListener("resize",notifySize);',
  '})();</script></body></html>',
].join('');
const UI_RESOURCES = [
  { uri: 'ui://observerlauncher/dashboard', name: 'ObserverLauncher dashboard', description: 'MCP Apps dashboard. Renders line charts for get_metrics_history, a health-check list for diagnose_server / doctor_report, and player chips for list_players.', mimeType: 'text/html;profile=mcp-app' },
];

// Static (fixed-URI) resources an AI can read for context without a tool call.
const STATIC_RESOURCES = [
  { uri: 'observer://server/status', name: 'Server status', description: 'Folder, jar, software, Java, running state.', mimeType: 'application/json' },
  { uri: 'observer://server/properties', name: 'server.properties', description: 'Parsed server.properties.', mimeType: 'application/json' },
  { uri: 'observer://server/console', name: 'Console buffer', description: 'Recent console lines.', mimeType: 'application/json' },
  { uri: 'observer://server/diagnosis', name: 'Health diagnosis', description: 'The doctor health check result.', mimeType: 'application/json' },
  { uri: 'observer://metrics/history', name: 'Metrics history', description: 'Sampled metrics time series (tps/mspt/cpu/ram/players).', mimeType: 'application/json' },
  { uri: 'observer://console/tail', name: 'Console tail', description: 'Last 200 console lines.', mimeType: 'application/json' },
  { uri: 'observer://world/players', name: 'Players', description: 'Online, whitelisted, banned, op and known players.', mimeType: 'application/json' },
  { uri: 'observer://instances', name: 'Instances', description: 'Every server instance (id, name, path, status, active).', mimeType: 'application/json' },
];

// Resource TEMPLATES (RFC 6570). Each maps a concrete URI to an existing read tool + args.
// {uriTemplate, name, description, mimeType, match(uri) -> {tool, args} | null}
const RESOURCE_TEMPLATES = [
  {
    uriTemplate: 'observer://instance/{id}/status',
    name: 'Instance status',
    description: 'Status of ONE instance by id (without making it active).',
    mimeType: 'application/json',
    match: (uri) => { const m = uri.match(/^observer:\/\/instance\/([^/]+)\/status$/); return m ? { tool: 'get_instance_snapshot', args: { instance: decodeURIComponent(m[1]) } } : null; },
  },
  {
    uriTemplate: 'observer://instance/{id}/console',
    name: 'Instance console',
    description: 'Console tail of ONE instance by id.',
    mimeType: 'application/json',
    match: (uri) => { const m = uri.match(/^observer:\/\/instance\/([^/]+)\/console$/); return m ? { tool: 'get_instance_snapshot', args: { instance: decodeURIComponent(m[1]), lines: 200 } } : null; },
  },
  {
    uriTemplate: 'observer://instance/{id}/metrics',
    name: 'Instance metrics',
    description: 'Metrics history of ONE instance by id.',
    mimeType: 'application/json',
    match: (uri) => { const m = uri.match(/^observer:\/\/instance\/([^/]+)\/metrics$/); return m ? { tool: 'get_instance_snapshot', args: { instance: decodeURIComponent(m[1]) } } : null; },
  },
  {
    uriTemplate: 'observer://file/{path}',
    name: 'Server file',
    description: 'Read a text file inside the server folder (path-safe).',
    mimeType: 'text/plain',
    match: (uri) => { const m = uri.match(/^observer:\/\/file\/(.+)$/); return m ? { tool: 'read_file', args: { path: decodeURIComponent(m[1]) } } : null; },
  },
];

// Resolve a concrete URI against the static list first, then the templates. Returns
// { tool, args } or null when nothing matches.
// Returns { text, mimeType } for a ui:// resource, or null. Used by server.js /resource before the
// tool-backed resolver (a ui:// URI has no backing tool).
function resolveUiResource(uri) {
  if (uri === 'ui://observerlauncher/dashboard') return { text: UI_DASHBOARD_HTML, mimeType: 'text/html;profile=mcp-app' };
  return null;
}

function resolveResource(uri) {
  const STATIC_MAP = {
    'observer://server/status': { tool: 'get_status', args: {} },
    'observer://server/properties': { tool: 'get_properties', args: {} },
    'observer://server/console': { tool: 'read_console', args: {} },
    'observer://server/diagnosis': { tool: 'diagnose_server', args: {} },
    'observer://metrics/history': { tool: 'get_metrics_history', args: {} },
    'observer://console/tail': { tool: 'read_console', args: { lines: 200 } },
    'observer://world/players': { tool: 'list_players', args: {} },
    'observer://instances': { tool: 'list_instances', args: {} },
  };
  if (STATIC_MAP[uri]) return STATIC_MAP[uri];
  for (const t of RESOURCE_TEMPLATES) { const hit = t.match(uri); if (hit) return hit; }
  return null;
}

module.exports = { STATIC_RESOURCES, RESOURCE_TEMPLATES, UI_RESOURCES, resolveResource, resolveUiResource };
