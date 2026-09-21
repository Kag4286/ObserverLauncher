// js/07-overview.js — split from app.js (lines 999-1126); classic script, load in numeric order.
// Overview + Performance + Settings panels rendering.
let uptimeStart=null;
// BUGFIX: the server.properties / velocity.toml editors used to be re-rendered on EVERY refreshUI()
// call (each incoming server:files / server:state event — a whitelist toggle, start/stop, etc.),
// silently wiping whatever the user had typed but not applied yet. While this flag is set, refreshUI
// skips re-rendering both editors; it clears on Apply or when the server folder changes.
let propsDirty=false;
// UPTIME: self-correcting to whole seconds of real uptime. A plain setInterval(…,1000)
// is phase-shifted from when the server actually started, and refreshUI() also calls
// updateUptime() directly on every state event — so two redraws could land only a few
// hundred ms apart and the clock appeared to jump faster than one second. Scheduling
// the next redraw at the next whole-second boundary of uptime keeps visible steps at
// exactly ~1s no matter when the server started or how often refreshUI runs.
let uptimeTimer=null;
function updateUptime(){
  const el=$('#heroUptime');
  clearTimeout(uptimeTimer);uptimeTimer=null;
  if(!el)return;
  if(!uptimeStart){el.textContent='—';return}
  const ms=Date.now()-uptimeStart;
  const secs=Math.max(0,Math.floor(ms/1000));
  const h=String(Math.floor(secs/3600)).padStart(2,'0'),m=String(Math.floor(secs%3600/60)).padStart(2,'0'),s=String(secs%60).padStart(2,'0');
  el.textContent=`${h}:${m}:${s}`;
  uptimeTimer=setTimeout(updateUptime,1000-(ms%1000)+5);
}
// FEATURE: capability-aware diagnostics — one quiet line inside a collapsed
// "Details & tools" disclosure. New users see numbers first; the explanation
// and manual commands wait until asked for. (Previously this panel showed a
// paragraph + 3 checklist rows + 4 buttons + a hint, all at once.)
function renderPerfDiagnostics(){
  const n=$('#perfDiagnostics');if(!n)return;
  const jar=String(state.files?.jar||'');
  const proxy=/velocity|bungee|waterfall/i.test(jar);
  const paperLike=/paper|purpur|leaf|folia/i.test(jar)||!!state.files?.hasSpigotConfig;
  if(proxy){n.innerHTML=`<div class="diag-head"><span class="diag-icon">◆</span><div><b>Proxy detected</b><p>TPS belongs to the backend servers, not this proxy.</p></div><span class="diag-badge">N/A</span></div>`;return}
  const L={full:t('perf.badgeFull'),partial:t('perf.badgePartial'),bodyF:t('perf.diagBodyFull'),bodyP:t('perf.diagBodyPartial'),list:t('perf.diagListBtn'),spark:t('perf.diagSparkBtn')};
  n.innerHTML=`
    <div class="diag-head"><span class="diag-icon ${paperLike?'ok':''}">${paperLike?'✓':'◆'}</span><div><b>${t('perf.diagT')}</b><p>${paperLike?L.bodyF:L.bodyP}</p></div><span class="diag-badge ${paperLike?'ok':''}">${paperLike?L.full:L.partial}</span></div>
    <div class="diag-actions">
      <button class="btn secondary sm" data-command="list">${L.list}</button>
      <button class="btn secondary sm" data-tab-jump="marketplace">${L.spark}</button>
    </div>`;
  n.querySelectorAll('[data-command]').forEach(b=>b.onclick=()=>command(b.dataset.command));
  n.querySelectorAll('[data-tab-jump]').forEach(b=>b.onclick=()=>switchTab(b.dataset.tabJump));
}
function refreshUI(){const s=state.settings,f=state.files;currentLocale=s.locale||'en';$('#languageSelect').value=currentLocale;applyLocale();$('#serverFolderInput').value=s.serverPath||'';$('#javaPathInput').value=s.javaPath||'';$('#playitPathInput').value=s.playitPath||'';if($('#autoTunnelInput'))$('#autoTunnelInput').checked=!!s.autoTunnel;const ml=$('#motionLevelSelect');if(ml)ml.value=s.motionLevel||'full';applyMotionLevel(s.motionLevel||'full');if($('#autoTunnelQuick'))$('#autoTunnelQuick').checked=!!s.autoTunnel;$('#memoryMinInput').value=s.memoryMin??2;$('#memoryMaxInput').value=s.memoryMax??6;$('#jvmArgsInput').value=s.jvmArgs||'';$('#autoEulaInput').checked=!!s.autoEula;$('#autoRestartInput').checked=!!s.autoRestart;$('#autoBackupMinutesInput').value=s.autoBackupMinutes??0;if($('#backupRetentionInput'))$('#backupRetentionInput').value=s.backupRetention??10;$('#autoRestartMaxAttemptsInput').value=s.autoRestartMaxAttempts??3;$('#autoRestartDelaySecondsInput').value=s.autoRestartDelaySeconds??5;syncAutoRestartFields();syncBackupChips(s.autoBackupMinutes??0);syncScheduleFields(s);syncMcpFields(s);if(state.systemMemoryGB)$('#systemRamHint').textContent=`Your system has about ${state.systemMemoryGB} GB of RAM. When set, JVM args override the two memory fields above.`;$('#serverPath').textContent=s.serverPath||t('top.noServer');$('#serverName').textContent=s.serverPath?s.serverPath.split(/[\\/]/).filter(Boolean).pop():'Your Minecraft server';$('#serverHint').textContent=s.serverPath?(state.status==='starting'?t('ov.hintStarting',{n:f.jar||f.launchScript||'server'}):state.status==='stopping'?t('top.stopping'):state.running?t('ov.hintRunning',{n:f.jar||f.launchScript||'server'}):(f.jar?t('ov.hintReady',{n:f.jar}):(f.launchScript?t('ov.hintReady',{n:f.launchScript}):t('ov.hintNone')))):t('ov.hintSelect');const statusLabel={starting:t('top.starting'),running:t('top.running'),stopping:t('top.stopping'),stopped:t('top.offline')}[state.status||(state.running?'running':'stopped')]||t('top.offline');$('#metricStatus').textContent=statusLabel;$('#statusText').textContent=statusLabel;const sd=$('#statusDot');sd.className='status-dot st-'+(state.status||'stopped');const heroDot=$('#heroDot');if(heroDot)heroDot.className='metric-hero-dot status-dot lg st-'+(state.status||'stopped');if(state.running&&!uptimeStart)uptimeStart=Date.now();if(!state.running)uptimeStart=null;updateUptime();$('#startBtn').disabled=state.status!=='stopped';$('#stopBtn').disabled=!(state.status==='running'||state.status==='starting');
  const proxy=isProxyServer();$('#eulaStatus').textContent=proxy?t('ov.eulaProxy'):(state.eulaAccepted?t('set.eulaOk').replace('✓ ',''):t('ov.eulaPending'));
  $('#worldsProxyNotice').hidden=!proxy;$('#playersProxyNotice').hidden=!proxy;
  $('#propertiesGrid').hidden=proxy;$('#propertiesRaw').hidden=!proxy;$('#saveProperties').textContent=proxy?'Save velocity.toml':t('prop.apply');
  const pt=$('.prop-toolbar');if(pt)pt.hidden=proxy;
  $('#propertiesTitle').textContent=proxy?'Proxy configuration (velocity.toml)':t('prop.title');$('#propertiesHint').textContent=proxy?'Raw file — Velocity generates this on first run, edit carefully (real TOML syntax).':t('prop.sub');
  if(proxy){ if(!propsDirty) refreshProxyProperties(); } else if(!propsDirty) renderProperties(f.properties||{});
   renderFiles('#pluginsList',f.plugins||[],'plugin');renderFiles('#modsList',f.mods||[],'mod');renderFiles('#datapacksList',f.datapacks||[],'datapack');renderWorlds(f.worlds||[]);renderBackups(f.backups||[]);
   const wc=$('#worldsCountPill'), bc=$('#backupsCountPill'), be=$('#backupEmpty'); if(wc) wc.textContent=String((f.worlds||[]).length); if(bc) bc.textContent=String((f.backups||[]).length); if(be) be.hidden=(f.backups||[]).length>0;
   const cpc=$('#contentPluginsCount'), cmc=$('#contentModsCount'), cdc=$('#contentDatapacksCount'); if(cpc) cpc.textContent=String((f.plugins||[]).length); if(cmc) cmc.textContent=String((f.mods||[]).length); if(cdc) cdc.textContent=String((f.datapacks||[]).length);
   const abs=$('#autoBackupStatus');if(abs){const mins=s.autoBackupMinutes||0;abs.innerHTML=mins>0?t('wld.autoOn',{n:mins})+' · <button class="text-btn" data-tab-jump="settings">'+t('wld.configure')+'</button>':t('wld.autoOff')+' · <button class="text-btn" data-tab-jump="settings">'+t('wld.turnOn')+'</button>';abs.querySelectorAll('[data-tab-jump]').forEach(b=>b.onclick=()=>switchTab(b.dataset.tabJump))}
  renderPlayers();renderPerfDiagnostics();const j=state.java||{},n=$('#javaNotice');const is32=j.ok&&j.arch==='32-bit';n.className='java-notice '+(!j.ok?'bad':is32?'warn':'ok');n.textContent=!j.ok?t('set.javaBad',{m:j.message||'Set a Java path or use java from PATH.'}):is32?t('set.java32',{v:j.version,p:j.path}):t('set.javaOk',{v:j.version,p:j.path});$('#javaAutoInstall').hidden=!!j.ok;
  // Launcher settings extras: folder health line + effective launch command preview.
  const fsEl=$('#folderStatus');
  if(fsEl){
    if(!s.serverPath){fsEl.textContent=t('set.folderNone');fsEl.className='field-hint folder-status'}
    else{
      const parts=[f.jar?tf('set.jarOk',{n:f.jar}):f.launchScript?tf('set.jarOk',{n:f.launchScript}):t('set.noJar'),state.eulaAccepted?t('set.eulaOk'):t('set.eulaPending')];
      fsEl.textContent=parts.join(' · ');
      fsEl.className='field-hint folder-status '+((f.jar||f.launchScript)?'ok':'');
    }
  }
  renderJvmPreview();renderSetupSteps();
  // Java compatibility banner — proactive warning + one-click fix
  const jw=$('#javaWarnBanner');
  if(jw){
    const need=state.javaRequired||null;
    const have=(j.ok&&j.version)?(javaMajorOf(j.version)):null;
    const mismatch=need&&have&&have<need;
    jw.hidden=!mismatch;
    if(mismatch){
      $('#javaWarnText').textContent=t('ov.javaMismatch',{need,have});
      $('#javaFixBtn').textContent=t('ov.fixJava')+' '+need;
      $('#javaFixBtn').onclick=async()=>{
        $('#javaFixBtn').disabled=true;$('#javaFixBtn').textContent='…';
        const r=await window.observer.javaAutoInstall();
        $('#javaFixBtn').disabled=false;
        if(r&&r.ok){state.java=r.java;state.settings={...state.settings,javaPath:r.java.path};markSettingsSaved();refreshUI();toast(t('toast.javaInstalled',{v:r.java.version}),'success')}
        else toast(r?.error||'Install failed','error');
      };
    }
  }
  const er=$('#edRunning');if(er&&!$('#fileEditor').hidden)er.hidden=!state.running;
  // console live dot
  const cd=$('#consoleLiveDot'), cl=$('#consoleLiveLabel'); if(cd&&cl){ cd.className='live-dot'+(state.status==='running'?' on':state.status==='starting'||state.status==='stopping'?' busy':''); cl.textContent={starting:t('top.starting'),running:t('con.live'),stopping:t('top.stopping'),stopped:t('top.offline')}[state.status||'stopped']||t('top.offline'); }
  // P0.1: disable Start when no folder / no runnable jar, highlight welcome card
  const hasFolder=!!s.serverPath; const hasJar=!!(f.jar||f.launchScript); const startBtn=$('#startBtn'), stopBtn=$('#stopBtn'), welcomeCard=$('#welcomeCard');
  const canStart=hasFolder && hasJar && !!j.ok && state.status==='stopped';
  if(startBtn){startBtn.disabled=!canStart; if(!hasFolder||!hasJar) startBtn.title=!hasFolder?'Choose a server folder first':!j.ok?'Java not detected — install or set Java path':'No runnable server .jar or run.bat found in this folder'; else if(state.status!=='stopped') startBtn.title={starting:'Server is starting…', stopping:'Server is stopping…', running:'Server is already running'}[state.status]||''; else startBtn.title='';}
  if(stopBtn) stopBtn.disabled=state.status==='stopped';
  // Force stop stays available through starting/running/stopping — it is the
  // escape hatch when graceful Stop hangs or was already requested.
  const forceBtn=$('#forceStopBtn');if(forceBtn)forceBtn.disabled=state.status==='stopped';
  if(welcomeCard) welcomeCard.classList.toggle('needs-attention', !hasFolder || !hasJar);
  // UX (1.1.0): a brand-new user with no folder gets a clean Overview — just the
  // hero + one choice (Choose / Create). Charts, quick actions and the connect/tunnel
  // panels are hidden until a server folder exists, so an empty first screen never
  // looks broken or overwhelming. All elements stay in the DOM (JS keeps working).
  const overviewSec=$('#overview'); if(overviewSec) overviewSec.classList.toggle('has-server', hasFolder);
  const miniEmpty=$('#miniChartEmpty'); if(miniEmpty) miniEmpty.hidden = state.status!=='stopped';
  // Performance tab: single offline banner + dimmed numbers while stopped.
  const perfSec=$('#performance'); if(perfSec) perfSec.classList.toggle('is-live', state.status==='running');
  const perfStatus=$('#perfStatus'); if(perfStatus) perfStatus.hidden = state.status!=='stopped';
  requestAnimationFrame(()=>{metricChart($('#miniChart'));metricChart($('#perfTickChart'),true,'tick');metricChart($('#perfResourceChart'),true,'resource')})}
// FEATURE: plain-language setup checklist for beginners — one glance says what
// is missing (folder / server file / Java / EULA) instead of making them decode
// mono micro-labels. Advanced users get the details via title tooltips. Chips
// use data + universal terms only, so no new i18n keys are needed.
function renderSetupSteps(){
  const n=$('#setupSteps');if(!n)return;
  const card=$('#welcomeCard');if(card)card.classList.toggle('is-running',!!state.running);
  const s=state.settings||{},f=state.files||{},j=state.java||{};
  const base=s.serverPath?s.serverPath.split(/[\\/]/).filter(Boolean).pop():'';
  const jar=f.jar||f.launchScript;
  const jm=j.ok&&j.version?javaMajorOf(j.version):null;
  const steps=[
    {t:base||t('top.noServer'),c:s.serverPath?'ok':'bad',title:s.serverPath||t('set.folderNone')},
    {t:jar||t('set.noJar'),c:jar?'ok':'bad',title:jar?tf('set.jarOk',{n:jar}):t('set.noJar')},
    j.ok
      ? {t:'Java '+(jm||j.version),c:'ok',title:tf('set.javaOk',{v:j.version,p:j.path})}
      : {t:t('ov.fixJava'),c:'bad',title:t('set.javaBad',{m:j.message||''}),tab:'settings'},
    state.eulaAccepted
      ? {t:'EULA ✓',c:'ok',title:t('set.eulaOk')}
      : {t:'EULA …',c:'warn',title:t('set.eulaPending')},
  ];
  // No news is good news: a fully-ready server shows no chips at all — the
  // hero sentence already says it's ready. Only problems surface here.
  const bad=steps.filter(c=>c.c!=='ok');
  n.hidden=bad.length===0;
  if(bad.length===0){n.innerHTML='';return}
  n.innerHTML=bad.map((c,i)=>`<li><button class="step-chip ${c.c}" data-step="${i}" title="${esc(c.title||c.t)}">${esc(c.t)}</button></li>`).join('');
  n.querySelectorAll('[data-step]').forEach(b=>b.onclick=()=>{const c=bad[Number(b.dataset.step)];if(c&&c.tab)switchTab(c.tab)});
}
function syncAutoRestartFields(){const on=$('#autoRestartInput').checked;const f=$('#autoRestartFields');if(f)f.hidden=!on}
$('#autoRestartInput').addEventListener('change',syncAutoRestartFields);
// Scheduler settings sync: toggles the time/day rows and renders a plain-language "next run"
// line so the user can see what will actually happen without reasoning about weekdays.
function syncScheduleFields(s){
  s=s||state.settings||{};
  const en=$('#scheduleEnabledInput');if(en)en.checked=!!s.scheduleEnabled;
  const st=$('#scheduleStartInput'),sp=$('#scheduleStopInput');
  if(st)st.value=s.scheduleStartTime||'';
  if(sp)sp.value=s.scheduleStopTime||'';
  const days=Array.isArray(s.scheduleDays)?s.scheduleDays:[];
  $$('#scheduleDaysRow .filter-chip').forEach(b=>b.classList.toggle('active',days.includes(Number(b.dataset.day))));
  const rows=[$('#scheduleFields'),$('#scheduleDaysRow')];
  rows.forEach(r=>{if(r)r.hidden=!s.scheduleEnabled});
  const next=$('#scheduleNext');
  if(next){
    if(!s.scheduleEnabled){next.hidden=true;next.textContent='';}
    else{
      const parts=[];
      if(s.scheduleStartTime)parts.push(t('sch.nextStart',{t:s.scheduleStartTime}));
      if(s.scheduleStopTime)parts.push(t('sch.nextStop',{t:s.scheduleStopTime}));
      next.hidden=false;
      next.textContent=parts.length?parts.join(' · ')+(days.length?' · '+t('sch.nextDays',{n:days.length}):''):t('sch.nextNone');
    }
  }
}
$('#scheduleEnabledInput')?.addEventListener('change',()=>{syncScheduleFields(getSettings())});
$('#scheduleStartInput')?.addEventListener('change',()=>{syncScheduleFields(getSettings())});
$('#scheduleStopInput')?.addEventListener('change',()=>{syncScheduleFields(getSettings())});
$$('#scheduleDaysRow .filter-chip').forEach(c=>c.onclick=()=>{c.classList.toggle('active');syncScheduleFields(getSettings())});
// MCP settings: reflect enabled/auto-allow toggles and show live server status.
function syncMcpFields(s){
  s=s||state.settings||{};
  const en=$('#mcpEnabledInput');if(en)en.checked=!!s.mcpEnabled;
  const aw=$('#mcpAutoWriteInput');if(aw)aw.checked=!!s.mcpAutoAllowWrite;
  const ro=$('#mcpReadOnlyInput');if(ro)ro.checked=!!s.mcpReadOnly;
  const st=$('#mcpStatus');
  const m=state.mcp||{};
  if(st){st.textContent=m.running?t('mcp.running',{p:m.port}):t('mcp.stopped');st.style.color=m.running?'var(--success)':'var(--text-dim)'}
  const pill=$('#mcpPill');
  if(pill){pill.textContent=m.running?t('mcp.live'):t('mcp.off');pill.className='mcp-pill'+(m.running?' on':'')}
}
$('#mcpCopyConfig')?.addEventListener('click',async()=>{
  const c=(state.mcp&&state.mcp.config)||{command:'<path-to-ObserverLauncher>',args:['<userData>/mcp/bridge.js'],env:{ELECTRON_RUN_AS_NODE:'1',OBSERVER_MCP_USERDATA:'<userData>'}};
  const cfg={mcpServers:{observerlauncher:c}};
  try{await navigator.clipboard.writeText(JSON.stringify(cfg,null,2));toast(t('mcp.copied'),'success')}catch{toast('Copy failed','error')}
});
const BACKUP_PRESETS=[0,15,30,60];
function syncBackupChips(mins){
  const isPreset=BACKUP_PRESETS.includes(mins);
  $$('.backup-chip-row .filter-chip').forEach(c=>c.classList.toggle('active',isPreset?c.dataset.backupMins==String(mins):c.id==='backupCustomChip'));
  const row=$('#backupCustomRow');if(row)row.hidden=isPreset;
  if(!isPreset){const ci=$('#autoBackupCustomInput');if(ci)ci.value=mins||''}
}
$$('.backup-chip-row .filter-chip').forEach(chip=>chip.onclick=()=>{
  const v=chip.dataset.backupMins;
  if(v==='custom'){
    $$('.backup-chip-row .filter-chip').forEach(c=>c.classList.toggle('active',c===chip));
    $('#backupCustomRow').hidden=false;
    $('#autoBackupCustomInput').focus();
    return;
  }
  $('#autoBackupMinutesInput').value=v;syncBackupChips(Number(v));
});
$('#autoBackupCustomInput')?.addEventListener('input',()=>{$('#autoBackupMinutesInput').value=Number($('#autoBackupCustomInput').value)||0});
function getSettings(){return{serverPath:$('#serverFolderInput').value.trim(),javaPath:$('#javaPathInput').value.trim(),playitPath:$('#playitPathInput').value.trim(),autoTunnel:$('#autoTunnelInput')?.checked||false,memoryMin:Number($('#memoryMinInput').value)||2,memoryMax:Number($('#memoryMaxInput').value)||6,jvmArgs:$('#jvmArgsInput').value.trim(),autoEula:$('#autoEulaInput').checked,autoRestart:$('#autoRestartInput').checked,autoRestartMaxAttempts:Number($('#autoRestartMaxAttemptsInput').value)||3,autoRestartDelaySeconds:Number($('#autoRestartDelaySecondsInput').value)||5,autoBackupMinutes:Number($('#autoBackupMinutesInput').value)||0,backupRetention:Number($('#backupRetentionInput').value)||10,scheduleEnabled:$('#scheduleEnabledInput').checked,scheduleStartTime:$('#scheduleStartInput').value||'',scheduleStopTime:$('#scheduleStopInput').value||'',scheduleDays:$$('#scheduleDaysRow .filter-chip.active').map(b=>Number(b.dataset.day)),mcpEnabled:$('#mcpEnabledInput').checked,mcpAutoAllowWrite:$('#mcpAutoWriteInput').checked,mcpReadOnly:$('#mcpReadOnlyInput')?.checked||false,motionLevel:$('#motionLevelSelect')?.value||'full',locale:$('#languageSelect').value}}
// Launcher settings polish: an "unsaved changes" dot on Apply, a folder health line and a live
// preview of the exact command line the launcher will run for this server.
let settingsDirty=false;
function updateApplyDirty(){const b=$('#saveSettings');if(b)b.classList.toggle('dirty',settingsDirty)}
function markSettingsSaved(){settingsDirty=false;updateApplyDirty()}
function renderJvmPreview(){
  const el=$('#jvmPreview');if(!el)return;
  const s=state.settings||{},f=state.files||{};
  const jar=f.jar||f.launchScript;
  if(!jar){el.hidden=true;return}
  const custom=String(s.jvmArgs||'').trim();
  const args=custom?custom:`-Xms${s.memoryMin||2}G -Xmx${s.memoryMax||6}G`;
  el.hidden=false;
  el.textContent=`${(state.java&&state.java.path)||'java'} ${args} -jar ${jar}${/velocity/i.test(jar)?'':' nogui'}`;
}
// SETTINGS sub-tabs (Basic / Advanced): sliding glider + pane swap. Beginner-first —
// everyday settings (folder, Java, preferences, reliability) stay on Basic; path/MCP/JVM
// power controls live on Advanced. Glider measured in JS (labels differ in width).
(function(){
  const seg=$('#settingsSeg'); if(!seg) return;
  const btns=[...seg.querySelectorAll('.seg-switch-btn')];
  const glider=seg.querySelector('.seg-switch-glider');
  const panes=[...document.querySelectorAll('#settings .set-pane')];
  // BUGFIX: the Settings tab is display:none until the user opens it, so at boot
  // the buttons measure 0px — the glider got width:0 and never showed until a click.
  // Guard against zero-size writes, and re-measure whenever the switch becomes
  // visible/laid-out (ResizeObserver fires when the hidden tab is shown).
  function move(btn){ if(!glider||!btn) return; const w=btn.offsetWidth; if(!w) return; glider.style.left=btn.offsetLeft+'px'; glider.style.width=w+'px'; }
  function current(){ return btns.find(b=>b.classList.contains('active'))||btns[0]; }
  function selectView(view){
    btns.forEach(b=>{const on=b.dataset.setView===view;b.classList.toggle('active',on);b.setAttribute('aria-selected',on?'true':'false')});
    panes.forEach(p=>{const on=p.dataset.setPane===view;p.hidden=!on});
    move(btns.find(b=>b.dataset.setView===view));
  }
  btns.forEach(b=>b.addEventListener('click',()=>selectView(b.dataset.setView)));
  window.addEventListener('resize',()=>move(current()));
  if(typeof ResizeObserver==='function'){ new ResizeObserver(()=>move(current())).observe(seg); }
  requestAnimationFrame(()=>move(current()));
})();
(function(){
  const sec=$('#settings');if(!sec)return;
  const onEdit=e=>{if(e.target.closest('#settings')&&!e.target.closest('#newServerModal')){settingsDirty=true;updateApplyDirty()}};
  sec.addEventListener('input',onEdit);sec.addEventListener('change',onEdit);
})();
$('#jvmArgsInput')?.addEventListener('input',renderJvmPreview);
