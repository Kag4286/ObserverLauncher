// js/08-shell.js — split from app.js (lines 1127-1704); classic script, load in numeric order.
// app shell: console logs, tabs/nav, all DOM wiring, wizard, boot.
function logLevel(line){if(line.type==='error')return'error';if(line.type==='command')return'command';if(line.type==='system')return'system';const t=line.text||'';if(/\]:\s*\[?WARN/i.test(t)||/\/WARN\]/i.test(t)||/^WARNING:/i.test(t.trim()))return'warn';if(/\/ERROR\]/i.test(t)||/\/SEVERE\]/i.test(t))return'error';return'info'}
let logFilter='all',logPaused=false,logQuery='',logAutoScroll=true;
let logQueue=[], logFlushScheduled=false;
// Level badge (CMD/INF/WRN/ERR) + two independent gates: the filter chips (level) and the search
// box (substring). A line is visible only if it passes BOTH. Kept as one predicate so re-filtering
// existing lines uses the exact same rule as new ones.
const LOG_BADGE={error:'ERR',warn:'WRN',command:'CMD',system:'SYS',info:'INF'};
function logVisible(level,text){
  if(logFilter!=='all'&&level!==logFilter) return false;
  if(logQuery && !String(text||'').toLowerCase().includes(logQuery)) return false;
  return true;
}
// Re-evaluate every line already in the DOM (used when the filter or the search changes).
function reapplyLogFilter(){
  const o=$('#logOutput'); if(!o) return;
  let anyVisible=false;
  for(const d of o.querySelectorAll('.log-line')){
    const vis=logVisible(d.dataset.level, d.dataset.text||'');
    d.hidden=!vis; if(vis) anyVisible=true;
  }
  const empty=$('#logEmpty'); if(empty) empty.hidden=anyVisible;
}
function flushLogs(){
  const o=$('#logOutput'); if(!o || !logQueue.length){ logFlushScheduled=false; return; }
  const wasAtBottom=o.scrollHeight - o.scrollTop - o.clientHeight < 40;
  // Sweep animation only when a few lines land at once (live play). A server startup flushes
  // hundreds of lines — sweeping them all would be a strobe. `sweep` gates the ::before keyframe.
  const sweep=logQueue.length<=3;
  const frag=document.createDocumentFragment();
  let added=0, lastVisible=null;
  const names=consolePlayerNames();
  while(logQueue.length && added<80){
    const line=logQueue.shift();
    const d=document.createElement('div'), level=logLevel(line);
    d.className=`log-line ${line.type||''}${sweep?' sweep':''}`; d.dataset.level=level;
    d.dataset.text=String(line.text||'').slice(0,2000); // search index (trimmed to keep the DOM lean)
    d.innerHTML=`<span class="lvl">${LOG_BADGE[level]||'INF'}</span><span class="time">${esc(line.time)}</span> ${linkifyKnownPlayers(line.text, names)}`;
    if(!logVisible(level,line.text)) d.hidden=true; else lastVisible=d;
    frag.appendChild(d); added++;
  }
  o.classList.add('has-content'); o.appendChild(frag);
  const empty=$('#logEmpty'); if(empty) empty.hidden=true;
  // If a search/filter is active, a freshly-added line may be hidden — keep the hint honest.
  if(logQuery||logFilter!=='all') updateLogHint();
  while(o.children.length>2000) o.removeChild(o.firstChild);
  if(wasAtBottom && !logPaused) o.scrollTop=o.scrollHeight;
  else if(lastVisible && !lastVisible.hidden){ const j=$('#logJump'); if(j) j.hidden=false; }
  if(logQueue.length) requestAnimationFrame(flushLogs); else logFlushScheduled=false;
}
// v6.0.0 H6: the set of player names a console line may link to. Online players (live) plus the
// server's known/whitelist/op players (files). Only these exact names become clickable links, so an
// ordinary word is never mistaken for a player.
function consolePlayerNames(){
  const set=new Set();
  try{ for(const p of (state.live?.players||[])){ const n=typeof p==='string'?p:(p&&p.name); if(isSafePlayerName(n)) set.add(n); } }catch{}
  try{ const f=state.files||{}; for(const k of ['knownPlayers','whitelist','ops']){ for(const p of (f[k]||[])){ const n=typeof p==='string'?p:(p&&p.name); if(isSafePlayerName(n)) set.add(n); } } }catch{}
  return [...set];
}
// One delegated click handler for every console player link. Resolves the UUID from known players
// (if any) and opens the existing inspector; a name with no stored UUID still opens it (offline).
$('#logOutput')?.addEventListener('click',e=>{
  const a=e.target.closest('.log-player'); if(!a) return;
  e.preventDefault();
  const name=a.dataset.player; if(!isSafePlayerName(name)) return;
  let uuid=null;
  try{ const known=state.files?.knownPlayers||[]; const hit=known.find(p=>(typeof p==='string'?p:p&&p.name)===name); if(hit&&typeof hit==='object') uuid=hit.uuid||null; }catch{}
  if(typeof openPlayerInspector==='function') openPlayerInspector(uuid,name);
});
function addLog(line){ logQueue.push(line); if(!logFlushScheduled){ logFlushScheduled=true; requestAnimationFrame(flushLogs); } }
function addLogsBatch(lines){ if(!lines||!lines.length) return; logQueue.push(...lines); if(!logFlushScheduled){ logFlushScheduled=true; requestAnimationFrame(flushLogs); } }
// B4: replace the whole console with another instance's buffer on switch. Unlike flushLogs
// (which appends), this clears first so no lines from the previous instance linger.
function repaintConsole(lines){
  const o=$('#logOutput'); if(!o) return;
  logQueue=[]; logFlushScheduled=false;
  o.innerHTML=''; o.classList.remove('has-content');
  const arr=Array.isArray(lines)?lines:[];
  if(!arr.length){ o.innerHTML=`<div class="log-empty" id="logEmpty"><b>${t('con.empty')}</b><span>${t('con.emptySub')}</span></div>`; return; }
  const frag=document.createDocumentFragment();
  const names=consolePlayerNames();
  for(const line of arr){
    const d=document.createElement('div'), level=logLevel(line);
    d.className=`log-line ${line.type||''}`; d.dataset.level=level;
    d.dataset.text=String(line.text||'').slice(0,2000);
    d.innerHTML=`<span class="lvl">${LOG_BADGE[level]||'INF'}</span><span class="time">${esc(line.time)}</span> ${linkifyKnownPlayers(line.text, names)}`;
    if(!logVisible(level,line.text)) d.hidden=true;
    frag.appendChild(d);
  }
  o.classList.add('has-content'); o.appendChild(frag);
  o.scrollTop=o.scrollHeight;
}
// B4: rebuild the chart ring from the active instance's sampled history after a switch.
function rebuildSamples(history,historyLong){
  const arr=(Array.isArray(history)?history:[]).slice(-38);
  samples=arr.map(s=>({tps:s.tps??null,mspt:s.mspt??null,cpu:s.cpu??null,ram:s.ram??null}));
  while(samples.length<38) samples.unshift({tps:null,mspt:null,cpu:null,ram:null});
  // v5.3.0: seed the coarse ring used by the 1h/6h ranges from the server's metricsLong snapshot.
  if(Array.isArray(historyLong)) samplesLong=historyLong.slice(-PERF_LONG_CAP).map(s=>({t:Number(s.t)||0,tps:s.tps??null,mspt:s.mspt??null,cpu:s.cpu??null,ram:s.ram??null}));
  computeChartSamples();
  try{ drawOvSpark(); }catch{}
  try{ metricChart($('#perfTickChart'),true,'tick'); metricChart($('#perfResourceChart'),true,'resource'); }catch{}
}
// v5.3.0: pick what metricChart draws for the active range. 15m uses the live 38-point ring
// (chartSamples aliases samples). 1h/6h slice samplesLong by age, then downsample to <=200 points so
// the canvas draw stays cheap and the line reads cleanly. Pure apart from reading the module vars.
const PERF_RANGE_MS={ '15m':15*60*1000, '1h':60*60*1000, '6h':6*60*60*1000, '24h':24*60*60*1000, '7d':7*24*60*60*1000, '30d':30*24*60*60*1000 };
// v6.0.0 D1: 7d/30d windows are served from disk (1m/1h rollups), fetched on demand and cached here.
let samplesVeryLong=[]; let _veryLongFor=null; // _veryLongFor = the range currently loaded
function computeChartSamples(){
  if(perfRange==='15m'){ chartSamples=samples; return; }
  const spanMs=PERF_RANGE_MS[perfRange]||PERF_RANGE_MS['15m'];
  const cutoff=Date.now()-spanMs;
  const src=(perfRange==='7d'||perfRange==='30d')?samplesVeryLong:samplesLong;
  let win=src.filter(s=>s&&s.t>=cutoff);
  if(!win.length&&src.length)win=[src[src.length-1]];
  const MAXP=200;
  if(win.length>MAXP){const step=win.length/MAXP,out=[];for(let i=0;i<MAXP;i++)out.push(win[Math.floor(i*step)]);if(out[out.length-1]!==win[win.length-1])out.push(win[win.length-1]);win=out;}
  chartSamples=win.length?win:[{tps:null,mspt:null,cpu:null,ram:null}];
}
async function setPerfRange(range){
  if(!PERF_RANGE_MS[range])range='15m';
  perfRange=range;
  $$('#perfRangeChips .filter-chip').forEach(b=>b.classList.toggle('active',b.dataset.range===range));
  // v6.0.0 D1: 7d/30d read the disk rollup for this instance (raw ring only holds 24h).
  if((range==='7d'||range==='30d')&&_veryLongFor!==range){
    try{const r=await window.observer.metricsLong(range);samplesVeryLong=(r&&r.ok&&Array.isArray(r.samples))?r.samples.map(s=>({t:Number(s.t)||0,tps:s.tps??null,mspt:s.mspt??null,cpu:s.cpu??null,ram:s.ram??null})):[];_veryLongFor=range;}catch{samplesVeryLong=[];_veryLongFor=range;}
  }
  computeChartSamples();
  try{ metricChart($('#perfTickChart'),true,'tick'); metricChart($('#perfResourceChart'),true,'resource'); }catch{}
}
const channelOrder=['overview','console','players','performance','content','marketplace','worlds','properties'];
function positionChannelIndicator(){const nav=$('#nav'),ind=$('#channelIndicator');if(!nav||!ind)return;const active=nav.querySelector('.nav-item.active');if(!active){ind.style.opacity='0';return} // rail is vertical — indicator is left border via CSS, no horizontal calc needed
  ind.style.opacity='0'; }
let lastTabIdx=0;
// UX (2.6.0): remember each tab's scroll position so returning to a tab lands where the user left
// it, instead of snapping back to the top. The scrolling container is `.workspace main`.
const _tabScroll={};
let _lastTab=null;
function switchTab(tab){
  const _main=document.querySelector('.workspace main');
  if(_main&&_lastTab&&_lastTab!==tab)_tabScroll[_lastTab]=_main.scrollTop;
  // RAM-1 (3.3.0): leaving the World Map releases its biome/colour caches (rebuilt lazily on reopen).
  if(_lastTab==='worldmap'&&tab!=='worldmap'&&typeof wmClearCaches==='function'){try{wmClearCaches()}catch{}}
  _lastTab=tab;
  $$('.nav-item').forEach(b=>{ const on=b.dataset.tab===tab; b.classList.toggle('active',on); b.setAttribute('aria-current', on?'page':'false'); });
  // Direction-aware slide: forward in rail order slides from the right.
  const order=[...channelOrder,'worldmap','settings'];
  const tabIdx=order.indexOf(tab), dir=tabIdx<0?0:Math.sign(tabIdx-lastTabIdx);
  if(tabIdx>=0)lastTabIdx=tabIdx;
  $$('.tab').forEach(s=>s.classList.toggle('active',s.id===tab));
  $('#pageTitle').textContent=t('nav.'+tab)||titles[tab];
  const ci=$('#channelIndex'),idx=channelOrder.indexOf(tab);if(ci)ci.textContent=idx>-1?`${String(idx+1).padStart(2,'0')} / ${String(channelOrder.length).padStart(2,'0')}`:'—';
  positionChannelIndicator();
  // a11y: focus the new tab panel for screen readers
  const panel=document.getElementById(tab); if(panel){ panel.setAttribute('tabindex','-1'); panel.focus({preventScroll:true});
    // Retriggerable enter animation (motion lives in css/08-motion.css).
    panel.classList.remove('tab-enter-fwd','tab-enter-back'); void panel.offsetWidth;
    panel.classList.add(dir<0?'tab-enter-back':'tab-enter-fwd');
    panel.onanimationend=e=>{if(e.target===panel)panel.classList.remove('tab-enter-fwd','tab-enter-back')};
  }
  if(tab==='marketplace'&&!$('#marketResults').innerHTML)$('#marketSearch').click();
  if(tab==='performance'){window.observer.getFiles().then(r=>{if(r.ok){state.files=r.files;state.javaRequired=r.javaRequired??state.javaRequired;renderPerfDiagnostics()}}); requestAnimationFrame(()=>{ requestAnimationFrame(()=>{ try{metricChart($('#perfTickChart'),true,'tick'); metricChart($('#perfResourceChart'),true,'resource');}catch{}})}); }
  // v5.7.0: Overview re-fetches files on entry so a jar dropped into plugins/mods by hand (Geyser,
  // Floodgate, a mod) surfaces without an app restart, and the Geyser/Bedrock card appears at once.
  // The sparkline was 0-sized while Overview was hidden — redraw on reveal (same class of bug as the
  // hidden world-map canvas). Two rAFs so layout has settled after the tab becomes visible.
  if(tab==='overview'){window.observer.getFiles().then(r=>{if(r.ok){state.files=r.files;state.javaRequired=r.javaRequired??state.javaRequired;refreshUI()}});requestAnimationFrame(()=>requestAnimationFrame(()=>{try{drawOvSpark()}catch{}}));}
  if(tab==='players')window.observer.getFiles().then(r=>{if(r.ok){state.files=r.files;state.javaRequired=r.javaRequired??state.javaRequired;renderPlayers()}});
  if(tab==='content'){window.observer.getFiles().then(r=>{if(r.ok){state.files=r.files;state.javaRequired=r.javaRequired??state.javaRequired;refreshUI()}});if(!state.contentUpdates&&typeof loadContentUpdates==='function')loadContentUpdates()}
  // World Map loads lazily HERE (single choke point) — 02-worldmap.js must not
  // hook switchTab itself: it evaluates before this file, so capturing
  // switchTab there throws and leaves the tab blank with dead Reload buttons.
  if(tab==='worldmap'&&typeof wmLoad==='function')wmLoad().catch(e=>toast(`World Map failed to load: ${e?.message||e}`,'error'));
  // Restore this tab's scroll position (rAF so the panel is laid out first). Console is exempt —
  // it manages its own auto-scroll/tail behavior and should always pin to the newest line.
  if(_main&&tab!=='console'){const y=_tabScroll[tab]||0;requestAnimationFrame(()=>{_main.scrollTop=y})}
}

// ===== v2.0.0 MULTI-INSTANCE RAIL =====
// Renders the instance list from state (settings:get returns instances[] + activeInstanceId).
// Items use .inst-item + data-instance (NOT .nav-item/data-tab), so switchTab and its keyboard
// nav are completely untouched. The block stays hidden until at least one instance exists, which
// keeps the first-run screen unchanged.
function instanceDotStatus(instId, activeId){
  // The active instance's status is the authoritative `state.status`; a background instance's
  // status comes from its last server:state event (tracked in state.instanceStatus).
  if(instId===activeId) return state.status||'stopped';
  return (state.instanceStatus&&state.instanceStatus[instId])||'stopped';
}
// UX FIX (2.5.0): refreshUI() runs on every tab switch / state event, and this used to rebuild the
// whole list (innerHTML='') each time -> the instReveal stagger animation replayed whenever the user
// opened the Content tab (etc). A signature guard skips the rebuild when the STRUCTURE is unchanged
// (same ids/names/active/locale) and only repaints the status dots in place, so the animation plays
// only on a real change (add / remove / rename / switch).
let lastInstSig='';
// v6.0.0 H5: signature guard for the Settings tunnel-overview list. Without it the list rebuilt on
// every refreshUI() and replayed the .tun-ov-row entry animation each time (memory gotcha 19).
let lastTunOvSig='';
function renderInstanceList(){
  const wrap=$('#instanceList'),host=$('#instanceItems');
  if(!wrap||!host)return;
  const list=Array.isArray(state.instances)?state.instances:[];
  wrap.hidden=list.length===0;
  if(list.length===0)return;
  const activeId=state.activeInstanceId||(list[0]&&list[0].id);
  // v6.0.0 E3: the group filter is a rail-scoped display toggle. `instGroupFilterValue` holds the
  // active chip's group ('' = All). Filtering only hides rows; bulk actions still touch every
  // instance on purpose, so a filtered view can never start a server the user cannot see.
  const groups=[...new Set(list.map(i=>i.group||''))].filter(Boolean).sort();
  if(instGroupFilterValue && !groups.includes(instGroupFilterValue)) instGroupFilterValue='';
  const sig=JSON.stringify([currentLocale,activeId,instGroupFilterValue,list.map(i=>[i.id,i.name||i.serverPath||'',i.accent||'',i.artSeed||0,!!i.missing,i.group||''])]);
  if(sig===lastInstSig){
    // Same list/active/names -> just refresh the dots (status can change without a rebuild).
    host.querySelectorAll('.inst-item').forEach(row=>{
      const d=row.querySelector('.inst-dot');
      if(d)d.className='inst-dot st-'+instanceDotStatus(row.dataset.instance,activeId);
    });
    renderInstanceDropdown(list, activeId);
    return;
  }
  lastInstSig=sig;
  host.innerHTML='';
  list.forEach((inst,idx)=>{
    const isActive=inst.id===activeId;
    const st=instanceDotStatus(inst.id,activeId);
    const inGroup=!instGroupFilterValue || (inst.group||'')===instGroupFilterValue;
    // A div (not a button) so the rename/remove icon buttons can live INSIDE it without nesting
    // <button> elements (invalid HTML). Click anywhere on the row switches; the icons stopPropagation.
    // 5.4.0: a missing folder (deleted, or a drive that is not mounted) greys the row, shows a
    // relink button, and the dot reads as stopped. We never auto-remove the instance.
    const isMissing=!!inst.missing;
    const row=document.createElement('div');
    row.className='inst-item'+(isActive?' active':'')+(isMissing?' missing':'');
    row.dataset.instance=inst.id;
    row.setAttribute('role','listitem');
    row.tabIndex=0;
    row.title=isMissing?t('inst.missingTip'):t('inst.switchTip');
    // Stagger reveal: same cadence as tab-content rows (--stagger per index, capped so a long
    // list never waits). Re-runs on every render, so add/remove/switch animates.
    row.style.animationDelay=(idx*28)+'ms';
    const groupBadge=inst.group?'<span class="inst-group-badge">'+esc(inst.group)+'</span>':'';
    row.innerHTML=instAvatarHtml(inst.name||inst.serverPath||'Server',inst.artSeed,inst.accent,isMissing?'stopped':st)
      +'<span class="inst-name">'+esc(inst.name||inst.serverPath||'Server')+groupBadge+(isMissing?' <i class="inst-missing-tag">'+esc(t('inst.missing'))+'</i>':'')+'</span>'
      +'<span class="inst-acts">'
        +'<button type="button" class="inst-act" data-act="group" title="'+esc(t('inst.groupSet'))+'" aria-label="'+esc(t('inst.groupSet'))+'">⊞</button>'
        +(isMissing?'<button type="button" class="inst-act" data-act="relink" title="'+esc(t('inst.relink'))+'" aria-label="'+esc(t('inst.relink'))+'">↻</button>':'')
        +'<button type="button" class="inst-act" data-act="rename" title="'+esc(t('inst.rename'))+'" aria-label="'+esc(t('inst.rename'))+'">✎</button>'
        +'<button type="button" class="inst-act" data-act="remove" title="'+esc(t('inst.remove'))+'" aria-label="'+esc(t('inst.remove'))+'">✕</button>'
      +'</span>';
    // v6.0.0 E3: hide a row that is not in the active group chip. Display-only; the underlying
    // bulk actions and instance list stay complete (never silently act on a filtered subset).
    if(!inGroup) row.hidden=true;
    row.onclick=e=>{ if(e.target.closest('.inst-act'))return; switchInstance(inst.id); };
    row.onkeydown=e=>{ if((e.key==='Enter'||e.key===' ')&&!e.target.closest('.inst-act')){e.preventDefault();switchInstance(inst.id);} };
    row.querySelector('[data-act="relink"]')?.addEventListener('click',e=>{e.stopPropagation();relinkInstancePrompt(inst)});
    row.querySelector('[data-act="group"]').onclick=e=>{e.stopPropagation();setInstanceGroupPrompt(inst)};
    row.querySelector('[data-act="rename"]').onclick=e=>{e.stopPropagation();renameInstancePrompt(inst)};
    row.querySelector('[data-act="remove"]').onclick=e=>{e.stopPropagation();removeInstancePrompt(inst)};
    host.appendChild(row);
  });
  // v6.0.0 E2: show the bulk bar only when 2+ instances exist (one instance has nothing to bulk).
  const bulk=$('#instBulk');
  if(bulk) bulk.hidden = list.length < 2;
  renderInstanceGroupFilter(groups);
  renderInstanceDropdown(list, activeId);
}
// v6.0.0 E3: rail group filter. A row of chips under the instance list when 2+ distinct groups
// exist. Value '' means All. Filtering only hides rows: the tooltip says bulk actions still apply
// to every server, so a narrow view can never start a server the user cannot see.
let instGroupFilterValue='';
function renderInstanceGroupFilter(groups){
  const host=$('#instGroupFilter'); if(!host)return;
  if(!Array.isArray(groups)||groups.length<2){host.hidden=true;host.innerHTML='';return}
  host.hidden=false;
  const chips=[{v:'',label:t('inst.groupAll')},...groups.map(g=>({v:g,label:g}))];
  host.innerHTML=chips.map(c=>'<button type="button" class="filter-chip'+(instGroupFilterValue===c.v?' active':'')+'" data-group="'+esc(c.v)+'" title="'+esc(t('inst.groupBulkNote'))+'">'+esc(c.label)+'</button>').join('');
  host.querySelectorAll('[data-group]').forEach(b=>b.onclick=()=>{instGroupFilterValue=b.dataset.group;renderInstanceList()});
}
async function setInstanceGroupPrompt(inst){
  const current=inst.group||'';
  const next=await promptDialog({title:t('inst.groupPrompt'),value:current,ok:t('cf.ok')});
  if(next===null)return;
  let r; try{ r=await window.observer.instancesSetGroup({id:inst.id,group:String(next)}); }catch(e){ return toast(e?.message||'Set group failed.','error'); }
  if(!r||!r.ok)return toast((r&&r.error)||'Set group failed.','error');
  const updated=(state.instances||[]).map(i=>i.id===inst.id?{...i,group:r.group}:i);
  state={...state,instances:updated};refreshUI();
}
// 4.5.0 instance appearance: render the accent swatches + avatar-art preview for the ACTIVE instance
// into the Settings 'Instance appearance' section. accent/artSeed live in the nested instances[]
// (state.instances), NOT in the flat settings view, so we read them from state here. Writes go
// through the instances:style IPC (validated main-side) and update state optimistically.
function activeInstanceMeta(){
  const list=Array.isArray(state.instances)?state.instances:[];
  const id=state.activeInstanceId||(list[0]&&list[0].id);
  return list.find(i=>i.id===id)||null;
}
function renderInstanceAppearance(){
  const host=$('#instAccentRow'),preview=$('#instAccentPreview');
  if(!host||!preview)return;
  const inst=activeInstanceMeta();
  const accent=(inst&&inst.accent)||'';
  const seed=(inst&&inst.artSeed)||0;
  host.innerHTML=INST_ACCENT_KEYS.map(k=>{
    const on=k===accent?' active':'';
    return '<button type="button" class="accent-swatch'+on+'" role="radio" aria-checked="'+(k===accent)+'" data-accent="'+k+'" title="'+esc(k||'brand')+'" style="--sw:'+instAccentCss(k)+'"></button>';
  }).join('');
  host.querySelectorAll('[data-accent]').forEach(b=>b.onclick=()=>setInstanceAppearance({accent:b.dataset.accent}));
  preview.innerHTML=instAvatarHtml(inst?inst.name:'',seed,accent,'stopped');
}
// Persist an appearance change for the active instance, then repaint the section + rail (avatar).
async function setInstanceAppearance(patch){
  const inst=activeInstanceMeta();
  if(!inst)return;
  let r;try{ r=await window.observer.instanceStyle({id:inst.id,...patch}); }catch(e){ return toast(e?.message||t('err.saveAppearance'),'error'); }
  if(!r||!r.ok)return toast((r&&r.error)||t('err.saveAppearance'),'error');
  const next=(state.instances||[]).map(i=>i.id===inst.id?{...i,accent:r.accent,artSeed:r.artSeed}:i);
  state={...state,instances:next};
  renderInstanceAppearance();
}
// Compact instance switcher for narrow screens (rail hidden <1100px). Same state as the rail list:
// shows the active instance + a menu to switch. Hidden when there is 0-1 instance.
function renderInstanceDropdown(list, activeId){
  const dd=$('#instDropdown'),btn=$('#instDdBtn'),menu=$('#instDdMenu'),nameEl=$('#instDdName'),dot=$('#instDdDot');
  if(!dd||!btn||!menu)return;
  const multi=(list||[]).length>1;
  dd.hidden=!multi;                 // CSS @media decides actual visibility; hidden avoids stale UI
  if(!multi){menu.hidden=true;btn.setAttribute('aria-expanded','false');return}
  const active=(list||[]).find(i=>i.id===activeId)||list[0];
  nameEl.textContent=active.name||active.serverPath||'Server';
  dot.className='inst-dot st-'+instanceDotStatus(active.id,activeId);
  menu.innerHTML='';
  list.forEach(inst=>{
    const isActive=inst.id===activeId;
    const st=instanceDotStatus(inst.id,activeId);
    const b=document.createElement('button');
    b.type='button';
    b.className='inst-item'+(isActive?' active':'');
    b.setAttribute('role','option');
    b.setAttribute('aria-selected',isActive?'true':'false');
    b.dataset.instance=inst.id;
    b.innerHTML=instAvatarHtml(inst.name||inst.serverPath||'Server',inst.artSeed,inst.accent,st)+'<span class="inst-name">'+esc(inst.name||inst.serverPath||'Server')+'</span>';
    b.onclick=()=>{ closeInstDd(); switchInstance(inst.id); };
    menu.appendChild(b);
  });
}
function closeInstDd(){
  const dd=$('#instDropdown'),btn=$('#instDdBtn'),menu=$('#instDdMenu');
  if(menu)menu.hidden=true;
  if(btn)btn.setAttribute('aria-expanded','false');
  if(dd)dd.classList.remove('open');
}
// Q2: Tunnel overview — one row per instance showing its public Playit address + status.
// Pure renderer: reads state.instances (enriched by listInstances with tunnelAddress/autoTunnel)
// and state.instanceStatus for the dots. Stays hidden with a single instance, so the one-server
// screen is untouched. "Open dashboard" reuses the existing tunnelOpenUrl IPC (no new channel).
function renderTunnelOverview(){
  const sec=$('#tunnelOverviewSection'),host=$('#tunnelOverview');
  if(!sec||!host)return;
  const list=Array.isArray(state.instances)?state.instances:[];
  sec.hidden=list.length<2;            // single instance -> the Overview tunnel panel already covers it
  if(list.length<2)return;
  const activeId=state.activeInstanceId||(list[0]&&list[0].id);
  // Rebuild only when the list/active/addresses change, so the entry animation runs on a real change,
  // not on every status tick (v6.0.0 H5).
  const sig=JSON.stringify([currentLocale,activeId,list.map(i=>[i.id,i.name||i.serverPath||'',i.tunnelAddress||''])]);
  if(sig===lastTunOvSig)return;
  lastTunOvSig=sig;
  host.innerHTML='';
  list.forEach(inst=>{
    const st=instanceDotStatus(inst.id,activeId);
    const addr=(inst.tunnelAddress||'').trim();
    const row=document.createElement('div');
    row.className='tun-ov-row'+(inst.id===activeId?' active':'');
    const addrHtml=addr
      ? '<span class="tun-ov-addr">'+esc(addr)+'</span>'
      : '<span class="tun-ov-addr missing">'+esc(t('tun.ovMissing'))+'</span>';
    row.innerHTML='<span class="inst-dot st-'+st+'"></span>'
      +'<span class="tun-ov-name">'+esc(inst.name||inst.serverPath||'Server')+'</span>'
      +addrHtml
      +'<button type="button" class="btn secondary sm tun-ov-open" data-i18n="tun.ovOpen">'+esc(t('tun.ovOpen'))+'</button>';
    row.querySelector('.tun-ov-open').onclick=()=>window.observer.tunnelOpenUrl('https://playit.gg/account/tunnels');
    host.appendChild(row);
  });
}
$('#instDdBtn')?.addEventListener('click',e=>{
  e.stopPropagation();
  const menu=$('#instDdMenu'),btn=$('#instDdBtn');
  if(!menu||!btn)return;
  const willOpen=menu.hidden;
  menu.hidden=!willOpen;
  btn.setAttribute('aria-expanded',willOpen?'true':'false');
  $('#instDropdown')?.classList.toggle('open',willOpen);
});
// Dismiss the dropdown on outside click / Escape.
document.addEventListener('click',e=>{ if(!e.target.closest('#instDropdown'))closeInstDd(); });
document.addEventListener('keydown',e=>{ if(e.key==='Escape')closeInstDd(); });
// Rename an instance (display name only; the id and folder never change).
async function renameInstancePrompt(inst){
  const current=inst.name||'';
  // BUGFIX: window.prompt() is unsupported in Electron's sandboxed renderer; use the in-app
  // promptDialog (Promise<string|null>) instead.
  const name=await promptDialog({title:t('inst.rename'),value:current,ok:t('cf.ok')});
  if(name===null)return;
  const trimmed=String(name).trim();
  if(!trimmed||trimmed===current)return;
  let r; try{ r=await window.observer.instanceRename({id:inst.id,name:trimmed}); }catch(e){ return toast(e?.message||'Rename failed.','error'); }
  if(!r||!r.ok)return toast((r&&r.error)||'Rename failed.','error');
  const next=(state.instances||[]).map(i=>i.id===inst.id?{...i,name:r.name}:i);
  state={...state,instances:next};refreshUI();
}
// Remove an instance. v6.0.0 H3: a second dialog lets the user also delete the server FILES (default
// keeps them). Refuses while the server is running. The backend re-guards every deletion.
async function removeInstancePrompt(inst){
  if(inst.id===state.activeInstanceId && state.status!=='stopped')return toast(t('inst.stopFirst'),'error');
  const name=inst.name||inst.serverPath||'Server';
  const ok=await confirmDialog({title:t('inst.remove'),body:esc(t('inst.removeConfirm',{n:name})),ok:t('inst.remove'),danger:true});
  if(!ok)return;
  // v6.0.0 H3: second, explicit choice about the FILES. Default (Cancel) keeps them, so a hasty
  // second Enter never deletes a world. Deleting files is permanent and states it plainly.
  const delFiles=await confirmDialog({title:t('inst.removeFilesTitle'),body:esc(t('inst.removeFilesBody',{n:name,p:inst.serverPath||''})),ok:t('inst.deleteFiles'),cancel:t('inst.keepFiles'),danger:true});
  let r; try{ r=await window.observer.instanceRemove(inst.id,{deleteFiles:delFiles}); }catch(e){ return toast(e?.message||'Remove failed.','error'); }
  if(!r||!r.ok)return toast((r&&r.error)||'Remove failed.','error');
  try{ const s=await window.observer.getState(); state={...state,...s}; }catch{}
  refreshUI();
  // UX (2.6.0): offer a one-click undo — re-adds the same folder as an instance. Never touches the
  // folder on disk either way, so this is purely a list-level convenience.
  const _path=inst.serverPath||'';
  if(_path) toast(t('inst.removed',{n:inst.name||_path}),undefined,{label:t('toast.undo'),fn:async()=>{ try{ const a=await window.observer.instanceAdd({serverPath:_path}); if(a&&a.ok){ const s2=await window.observer.getState(); state={...state,...s2}; refreshUI(); toast(t('inst.added'),'success'); } }catch{} }});
}
// Switch the active instance: the backend re-seeds ctx and repoints the runtime folder, then we
// Re-pull the full snapshot and repaint the console + chart for the ACTIVE instance. server:metrics
// / server:log are gated in the main process, so without this a background instance's old lines
// would stay on screen. Shared by switchInstance + addExistingInstance (gotcha #20).
async function refreshFromState(){
  try{ const s=await window.observer.getState(); state={...state,...s}; }catch{}
  resetInstanceViews();
  repaintConsole(state.logs);
  rebuildSamples(state.metricsHistory,state.metricsLong);
  refreshUI();
}
// F1 (3.2.5): per-instance views must be dropped when the active instance changes, or they keep
// showing the PREVIOUS instance's data - the editor held an open file whose Save would then write
// into the NEW instance's folder (data corruption), and the properties panel kept the old server's
// config. Close the editor back to the bays, forget its file state, and force a properties reload.
function resetInstanceViews(){
  try{
    if(typeof edState!=='undefined' && edState){
      // Always return to the bays and drop any open file / browsed tree (a stale tree points at the
      // previous instance's folder). edState.files is repopulated lazily by openFileBrowser().
      if(typeof edShow==='function') edShow('bays');
      edState={...edState,rel:null,content:'',mtime:0,dirty:false,conflict:false,files:[],fbOpen:new Set()};
    }
    if(typeof propsDirty!=='undefined'){ propsDirty=false; try{ if(typeof updatePropsDirty==='function')updatePropsDirty() }catch{} } // refreshUI reloads properties for the new instance
    // If the World Map is the ACTIVE tab, reload it for the new instance (switchTab only reloads on
    // entry, so staying on the tab would otherwise keep the previous world's seed/biomes).
    const wmTab=document.getElementById('worldmap');
    if(wmTab&&wmTab.classList.contains('active')&&typeof wmLoad==='function') wmLoad().catch(()=>{});
    // v6.0.0 D1: drop the cached 7d/30d disk history so the next range pick re-fetches for the NEW
    // instance instead of showing the previous instance's long window.
    try{ samplesVeryLong=[]; _veryLongFor=null; }catch{}
  }catch{}
}

// re-pull the whole snapshot so console/metrics/files/settings all reflect the new instance.
async function switchInstance(id){
  if(!id||id===state.activeInstanceId)return;
  let r;
  try{ r=await window.observer.instanceSwitch(id); }
  catch(e){ return toast(e?.message||t('err.switchInstance'),'error'); }
  if(!r||!r.ok)return toast((r&&r.error)||t('err.switchInstance'),'error');
  await refreshFromState();
}
// v2.0.0 Phase B: add an EXISTING server folder as a new instance, without the wizard. For users
// who already have a server on disk and just want to manage it here. Creates a new instance, makes
// it active, and pulls the snapshot (no download, no overwrite of another instance's settings).
async function addExistingInstance(folder){
  if(!folder){
    try{ folder=await window.observer.pickFolder({title:t('inst.pickExisting')}); }catch(e){ return toast(e?.message||'Could not open the folder picker.','error'); }
  }
  if(!folder)return null;
  let add;
  try{ add=await window.observer.instanceAdd({serverPath:folder}); }
  catch(e){ toast(e?.message||'Could not add the folder.','error'); return null; }
  if(!add||!add.ok){ toast((add&&add.error)||'Could not add the folder.','error'); return null; }
  let sw; try{ sw=await window.observer.instanceSwitch(add.id); }catch(e){ toast(e?.message||'Could not switch to the new instance.','error'); return null; }
  if(!sw||!sw.ok){ toast((sw&&sw.error)||'Could not switch to the new instance.','error'); return null; }
  await refreshFromState();
  toast(t('inst.added'),'success');
  return add.id;
}
// 5.4.0: one entry point for adding a server. A single choice modal replaces the two rail buttons,
// which were easy to mix up ("+ Add instance" vs "Add existing folder").
function openAddServerModal(){
  const m=$('#addServerModal');if(!m)return;
  m.hidden=false;void m.offsetWidth;m.classList.add('show');
  trapFocus(m);
  setTimeout(()=>$('#asNew')?.focus(),20);
}
function closeAddServerModal(){
  const m=$('#addServerModal');if(!m||m.hidden)return;
  m.classList.remove('show');m.hidden=true;
  releaseFocus();
}
// 5.4.0: relink an instance whose folder went missing to a new folder. Reuses the instances:relink
// IPC; the backend refuses a folder already owned by another instance.
async function relinkInstancePrompt(inst){
  let folder;
  try{ folder=await window.observer.pickFolder({title:t('inst.pickExisting')}); }catch(e){ return toast(e?.message||'Could not open the folder picker.','error'); }
  if(!folder)return;
  let r;
  try{ r=await window.observer.instanceRelink({id:inst.id,serverPath:folder}); }catch(e){ return toast(e?.message||'Could not relink the folder.','error'); }
  if(!r||!r.ok)return toast((r&&r.error)||'Could not relink the folder.','error');
  await refreshFromState();
  toast(t('inst.relinked'),'success');
}
async function command(c){if(!c.trim())return;if(/[\r\n]/.test(c))return toast(t('toast.cmdInvalid'));const r=await window.observer.command(c);if(!r.ok)toast(r.error)}
let cmdHistory=[],cmdHistoryIdx=-1;
function pushCmdHistory(c){c=c.trim();if(!c)return;cmdHistory=cmdHistory.filter(x=>x!==c);cmdHistory.unshift(c);if(cmdHistory.length>8)cmdHistory.length=8;cmdHistoryIdx=-1;renderRecentCommands()}
function renderRecentCommands(){const wrap=$('#recentCommands'),group=$('#recentCommandsGroup');if(!wrap||!group)return;if(!cmdHistory.length){group.hidden=true;return}group.hidden=false;wrap.innerHTML='';cmdHistory.forEach(c=>{const b=document.createElement('button');b.textContent=c;b.title=c;b.onclick=()=>command(c);wrap.append(b)})}
async function chooseFolder(opts){const f=await window.observer.pickFolder(opts);if(f){const next={...getSettings(),serverPath:f};const r=await window.observer.saveSettings(next);if(!r.ok){toast(friendlyError(r.error),'error');return null}state={...state,settings:next,java:r.java,files:r.files,eulaAccepted:r.eulaAccepted,javaRequired:r.javaRequired??state.javaRequired,mcp:r.mcp??state.mcp,remote:r.remote??state.remote};propsDirty=false;try{if(typeof updatePropsDirty==='function')updatePropsDirty()}catch{};markSettingsSaved();refreshUI();loadConnectInfo();toast(t('toast.folderSaved'))}return f}
$$('.nav-item').forEach(b=>b.onclick=()=>switchTab(b.dataset.tab));
$('#nav')?.addEventListener('keydown', e=>{
  const items=[...$$('.nav-item')]; const idx=items.indexOf(document.activeElement);
  if(e.key==='ArrowDown' || e.key==='ArrowRight'){ e.preventDefault(); items[(idx+1)%items.length]?.focus(); }
  else if(e.key==='ArrowUp' || e.key==='ArrowLeft'){ e.preventDefault(); items[(idx-1+items.length)%items.length]?.focus(); }
  else if(e.key==='Home'){ e.preventDefault(); items[0]?.focus(); }
  else if(e.key==='End'){ e.preventDefault(); items[items.length-1]?.focus(); }
});
$$('[data-tab-jump]').forEach(b=>b.onclick=()=>switchTab(b.dataset.tabJump));$$('[data-market-jump]').forEach(b=>b.onclick=()=>jumpToMarket(b.dataset.marketJump));$$('[data-command]').forEach(b=>b.onclick=()=>{pushCmdHistory(b.dataset.command);command(b.dataset.command)});$$('[data-open]').forEach(b=>b.onclick=()=>window.observer.openFiles(b.dataset.open));$$('[data-import]').forEach(b=>b.onclick=async()=>{const r=await window.observer.importContent(b.dataset.import);if(r.ok){state.files=r.files;refreshUI();toast(t('toast.importedRestart'))}else if(!r.cancelled)toast(r.error)});
$('#chooseFolder').onclick=chooseFolder;$('#browseBtn').onclick=chooseFolder;$('#addServerBtn')?.addEventListener('click',openAddServerModal);$('#asNew')?.addEventListener('click',()=>{closeAddServerModal();openNewServerWizard()});$('#asExisting')?.addEventListener('click',()=>{closeAddServerModal();addExistingInstance()});$('#asCancel')?.addEventListener('click',closeAddServerModal);$('#addServerModal')?.addEventListener('click',e=>{if(e.target.id==='addServerModal')closeAddServerModal()});$('#welcomeCreateBtn')?.addEventListener('click',()=>openNewServerWizard());$('#exportConsole').onclick=async()=>{const btn=$('#exportConsole');const orig=btn.textContent;btn.disabled=true;try{const r=await window.observer.exportConsole();if(r.cancelled)return;if(!r.ok)return toast(r.error,'error');toast(t('con.exported',{n:r.count}),'success')}catch(e){toast(e?.message||t('con.exportFailed'),'error')}finally{btn.disabled=false;btn.textContent=orig}};$('#clearConsole').onclick=()=>{const o=$('#logOutput');o.innerHTML=`<div class="log-empty" id="logEmpty"><b>${t('con.empty')}</b><span>${t('con.emptySub')}</span></div>`;o.classList.remove('has-content');const j=$('#logJump');if(j)j.hidden=true;const s=$('#logSearch');if(s){s.value='';const sc=$('#logSearchClear');if(sc)sc.hidden=true}logQuery='';updateLogHint()};$('#commandForm').onsubmit=async e=>{e.preventDefault();const v=$('#commandInput').value;pushCmdHistory(v);await command(v);$('#commandInput').value=''};
function updateLogHint(){
  const countVisible=$$('#logOutput .log-line:not([hidden])').length;
  const hint=$('.log-hint');
  if(hint) hint.textContent = (logQuery||logFilter!=='all') ? t('con.matches',{n:countVisible}) : t('con.tip');
}
$$('.log-filters .filter-chip').forEach(chip=>chip.onclick=()=>{
  logFilter=chip.dataset.logFilter;
  $$('.log-filters .filter-chip').forEach(c=>{ const on=c===chip; c.classList.toggle('active',on); c.setAttribute('aria-pressed', on?'true':'false'); });
  reapplyLogFilter(); updateLogHint();
});
// Search box: client-side substring filter over every rendered line (data-text index). Debounced
// so typing never thrashes the DOM. The clear × appears only when there is text.
const logSearch=$('#logSearch'), logSearchClear=$('#logSearchClear');
if(logSearch){
  const onSearch=debounce(()=>{
    logQuery=logSearch.value.trim().toLowerCase();
    if(logSearchClear) logSearchClear.hidden=!logSearch.value;
    reapplyLogFilter(); updateLogHint();
  },140);
  logSearch.addEventListener('input',onSearch);
  logSearchClear?.addEventListener('click',()=>{ logSearch.value=''; logQuery=''; logSearchClear.hidden=true; reapplyLogFilter(); updateLogHint(); logSearch.focus(); });
}
// Auto-scroll toggle: ON pins to the newest line; OFF lets the user read history without being
// yanked down. Scrolling away by hand turns it off automatically (that is what 'off' means).
const logAutoBtn=$('#logAutoscroll');
function setAutoScroll(on){ logAutoScroll=on; logPaused=!on; if(logAutoBtn){ logAutoBtn.classList.toggle('active',on); logAutoBtn.setAttribute('aria-pressed',on?'true':'false'); } if(on){ const o=$('#logOutput'); if(o) o.scrollTop=o.scrollHeight; const j=$('#logJump'); if(j) j.hidden=true; } }
logAutoBtn?.addEventListener('click',()=>setAutoScroll(!logAutoScroll));
document.addEventListener('keydown', e=>{
  const isConsole=document.getElementById('console')?.classList.contains('active');
  if(!isConsole) return;
  if((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='l'){ e.preventDefault(); $('#clearConsole')?.click(); }
  if(e.key==='/' && !e.ctrlKey && document.activeElement?.tagName!=='INPUT' && document.activeElement?.tagName!=='TEXTAREA'){ e.preventDefault(); $('#commandInput')?.focus(); }
});
const logOutputEl=$('#logOutput');if(logOutputEl)logOutputEl.addEventListener('scroll',()=>{const atBottom=logOutputEl.scrollHeight-logOutputEl.scrollTop-logOutputEl.clientHeight<40;logPaused=!atBottom;if(atBottom){const j=$('#logJump');if(j)j.hidden=true}/* scrolled away by hand -> reflect it on the auto-scroll toggle */if(!atBottom&&logAutoScroll){logAutoScroll=false;const b=$('#logAutoscroll');if(b){b.classList.remove('active');b.setAttribute('aria-pressed','false')}}});
const logJumpEl=$('#logJump');if(logJumpEl)logJumpEl.onclick=()=>{logOutputEl.scrollTop=logOutputEl.scrollHeight;logJumpEl.hidden=true;logPaused=false};
const cmdInputEl=$('#commandInput');if(cmdInputEl)cmdInputEl.addEventListener('keydown',e=>{if(e.key==='ArrowUp'){if(!cmdHistory.length)return;e.preventDefault();cmdHistoryIdx=Math.min(cmdHistory.length-1,cmdHistoryIdx+1);cmdInputEl.value=cmdHistory[cmdHistoryIdx]||''}else if(e.key==='ArrowDown'){e.preventDefault();cmdHistoryIdx=Math.max(-1,cmdHistoryIdx-1);cmdInputEl.value=cmdHistoryIdx===-1?'':cmdHistory[cmdHistoryIdx]}});
$('#saveSettings').onclick=()=>withBusy($('#saveSettings'),async()=>{
  const next=getSettings();
  const folderInput=$('#serverFolderInput'), javaInput=$('#javaPathInput');
  if(folderInput) folderInput.style.borderColor='';
  if(javaInput) javaInput.style.borderColor='';
  // v5.3.1: only REFUSE when the user is CLEARING a folder that was set (a destructive change —
  // the folder roots every file op). When there was never a folder (fresh install), preference
  // settings like language/motion must still save, so fall through. The backend already skips its
  // serverPath check when the value is empty, so this stays consistent.
  if(!next.serverPath && state.settings.serverPath){ if(folderInput){ folderInput.style.borderColor='var(--danger)'; folderInput.focus(); } return toast(t('set.errFolderReq'),'error'); }
  if(next.memoryMax < next.memoryMin) return toast(t('set.errMemOrder'),'error');
  if(next.memoryMax>32) return toast(t('set.errMemHigh'),'error');
  if(next.memoryMin<1) return toast(t('set.errMemMin'),'error');
  if(next.jvmArgs && next.jvmArgs.length>2000) return toast(t('set.errJvmLong'),'error');
  if(next.jvmArgs && /["'<>|]/.test(next.jvmArgs)) return toast(t('set.errJvmChars'),'error');
  if(state.java?.arch==='32-bit' && next.memoryMax>2) return toast(t('set.errJava32'),'error');
  const r=await window.observer.saveSettings(next);
  if(!r.ok) return toast(friendlyError(r.error),'error');
  if(!r.java?.ok && next.javaPath){ if(javaInput){ javaInput.style.borderColor='var(--danger)'; javaInput.focus(); } return toast(`Java not found at "${next.javaPath}" — ${r.java?.message||'check the path or use auto-install.'}`,'error'); }
  state={...state,settings:next,java:r.java,files:r.files,eulaAccepted:r.eulaAccepted,javaRequired:r.javaRequired??state.javaRequired,mcp:r.mcp??state.mcp,remote:r.remote??state.remote};propsDirty=false;try{if(typeof updatePropsDirty==='function')updatePropsDirty()}catch{};markSettingsSaved();refreshUI();
  if(r.mcp&&r.mcp.running)toast(t('mcp.running',{p:r.mcp.port}),'success');
  toast(r.java?.ok?t('toast.settingsSavedJava',{v:r.java.version}):t('toast.settingsSavedNoJava'),'success');
});
// v6.0.0 G1: RAM presets. A click sets min=max=preset and marks the buttons active; the user still
// presses Apply (we do not auto-save). A preset above the system RAM is disabled (cannot allocate it).
$('#ramPresets')?.addEventListener('click',e=>{
  const b=e.target.closest('[data-ram]'); if(!b) return;
  const gb=Number(b.dataset.ram);
  if(!Number.isFinite(gb)||gb<1) return;
  if($('#memoryMinInput'))$('#memoryMinInput').value=gb;
  if($('#memoryMaxInput'))$('#memoryMaxInput').value=gb;
  $$('#ramPresets .ram-preset').forEach(x=>x.classList.toggle('active',Number(x.dataset.ram)===gb));
});
// v6.0.0 F1: send a webhook test. Save the current settings first so the URL/events being tested are
// the ones in the form, then call the test IPC.
$('#webhookTestBtn')?.addEventListener('click',()=>withBusy($('#webhookTestBtn'),async()=>{
  const next=getSettings();
  if(!next.webhookUrl)return toast(t('wh.noUrl'),'error');
  const saved=await window.observer.saveSettings(next);
  if(!saved||!saved.ok)return toast((saved&&saved.error)||t('wh.saveFail'),'error');
  state={...state,settings:next,java:saved.java};markSettingsSaved();refreshUI();
  const r=await window.observer.webhookTest();
  if(!r||!r.ok)return toast((r&&r.error)||t('wh.testFail'),'error');
  toast(t('wh.testOk'),'success');
}));
$('#saveRamOverview').onclick=()=>withBusy($('#saveRamOverview'),async()=>{
  const next=getSettings();
  if(next.memoryMax<next.memoryMin)return toast(t('set.errMemOrder'),'error');
  const r=await window.observer.saveSettings(next);state={...state,settings:next,java:r.java,files:r.files,eulaAccepted:r.eulaAccepted,javaRequired:r.javaRequired??state.javaRequired};markSettingsSaved();refreshUI();toast(t('toast.ramSaved'),'success');
});
// v5.3.1: the language dropdown now follows the SAME edit->Apply flow as the other settings.
// It used to live-apply on change, which was inconsistent (motion level + beginner mode need Apply).
// #languageSelect sits inside #settings, so the generic onEdit handler marks the form dirty; Apply
// persists it and refreshUI() -> applyLocale() repaints. The onboarding dropdown (#obLangSelect)
// stays live-apply: choosing a language during first-run setup is a different moment.
// Performance tab: offline banner CTA reuses the main Start button so there is
// exactly one start path (same guards, same toasts, no duplicated logic).
$('#perfStartBtn')?.addEventListener('click',()=>$('#startBtn')?.click());
// v5.3.0: Performance chart time-range chips (15m / 1h / 6h). setPerfRange re-derives chartSamples
// from the right ring and repaints both charts.
$('#perfRangeChips')?.addEventListener('click',e=>{const b=e.target.closest('.filter-chip');if(b&&b.dataset.range)setPerfRange(b.dataset.range)});
// v4.0.0 Overview hero: reuse the single Start path; Open console jumps to the console tab.
$('#heroStartBtn')?.addEventListener('click',()=>$('#startBtn')?.click());
$('#heroConsoleBtn')?.addEventListener('click',()=>switchTab('console'));
// Properties tab (search/filter/save) moved to 10-properties.js.
$('#createBackup').onclick=()=>withBusy($('#createBackup'),async()=>{if(!await confirmDialog({title:t('wld.backupsT'),body:t('toast.confirmBackup'),ok:t('wld.create')}))return;const r=await window.observer.createBackup();if(r.ok){state.files=r.files;refreshUI();toast(`Backup created: ${r.name}`)}else toast(r.error)});
// Marketplace state moved to 11-market.js.
function debounce(fn,ms){let t;return (...a)=>{clearTimeout(t);t=setTimeout(()=>fn(...a),ms)}}
// Marketplace search/paging UI moved to 11-market.js.
window.observer.onBuildDone(v=>{state.files=v.files;refreshUI();toast(v.ok?'Build finished — server jar is ready. Configure settings, then start.':'Build failed — check the Console tab for the error.')});
function manualPlayer(){const name=$('#playerActionName').value.trim();const bad=playerNameError(name);if(bad){toast(bad);return null}return {uuid:null,name}}
$('#manualOpBtn').onclick=()=>{const p=manualPlayer();if(p)togglePlayerOp(p,true)};
$('#manualWhitelistBtn').onclick=()=>{const p=manualPlayer();if(p)togglePlayerWhitelist(p,true)};
$('#manualBanBtn').onclick=async()=>{const p=manualPlayer();if(p&&await confirmDialog({title:t('ply.ban'),body:`Ban ${p.name}?`,ok:t('ply.ban'),danger:true}))togglePlayerBan(p,true)};
$('#manualKickBtn').onclick=async()=>{const p=manualPlayer();if(p&&await confirmDialog({title:t('ply.kick'),body:`Kick ${p.name}?`,ok:t('ply.kick'),danger:true}))command(`kick ${p.name}`)};
$('#savePlayerData').onclick=async()=>{if(!selectedPlayer)return toast(t('toast.choosePlayer'));if(!await confirmDialog({title:t('pd.apply'),body:t('toast.applyPlayerConfirm',{n:selectedPlayer.name}),ok:t('pd.apply')}))return;const changes={health:$('#pdHealth').value,food:$('#pdFood').value,saturation:$('#pdSaturation').value,xpLevel:$('#pdXpLevel').value,xpTotal:$('#pdXpTotal').value,gameType:$('#pdGameType').value};const r=await window.observer.playerSave({uuid:selectedPlayer.uuid,changes,clearInventory:$('#pdClearInventory').checked});if(!r.ok)return toast(r.error);toast(t('toast.playerSaved',{n:r.backup}));refreshUI()};
$('#startBtn').onclick=()=>withBusy($('#startBtn'),async()=>{let r;try{r=await window.observer.start(getSettings())}catch(e){toast(`Start failed: ${e?.message||e}`,'error');return}if(!r||!r.ok){toast((r&&r.error)||t('toast.startUnknown'),'error');if(r&&r.error&&r.error.includes('Java')){switchTab('overview');const jw=$('#javaWarnBanner');if(jw&&!jw.hidden)jw.scrollIntoView({behavior:'smooth',block:'center'})}}else toast(t('toast.startRequested'))});$('#stopBtn').onclick=()=>withBusy($('#stopBtn'),async()=>{let r;try{r=await window.observer.stop()}catch(e){toast(`Stop failed: ${e?.message||e}`,'error');return}if(!r.ok)toast(r.error)});
$('#restartBtn').onclick=()=>withBusy($('#restartBtn'),async()=>{if(!await confirmDialog({title:t('top.restart'),body:t('top.restartConfirm'),ok:t('top.restart')}))return;let r;try{r=await window.observer.restart(getSettings())}catch(e){toast(`Restart failed: ${e?.message||e}`,'error');return}if(!r||!r.ok)toast((r&&r.error)||t('toast.restartFailed'),'error');else toast(t('toast.restarting'))});
$('#forceStopBtn').onclick=()=>withBusy($('#forceStopBtn'),async()=>{if(!await confirmDialog({title:t('top.forceStop'),body:t('top.forceStopConfirm'),ok:t('top.forceStop'),danger:true}))return;let r;try{r=await window.observer.forceStop()}catch(e){toast(`Force stop failed: ${e?.message||e}`,'error');return}if(!r||!r.ok)toast((r&&r.error)||'Force stop failed.','error');else toast(t('toast.forceStopped'),'success')});
// v6.0.0 E2: bulk Start all / Stop all. The backend is SEQUENTIAL and each instance runs in its
// own ALS scope; the UI just shows a summary. withBusy prevents a double-click storm while a long
// start-all is in flight (gotcha 18).
// Shared failure toast for the bulk buttons: name the first failing instance and print its real
// error (port clash, RAM, build running, Java missing), with a count of the rest.
function bulkFailToast(failed,key){
  if(!failed||!failed.length)return false;
  const first=failed[0];
  const inst=(state.instances||[]).find(i=>i.id===first.id);
  const name=inst?.name||first.id;
  const extra=failed.length>1?' '+t('inst.andMore',{n:failed.length-1}):'';
  toast(t(key,{name,err:first.error||'failed'})+extra,'error');
  return true;
}
$('#startAllBtn')?.addEventListener('click',()=>withBusy($('#startAllBtn'),async()=>{
  let r; try{ r=await window.observer.instancesStartAll(); }catch(e){ return toast(e?.message||'Start all failed.','error'); }
  if(!r||!r.ok)return toast((r&&r.error)||'Start all failed.','error');
  const n=r.started||0,failed=r.failed||[],s=(r.skipped||[]).length;
  if(bulkFailToast(failed,'inst.startAllFailed'))return;
  if(n)toast(t('inst.startAllDone',{n}),'success');
  else if(s)toast(t('inst.startAllNone'));
}));
$('#stopAllBtn')?.addEventListener('click',()=>withBusy($('#stopAllBtn'),async()=>{
  let r; try{ r=await window.observer.instancesStopAll(); }catch(e){ return toast(e?.message||'Stop all failed.','error'); }
  if(!r||!r.ok)return toast((r&&r.error)||'Stop all failed.','error');
  const n=r.stopped||0,failed=r.failed||[],s=(r.skipped||[]).length;
  if(bulkFailToast(failed,'inst.stopAllFailed'))return;
  if(n)toast(t('inst.stopAllDone',{n}),'success');
  else if(s)toast(t('inst.stopAllNone'));
}));
window.observer.onLog(addLog);window.observer.onState(v=>{
  // M5/B4: server:state is NOT gated (the rail needs a background instance's crash/stop). Record
  // it per instance, then let the ACTIVE view ignore a background instance or it would flip the
  // wrong server. renderInstanceList() repaints the dots from state.instanceStatus.
  const _st=v.status||(v.running?'running':'stopped');
  if(v&&v.instanceId){state.instanceStatus={...(state.instanceStatus||{}),[v.instanceId]:_st};try{renderInstanceList()}catch{}}
  if(v&&v.instanceId&&state.activeInstanceId&&v.instanceId!==state.activeInstanceId)return;
  state.running=v.running;state.status=_st;
  if(state.status==='running'&&!uptimeStart)uptimeStart=Date.now();else if(state.status==='stopped')uptimeStart=null;
  refreshUI()});window.observer.onFiles(f=>{state.files=f.files||f;if(f.eulaAccepted!==undefined)state.eulaAccepted=f.eulaAccepted;state.javaRequired=f.javaRequired??state.javaRequired;refreshUI()});let lastLivePlayersKey='';
let lastMetrics=null;
function applyLiveToUI(live){
  try{
    const tpsText = live?.tps?.toFixed?.(2) ?? '—';
    const msptText = live?.mspt?.toFixed?.(2) ?? '—';
    const tpsEl=$('#tps'); if(tpsEl && tpsEl.textContent==='—' && live?.tps!=null) tpsEl.textContent=tpsText;
    const perfTpsEl=$('#perfTps'); if(perfTpsEl && perfTpsEl.textContent==='—' && live?.tps!=null) perfTpsEl.textContent=tpsText;
    const msptEl=$('#perfMspt'); if(msptEl && msptEl.textContent==='—' && live?.mspt!=null) msptEl.textContent=msptText;
  }catch{}
}
// Sparkline (1.3.0): draw the last ~60 samples as a TPS line + a CPU line on a tiny canvas.
// Reads the shared `samples` ring (defined in 00-core.js). Guards a hidden/0-size canvas (the
// Overview may be display:none when this runs) — draw nothing rather than a broken axis.
function drawOvSpark(){
  const cv=$('#ovSpark'); if(!cv) return;
  const r=cv.getBoundingClientRect(); if(!r.width||!r.height) return;
  const d=devicePixelRatio||1;
  if(cv.width!==Math.round(r.width*d)||cv.height!==Math.round(r.height*d)){cv.width=Math.round(r.width*d);cv.height=Math.round(r.height*d)}
  const ctx=cv.getContext('2d'); ctx.setTransform(d,0,0,d,0,0);
  const w=r.width,h=r.height; ctx.clearRect(0,0,w,h);
  const cs=getComputedStyle(document.documentElement);
  const cTps=cs.getPropertyValue('--chart-tps').trim()||'#00e5ff';
  const cCpu=cs.getPropertyValue('--chart-cpu').trim()||'#ffd23f';
  const data=samples.slice(-60); const n=data.length; if(!n) return;
  const line=(key,color,max)=>{const pts=data.map((s,i)=>({i,v:s[key]})).filter(p=>p.v!=null);if(pts.length<2)return;ctx.beginPath();pts.forEach((p,j)=>{const x=(p.i/(n-1))*w, y=h-2-(Math.min(p.v,max)/max)*(h-4);j?ctx.lineTo(x,y):ctx.moveTo(x,y)});ctx.strokeStyle=color;ctx.lineWidth=1.5;ctx.stroke()};
  line('cpu',cCpu,100); line('tps',cTps,20);
}
// v6.0.0 D3/D4: paint the two Performance-tab alert banners from the same rings the charts use.
// Runs on every metric tick; when there is no anomaly (or no data yet) the banner is hidden. Uses
// textContent so a repeated identical alert does not rebuild the DOM. Skipped entirely when the
// Performance tab is not the active one, so a background tick never touches an offscreen node.
// A literal t() per cause so the i18n dead-key guard sees every key.
function causeLabel(c){switch(c){case 'tick':return t('perf.anomaly.cause.tick');case 'players':return t('perf.anomaly.cause.players');case 'memory':return t('perf.anomaly.cause.memory');default:return t('perf.anomaly.cause.unknown');}}
function paintAlert(el,titleHtml,bodyText){
  if(!el)return;
  if(!bodyText){if(!el.hidden)el.hidden=true;return}
  const next=titleHtml+'|'+bodyText;
  if(el.dataset.sig===next)return;
  el.dataset.sig=next;
  el.innerHTML='<b>'+esc(titleHtml)+'</b>'+esc(bodyText);
  el.hidden=false;
}
function renderAnomalies(){
  try{
    if(!document.getElementById('performance')?.classList.contains('active'))return;
    const a=detectTpsAnomaly(samples);
    paintAlert($('#anomalyBanner'), a?t('perf.anomaly.tpsTitle'):'', a?t('perf.anomaly.tpsBody',{now:a.current.toFixed(2),base:a.baseline.toFixed(2),cause:causeLabel(a.cause)}):'');
    const l=detectMemoryLeak(samplesLong);
    paintAlert($('#leakBanner'), l?t('perf.anomaly.leakTitle'):'', l?t('perf.anomaly.leakBody',{pct:l.growthPerHour,hours:l.hours}):'');
  }catch{}
}
window.observer.onLive(v=>{state.live=v; applyLiveToUI(v);
  const key=(v.players||[]).slice().sort().join(',');if(key!==lastLivePlayersKey){lastLivePlayersKey=key;try{renderPlayers()}catch{}}
});window.observer.onMetrics(v=>{lastMetrics=v; state.live = {...state.live, tps:v.tps??state.live?.tps??null, mspt:v.mspt??state.live?.mspt??null, players:v.players??state.live?.players??[]}; const displayTps = v.tps ?? state.live?.tps ?? null; const displayMspt = v.mspt ?? state.live?.mspt ?? null; const limitGB=state.settings.memoryMax||6;const usedGB=(v.serverMemory||0)/1024;const ram=v.running?Math.min(100,Math.round((v.serverMemory||0)/Math.max(1,limitGB*1024)*100)):null;samples=[...samples.slice(1),{tps:displayTps,mspt:v.running?(displayMspt):null,cpu:v.running?(v.cpu??null):null,ram}];
  // v5.3.0: mirror into the coarse 10s ring so the 1h/6h ranges keep filling live (not only on the
  // initial state snapshot). computeChartSamples() then re-derives chartSamples for the active range.
  const _nowMs=Date.now(), _lastLong=samplesLong[samplesLong.length-1];
  if(!_lastLong||(_nowMs-_lastLong.t)>=PERF_LONG_MS){ samplesLong.push({t:_nowMs,tps:displayTps,mspt:v.running?(displayMspt):null,cpu:v.running?(v.cpu??null):null,ram}); if(samplesLong.length>PERF_LONG_CAP)samplesLong.splice(0,samplesLong.length-PERF_LONG_CAP); }
  computeChartSamples(); try{drawOvSpark();}catch{} try{$('#appMemory').textContent=`${v.appMemory||0} MB`;}catch{} const ramLabel=v.running?`${usedGB.toFixed(1)} / ${limitGB} GB`:'—'; try{$('#perfServerRam').textContent=ramLabel;}catch{} try{$('#serverRam').textContent=ramLabel;}catch{} try{const c=$('#overviewCpu');if(c){if(v.running)tweenNumber(c,v.cpu||0,x=>Math.round(x)+'%');else c.textContent='—';}}catch{} try{const c=$('#perfCpu');if(c){if(v.running)tweenNumber(c,v.cpu||0,x=>Math.round(x)+'%');else c.textContent='—';}}catch{} try{const pc=$('#playerCount');if(pc){if(v.running)tweenNumber(pc,(v.players||[]).length);else pc.textContent='—';}}catch{} // UX (2.6.0): TPS now tweens like CPU/RAM instead of snapping, so all readouts settle together.
  const tpsFmt=x=>x.toFixed(2);
  try{const c=$('#tps');if(c){if(v.running&&displayTps!=null)tweenNumber(c,displayTps,tpsFmt);else c.textContent=displayTps?.toFixed?.(2)??'—';}}catch{} try{const c=$('#perfTps');if(c){if(v.running&&displayTps!=null)tweenNumber(c,displayTps,tpsFmt);else c.textContent=displayTps?.toFixed?.(2)??'—';}}catch{}
  const msptEl=$('#perfMspt');if(msptEl){msptEl.textContent=displayMspt?.toFixed?.(2)??'—'}
  // overview color coding
  const tpsClass=displayTps==null?'':displayTps>=19?'ok':displayTps>=17?'warn':'bad';
  const cpuClass=v.cpu==null||!v.running?'':v.cpu<60?'ok':v.cpu<85?'warn':'bad';
  const ramClass=ram==null?'':ram<75?'ok':ram<90?'warn':'bad';
  const tpsOv=$('#tps'), perfTpsEl2=$('#perfTps'), heroTps=$('#metricStatus');
  if(tpsOv) tpsOv.className=tpsClass;
  if(perfTpsEl2) perfTpsEl2.className=tpsClass;
  if(heroTps) heroTps.className=tpsClass;
  const cpuOv=$('#overviewCpu'), perfCpuEl2=$('#perfCpu');
  if(cpuOv) cpuOv.className=cpuClass;
  if(perfCpuEl2) perfCpuEl2.className=cpuClass;
  const ramOv=$('#serverRam'), perfRamEl2=$('#perfServerRam');
  if(ramOv) ramOv.className=ramClass;
  if(perfRamEl2) perfRamEl2.className=ramClass;
  // perf badges + bars
  const setBadge=(id,val,good,mid)=>{const el=$(id); if(!el) return; const level=val==null?'':val>=good?'ok':val>=mid?'warn':'bad'; el.className='kpi-badge '+(level||''); el.textContent=val==null?'—':level==='ok'?t('perf.badgeGood'):level==='warn'?t('perf.badgeWarn'):t('perf.badgeCritical'); };
  setBadge('#perfTpsBadge', displayTps, 19, 17); setBadge('#perfMsptBadge', displayMspt!=null? (100 - Math.min(100,displayMspt)):null, 60, 30); // invert mspt for badge
  setBadge('#perfCpuBadge', v.cpu, 40, 70); // lower is better, so invert logic: we treat high as bad
  const perfCpuBadge=$('#perfCpuBadge'); if(perfCpuBadge && v.cpu!=null){ perfCpuBadge.className='kpi-badge '+(v.cpu<60?'ok':v.cpu<85?'warn':'bad'); perfCpuBadge.textContent=v.cpu<60?t('perf.badgeGood'):v.cpu<85?t('perf.badgeHigh'):t('perf.badgeCritical'); }
  setBadge('#perfRamBadge', ram, 30, 60); // placeholder, will override below
  const ramBadge=$('#perfRamBadge'); if(ramBadge && ram!=null){ ramBadge.className='kpi-badge '+(ram<75?'ok':ram<90?'warn':'bad'); ramBadge.textContent=ram<75?t('perf.badgeGood'):ram<90?t('perf.badgeHigh'):t('perf.badgeCritical'); } else if(ramBadge && ram==null){ ramBadge.className='kpi-badge'; ramBadge.textContent='—'; }
  const bar=(id,pct)=>{const el=$(id); if(el) el.style.width=(pct==null?0:Math.max(4,Math.min(100,pct)))+'%';};
  bar('#perfTpsBar', displayTps!=null? (displayTps/20*100):null); bar('#perfMsptBar', displayMspt!=null? Math.min(100, displayMspt/100*100):null); bar('#perfCpuBar', v.cpu); bar('#perfRamBar', ram);
  const liveDot=$('#perfLiveDot'), liveText=$('#perfLiveText'), uptimeEl=$('#perfUptime'); if(liveDot){ liveDot.className='live-dot'+(v.running?' on':''); } if(liveText) liveText.textContent=v.running?`${t('con.live')} • ${t('top.running')}`:t('top.offline'); if(uptimeEl) uptimeEl.textContent=uptimeStart? document.getElementById('heroUptime')?.textContent || '—' : '—';
  const launcherMem=$('#perfLauncherMem'); if(launcherMem) launcherMem.textContent=t('perf.ramLauncher',{n:v.appMemory||0});
  const tickEmpty=$('#tickChartEmpty'), resEmpty=$('#resourceChartEmpty');
  if(tickEmpty) tickEmpty.hidden=!!(displayTps!=null || displayMspt!=null);
  if(resEmpty) resEmpty.hidden=!!(v.cpu!=null || ram!=null);
  const liveBadge=$('#resourceLiveBadge'); if(liveBadge){ liveBadge.textContent=v.running?t('perf.live'):t('perf.offlineBadge'); liveBadge.style.color=v.running?'var(--success)':'var(--text-dim)'; liveBadge.style.borderColor=v.running?'rgba(0,229,160,.25)':'var(--border)'; }
  metricChart($('#perfTickChart'),true,'tick');metricChart($('#perfResourceChart'),true,'resource'); try{renderAnomalies();}catch{}});
 // Fallback: if the main process is slow or misses a push, keep the UI in sync from
 // lastMetrics/live every 2s.
 setInterval(()=>{ try{ if(lastMetrics){ const v=lastMetrics; const displayTps=v.tps??state.live?.tps??null; const displayMspt=v.mspt??state.live?.mspt??null; if(displayTps!=null){ const el=$('#tps'); if(el && el.textContent==='—') el.textContent=displayTps.toFixed(2); const el2=$('#perfTps'); if(el2 && el2.textContent==='—') el2.textContent=displayTps.toFixed(2); } if(displayMspt!=null){ const el=$('#perfMspt'); if(el && el.textContent==='—') el.textContent=displayMspt.toFixed(2); } } }catch{} }, 2500);
 // Periodically redraw charts while the Performance tab is open (fixes a 0x0 canvas when the tab
 // was hidden as metrics arrived).
 setInterval(()=>{ try{ if(document.getElementById('performance')?.classList.contains('active')){ metricChart($('#perfTickChart'),true,'tick'); metricChart($('#perfResourceChart'),true,'resource'); } }catch{} }, 2000);
// v6.0.0 G3: the preset builders (aikarFlags / zgcFlags / g1TunedFlags / JVM_PRESETS) live in
// 00-core.js so they are unit-tested without the DOM; this file only wires them to the input.
function applyJvmPreset(name){
  const fn=JVM_PRESETS[String(name||'').toLowerCase()];
  if(typeof fn!=='function'||!$('#jvmArgsInput'))return false;
  const min=Number($('#memoryMinInput')?.value)||2, max=Number($('#memoryMaxInput')?.value)||6;
  $('#jvmArgsInput').value=fn(min,max);
  try{ renderJvmPreview(); }catch{}
  return true;
}
$('#jvmPresetRow')?.addEventListener('click',e=>{const b=e.target.closest('[data-jvm-preset]');if(!b)return;applyJvmPreset(b.dataset.jvmPreset);toast(t('set.presetFilled',{n:t('set.preset.'+b.dataset.jvmPreset)}))});
$('#jvmPresetHelp')?.addEventListener('click',()=>{toast(t('set.presetHelp.aikar'),undefined);setTimeout(()=>toast(t('set.presetHelp.zgc')),2500);setTimeout(()=>toast(t('set.presetHelp.g1')),5000);});
$('#applyAikarFlags').onclick=()=>{applyJvmPreset('aikar');toast(t('set.aikarFilled'))};
$('#showWelcomeAgain').onclick=()=>showOnboarding();

// FEATURE: "How friends can join" — surfaces the LAN address (instant, no network call) and lets the
// user look up their public IP on demand. Both are just the IP; the port is read from server.properties
// (or the Velocity default) so the whole thing stays correct if the user changes server-port.
let launcherPlatform='win32';
async function loadConnectInfo(){
  const r=await window.observer.networkInfo();if(!r.ok)return;
  const port=r.port;
  launcherPlatform=r.platform||'win32';
  const localAddr=r.localIps.length?r.localIps.map(ip=>`${ip}:${port}`).join(', '):t('conn.noLan');
  $('#connectLocal').value=localAddr;
  // 5.2.0: mirror the LAN address into the beginner share card (first address only — one thing to copy).
  const bs=$('#beginnerShareAddr');if(bs)bs.value=r.localIps.length?`${r.localIps[0]}:${port}`:t('conn.noLan');
  $('#allowFirewall').dataset.port=port;
  // Linux cannot auto-open the firewall without sudo; relabel the button so it copies the command.
  const fw=$('#allowFirewall'); if(fw){ fw.textContent = launcherPlatform==='linux' ? t('conn.copyFwCmd') : t('conn.firewall'); }
}

$('#tunnelStart').onclick=()=>withBusy($('#tunnelStart'),async()=>{if(!await confirmDialog({title:t('tun.start'),body:t('tun.confirm'),ok:t('tun.start'),danger:true}))return;const r=await window.observer.tunnelStart('playit');if(!r.ok)return toast(r.error,'error');toast(t('tun.started'),'success')});
$('#tunnelDashboard').onclick=()=>window.observer.tunnelOpenUrl('https://playit.gg/account/tunnels');
// v5.7.0 GEYSER: run Geyser's own connectiontest and show the reply.
$('#geyserTestBtn')?.addEventListener('click',async()=>{const b=$('#geyserTestBtn'),m=$('#geyserTestMsg');b.disabled=true;if(m){m.hidden=false;m.textContent=t('geyser.testing')}try{const r=await window.observer.geyserTest();if(m){m.textContent=(r&&r.ok)?(r.reply||t('geyser.testOk')):((r&&r.error)||t('geyser.testFail'))}}catch(e){if(m)m.textContent=e?.message||t('geyser.testFail')}finally{b.disabled=false}});
// A1 (v6.0.0): repair the safe Geyser config problems in one click. Confirm first (it edits a file
// the user owns), then re-fetch state so the panel reflects the repaired config.
$('#geyserFixBtn')?.addEventListener('click',()=>withBusy($('#geyserFixBtn'),async()=>{if(!await confirmDialog({title:t('geyser.fix'),body:t('geyser.fixConfirm'),ok:t('geyser.fix')}))return;const safe=await window.observer.geyserApplyFix({});if(!safe||!safe.ok)return toast((safe&&safe.error)||t('geyser.fixFail'),'error');let changed=(safe.changed||[]).slice(),backup=safe.backup;const portIssue=!!(state.geyser&&state.geyser.issues&&state.geyser.issues.some(it=>it.key==='bedrock.port'));if(portIssue&&await confirmDialog({title:t('geyser.fixPort'),body:t('geyser.fixPortConfirm'),ok:t('geyser.fixPort')})){const pr=await window.observer.geyserApplyFix({includeBedrockPort:true});if(!pr||!pr.ok)toast((pr&&pr.error)||t('geyser.fixFail'),'error');else{changed=changed.concat(pr.changed||[]);backup=pr.backup||backup}}if(!changed.length)return toast(t('geyser.fixNone'),'success');toast(t('geyser.fixDone',{n:changed.length}),'success');if(backup)toast(t('geyser.fixBackup',{p:backup}),'success');try{const s=await window.observer.getState();state={...state,...s};refreshUI()}catch{}}));
// v6.0.0 A2.5: Pinggy Bedrock UDP tunnel controls.
function applyPinggyStatus(s){s=s||{};const pill=$('#pinggyPill'),start=$('#pinggyStartBtn'),stop=$('#pinggyStopBtn'),copy=$('#pinggyCopyBtn'),row=$('#pinggyAddrRow'),addr=$('#pinggyAddr'),hint=$('#pinggyHint');const st=s.status||'stopped';
  if(pill){pill.textContent=st==='running'?t('pg.running'):st==='starting'?t('pg.starting'):st==='error'?t('pg.error'):t('pg.off');pill.className='tunnel-pill '+(st==='running'?'running':st==='error'?'error':'')}
  if(start){start.hidden=st==='running'||st==='starting';start.disabled=st==='starting'}
  if(stop)stop.hidden=!(st==='running'||st==='starting')
  if(s.address){if(addr)addr.value=s.address;if(row)row.hidden=false;if(copy)copy.hidden=false;if(hint)hint.textContent=t('pg.shareHint')}else{if(row)row.hidden=true;if(copy)copy.hidden=true}
}
$('#pinggyStartBtn')?.addEventListener('click',()=>withBusy($('#pinggyStartBtn'),async()=>{const r=await window.observer.pinggyStart('udp');if(!r||!r.ok)return toast((r&&r.error)||t('pg.startFail'),'error');toast(t('pg.started'),'success');applyPinggyStatus({status:'running',address:r.address})}));
$('#pinggyStopBtn')?.addEventListener('click',()=>withBusy($('#pinggyStopBtn'),async()=>{const r=await window.observer.pinggyStop();if(r&&r.ok){toast(t('pg.stopped'),'success');applyPinggyStatus({status:'stopped'})}else toast((r&&r.error)||t('pg.stopFail'),'error')}));
$('#pinggyCopyBtn')?.addEventListener('click',async()=>{const v=$('#pinggyAddr')?.value;if(!v)return;try{await navigator.clipboard.writeText(v);toast(t('toast.copied'),'success')}catch{toast(t('toast.copyFailed'),'error')}});
if(window.observer.onPinggyStatus)window.observer.onPinggyStatus(applyPinggyStatus);
// v6.0.0 D2: show the crash analysis banner when the main process detects a crash report after an
// unexpected exit. Category + hints come from the pure doctor.classifyCrash; the stack trace is
// collapsible.
window.observer.onCrashAnalysis?.(a=>{
  const panel=$('#crashPanel'); if(!panel||!a) return;
  const cat=a.category||'unknown';
  const catLabel=t('crash.cat.'+cat)||cat;
  const sub=$('#crashSub'); if(sub) sub.textContent=t('crash.sub',{n:a.name||''});
  const cc=$('#crashCat'); if(cc) cc.innerHTML=`<span class="crash-badge ${cat==='unknown'?'warn':'bad'}">${esc(catLabel)}</span><span class="text-muted">${esc(a.confidence||'')}${a.description?' · '+esc(a.description):''}${a.version?' · MC '+esc(a.version):''}</span>`;
  const hints=$('#crashHints'); if(hints) hints.innerHTML=(a.hints||[]).map(h=>`<li>${esc(h)}</li>`).join('');
  const stack=$('#crashStack'); if(stack) stack.textContent=(a.cause||[]).join('\n');
  panel.hidden=false;
  try{ switchTab('console'); }catch{}
});
$('#crashClose')?.addEventListener('click',()=>{const p=$('#crashPanel');if(p)p.hidden=true});
try{window.observer.pinggyGet().then(applyPinggyStatus).catch(()=>{})}catch{}
$('#autoTunnelQuick')?.addEventListener('change',async()=>{const next={...getSettings(),autoTunnel:$('#autoTunnelQuick').checked};const r=await window.observer.saveSettings(next);if(!r.ok){toast(r.error,'error');return}state={...state,settings:next,java:r.java};if($('#autoTunnelInput'))$('#autoTunnelInput').checked=next.autoTunnel;toast(next.autoTunnel?t('tun.autoOnToast'):t('tun.autoOffToast'),'success')});
const tunnelManual=$('#tunnelManual');if(tunnelManual){tunnelManual.value=localStorage.getItem('tunnelManualAddress')||state.settings?.tunnelAddress||'';tunnelManual.addEventListener('change',()=>{localStorage.setItem('tunnelManualAddress',tunnelManual.value.trim());window.observer.saveManualTunnel(tunnelManual.value.trim())})}
async function refreshTunnelUI(){try{const s=await window.observer.tunnelGet();applyTunnelStatus(s)}catch{}}
function applyTunnelStatus(s){const pill=$('#tunnelPill'),startBtn=$('#tunnelStart'),msg=$('#tunnelMsg');if(!pill)return;
  const st=s?.status||'stopped';pill.textContent=st==='running'?t('tun.live'):st==='installing'?t('tun.installing'):st==='starting'?t('tun.starting'):st==='error'?t('tun.error'):t('tun.off');pill.className='tunnel-pill '+st;
  if(startBtn)startBtn.disabled=st==='installing'||st==='starting';
  if(msg){if(st==='installing'){msg.hidden=false;msg.textContent=t('tun.downloading')}else if(st==='error'){msg.hidden=false;msg.textContent=t('tun.serviceError')}else{msg.hidden=true;msg.textContent=''}}}
window.observer.onTunnelStatus(applyTunnelStatus);
refreshTunnelUI();
setInterval(refreshTunnelUI,15000);
$('#playitBrowse')?.addEventListener('click',async()=>{const f=await window.observer.pickPlayitFile();if(f){const inp=$('#playitPathInput');inp.value=f;inp.dispatchEvent(new Event('input',{bubbles:true}))}});
$('#refreshConnectInfo').onclick=loadConnectInfo;
$('#checkPublicIp').onclick=async()=>{
  const btn=$('#checkPublicIp');btn.disabled=true;const original=btn.textContent;btn.textContent='…';
  const r=await window.observer.checkPublicIp();
  btn.disabled=false;btn.textContent=original;
  if(!r.ok)return toast(r.error,'error');
  const port=$('#allowFirewall').dataset.port||25565;
  $('#connectPublic').value=`${r.ip}:${port}`;
};
$('#allowFirewall').onclick=async()=>{
  const port=Number($('#allowFirewall').dataset.port)||25565;
  // Linux: no auto-elevation. Copy the ufw command for the user to paste in a terminal.
  if(launcherPlatform==='linux'){
    const cmd=`sudo ufw allow ${port}/tcp`;
    try{ await navigator.clipboard.writeText(cmd); toast(t('conn.fwCopiedLinux',{c:cmd}),'success'); }
    catch{ toast(t('conn.fwRunLinux',{c:cmd})); }
    return;
  }
  if(!await confirmDialog({title:t('conn.firewall'),body:t('conn.fwConfirmBody',{p:port}),ok:t('conn.firewall')}))return;
  const r=await window.observer.allowFirewall(port);
  if(!r.ok)return toast(r.error,'error');
  toast(t('conn.fwAllowed',{p:port}),'success');
};
$$('[data-copy]').forEach(b=>b.onclick=async()=>{
  const input=$(b.dataset.copy);if(!input||!input.value||input.value==='—')return toast(t('toast.nothingToCopy'));
  try{
    await navigator.clipboard.writeText(input.value);
    const orig=b.textContent; b.textContent=t('set.copied'); b.classList.add('copied');
    toast(t('toast.copied'),'success');
    setTimeout(()=>{b.textContent=orig; b.classList.remove('copied')}, 1400);
  }catch{toast(t('toast.copyFailed'),'error')}
});

// FEATURE: one-click portable Java install — shown only when Java isn't already detected, so
// beginners never have to find/install a JDK themselves before they can start their first server.
window.observer.onJavaProgress(({received, total})=>{
  const fill=$('#javaProgressFill'), label=$('#javaProgressLabel'), wrap=$('#javaProgress'); if(!fill||!wrap) return;
  wrap.hidden=false;
  if(total>0){ fill.classList.remove('indeterminate'); fill.style.width=`${Math.min(100,Math.round(received/total*100))}%`; label.textContent=`${formatBytes(received)} / ${formatBytes(total)} (${Math.min(100,Math.round(received/total*100))}%)`; }
  else { fill.classList.add('indeterminate'); label.textContent=`${formatBytes(received)} downloaded…`; }
});
$('#javaAutoInstall').onclick=async()=>{
  const btn=$('#javaAutoInstall');btn.disabled=true;const original=btn.textContent;btn.textContent=t('set.javaDownloading');
  $('#javaProgress').hidden=false; $('#javaProgressFill').style.width='0%'; $('#javaProgressFill').classList.add('indeterminate'); $('#javaProgressLabel').textContent=t('nsw.startingDownload');
  const r=await window.observer.javaAutoInstall();
  btn.disabled=false;btn.textContent=original; $('#javaProgress').hidden=true;
  if(!r.ok)return toast(r.error,'error');
  state.java=r.java;state.settings={...state.settings,javaPath:r.java.path};markSettingsSaved();refreshUI();
  toast(t('toast.javaInstalled',{v:r.java.version}),'success');
};

// FEATURE: first-run onboarding flow — create a new server (recommended for beginners), pick an
// existing server folder, or skip to explore on your own. Doesn't ask again once completed
// (settings.onboarded).
let showOnboarding=function(){const m=$('#onboardingModal');m.hidden=false;trapFocus(m)};
function hideOnboarding(){const m=$('#onboardingModal');if(m.hidden)return;releaseFocus();m.hidden=true}
async function markOnboarded(){await window.observer.onboardingComplete();state.settings={...state.settings,onboarded:true}}
// BUGFIX: this modal had no way to dismiss it besides picking one of the 3 onboarding choices — fine
// on a genuinely first run, but "Show welcome guide again" (Settings) reopens this same modal on an
// ALREADY-configured install, and there was no way back out except re-running one of those 3 actions.
// A close (×) button, Escape, and clicking the dimmed backdrop now all dismiss any open modal — added
// once, generically, so this can't quietly happen again for a future modal either.
$('#onboardingClose').onclick=()=>hideOnboarding();
// 5.2.0 onboarding: an explicit mode picker (Beginner / Advanced) + a language dropdown at the top.
// The MODE chosen drives the app layout; the ACTION card below only decides what happens next. So
// "Explore on my own" as a Beginner still turns Beginner mode on (the user picked that mode).
let obMode='beginner';
function setObMode(m){
  obMode=(m==='advanced')?'advanced':'beginner';
  const b=$('#obModeBeginner'),a=$('#obModeAdvanced');
  if(b){b.classList.toggle('active',obMode==='beginner');b.setAttribute('aria-checked',obMode==='beginner'?'true':'false')}
  if(a){a.classList.toggle('active',obMode==='advanced');a.setAttribute('aria-checked',obMode==='advanced'?'true':'false')}
}
$('#obModeBeginner')&&($('#obModeBeginner').onclick=()=>setObMode('beginner'));
$('#obModeAdvanced')&&($('#obModeAdvanced').onclick=()=>setObMode('advanced'));
// Language dropdown: populated from LOCALES_META. Changing it applies immediately (no Apply here —
// this is the first-run wizard, not the Settings form) and re-translates the modal.
function fillObLanguages(){
  const sel=$('#obLangSelect');if(!sel||!window.LOCALES_META)return;
  sel.innerHTML=window.LOCALES_META.map(l=>`<option value="${esc(l.code)}">${esc(l.name)}</option>`).join('');
  sel.value=currentLocale||'en';
}
$('#obLangSelect')&&($('#obLangSelect').onchange=async e=>{
  currentLocale=e.target.value;applyLocale();
  const ls=$('#languageSelect');if(ls)ls.value=currentLocale;
  try{await window.observer.saveSettings({...getSettings(),locale:currentLocale})}catch{}
});
// Persist mode + locale, then run the chosen action.
async function obFinish(){
  fillObLanguages();
  await saveBeginnerMode(obMode==='beginner');
  hideOnboarding();await markOnboarded();
}
$('#obSkip').onclick=async()=>{await obFinish()};
$('#obPickExisting').onclick=async()=>{await obFinish();await addExistingInstance()};
$('#obCreateNew').onclick=async()=>{
  // The wizard's step 1 picks the folder and creates a NEW instance for it — do NOT run
  // chooseFolder here: that would save serverPath onto the currently-active instance.
  await obFinish();
  openNewServerWizard();
};
// Default the modal to Beginner + current language every time it opens.
const _origShowOnboarding=showOnboarding;
showOnboarding=function(){setObMode('beginner');fillObLanguages();_origShowOnboarding()};
// 5.2.0 Beginner mode: a gentler UI — rail shows only Overview/Console/Players/Settings, and the
// RAM/JVM panel + advanced tabs are hidden via the body.beginner-mode CSS. Nothing is REMOVED
// (DESIGN.md 2.4 layering): "Show all tools" turns the full set back on instantly.
const BEGINNER_TABS=new Set(['overview','console','players','properties','settings']);
function applyBeginnerMode(on){
  const on_=!!on;
  document.body.classList.toggle('beginner-mode',on_);
  // Never leave the user stranded on a tab that just got hidden.
  if(on_){const cur=document.querySelector('.tab.active');if(cur&&!BEGINNER_TABS.has(cur.id))switchTab('overview')}
  const sa=$('#railShowAll');if(sa)sa.hidden=!on_;
  const share=$('#beginnerShare');if(share)share.hidden=!(on_&&state.running);
}
async function saveBeginnerMode(on){
  let r;try{r=await window.observer.saveSettings({...getSettings(),beginnerMode:!!on});}catch{return false}
  if(!r||!r.ok)return false;
  state={...state,settings:{...state.settings,beginnerMode:!!on}};
  applyBeginnerMode(on);try{markSettingsSaved()}catch{}
  return true;
}
// "Show all tools" is a QUICK ESCAPE (not a settings form field): apply + persist immediately.
$('#railShowAll')&&($('#railShowAll').onclick=()=>saveBeginnerMode(false));
// The Settings toggle follows the normal edit -> Apply flow: changing it only marks the form dirty
// (the section-level input/change listener in 07-overview.js does that). It is actually applied when
// the user clicks "Apply settings", which calls refreshUI() -> applyBeginnerMode(state.settings...).
// (Previously this auto-saved on change, which bypassed Apply — the reported bug.)

// The guided "create a new server" wizard now lives in 12-wizard.js (loads after this file).
// Wizard state/functions moved to 12-wizard.js.
function formatBytes(n){if(n==null)return'';if(n<1024)return`${n} B`;if(n<1024*1024)return`${(n/1024).toFixed(0)} KB`;return`${(n/1024/1024).toFixed(1)} MB`}
// Wizard UI (nsw*) moved to 12-wizard.js.
$('#newServerClose').onclick=()=>{if($('#nswNext').disabled)return toast(t('toast.waitDownload'),'error'); closeOverlayAnimated($('#newServerModal'));};
// FEATURE: generic modal dismissal — Escape key, or clicking the dimmed backdrop outside the modal
// card, closes whichever .modal-overlay is currently open. Covers every current and future modal from
// one place instead of each modal needing its own escape-hatch wiring (see the note above on why that
// was missing for onboarding). Guarded so it can't close the create-server modal mid-download — the
// download itself isn't cancellable, so closing then would just hide the progress from a job still
// running, and its completion toast/tab-switch would fire later with no modal left to explain why.
const modalBusy=overlay=>overlay.id==='newServerModal'&&$('#nswNext').disabled||overlay.id==='installModal'&&installState.busy;
// The overlay's fade-out is now driven by CSS discrete transitions on [hidden] (08-motion.css),
// so we only flip the attribute — the browser keeps the element painted during the fade and then
// sets display:none. No manual setTimeout timing to drift out of sync.
function closeOverlayAnimated(el){ releaseFocus(); el.classList.add('closing'); el.hidden=true; setTimeout(()=>el.classList.remove('closing'),220); }
document.addEventListener('keydown',e=>{if(e.key==='Escape'){const open=$$('.modal-overlay').find(m=>!m.hidden);if(open&&!modalBusy(open)){ if(open.id==='playerInspectModal') closePlayerInspectModal(); else closeOverlayAnimated(open); }}});
$$('.modal-overlay').forEach(overlay=>overlay.addEventListener('click',e=>{if(e.target===overlay&&!modalBusy(overlay)){ if(overlay.id==='playerInspectModal') closePlayerInspectModal(); else closeOverlayAnimated(overlay); }}));

(async()=>{const langSel=$('#languageSelect');if(langSel&&window.LOCALES_META)langSel.innerHTML=window.LOCALES_META.map(l=>`<option value="${esc(l.code)}">${esc(l.name)}</option>`).join('');
let initial;try{initial=await window.observer.getState()}catch(e){toast(`Could not load launcher state: ${e?.message||e}`,'error');return}state={...state,...initial};addLogsBatch(initial.logs||[]);refreshUI();loadConnectInfo();bootStep(65,'boot.state');if(!state.settings?.onboarded)showOnboarding();
// Baseline the settings form from the just-loaded state so an edit that returns every field to its
// original value clears the Apply dot (no spurious "unsaved changes").
try{markSettingsSaved()}catch{}
// BUGFIX (Start dead on launch): if this first snapshot raced backend init and
// came back without Java/files, re-sync once the backend has settled instead
// of leaving Start disabled until the next folder save.
if(!initial.java?.ok||!initial.files?.jar&&!initial.files?.launchScript){setTimeout(async()=>{try{const s2=await window.observer.getState();state={...state,...s2};const f2=await window.observer.getFiles();if(f2&&f2.ok){state.files=f2.files;state.javaRequired=f2.javaRequired??state.javaRequired}refreshUI()}catch{}},2500);}
// BUGFIX (remote/MCP show OFF right after launch though enabled): main.js starts those loopback
// servers AFTER the window loads and does not await them, so the first snapshot can race the
// listen() and report running:false. Re-sync once the backend has settled, like the Java fix above.
if(initial.settings?.remoteEnabled&&!initial.remote?.running||initial.settings?.mcpEnabled&&!initial.mcp?.running){setTimeout(async()=>{try{const s3=await window.observer.getState();state={...state,mcp:s3.mcp??state.mcp,remote:s3.remote??state.remote};refreshUI()}catch{}},2500);}
// BUGFIX: the native min/max/close caption buttons overlay the top-right of the page and used to
// cover the server-path text in the command bar. Detect the Window Controls Overlay and flag it so
// CSS can reserve its width (.wco-app rules in style.css).
try{const wco=navigator.windowControlsOverlay;if(wco){const sync=()=>document.documentElement.classList.toggle('wco-app',!!wco.visible);sync();wco.addEventListener('geometrychange',sync);}}catch{}
bootStep(85,'boot.market');const v=window.observer.isE2E?{ok:false}:await window.observer.marketVersions();if(v.ok)$('#marketVersion').innerHTML='<option value="">All versions</option>'+v.versions.map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join('');requestAnimationFrame(positionChannelIndicator);window.addEventListener('resize',()=>{metricChart($('#perfTickChart'),true,'tick');metricChart($('#perfResourceChart'),true,'resource');positionChannelIndicator();bootFinish()})})();

// ===== AUTO-UPDATE UI =====
const updateBtn=$('#checkUpdateBtn');
// BUGFIX: every update call is now awaited and its {ok:false} / thrown error is shown, and the
// status text resets to a retryable state instead of sticking on "Checking…" after a failure.
if(updateBtn)updateBtn.onclick=()=>withBusy(updateBtn,async()=>{
  const st=$('#updateStatus');
  if(st)st.textContent=t('upd.checking');
  try{const r=await window.observer.checkUpdate();if(r&&!r.ok&&st)st.textContent=r.error||t('upd.none');}catch(e){if(st)st.textContent=e?.message||String(e);}
});
window.observer.onUpdateAvailable(v=>{const st=$('#updateStatus');if(st)st.innerHTML=t('upd.available',{v:v.version})+' <button class="btn primary sm" id="dlBtn">'+t('upd.download')+'</button>';const b=$('#dlBtn');if(b)b.onclick=()=>withBusy(b,async()=>{const s=$('#updateStatus');try{const r=await window.observer.downloadUpdate();if(r&&!r.ok&&s)s.textContent=r.error||'Download failed.';}catch(e){if(s)s.textContent=e?.message||String(e);}});});
window.observer.onUpdateProgress(p=>{const st=$('#updateStatus');if(st)st.textContent=t('upd.downloading',{p:Math.round(p.percent)});});
window.observer.onUpdateDownloaded(()=>{const st=$('#updateStatus');if(st)st.innerHTML=t('upd.ready')+' <button class="btn primary sm" id="installBtn">'+t('upd.install')+'</button>';const b=$('#installBtn');if(b)b.onclick=async()=>{
  // Installing restarts the app, which stops any running server. Warn first so nobody loses an
  // unsaved world without knowing why the launcher is about to close.
  if(state.running&&!await confirmDialog({title:t('upd.install'),body:t('upd.confirmRunning'),ok:t('upd.install')}))return;
  try{await window.observer.quitInstall();}catch(e){const s=$('#updateStatus');if(s)s.textContent=e?.message||String(e);}
};});
window.observer.onUpdateNone&&window.observer.onUpdateNone(()=>{const st=$('#updateStatus');if(st)st.textContent=t('upd.none');});
window.observer.onUpdateError&&window.observer.onUpdateError(d=>{const st=$('#updateStatus');if(st)st.textContent=t('upd.error',{m:d&&d.message?d.message:'unknown error'});});

// ===== PULSE — the launcher's heartbeat. 8 ticks fill every ~5s poll cycle.
const pulseWave=$('#pulseWave');let pulseTicks=[];
if(pulseWave){for(let i=0;i<8;i++){const tEl=document.createElement('i');pulseWave.appendChild(tEl);pulseTicks.push(tEl)}}
let pulseTimer=null,pulsePos=0;
function pulseTick(){if(!pulseTicks.length)return;pulseTicks.forEach(t=>t.classList.remove('done'));
  pulseTicks[pulsePos%8].classList.add('done');pulsePos++}
function pulseStart(){pulseStop();pulsePos=0;pulseTimer=setInterval(pulseTick,625)} // 8 ticks × 625ms ≈ 5s poll
function pulseStop(){clearInterval(pulseTimer);pulseTimer=null;pulsePos=0;pulseTicks.forEach(t=>t.classList.remove('done'))}
// State choreography (1.3.0): the whole app shifts mood with the server. <html> carries one of
// is-offline / is-starting / is-running; CSS (.signal-field, hero, pulse) reacts. This is the ONE
// place the class changes, so every ambient layer stays in sync.
window.observer.onState(v=>{
  const root=document.documentElement;
  root.classList.remove('is-offline','is-starting','is-running');
  const st=v?.status||'stopped';
  root.classList.add(st==='running'?'is-running':st==='stopped'?'is-offline':'is-starting');
  if(st==='running')pulseStart();else pulseStop();
});

// MCP write/destroy confirmation: the main process forwards a pending tool call here; we show
// an in-app dialog (same style as everything else) and send the user's answer back so the MCP
// tool call can proceed or be denied. Read-only tools never reach this path.
// Notify when an AI client first connects to the MCP server.
window.observer.onMcpClient?.(() => { toast(t('mcp.clientConnected'), 'success'); });
// M8 t2: a server left running by a crash. Ask the user Reconnect (keep it) or Stop it. The dialog
// resolves 'reconnect' on Escape/backdrop (safer default — never force-kill without a clear answer).
window.observer.onOrphanPrompt?.(req => {
  if(!req||!req.instanceId)return;
  confirmDialog({ title:t('orphan.title'), body:esc(t('orphan.body',{n:req.name||req.instanceId,p:req.pid})), ok:t('orphan.stop'), cancel:t('orphan.reconnect'), danger:true })
    .then(stop => { window.observer.respondOrphan({ instanceId:req.instanceId, action: stop?'stop':'reconnect' }); toast(stop?t('orphan.stopToast'):t('orphan.reconnectToast')); })
    .catch(() => window.observer.respondOrphan({ instanceId:req.instanceId, action:'reconnect' }));
});
// v2.5.0: turn a tool's args into a short, human-readable summary for the confirm dialog instead
// of dumping raw JSON. Falls back to truncated JSON when nothing matches. A few shapes cover the
// common write/destroy tools (install, edit_file, write_file, delete_*, apply_fix, send_command).
function summarizeMcpArgs(tool, args){
  try{
    args=args||{};
    if(tool==='install_from_market')return t('mcp.sumInstall',{id:args.id||'?'})+(args.kind?' ('+args.kind+')':'');
    if(tool==='assemble_modpack'&&Array.isArray(args.items))return t('mcp.sumAssemble',{n:args.items.length});
    if(tool==='apply_fix'&&Array.isArray(args.actions))return t('mcp.sumFixes',{n:args.actions.length})+': '+args.actions.map(a=>a&&a.action).filter(Boolean).join(', ');
    if(tool==='edit_file'||tool==='write_file')return (args.path||'')+(tool==='write_file'&&args.content?(' — '+(args.content.length)+' chars'):'');
    if(tool==='send_console_command')return args.command||'';
    if(tool==='set_property')return (args.key||'')+' = '+(args.value==null?'':args.value);
    if(tool==='delete_content'||tool==='delete_backup'||tool==='restore_backup')return args.name||args.fileName||'';
    if(tool==='ban_player'||tool==='kick_player'||tool==='op_player'||tool==='whitelist_player')return args.name||args.ip||'';
  }catch{}
  return null;
}
window.observer.onMcpConfirmRequest?.(req => {
  if(!req||!req.reqId)return;
  const riskLabel=req.risk==='destroy'?t('mcp.riskDestroy'):t('mcp.riskWrite');
  // v2.5.0: try a short human summary first; fall back to truncated JSON only when nothing matches.
  let argText='';
  const summary=summarizeMcpArgs(req.tool,req.args);
  if(summary) argText=summary;
  else{
    try{argText=JSON.stringify(req.args||{},null,2)}catch{argText=''}
    // Truncate the preview so a 2MB write_file payload does not blow up the dialog DOM.
    if(argText.length>2000)argText=argText.slice(0,2000)+'\n… ('+(argText.length-2000)+' more chars)';
  }
  const body=(req.risk==='destroy'?t('mcp.confirmDestroy'):t('mcp.confirmWrite',{t:req.tool}))
    +(req.instanceName?`\n\n`+t('mcp.targetInstance')+`: `+req.instanceName:'')
    +`\n\n`+t('mcp.tool')+`: `+req.tool+`  ·  `+t('mcp.risk')+`: `+riskLabel
    +(argText&&argText!=='{}'?`\n\n`+t(summary?'mcp.detail':'mcp.args')+`:\n`+argText:'');
  confirmDialog({title:t('mcp.confirmTitle'),body:esc(body).replace(/\n/g,'<br>'),ok:t('mcp.allow'),cancel:t('mcp.deny'),danger:req.risk==='destroy'})
    .then(allow=>window.observer.respondMcpConfirm({reqId:req.reqId,allow:!!allow}))
    .catch(()=>window.observer.respondMcpConfirm({reqId:req.reqId,allow:false}));
});

// ===== MICRO-INTERACTIONS (1.3.0) — magnetic primary buttons + cursor spotlight.
// Both are restrained and reduced-motion aware; neither changes layout or meaning. =====
(function microInteractions(){
  if(_rm.matches) return; // no pointer-tracked motion when the user asked for less motion
  // Magnetic: the PRIMARY action drifts up to 3px toward the cursor, springs back on leave.
  // Delegated so it works for buttons created later (wizard, dialogs). Only .btn.primary — the
  // single clear action on screen — so the effect stays meaningful instead of everywhere.
  const MAX=3;
  document.addEventListener('pointermove',e=>{
    const b=e.target.closest?.('.btn.primary');
    document.querySelectorAll('.btn.primary.magnet').forEach(el=>{ if(el!==b) el.style.transform=''; });
    if(!b||b.disabled) return;
    const r=b.getBoundingClientRect();
    const dx=Math.max(-MAX,Math.min(MAX,(e.clientX-(r.left+r.width/2))/8));
    const dy=Math.max(-MAX,Math.min(MAX,(e.clientY-(r.top+r.height/2))/8));
    b.classList.add('magnet'); b.style.transform=`translate(${dx}px,${dy}px)`;
  },{passive:true});
  document.addEventListener('pointerleave',()=>{document.querySelectorAll('.btn.primary.magnet').forEach(el=>{el.style.transform='';el.classList.remove('magnet')})},true);
  // Spotlight: a soft radial follow on the tab header only (one strip, not the whole app).
  document.addEventListener('pointermove',e=>{
    const h=e.target.closest?.('.tab-head');
    if(!h) return;
    const r=h.getBoundingClientRect();
    h.style.setProperty('--mx',((e.clientX-r.left)/r.width*100)+'%');
    h.style.setProperty('--my',((e.clientY-r.top)/r.height*100)+'%');
  },{passive:true});
})();

// ===== BOOT SEQUENCE (1.3.0) =====
// Short 'signal acquisition' on launch. It NEVER blocks work: it fades itself out on a timer and
// on the first real interaction, whichever comes first. State class is seeded here so the ambient
// field starts cold before the first server:state event arrives.
// BOOT (reworked 1.3.0): a real startup screen driven by ACTUAL progress. The main boot IIFE
// (below) calls bootStep() at each milestone and bootFinish() when state is ready. A safety
// timeout and click/key skip guarantee it never traps the user.
let _bootDone=false,_bootSafety=null,_bootTarget=0,_bootShown=0,_bootRaf=0,_bootCreep=0;
// Progress model: bootStep() sets a TARGET %. A rAF loop eases the visible width toward it, and a
// slow 'creep' keeps it inching forward between milestones so the bar never looks frozen while a
// network call (market versions) is in flight. bootFinish() snaps the creep off and goes to 100.
function _bootPaint(){
  const bar=$('#bootBarFill'); if(!bar) return;
  const goal=_bootDone?100:_bootTarget;
  _bootShown += (goal-_bootShown)*0.18;
  if(!_bootDone) _bootShown += _bootCreep; // gentle auto-advance between real steps
  if(_bootShown>99.4 && !_bootDone) _bootShown=99.4; // never 100% until actually done
  bar.style.width=_bootShown.toFixed(2)+'%';
  if(Math.abs(goal-_bootShown)>0.1 || (!_bootDone && _bootShown<99.4)) _bootRaf=requestAnimationFrame(_bootPaint);
  else _bootRaf=0;
}
function _bootKick(){ if(!_bootRaf) _bootRaf=requestAnimationFrame(_bootPaint); }
function bootStep(pct,statusKey){
  if(_bootDone) return;
  _bootTarget=Math.min(99,Math.max(_bootTarget,Number(pct)||0));
  // Creep slows as we approach the target band so it never races ahead of real work.
  _bootCreep=Math.max(0.02,(99-_bootTarget)/900);
  const st=$('#bootStatus'); if(st&&statusKey) st.textContent=t(statusKey);
  _bootKick();
}
function bootFinish(){
  if(_bootDone) return; _bootDone=true; clearTimeout(_bootSafety);
  const st=$('#bootStatus'); if(st) st.textContent=t('boot.ready');
  _bootKick();
  setTimeout(()=>{ const seq=$('#bootSeq'); if(seq){ seq.classList.add('done'); setTimeout(()=>seq.remove(),520); } },260);
  document.removeEventListener('pointerdown',_bootSkip); document.removeEventListener('keydown',_bootSkip);
}
function _bootSkip(){ bootFinish(); }
(function bootSequence(){
  document.documentElement.classList.add('is-offline');
  const seq=$('#bootSeq'); if(!seq) return;
  if(_rm.matches){ seq.remove(); _bootDone=true; return; }
  bootStep(12,'boot.init');
  document.addEventListener('pointerdown',_bootSkip,{once:true});
  document.addEventListener('keydown',_bootSkip,{once:true});
  // Safety: never let the screen hang if a backend call stalls.
  _bootSafety=setTimeout(bootFinish,4000);
})();

// 5.2.0: 'Interface animation' now follows the SAME edit -> Apply flow as every other setting. It
// used to live-apply on change (changing the UI before the user hit Apply), which was inconsistent
// and confusing. It is applied when Apply runs refreshUI() -> applyMotionLevel(state.settings...).

// 4.5.0: shuffle the active instance's avatar art (random seed) and repaint the Settings preview.
$('#instShuffleArt')?.addEventListener('click',()=>{ setInstanceAppearance({artSeed:Math.floor(Math.random()*100000)}); });

// ===== CURSOR PROXIMITY (1.3.0, signature) =====
// Rail items brighten as the pointer approaches — an 'instrument feels responsive' cue. Uses a
// rAF-throttled mousemove; cheap (a handful of items). Disabled under reduced motion.
(function cursorProximity(){
  const nav=$('#nav'); if(!nav||_rm.matches) return;
  // Instance rows join the same proximity field as the nav items so the whole rail feels alive.
  const itemsOf=()=>[...$$('#nav .nav-item'),...$$('#instanceItems .inst-item')];
  let raf=0,lastX=0,lastY=0;
  const apply=()=>{ raf=0;
    for(const it of itemsOf()){
      const r=it.getBoundingClientRect();
      const cx=r.left+r.width/2, cy=r.top+r.height/2;
      const d=Math.hypot(lastX-cx,lastY-cy);
      const t=Math.max(0,1-d/220); // 0 beyond 220px, 1 on the item
      it.style.setProperty('--prox',t.toFixed(3));
    }
  };
  document.addEventListener('pointermove',e=>{ lastX=e.clientX; lastY=e.clientY; if(!raf) raf=requestAnimationFrame(apply); },{passive:true});
})();
