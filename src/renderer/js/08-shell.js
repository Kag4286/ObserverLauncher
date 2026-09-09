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
// Search + group chips share one filter pass: text matches highlight and auto-open collapsed
// groups; the active chip narrows which groups are shown at all.
let propGroupFilter='all';
function applyPropFilters(){
  const qRaw=$('#propertiesSearch').value.trim();
  const q=qRaw.toLowerCase();
  $$('.prop-group').forEach(g=>{
    const passGroup=propGroupFilter==='all'||propGroupFilter===g.dataset.groupId;
    let anyVisible=false;
    g.querySelectorAll('[data-prop-row]').forEach(row=>{
      const match=!q||row.dataset.propSearch.toLowerCase().includes(q);
      row.hidden=!match;
      if(match)anyVisible=true;
      const label=row.querySelector('.prop-label');
      if(label){
        const orig=label.dataset.orig || (label.dataset.orig=label.innerHTML);
        if(qRaw && match){
          const regex=new RegExp(`(${qRaw.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})`,'gi');
          label.innerHTML=orig.replace(regex,'<mark>$1</mark>');
        } else label.innerHTML=orig;
      }
      if(match&&q){const det=row.closest('details');if(det)det.open=true}
    });
    g.hidden=!passGroup||!anyVisible;
  });
  const noResults=$('#propertiesNoResults'); if(noResults){ const anyVisible=$$('.prop-group:not([hidden])').length>0; noResults.hidden=!q || anyVisible; const qEl=$('#propertiesNoResultsQuery'); if(qEl) qEl.textContent=qRaw; }
}
$('#propertiesSearch').addEventListener('input',applyPropFilters);
$$('[data-prop-filter]').forEach(c=>c.onclick=()=>{
  propGroupFilter=c.dataset.propFilter;
  $$('[data-prop-filter]').forEach(x=>{const on=x===c;x.classList.toggle('active',on);x.setAttribute('aria-pressed',on?'true':'false')});
  applyPropFilters();
});
// Track unsaved edits in both property editors (see propsDirty above). Programmatic value writes in
// renderProperties/refreshProxyProperties don't fire 'input', so this only trips on real typing.
document.addEventListener('input',e=>{const el=e.target;if(el&&(el.closest?.('#propertiesGrid')||el.id==='propertiesRaw'))propsDirty=true});
$('#saveProperties').onclick=async()=>{
  if(isProxyServer()){
    const raw=$('#propertiesRaw').value;
    if(raw.length>200000) return toast('velocity.toml is too large (>200KB) — check for accidental paste','error');
    const r=await window.observer.saveRawProperties(raw);if(r.ok)propsDirty=false;return r.ok?toast('velocity.toml saved. Restart the proxy to apply changes.','success'):toast(r.error||'Choose and apply a server folder first.','error');
  }
  const p={}; let firstInvalid=null;
  const validators={
    'max-players':v=>{ const n=Number(v); if(!Number.isInteger(n)||n<1||n>100000) return 'Max players must be an integer 1–100000'; },
    'server-port':v=>{ const n=Number(v); if(!Number.isInteger(n)||n<1||n>65535) return 'Server port must be 1–65535'; },
    'view-distance':v=>{ const n=Number(v); if(!Number.isInteger(n)||n<2||n>32) return 'View distance must be 2–32'; },
    'simulation-distance':v=>{ const n=Number(v); if(!Number.isInteger(n)||n<2||n>32) return 'Simulation distance must be 2–32'; },
    'max-world-size':v=>{ const n=Number(v); if(!Number.isInteger(n)||n<1||n>29999984) return 'Max world size must be 1–29999984'; },
  };
  $$('[data-property]').forEach(input=>{
    const key=input.dataset.property;
    // Boolean properties render as switches — checkboxes carry "on"/"" as .value, so translate.
    const val=input.type==='checkbox'?(input.checked?'true':'false'):input.value.trim();
    p[key]=val;
    const fn=validators[key];
    if(fn){
      const err=fn(val);
      input.style.borderColor=err?'var(--danger)':'';
      if(err && !firstInvalid){ firstInvalid=input; toast(err,'error'); }
    } else {
      input.style.borderColor='';
    }
  });
  if(firstInvalid){ firstInvalid.focus(); return; }
  const r=await window.observer.saveProperties(p);if(r.ok){propsDirty=false;state.files.properties=p;loadConnectInfo();toast('server.properties updated. Restart server to apply most changes.','success')}else toast('Choose and apply a server folder first.','error')
};
$('#createBackup').onclick=async()=>{if(!confirm(t('toast.confirmBackup')))return;const r=await window.observer.createBackup();if(r.ok){state.files=r.files;refreshUI();toast(`Backup created: ${r.name}`)}else toast(r.error)};
let marketItems=[];let marketPage=1;let marketHasNext=false;let marketTotal=null;let marketReqSeq=0;
// FEATURE: replaced "Load more" (which appended to the same growing list, so paging forward meant
// scrolling down and paging back meant scrolling all the way back up) with real Prev/Next pages that
// REPLACE the results and scroll back to the top of the results themselves — no more manual scrolling
// either direction. Modrinth and Hangar report an exact total, so those sources show "Page N of M";
// Spiget (Spigot) doesn't expose a total count at all, so Next just stays enabled as long as the last
// page came back full (the same "probably more" heuristic the old Load More button used).
function debounce(fn,ms){let t;return (...a)=>{clearTimeout(t);t=setTimeout(()=>fn(...a),ms)}}
async function runMarketSearch(page){
  // BUGFIX: rapid typing fired overlapping requests; slower older responses could land AFTER a
  // newer one and overwrite fresh results with stale ones (felt like the search box "not working").
  // A sequence token drops any response that is not the latest request.
  const seq=++marketReqSeq;
  const source=$('#marketSource').value,kind=$('#marketKind').value,query=$('#marketQuery').value.trim(),version=$('#marketVersion').value,status=$('#marketStatus');
  marketPage=page;
  $('#marketSearch').disabled=true;$$('.market-sort').forEach(b=>b.disabled=true);$('#marketPrev').disabled=true;$('#marketNext').disabled=true;status.classList.add('loading'); status.setAttribute('aria-busy','true');
  // skeleton instead of single text line
  $('#marketResults').setAttribute('aria-busy','true');
  $('#marketResults').innerHTML=Array.from({length:4}).map(()=>`<article class="panel glass market-item skeleton" aria-hidden="true"><div class="market-icon skeleton-box"></div><div><div class="skeleton-line w60"></div><div class="skeleton-line w90"></div><div class="skeleton-line w40"></div></div><div class="skeleton-btn"></div></article>`).join('');
  status.textContent=t('mkt.searching');
  const r=await window.observer.marketSearch({source,kind,query,version,sort:marketSort,offset:(page-1)*20});
  if(seq!==marketReqSeq)return; // a newer request superseded this one — drop the stale response
  $('#marketSearch').disabled=false;$$('.market-sort').forEach(b=>b.disabled=false);status.classList.remove('loading'); status.removeAttribute('aria-busy'); $('#marketResults').removeAttribute('aria-busy');
  if(!r.ok){
    status.textContent=`Could not load results: ${r.error}`;
    const n=$('#marketResults');
    n.innerHTML=`<article class="panel glass"><div style="display:flex;gap:12px;align-items:center"><span style="font-size:18px">⚠</span><div><b>Could not load marketplace</b><p class="text-muted" style="margin:4px 0 0">${esc(r.error)}</p></div><button class="btn primary" onclick="document.getElementById('marketSearch').click()">Retry</button></div><p class="text-muted" style="margin-top:10px;font:500 11px var(--font-ui)">Check your internet — Modrinth/Hangar/Spiget need online. Try switching Source to Modrinth.</p></article>`;
    $('#marketPager').hidden=true;
    const countEl=$('#marketplaceCount'); if(countEl) countEl.textContent='error';
    toast(r.error,'error');return;
  }
  marketItems=r.items.map(x=>({...x,kind}));
  marketTotal=r.total??null;
  marketHasNext=marketTotal!=null?page*20<marketTotal:marketItems.length>=20;
  const sortLabel=marketSort==='downloads'?t('mkt.sortDl'):marketSort==='latest'?t('mkt.sortLatest'):t('mkt.sortRel');
  const relaxedNote=r.relaxed==='version'?' (no exact match for that game version — showing all versions)':r.relaxed==='loader'?' (no match for this server type — showing all matching mods/plugins)':'';
  const countLabel=marketTotal!=null?`${marketTotal} ${sortLabel}`:`${marketItems.length} ${sortLabel}`;
  status.textContent=`${countLabel} · ${source}.${relaxedNote}`;
  const countEl=$('#marketplaceCount'); if(countEl) countEl.textContent=marketTotal!=null?tf('mkt.found',{a:marketTotal}):`${marketItems.length}`;
  renderMarket(marketItems);
  $('#marketPager').hidden=!(page>1||marketHasNext);
  $('#marketPrev').disabled=page<=1;$('#marketNext').disabled=!marketHasNext;
  $('#marketPageLabel').textContent=marketTotal!=null?`Page ${page} of ${Math.max(1,Math.ceil(marketTotal/20))}`:`Page ${page}`;
}
$('#marketSearch').onclick=()=>runMarketSearch(1);
$('#marketPrev').onclick=()=>{if(marketPage>1)runMarketSearch(marketPage-1)};
$('#marketNext').onclick=()=>{if(marketHasNext)runMarketSearch(marketPage+1)};
const debouncedMarketSearch=debounce(()=>runMarketSearch(1),400);
$('#marketQuery').addEventListener('input', debouncedMarketSearch);
$('#marketQuery').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault(); runMarketSearch(1)}});
function flashMarketField(el){el.classList.remove('just-changed');void el.offsetWidth;el.classList.add('just-changed')}
$('#marketSource').onchange=e=>{flashMarketField(e.target);runMarketSearch(1)};$('#marketKind').onchange=e=>{flashMarketField(e.target);runMarketSearch(1)};$('#marketVersion').onchange=e=>{flashMarketField(e.target);runMarketSearch(1)};
$$('.market-sort').forEach(b=>b.onclick=()=>{marketSort=b.dataset.sort;$$('.market-sort').forEach(x=>x.classList.toggle('active',x===b));runMarketSearch(1)});
$('#importModpack').onclick=async()=>{const r=await window.observer.importModpack();if(r.cancelled)return;if(!r.ok)return toast(r.error,'error');state.files=r.files;refreshUI();toast(`${r.name} imported — ${r.installed} file(s) installed${r.skipped?`, ${r.skipped} client-only file(s) skipped`:''}. Restart the server to use it.`,'success')};
$('#exportModpack').onclick=async()=>{const r=await window.observer.exportModpack();if(r.cancelled)return;if(!r.ok)return toast(r.error,'error');toast(`Exported ${r.count} item(s) to ${r.path}`,'success')};
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
async function loadConnectInfo(){
  const r=await window.observer.networkInfo();if(!r.ok)return;
  const port=r.port;
  $('#connectLocal').value=r.localIps.length?r.localIps.map(ip=>`${ip}:${port}`).join(', '):t('conn.noLan');
  $('#allowFirewall').dataset.port=port;
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

// FEATURE: guided 4-step "create a new server" wizard for people who don't already know what
// software/version/memory means — separate from the full App settings tab (Java path, JVM args,
// auto-restart...) which stays available for people who already know what they're doing (accessible
// directly via the Server properties / Launcher settings tabs, unchanged).
let nsw={step:1,software:'vanilla'};
// Real-time version data for the wizard — loaded live from each software's official API
// (wizard:versions IPC) instead of hardcoded chips that drifted out of date.
let nswVersions={software:null,list:[],latest:null,raw:false,loading:false,failed:false,error:''};
const NSW_SOFTWARE_LABEL={vanilla:'Vanilla',paper:'Paper',purpur:'Purpur',leaf:'Leaf',fabric:'Fabric',neoforge:'NeoForge',forge:'Forge',folia:'Folia',spigot:'Spigot',velocity:'Velocity'};
async function loadNswVersions(software){
  if(nswVersions.software===software)return;
  nswVersions={software,list:[],latest:null,raw:false,loading:true,failed:false,error:''};
  renderNswChips('');
  $('#nswLatestLabel').textContent=t('nsw.latestSub');
  const r=await window.observer.wizardVersions(software);
  if(nswVersions.software!==software)return; // user switched software mid-request
  nswVersions.loading=false;
  if(!r||!r.ok){nswVersions.failed=true;nswVersions.error=r?.error||'Could not reach the version API.';}
  else{nswVersions.list=r.versions||[];nswVersions.latest=r.latest||null;nswVersions.raw=!!r.raw;nswVersions.note=r.note||'';}
  renderNswChips($('#nswVersionInput')?.value.trim()||'');
  $('#nswLatestLabel').textContent=nswVersions.latest?`${t('nsw.latest')}: ${nswVersions.latest}`:'';
  const mode=$$('input[name="nswVersionMode"]').find(r=>r.checked)?.value;
  if(nswVersions.latest&&mode!=='specific')checkNswJava(nswVersions.latest);
}
function renderNswChips(filter){
  const box=$('#nswVersionChips');if(!box)return;
  if(nswVersions.loading){box.innerHTML='<span class="nsw2-chiploading">Loading live versions…</span>';return}
  if(nswVersions.failed){box.innerHTML=`<span class="nsw2-chiploading">${esc(nswVersions.error)} — type a version manually.</span>`;return}
  const q=(filter||'').toLowerCase();
  const list=q?nswVersions.list.filter(v=>v.toLowerCase().includes(q)):nswVersions.list;
  box.innerHTML=list.length?list.map(v=>`<button class="version-chip" data-version="${esc(v)}">${esc(v)}</button>`).join(''):'<span class="nsw2-chiploading">No matches — the exact text you type will be used as-is.</span>';
}
function nswValidateVersion(v){
  if(!v)return'';
  if(nswVersions.loading)return'Checking the live list…';
  if(nswVersions.failed)return'Live list unavailable — the download step will verify it.';
  if(v==='latest')return'';
  if(nswVersions.list.includes(v))return`✓ ${v} is available for ${NSW_SOFTWARE_LABEL[nsw.software]||nsw.software}.`;
  const near=nswVersions.list.find(x=>x.startsWith(v));
  return near?`✗ "${v}" not found — did you mean ${near}?`:`✗ "${v}" is not in the live list for ${NSW_SOFTWARE_LABEL[nsw.software]||nsw.software}.`;
}
// HARD-SYNC Java requirement: asks Mojang's manifest (via wizard:java-check) for the authoritative
// javaVersion of the selected MC version instead of trusting the static mapping. Result is shown
// live in step 2 and repeated as a "Java" row in the step 4 summary.
let nswJava={version:'',java:null,exact:false};
const javaMajorOf=s=>{const m=String(s||'').match(/(?:1\.)?(\d+)/);return m?Number(m[1]):null};
function renderNswJava(){
  const el=$('#nswJavaCheck');if(!el)return;
  if(!nswJava.java){el.hidden=true;return}
  const jm=state.java&&state.java.ok?javaMajorOf(state.java.version):null;
  const tooOld=jm!=null&&jm<nswJava.java;
  el.hidden=false;
  el.className='nsw-java '+(tooOld?'warn':'ok');
  el.textContent=(nswJava.exact?'☕ This version runs on Java ':'☕ Estimated: Java ')+nswJava.java+(nswJava.exact?' (verified from Mojang)':'+')+(tooOld?` — ⚠ your Java ${jm} is too old; use auto-install in Settings or pick a newer path.`:tooOld===false&&jm!=null?` — your Java ${jm} is ready.`:'');
}
function checkNswJava(v){
  if(!v||v==='latest'){nswJava={version:'',java:null,exact:false};const el=$('#nswJavaCheck');if(el)el.hidden=true;return}
  const el=$('#nswJavaCheck');
  if(el){el.hidden=false;el.className='nsw-java loading';el.textContent='Checking Java requirement…'}
  window.observer.wizardJavaCheck({software:nsw.software,version:v}).then(r=>{
    if(r&&r.ok&&r.java){nswJava={version:v,java:r.java,exact:!!r.exact}}
    else{nswJava={version:v,java:null,exact:false}}
    renderNswJava();
  }).catch(()=>{nswJava={version:v,java:null,exact:false};const e2=$('#nswJavaCheck');if(e2)e2.hidden=true});
}
function nswRender(){
  $$('.nsw-step').forEach(s=>s.classList.toggle('active',Number(s.dataset.step)===nsw.step));
  $$('.nsw2-step').forEach(d=>{const n=Number(d.dataset.dot);d.classList.toggle('active',n===nsw.step);d.classList.toggle('done',n<nsw.step)});
  $('#nswStepLabel').textContent=t('nsw.step',{a:nsw.step,b:4});
  $('#nswBack').hidden=nsw.step===1;
  $('#nswNext').textContent=nsw.step===4?t('nsw.create'):t('nsw.next');
  const versionMode=$$('input[name="nswVersionMode"]').find(r=>r.checked)?.value;
  const version=versionMode==='specific'?($('#nswVersionInput').value.trim()||'—'):(nswVersions.latest||'Latest');
  $('#nswRailSub1').textContent=NSW_SOFTWARE_LABEL[nsw.software]||nsw.software;
  $('#nswRailSub2').textContent=version;
  $('#nswRailSub3').textContent=`${$('#nswMemorySlider').value} GB`;
  if(nsw.step===2)loadNswVersions(nsw.software);
  if(nsw.step===3){
    if(state.systemMemoryGB){$('#nswMemorySlider').max=Math.max(2,state.systemMemoryGB-1);$('#nswRamHint').textContent=`Your computer has about ${state.systemMemoryGB} GB of RAM — the server can use part of it. More isn't always better; 2–4 GB is plenty for friends.`}
    nswUpdateMemory();
  }
  if(nsw.step===4){
    const memory=$('#nswMemorySlider').value;
    $('#nswSummary').innerHTML=`<div class="nsw2-kv"><span>${t('nsw.sumSoftware')}</span><b>${esc(NSW_SOFTWARE_LABEL[nsw.software]||nsw.software)}</b></div><div class="nsw2-kv"><span>${t('nsw.sumVersion')}</span><b>${esc(version)}</b></div><div class="nsw2-kv"><span>${t('nsw.sumJava')}</span><b>${nswJava.java?`Java ${nswJava.java}${nswJava.exact?' (verified)':'+'}`:'—'}</b></div><div class="nsw2-kv"><span>${t('nsw.sumMemory')}</span><b>${esc(memory)} GB</b></div><div class="nsw2-kv"><span>${t('nsw.sumFolder')}</span><b>${esc(state.settings.serverPath||'—')}</b></div>`;
  }
  const spigotHint=$('#nswSpigotHint'); if(spigotHint) spigotHint.hidden=!(nsw.step===4&&nsw.software==='spigot');
}
$$('[data-software]').forEach(c=>c.onclick=()=>{
  if(nsw.software===c.dataset.software)return;
  nsw.software=c.dataset.software;
  $$('[data-software]').forEach(x=>x.classList.toggle('active',x===c));
  // invalidate the cached live list so step 2 refetches for this software
  nswVersions={software:null,list:[],latest:null,raw:false,loading:false,failed:false,error:''};
  if(nsw.step===2)loadNswVersions(nsw.software);
  nswRender();
});
$$('input[name="nswVersionMode"]').forEach(r=>r.onchange=()=>{
  const isSpecific=$$('input[name="nswVersionMode"]').find(x=>x.checked)?.value==='specific';
  $('#nswVersionInput').disabled=!isSpecific;
  const picker=$('#nswVersionPicker'); if(picker) picker.hidden=!isSpecific;
  $$('.nsw-radio-card').forEach(c=>c.classList.toggle('active', c.querySelector('input')?.checked));
  if(isSpecific){renderNswChips($('#nswVersionInput').value.trim());$('#nswVersionInput')?.focus()}
  checkNswJava(isSpecific?$('#nswVersionInput').value.trim():nswVersions.latest);
  nswRender();
});
// Chips are rendered live from the API (renderNswChips), so bind once via delegation.
$('#nswVersionChips').addEventListener('click',e=>{
  const chip=e.target.closest('.version-chip');if(!chip)return;
  const v=chip.dataset.version;
  $('#nswVersionInput').value=v;
  $('#nswVersionClear').hidden=false;
  $$('input[name="nswVersionMode"]').forEach(r=>r.checked=r.value==='specific');
  $('#nswVersionInput').disabled=false;
  $$('.nsw-radio-card').forEach(c=>c.classList.toggle('active', c.querySelector('input')?.checked));
  $('#nswVersionInfo').textContent=nswValidateVersion(v);
  checkNswJava(v);
  nswRender();
});
const debouncedNswValidate=debounce(()=>{
  const v=$('#nswVersionInput').value.trim();
  $('#nswVersionClear').hidden=!v;
  renderNswChips(v);
  const info=$('#nswVersionInfo');
  if(info)info.textContent=v?nswValidateVersion(v):'Pick a chip above or type any version — checked live against the official list.';
  checkNswJava(v);
  nswRender();
},250);
$('#nswVersionInput')?.addEventListener('input',debouncedNswValidate);
$('#nswVersionClear')?.addEventListener('click',()=>{
  $('#nswVersionInput').value='';
  $('#nswVersionClear').hidden=true;
  renderNswChips('');
  $('#nswVersionInfo').textContent='Pick a chip above or type any version — checked live against the official list.';
  $('#nswVersionInput').focus();
});
// Memory step: one updater drives the big readout, slider fill, preset chips and the rail.
function nswUpdateMemory(){
  const s=$('#nswMemorySlider');
  const v=Number(s.value)||4,min=Number(s.min)||1,max=Number(s.max)||16;
  $('#nswMemoryValue').textContent=v;
  s.style.setProperty('--p',Math.round((v-min)/(max-min)*100)+'%');
  const desc=$('#nswRamDesc');
  if(desc){desc.textContent=t('nsw.mem'+(v<=2?1:v<=4?2:v<=8?3:4));desc.className='nsw2-memory-desc '+(v<=4?'ok':v<=8?'warn':'bad')}
  $$('.nsw2-mempresets .filter-chip').forEach(c=>c.classList.toggle('active',Number(c.dataset.mem)===v));
  $('#nswRailSub3').textContent=`${v} GB`;
}
$$('.nsw2-mempresets .filter-chip').forEach(b=>b.onclick=()=>{$('#nswMemorySlider').value=b.dataset.mem;nswUpdateMemory()});
$('#nswMemorySlider').addEventListener('input',nswUpdateMemory);
$('#nswShowTech')?.addEventListener('change', e=>{ const show=e.target.checked; $$('.card-tech').forEach(el=> el.hidden=!show); });
$('#nswBack').onclick=()=>{nsw.step=Math.max(1,nsw.step-1);nswRender()};
function formatBytes(n){if(n==null)return'';if(n<1024)return`${n} B`;if(n<1024*1024)return`${(n/1024).toFixed(0)} KB`;return`${(n/1024/1024).toFixed(1)} MB`}
// FEATURE: real byte progress for the wizard's download step — registered once here (same pattern as
// onLog/onState/onFiles above) rather than subscribed per-click, so repeated wizard runs don't stack
// up duplicate listeners. Harmless to keep receiving events when the modal isn't open; the elements
// just sit updated and hidden.
window.observer.onWizardProgress(({received,total})=>{
  const fill=$('#nswProgressFill'),label=$('#nswProgressLabel');if(!fill)return;
  if(total>0){fill.classList.remove('indeterminate');fill.style.width=`${Math.min(100,Math.round(received/total*100))}%`;label.textContent=`${formatBytes(received)} / ${formatBytes(total)} (${Math.min(100,Math.round(received/total*100))}%)`}
  else{fill.classList.add('indeterminate');label.textContent=`${formatBytes(received)} downloaded…`}
});
$('#nswNext').onclick=async()=>{
  if(nsw.step<4){nsw.step++;nswRender();return}
  const software=nsw.software;
  const versionMode=$$('input[name="nswVersionMode"]').find(r=>r.checked)?.value;
  const version=versionMode==='specific'?$('#nswVersionInput').value.trim():'';
  const memory=Number($('#nswMemorySlider').value)||4;
  $('#nswNext').disabled=true;$('#nswNext').textContent='Downloading…';$('#nswBack').disabled=true;
  $('#nswProgress').hidden=false;$('#nswProgressFill').style.width='0%';$('#nswProgressFill').classList.add('indeterminate');$('#nswProgressLabel').textContent='Starting download…';
  const settingsNext={...getSettings(),memoryMin:Math.max(1,Math.floor(memory/2)),memoryMax:memory};
  const sr=await window.observer.saveSettings(settingsNext);state={...state,settings:settingsNext,java:sr.java};
  const r=await window.observer.wizardCreate({software,version});
  $('#nswNext').disabled=false;$('#nswBack').disabled=false;$('#nswProgress').hidden=true;
  if(!r.ok){toast(r.error,'error');return}
  $('#newServerModal').hidden=true;nsw={step:1,software:'vanilla'};nswVersions={software:null,list:[],latest:null,raw:false,loading:false,failed:false,error:''};
  if(r.building){toast(`${r.name} started in the background — this can take several minutes. Watch the Console tab for progress.`);switchTab('console');return}
  state.files=r.files;refreshUI();switchTab('overview');
  toast(`Your server is ready. Press "Start server" at the top when you're ready to play.`,'success');
};
function openNewServerWizard(){
  nsw={step:1,software:'vanilla'};
  nswVersions={software:null,list:[],latest:null,raw:false,loading:false,failed:false,error:''};
  nswJava={version:'',java:null,exact:false};
  const jc=$('#nswJavaCheck');if(jc)jc.hidden=true;
  $$('[data-software]').forEach(x=>x.classList.toggle('active',x.dataset.software==='vanilla'));
  $('#nswVersionInput').disabled=true;
  $$('input[name="nswVersionMode"]').forEach(r=>r.checked=r.value==='latest');
  $$('.nsw-radio-card').forEach(c=>c.classList.toggle('active', c.querySelector('input')?.value==='latest'));
  $('#nswVersionPicker').hidden=true;
  $('#nswVersionInput').value='';$('#nswVersionClear').hidden=true;
  $('#nswLatestLabel').textContent='Resolving latest…';
  $('#nswMemorySlider').value=4;$('#nswMemoryValue').textContent='4';
  $('#nswProgress').hidden=true;
  nswRender();$('#newServerModal').hidden=false;
}
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
if(updateBtn)updateBtn.onclick=async()=>{const st=$('#updateStatus');if(st)st.textContent=t('upd.checking');await window.observer.checkUpdate();};
window.observer.onUpdateAvailable(v=>{const st=$('#updateStatus');if(st)st.innerHTML=t('upd.available',{v:v.version})+' <button class="btn primary sm" id="dlBtn">'+t('upd.download')+'</button>';const b=$('#dlBtn');if(b)b.onclick=()=>window.observer.downloadUpdate();});
window.observer.onUpdateProgress(p=>{const st=$('#updateStatus');if(st)st.textContent=t('upd.downloading',{p:Math.round(p.percent)});});
window.observer.onUpdateDownloaded(()=>{const st=$('#updateStatus');if(st)st.innerHTML=t('upd.ready')+' <button class="btn primary sm" id="installBtn">'+t('upd.install')+'</button>';const b=$('#installBtn');if(b)b.onclick=()=>window.observer.quitInstall();});
window.observer.onUpdateNone&&window.observer.onUpdateNone(()=>{const st=$('#updateStatus');if(st)st.textContent=t('upd.none');});
