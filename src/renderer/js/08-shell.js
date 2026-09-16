// js/08-shell.js — split from app.js (lines 1127-1704); classic script, load in numeric order.
// app shell: console logs, tabs/nav, all DOM wiring, wizard, boot.
function logLevel(line){if(line.type==='error')return'error';if(line.type==='command')return'command';if(line.type==='system')return'system';const t=line.text||'';if(/\]:\s*\[?WARN/i.test(t)||/\/WARN\]/i.test(t)||/^WARNING:/i.test(t.trim()))return'warn';if(/\/ERROR\]/i.test(t)||/\/SEVERE\]/i.test(t))return'error';return'info'}
let logFilter='all',logPaused=false;
let logQueue=[], logFlushScheduled=false;
function flushLogs(){
  const o=$('#logOutput'); if(!o || !logQueue.length){ logFlushScheduled=false; return; }
  const wasAtBottom=o.scrollHeight - o.scrollTop - o.clientHeight < 40;
  const frag=document.createDocumentFragment();
  let added=0, lastVisible=null;
  while(logQueue.length && added<80){
    const line=logQueue.shift();
    const d=document.createElement('div'), level=logLevel(line);
    d.className=`log-line ${line.type||''}`; d.dataset.level=level;
    d.innerHTML=`<span class="time">${esc(line.time)}</span> ${esc(line.text)}`;
    if(logFilter!=='all'&&level!==logFilter) d.hidden=true; else lastVisible=d;
    frag.appendChild(d); added++;
  }
  o.classList.add('has-content'); o.appendChild(frag);
  const empty=$('#logEmpty'); if(empty) empty.hidden=true;
  while(o.children.length>2000) o.removeChild(o.firstChild);
  if(wasAtBottom && !logPaused) o.scrollTop=o.scrollHeight;
  else if(lastVisible && !lastVisible.hidden){ const j=$('#logJump'); if(j) j.hidden=false; }
  if(logQueue.length) requestAnimationFrame(flushLogs); else logFlushScheduled=false;
}
function addLog(line){ logQueue.push(line); if(!logFlushScheduled){ logFlushScheduled=true; requestAnimationFrame(flushLogs); } }
function addLogsBatch(lines){ if(!lines||!lines.length) return; logQueue.push(...lines); if(!logFlushScheduled){ logFlushScheduled=true; requestAnimationFrame(flushLogs); } }
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
  if(tab==='players')window.observer.getFiles().then(r=>{if(r.ok){state.files=r.files;state.javaRequired=r.javaRequired??state.javaRequired;renderPlayers()}});
  if(tab==='content')window.observer.getFiles().then(r=>{if(r.ok){state.files=r.files;state.javaRequired=r.javaRequired??state.javaRequired;refreshUI()}});
  // World Map loads lazily HERE (single choke point) — 02-worldmap.js must not
  // hook switchTab itself: it evaluates before this file, so capturing
  // switchTab there throws and leaves the tab blank with dead Reload buttons.
  if(tab==='worldmap'&&typeof wmLoad==='function')wmLoad().catch(e=>toast(`World Map failed to load: ${e?.message||e}`,'error'));
}
async function command(c){if(!c.trim())return;if(/[\r\n]/.test(c))return toast('Invalid command — single line only.');const r=await window.observer.command(c);if(!r.ok)toast(r.error)}
let cmdHistory=[],cmdHistoryIdx=-1;
function pushCmdHistory(c){c=c.trim();if(!c)return;cmdHistory=cmdHistory.filter(x=>x!==c);cmdHistory.unshift(c);if(cmdHistory.length>8)cmdHistory.length=8;cmdHistoryIdx=-1;renderRecentCommands()}
function renderRecentCommands(){const wrap=$('#recentCommands'),group=$('#recentCommandsGroup');if(!wrap||!group)return;if(!cmdHistory.length){group.hidden=true;return}group.hidden=false;wrap.innerHTML='';cmdHistory.forEach(c=>{const b=document.createElement('button');b.textContent=c;b.title=c;b.onclick=()=>command(c);wrap.append(b)})}
async function chooseFolder(opts){const f=await window.observer.pickFolder(opts);if(f){const next={...getSettings(),serverPath:f};const r=await window.observer.saveSettings(next);state={...state,settings:next,java:r.java,files:r.files,eulaAccepted:r.eulaAccepted,javaRequired:r.javaRequired??state.javaRequired};propsDirty=false;markSettingsSaved();refreshUI();loadConnectInfo();toast(t('toast.folderSaved'))}return f}
$$('.nav-item').forEach(b=>b.onclick=()=>switchTab(b.dataset.tab));
$('#nav')?.addEventListener('keydown', e=>{
  const items=[...$$('.nav-item')]; const idx=items.indexOf(document.activeElement);
  if(e.key==='ArrowDown' || e.key==='ArrowRight'){ e.preventDefault(); items[(idx+1)%items.length]?.focus(); }
  else if(e.key==='ArrowUp' || e.key==='ArrowLeft'){ e.preventDefault(); items[(idx-1+items.length)%items.length]?.focus(); }
  else if(e.key==='Home'){ e.preventDefault(); items[0]?.focus(); }
  else if(e.key==='End'){ e.preventDefault(); items[items.length-1]?.focus(); }
});
$$('[data-tab-jump]').forEach(b=>b.onclick=()=>switchTab(b.dataset.tabJump));$$('[data-market-jump]').forEach(b=>b.onclick=()=>jumpToMarket(b.dataset.marketJump));$$('[data-command]').forEach(b=>b.onclick=()=>{pushCmdHistory(b.dataset.command);command(b.dataset.command)});$$('[data-open]').forEach(b=>b.onclick=()=>window.observer.openFiles(b.dataset.open));$$('[data-import]').forEach(b=>b.onclick=async()=>{const r=await window.observer.importContent(b.dataset.import);if(r.ok){state.files=r.files;refreshUI();toast('Content imported. Restart the server before using it.')}else if(!r.cancelled)toast(r.error)});
$('#chooseFolder').onclick=chooseFolder;$('#browseBtn').onclick=chooseFolder;$('#welcomeCreateBtn')?.addEventListener('click', async()=>{ const folder=await chooseFolder({suggestNew:true,title:'Choose (or create) an empty folder for your new server'}); if(folder) openNewServerWizard(); });$('#clearConsole').onclick=()=>{const o=$('#logOutput');o.innerHTML=`<div class="log-empty" id="logEmpty"><b>${t('con.empty')}</b><span>${t('con.emptySub')}</span></div>`;o.classList.remove('has-content');const j=$('#logJump');if(j)j.hidden=true};$('#commandForm').onsubmit=async e=>{e.preventDefault();const v=$('#commandInput').value;pushCmdHistory(v);await command(v);$('#commandInput').value=''};
$$('.log-filters .filter-chip').forEach(chip=>chip.onclick=()=>{
  logFilter=chip.dataset.logFilter;
  $$('.log-filters .filter-chip').forEach(c=>{ const on=c===chip; c.classList.toggle('active',on); c.setAttribute('aria-pressed', on?'true':'false'); });
  $$('#logOutput .log-line').forEach(el=>{el.hidden=logFilter!=='all'&&el.dataset.level!==logFilter});
  const countVisible=$$('#logOutput .log-line:not([hidden])').length;
  const hint=$('.log-hint'); if(hint) hint.textContent=countVisible?`${countVisible} · ${t('con.tip')}`:`${t('con.filterAll')}: 0`;
});
document.addEventListener('keydown', e=>{
  const isConsole=document.getElementById('console')?.classList.contains('active');
  if(!isConsole) return;
  if((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='l'){ e.preventDefault(); $('#clearConsole')?.click(); }
  if(e.key==='/' && !e.ctrlKey && document.activeElement?.tagName!=='INPUT' && document.activeElement?.tagName!=='TEXTAREA'){ e.preventDefault(); $('#commandInput')?.focus(); }
});
const logOutputEl=$('#logOutput');if(logOutputEl)logOutputEl.addEventListener('scroll',()=>{const atBottom=logOutputEl.scrollHeight-logOutputEl.scrollTop-logOutputEl.clientHeight<40;logPaused=!atBottom;if(atBottom){const j=$('#logJump');if(j)j.hidden=true}});
const logJumpEl=$('#logJump');if(logJumpEl)logJumpEl.onclick=()=>{logOutputEl.scrollTop=logOutputEl.scrollHeight;logJumpEl.hidden=true;logPaused=false};
const cmdInputEl=$('#commandInput');if(cmdInputEl)cmdInputEl.addEventListener('keydown',e=>{if(e.key==='ArrowUp'){if(!cmdHistory.length)return;e.preventDefault();cmdHistoryIdx=Math.min(cmdHistory.length-1,cmdHistoryIdx+1);cmdInputEl.value=cmdHistory[cmdHistoryIdx]||''}else if(e.key==='ArrowDown'){e.preventDefault();cmdHistoryIdx=Math.max(-1,cmdHistoryIdx-1);cmdInputEl.value=cmdHistoryIdx===-1?'':cmdHistory[cmdHistoryIdx]}});
$('#saveSettings').onclick=async()=>{
  const next=getSettings();
  const folderInput=$('#serverFolderInput'), javaInput=$('#javaPathInput');
  if(folderInput) folderInput.style.borderColor='';
  if(javaInput) javaInput.style.borderColor='';
  if(!next.serverPath){ if(folderInput){ folderInput.style.borderColor='var(--danger)'; folderInput.focus(); } return toast('Server folder is required — choose a folder or create a new server.','error'); }
  if(next.memoryMax < next.memoryMin) return toast('Maximum memory must be at least minimum memory.','error');
  if(next.memoryMax>32) return toast('Maximum memory is very high (>32GB) — ensure your PC has enough RAM.','error');
  if(next.memoryMin<1) return toast('Minimum memory must be at least 1GB.','error');
  if(next.jvmArgs && next.jvmArgs.length>2000) return toast('JVM arguments are too long (>2000 chars).','error');
  if(next.jvmArgs && /["'<>|]/.test(next.jvmArgs)) return toast('JVM arguments contain invalid characters.','error');
  if(state.java?.arch==='32-bit' && next.memoryMax>2) return toast('32-bit Java detected — cannot allocate >2GB RAM. Install 64-bit Java or lower Maximum memory.','error');
  const r=await window.observer.saveSettings(next);
  if(!r.java?.ok && next.javaPath){ if(javaInput){ javaInput.style.borderColor='var(--danger)'; javaInput.focus(); } return toast(`Java not found at "${next.javaPath}" — ${r.java?.message||'check the path or use auto-install.'}`,'error'); }
  state={...state,settings:next,java:r.java,files:r.files,eulaAccepted:r.eulaAccepted,javaRequired:r.javaRequired??state.javaRequired};propsDirty=false;markSettingsSaved();refreshUI();
  toast(r.java?.ok?t('toast.settingsSavedJava',{v:r.java.version}):t('toast.settingsSavedNoJava'),'success');
};
$('#saveRamOverview').onclick=async()=>{
  const next=getSettings();
  if(next.memoryMax<next.memoryMin)return toast('Maximum memory must be at least minimum memory.','error');
  const r=await window.observer.saveSettings(next);state={...state,settings:next,java:r.java,files:r.files,eulaAccepted:r.eulaAccepted,javaRequired:r.javaRequired??state.javaRequired};markSettingsSaved();refreshUI();toast(t('toast.ramSaved'),'success');
};
$('#languageSelect').onchange=async()=>{currentLocale=$('#languageSelect').value;applyLocale();const next={...getSettings(),locale:currentLocale};const r=await window.observer.saveSettings(next);state.settings=next;state.java=r.java;markSettingsSaved();refreshUI();renderJvmPreview();if(!$('#newServerModal').hidden)nswRender();if(!$('#installModal').hidden){imRenderCompat();imRenderWarns()}};
// Properties tab (search/filter/save) moved to 10-properties.js.
$('#createBackup').onclick=async()=>{if(!confirm(t('toast.confirmBackup')))return;const r=await window.observer.createBackup();if(r.ok){state.files=r.files;refreshUI();toast(`Backup created: ${r.name}`)}else toast(r.error)};
// Marketplace state moved to 11-market.js.
function debounce(fn,ms){let t;return (...a)=>{clearTimeout(t);t=setTimeout(()=>fn(...a),ms)}}
// Marketplace search/paging UI moved to 11-market.js.
window.observer.onBuildDone(v=>{state.files=v.files;refreshUI();toast(v.ok?'Build finished — server jar is ready. Configure settings, then start.':'Build failed — check the Console tab for the error.')});
function manualPlayer(){const name=$('#playerActionName').value.trim();const bad=playerNameError(name);if(bad){toast(bad);return null}return {uuid:null,name}}
$('#manualOpBtn').onclick=()=>{const p=manualPlayer();if(p)togglePlayerOp(p,true)};
$('#manualWhitelistBtn').onclick=()=>{const p=manualPlayer();if(p)togglePlayerWhitelist(p,true)};
$('#manualBanBtn').onclick=()=>{const p=manualPlayer();if(p&&confirm(`Ban ${p.name}?`))togglePlayerBan(p,true)};
$('#manualKickBtn').onclick=()=>{const p=manualPlayer();if(p&&confirm(`Kick ${p.name}?`))command(`kick ${p.name}`)};
$('#savePlayerData').onclick=async()=>{if(!selectedPlayer)return toast('Choose a player with offline data first.');if(!confirm(`Apply player data for ${selectedPlayer.name}? ObserverLauncher will create a backup first.`))return;const changes={health:$('#pdHealth').value,food:$('#pdFood').value,saturation:$('#pdSaturation').value,xpLevel:$('#pdXpLevel').value,xpTotal:$('#pdXpTotal').value,gameType:$('#pdGameType').value};const r=await window.observer.playerSave({uuid:selectedPlayer.uuid,changes,clearInventory:$('#pdClearInventory').checked});if(!r.ok)return toast(r.error);toast(`Player data saved; backup: ${r.backup}`);refreshUI()};
$('#startBtn').onclick=async()=>{let r;try{r=await window.observer.start(getSettings())}catch(e){toast(`Start failed: ${e?.message||e}`,'error');return}if(!r||!r.ok){toast((r&&r.error)||'Start failed for an unknown reason.','error');if(r&&r.error&&r.error.includes('Java')){switchTab('overview');const jw=$('#javaWarnBanner');if(jw&&!jw.hidden)jw.scrollIntoView({behavior:'smooth',block:'center'})}}else toast('Server start requested. Check Console for output.')};$('#stopBtn').onclick=async()=>{let r;try{r=await window.observer.stop()}catch(e){toast(`Stop failed: ${e?.message||e}`,'error');return}if(!r.ok)toast(r.error)};
$('#forceStopBtn').onclick=async()=>{if(!confirm(t('top.forceStopConfirm')))return;let r;try{r=await window.observer.forceStop()}catch(e){toast(`Force stop failed: ${e?.message||e}`,'error');return}if(!r||!r.ok)toast((r&&r.error)||'Force stop failed.','error');else toast(t('toast.forceStopped'),'success')};
window.observer.onLog(addLog);window.observer.onState(v=>{state.running=v.running;state.status=v.status||(v.running?'running':'stopped');
  if(state.status==='running'&&!uptimeStart)uptimeStart=Date.now();else if(state.status==='stopped')uptimeStart=null;
  refreshUI()});window.observer.onFiles(f=>{state.files=f.files||f;state.javaRequired=f.javaRequired??state.javaRequired;refreshUI()});let lastLivePlayersKey='';
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
window.observer.onLive(v=>{state.live=v; applyLiveToUI(v);
  const key=(v.players||[]).slice().sort().join(',');if(key!==lastLivePlayersKey){lastLivePlayersKey=key;try{renderPlayers()}catch{}}
});window.observer.onMetrics(v=>{lastMetrics=v; state.live = {...state.live, tps:v.tps??state.live?.tps??null, mspt:v.mspt??state.live?.mspt??null, players:v.players??state.live?.players??[]}; const displayTps = v.tps ?? state.live?.tps ?? null; const displayMspt = v.mspt ?? state.live?.mspt ?? null; const limitGB=state.settings.memoryMax||6;const usedGB=(v.serverMemory||0)/1024;const ram=v.running?Math.min(100,Math.round((v.serverMemory||0)/Math.max(1,limitGB*1024)*100)):null;samples=[...samples.slice(1),{tps:displayTps,mspt:v.running?(displayMspt):null,cpu:v.running?(v.cpu??null):null,ram}]; try{$('#appMemory').textContent=`${v.appMemory||0} MB`;}catch{} const ramLabel=v.running?`${usedGB.toFixed(1)} / ${limitGB} GB`:'—'; try{$('#perfServerRam').textContent=ramLabel;}catch{} try{$('#serverRam').textContent=ramLabel;}catch{} try{$('#overviewCpu').textContent=v.running?`${v.cpu||0}%`:'—';}catch{} try{$('#perfCpu').textContent=v.running?`${v.cpu||0}%`:'—';}catch{} try{$('#playerCount').textContent=v.running?String((v.players||[]).length):'—';}catch{} try{$('#tps').textContent=displayTps?.toFixed?.(2)??'—';}catch{} try{$('#perfTps').textContent=displayTps?.toFixed?.(2)??'—';}catch{}
  const msptEl=$('#perfMspt');if(msptEl){msptEl.textContent=displayMspt?.toFixed?.(2)??'—';const hint=$('#perfMsptHint');if(hint)hint.textContent=displayMspt!=null?'Target: under 50 ms':(v.running?'Needs Paper 1.20.2+ (/tick query) — not reported by this server':'Target: under 50 ms')}
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
  const setBadge=(id,val,good,mid)=>{const el=$(id); if(!el) return; const level=val==null?'':val>=good?'ok':val>=mid?'warn':'bad'; el.className='kpi-badge '+(level||''); el.textContent=val==null?'—':level==='ok'?'Good':level==='warn'?'Warn':'Critical'; };
  setBadge('#perfTpsBadge', displayTps, 19, 17); setBadge('#perfMsptBadge', displayMspt!=null? (100 - Math.min(100,displayMspt)):null, 60, 30); // invert mspt for badge
  setBadge('#perfCpuBadge', v.cpu, 40, 70); // lower is better, so invert logic: we treat high as bad
  const perfCpuBadge=$('#perfCpuBadge'); if(perfCpuBadge && v.cpu!=null){ perfCpuBadge.className='kpi-badge '+(v.cpu<60?'ok':v.cpu<85?'warn':'bad'); perfCpuBadge.textContent=v.cpu<60?'Good':v.cpu<85?'High':'Critical'; }
  setBadge('#perfRamBadge', ram, 30, 60); // placeholder, will override below
  const ramBadge=$('#perfRamBadge'); if(ramBadge && ram!=null){ ramBadge.className='kpi-badge '+(ram<75?'ok':ram<90?'warn':'bad'); ramBadge.textContent=ram<75?'Good':ram<90?'High':'Critical'; } else if(ramBadge && ram==null){ ramBadge.className='kpi-badge'; ramBadge.textContent='—'; }
  const bar=(id,pct)=>{const el=$(id); if(el) el.style.width=(pct==null?0:Math.max(4,Math.min(100,pct)))+'%';};
  bar('#perfTpsBar', displayTps!=null? (displayTps/20*100):null); bar('#perfMsptBar', displayMspt!=null? Math.min(100, displayMspt/100*100):null); bar('#perfCpuBar', v.cpu); bar('#perfRamBar', ram);
  const liveDot=$('#perfLiveDot'), liveText=$('#perfLiveText'), uptimeEl=$('#perfUptime'); if(liveDot){ liveDot.className='live-dot'+(v.running?' on':''); } if(liveText) liveText.textContent=v.running?`${t('con.live')} • ${t('top.running')}`:t('top.offline'); if(uptimeEl) uptimeEl.textContent=uptimeStart? document.getElementById('heroUptime')?.textContent || '—' : '—';
  const launcherMem=$('#perfLauncherMem'); if(launcherMem) launcherMem.textContent=`${v.appMemory||0} MB launcher`;
  const tickEmpty=$('#tickChartEmpty'), resEmpty=$('#resourceChartEmpty');
  if(tickEmpty) tickEmpty.hidden=!!(displayTps!=null || displayMspt!=null);
  if(resEmpty) resEmpty.hidden=!!(v.cpu!=null || ram!=null);
  const liveBadge=$('#resourceLiveBadge'); if(liveBadge){ liveBadge.textContent=v.running?'● LIVE':'○ OFFLINE'; liveBadge.style.color=v.running?'var(--success)':'var(--text-dim)'; liveBadge.style.borderColor=v.running?'rgba(0,229,160,.25)':'var(--border)'; }
  metricChart($('#miniChart'));metricChart($('#perfTickChart'),true,'tick');metricChart($('#perfResourceChart'),true,'resource')});
 // Fallback: nếu main gửi chậm hoặc miss, vẫn giữ UI đồng bộ mỗi 2s từ lastMetrics/live
 setInterval(()=>{ try{ if(lastMetrics){ const v=lastMetrics; const displayTps=v.tps??state.live?.tps??null; const displayMspt=v.mspt??state.live?.mspt??null; if(displayTps!=null){ const el=$('#tps'); if(el && el.textContent==='—') el.textContent=displayTps.toFixed(2); const el2=$('#perfTps'); if(el2 && el2.textContent==='—') el2.textContent=displayTps.toFixed(2); } if(displayMspt!=null){ const el=$('#perfMspt'); if(el && el.textContent==='—') el.textContent=displayMspt.toFixed(2); } } }catch{} }, 2500);
 // Redraw charts định kỳ khi tab performance đang mở (fix canvas 0x0 khi tab hidden lúc metrics đến)
 setInterval(()=>{ try{ if(document.getElementById('performance')?.classList.contains('active')){ metricChart($('#perfTickChart'),true,'tick'); metricChart($('#perfResourceChart'),true,'resource'); } }catch{} }, 2000);
// FEATURE: Aikar's flags preset (a widely recommended JVM/G1GC config for Paper/Purpur servers),
// auto-filled from the current memoryMin/memoryMax instead of making the user type the long flag string.
function aikarFlags(minGB,maxGB){return `-Xms${minGB}G -Xmx${maxGB}G -XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200 -XX:+UnlockExperimentalVMOptions -XX:+DisableExplicitGC -XX:+AlwaysPreTouch -XX:G1NewSizePercent=30 -XX:G1MaxNewSizePercent=40 -XX:G1HeapRegionSize=8M -XX:G1ReservePercent=20 -XX:G1HeapWastePercent=5 -XX:G1MixedGCCountTarget=4 -XX:InitiatingHeapOccupancyPercent=15 -XX:G1MixedGCLiveThresholdPercent=90 -XX:G1RSetUpdatingPauseTimePercent=5 -XX:SurvivorRatio=32 -XX:+PerfDisableSharedMem -XX:MaxTenuringThreshold=1 -Dusing.aikars.flags=https://mcflags.emc.gs -Dfile.encoding=UTF-8`}
$('#applyAikarFlags').onclick=()=>{const min=Number($('#memoryMinInput').value)||2,max=Number($('#memoryMaxInput').value)||6;$('#jvmArgsInput').value=aikarFlags(min,max);toast("Aikar's flags filled in — remember to click Apply settings to save.")};
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
  const fw=$('#allowFirewall'); if(fw){ fw.textContent = launcherPlatform==='linux' ? 'Copy firewall command' : t('conn.firewall'); }
}

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
    try{ await navigator.clipboard.writeText(cmd); toast('Copied: '+cmd+' — run it in a terminal. You may also need to forward the port on your router.','success'); }
    catch{ toast('Run this in a terminal: '+cmd); }
    return;
  }
  if(!confirm(`Add a Windows Firewall rule allowing inbound TCP traffic on port ${port}? A Windows security prompt (UAC) will appear — approve it to continue.`))return;
  const r=await window.observer.allowFirewall(port);
  if(!r.ok)return toast(r.error,'error');
  toast(`Port ${port} is now allowed through Windows Firewall. You still need to forward it on your router for friends outside your WiFi.`,'success');
};
$$('[data-copy]').forEach(b=>b.onclick=async()=>{
  const input=$(b.dataset.copy);if(!input||!input.value||input.value==='—')return toast('Nothing to copy yet.');
  try{
    await navigator.clipboard.writeText(input.value);
    const orig=b.textContent; b.textContent='Copied!'; b.classList.add('copied');
    toast(t('toast.copied'),'success');
    setTimeout(()=>{b.textContent=orig; b.classList.remove('copied')}, 1400);
  }catch{toast('Could not copy — select and copy manually.','error')}
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
  const btn=$('#javaAutoInstall');btn.disabled=true;const original=btn.textContent;btn.textContent='Downloading Java… this can take a minute';
  $('#javaProgress').hidden=false; $('#javaProgressFill').style.width='0%'; $('#javaProgressFill').classList.add('indeterminate'); $('#javaProgressLabel').textContent='Starting download…';
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
$('#obPickExisting').onclick=async()=>{hideOnboarding();await markOnboarded();await chooseFolder()};
$('#obCreateNew').onclick=async()=>{
  const folder=await chooseFolder({suggestNew:true,title:'Choose (or create) an empty folder for your new server'});
  hideOnboarding();await markOnboarded();
  if(!folder)return;
  openNewServerWizard();
};

// The guided "create a new server" wizard now lives in 12-wizard.js (loads after this file).
// Wizard state/functions moved to 12-wizard.js.
function formatBytes(n){if(n==null)return'';if(n<1024)return`${n} B`;if(n<1024*1024)return`${(n/1024).toFixed(0)} KB`;return`${(n/1024/1024).toFixed(1)} MB`}
// Wizard UI (nsw*) moved to 12-wizard.js.
$('#newServerClose').onclick=()=>{if($('#nswNext').disabled)return toast('Wait for the download to finish before closing this.','error'); closeOverlayAnimated($('#newServerModal'));};
// FEATURE: generic modal dismissal — Escape key, or clicking the dimmed backdrop outside the modal
// card, closes whichever .modal-overlay is currently open. Covers every current and future modal from
// one place instead of each modal needing its own escape-hatch wiring (see the note above on why that
// was missing for onboarding). Guarded so it can't close the create-server modal mid-download — the
// download itself isn't cancellable, so closing then would just hide the progress from a job still
// running, and its completion toast/tab-switch would fire later with no modal left to explain why.
const modalBusy=overlay=>overlay.id==='newServerModal'&&$('#nswNext').disabled||overlay.id==='installModal'&&installState.busy;
function closeOverlayAnimated(el){ el.classList.add('closing'); setTimeout(()=>{ el.hidden=true; el.classList.remove('closing'); }, 140); }
document.addEventListener('keydown',e=>{if(e.key==='Escape'){const open=$$('.modal-overlay').find(m=>!m.hidden);if(open&&!modalBusy(open)){ if(open.id==='playerInspectModal') closePlayerInspectModal(); else closeOverlayAnimated(open); }}});
$$('.modal-overlay').forEach(overlay=>overlay.addEventListener('click',e=>{if(e.target===overlay&&!modalBusy(overlay)){ if(overlay.id==='playerInspectModal') closePlayerInspectModal(); else closeOverlayAnimated(overlay); }}));

(async()=>{const langSel=$('#languageSelect');if(langSel&&window.LOCALES_META)langSel.innerHTML=window.LOCALES_META.map(l=>`<option value="${esc(l.code)}">${esc(l.name)}</option>`).join('');
let initial;try{initial=await window.observer.getState()}catch(e){toast(`Could not load launcher state: ${e?.message||e}`,'error');return}state={...state,...initial};addLogsBatch(initial.logs||[]);refreshUI();loadConnectInfo();if(!state.settings?.onboarded)showOnboarding();
// BUGFIX (Start dead on launch): if this first snapshot raced backend init and
// came back without Java/files, re-sync once the backend has settled instead
// of leaving Start disabled until the next folder save.
if(!initial.java?.ok||!initial.files?.jar&&!initial.files?.launchScript){setTimeout(async()=>{try{const s2=await window.observer.getState();state={...state,...s2};const f2=await window.observer.getFiles();if(f2&&f2.ok){state.files=f2.files;state.javaRequired=f2.javaRequired??state.javaRequired}refreshUI()}catch{}},2500);}
// BUGFIX: the native min/max/close caption buttons overlay the top-right of the page and used to
// cover the server-path text in the command bar. Detect the Window Controls Overlay and flag it so
// CSS can reserve its width (.wco-app rules in style.css).
try{const wco=navigator.windowControlsOverlay;if(wco){const sync=()=>document.documentElement.classList.toggle('wco-app',!!wco.visible);sync();wco.addEventListener('geometrychange',sync);}}catch{}
const v=await window.observer.marketVersions();if(v.ok)$('#marketVersion').innerHTML='<option value="">All versions</option>'+v.versions.map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join('');requestAnimationFrame(positionChannelIndicator);window.addEventListener('resize',()=>{metricChart($('#miniChart'));metricChart($('#perfTickChart'),true,'tick');metricChart($('#perfResourceChart'),true,'resource');positionChannelIndicator()})})();

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
  if(state.running&&!confirm(t('upd.confirmRunning')))return;
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
window.observer.onState(v=>{if(v.status==='running')pulseStart();else pulseStop()});
