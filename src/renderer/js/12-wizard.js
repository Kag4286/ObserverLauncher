// js/12-wizard.js — split out of 08-shell.js; classic script, load AFTER 08-shell.js.
// Guided 5-step wizard that DOUBLES as the "Add instance" flow: step 1 picks the folder, then
// software/version/memory, then Review creates a NEW instance (fresh id, made active) for that
// folder and runs the download there. It never overwrites another instance's settings. Calls
// getSettings/toast/switchTab/debounce/esc/t/formatBytes (defined in 08-shell.js or earlier) at
// click time, so loading after 08 is safe.
let nsw={step:1,software:'vanilla',folder:''};
// Real-time version data for the wizard — loaded live from each software's official API
// (wizard:versions IPC) instead of hardcoded chips that drifted out of date.
let nswVersions={software:null,list:[],latest:null,raw:false,loading:false,failed:false,error:'',annotated:[]};
// 2.2.0: Forge/NeoForge need MC-first selection (their version list spans every MC + betas).
let nswMc=null;   // chosen Minecraft version for forge/neoforge
const NSW_MC_FIRST={forge:true,neoforge:true};
const isMcFirst=()=>!!NSW_MC_FIRST[nsw.software];
const NSW_SOFTWARE_LABEL={vanilla:'Vanilla',paper:'Paper',purpur:'Purpur',leaf:'Leaf',fabric:'Fabric',neoforge:'NeoForge',forge:'Forge',folia:'Folia',spigot:'Spigot',velocity:'Velocity'};
async function loadNswVersions(software){
  // BUGFIX (2.2.0): re-entering step 3 for the same software returned early WITHOUT repainting the
  // chips, so the version picker looked empty ('biến mất') after going Back from a later step.
  // Repaint from cache on the early return.
  if(nswVersions.software===software){
    if(!nswVersions.loading) renderNswChips($('#nswVersionInput')?.value.trim()||'');
    return;
  }
  nswVersions={software,list:[],latest:null,raw:false,loading:true,failed:false,error:'',annotated:[]};
  if(!NSW_MC_FIRST[software])nswMc=null; // MC-first only applies to forge/neoforge
  renderNswChips('');
  $('#nswLatestLabel').textContent=t('nsw.latestSub');
  const r=await window.observer.wizardVersions(software);
  if(nswVersions.software!==software)return; // user switched software mid-request
  nswVersions.loading=false;
  if(!r||!r.ok){nswVersions.failed=true;nswVersions.error=r?.error||t('nsw.apiFail');}
  else{nswVersions.list=r.versions||[];nswVersions.latest=r.latest||null;nswVersions.raw=!!r.raw;nswVersions.note=r.note||'';nswVersions.annotated=Array.isArray(r.annotated)?r.annotated:[];nswVersions.stableLatest=r.stableLatest||null;nswVersions.status=Array.isArray(r.status)?r.status:[];}
  renderNswChips($('#nswVersionInput')?.value.trim()||'');
  $('#nswLatestLabel').textContent=nswVersions.latest?`${t('nsw.latest')}: ${nswVersions.latest}`:'';
  const mode=$$('input[name="nswVersionMode"]').find(r=>r.checked)?.value;
  if(nswVersions.latest&&mode!=='specific')checkNswJava(isMcFirst()?nswMc:nswVersions.latest);
}
// 2.2.0 (NeoForge option a): distinct Minecraft versions present in the forge/neoforge maven list,
// newest first, with whether that MC line has a non-prerelease build. Drives the MC-first picker.
function mcChoices(){
  const seen=new Map();
  for(const a of nswVersions.annotated){
    if(!a.mc)continue;
    const cur=seen.get(a.mc);
    if(cur){ if(!cur.stable&&a.stable)cur.stable=true; }
    else seen.set(a.mc,{mc:a.mc,stable:!!a.stable});
  }
  // Sort newest-first by numeric MC parts (26.3 > 1.21.1).
  const rank=m=>m.split('.').map(Number);
  return [...seen.values()].sort((a,b)=>{const x=rank(a.mc),y=rank(b.mc);for(let i=0;i<Math.max(x.length,y.length);i++){const d=(y[i]||0)-(x[i]||0);if(d)return d;}return 0});
}
// Builds for ONE MC (forge/neoforge), newest first, prereleases last.
function buildsForMc(mc){
  return nswVersions.annotated.filter(a=>a.mc===mc).sort((a,b)=>{
    if(a.stable!==b.stable)return a.stable?-1:1;
    const x=a.v.split('.').map(Number),y=b.v.split('.').map(Number);
    for(let i=0;i<Math.max(x.length,y.length);i++){const d=(y[i]||0)-(x[i]||0);if(d)return d;}return 0;
  });
}
function renderNswChips(filter){
  const box=$('#nswVersionChips');if(!box)return;
  if(nswVersions.loading){box.innerHTML=`<span class="nsw2-chiploading">${t('nsw.loadingVersions')}</span>`;return}
  if(nswVersions.failed){box.innerHTML=`<span class="nsw2-chiploading">${esc(nswVersions.error)} — ${t('nsw.typeManually')}</span>`;return}
  // 2.2.0 NeoForge/Forge (option a): pick Minecraft FIRST, then a build for that MC.
  if(isMcFirst()){
    if(!nswMc){
      const choices=mcChoices().filter(c=>!filter||c.mc.toLowerCase().includes(filter.toLowerCase()));
      box.innerHTML=choices.length
        ? choices.map(c=>`<button class="version-chip" data-mc="${esc(c.mc)}"${c.stable?'':' data-soft="1"'}>${esc(c.mc)}${c.stable?'':' <em class="nsw2-tag warn">beta</em>'}</button>`).join('')
        : `<span class="nsw2-chiploading">${t('nsw.noMatches')}</span>`;
      return;
    }
    // A MC is chosen -> show a breadcrumb with a BACK button so the user can pick another MC.
    // Without this the build list was a dead end (the reported UX bug).
    const list=buildsForMc(nswMc).filter(b=>!filter||b.v.toLowerCase().includes(filter.toLowerCase()));
    const back=`<button type="button" class="version-chip version-back" data-mc-back="1">← ${esc(t('nsw.changeMc'))}</button>`;
    const crumb=`<span class="nsw2-crumb">${esc(t('nsw.mcLabel'))}: <b>${esc(nswMc)}</b></span>`;
    const chips=list.length
      ? list.map(b=>`<button class="version-chip" data-version="${esc(b.v)}"${b.stable?'':' data-soft="1"'}>${esc(b.v)}${b.stable?'':' <em class="nsw2-tag warn">beta</em>'}</button>`).join('')
      : `<span class="nsw2-chiploading">${t('nsw.noBuilds')}</span>`;
    box.innerHTML=back+crumb+chips;
    return;
  }
  const q=(filter||'').toLowerCase();
  const list=q?nswVersions.list.filter(v=>v.toLowerCase().includes(q)):nswVersions.list;
  // P2b (2.2.0): Paper/Folia return per-version stability in `status` (ALPHA/BETA versions have no
  // stable build). Mark those so a user can see which pick will actually install. Other software
  // (vanilla/fabric/purpur/leaf) has no status -> every chip is normal.
  const statusMap=new Map((nswVersions.status||[]).map(s=>[s.version,s]));
  if(!list.length){box.innerHTML=`<span class="nsw2-chiploading">${t('nsw.noMatches')}</span>`;return}
  box.innerHTML=list.map(v=>{
    const st=statusMap.get(v);
    const soft=st&&st.stable===false;
    const tag=soft?` <em class="nsw2-tag warn">${esc((st.channel||'beta').toLowerCase())}</em>`:(st&&st.stable?'':'');
    return `<button class="version-chip" data-version="${esc(v)}"${soft?' data-soft="1"':''}>${esc(v)}${tag}</button>`;
  }).join('');
}
function nswValidateVersion(v){
  if(!v)return'';
  if(nswVersions.loading)return t('nsw.checkingList');
  if(nswVersions.failed)return t('nsw.listUnavailable');
  if(v==='latest')return'';
  const sw=NSW_SOFTWARE_LABEL[nsw.software]||nsw.software;
  if(nswVersions.list.includes(v))return t('nsw.available',{v,s:sw});
  const near=nswVersions.list.find(x=>x.startsWith(v));
  return near?t('nsw.didYouMean',{v,n:near}):t('nsw.notInList',{v,s:sw});
}
// HARD-SYNC Java requirement: asks Mojang's manifest (via wizard:java-check) for the authoritative
// javaVersion of the selected MC version instead of trusting the static mapping. Result is shown
// live in step 2 and repeated as a "Java" row in the step 4 summary.
let nswJava={version:'',java:null,exact:false};
// javaMajorOf lives in 00-core.js (used by 07-overview.js during boot).
function renderNswJava(){
  const el=$('#nswJavaCheck');if(!el)return;
  if(!nswJava.java){el.hidden=true;return}
  const jm=state.java&&state.java.ok?javaMajorOf(state.java.version):null;
  const tooOld=jm!=null&&jm<nswJava.java;
  el.hidden=false;
  el.className='nsw-java '+(tooOld?'warn':'ok');
  el.textContent=(nswJava.exact?t('nsw.javaRunsOn',{v:nswJava.java}):t('nsw.javaEstimated',{v:nswJava.java}))+(nswJava.exact?t('nsw.javaVerified'):'+')+(tooOld?t('nsw.javaTooOld',{v:jm}):tooOld===false&&jm!=null?t('nsw.javaReady',{v:jm}):'');
}
function checkNswJava(v){
  if(!v||v==='latest'){nswJava={version:'',java:null,exact:false};const el=$('#nswJavaCheck');if(el)el.hidden=true;return}
  const el=$('#nswJavaCheck');
  if(el){el.hidden=false;el.className='nsw-java loading';el.textContent=t('nsw.checkingJava')}
  window.observer.wizardJavaCheck({software:nsw.software,version:v}).then(r=>{
    if(r&&r.ok&&r.java){nswJava={version:v,java:r.java,exact:!!r.exact}}
    else{nswJava={version:v,java:null,exact:false}}
    renderNswJava();
  }).catch(()=>{nswJava={version:v,java:null,exact:false};const e2=$('#nswJavaCheck');if(e2)e2.hidden=true});
}
function nswRender(){
  $$('.nsw-step').forEach(s=>s.classList.toggle('active',Number(s.dataset.step)===nsw.step));
  $$('.nsw2-step').forEach(d=>{const n=Number(d.dataset.dot);d.classList.toggle('active',n===nsw.step);d.classList.toggle('done',n<nsw.step)});
  $('#nswStepLabel').textContent=t('nsw.step',{a:nsw.step,b:5});
  $('#nswBack').hidden=nsw.step===1;
  $('#nswNext').textContent=nsw.step===5?t('nsw.create'):t('nsw.next');
  const versionMode=$$('input[name="nswVersionMode"]').find(r=>r.checked)?.value;
  // 2.2.0 NeoForge/Forge: show "MC <mc> · <build>" once chosen; else a hint to pick MC first.
  let version;
  if(isMcFirst()){
    const build=$('#nswVersionInput').value.trim();
    version=nswMc?(build?`${nswMc} · ${build}`:t('nsw.mcPicked',{mc:nswMc})):t('nsw.pickMcWord');
  } else {
    version=versionMode==='specific'?($('#nswVersionInput').value.trim()||'—'):(nswVersions.latest||t('nsw.latestWord'));
  }
  const folderName=nsw.folder?nsw.folder.split(/[\\/]/).filter(Boolean).pop():t('nsw.noFolder');
  const folderSub=$('#nswRailFolderSub'); if(folderSub)folderSub.textContent=folderName;
  const fp=$('#nswFolderPath'); if(fp)fp.textContent=nsw.folder||t('nsw.noFolder');
  $('#nswRailSub1').textContent=NSW_SOFTWARE_LABEL[nsw.software]||nsw.software;
  $('#nswRailSub2').textContent=version;
  $('#nswRailSub3').textContent=`${$('#nswMemorySlider').value} GB`;
  if(nsw.step===3){
    loadNswVersions(nsw.software);
    // 2.2.0: Forge/NeoForge use MC-first — hide the latest/specific radios, always show the picker.
    const mcFirst=isMcFirst();
    const vc=$('#nswVersionCards');if(vc)vc.hidden=mcFirst;
    const lead=$('#nswVersionLead');if(lead)lead.hidden=mcFirst;
    const leadMc=$('#nswMcFirstLead');if(leadMc)leadMc.hidden=!mcFirst;
    const picker=$('#nswVersionPicker');if(picker)picker.hidden=mcFirst?false:picker.hidden;
    if(mcFirst){$('#nswVersionInput').disabled=false;}
    // BUGFIX (2.2.0): ALWAYS repaint the chip box when step 3 is shown. loadNswVersions() may
    // early-return (cache hit / already loading), which previously left the picker empty - the
    // reported 'NeoForge version picker disappears'. Repainting here is idempotent and cheap.
    if(!nswVersions.loading) renderNswChips($('#nswVersionInput')?.value.trim()||'');
  }
  if(nsw.step===4){
    if(state.systemMemoryGB){$('#nswMemorySlider').max=Math.max(2,state.systemMemoryGB-1);$('#nswRamHint').textContent=t('nsw.ramHint',{n:state.systemMemoryGB})}
    nswUpdateMemory();
  }
  if(nsw.step===5){
    const memory=$('#nswMemorySlider').value;
    // P2d (2.2.0): the review shows the download source + where it lands + Java readiness, so the
    // user knows what is about to happen before pressing Create.
    const srcMap={vanilla:t('nsw.srcVanilla'),paper:t('nsw.srcPaper'),purpur:t('nsw.srcPurpur'),leaf:t('nsw.srcLeaf'),fabric:t('nsw.srcFabric'),forge:t('nsw.srcForge'),neoforge:t('nsw.srcForge'),folia:t('nsw.srcPaper'),spigot:t('nsw.srcSpigot'),velocity:t('nsw.srcPaper')};
    const src=srcMap[nsw.software]||'';
    const jm=state.java&&state.java.ok?javaMajorOf(state.java.version):null;
    const javaNeed=nswJava.java;
    const javaBad=javaNeed&&jm!=null&&jm<javaNeed;
    const javaRow=javaNeed?`<div class="nsw2-kv"><span>${t('nsw.sumJava')}</span><b>${`Java ${javaNeed}${nswJava.exact?' (verified)':'+'}`}</b></div>`:`<div class="nsw2-kv"><span>${t('nsw.sumJava')}</span><b>—</b></div>`;
    const rows=[
      `<div class="nsw2-kv"><span>${t('nsw.sumFolder')}</span><b>${esc(nsw.folder||'—')}</b></div>`,
      `<div class="nsw2-kv"><span>${t('nsw.sumSoftware')}</span><b>${esc(NSW_SOFTWARE_LABEL[nsw.software]||nsw.software)}</b></div>`,
      `<div class="nsw2-kv"><span>${t('nsw.sumVersion')}</span><b>${esc(version)}</b></div>`,
      src?`<div class="nsw2-kv"><span>${t('nsw.sumSource')}</span><b>${esc(src)}</b></div>`:'',
      javaRow,
      `<div class="nsw2-kv"><span>${t('nsw.sumMemory')}</span><b>${esc(memory)} GB</b></div>`,
    ].join('');
    const warn=javaBad?`<p class="proxy-notice">${esc(t('nsw.javaTooOld',{v:jm}))}</p>`:'';
    $('#nswSummary').innerHTML=rows+warn;
  }
  const spigotHint=$('#nswSpigotHint'); if(spigotHint) spigotHint.hidden=!(nsw.step===5&&nsw.software==='spigot');
}
$$('[data-software]').forEach(c=>c.onclick=()=>{
  if(nsw.software===c.dataset.software)return;
  nsw.software=c.dataset.software;
  $$('[data-software]').forEach(x=>x.classList.toggle('active',x===c));
  // invalidate the cached live list so step 2 refetches for this software
  nswVersions={software:null,list:[],latest:null,raw:false,loading:false,failed:false,error:'',annotated:[]};
  nswMc=null;
  if(nsw.step===3)loadNswVersions(nsw.software);
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
  // 2.2.0 NeoForge/Forge: the BACK button clears the chosen MC so the MC list returns.
  if(chip.dataset.mcBack!==undefined){
    nswMc=null;
    $('#nswVersionInput').value='';
    $('#nswVersionClear').hidden=true;
    renderNswChips('');
    $('#nswVersionInfo').textContent=t('nsw.pickMc');
    nswRender();
    return;
  }
  // 2.2.0 NeoForge/Forge: first click picks the MC version, then we show that MC's builds.
  if(chip.dataset.mc!==undefined){
    nswMc=chip.dataset.mc;
    $('#nswVersionInput').value='';
    $('#nswVersionClear').hidden=true;
    renderNswChips('');
    $('#nswVersionInfo').textContent=t('nsw.pickBuild',{mc:nswMc});
    nswRender();
    return;
  }
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
  if(info)info.textContent=v?nswValidateVersion(v):t('nsw.pickChip');
  checkNswJava(v);
  nswRender();
},250);
$('#nswVersionInput')?.addEventListener('input',debouncedNswValidate);
$('#nswVersionClear')?.addEventListener('click',()=>{
  $('#nswVersionInput').value='';
  $('#nswVersionClear').hidden=true;
  renderNswChips('');
  $('#nswVersionInfo').textContent=t('nsw.pickChip');
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
$('#nswCancel').onclick=async()=>{
  const btn=$('#nswCancel');btn.disabled=true;
  try{ await window.observer.wizardCancel(); }catch{}
  btn.disabled=false;
};
// FEATURE: real byte progress for the wizard's download step — registered once here (same pattern as
// onLog/onState/onFiles above) rather than subscribed per-click, so repeated wizard runs don't stack
// up duplicate listeners. Harmless to keep receiving events when the modal isn't open; the elements
// just sit updated and hidden.
// P2e (2.2.0): track speed + ETA. A short EMA over recent deltas so the number is readable, not
// jittery. Reset whenever a new download starts (received drops below the last seen value).
let _nswSpeed={lastBytes:0,lastAt:0,ema:0};
function nswEta(total,received){
  if(!(_nswSpeed.ema>0))return '';
  const remain=(total-received)/_nswSpeed.ema;
  if(!Number.isFinite(remain)||remain<0||remain>86400)return '';
  const s=Math.round(remain);
  const txt=s<60?`${s}s`:(s<3600?`${Math.floor(s/60)}m ${s%60}s`:`${Math.floor(s/3600)}h ${Math.floor((s%3600)/60)}m`);
  return `${t('nsw.eta')} ${txt}`;
}
window.observer.onWizardProgress(({received,total})=>{
  const fill=$('#nswProgressFill'),label=$('#nswProgressLabel');if(!fill)return;
  const now=Date.now();
  if(received<_nswSpeed.lastBytes)_nswSpeed={lastBytes:0,lastAt:0,ema:0}; // new download -> reset
  if(_nswSpeed.lastAt&&now>_nswSpeed.lastAt){
    const inst=(received-_nswSpeed.lastBytes)/((now-_nswSpeed.lastAt)/1000);
    if(Number.isFinite(inst)&&inst>=0)_nswSpeed.ema=_nswSpeed.ema?_nswSpeed.ema*0.7+inst*0.3:inst;
  }
  _nswSpeed.lastBytes=received;_nswSpeed.lastAt=now;
  const speed=_nswSpeed.ema>0?` · ${formatBytes(_nswSpeed.ema)}/s`:'';
  if(total>0){
    const pct=Math.min(100,Math.round(received/total*100));
    fill.classList.remove('indeterminate');fill.style.width=pct+'%';
    const eta=nswEta(total,received);
    label.textContent=`${formatBytes(received)} / ${formatBytes(total)} (${pct}%)${speed}${eta?' · '+eta:''}`;
  } else { fill.classList.add('indeterminate');label.textContent=`${formatBytes(received)} downloaded…${speed}`; }
});
// Returns an error string when the version step is not valid to proceed, else null.
// Catches: "specific" chosen but empty, or a version that is definitively not in the live list.
function nswVersionError(){
  const mode=$$('input[name="nswVersionMode"]').find(r=>r.checked)?.value;
  // 2.2.0 NeoForge/Forge (option a): must pick a Minecraft version AND a build.
  if(isMcFirst()){
    if(!nswMc)return t('nsw.pickMc');
    const v=$('#nswVersionInput').value.trim();
    if(!v)return t('nsw.pickBuildErr',{mc:nswMc});
    return null;
  }
  if(mode!=='specific')return null;
  const v=$('#nswVersionInput').value.trim();
  if(!v)return t('nsw.typeVersion');
  // Only hard-block when the live list loaded successfully and clearly lacks this version.
  if(!nswVersions.loading&&!nswVersions.failed&&nswVersions.list.length&&!nswVersions.list.includes(v)){
    const near=nswVersions.list.find(x=>x.startsWith(v));
    return near?t('nsw.notAvailableDid',{v,n:near}):t('nsw.notInOfficial',{v,s:NSW_SOFTWARE_LABEL[nsw.software]||nsw.software});
  }
  return null;
}
// P2f (2.2.0): turn a raw download/install error into an actionable message. Falls back to the
// original text when nothing matches, so no information is lost.
function nswFriendlyError(msg){
  const m=String(msg||'');
  if(/no stable .* build/i.test(m))return t('nsw.errNoStable')+ (m.includes('newest stable')? ' '+m.slice(m.indexOf('The newest stable')) : '');
  if(/timed out|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(m))return t('nsw.errNetwork');
  if(/checksum|sha-?256/i.test(m))return t('nsw.errChecksum');
  if(/Git is not installed|BuildTools/i.test(m))return t('nsw.errGit');
  if(/JDK|javac/i.test(m))return t('nsw.errJdk');
  if(/Java is required|Java not/i.test(m))return t('nsw.errJava');
  if(/already contains a server jar|already has a server jar/i.test(m)){
    // 2.2.0 debug: surface the EXACT backend text (which now includes the checked folder + instance
    // id) so a wrong-instance bug is visible instead of being masked by a generic translation.
    return m.replace(/^This folder already contains/, 'That folder already has');
  }
  if(/disk|ENOSPC|no space/i.test(m))return t('nsw.errDisk');
  return m||t('toast.startUnknown');
}
$('#nswNext').onclick=async()=>{
  if(nsw.step<5){
    if(nsw.step===1&&!nsw.folder)return toast(t('nsw.pickFolder'),'error');
    if(nsw.step===3){const verr=nswVersionError();if(verr)return toast(verr,'error');}
    nsw.step++;nswRender();return
  }
  if(!nsw.folder)return toast(t('nsw.pickFolder'),'error');
  const software=nsw.software;
  const versionMode=$$('input[name="nswVersionMode"]').find(r=>r.checked)?.value;
  // 2.2.0 NeoForge/Forge: the chosen build for the chosen MC. Others: specific version or 'latest'.
  const version=isMcFirst()?$('#nswVersionInput').value.trim():(versionMode==='specific'?$('#nswVersionInput').value.trim():'');
  const memory=Number($('#nswMemorySlider').value)||4;
  $('#nswNext').disabled=true;$('#nswNext').textContent=t('nsw.downloading');$('#nswBack').disabled=true;
  $('#nswProgress').hidden=false;$('#nswProgressFill').style.width='0%';$('#nswProgressFill').classList.add('indeterminate');$('#nswProgressLabel').textContent=t('nsw.startingDownload');
  $('#nswCancel').hidden=false;
  const resetBtn=()=>{$('#nswNext').disabled=false;$('#nswNext').textContent=t('nsw.create');$('#nswBack').disabled=false;$('#nswProgress').hidden=true;$('#nswCancel').hidden=true};
  // 1) Create a NEW instance for the chosen folder and make it active. The wizard download then
  //    runs inside that instance (ctx.currentServerPath follows the switch). This is what makes
  //    the wizard additive instead of replacing the active server's folder.
  const add=await window.observer.instanceAdd({serverPath:nsw.folder});
  if(!add||!add.ok){toast((add&&add.error)||t('toast.startUnknown'),'error');resetBtn();return}
  const sw=await window.observer.instanceSwitch(add.id);
  if(!sw||!sw.ok){toast((sw&&sw.error)||t('toast.startUnknown'),'error');resetBtn();return}
  try{const s=await window.observer.getState();state={...state,...s}}catch{}
  // CRITICAL (2.2.0): getSettings() reads serverPath from #serverFolderInput (the ACTIVE instance's
  // folder input, which is still STALE right after instanceSwitch). Saving it verbatim would
  // overwrite the NEW instance's folder with the PREVIOUS instance's path - the exact 'wizard sees
  // another server's purpur.jar' bug. Force serverPath to the folder the wizard actually chose.
  const settingsNext={...getSettings(),serverPath:nsw.folder,memoryMin:Math.max(1,Math.floor(memory/2)),memoryMax:memory};
  const sr=await window.observer.saveSettings(settingsNext);if(!sr||!sr.ok){toast((sr&&sr.error)||t('toast.startUnknown'),'error');resetBtn();return}state={...state,settings:settingsNext,java:sr.java};
  // 2.2.0 CRITICAL: pass the TARGET instance id so the main process runs the folder check +
  // download in THIS instance, not whatever the IPC proxy pinned as active (the 'wizard sees
  // another server's purpur.jar' bug).
  const r=await window.observer.wizardCreate({software,version,instance:add.id});
  resetBtn();
  if(!r.ok){
    if(/cancel/i.test(r.error||'')){ toast(t('toast.downloadCancelled')); return; }
    // BUGFIX (2.2.0): the instance was added BEFORE wizard:create, so every failed attempt left an
    // empty orphan instance behind (the reported 'a pile of McMod instances'). Undo the add on a
    // real failure (a cancel keeps it — the user may resume). Removing never touches the folder.
    try { await window.observer.instanceRemove(add.id); } catch {}
    try { const s=await window.observer.getState(); state={...state,...s}; } catch {}
    toast(nswFriendlyError(r.error),'error');
    // P2f: if the failure was "no stable build", jump back to the version step so the user can retry.
    if(/no stable .* build/i.test(r.error||'')){ nsw.step=3; }
    nswRender();
    return;
  }
  $('#newServerModal').hidden=true;nsw={step:1,software:'vanilla',folder:''};nswVersions={software:null,list:[],latest:null,raw:false,loading:false,failed:false,error:''};
  try{const s2=await window.observer.getState();state={...state,...s2}}catch{}
  if(r.building){toast(t('nsw.building',{n:r.name}));switchTab('console');return}
  state.files=r.files;refreshUI();switchTab('overview');
  toast(t('nsw.ready'),'success');
};
// The Add-instance flow (also used by the welcome / onboarding "Create a new server" buttons).
function openNewServerWizard(folder){
  nsw={step:1,software:'vanilla',folder:folder||''};
  nswVersions={software:null,list:[],latest:null,raw:false,loading:false,failed:false,error:'',annotated:[]};
  nswMc=null;
  nswJava={version:'',java:null,exact:false};
  const jc=$('#nswJavaCheck');if(jc)jc.hidden=true;
  $$('[data-software]').forEach(x=>x.classList.toggle('active',x.dataset.software==='vanilla'));
  $('#nswVersionInput').disabled=true;
  $$('input[name="nswVersionMode"]').forEach(r=>r.checked=r.value==='latest');
  $$('.nsw-radio-card').forEach(c=>c.classList.toggle('active', c.querySelector('input')?.value==='latest'));
  $('#nswVersionPicker').hidden=true;
  $('#nswVersionInput').value='';$('#nswVersionClear').hidden=true;
  $('#nswLatestLabel').textContent=t('nsw.resolvingLatest');
  $('#nswMemorySlider').value=4;$('#nswMemoryValue').textContent='4';
  $('#nswProgress').hidden=true;
  nswRender();$('#newServerModal').hidden=false;
}
// Step 1: pick the folder for the new instance. Uses pickFolder directly (NOT chooseFolder),
// because chooseFolder saves serverPath onto the ACTIVE instance — the wizard must not touch it.
$('#nswChooseFolder')?.addEventListener('click',async()=>{
  let f;
  try{ f=await window.observer.pickFolder({suggestNew:true,title:t('nsw.pickFolder')}); }catch{ f=null; }
  if(!f)return;
  // Q3: if the folder ALREADY holds a Minecraft server, offer to import it as-is instead of
  // downloading a fresh one. Import = the existing add-existing-folder flow (no download).
  let probe=null;
  try{ probe=await window.observer.instanceProbe(f); }catch{ probe=null; }
  if(probe&&probe.ok&&probe.looksLikeServer){
    const name=probe.jar||probe.launchScript||'server';
    const importIt=await confirmDialog({title:t('nsw.foundServer'),body:esc(t('nsw.foundServerBody',{n:name})),ok:t('nsw.importIt'),cancel:t('nsw.downloadFresh')});
    if(importIt){
      $('#newServerModal').hidden=true;
      await addExistingInstance(f);
      return;
    }
  }
  nsw.folder=f;nswRender();
});
// Rail '+ Add instance' button opens this same wizard (step 1 picks the folder).
$('#addInstanceBtn')?.addEventListener('click',()=>openNewServerWizard());
