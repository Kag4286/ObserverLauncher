// js/00-core.js — split from app.js (lines 1-87); classic script, load in numeric order.
// core helpers: $/$$, i18n t(), state, toast, validation, charts.
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
// FEATURE: minimal i18n — data-i18n / data-i18n-placeholder attributes are swapped from window.LOCALES
// on locale change; falls back to English for any key missing in the active locale.
let currentLocale = 'en';
const _missingI18nLogged=new Set();
// Java major from a version string, e.g. '21.0.4' -> 21, '1.8.0' -> 8. Lives in core because
// 07-overview.js calls it during boot, before the later-numbered files (12-wizard) have loaded.
const javaMajorOf=s=>{const m=String(s||'').match(/(?:1\.)?(\d+)/);return m?Number(m[1]):null};
// 2.2.0 (C): min Java a server jar needs. Mirrors src/main/java.js requiredJavaForJar so the UI can
// show 'needs Java X' without an IPC round-trip. Calendar scheme 26.x -> 25; 1.x by minor/patch.
const requiredJavaOf=jar=>{const s=String(jar||'');let m=s.match(/\b1\.(\d{1,2})(?:\.(\d{1,2}))?\b/);if(m){const minor=Number(m[1]),patch=Number(m[2]||0);if(minor>=21)return 21;if(minor===20&&patch>=5)return 21;if(minor>=18)return 17;if(minor>=17)return 16;return 8}if(/\b26\.\d{1,2}\b/.test(s))return 25;return null};
function t(key,repl){
  const val=(window.LOCALES?.[currentLocale]?.[key]) ?? (window.LOCALES?.en?.[key]);
  if(val==null){ if(!_missingI18nLogged.has(key)){ _missingI18nLogged.add(key); console.warn(`[i18n] missing key: ${key} (locale: ${currentLocale})`);} return key; }
  return repl?String(val).replace(/\{(\w+)\}/g,(m,k)=>repl[k]??m):val;
}
function applyLocale(){
  document.documentElement.lang = currentLocale;
  $$('[data-i18n]').forEach(el=>{el.textContent=t(el.dataset.i18n)});
  $$('[data-i18n-html]').forEach(el=>{el.innerHTML=t(el.dataset.i18nHtml)});
  $$('[data-i18n-placeholder]').forEach(el=>{el.placeholder=t(el.dataset.i18nPlaceholder)});
  $$('[data-i18n-title]').forEach(el=>{el.title=t(el.dataset.i18nTitle)});
  // BUGFIX: the page title (#pageTitle) has no data-i18n — it is set by switchTab. Changing the
  // language from Settings left it in the old language until the user switched tabs. Re-derive it
  // from the active nav item here so it updates immediately.
  const activeNav = document.querySelector('.nav-item.active');
  const titleEl = document.getElementById('pageTitle');
  if (activeNav?.dataset.tab && titleEl) titleEl.textContent = t('nav.' + activeNav.dataset.tab) || titles[activeNav.dataset.tab] || titleEl.textContent;
}
const tf=t;
// "?" bubbles: hover shows the native title, click/tap opens an instant translated bubble.
let kpiTipEl=null;
function closeKpiTip(){if(kpiTipEl){kpiTipEl.remove();kpiTipEl=null}}
function showKpiTip(h){
  if(kpiTipEl){closeKpiTip();return}
  kpiTipEl=document.createElement('div');kpiTipEl.className='kpi-tip';kpiTipEl.textContent=t(h.dataset.i18nTitle);
  document.body.appendChild(kpiTipEl);
  const r=h.getBoundingClientRect(),tr=kpiTipEl.getBoundingClientRect();
  let x=r.left+r.width/2-tr.width/2,y=r.bottom+8;
  x=Math.max(8,Math.min(x,window.innerWidth-tr.width-8));
  if(y+tr.height>window.innerHeight-8)y=r.top-tr.height-8;
  kpiTipEl.style.left=x+'px';kpiTipEl.style.top=y+'px';
}
document.addEventListener('click',e=>{
  const h=e.target.closest('.kpi-help');
  if(h){e.stopPropagation();showKpiTip(h);return}
  closeKpiTip();
});
// UX (2.6.0) a11y: make the KPI "?" bubbles reachable/operable by keyboard. They are plain
// spans; give each a role+tabindex and open the same tip on Enter/Space, close on Escape.
document.querySelectorAll('.kpi-help').forEach(h=>{
  h.setAttribute('role','button'); h.setAttribute('tabindex','0');
  h.addEventListener('keydown',e=>{ if(e.key==='Enter'||e.key===' '){e.preventDefault();showKpiTip(h)} else if(e.key==='Escape'){closeKpiTip()} });
});
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeKpiTip()});
window.addEventListener('resize',closeKpiTip);
let state = { settings:{serverPath:'',javaPath:'',memoryMin:2,memoryMax:6,autoEula:true}, files:{plugins:[],mods:[],datapacks:[],worlds:[],backups:[],properties:{}}, running:false, live:{players:[]} };
let samples = Array.from({length:38},()=>({tps:null,mspt:null,cpu:null,ram:null}));
// v5.3.0: Performance range selector. `samples` stays the 38-point ring that feeds the sparkline and
// the 15m view. `samplesLong` is a client-side 10s-resolution ring (seeded from state.metricsLong) so
// the 1h/6h/24h views do not depend on the server pushing a second stream every tick. `chartSamples` is
// what metricChart draws - it aliases `samples` for 15m and a downsampled slice of samplesLong otherwise.
let samplesLong = [];
let perfRange = '15m';
let chartSamples = samples;
// 5.4.0: cap raised from 2160 (6h) to 8640 (24h at one sample / 10s); the server ring is now
// persisted to disk, so a restart repopulates the whole 24h window.
const PERF_LONG_MS = 10000, PERF_LONG_CAP = 8640;
let selectedPlayer = null; let marketSort = 'downloads';
let lastInspectData=null; // kept so icons:update can re-render the open inspector (now text-only, but keep for compat)
let invSearchQuery='', invShowEmpty=false, invSortBy='slot';
let ecSearchQuery='', ecShowEmpty=false, ecSortBy='slot';
const titles={overview:'Overview',console:'Console',players:'Players',performance:'Performance',content:'Content library',marketplace:'Marketplace',worlds:'Worlds & backups',properties:'Server properties',settings:'Launcher settings'};
const esc=s=>String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
// SECURITY (mirror of src/main/validate.js — renderer has no require()).
// Player names are interpolated into console commands (`kick ${name}`) and
// sent to whitelist/ban/op handlers. A name with a newline would execute as
// a SECOND command on the server stdin, so reject it HERE for instant
// feedback (the backend re-validates as defense in depth).
function isSafePlayerName(name){return typeof name==='string'&&/^[A-Za-z0-9_]{3,16}$/.test(name)}
// v6.0.0 H6: turn KNOWN player names inside a console line into clickable links. PURE + safe:
//   - the whole text is escaped first (never injects markup from a log line);
//   - only names in `names` (the server's real known/online players) are linked, so an ordinary word
//     like "join" is never turned into a link;
//   - the alternation is capped (200 names) and names are word-boundary anchored.
// Returns escaped HTML with <a class="log-player" data-player="Name">Name</a> for each hit. When
// there are no names it returns esc(text) unchanged, so the caller can use it unconditionally.
function linkifyKnownPlayers(text, names){
  const html=esc(text);
  const list=(Array.isArray(names)?names:[]).filter(isSafePlayerName).slice(0,200);
  if(!list.length) return html;
  const uniq=[...new Set(list)].sort((a,b)=>b.length-a.length);
  const re=new RegExp('\\b('+uniq.map(n=>n.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|')+')\\b','g');
  return html.replace(re,(m)=>'<a href="#" class="log-player" data-player="'+m+'">'+m+'</a>');
}
// UX (2.6.0): turn a raw backend/IPC error string into a short, human-readable sentence. Central
// mapping so every tab (settings, properties, folder pick, wizard) reports failures the same way
// instead of dumping a raw stack/errno. Falls back to the original text so nothing is lost.
const _ERR_MAP=[
  [/timed out|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|getaddrinfo|ECONNREFUSED|network|fetch failed/i,'toast.errNetwork'],
  [/ENOSPC|no space|disk full/i,'toast.errDisk'],
  [/EACCES|EPERM|permission denied|access is denied/i,'toast.errPermission'],
  [/EBUSY|resource busy|being used by another process/i,'toast.errBusy'],
  [/checksum|sha-?256/i,'toast.errChecksum'],
  [/is not a directory|ENOENT|no such file/i,'toast.errNotFound'],
];
// v6.0.0 G1: render a Minecraft MOTD preview from a server.properties motd value. Handles the
// section-sign color/format codes (§0-§f, §l bold, §o italic, §n underline, §m strike, §r reset,
// §k obfuscated -> shown as the literal chars). PURE + safe: every text segment is escaped BEFORE
// the wrap, so a hostile motd cannot inject markup. Returns '' for an empty value.
const _MC_COLORS={0:'#000000',1:'#0000AA',2:'#00AA00',3:'#00AAAA',4:'#AA0000',5:'#AA00AA',6:'#FFAA00',7:'#AAAAAA',8:'#555555',9:'#5555FF',a:'#55FF55',b:'#55FFFF',c:'#FF5555',d:'#FF55FF',e:'#FFFF55',f:'#FFFFFF'};
function renderMotdPreview(text){
  const s=String(text||'');
  if(!s) return '';
  let color='', bold=false, italic=false, underline=false, strike=false;
  let out='';
  const escSeg=(t)=>{ if(!t) return ''; const style=[]; if(color)style.push('color:'+color); if(bold)style.push('font-weight:700'); if(italic)style.push('font-style:italic'); if(underline)style.push('text-decoration:underline'); if(strike)style.push('text-decoration:line-through'); return style.length?('<span style="'+style.join(';')+'">'+esc(t)+'</span>'):esc(t); };
  let i=0;
  while(i<s.length){
    if(s[i]==='\u00a7' && i+1<s.length){
      const c=s[i+1].toLowerCase();
      if(_MC_COLORS[c]){ color=_MC_COLORS[c]; bold=italic=underline=strike=false; i+=2; continue; }
      if(c==='l'){bold=true;i+=2;continue} if(c==='o'){italic=true;i+=2;continue}
      if(c==='n'){underline=true;i+=2;continue} if(c==='m'){strike=true;i+=2;continue}
      if(c==='r'){color='';bold=italic=underline=strike=false;i+=2;continue}
      if(c==='k'){ i+=2; continue; } // obfuscated: drop the code, keep readable text
      // unknown code: render the two chars literally (escaped)
      out+=escSeg('\u00a7'+s[i+1]); i+=2; continue;
    }
    // gather a run of plain chars up to the next code
    let j=i; while(j<s.length && s[j]!=='\u00a7') j++;
    out+=escSeg(s.slice(i,j)); i=j;
  }
  return out;
}
// v6.0.0 G3: JVM argument presets. PURE (min/max GB in, arg string out) so they are unit-tested in
// 00-core; 08-shell.js wires them to the input + toast. Aikar's flags are the default recommendation
// for Paper/Purpur; ZGC suits very large heaps on Java 21+; G1-tuned is a lighter alternative.
function aikarFlags(minGB,maxGB){return `-Xms${minGB}G -Xmx${maxGB}G -XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200 -XX:+UnlockExperimentalVMOptions -XX:+DisableExplicitGC -XX:+AlwaysPreTouch -XX:G1NewSizePercent=30 -XX:G1MaxNewSizePercent=40 -XX:G1HeapRegionSize=8M -XX:G1ReservePercent=20 -XX:G1HeapWastePercent=5 -XX:G1MixedGCCountTarget=4 -XX:InitiatingHeapOccupancyPercent=15 -XX:G1MixedGCLiveThresholdPercent=90 -XX:G1RSetUpdatingPauseTimePercent=5 -XX:SurvivorRatio=32 -XX:+PerfDisableSharedMem -XX:MaxTenuringThreshold=1 -Dusing.aikars.flags=https://mcflags.emc.gs -Dfile.encoding=UTF-8`}
function zgcFlags(minGB,maxGB){return `-Xms${minGB}G -Xmx${maxGB}G -XX:+UseZGC -XX:+ZGenerational -XX:+AlwaysPreTouch -XX:+DisableExplicitGC -Dfile.encoding=UTF-8`}
function g1TunedFlags(minGB,maxGB){return `-Xms${minGB}G -Xmx${maxGB}G -XX:+UseG1GC -XX:MaxGCPauseMillis=100 -XX:G1NewSizePercent=20 -XX:G1MaxNewSizePercent=50 -XX:G1HeapRegionSize=8M -XX:G1ReservePercent=15 -XX:+ParallelRefProcEnabled -XX:+AlwaysPreTouch -Dfile.encoding=UTF-8`}
const JVM_PRESETS={ aikar:aikarFlags, zgc:zgcFlags, g1:g1TunedFlags };
function friendlyError(msg){
  const m=String(msg==null?'':msg);
  for(const [re,key] of _ERR_MAP){ if(re.test(m)){ const s=t(key); if(s!==key) return s; } }
  return m;
}
function playerNameError(name){
  if(!name) return t('ply.nameFirst');
  if(/[\r\n]/.test(name)) return t('ply.nameLineBreak');
  if(!isSafePlayerName(name)) return t('ply.nameInvalid');
  return null;
}
let toastQueue=[],toastTimer=null;
function toast(message,kind,action){toastQueue.push({message,kind,action});if(toastQueue.length>3)toastQueue.shift();flushToast()}
function flushToast(){
  if(toastTimer)return;
  const item=toastQueue.shift();if(!item)return;
  const el=$('#toast');el.innerHTML='';
  const span=document.createElement('span');span.textContent=item.message;el.appendChild(span);
  // UX (2.6.0): an optional undo/action button. When present the toast lingers longer so the user
  // has a real chance to click it; clicking runs fn, then dismisses immediately.
  if(item.action&&typeof item.action.fn==='function'){
    const b=document.createElement('button');b.type='button';b.className='toast-action';
    b.textContent=item.action.label||t('toast.undo');
    b.onclick=()=>{ try{item.action.fn()}catch{} clearTimeout(toastTimer);toastTimer=null;el.classList.remove('show');setTimeout(flushToast,80); };
    el.appendChild(b);
  }
  el.className='show '+(item.kind||'');
  const life=(item.action&&item.action.fn)?5200:2800;
  toastTimer=setTimeout(()=>{el.classList.remove('show');toastTimer=null;setTimeout(flushToast,80)},life);
}
// UX (2.6.0): shared interaction helpers. withBusy() disables a trigger for the duration of an
// async action so a double-click can't fire it twice; it always restores the button (even on throw)
// and returns fn's value. Focus trap keeps Tab/Shift+Tab inside an open modal and remembers what had
// focus so it can be restored on close — Chromium otherwise tabs into the page behind an overlay.
async function withBusy(btn, fn){
  if(!btn) return fn();
  if(btn.dataset.busy==='1') return undefined; // already running — swallow the second click
  btn.dataset.busy='1'; btn.disabled=true; btn.setAttribute('aria-busy','true');
  try{ return await fn(); }
  finally{ delete btn.dataset.busy; btn.disabled=false; btn.removeAttribute('aria-busy'); }
}
// CORE (3.2.5): rAF-coalesce a redraw so rapid events (pan/move/type) run it once per frame instead
// of hundreds of times. Returns a scheduler bound to its own pending-flag slot. Lives in core because
// both the editor (01b) and the world map (02) need it and neither loads before the other's caller.
function rafCoalesce(fn){ let pending=0; return function(){ if(pending)return; pending=requestAnimationFrame(()=>{ pending=0; fn(); }); }; }
// CORE (3.2.5): insert into a Map and evict the oldest entry (FIFO) once it exceeds max. Shared by the
// world map's colour/biome/explored caches so the eviction rule cannot drift between them.
function lruSet(map,key,val,max){ map.set(key,val); if(map.size>max)map.delete(map.keys().next().value); return map; }
const FOCUSABLE='a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
function focusablesIn(root){ return [...root.querySelectorAll(FOCUSABLE)].filter(el=>el.offsetParent!==null||el===document.activeElement); }
let _trapRoot=null,_trapPrev=null;
function trapFocus(root){
  _trapRoot=root; _trapPrev=document.activeElement;
  root.addEventListener('keydown',_trapKeydown);
}
function releaseFocus(){
  if(_trapRoot) _trapRoot.removeEventListener('keydown',_trapKeydown);
  const prev=_trapPrev; _trapRoot=null; _trapPrev=null;
  if(prev&&typeof prev.focus==='function'&&document.contains(prev)) try{prev.focus()}catch{}
}
function _trapKeydown(e){
  if(e.key!=='Tab'||!_trapRoot) return;
  const f=focusablesIn(_trapRoot); if(!f.length) return;
  const first=f[0],last=f[f.length-1];
  if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}
  else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}
}
// In-app confirm dialog (replaces native confirm()) — same Promise<boolean> shape so call
// sites read `if(!await confirmDialog(...)) return;`. One overlay reuses for every prompt;
// the pending resolver is stored so Escape / Cancel / backdrop all resolve false exactly once.
//   opts: { title, body, ok, cancel, danger }  body may contain trusted HTML (t() output).
let _cfResolve=null;
function confirmDialog(opts){
  opts=opts||{};
  const m=$('#confirmModal');
  if(!m) return Promise.resolve(false);
  $('#cfTitle').textContent=opts.title||t('cf.title');
  $('#cfBody').innerHTML=opts.body||'';
  $('#cfOk').textContent=opts.ok||t('cf.ok');
  $('#cfCancel').textContent=opts.cancel||t('cf.cancel');
  const ok=$('#cfOk');ok.className='btn '+(opts.danger?'danger':'primary');
  const ico=$('#cfIco');if(ico)ico.className='confirm-ico'+(opts.danger?' danger':'');
  const cancel=$('#cfCancel');if(cancel)cancel.hidden=!!opts.hideCancel;
  m.hidden=false;void m.offsetWidth;m.classList.add('show');
  trapFocus(m);
  setTimeout(()=>ok.focus(),20);
  return new Promise(resolve=>{_cfResolve=resolve});
}
function closeConfirm(result){
  const m=$('#confirmModal');if(!m||m.hidden)return;
  m.classList.remove('show');m.hidden=true;
  releaseFocus();
  if(_cfResolve){const r=_cfResolve;_cfResolve=null;r(!!result)}
}
$('#cfOk')?.addEventListener('click',()=>closeConfirm(true));
$('#cfCancel')?.addEventListener('click',()=>closeConfirm(false));
$('#confirmModal')?.addEventListener('click',e=>{if(e.target.id==='confirmModal')closeConfirm(false)});
document.addEventListener('keydown',e=>{const m=$('#confirmModal');if(!m||m.hidden)return;if(e.key==='Escape')closeConfirm(false);else if(e.key==='Enter')closeConfirm(true)});
// BUGFIX (Electron sandbox): window.prompt() is NOT supported in this renderer (it throws
// "prompt() is not supported"), which broke instance rename. This is a small in-app replacement
// with the same Promise<string|null> contract as confirmDialog. Returns the trimmed value, or null
// when cancelled/empty.
let _pmResolve=null;
function promptDialog(opts){
  opts=opts||{};
  const m=$('#promptModal');
  if(!m) return Promise.resolve(null);
  $('#pmTitle').textContent=opts.title||'Enter a value';
  const input=$('#pmInput');
  input.value=opts.value||'';
  // v6.0.0 E3: some prompts need to accept an EMPTY submit as a real value (clearing an instance
  // group). Default behaviour treats an empty OK as 'cancel' (null), which is right for a rename but
  // wrong for a set-or-clear field. Opt into '' explicitly.
  m.dataset.allowEmpty = opts.allowEmpty ? '1' : '';
  if(opts.placeholder) input.placeholder=opts.placeholder; else input.removeAttribute('placeholder');
  $('#pmOk').textContent=opts.ok||t('cf.ok');
  $('#pmCancel').textContent=opts.cancel||t('cf.cancel');
  const ico=$('#pmIco');if(ico)ico.className='confirm-ico'+(opts.danger?' danger':'');
  m.hidden=false;void m.offsetWidth;m.classList.add('show');
  trapFocus(m);
  setTimeout(()=>{input.focus();input.select();},20);
  return new Promise(resolve=>{_pmResolve=resolve});
}
function closePrompt(result){
  const m=$('#promptModal');if(!m||m.hidden)return;
  m.classList.remove('show');m.hidden=true;
  releaseFocus();
  if(_pmResolve){const r=_pmResolve;_pmResolve=null;r(result===undefined?null:result)}
}
function _pmSubmit(){
  const m=$('#promptModal');
  const v=($('#pmInput')?.value||'').trim();
  if(v)return closePrompt(v);
  // Empty input: a normal prompt -> cancel (null); an allowEmpty prompt -> '' (a real clear).
  return closePrompt(m&&m.dataset.allowEmpty==='1'?'':null);
}
$('#pmOk')?.addEventListener('click',_pmSubmit);
$('#pmCancel')?.addEventListener('click',()=>closePrompt(null));
$('#promptModal')?.addEventListener('click',e=>{if(e.target.id==='promptModal')closePrompt(null)});
$('#pmInput')?.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();_pmSubmit()}});
document.addEventListener('keydown',e=>{const m=$('#promptModal');if(!m||m.hidden)return;if(e.key==='Escape')closePrompt(null)});
// MOTION (1.3.0): tween a number element toward a new value instead of snapping. Restrained:
// short duration, no spring, and totally skipped under prefers-reduced-motion. Keeps the last
// tween per element so rapid updates never fight each other.
const _tweens=new WeakMap();
const _rm=matchMedia('(prefers-reduced-motion: reduce)');
function tweenNumber(el,to,fmt){
  if(!el) return;
  const target=Number(to); if(!Number.isFinite(target)) return;
  fmt=fmt||(v=>String(Math.round(v)));
  if(_rm.matches){ el.textContent=fmt(target); return; }
  const prev=_tweens.get(el);
  if(prev) cancelAnimationFrame(prev.raf);
  const from=(prev&&Number.isFinite(prev.value))?prev.value:(Number(String(el.textContent).replace(/[^\d.-]/g,''))||0);
  if(from===target){ el.textContent=fmt(target); _tweens.set(el,{value:target,raf:0}); return; }
  const t0=performance.now(),dur=Math.min(360,Math.max(140,Math.abs(target-from)*8));
  // Needle settle: a tiny back-ease so the number overshoots ~4% and settles — reads as a gauge
  // coming to rest, not a jump. Only when the change is small (big jumps go straight).
  const small=Math.abs(target-from)<=6;
  const step=now=>{
    const k=Math.min(1,(now-t0)/dur);
    const e=small ? (k<1 ? 1-Math.pow(1-k,3)*(1+0.9*Math.sin(k*Math.PI)) : 1) : 1-Math.pow(1-k,3);
    const v=from+(target-from)*e; el.textContent=fmt(v);
    if(k<1){ const st=_tweens.get(el)||{}; st.raf=requestAnimationFrame(step); st.value=v; _tweens.set(el,st); }
    else _tweens.set(el,{value:target,raf:0});
  };
  _tweens.set(el,{value:from,raf:requestAnimationFrame(step)});
}
// MOTION LEVEL (1.3.0): 'full' (default, rich) or 'lite' (weak PCs). Lite adds .motion-lite on
// <html>; CSS there disables ambience/boot/proximity/spotlight/stagger. Called from refreshUI on
// every settings load, so it also applies live when the user changes it (no restart needed).
function applyMotionLevel(level){
  const lite = level==='lite';
  document.documentElement.classList.toggle('motion-lite', lite);
  if(lite){ const b=document.querySelector('#bootSeq'); if(b) b.remove(); }
  const cv=document.querySelector('#ovSpark'); if(cv && !lite){ /* redraw happens on next metrics tick */ }
}
// v6.0.0 D3: TPS anomaly detection. Pure: takes the recent samples, returns null when the server
// is healthy, or { current, baseline, dropPct, cause } when TPS has dropped sharply. Baseline is the
// median of the samples BEFORE the last N, so a slow decline over the whole window is not flagged
// as a single anomaly; only a step change is. `cause` is a heuristic label the UI translates.
//   tick     -> mspt is also high (the server tick itself is slow)
//   players  -> more players than the baseline window
//   memory   -> heap is near the ceiling
//   unknown  -> no obvious signal
function detectTpsAnomaly(samples,opts){
  const o=opts||{};
  const win=Array.isArray(samples)?samples.filter(s=>s&&Number.isFinite(Number(s.tps))):[];
  const baseWin=Number(o.baseWindow)||30;
  const minBase=Number(o.minBase)||10;
  if(win.length<baseWin+1)return null;
  const recent=win.slice(-1)[0];
  const cur=Number(recent.tps);
  // Baseline is the window BEFORE the most recent sample, so the sample itself cannot inflate it.
  const base=win.slice(-1-baseWin,-1).map(s=>Number(s.tps)).sort((a,b)=>a-b);
  if(base.length<minBase)return null;
  const baseline=base[Math.floor(base.length/2)];
  if(baseline<=0)return null;
  const drop=baseline-cur;
  const dropPct=Math.round((drop/baseline)*100);
  const minTps=Number(o.minTps)||17;
  const minDropPct=Number(o.minDropPct)||20;
  if(cur>=minTps||dropPct<minDropPct)return null;
  const playersNow=Number(recent.players)||0;
  const playersBase=win.slice(-1-baseWin,-1).reduce((m,s)=>Math.max(m,Number(s.players)||0),0);
  let cause='unknown';
  if(Number(recent.mspt)>45)cause='tick';
  else if(playersNow-playersBase>=3)cause='players';
  else if(Number(recent.ram)>85)cause='memory';
  return { current:+cur.toFixed(2), baseline:+baseline.toFixed(2), dropPct, cause };
}
// v6.0.0 D4: memory-leak watch. Pure: takes the 10s ring (samplesLong) and returns null unless the
// heap has risen steadily over the whole window. Splits the window into 3 equal slices, takes the
// median ram in each, and only flags when every slice is strictly higher than the previous one AND
// the average %/hour growth exceeds `minRatePct`. A GC sawtooth averages out and does not pass.
function detectMemoryLeak(samples,opts){
  const o=opts||{};
  const minHours=Number(o.minHours)||2;
  const minRatePct=Number(o.minRatePct)||2;
  const rows=(Array.isArray(samples)?samples:[]).filter(s=>s&&Number.isFinite(Number(s.ram))&&Number.isFinite(Number(s.t)));
  if(rows.length<9)return null;
  const tMin=Number(rows[0].t), tMax=Number(rows[rows.length-1].t);
  const spanH=(tMax-tMin)/(60*60*1000);
  if(!Number.isFinite(spanH)||spanH<minHours)return null;
  // 3 equal time slices, median ram in each.
  const cuts=[tMin, tMin+(tMax-tMin)/3, tMin+2*(tMax-tMin)/3, tMax+1];
  const med=[];
  for(let i=0;i<3;i++){
    const bucket=rows.filter(s=>Number(s.t)>=cuts[i]&&Number(s.t)<cuts[i+1]).map(s=>Number(s.ram)).sort((a,b)=>a-b);
    if(!bucket.length)return null;
    med.push(bucket[Math.floor(bucket.length/2)]);
  }
  if(!(med[0]<med[1]&&med[1]<med[2]))return null;
  const ratePct=((med[2]-med[0])/Math.max(1,med[0]))*100/spanH;
  if(ratePct<minRatePct)return null;
  return { from:+med[0].toFixed(1), to:+med[2].toFixed(1), growthPerHour:+ratePct.toFixed(2), hours:+spanH.toFixed(1) };
}
function metricChart(canvas,expanded=false,mode='combined'){if(!canvas)return;const ctx=canvas.getContext('2d');const r=canvas.getBoundingClientRect();if(!r.width||!r.height) return;const d=devicePixelRatio||1;canvas.width=r.width*d;canvas.height=r.height*d;ctx.scale(d,d);const w=r.width,h=r.height,p=expanded?30:13;const cs=getComputedStyle(document.documentElement);const cAccent=cs.getPropertyValue('--chart-tps').trim()||'#00e5ff';const cWarn=cs.getPropertyValue('--chart-cpu').trim()||'#d6a24a';const cSuccess=cs.getPropertyValue('--chart-ram').trim()||'#2fd0a0';const cDanger=cs.getPropertyValue('--danger').trim()||'#e5566a';const cMuted=cs.getPropertyValue('--text-dim').trim()||'#5c6470';const cFont=cs.getPropertyValue('--font-ui').trim()||'Space Grotesk, sans-serif';ctx.clearRect(0,0,w,h);
  if(mode==='tick'){
    // Danger band: bottom 25% of the chart (roughly under ~15 TPS / over ~25ms MSPT) tinted red,
    // so a dip reads as "into the red zone" at a glance instead of needing to read the numbers.
    const bandTop=h-p-(h-p*2)*0.25;
    ctx.fillStyle='rgba(229,86,106,.06)';ctx.fillRect(p,bandTop,w-p*2,h-p-bandTop);
  }
  ctx.strokeStyle='rgba(255,255,255,.06)';for(let y=p;y<h-p;y+=(h-p*2)/4){ctx.beginPath();ctx.moveTo(p,y);ctx.lineTo(w-p,y);ctx.stroke()}
  if(mode==='tick'){
    // Target reference line at the very top (20 TPS / 0ms MSPT — the "perfect tick" line).
    ctx.setLineDash([4,4]);ctx.strokeStyle=cMuted;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(p,p);ctx.lineTo(w-p,p);ctx.stroke();ctx.setLineDash([]);
  }
  const draw=(key,color,max,normalize)=>{const good=chartSamples.map((v,i)=>({i,v:v[key]})).filter(x=>x.v!==null);if(!good.length)return;const denom=Math.max(1,chartSamples.length-1);ctx.beginPath();good.forEach((x,j)=>{const n=normalize?normalize(x.v):Math.min(x.v,max)/max;const px=p+x.i*(w-p*2)/denom,py=h-p-n*(h-p*2);j?ctx.lineTo(px,py):ctx.moveTo(px,py)});ctx.strokeStyle=color;ctx.lineWidth=2;ctx.stroke()};
  if(mode==='resource'){
    draw('cpu',cWarn,100);draw('ram',cSuccess,100);
    if(expanded){ctx.fillStyle=cMuted;ctx.font=`11px ${cFont}`;ctx.fillText('100%',4,p+4);ctx.fillText('0%',4,h-p+4);ctx.fillText(t('chart.live'),w-120,h-8)}
  } else if(mode==='tick'){
    draw('tps',cAccent,20);
    // MSPT plotted on the SAME up=good axis as TPS: normalized as 1-min(mspt/100,1), so a rising
    // line always means "healthier" for both series, instead of TPS-up/MSPT-down being opposite.
    draw('mspt',cDanger,100,v=>1-Math.min(v,100)/100);
    if(expanded){ctx.fillStyle=cMuted;ctx.font=`11px ${cFont}`;ctx.fillText(t('chart.target'),4,p-4);ctx.fillText(t('chart.danger'),4,h-6);ctx.fillText(t('chart.live'),w-120,h-8)}
  } else {
    draw('tps',cAccent,20);draw('cpu',cWarn,100);draw('ram',cSuccess,100);
    if(expanded){ctx.fillStyle=cMuted;ctx.font=`11px ${cFont}`;ctx.fillText('20 TPS',4,p+4);ctx.fillText('0',16,h-p+4);ctx.fillText(t('chart.live'),w-120,h-8)}
  }
}
