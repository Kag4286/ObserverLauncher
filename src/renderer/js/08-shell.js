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
  while(logQueue.length && added<80){
    const line=logQueue.shift();
    const d=document.createElement('div'), level=logLevel(line);
    d.className=`log-line ${line.type||''}${sweep?' sweep':''}`; d.dataset.level=level;
    d.dataset.text=String(line.text||'').slice(0,2000); // search index (trimmed to keep the DOM lean)
    d.innerHTML=`<span class="lvl">${LOG_BADGE[level]||'INF'}</span><span class="time">${esc(line.time)}</span> ${esc(line.text)}`;
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
  for(const line of arr){
    const d=document.createElement('div'), level=logLevel(line);
    d.className=`log-line ${line.type||''}`; d.dataset.level=level;
    d.dataset.text=String(line.text||'').slice(0,2000);
    d.innerHTML=`<span class="lvl">${LOG_BADGE[level]||'INF'}</span><span class="time">${esc(line.time)}</span> ${esc(line.text)}`;
    if(!logVisible(level,line.text)) d.hidden=true;
    frag.appendChild(d);
  }
  o.classList.add('has-content'); o.appendChild(frag);
  o.scrollTop=o.scrollHeight;
}
// B4: rebuild the chart ring from the active instance's sampled history after a switch.
function rebuildSamples(history){
  const arr=(Array.isArray(history)?history:[]).slice(-38);
  samples=arr.map(s=>({tps:s.tps??null,mspt:s.mspt??null,cpu:s.cpu??null,ram:s.ram??null}));
  while(samples.length<38) samples.unshift({tps:null,mspt:null,cpu:null,ram:null});
  try{ drawOvSpark(); }catch{}
  try{ metricChart($('#miniChart')); metricChart($('#perfTickChart'),true,'tick'); metricChart($('#perfResourceChart'),true,'resource'); }catch{}
}
const channelOrder=['overview','console','players','performance','content','marketplace','worlds','properties'];
function positionChannelIndicator(){const nav=$('#nav'),ind=$('#channelIndicator');if(!nav||!ind)return;const active=nav.querySelector('.nav-item.active');if(!active){ind.style.opacity='0';return} // rail is vertical — indicator is left border via CSS, no horizontal calc needed
  ind.style.opacity='0'; }
let lastTabIdx=0;
function switchTab(tab){
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
  if(tab==='performance'){window.observer.getFiles().then(r=>{if(r.ok){state.files=r.files;state.javaRequired=r.javaRequired??state.javaRequired;renderPerfDiagnostics()}}); requestAnimationFrame(()=>{ requestAnimationFrame(()=>{ try{metricChart($('#perfTickChart'),true,'tick'); metricChart($('#perfResourceChart'),true,'resource'); metricChart($('#miniChart'));}catch{}})}); }
  // Sparkline was 0-sized while Overview was hidden — redraw on reveal (same class of bug as
  // the hidden world-map canvas). Two rAFs so layout has settled after the tab becomes visible.
  if(tab==='overview')requestAnimationFrame(()=>requestAnimationFrame(()=>{try{drawOvSpark()}catch{}}));
  if(tab==='players')window.observer.getFiles().then(r=>{if(r.ok){state.files=r.files;state.javaRequired=r.javaRequired??state.javaRequired;renderPlayers()}});
  if(tab==='content')window.observer.getFiles().then(r=>{if(r.ok){state.files=r.files;state.javaRequired=r.javaRequired??state.javaRequired;refreshUI()}});
  // World Map loads lazily HERE (single choke point) — 02-worldmap.js must not
  // hook switchTab itself: it evaluates before this file, so capturing
  // switchTab there throws and leaves the tab blank with dead Reload buttons.
  if(tab==='worldmap'&&typeof wmLoad==='function')wmLoad().catch(e=>toast(`World Map failed to load: ${e?.message||e}`,'error'));
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
function renderInstanceList(){
  const wrap=$('#instanceList'),host=$('#instanceItems');
  if(!wrap||!host)return;
  const list=Array.isArray(state.instances)?state.instances:[];
  wrap.hidden=list.length===0;
  if(list.length===0)return;
  const activeId=state.activeInstanceId||(list[0]&&list[0].id);
  host.innerHTML='';
  list.forEach((inst,idx)=>{
    const isActive=inst.id===activeId;
    const st=instanceDotStatus(inst.id,activeId);
    // A div (not a button) so the rename/remove icon buttons can live INSIDE it without nesting
    // <button> elements (invalid HTML). Click anywhere on the row switches; the icons stopPropagation.
    const row=document.createElement('div');
    row.className='inst-item'+(isActive?' active':'');
    row.dataset.instance=inst.id;
    row.setAttribute('role','listitem');
    row.tabIndex=0;
    row.title=t('inst.switchTip');
    // Stagger reveal: same cadence as tab-content rows (--stagger per index, capped so a long
    // list never waits). Re-runs on every render, so add/remove/switch animates.
    row.style.animationDelay=(idx*28)+'ms';
    row.innerHTML='<span class="inst-dot st-'+st+'"></span>'
      +'<span class="inst-name">'+esc(inst.name||inst.serverPath||'Server')+'</span>'
      +'<span class="inst-acts">'
        +'<button type="button" class="inst-act" data-act="rename" title="'+esc(t('inst.rename'))+'" aria-label="'+esc(t('inst.rename'))+'">✎</button>'
        +'<button type="button" class="inst-act" data-act="remove" title="'+esc(t('inst.remove'))+'" aria-label="'+esc(t('inst.remove'))+'">✕</button>'
      +'</span>';
    row.onclick=e=>{ if(e.target.closest('.inst-act'))return; switchInstance(inst.id); };
    row.onkeydown=e=>{ if((e.key==='Enter'||e.key===' ')&&!e.target.closest('.inst-act')){e.preventDefault();switchInstance(inst.id);} };
    row.querySelector('[data-act="rename"]').onclick=e=>{e.stopPropagation();renameInstancePrompt(inst)};
    row.querySelector('[data-act="remove"]').onclick=e=>{e.stopPropagation();removeInstancePrompt(inst)};
    host.appendChild(row);
  });
  renderInstanceDropdown(list, activeId);
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
    b.innerHTML='<span class="inst-dot st-'+st+'"></span><span class="inst-name">'+esc(inst.name||inst.serverPath||'Server')+'</span>';
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
  const name=window.prompt(t('inst.rename'),current);
  if(name===null)return;
  const trimmed=String(name).trim();
  if(!trimmed||trimmed===current)return;
  let r; try{ r=await window.observer.instanceRename({id:inst.id,name:trimmed}); }catch(e){ return toast(e?.message||'Rename failed.','error'); }
  if(!r||!r.ok)return toast((r&&r.error)||'Rename failed.','error');
  const next=(state.instances||[]).map(i=>i.id===inst.id?{...i,name:r.name}:i);
  state={...state,instances:next};refreshUI();
}
// Remove an instance from the LIST ONLY (never deletes the folder). Refuses while it is running.
async function removeInstancePrompt(inst){
  if(inst.id===state.activeInstanceId && state.status!=='stopped')return toast(t('inst.stopFirst'),'error');
  const ok=await confirmDialog({title:t('inst.remove'),body:esc(t('inst.removeConfirm',{n:inst.name||inst.serverPath||'Server'})),ok:t('inst.remove'),danger:true});
  if(!ok)return;
  let r; try{ r=await window.observer.instanceRemove(inst.id); }catch(e){ return toast(e?.message||'Remove failed.','error'); }
  if(!r||!r.ok)return toast((r&&r.error)||'Remove failed.','error');
  try{ const s=await window.observer.getState(); state={...state,...s}; }catch{}
  refreshUI();
}
// Switch the active instance: the backend re-seeds ctx and repoints the runtime folder, then we
// re-pull the whole snapshot so console/metrics/files/settings all reflect the new instance.
async function switchInstance(id){
  if(!id||id===state.activeInstanceId)return;
  let r;
  try{ r=await window.observer.instanceSwitch(id); }
  catch(e){ return toast(e?.message||'Could not switch instance.','error'); }
  if(!r||!r.ok)return toast((r&&r.error)||'Could not switch instance.','error');
  try{ const s=await window.observer.getState(); state={...state,...s}; }catch{}
  // Repaint the active instance's console + chart immediately (server:metrics/log are gated in
  // the main process, so a background instance's old lines would otherwise stay on screen).
  repaintConsole(state.logs);
  rebuildSamples(state.metricsHistory);
  refreshUI();
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
  try{ const s=await window.observer.getState(); state={...state,...s}; }catch{}
  repaintConsole(state.logs);
  rebuildSamples(state.metricsHistory);
  refreshUI();
  toast(t('inst.added'),'success');
  return add.id;
}
async function command(c){if(!c.trim())return;if(/[\r\n]/.test(c))return toast(t('toast.cmdInvalid'));const r=await window.observer.command(c);if(!r.ok)toast(r.error)}
let cmdHistory=[],cmdHistoryIdx=-1;
function pushCmdHistory(c){c=c.trim();if(!c)return;cmdHistory=cmdHistory.filter(x=>x!==c);cmdHistory.unshift(c);if(cmdHistory.length>8)cmdHistory.length=8;cmdHistoryIdx=-1;renderRecentCommands()}
function renderRecentCommands(){const wrap=$('#recentCommands'),group=$('#recentCommandsGroup');if(!wrap||!group)return;if(!cmdHistory.length){group.hidden=true;return}group.hidden=false;wrap.innerHTML='';cmdHistory.forEach(c=>{const b=document.createElement('button');b.textContent=c;b.title=c;b.onclick=()=>command(c);wrap.append(b)})}
async function chooseFolder(opts){const f=await window.observer.pickFolder(opts);if(f){const next={...getSettings(),serverPath:f};const r=await window.observer.saveSettings(next);if(!r.ok){toast(r.error,'error');return null}state={...state,settings:next,java:r.java,files:r.files,eulaAccepted:r.eulaAccepted,javaRequired:r.javaRequired??state.javaRequired,mcp:r.mcp??state.mcp};propsDirty=false;markSettingsSaved();refreshUI();loadConnectInfo();toast(t('toast.folderSaved'))}return f}
$$('.nav-item').forEach(b=>b.onclick=()=>switchTab(b.dataset.tab));
$('#nav')?.addEventListener('keydown', e=>{
  const items=[...$$('.nav-item')]; const idx=items.indexOf(document.activeElement);
  if(e.key==='ArrowDown' || e.key==='ArrowRight'){ e.preventDefault(); items[(idx+1)%items.length]?.focus(); }
  else if(e.key==='ArrowUp' || e.key==='ArrowLeft'){ e.preventDefault(); items[(idx-1+items.length)%items.length]?.focus(); }
  else if(e.key==='Home'){ e.preventDefault(); items[0]?.focus(); }
  else if(e.key==='End'){ e.preventDefault(); items[items.length-1]?.focus(); }
});
$$('[data-tab-jump]').forEach(b=>b.onclick=()=>switchTab(b.dataset.tabJump));$$('[data-market-jump]').forEach(b=>b.onclick=()=>jumpToMarket(b.dataset.marketJump));$$('[data-command]').forEach(b=>b.onclick=()=>{pushCmdHistory(b.dataset.command);command(b.dataset.command)});$$('[data-open]').forEach(b=>b.onclick=()=>window.observer.openFiles(b.dataset.open));$$('[data-import]').forEach(b=>b.onclick=async()=>{const r=await window.observer.importContent(b.dataset.import);if(r.ok){state.files=r.files;refreshUI();toast(t('toast.importedRestart'))}else if(!r.cancelled)toast(r.error)});
$('#chooseFolder').onclick=chooseFolder;$('#browseBtn').onclick=chooseFolder;$('#addExistingBtn')?.addEventListener('click',addExistingInstance);$('#welcomeCreateBtn')?.addEventListener('click',()=>openNewServerWizard());$('#exportConsole').onclick=async()=>{const btn=$('#exportConsole');const orig=btn.textContent;btn.disabled=true;try{const r=await window.observer.exportConsole();if(r.cancelled)return;if(!r.ok)return toast(r.error,'error');toast(t('con.exported',{n:r.count}),'success')}catch(e){toast(e?.message||t('con.exportFailed'),'error')}finally{btn.disabled=false;btn.textContent=orig}};$('#clearConsole').onclick=()=>{const o=$('#logOutput');o.innerHTML=`<div class="log-empty" id="logEmpty"><b>${t('con.empty')}</b><span>${t('con.emptySub')}</span></div>`;o.classList.remove('has-content');const j=$('#logJump');if(j)j.hidden=true;const s=$('#logSearch');if(s){s.value='';const sc=$('#logSearchClear');if(sc)sc.hidden=true}logQuery='';updateLogHint()};$('#commandForm').onsubmit=async e=>{e.preventDefault();const v=$('#commandInput').value;pushCmdHistory(v);await command(v);$('#commandInput').value=''};
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
$('#saveSettings').onclick=async()=>{
  const next=getSettings();
  const folderInput=$('#serverFolderInput'), javaInput=$('#javaPathInput');
  if(folderInput) folderInput.style.borderColor='';
  if(javaInput) javaInput.style.borderColor='';
  if(!next.serverPath){ if(folderInput){ folderInput.style.borderColor='var(--danger)'; folderInput.focus(); } return toast(t('set.errFolderReq'),'error'); }
  if(next.memoryMax < next.memoryMin) return toast(t('set.errMemOrder'),'error');
  if(next.memoryMax>32) return toast(t('set.errMemHigh'),'error');
  if(next.memoryMin<1) return toast(t('set.errMemMin'),'error');
  if(next.jvmArgs && next.jvmArgs.length>2000) return toast(t('set.errJvmLong'),'error');
  if(next.jvmArgs && /["'<>|]/.test(next.jvmArgs)) return toast(t('set.errJvmChars'),'error');
  if(state.java?.arch==='32-bit' && next.memoryMax>2) return toast(t('set.errJava32'),'error');
  const r=await window.observer.saveSettings(next);
  if(!r.ok) return toast(r.error,'error');
  if(!r.java?.ok && next.javaPath){ if(javaInput){ javaInput.style.borderColor='var(--danger)'; javaInput.focus(); } return toast(`Java not found at "${next.javaPath}" — ${r.java?.message||'check the path or use auto-install.'}`,'error'); }
  state={...state,settings:next,java:r.java,files:r.files,eulaAccepted:r.eulaAccepted,javaRequired:r.javaRequired??state.javaRequired,mcp:r.mcp??state.mcp};propsDirty=false;markSettingsSaved();refreshUI();
  if(r.mcp&&r.mcp.running)toast(t('mcp.running',{p:r.mcp.port}),'success');
  toast(r.java?.ok?t('toast.settingsSavedJava',{v:r.java.version}):t('toast.settingsSavedNoJava'),'success');
};
$('#saveRamOverview').onclick=async()=>{
  const next=getSettings();
  if(next.memoryMax<next.memoryMin)return toast(t('set.errMemOrder'),'error');
  const r=await window.observer.saveSettings(next);state={...state,settings:next,java:r.java,files:r.files,eulaAccepted:r.eulaAccepted,javaRequired:r.javaRequired??state.javaRequired};markSettingsSaved();refreshUI();toast(t('toast.ramSaved'),'success');
};
$('#languageSelect').onchange=async()=>{currentLocale=$('#languageSelect').value;applyLocale();const next={...getSettings(),locale:currentLocale};const r=await window.observer.saveSettings(next);state.settings=next;state.java=r.java;markSettingsSaved();refreshUI();renderJvmPreview();if(!$('#newServerModal').hidden)nswRender();if(!$('#installModal').hidden){imRenderCompat();imRenderWarns()}};
// Performance tab: offline banner CTA reuses the main Start button so there is
// exactly one start path (same guards, same toasts, no duplicated logic).
$('#perfStartBtn')?.addEventListener('click',()=>$('#startBtn')?.click());
// Properties tab (search/filter/save) moved to 10-properties.js.
$('#createBackup').onclick=async()=>{if(!await confirmDialog({title:t('wld.backupsT'),body:t('toast.confirmBackup'),ok:t('wld.create')}))return;const r=await window.observer.createBackup();if(r.ok){state.files=r.files;refreshUI();toast(`Backup created: ${r.name}`)}else toast(r.error)};
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
$('#startBtn').onclick=async()=>{let r;try{r=await window.observer.start(getSettings())}catch(e){toast(`Start failed: ${e?.message||e}`,'error');return}if(!r||!r.ok){toast((r&&r.error)||t('toast.startUnknown'),'error');if(r&&r.error&&r.error.includes('Java')){switchTab('overview');const jw=$('#javaWarnBanner');if(jw&&!jw.hidden)jw.scrollIntoView({behavior:'smooth',block:'center'})}}else toast(t('toast.startRequested'))};$('#stopBtn').onclick=async()=>{let r;try{r=await window.observer.stop()}catch(e){toast(`Stop failed: ${e?.message||e}`,'error');return}if(!r.ok)toast(r.error)};
$('#forceStopBtn').onclick=async()=>{if(!await confirmDialog({title:t('top.forceStop'),body:t('top.forceStopConfirm'),ok:t('top.forceStop'),danger:true}))return;let r;try{r=await window.observer.forceStop()}catch(e){toast(`Force stop failed: ${e?.message||e}`,'error');return}if(!r||!r.ok)toast((r&&r.error)||'Force stop failed.','error');else toast(t('toast.forceStopped'),'success')};
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
window.observer.onLive(v=>{state.live=v; applyLiveToUI(v);
  const key=(v.players||[]).slice().sort().join(',');if(key!==lastLivePlayersKey){lastLivePlayersKey=key;try{renderPlayers()}catch{}}
});window.observer.onMetrics(v=>{lastMetrics=v; state.live = {...state.live, tps:v.tps??state.live?.tps??null, mspt:v.mspt??state.live?.mspt??null, players:v.players??state.live?.players??[]}; const displayTps = v.tps ?? state.live?.tps ?? null; const displayMspt = v.mspt ?? state.live?.mspt ?? null; const limitGB=state.settings.memoryMax||6;const usedGB=(v.serverMemory||0)/1024;const ram=v.running?Math.min(100,Math.round((v.serverMemory||0)/Math.max(1,limitGB*1024)*100)):null;samples=[...samples.slice(1),{tps:displayTps,mspt:v.running?(displayMspt):null,cpu:v.running?(v.cpu??null):null,ram}]; try{drawOvSpark();}catch{} try{$('#appMemory').textContent=`${v.appMemory||0} MB`;}catch{} const ramLabel=v.running?`${usedGB.toFixed(1)} / ${limitGB} GB`:'—'; try{$('#perfServerRam').textContent=ramLabel;}catch{} try{$('#serverRam').textContent=ramLabel;}catch{} try{const c=$('#overviewCpu');if(c){if(v.running)tweenNumber(c,v.cpu||0,x=>Math.round(x)+'%');else c.textContent='—';}}catch{} try{const c=$('#perfCpu');if(c){if(v.running)tweenNumber(c,v.cpu||0,x=>Math.round(x)+'%');else c.textContent='—';}}catch{} try{const pc=$('#playerCount');if(pc){if(v.running)tweenNumber(pc,(v.players||[]).length);else pc.textContent='—';}}catch{} try{$('#tps').textContent=displayTps?.toFixed?.(2)??'—';}catch{} try{$('#perfTps').textContent=displayTps?.toFixed?.(2)??'—';}catch{}
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
  metricChart($('#miniChart'));metricChart($('#perfTickChart'),true,'tick');metricChart($('#perfResourceChart'),true,'resource')});
 // Fallback: nếu main gửi chậm hoặc miss, vẫn giữ UI đồng bộ mỗi 2s từ lastMetrics/live
 setInterval(()=>{ try{ if(lastMetrics){ const v=lastMetrics; const displayTps=v.tps??state.live?.tps??null; const displayMspt=v.mspt??state.live?.mspt??null; if(displayTps!=null){ const el=$('#tps'); if(el && el.textContent==='—') el.textContent=displayTps.toFixed(2); const el2=$('#perfTps'); if(el2 && el2.textContent==='—') el2.textContent=displayTps.toFixed(2); } if(displayMspt!=null){ const el=$('#perfMspt'); if(el && el.textContent==='—') el.textContent=displayMspt.toFixed(2); } } }catch{} }, 2500);
 // Redraw charts định kỳ khi tab performance đang mở (fix canvas 0x0 khi tab hidden lúc metrics đến)
 setInterval(()=>{ try{ if(document.getElementById('performance')?.classList.contains('active')){ metricChart($('#perfTickChart'),true,'tick'); metricChart($('#perfResourceChart'),true,'resource'); } }catch{} }, 2000);
// FEATURE: Aikar's flags preset (a widely recommended JVM/G1GC config for Paper/Purpur servers),
// auto-filled from the current memoryMin/memoryMax instead of making the user type the long flag string.
function aikarFlags(minGB,maxGB){return `-Xms${minGB}G -Xmx${maxGB}G -XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200 -XX:+UnlockExperimentalVMOptions -XX:+DisableExplicitGC -XX:+AlwaysPreTouch -XX:G1NewSizePercent=30 -XX:G1MaxNewSizePercent=40 -XX:G1HeapRegionSize=8M -XX:G1ReservePercent=20 -XX:G1HeapWastePercent=5 -XX:G1MixedGCCountTarget=4 -XX:InitiatingHeapOccupancyPercent=15 -XX:G1MixedGCLiveThresholdPercent=90 -XX:G1RSetUpdatingPauseTimePercent=5 -XX:SurvivorRatio=32 -XX:+PerfDisableSharedMem -XX:MaxTenuringThreshold=1 -Dusing.aikars.flags=https://mcflags.emc.gs -Dfile.encoding=UTF-8`}
$('#applyAikarFlags').onclick=()=>{const min=Number($('#memoryMinInput').value)||2,max=Number($('#memoryMaxInput').value)||6;$('#jvmArgsInput').value=aikarFlags(min,max);toast(t('set.aikarFilled'))};
$('#showWelcomeAgain').onclick=()=>showOnboarding();

// FEATURE: "How friends can join" — surfaces the LAN address (instant, no network call) and lets the
// user look up their public IP on demand. Both are just the IP; the port is read from server.properties
// (or the Velocity default) so the whole thing stays correct if the user changes server-port.
let launcherPlatform='win32';
async function loadConnectInfo(){
  const r=await window.observer.networkInfo();if(!r.ok)return;
  const port=r.port;
  launcherPlatform=r.platform||'win32';
  $('#connectLocal').value=r.localIps.length?r.localIps.map(ip=>`${ip}:${port}`).join(', '):t('conn.noLan');
  $('#allowFirewall').dataset.port=port;
  // Linux cannot auto-open the firewall without sudo; relabel the button so it copies the command.
  const fw=$('#allowFirewall'); if(fw){ fw.textContent = launcherPlatform==='linux' ? t('conn.copyFwCmd') : t('conn.firewall'); }
}

$('#tunnelStart').onclick=async()=>{if(!await confirmDialog({title:t('tun.start'),body:t('tun.confirm'),ok:t('tun.start'),danger:true}))return;const r=await window.observer.tunnelStart('playit');if(!r.ok)return toast(r.error,'error');toast(t('tun.started'),'success')};
$('#tunnelDashboard').onclick=()=>window.observer.tunnelOpenUrl('https://playit.gg/account/tunnels');
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
function showOnboarding(){$('#onboardingModal').hidden=false}
function hideOnboarding(){$('#onboardingModal').hidden=true}
async function markOnboarded(){await window.observer.onboardingComplete();state.settings={...state.settings,onboarded:true}}
// BUGFIX: this modal had no way to dismiss it besides picking one of the 3 onboarding choices — fine
// on a genuinely first run, but "Show welcome guide again" (Settings) reopens this same modal on an
// ALREADY-configured install, and there was no way back out except re-running one of those 3 actions.
// A close (×) button, Escape, and clicking the dimmed backdrop now all dismiss any open modal — added
// once, generically, so this can't quietly happen again for a future modal either.
$('#onboardingClose').onclick=()=>hideOnboarding();
$('#obSkip').onclick=async()=>{hideOnboarding();await markOnboarded()};
$('#obPickExisting').onclick=async()=>{hideOnboarding();await markOnboarded();await addExistingInstance()};
$('#obCreateNew').onclick=async()=>{
  // The wizard's step 1 picks the folder and creates a NEW instance for it — do NOT run
  // chooseFolder here: that would save serverPath onto the currently-active instance.
  hideOnboarding();await markOnboarded();
  openNewServerWizard();
};

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
function closeOverlayAnimated(el){ el.classList.add('closing'); el.hidden=true; setTimeout(()=>el.classList.remove('closing'),220); }
document.addEventListener('keydown',e=>{if(e.key==='Escape'){const open=$$('.modal-overlay').find(m=>!m.hidden);if(open&&!modalBusy(open)){ if(open.id==='playerInspectModal') closePlayerInspectModal(); else closeOverlayAnimated(open); }}});
$$('.modal-overlay').forEach(overlay=>overlay.addEventListener('click',e=>{if(e.target===overlay&&!modalBusy(overlay)){ if(overlay.id==='playerInspectModal') closePlayerInspectModal(); else closeOverlayAnimated(overlay); }}));

(async()=>{const langSel=$('#languageSelect');if(langSel&&window.LOCALES_META)langSel.innerHTML=window.LOCALES_META.map(l=>`<option value="${esc(l.code)}">${esc(l.name)}</option>`).join('');
let initial;try{initial=await window.observer.getState()}catch(e){toast(`Could not load launcher state: ${e?.message||e}`,'error');return}state={...state,...initial};addLogsBatch(initial.logs||[]);refreshUI();loadConnectInfo();bootStep(65,'boot.state');if(!state.settings?.onboarded)showOnboarding();
// BUGFIX (Start dead on launch): if this first snapshot raced backend init and
// came back without Java/files, re-sync once the backend has settled instead
// of leaving Start disabled until the next folder save.
if(!initial.java?.ok||!initial.files?.jar&&!initial.files?.launchScript){setTimeout(async()=>{try{const s2=await window.observer.getState();state={...state,...s2};const f2=await window.observer.getFiles();if(f2&&f2.ok){state.files=f2.files;state.javaRequired=f2.javaRequired??state.javaRequired}refreshUI()}catch{}},2500);}
// BUGFIX: the native min/max/close caption buttons overlay the top-right of the page and used to
// cover the server-path text in the command bar. Detect the Window Controls Overlay and flag it so
// CSS can reserve its width (.wco-app rules in style.css).
try{const wco=navigator.windowControlsOverlay;if(wco){const sync=()=>document.documentElement.classList.toggle('wco-app',!!wco.visible);sync();wco.addEventListener('geometrychange',sync);}}catch{}
bootStep(85,'boot.market');const v=window.observer.isE2E?{ok:false}:await window.observer.marketVersions();if(v.ok)$('#marketVersion').innerHTML='<option value="">All versions</option>'+v.versions.map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join('');requestAnimationFrame(positionChannelIndicator);window.addEventListener('resize',()=>{metricChart($('#miniChart'));metricChart($('#perfTickChart'),true,'tick');metricChart($('#perfResourceChart'),true,'resource');positionChannelIndicator();bootFinish()})})();

// ===== AUTO-UPDATE UI =====
const updateBtn=$('#checkUpdateBtn');
// BUGFIX: every update call is now awaited and its {ok:false} / thrown error is shown, and the
// status text resets to a retryable state instead of sticking on "Checking…" after a failure.
if(updateBtn)updateBtn.onclick=async()=>{
  const st=$('#updateStatus');
  if(st)st.textContent=t('upd.checking');
  try{const r=await window.observer.checkUpdate();if(r&&!r.ok&&st)st.textContent=r.error||t('upd.none');}catch(e){if(st)st.textContent=e?.message||String(e);}
};
window.observer.onUpdateAvailable(v=>{const st=$('#updateStatus');if(st)st.innerHTML=t('upd.available',{v:v.version})+' <button class="btn primary sm" id="dlBtn">'+t('upd.download')+'</button>';const b=$('#dlBtn');if(b)b.onclick=async()=>{const s=$('#updateStatus');try{const r=await window.observer.downloadUpdate();if(r&&!r.ok&&s)s.textContent=r.error||'Download failed.';}catch(e){if(s)s.textContent=e?.message||String(e);}};});
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
window.observer.onMcpConfirmRequest?.(req => {
  if(!req||!req.reqId)return;
  const riskLabel=req.risk==='destroy'?t('mcp.riskDestroy'):t('mcp.riskWrite');
  let argText='';
  try{argText=JSON.stringify(req.args||{},null,2)}catch{argText=''}
  // Truncate the preview so a 2MB write_file payload does not blow up the dialog DOM.
  if(argText.length>2000)argText=argText.slice(0,2000)+'\n… ('+(argText.length-2000)+' more chars)';
  const body=(req.risk==='destroy'?t('mcp.confirmDestroy'):t('mcp.confirmWrite',{t:req.tool}))
    +`\n\n`+t('mcp.tool')+`: `+req.tool+`  ·  `+t('mcp.risk')+`: `+riskLabel
    +(argText&&argText!=='{}'?`\n\n`+t('mcp.args')+`:\n`+argText:'');
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

// Live-apply the 'Interface animation' setting the moment it changes (no need to hit Apply for
// a purely visual preference). Persisted on the next settings save like every other field.
$('#motionLevelSelect')?.addEventListener('change',e=>{ try{ applyMotionLevel(e.target.value); }catch{} });

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
