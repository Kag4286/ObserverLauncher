async function refreshResourcePackUI() {
  try {
    const r = await window.observer.resourcepackGet();
    const badge = $('#rpActiveName');
    const clearBtn = $('#rpClearBtn');
    const desc = $('#rpDesc');
    if (r && r.active && r.info && r.info.ok) {
      if (badge) badge.textContent = r.info.name;
      if (clearBtn) clearBtn.hidden = false;
      if (desc && r.info.description) desc.textContent = r.info.description;
    } else {
      if (badge) badge.textContent = t('set.rpNone');
      if (clearBtn) clearBtn.hidden = true;
      if (desc) desc.textContent = t('set.resourcePackSub');
    }
  } catch {}
}
// js/07-overview.js — split from app.js (lines 999-1126); classic script, load in numeric order.
// Overview + Performance + Settings panels rendering.
let uptimeStart=null;
// v4.0.0: the Overview connect panel auto-opens once per server run (see refreshUI).
let ovConnectAutoOpened=false;
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
function formatUptimeStr(startMs){
  if(!startMs) return '—';
  const secs=Math.max(0,Math.floor((Date.now()-startMs)/1000));
  const h=String(Math.floor(secs/3600)).padStart(2,'0'),m=String(Math.floor(secs%3600/60)).padStart(2,'0'),s=String(secs%60).padStart(2,'0');
  return `${h}:${m}:${s}`;
}
function updateUptime(){
  const el=$('#perfUptime');
  clearTimeout(uptimeTimer);uptimeTimer=null;
  const str=formatUptimeStr(uptimeStart);
  if(el) el.textContent=str;
  if(!uptimeStart) return;
  const ms=Date.now()-uptimeStart;
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
  const isNat = (state.files?.engineType === 'native') || !!state.files?.nativeBinary || (state.files?.target && state.files?.target.software === 'horizon');
  if(isNat){
    n.innerHTML = `<div class="diag-head"><span class="diag-icon ok">✓</span><div><b>${t('perf.diagNativeTitle')}</b><p>${t('perf.diagNativeBody')}</p></div><span class="diag-badge ok">Native</span></div>
    <div class="diag-actions">
      <button class="btn secondary sm" data-command="list">${t('perf.diagListBtn')}</button>
    </div>`;
    n.querySelectorAll('[data-command]').forEach(b=>b.onclick=()=>command(b.dataset.command));
    return;
  }
  if(proxy){n.innerHTML=`<div class="diag-head"><span class="diag-icon">◆</span><div><b>${t('perf.proxyTitle')}</b><p>${t('perf.proxyBody')}</p></div><span class="diag-badge">N/A</span></div>`;return}
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
function refreshUI(){const s=state.settings||{},f=state.files||{};currentLocale=s.locale||'en';$('#languageSelect').value=currentLocale;applyLocale();$('#serverFolderInput').value=s.serverPath||'';$('#javaPathInput').value=s.javaPath||'';$('#playitPathInput').value=s.playitPath||'';$('#pinggyPathInput').value=s.pinggyPath||'';const tm=$('#tunnelManual');if(tm&&document.activeElement!==tm)tm.value=s.tunnelAddress||'';const cfk=$('#cfKeyInput');if(cfk)cfk.value=s.curseforgeApiKey||'';if($('#autoTunnelInput'))$('#autoTunnelInput').checked=!!s.autoTunnel;const ml=$('#motionLevelSelect');if(ml)ml.value=s.motionLevel||'full';applyMotionLevel(s.motionLevel||'full');if($('#beginnerModeInput'))$('#beginnerModeInput').checked=!!s.beginnerMode;if(typeof applyBeginnerMode==='function')applyBeginnerMode(s.beginnerMode);if($('#worldmapCheatModeInput'))$('#worldmapCheatModeInput').checked=!!s.worldmapCheatMode;if(typeof wmSyncCheatMode==='function')wmSyncCheatMode();if($('#updatePolicySelect'))$('#updatePolicySelect').value=(s.updatePolicy||(s.autoCheckUpdates===false?'off':'ask'));
  if($('#webhookUrlInput'))$('#webhookUrlInput').value=s.webhookUrl||'';
  if($('#webhookFormatSelect'))$('#webhookFormatSelect').value=s.webhookFormat||'discord';
  if($('#webhookUsernameInput'))$('#webhookUsernameInput').value=s.webhookUsername||'';
  if($('#webhookCrashMentionInput'))$('#webhookCrashMentionInput').value=s.webhookCrashMention||'';
  if($('#webhookPlayerAvatarsInput'))$('#webhookPlayerAvatarsInput').checked=s.webhookPlayerAvatars!==false;
  if($('#discordRpcEnabledInput'))$('#discordRpcEnabledInput').checked=!!s.discordRpcEnabled;
  if($('#discordRpcClientIdInput'))$('#discordRpcClientIdInput').value=s.discordRpcClientId||'';
  if($('#discordRpcShowServerNameInput'))$('#discordRpcShowServerNameInput').checked=s.discordRpcShowServerName!==false;
  if($('#discordRpcShowPlayersInput'))$('#discordRpcShowPlayersInput').checked=s.discordRpcShowPlayers!==false;
  if($('#discordRpcShowIdleInput'))$('#discordRpcShowIdleInput').checked=s.discordRpcShowIdle!==false;
  // v6.0.0 F4: Prometheus toggle + port + live status line.
  if($('#prometheusEnabledInput'))$('#prometheusEnabledInput').checked=!!s.prometheusEnabled;
  if($('#prometheusPortInput'))$('#prometheusPortInput').value=s.prometheusPort||0;
  // v6.0.0 F4: status line reflects the toggle for immediate feedback, then the live backend
  // state once it has one. Reading the toggle (not just state.prometheus) means the line shows the
  // moment the user enables it, without waiting for an Apply, and it cannot vanish when a later
  // refreshUI drops state.prometheus.
  updatePromStatus();updateDiscordRpcStatus();refreshResourcePackUI();
  {const evs=Array.isArray(s.webhookEvents)?s.webhookEvents:['start','stop','crash'];$$('#webhookEvents input[data-wh-event]').forEach(x=>{x.checked=evs.includes(x.dataset.whEvent)})}if($('#autoTunnelQuick'))$('#autoTunnelQuick').checked=!!s.autoTunnel;$('#memoryMinInput').value=s.memoryMin??2;$('#memoryMaxInput').value=s.memoryMax??6;$('#jvmArgsInput').value=s.jvmArgs||'';$('#autoEulaInput').checked=!!s.autoEula;$('#autoRestartInput').checked=!!s.autoRestart;$('#autoBackupMinutesInput').value=s.autoBackupMinutes??0;if($('#backupRetentionInput'))$('#backupRetentionInput').value=s.backupRetention??10;$('#autoRestartMaxAttemptsInput').value=s.autoRestartMaxAttempts??3;$('#autoRestartDelaySecondsInput').value=s.autoRestartDelaySeconds??5;syncAutoRestartFields();syncBackupChips(s.autoBackupMinutes??0);syncScheduleFields(s);syncMcpFields(s);syncRemoteFields(s);if(state.systemMemoryGB)$('#systemRamHint').textContent=t('ov.systemRam',{n:state.systemMemoryGB});
  // v6.0.0 G1: disable a RAM preset that exceeds the machine's RAM, and reflect the current max.
  {const sys=state.systemMemoryGB||0;$$('#ramPresets .ram-preset').forEach(b=>{const gb=Number(b.dataset.ram)||0;b.disabled=sys>0&&gb>sys;b.classList.toggle('active',Number($('#memoryMaxInput')?.value)===gb&&Number($('#memoryMinInput')?.value)===gb)})}$('#serverPath').textContent=s.serverPath||t('top.noServer');$('#serverName').textContent=s.serverPath?s.serverPath.split(/[\\/]/).filter(Boolean).pop():t('ov.defaultName');$('#serverHint').textContent=s.serverPath?(state.status==='starting'?t('ov.hintStarting',{n:f.jar||f.launchScript||f.nativeBinary||'server'}):state.status==='stopping'?t('top.stopping'):state.running?t('ov.hintRunning',{n:f.jar||f.launchScript||f.nativeBinary||'server'}):(f.jar?t('ov.hintReady',{n:f.jar}):(f.launchScript?t('ov.hintReady',{n:f.launchScript}):(f.nativeBinary?t('ov.hintReady',{n:f.nativeBinary}):t('ov.hintNone'))))):t('ov.hintSelect');const statusLabel={starting:t('top.starting'),running:t('top.running'),stopping:t('top.stopping'),stopped:t('top.offline')}[state.status||(state.running?'running':'stopped')]||t('top.offline');$('#metricStatus').textContent=statusLabel;$('#statusText').textContent=statusLabel;const sd=$('#statusDot');sd.className='status-dot st-'+(state.status||'stopped');const heroDot=$('#heroDot');if(heroDot)heroDot.className='metric-hero-dot status-dot lg st-'+(state.status||'stopped');if(state.running&&!uptimeStart)uptimeStart=Date.now();if(!state.running)uptimeStart=null;updateUptime();$('#startBtn').disabled=state.status!=='stopped';$('#stopBtn').disabled=!(state.status==='running'||state.status==='starting');
  if(typeof applyBeginnerMode==='function')applyBeginnerMode(state.settings&&state.settings.beginnerMode);
  const proxy=isProxyServer();$('#eulaStatus').textContent=proxy?t('ov.eulaProxy'):(state.eulaAccepted?t('set.eulaOk').replace('✓ ',''):t('ov.eulaPending'));
  $('#worldsProxyNotice').hidden=!proxy;$('#playersProxyNotice').hidden=!proxy;
  $('#propertiesGrid').hidden=proxy;$('#propertiesRaw').hidden=!proxy;if($('#proxyRawHead'))$('#proxyRawHead').hidden=!proxy;if($('#proxyServersPanel'))$('#proxyServersPanel').hidden=!proxy;$('#saveProperties').textContent=proxy?'Save velocity.toml':t('prop.apply');
  const pt=$('.prop-toolbar');if(pt)pt.hidden=proxy;
  $('#propertiesHint').textContent=proxy?t('prop.proxySub'):t('prop.sub');
  if(typeof syncTopbarHeader==='function')syncTopbarHeader();
  try{ if(proxy){ if(!propsDirty) refreshProxyProperties(); } else if(!propsDirty) renderProperties(f.properties||{}); }catch(e){console.warn('props render error:',e)}
  const cur = typeof currentTab === 'string' ? currentTab : (typeof _lastTab === 'string' ? _lastTab : (window.currentTab || 'overview'));
  try{
    if(cur === 'content'){
      renderFiles('#pluginsList',f.plugins||[],'plugin');renderFiles('#modsList',f.mods||[],'mod');renderFiles('#datapacksList',f.datapacks||[],'datapack');
    }
    if(cur === 'worlds' || cur === 'overview'){
      renderWorlds(f.worlds||[]);renderBackups(f.backups||[]);
    }
  }catch(e){console.warn('files render error:',e)}
   const wc=$('#worldsCountPill'), bc=$('#backupsCountPill'), be=$('#backupEmpty'); if(wc) wc.textContent=String((f.worlds||[]).length); if(bc) bc.textContent=String((f.backups||[]).length); if(be) be.hidden=(f.backups||[]).length>0;
   const cpc=$('#contentPluginsCount'), cmc=$('#contentModsCount'), cdc=$('#contentDatapacksCount'); if(cpc) cpc.textContent=String((f.plugins||[]).length); if(cmc) cmc.textContent=String((f.mods||[]).length); if(cdc) cdc.textContent=String((f.datapacks||[]).length);
   if(typeof syncContentKindAuto==='function')syncContentKindAuto();if(typeof updateContentToolbarState==='function')updateContentToolbarState();if(typeof syncMarketControls==='function')syncMarketControls(false);
   const abs=$('#autoBackupStatus');if(abs){const mins=s.autoBackupMinutes||0;abs.innerHTML=mins>0?t('wld.autoOn',{n:mins})+' · <button class="text-btn" data-tab-jump="settings">'+t('wld.configure')+'</button>':t('wld.autoOff')+' · <button class="text-btn" data-tab-jump="settings">'+t('wld.turnOn')+'</button>';abs.querySelectorAll('[data-tab-jump]').forEach(b=>b.onclick=()=>switchTab(b.dataset.tabJump))}
  if(cur === 'players'){ try{ renderPlayers(); }catch(e){console.warn('players render error:',e)} }
  if(cur === 'performance'){ try{ renderPerfDiagnostics(); }catch(e){console.warn('perf diag render error:',e)} }const j=state.java||{},sPathSet=!!((s.javaPath||'').trim());
const need=state.javaRequired||requiredJavaOf((state.files&&state.files.jar)||'');
const { mismatch, tooNew } = renderJavaNoticeUI(j, need, null);
// Show the install button when Java is missing, too OLD, or too NEW (so the user can switch to the
// exact version the server needs - e.g. downgrade Java 25 -> 21 for a 1.21.1 server).
// Show Install when Java is missing, mismatched/too-new, OR still coming from PATH (no managed
// javaPath set) - so a run.bat server with no jar can still pin a specific runtime.
const isNatSetting=f.engineType==='native'||!!f.nativeBinary||(f.target&&(f.target.software==='horizon'||f.target.software==='pumpkin'));
  const docBtn=$('#doctorOpenBtn'); if(docBtn) docBtn.hidden=!s.serverPath;
  const upgBtn=$('#upgradeServerBtn'); if(upgBtn) upgBtn.hidden=!s.serverPath||isNatSetting||!(f.jar||f.launchScript);
$('#javaAutoInstall').hidden=isNatSetting||!!(j.ok&&sPathSet&&!mismatch&&!tooNew);
  if(!isNatSetting) populateJavaPicker(j);
  else { const jpRow=$('#javaPickRow'); if(jpRow) jpRow.hidden=true; }
  const jt=$('#setJavaTopic'); if(jt) jt.hidden=isNatSetting;
  const nt=$('#setNativeTopic');
  if(nt){
    nt.hidden=!isNatSetting;
    const isPumpkin=(f.target&&f.target.software==='pumpkin')||(f.nativeBinary&&/pumpkin/i.test(f.nativeBinary))||f.hasPumpkinConfig;
    const titleEl=$('#setNativeEngineTitle');
    if(titleEl) titleEl.textContent=isPumpkin?t('set.nativeEnginePumpkinT'):t('set.nativeEngineT');
    const noticeEl=$('#nativeNotice');
    if(noticeEl) noticeEl.textContent=isPumpkin?t('set.nativeNoticePumpkin'):t('set.nativeNotice');
    const nbb=$('#nativeBinBadge');
    if(nbb) nbb.textContent=f.nativeBinary||(isPumpkin?'pumpkin.exe':'horizon-server.exe');
  }
  const shSub=$('#settingsHeadSub');
  if(shSub) shSub.textContent=isNatSetting?t('set.subNative'):t('set.sub');

  // Launcher settings extras: folder health line + effective launch command preview.
  const fsEl=$('#folderStatus');
  if(fsEl){
    if(!s.serverPath){fsEl.textContent=t('set.folderNone');fsEl.className='field-hint folder-status'}
    else{
      const parts=[f.jar?tf('set.jarOk',{n:f.jar}):f.launchScript?tf('set.jarOk',{n:f.launchScript}):f.nativeBinary?tf('set.jarOk',{n:f.nativeBinary}):t('set.noJar'),state.eulaAccepted?t('set.eulaOk'):t('set.eulaPending')];
      fsEl.textContent=parts.join(' · ');
      fsEl.className='field-hint folder-status '+((f.jar||f.launchScript||f.nativeBinary)?'ok':'');
    }
  }
  renderJvmPreview();renderSetupSteps();
  // Java compatibility banner — proactive warning + one-click fix
  const jw=$('#javaWarnBanner');
  if(jw){
    const isNat=f.engineType==='native'||!!f.nativeBinary||(f.target&&(f.target.software==='horizon'||f.target.software==='pumpkin'));
    const need=isNat?null:(state.javaRequired||null);
    const have=(j.ok&&j.version)?(javaMajorOf(j.version)):null;
    const mismatch=!isNat&&need&&have&&have<need;
    jw.hidden=!mismatch;
    if(mismatch){
      $('#javaWarnText').textContent=t('ov.javaMismatch',{need,have});
      $('#javaFixBtn').textContent=t('ov.fixJava')+' '+need;
      $('#javaFixBtn').onclick=async()=>{
        $('#javaFixBtn').disabled=true;$('#javaFixBtn').textContent='…';
        const r=await window.observer.javaAutoInstall();
        $('#javaFixBtn').disabled=false;
        if(r&&r.ok){_javaRuntimes=null;state.java=r.java;state.settings={...state.settings,javaPath:r.java.path};refreshUI();markSettingsSaved();toast(t('toast.javaInstalled',{v:r.java.version}),'success')}
        else toast(r?.error||'Install failed','error');
      };
    }
  }
  const er=$('#edRunning');if(er&&!$('#fileEditor').hidden)er.hidden=!state.running;
  // console live dot
  const cd=$('#consoleLiveDot'), cl=$('#consoleLiveLabel'); if(cd&&cl){ cd.className='live-dot'+(state.status==='running'?' on':state.status==='starting'||state.status==='stopping'?' busy':''); cl.textContent={starting:t('top.starting'),running:t('con.live'),stopping:t('top.stopping'),stopped:t('top.offline')}[state.status||'stopped']||t('top.offline'); }
  // P0.1: disable Start when no folder / no runnable jar, highlight welcome card
  const isNat=f.engineType==='native'||!!f.nativeBinary||(f.target&&(f.target.software==='horizon'||f.target.software==='pumpkin'));
  const isPumpkin=(f.target&&f.target.software==='pumpkin')||(f.nativeBinary&&/pumpkin/i.test(f.nativeBinary))||f.hasPumpkinConfig;
  const hasFolder=!!s.serverPath; const hasJar=!!(f.jar||f.launchScript||isNat); const startBtn=$('#startBtn'), stopBtn=$('#stopBtn'), welcomeCard=$('#welcomeCard');
  // 5.4.0: if the ACTIVE instance's folder is gone, Start is blocked with a specific hint.
  const activeInst=(Array.isArray(state.instances)?state.instances:[]).find(i=>i.id===state.activeInstanceId);
  const folderMissing=!!(activeInst&&activeInst.missing);
  const canStart=hasFolder && hasJar && (isNat||!!j.ok) && state.status==='stopped' && !folderMissing;
  if(startBtn){startBtn.disabled=!canStart; if(folderMissing) startBtn.title=t('inst.missingTip'); else if(!hasFolder||!hasJar) startBtn.title=!hasFolder?t('top.startTipFolder'):(!isNat&&!j.ok)?t('top.startTipJava'):t('top.startTipNoJar'); else if(state.status!=='stopped') startBtn.title={starting:t('top.startTipStarting'), stopping:t('top.startTipStopping'), running:t('top.startTipRunning')}[state.status]||''; else startBtn.title='';}
  if(stopBtn) stopBtn.disabled=state.status==='stopped';
  // Restart is offered only while the server is fully running. While it is starting or stopping a
  // restart would race the in-flight transition, so we hide the button instead.
  const restartBtn=$('#restartBtn');if(restartBtn){restartBtn.hidden=state.status!=='running';restartBtn.disabled=state.status!=='running';}
  // Force stop is the escape hatch when graceful Stop hangs mid-transition: show it during
  // starting/stopping only. While running, Restart takes its place (B1).
  const forceBtn=$('#forceStopBtn');if(forceBtn){forceBtn.hidden=state.status==='running'||state.status==='stopped';forceBtn.disabled=state.status==='stopped';}
  if(welcomeCard) welcomeCard.classList.toggle('needs-attention', !hasFolder || !hasJar);
  // v4.0.0 Overview hero: ONE obvious action in the hero (DESIGN.md 15). No folder -> Choose/Create;
  // a folder -> Start (stopped) or Open console (running). The top-bar Start is the permanent
  // control; the hero button reuses it (single start path, like perfStartBtn).
  const heroStart=$('#heroStartBtn'), heroConsole=$('#heroConsoleBtn'), heroChoose=$('#chooseFolder'), heroCreate=$('#welcomeCreateBtn');
  if(heroChoose)heroChoose.hidden=hasFolder; if(heroCreate)heroCreate.hidden=hasFolder;
  if(heroStart){heroStart.hidden=!hasFolder||state.status!=='stopped'; heroStart.disabled=!canStart; heroStart.title=(startBtn&&startBtn.title)||'';}
  if(heroConsole)heroConsole.hidden=!hasFolder||!(state.status==='running'||state.status==='starting'||state.status==='stopping');
  // Connect panel auto-opens ONCE when the server starts so the LAN address is right there to share;
  // the user can then collapse it and we never force it back open.
  const cp=$('#connectPanel');
  if(cp){ if(state.running&&hasFolder&&!ovConnectAutoOpened){cp.open=true;ovConnectAutoOpened=true} else if(!state.running){ovConnectAutoOpened=false} }
  // UX (1.1.0): a brand-new user with no folder gets a clean Overview — just the
  // hero + one choice (Choose / Create). Charts, quick actions and the connect/tunnel
  // panels are hidden until a server folder exists, so an empty first screen never
  // looks broken or overwhelming. All elements stay in the DOM (JS keeps working).
  const overviewSec=$('#overview'); if(overviewSec) overviewSec.classList.toggle('has-server', hasFolder);
  const ovAdv=$('#ovAdvanced'); if(ovAdv) ovAdv.hidden=isNat;
  // Performance tab: single offline banner + dimmed numbers while stopped.
  const perfSec=$('#performance'); if(perfSec) perfSec.classList.toggle('is-live', state.status==='running');
  const perfStatus=$('#perfStatus'); if(perfStatus) perfStatus.hidden = state.status!=='stopped';
  if(typeof renderInstanceList==='function')renderInstanceList();
  if(typeof renderAllServers==='function')renderAllServers();
  if(typeof renderInstanceAppearance==='function')renderInstanceAppearance();
  if(typeof renderTunnelOverview==='function')renderTunnelOverview();
  // v5.7.0 GEYSER: surface the Bedrock-crossplay panel only when a Geyser/Floodgate jar is present,
  // and render the config check (clone-remote-port / auth-type / haproxy / port).
  {const gb=$('#geyserBox');if(gb)gb.hidden=!(hasFolder&&f.geyser);
   // Status pill: Geyser runs INSIDE the Java server, so its state follows the server — LIVE while
   // running, OFF while stopped. If the config check found an ERROR, show a warning even when
   // running (the server is up but Bedrock players will still fail).
   const gp=$('#geyserPill');
   if(gp&&f.geyser){const gi=state.geyser;const hasErr=!!(gi&&gi.issues&&gi.issues.some(it=>it.level==='error'));
     if(hasErr&&state.running){gp.textContent=t('geyser.pillWarn');gp.className='tunnel-pill error'}
     else if(state.running){gp.textContent=t('tun.live');gp.className='tunnel-pill running'}
     else{gp.textContent=t('tun.off');gp.className='tunnel-pill'}
   }
   const gc=$('#geyserCheck');
   if(gc){const info=state.geyser;
     if(!f.geyser){gc.hidden=true;gc.innerHTML=''}
     else if(!info){gc.hidden=true;gc.innerHTML=''}
     else if(!info.issues||!info.issues.length){gc.hidden=false;gc.innerHTML='<div class="diag-head"><span class="diag-icon ok">✓</span><div><b>'+esc(t('geyser.checkOk'))+'</b><p>'+esc(t('geyser.checkOkSub'))+'</p></div></div>'}
     else{gc.hidden=false;
       const hasErr=info.issues.some(it=>it.level==='error');
       gc.innerHTML='<p class="eyebrow">'+esc(t('geyser.checkT'))+'</p><p class="text-muted">'+esc(t(hasErr?'geyser.checkErr':'geyser.checkWarn'))+'</p>'+info.issues.map(it=>'<div class="diag-head"><span class="diag-icon '+esc(it.level==='error'?'':'warn')+'">'+(it.level==='error'?'✕':'!')+'</span><div><b>'+esc(it.message)+'</b><p>'+esc(it.fix)+'</p></div></div>').join('')}
   }
    // A1 (v6.0.0): show "Apply fix" only when at least one issue is a SAFE, auto-fixable key.
    // The keys mirror geyser.js FIXABLE; the main handler re-inspects and never trusts the renderer.
    {const fb=$('#geyserFixBtn');if(fb){const FIXABLE_KEYS=['bedrock.clone-remote-port','remote.auth-type','advanced.bedrock.use-haproxy-protocol','bedrock.port'];const gi=state.geyser;const can=!!(f.geyser&&gi&&gi.issues&&gi.issues.some(it=>FIXABLE_KEYS.includes(it.key)));fb.hidden=!can}}
  }
  requestAnimationFrame(()=>{metricChart($('#perfTickChart'),true,'tick');metricChart($('#perfResourceChart'),true,'resource')})}
// FEATURE: plain-language setup checklist for beginners — one glance says what
// is missing (folder / server file / Java / EULA) instead of making them decode
// mono micro-labels. Advanced users get the details via title tooltips. Chips
// use data + universal terms only, so no new i18n keys are needed.
function renderSetupSteps(){
  const n=$('#setupSteps');if(!n)return;
  const card=$('#welcomeCard');if(card)card.classList.toggle('is-running',!!state.running);
  const s=state.settings||{},f=state.files||{},j=state.java||{};
  const base=s.serverPath?s.serverPath.split(/[\\/]/).filter(Boolean).pop():'';
  const isNat=f.engineType==='native'||!!f.nativeBinary||(f.target&&(f.target.software==='horizon'||f.target.software==='pumpkin'));
  const isPumpkin=(f.target&&f.target.software==='pumpkin')||(f.nativeBinary&&/pumpkin/i.test(f.nativeBinary))||f.hasPumpkinConfig;
  const jar=f.jar||f.launchScript||f.nativeBinary;
  const jm=j.ok&&j.version?javaMajorOf(j.version):null;
  const steps=[
    {t:base||t('top.noServer'),c:s.serverPath?'ok':'bad',title:s.serverPath||t('set.folderNone')},
    {t:jar||t('set.noJar'),c:jar?'ok':'bad',title:jar?tf('set.jarOk',{n:jar}):t('set.noJar')},
    (isNat||j.ok)
      ? {t:isNat?t('nsw.nativeEngine'):('Java '+(jm||j.version)),c:'ok',title:isNat?(isPumpkin?t('set.nativeEnginePumpkinT'):'Native Horizon engine'):tf('set.javaOk',{v:j.version,p:j.path})}
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
// Scheduler settings sync: toggles the time/day/rules rows and renders a plain-language "next run"
// line so the user can see what will actually happen without reasoning about weekdays.
let _scheduleRulesDraft=[];
function renderScheduleRules(){
  const list=$('#scheduleRulesList'); if(!list) return;
  if(!_scheduleRulesDraft.length){
    list.innerHTML=`<div class="field-hint">${esc(t('sch.rulesEmpty'))}</div>`;
    return;
  }
  const actLabel=a=>a==='backup'?t('sch.ruleActionBackup'):(a==='command'?t('sch.ruleActionCommand'):t('sch.ruleActionRestart'));
  list.innerHTML=_scheduleRulesDraft.map((r,idx)=>{
    const detail=r.action==='command'?`${actLabel(r.action)}: ${r.command}`:actLabel(r.action);
    return `<div class="sch-rule-row"><span class="sch-rule-time">${esc(r.time)}</span><span class="sch-rule-desc" title="${esc(detail)}">${esc(detail)}</span><button type="button" class="btn xs danger-ghost" data-del-rule="${idx}">${esc(t('sch.ruleRemove'))}</button></div>`;
  }).join('');
  list.querySelectorAll('[data-del-rule]').forEach(b=>b.onclick=()=>{
    const i=Number(b.dataset.delRule);
    if(Number.isInteger(i)&&i>=0&&i<_scheduleRulesDraft.length){
      _scheduleRulesDraft.splice(i,1);
      renderScheduleRules();
      syncScheduleFields(getSettings(),{keepDraft:true});
      $('#settings')?.dispatchEvent(new Event('change',{bubbles:true}));
    }
  });
}
function syncScheduleFields(s,opts){
  s=s||state.settings||{};
  const en=$('#scheduleEnabledInput');if(en)en.checked=!!s.scheduleEnabled;
  const st=$('#scheduleStartInput'),sp=$('#scheduleStopInput'),sr=$('#scheduleRestartInput');
  if(st)st.value=s.scheduleStartTime||'';
  if(sp)sp.value=s.scheduleStopTime||'';
  if(sr)sr.value=s.scheduleRestartTime||'';
  const cd=$('#scheduleCountdownSelect');
  if(cd){cd.value=String(Number.isFinite(Number(s.scheduleCountdownSec))?Number(s.scheduleCountdownSec):60);cd.closest('.ol-dd')?._olSync?.();}
  const se=$('#scheduleSkipEmptyInput');
  if(se)se.checked=s.scheduleSkipCountdownIfEmpty!==false;
  if(!(opts&&opts.keepDraft)){
    _scheduleRulesDraft=Array.isArray(s.scheduleRules)?s.scheduleRules.map(r=>({...r})):[];
  }
  renderScheduleRules();
  const days=Array.isArray(s.scheduleDays)?s.scheduleDays:[];
  $$('#scheduleDaysRow .filter-chip').forEach(b=>b.classList.toggle('active',days.includes(Number(b.dataset.day))));
  const rows=[$('#scheduleFields'),$('#scheduleSkipEmptyRow'),$('#scheduleDaysRow'),$('#scheduleRulesBox')];
  rows.forEach(r=>{if(r)r.hidden=!s.scheduleEnabled});
  const next=$('#scheduleNext');
  if(next){
    if(!s.scheduleEnabled){next.hidden=true;next.textContent='';}
    else{
      const parts=[];
      if(s.scheduleStartTime)parts.push(t('sch.nextStart',{t:s.scheduleStartTime}));
      if(s.scheduleStopTime)parts.push(t('sch.nextStop',{t:s.scheduleStopTime}));
      if(s.scheduleRestartTime)parts.push(t('sch.nextRestart',{t:s.scheduleRestartTime}));
      if(_scheduleRulesDraft.length)parts.push(`+${_scheduleRulesDraft.length}`);
      next.hidden=false;
      next.textContent=parts.length?parts.join(' · ')+(days.length?' · '+t('sch.nextDays',{n:days.length}):''):t('sch.nextNone');
    }
  }
}
$('#scheduleEnabledInput')?.addEventListener('change',()=>{syncScheduleFields(getSettings(),{keepDraft:true})});
$('#scheduleStartInput')?.addEventListener('change',()=>{syncScheduleFields(getSettings(),{keepDraft:true})});
$('#scheduleStopInput')?.addEventListener('change',()=>{syncScheduleFields(getSettings(),{keepDraft:true})});
$('#scheduleRestartInput')?.addEventListener('change',()=>{syncScheduleFields(getSettings(),{keepDraft:true})});
$('#scheduleRuleAction')?.addEventListener('change',()=>{
  const cmd=$('#scheduleRuleCommand');
  if(cmd)cmd.hidden=$('#scheduleRuleAction').value!=='command';
});
$('#scheduleRuleAddBtn')?.addEventListener('click',()=>{
  const action=$('#scheduleRuleAction')?.value||'backup';
  const time=($('#scheduleRuleTime')?.value||'').trim();
  const command=($('#scheduleRuleCommand')?.value||'').trim();
  if(!time)return toast(t('sch.ruleNeedTime'),'error');
  if(action==='command'&&(!command||/[\r\n]/.test(command)))return toast(t('sch.ruleNeedCmd'),'error');
  const days=$$('#scheduleDaysRow .filter-chip.active').map(b=>Number(b.dataset.day));
  _scheduleRulesDraft.push({id:'rule-'+Date.now().toString(36),enabled:true,time,days,action,command:action==='command'?command:''});
  if($('#scheduleRuleCommand'))$('#scheduleRuleCommand').value='';
  renderScheduleRules();
  syncScheduleFields(getSettings(),{keepDraft:true});
  $('#settings')?.dispatchEvent(new Event('change',{bubbles:true}));
});
$$('#scheduleDaysRow .filter-chip').forEach(c=>c.onclick=()=>{c.classList.toggle('active');syncScheduleFields(getSettings(),{keepDraft:true})});
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
  const prev=$('#mcpConfigPreview');
  if(prev)prev.textContent=mcpConfigText();
}
// The MCP client config JSON — shared by the copy buttons + the in-app preview.
function mcpConfigText(){
  const c=(state.mcp&&state.mcp.config)||{command:'<path-to-ObserverLauncher>',args:['<userData>/mcp/bridge.js'],env:{ELECTRON_RUN_AS_NODE:'1',OBSERVER_MCP_USERDATA:'<userData>'}};
  return JSON.stringify({mcpServers:{observerlauncher:c}},null,2);
}
async function copyMcpConfig(){try{await navigator.clipboard.writeText(mcpConfigText());toast(t('mcp.copied'),'success')}catch{toast('Copy failed','error')}}
$('#mcpCopyConfig')?.addEventListener('click',copyMcpConfig);
$('#mcpCopyConfig2')?.addEventListener('click',copyMcpConfig);
// 3.3.0 remote access: reflect the toggles + show live status and the addresses to copy.
function syncRemoteFields(s){
  s=s||state.settings||{};
  const en=$('#remoteEnabledInput');if(en)en.checked=!!s.remoteEnabled;
  const ro=$('#remoteReadOnlyInput');if(ro)ro.checked=s.remoteReadOnly!==false;
  const al=$('#remoteAllowInput');if(al)al.value=s.remoteAllow||'';
  const pt=$('#remotePortInput');if(pt)pt.value=s.remotePort||0;
  const bd=$('#remoteBindInput');if(bd)bd.value=s.remoteBind||'';
  const ah=$('#remoteAllowedHostsInput');if(ah)ah.value=s.remoteAllowedHosts||'';
  const od=$('#remoteOpenDashboard');if(od)od.hidden=!(state.remote&&state.remote.running);
  const m=state.remote||{};
  const st=$('#remoteStatus');
  if(st){st.textContent=m.running?t('remote.running',{p:m.port}):t('remote.stopped');st.style.color=m.running?'var(--success)':'var(--text-dim)'}
  const pill=$('#remotePill');if(pill){pill.textContent=m.running?t('mcp.live'):t('mcp.off');pill.className='mcp-pill'+(m.running?' on':'')}
  renderRemoteAddresses(m);
  updateRemoteWildWarn();
  resetRemoteToken();
}
// v4.0.0: warn when bound off-loopback with an EMPTY allowlist (token-only protection).
function updateRemoteWildWarn(){
  const w=$('#remoteWildWarn');if(!w)return;
  const en=$('#remoteEnabledInput');const bind=String($('#remoteBindInput')?.value||'').trim();
  const allow=String($('#remoteAllowInput')?.value||'').trim();
  const offLoop=bind && bind!=='127.0.0.1' && bind!=='localhost' && bind!=='::1';
  w.hidden=!(en&&en.checked&&offLoop&&!allow);
}
// Live-update the warning as the user edits enable / bind / allow (wired once).
['remoteEnabledInput','remoteBindInput','remoteAllowInput'].forEach(id=>{const el=$('#'+id);if(el&&!el._wildWired){el._wildWired=true;el.addEventListener('input',updateRemoteWildWarn);el.addEventListener('change',updateRemoteWildWarn);}});
function renderRemoteAddresses(m){
  const box=$('#remoteAddresses');if(!box)return;
  const addrs=(m&&m.addresses)||[];
  if(!m||!m.running||!addrs.length){box.innerHTML='';return}
  box.innerHTML=addrs.map(a=>`<div class="remote-addr"><code>${esc(a)}</code><button class="text-btn" data-copy-addr="${esc(a)}">${esc(t('remote.copy'))}</button></div>`).join('');
  box.querySelectorAll('[data-copy-addr]').forEach(b=>b.onclick=async()=>{try{await navigator.clipboard.writeText(b.dataset.copyAddr);toast(t('remote.copied'),'success')}catch{toast(b.dataset.copyAddr)}});
}
// 4.3.0: the remote token is fetched on demand and NEVER kept in state — refreshUI resets the field
// to blank (masked placeholder) so it does not linger on screen after the user navigates away.
function resetRemoteToken(){const i=$('#remoteTokenInput');if(i){i.value='';i.dataset.shown=''}}
$('#remoteTokenReveal')?.addEventListener('click',async()=>{
  const i=$('#remoteTokenInput');if(!i)return;
  if(i.dataset.shown){resetRemoteToken();return}
  const r=await window.observer.getRemoteToken();
  if(r&&r.ok&&r.token){i.value=r.token;i.dataset.shown='1'}
  else toast(t('remote.tokenNone'),'error');
});
$('#remoteTokenCopy')?.addEventListener('click',async()=>{
  const r=await window.observer.getRemoteToken();
  if(r&&r.ok&&r.token){try{await navigator.clipboard.writeText(r.token);toast(t('remote.tokenCopied'),'success')}catch{toast(t('remote.tokenCopyFail'),'error')}}
  else toast(t('remote.tokenNone'),'error');
});
$('#remoteTokenRotate')?.addEventListener('click',async()=>{
  if(!await confirmDialog({title:t('remote.tokenRotate'),body:t('remote.tokenRotateConfirm'),ok:t('remote.tokenRotate'),danger:true}))return;
  const r=await window.observer.saveSettings({...getSettings(),rotateRemoteToken:true});
  if(!r||!r.ok)return toast(friendlyError(r&&r.error),'error');
  state={...state,remote:r.remote??state.remote};resetRemoteToken();markSettingsSaved();refreshUI();
  toast(t('remote.tokenRotated'),'success');
});
$('#remoteOpenDoc')?.addEventListener('click',()=>{try{window.observer.marketOpenExternal('https://github.com/Kag4286/ObserverLauncher/blob/main/docs/remote.md')}catch{}});
$('#remoteOpenDashboard')?.addEventListener('click',()=>{try{window.observer.openRemoteDashboard()}catch{}});
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
function getSettings(){return{serverPath:$('#serverFolderInput').value.trim(),javaPath:$('#javaPathInput').value.trim(),playitPath:$('#playitPathInput').value.trim(),pinggyPath:$('#pinggyPathInput').value.trim(),curseforgeApiKey:($('#cfKeyInput')?.value||'').trim(),autoTunnel:$('#autoTunnelInput')?.checked||false,memoryMin:Number($('#memoryMinInput').value)||2,memoryMax:Number($('#memoryMaxInput').value)||6,jvmArgs:$('#jvmArgsInput').value.trim(),autoEula:$('#autoEulaInput').checked,autoRestart:$('#autoRestartInput').checked,autoRestartMaxAttempts:Number($('#autoRestartMaxAttemptsInput').value)||3,autoRestartDelaySeconds:Number($('#autoRestartDelaySecondsInput').value)||5,autoBackupMinutes:Number($('#autoBackupMinutesInput').value)||0,backupRetention:Number($('#backupRetentionInput').value)||10,scheduleEnabled:$('#scheduleEnabledInput').checked,scheduleStartTime:$('#scheduleStartInput').value||'',scheduleStopTime:$('#scheduleStopInput').value||'',scheduleRestartTime:$('#scheduleRestartInput')?.value||'',scheduleCountdownSec:Number($('#scheduleCountdownSelect')?.value??60),scheduleSkipCountdownIfEmpty:$('#scheduleSkipEmptyInput')?$('#scheduleSkipEmptyInput').checked:true,scheduleRules:_scheduleRulesDraft.map(r=>({...r})),scheduleDays:$$('#scheduleDaysRow .filter-chip.active').map(b=>Number(b.dataset.day)),mcpEnabled:$('#mcpEnabledInput').checked,mcpAutoAllowWrite:$('#mcpAutoWriteInput').checked,mcpReadOnly:$('#mcpReadOnlyInput')?.checked||false,remoteEnabled:$('#remoteEnabledInput')?.checked||false,remoteReadOnly:$('#remoteReadOnlyInput')?.checked||false,remoteAllow:($('#remoteAllowInput')?.value||'').trim(),remotePort:Number($('#remotePortInput')?.value)||0,remoteBind:($('#remoteBindInput')?.value||'').trim(),remoteAllowedHosts:($('#remoteAllowedHostsInput')?.value||'').trim(),motionLevel:$('#motionLevelSelect')?.value||'full',updatePolicy:$('#updatePolicySelect')?.value||'ask',webhookUrl:($('#webhookUrlInput')?.value||'').trim(),webhookEvents:$$('#webhookEvents input[data-wh-event]:checked').map(x=>x.dataset.whEvent),webhookFormat:($('#webhookFormatSelect')?.value||'discord'),webhookUsername:($('#webhookUsernameInput')?.value||'').trim(),webhookCrashMention:($('#webhookCrashMentionInput')?.value||'').trim(),webhookPlayerAvatars:$('#webhookPlayerAvatarsInput')?$('#webhookPlayerAvatarsInput').checked:true,discordRpcEnabled:$('#discordRpcEnabledInput')?.checked||false,discordRpcClientId:($('#discordRpcClientIdInput')?.value||'').trim(),discordRpcShowIdle:$('#discordRpcShowIdleInput')?.checked||false,discordRpcShowServerName:$('#discordRpcShowServerNameInput')?$('#discordRpcShowServerNameInput').checked:true,discordRpcShowPlayers:$('#discordRpcShowPlayersInput')?$('#discordRpcShowPlayersInput').checked:true,prometheusEnabled:$('#prometheusEnabledInput')?.checked||false,prometheusPort:Number(($('#prometheusPortInput')?.value||'').replace(/[^0-9]/g,''))||0,beginnerMode:$('#beginnerModeInput')?.checked||false,worldmapCheatMode:$('#worldmapCheatModeInput')?.checked||false,locale:$('#languageSelect').value}}
// Launcher settings polish: an "unsaved changes" dot on Apply, a folder health line and a live
// preview of the exact command line the launcher will run for this server.
let settingsDirty=false;
// A JSON snapshot of the LAST SAVED form state. An edit that returns every field to this snapshot
// is not a real change, so the Apply dot must clear (was: dirty latched true until Apply).
let _settingsBaseline=null;
// v6.0.0 F4: paint #promStatusLine from BOTH the toggle (intent) and state.prometheus (live).
//    toggle off                         -> hidden
//    toggle on, not yet saved           -> 'Will start on Apply'
//    toggle on, saved, backend running  -> 'Prometheus running on port X'
//    toggle on, saved, backend not up   -> 'enabled but not running (check Console)'
// Called from refreshUI and from the toggle's own change event.
function updatePromStatus(){
  const pl=$('#promStatusLine'); if(!pl) return;
  const toggle=$('#prometheusEnabledInput');
  const on=!!(toggle&&toggle.checked);
  if(!on){ pl.hidden=true; return; }
  const live=state.prometheus||{};
  const copyBtn=$('#promCopyUrl');
  pl.hidden=false;
  // If the toggle state or the port field differs from the saved settings, show the pending message.
  const curPort = Number($('#prometheusPortInput')?.value || 0);
  const savedPort = Number(live.port || 0);
  if (on !== !!live.enabled || curPort !== savedPort) {
    pl.textContent = t('prom.pendingSave');
    if(copyBtn) copyBtn.hidden = true;
    return;
  }
  if(live.running&&live.port){ pl.textContent=t('prom.running',{p:live.port}); if(copyBtn){copyBtn.hidden=false;copyBtn.dataset.port=String(live.port);} }
  else { pl.textContent=live.enabled?t('prom.notRunning'):t('prom.pendingSave'); if(copyBtn)copyBtn.hidden=true; }
}
$('#prometheusEnabledInput')?.addEventListener('change',updatePromStatus);
$('#prometheusPortInput')?.addEventListener('input',updatePromStatus); $('#worldmapCheatModeInput')?.addEventListener('change',async()=>{const on=!!$('#worldmapCheatModeInput').checked;if(!state.settings)state.settings={};state.settings.worldmapCheatMode=on;if(typeof wmSyncCheatMode==='function')wmSyncCheatMode();try{const next={...getSettings(),worldmapCheatMode:on};const r=await window.observer.saveSettings(next);if(r&&r.ok){state={...state,settings:r.settings||next};markSettingsSaved();}}catch{}});
function renderDiscordRpcPreview(){
  const card=$('#discordRpcPreview');if(!card)return;
  const on=!!$('#discordRpcEnabledInput')?.checked;
  const showName=$('#discordRpcShowServerNameInput')?$('#discordRpcShowServerNameInput').checked:true;
  const showPlayers=$('#discordRpcShowPlayersInput')?$('#discordRpcShowPlayersInput').checked:true;
  const showIdle=$('#discordRpcShowIdleInput')?$('#discordRpcShowIdleInput').checked:true;
  const f=state.files||{},s=state.settings||{};
  const srvName=(f.target?.name||s.serverPath?.split(/[\\/]/).filter(Boolean).pop()||'Survival SMP');
  const sw=[f.target?.loader?(f.target.loader[0].toUpperCase()+f.target.loader.slice(1)):'',f.target?.mc&&f.target.mc!=='latest'?f.target.mc:''].filter(Boolean).join(' ');
  const st=state.status||(state.running?'running':'stopped');
  const detEl=$('#discordRpcPreviewDetails'),stEl=$('#discordRpcPreviewState'),tmEl=$('#discordRpcPreviewTimer'),tagEl=$('#discordRpcPreviewTag');
  const live=state.discordRpc||{};
  card.classList.toggle('dim',!on);
  card.classList.toggle('active',on&&live.state==='connected');
  if(tagEl)tagEl.textContent=on&&live.state==='connected'?(live.user?.username?`@${live.user.username}`:t('rpc.pillConnected')):t('rpc.previewTag');
  let details='ObserverLauncher',line='',showTimer=true;
  if(st==='running'){
    details=showName?`Hosting ${srvName}`:'Hosting Minecraft Server';
    const parts=[];if(sw)parts.push(sw);
    if(showPlayers){
      const pl=Array.isArray(state.live?.players)?state.live.players.length:0;
      const maxP=Number(f.properties?.['max-players'])||20;
      parts.push(`${pl}/${maxP} players`);
    }
    if(state.live?.tps!=null&&Number.isFinite(Number(state.live.tps)))parts.push(`${Number(state.live.tps).toFixed(1)} TPS`);
    line=parts.join(' · ')||'Online';
  }else if(st==='starting'){
    details=showName?`Starting ${srvName}…`:'Starting Minecraft Server…';
    line=sw||'Preparing world…';showTimer=false;
  }else if(showIdle){
    const n=Math.max(1,(Array.isArray(state.instances)?state.instances.length:0)||(s.serverPath?1:0));
    details='ObserverLauncher';
    line=n>0?`Managing ${n} server${n===1?'':'s'} · Idle`:'Ready to host';
  }else{
    details='ObserverLauncher';line=t('rpc.previewHiddenIdle');showTimer=false;
  }
  if(detEl)detEl.textContent=details;
  if(stEl)stEl.textContent=line;
  if(tmEl)tmEl.hidden=!showTimer;
}
function updateDiscordRpcStatus(){
  const sl=$('#discordRpcStatusLine'),rb=$('#discordRpcRefreshBtn'),pill=$('#discordRpcPill'),note=$('#discordRpcSetupNote');
  renderDiscordRpcPreview();
  const toggle=$('#discordRpcEnabledInput');
  const on=!!(toggle&&toggle.checked);
  const formCid=($('#discordRpcClientIdInput')?.value||'').trim();
  const validCid=/^\d{17,21}$/.test(formCid);
  if(note)note.hidden=on&&validCid&&(state.discordRpc?.state==='connected');
  const setPill=(cls,text)=>{if(!pill)return;pill.className='mcp-pill'+(cls?` ${cls}`:'');pill.textContent=text;};
  if(!sl)return;
  if(!on){
    sl.hidden=true;sl.className='hint rpc-status-line';
    if(rb)rb.hidden=true;
    setPill('',t('rpc.pillOff'));
    return;
  }
  sl.hidden=false;
  const savedCfg=state.settings||{};
  if(on!==!!savedCfg.discordRpcEnabled||formCid!==String(savedCfg.discordRpcClientId||'')){
    sl.className='hint rpc-status-line';
    sl.textContent=validCid?t('rpc.pendingSave'):t('rpc.needClientId');
    setPill(validCid?'warn':'bad',validCid?t('rpc.pillPending'):t('rpc.pillNeedsId'));
    if(rb)rb.hidden=true;
    return;
  }
  const live=state.discordRpc||{};
  if(rb)rb.hidden=false;
  if(live.state==='connected'){
    const handle=live.user?.username?` (@${live.user.username})`:'';
    sl.className='hint rpc-status-line ok';
    sl.textContent=t('rpc.connected',{u:handle});
    setPill('on',t('rpc.pillConnected'));
  }else if(live.state==='error'){
    sl.className='hint rpc-status-line bad';
    sl.textContent=t('rpc.errorMsg',{m:live.lastError||'Invalid Client ID'});
    setPill('bad',t('rpc.pillError'));
  }else if(live.state==='no_client_id'){
    sl.className='hint rpc-status-line bad';
    sl.textContent=t('rpc.needClientId');
    setPill('bad',t('rpc.pillNeedsId'));
  }else if(live.state==='connecting'){
    sl.className='hint rpc-status-line';
    sl.textContent=t('rpc.connecting');
    setPill('warn',t('rpc.pillWaiting'));
  }else{
    sl.className='hint rpc-status-line';
    sl.textContent=t('rpc.waiting');
    setPill('warn',t('rpc.pillWaiting'));
  }
}
$('#discordRpcEnabledInput')?.addEventListener('change',updateDiscordRpcStatus);
$('#discordRpcClientIdInput')?.addEventListener('input',updateDiscordRpcStatus);
$('#discordRpcShowServerNameInput')?.addEventListener('change',updateDiscordRpcStatus);
$('#discordRpcShowPlayersInput')?.addEventListener('change',updateDiscordRpcStatus);
$('#discordRpcShowIdleInput')?.addEventListener('change',updateDiscordRpcStatus);
$('#discordRpcPortalBtn')?.addEventListener('click',async()=>{
  try{
    const r=await window.observer.discordRpcOpenPortal?.();
    if(r&&r.ok===false)toast(r.error||'Could not open Discord Developer Portal.','error');
  }catch(e){toast(e?.message||'Could not open Discord Developer Portal.','error');}
});
$('#discordRpcRefreshBtn')?.addEventListener('click',()=>withBusy($('#discordRpcRefreshBtn'),async()=>{
  try{
    const r=await (window.observer.discordRpcReconnect?.()||window.observer.discordRpcStatus?.());
    if(r&&r.ok&&r.status){state.discordRpc=r.status;updateDiscordRpcStatus();}
    else if(r&&r.error)toast(r.error,'error');
  }catch{}
}));
try{
  window.observer.onDiscordRpcStatus?.(st=>{
    if(!st)return;
    state.discordRpc=st;
    updateDiscordRpcStatus();
  });
}catch{}
$('#promCopyUrl')?.addEventListener('click',()=>{const p=$('#promCopyUrl')?.dataset.port;if(!p)return;const url=`http://127.0.0.1:${p}/metrics`;try{navigator.clipboard.writeText(url);toast(t('prom.copied'));}catch{}});
function updateApplyDirty(){const b=$('#saveSettings');if(b)b.classList.toggle('dirty',settingsDirty);const h=$('#applyDirtyHint');if(h)h.hidden=!settingsDirty}
function markSettingsSaved(){settingsDirty=false;try{_settingsBaseline=JSON.stringify(getSettings())}catch{}updateApplyDirty()}
// 2.2.0 (Java D): fill the 'Installed runtimes' pick-list from java:list + handle Edit -> Apply preview.
let _javaRuntimes=null;
const normJavaPath=p=>String(p||'').trim().replace(/\\/g,'/').replace(/\/+$/,'').toLowerCase();
function renderJavaNoticeUI(j,need,pending){
  const n=$('#javaNotice');if(!n)return{mismatch:false,tooNew:false};
  if(pending&&pending.customPath!==undefined){
    n.className='java-notice warn';
    n.textContent=pending.customPath?t('set.javaPendingPath',{p:pending.customPath}):t('set.javaPendingAuto');
    return{mismatch:false,tooNew:false};
  }
  const rt=pending&&pending.runtime?pending.runtime:j;
  const is32=rt.ok&&rt.arch==='32-bit';
  const have=rt.ok?javaMajorOf(rt.version||String(rt.major||'')):null;
  const mismatch=rt.ok&&need&&have!=null&&have<need;
  const tooNew=rt.ok&&need&&have!=null&&have>need;
  n.className='java-notice '+(!rt.ok?'bad':(is32||mismatch)?'warn':'ok');
  let txt='';
  if(!rt.ok)txt=t('set.javaBad',{m:rt.message||t('set.javaPathHint')});
  else if(mismatch)txt=t('set.javaNeed',{need,have});
  else if(is32)txt=t('set.java32',{v:rt.version,p:rt.path});
  else if(tooNew)txt=t('set.javaNewer',{have,need});
  else txt=t('set.javaOk',{v:rt.version||`Java ${rt.major}`,p:rt.path});
  if(pending&&pending.runtime)txt+=` (${t('set.unsaved')})`;
  n.textContent=txt;
  return{mismatch,tooNew};
}
function updateJavaPreviewFromForm(){
  const ji=$('#javaPathInput');if(!ji)return;
  const formPath=ji.value.trim();
  const savedPath=String((state.settings&&state.settings.javaPath)||'').trim();
  const need=state.javaRequired||requiredJavaOf((state.files&&state.files.jar)||'');
  if(normJavaPath(formPath)===normJavaPath(savedPath)){
    renderJavaNoticeUI(state.java||{},need,null);
  }else if(!formPath){
    renderJavaNoticeUI(state.java||{},need,{customPath:''});
  }else{
    const match=(_javaRuntimes||[]).find(rt=>normJavaPath(rt.path)===normJavaPath(formPath));
    if(match)renderJavaNoticeUI(state.java||{},need,{runtime:{ok:true,version:match.version||String(match.major),major:match.major,path:match.path,arch:match.arch}});
    else renderJavaNoticeUI(state.java||{},need,{customPath:formPath});
  }
  renderJvmPreview();
}
async function populateJavaPicker(j){
  const row=$('#javaPickRow'),sel=$('#javaPickSelect');if(!row||!sel)return;
  if(_javaRuntimes===null){try{const r=await window.observer.javaList();_javaRuntimes=(r&&r.ok&&Array.isArray(r.runtimes))?r.runtimes:[];}catch{_javaRuntimes=[];}}
  const list=_javaRuntimes||[];
  const cur=String(($('#javaPathInput')?.value??(state.settings&&state.settings.javaPath))||'').trim();
  const curNorm=normJavaPath(cur);
  if(list.length<1&&!cur){row.hidden=true;return}
  row.hidden=false;
  const autoMajor=j&&j.ok?javaMajorOf(j.version):null;
  const autoSuffix=(!cur&&j&&j.ok)?` (${autoMajor?`Java ${autoMajor}`:''}${j.version?` · ${j.version}`:''})`.replace(/\(\s*·\s*/,'('):'';
  const opts=[`<option value="">${esc(t('set.javaAutoOption'))}${esc(autoSuffix)}</option>`];
  let matchedVal='';
  for(const rt of list){
    const isSel=curNorm&&normJavaPath(rt.path)===curNorm;
    if(isSel)matchedVal=rt.path;
    opts.push(`<option value="${esc(rt.path)}"${isSel?' selected':''}>Java ${rt.major}${rt.version?' ('+esc(String(rt.version))+')':''}</option>`);
  }
  if(cur&&!matchedVal){
    matchedVal=cur;
    opts.push(`<option value="${esc(cur)}" selected>${esc(t('set.javaCustomOption',{p:cur}))}</option>`);
  }
  sel.innerHTML=opts.join('');
  sel.value=matchedVal;
  try{sel.closest('.ol-dd')?._olSync?.()}catch{}
  if(!sel._wired){
    sel._wired=true;
    sel.onchange=()=>{
      const ji=$('#javaPathInput');
      if(ji)ji.value=sel.value;
      updateJavaPreviewFromForm();
    };
  }
  const ji=$('#javaPathInput');
  if(ji&&!ji._javaPickerWired){
    ji._javaPickerWired=true;
    ji.addEventListener('input',()=>{
      const nVal=normJavaPath(ji.value);
      const hit=(_javaRuntimes||[]).find(rt=>normJavaPath(rt.path)===nVal);
      sel.value=hit?hit.path:(!ji.value.trim()?'':sel.value);
      try{sel.closest('.ol-dd')?._olSync?.()}catch{}
      updateJavaPreviewFromForm();
    });
  }
}
function renderJvmPreview(){
  const el=$('#jvmPreview');if(!el)return;
  const s=state.settings||{},f=state.files||{};
  const isNat=f.engineType==='native'||!!f.nativeBinary||(f.target&&(f.target.software==='horizon'||f.target.software==='pumpkin'));
  const jar=f.jar||f.launchScript||f.nativeBinary;
  if(isNat||!jar){el.hidden=true;return}
  const ji=$('#javaPathInput');
  const formJava=(ji&&ji.value.trim())||'';
  const savedJava=String(s.javaPath||'').trim();
  const displayJava=formJava?(normJavaPath(formJava)===normJavaPath(savedJava)?((state.java&&state.java.path)||formJava):formJava):((normJavaPath(savedJava)==='')&&state.java&&state.java.path?state.java.path:'java');
  const custom=String($('#jvmArgsInput')?.value??s.jvmArgs??'').trim();
  const minMem=Number($('#memoryMinInput')?.value)||s.memoryMin||2;
  const maxMem=Number($('#memoryMaxInput')?.value)||s.memoryMax||6;
  const args=custom?custom:`-Xms${minMem}G -Xmx${maxMem}G`;
  el.hidden=false;
  el.textContent=`${displayJava} ${args} -jar ${jar}${/velocity/i.test(jar)?'':' nogui'}`;
}
// SETTINGS sub-tabs (Basic / Advanced): sliding glider + pane swap. Beginner-first —
// everyday settings (folder, Java, preferences, reliability) stay on Basic; path/MCP/JVM
// power controls live on Advanced. Glider measured in JS (labels differ in width).
(function(){
  const seg=$('#settingsSeg'); if(!seg) return;
  const btns=[...seg.querySelectorAll('.seg-switch-btn')];
  const panes=[...document.querySelectorAll('#settings .set-pane')];
  // v4.0.0: no JS glider any more — the active state is pure CSS (.settings-nav .seg-switch-btn.active),
  // so it can never mis-measure on a hidden tab. Switching a pane plays a short entrance animation.
  function selectView(view){
    btns.forEach(b=>{const on=b.dataset.setView===view;b.classList.toggle('active',on);b.setAttribute('aria-selected',on?'true':'false')});
    panes.forEach(p=>{const on=p.dataset.setPane===view;p.hidden=!on;if(on){p.classList.remove('pane-in');void p.offsetWidth;p.classList.add('pane-in')}});
  }
  btns.forEach(b=>b.addEventListener('click',()=>selectView(b.dataset.setView)));
})();
(function(){
  const sec=$('#settings');if(!sec)return;
  const onEdit=e=>{if(!e.target.closest('#settings')||e.target.closest('#newServerModal'))return;
    // Recompute from the current form: dirty only when it differs from the last saved snapshot.
    let cur;try{cur=JSON.stringify(getSettings())}catch{cur=null}
    settingsDirty=_settingsBaseline===null?true:(cur!==_settingsBaseline);
    updateApplyDirty();
  };
  sec.addEventListener('input',onEdit);sec.addEventListener('change',onEdit);
})();
$('#jvmArgsInput')?.addEventListener('input',renderJvmPreview);

// ============ v9.1.0 D2: Interactive Server Doctor Modal ============
let _lastDoctorScan=null;
function closeDoctorModal(){
  const m=$('#doctorModal');if(!m||m.hidden)return;
  m.classList.remove('show');m.hidden=true;
  if(typeof releaseFocus==='function')releaseFocus(m);
}
async function runDoctorScan(){
  const sum=$('#docSummary'),pWrap=$('#docPlanWrap'),pList=$('#docPlanList'),cWrap=$('#docChecksWrap'),cList=$('#docChecksList'),rescan=$('#docRescanBtn');
  if(!sum||!window.observer.doctorScan)return;
  if(rescan)rescan.disabled=true;
  sum.className='doc-summary';sum.textContent=t('doc.scanning');
  if(pWrap)pWrap.hidden=true;if(cWrap)cWrap.hidden=true;
  try{
    const r=await window.observer.doctorScan();
    _lastDoctorScan=r||null;
    if(!r||!r.ok){
      sum.className='doc-summary warn';sum.textContent=(r&&r.error)||'Scan failed';
      return;
    }
    const plan=Array.isArray(r.plan)?r.plan:[];
    const checks=Array.isArray(r.checks)?r.checks:[];
    if(!plan.length&&r.healthy){
      sum.className='doc-summary ok';sum.textContent=t('doc.healthy');
    }else{
      sum.className='doc-summary warn';sum.textContent=plan.length?t('doc.issuesFound',{n:plan.length}):(r.summary||t('doc.healthy'));
    }
    if(pWrap&&pList){
      pWrap.hidden=!plan.length;
      pList.innerHTML=plan.map((item,idx)=>{
        const riskCls=item.risk==='destroy'?'destroy':'write';
        const riskTxt=item.risk==='destroy'?t('doc.riskDestroy'):t('doc.riskWrite');
        return `<li class="doc-item"><div class="doc-item-body"><b>${esc(item.action)}<span class="doc-risk ${riskCls}">${esc(riskTxt)}</span></b><small>${esc(item.reason||'')}</small></div><button type="button" class="btn sm ${item.risk==='destroy'?'danger':'primary'}" data-doc-apply="${idx}">${esc(t('doc.applyFix'))}</button></li>`;
      }).join('');
      pList.querySelectorAll('[data-doc-apply]').forEach(btn=>btn.onclick=async()=>{
        const entry=plan[Number(btn.dataset.docApply)];
        if(!entry||!window.observer.doctorApply)return;
        const ok=await confirmDialog({
          title:t('doc.confirmFixTitle'),
          body:esc(t('doc.confirmFixBody',{a:entry.action,r:entry.reason||''})),
          ok:t('doc.applyFix'),
          danger:entry.risk==='destroy',
        });
        if(!ok)return;
        btn.disabled=true;
        try{
          const ar=await window.observer.doctorApply({actions:[entry]});
          if(!ar||!ar.ok)return toast(t('doc.appliedFail',{m:(ar&&ar.error)||'error'}),'error');
          const first=Array.isArray(ar.results)?ar.results[0]:null;
          if(first&&first.ok===false)return toast(t('doc.appliedFail',{m:first.error||'error'}),'error');
          if(ar.files)state.files=ar.files;
          toast(t('doc.appliedOk'),'success');
          refreshUI();
          await runDoctorScan();
        }finally{btn.disabled=false;}
      });
    }
    if(cWrap&&cList){
      const shownChecks=checks.filter(c=>c&&(c.level==='error'||c.level==='warn'||c.detail));
      cWrap.hidden=!shownChecks.length;
      cList.innerHTML=shownChecks.map(c=>`<li class="doc-item"><div class="doc-item-body"><b>${esc(c.id||c.level||'check')}</b><small>${esc(c.detail||c.fix||'')}</small></div></li>`).join('');
    }
  }finally{if(rescan)rescan.disabled=false;}
}
function openDoctorModal(){
  const m=$('#doctorModal');if(!m)return;
  m.hidden=false;void m.offsetWidth;m.classList.add('show');
  if(typeof trapFocus==='function')trapFocus(m);
  runDoctorScan();
}
$('#doctorOpenBtn')?.addEventListener('click',openDoctorModal);
$('#docClose')?.addEventListener('click',closeDoctorModal);
$('#docDoneBtn')?.addEventListener('click',closeDoctorModal);
$('#docRescanBtn')?.addEventListener('click',runDoctorScan);
$('#doctorModal')?.addEventListener('click',e=>{if(e.target.id==='doctorModal')closeDoctorModal();});
document.addEventListener('keydown',e=>{const m=$('#doctorModal');if(!m||m.hidden)return;if(e.key==='Escape'){if(typeof e.stopImmediatePropagation==='function')e.stopImmediatePropagation();closeDoctorModal();}});

// ============ v9.1.0 D3: Guided Minecraft Version Upgrade Assistant ============
let _upgState={software:null,preflight:null};
function closeUpgradeModal(){
  const m=$('#upgradeModal');if(!m||m.hidden)return;
  m.classList.remove('show');m.hidden=true;
  if(typeof releaseFocus==='function')releaseFocus(m);
}
async function openUpgradeModal(){
  if(state.running||state.status!=='stopped')return toast(t('upg.stopFirst'),'error');
  const f=state.files||{};
  const isNat=f.engineType==='native'||!!f.nativeBinary;
  const sw=(f.target&&(f.target.software||f.target.loader))||'';
  if(isNat||!sw||sw==='unknown')return toast(t('upg.unsupported'),'error');
  _upgState={software:sw,preflight:null};
  const m=$('#upgradeModal'),cur=$('#upgCurrentLabel'),sel=$('#upgVersionSelect'),rep=$('#upgReport'),runBtn=$('#upgRunBtn'),st=$('#upgStatusText');
  if(!m||!sel)return;
  if(cur)cur.textContent=`${sw} · ${(f.target&&f.target.mc)||f.jar||'?'}`;
  if(rep)rep.hidden=true;
  if(runBtn)runBtn.disabled=true;
  if(st)st.textContent='';
  sel.innerHTML='<option value="">…</option>';
  if(typeof window.enhanceSelect==='function')window.enhanceSelect(sel);
  sel.closest('.ol-dd')?._olSync?.();
  m.hidden=false;void m.offsetWidth;m.classList.add('show');
  if(typeof trapFocus==='function')trapFocus(m);
  try{
    const vr=await window.observer.wizardVersions(sw);
    const list=(vr&&vr.ok&&Array.isArray(vr.versions))?vr.versions.slice(0,60):[];
    sel.innerHTML=list.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('')||'<option value="latest">latest</option>';
    if(vr&&vr.latest&&list.includes(vr.latest))sel.value=vr.latest;
  }catch{sel.innerHTML='<option value="latest">latest</option>';}
  sel.closest('.ol-dd')?._olSync?.();
}
async function runUpgradePreflight(){
  const sel=$('#upgVersionSelect'),btn=$('#upgPreflightBtn'),st=$('#upgStatusText'),rep=$('#upgReport'),jRow=$('#upgJavaRow'),cSum=$('#upgCompatSummary'),iList=$('#upgIncompatList'),runBtn=$('#upgRunBtn');
  const targetVersion=(sel?.value||'').trim();
  if(!targetVersion||!window.observer.upgradePreflight)return;
  if(btn)btn.disabled=true;
  if(runBtn)runBtn.disabled=true;
  if(st)st.textContent=t('upg.checking');
  try{
    const r=await window.observer.upgradePreflight({software:_upgState.software,targetVersion});
    if(!r||!r.ok){
      if(st)st.textContent=(r&&r.error)||'Preflight failed';
      return;
    }
    _upgState.preflight=r;
    if(st)st.textContent='';
    if(rep)rep.hidden=false;
    if(jRow){
      jRow.className='upg-java-row '+(r.javaOk?'ok':'bad');
      const actualStr=r.javaActual!=null?String(r.javaActual):'?';
      const reqStr=r.javaRequired!=null?String(r.javaRequired):'—';
      const msg=r.javaOk?t('upg.javaOk',{a:actualStr,r:reqStr}):t('upg.javaBad',{a:actualStr,r:reqStr});
      jRow.innerHTML=`<span>${esc(msg)}</span>${r.javaOk?'':`<button type="button" class="btn xs primary" id="upgInstallJavaBtn">${esc(t('upg.installJava'))}</button>`}`;
      const jBtn=$('#upgInstallJavaBtn');
      if(jBtn)jBtn.onclick=async()=>{
        jBtn.disabled=true;
        try{
          const jr=await window.observer.javaAutoInstall();
          if(jr&&jr.ok){state.java=jr.java||state.java;refreshUI();await runUpgradePreflight();}
          else toast((jr&&jr.error)||'Java install failed','error');
        }finally{jBtn.disabled=false;}
      };
    }
    const compat=r.compatible||[],incompat=r.incompatible||[],untracked=r.untracked||[];
    if(cSum)cSum.textContent=t('upg.compatSummary',{c:compat.length,i:incompat.length,u:untracked.length});
    if(iList){
      iList.hidden=!incompat.length;
      iList.innerHTML=incompat.map(x=>`<li class="doc-item"><div class="doc-item-body"><b>${esc(x.title||x.fileName)}</b><small>${esc(x.reason||'')}</small></div></li>`).join('');
    }
    if(runBtn)runBtn.disabled=false;
  }finally{if(btn)btn.disabled=false;}
}
async function runUpgradeExecution(){
  const pf=_upgState.preflight;
  if(!pf||!window.observer.upgradeRun)return;
  const ok=await confirmDialog({
    title:t('upg.confirmTitle',{v:pf.targetVersion}),
    body:esc(t('upg.confirmBody',{s:pf.software,v:pf.targetVersion})),
    ok:t('upg.runBtn'),
  });
  if(!ok)return;
  const runBtn=$('#upgRunBtn'),st=$('#upgStatusText');
  if(runBtn)runBtn.disabled=true;
  if(st)st.textContent=t('upg.running');
  try{
    const r=await window.observer.upgradeRun({
      software:pf.software,
      targetVersion:pf.targetVersion,
      createBackup:$('#upgOptBackup')?$('#upgOptBackup').checked:true,
      updateContent:$('#upgOptUpdateContent')?$('#upgOptUpdateContent').checked:true,
      disableIncompatible:$('#upgOptDisableIncompat')?$('#upgOptDisableIncompat').checked:false,
      incompatibleFiles:pf.incompatible||[],
    });
    if(!r||!r.ok){
      if(st)st.textContent=(r&&r.error)||'Upgrade failed';
      return toast((r&&r.error)||'Upgrade failed','error');
    }
    if(r.files)state.files=r.files;
    closeUpgradeModal();
    refreshUI();
    toast(t('upg.done',{s:r.software,v:r.targetVersion,u:(r.updatedContent||[]).length}),'success');
  }finally{if(runBtn)runBtn.disabled=false;}
}
$('#upgradeServerBtn')?.addEventListener('click',openUpgradeModal);
$('#upgClose')?.addEventListener('click',closeUpgradeModal);
$('#upgCancelBtn')?.addEventListener('click',closeUpgradeModal);
$('#upgPreflightBtn')?.addEventListener('click',runUpgradePreflight);
$('#upgRunBtn')?.addEventListener('click',runUpgradeExecution);
$('#upgradeModal')?.addEventListener('click',e=>{if(e.target.id==='upgradeModal')closeUpgradeModal();});
document.addEventListener('keydown',e=>{const m=$('#upgradeModal');if(!m||m.hidden)return;if(e.key==='Escape'){if(typeof e.stopImmediatePropagation==='function')e.stopImmediatePropagation();closeUpgradeModal();}});
