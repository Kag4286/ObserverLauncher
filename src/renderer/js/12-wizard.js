// js/12-wizard.js — split out of 08-shell.js; classic script, load AFTER 08-shell.js.
// Guided 5-step wizard that DOUBLES as the "Add instance" flow: step 1 picks the folder, then
// software/version/memory, then Review creates a NEW instance (fresh id, made active) for that
// folder and runs the download there. It never overwrites another instance's settings. Calls
// getSettings/toast/switchTab/debounce/esc/t/formatBytes (defined in 08-shell.js or earlier) at
// click time, so loading after 08 is safe.
let nsw={step:1,software:'vanilla',folder:''};
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
  if(!r||!r.ok){nswVersions.failed=true;nswVersions.error=r?.error||t('nsw.apiFail');}
  else{nswVersions.list=r.versions||[];nswVersions.latest=r.latest||null;nswVersions.raw=!!r.raw;nswVersions.note=r.note||'';}
  renderNswChips($('#nswVersionInput')?.value.trim()||'');
  $('#nswLatestLabel').textContent=nswVersions.latest?`${t('nsw.latest')}: ${nswVersions.latest}`:'';
  const mode=$$('input[name="nswVersionMode"]').find(r=>r.checked)?.value;
  if(nswVersions.latest&&mode!=='specific')checkNswJava(nswVersions.latest);
}
function renderNswChips(filter){
  const box=$('#nswVersionChips');if(!box)return;
  if(nswVersions.loading){box.innerHTML=`<span class="nsw2-chiploading">${t('nsw.loadingVersions')}</span>`;return}
  if(nswVersions.failed){box.innerHTML=`<span class="nsw2-chiploading">${esc(nswVersions.error)} — ${t('nsw.typeManually')}</span>`;return}
  const q=(filter||'').toLowerCase();
  const list=q?nswVersions.list.filter(v=>v.toLowerCase().includes(q)):nswVersions.list;
  box.innerHTML=list.length?list.map(v=>`<button class="version-chip" data-version="${esc(v)}">${esc(v)}</button>`).join(''):`<span class="nsw2-chiploading">${t('nsw.noMatches')}</span>`;
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
  const version=versionMode==='specific'?($('#nswVersionInput').value.trim()||'—'):(nswVersions.latest||t('nsw.latestWord'));
  const folderName=nsw.folder?nsw.folder.split(/[\\/]/).filter(Boolean).pop():t('nsw.noFolder');
  const folderSub=$('#nswRailFolderSub'); if(folderSub)folderSub.textContent=folderName;
  const fp=$('#nswFolderPath'); if(fp)fp.textContent=nsw.folder||t('nsw.noFolder');
  $('#nswRailSub1').textContent=NSW_SOFTWARE_LABEL[nsw.software]||nsw.software;
  $('#nswRailSub2').textContent=version;
  $('#nswRailSub3').textContent=`${$('#nswMemorySlider').value} GB`;
  if(nsw.step===3)loadNswVersions(nsw.software);
  if(nsw.step===4){
    if(state.systemMemoryGB){$('#nswMemorySlider').max=Math.max(2,state.systemMemoryGB-1);$('#nswRamHint').textContent=t('nsw.ramHint',{n:state.systemMemoryGB})}
    nswUpdateMemory();
  }
  if(nsw.step===5){
    const memory=$('#nswMemorySlider').value;
    $('#nswSummary').innerHTML=`<div class="nsw2-kv"><span>${t('nsw.sumFolder')}</span><b>${esc(nsw.folder||'—')}</b></div><div class="nsw2-kv"><span>${t('nsw.sumSoftware')}</span><b>${esc(NSW_SOFTWARE_LABEL[nsw.software]||nsw.software)}</b></div><div class="nsw2-kv"><span>${t('nsw.sumVersion')}</span><b>${esc(version)}</b></div><div class="nsw2-kv"><span>${t('nsw.sumJava')}</span><b>${nswJava.java?`Java ${nswJava.java}${nswJava.exact?' (verified)':'+'}`:'—'}</b></div><div class="nsw2-kv"><span>${t('nsw.sumMemory')}</span><b>${esc(memory)} GB</b></div>`;
  }
  const spigotHint=$('#nswSpigotHint'); if(spigotHint) spigotHint.hidden=!(nsw.step===5&&nsw.software==='spigot');
}
$$('[data-software]').forEach(c=>c.onclick=()=>{
  if(nsw.software===c.dataset.software)return;
  nsw.software=c.dataset.software;
  $$('[data-software]').forEach(x=>x.classList.toggle('active',x===c));
  // invalidate the cached live list so step 2 refetches for this software
  nswVersions={software:null,list:[],latest:null,raw:false,loading:false,failed:false,error:''};
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
window.observer.onWizardProgress(({received,total})=>{
  const fill=$('#nswProgressFill'),label=$('#nswProgressLabel');if(!fill)return;
  if(total>0){fill.classList.remove('indeterminate');fill.style.width=`${Math.min(100,Math.round(received/total*100))}%`;label.textContent=`${formatBytes(received)} / ${formatBytes(total)} (${Math.min(100,Math.round(received/total*100))}%)`}
  else{fill.classList.add('indeterminate');label.textContent=`${formatBytes(received)} downloaded…`}
});
// Returns an error string when the version step is not valid to proceed, else null.
// Catches: "specific" chosen but empty, or a version that is definitively not in the live list.
function nswVersionError(){
  const mode=$$('input[name="nswVersionMode"]').find(r=>r.checked)?.value;
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
$('#nswNext').onclick=async()=>{
  if(nsw.step<5){
    if(nsw.step===1&&!nsw.folder)return toast(t('nsw.pickFolder'),'error');
    if(nsw.step===3){const verr=nswVersionError();if(verr)return toast(verr,'error');}
    nsw.step++;nswRender();return
  }
  if(!nsw.folder)return toast(t('nsw.pickFolder'),'error');
  const software=nsw.software;
  const versionMode=$$('input[name="nswVersionMode"]').find(r=>r.checked)?.value;
  const version=versionMode==='specific'?$('#nswVersionInput').value.trim():'';
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
  const settingsNext={...getSettings(),memoryMin:Math.max(1,Math.floor(memory/2)),memoryMax:memory};
  const sr=await window.observer.saveSettings(settingsNext);if(!sr||!sr.ok){toast((sr&&sr.error)||t('toast.startUnknown'),'error');resetBtn();return}state={...state,settings:settingsNext,java:sr.java};
  const r=await window.observer.wizardCreate({software,version});
  resetBtn();
  if(!r.ok){ if(/cancel/i.test(r.error||'')){ toast(t('toast.downloadCancelled')); return; } toast(r.error,'error');return }
  $('#newServerModal').hidden=true;nsw={step:1,software:'vanilla',folder:''};nswVersions={software:null,list:[],latest:null,raw:false,loading:false,failed:false,error:''};
  try{const s2=await window.observer.getState();state={...state,...s2}}catch{}
  if(r.building){toast(t('nsw.building',{n:r.name}));switchTab('console');return}
  state.files=r.files;refreshUI();switchTab('overview');
  toast(t('nsw.ready'),'success');
};
// The Add-instance flow (also used by the welcome / onboarding "Create a new server" buttons).
function openNewServerWizard(folder){
  nsw={step:1,software:'vanilla',folder:folder||''};
  nswVersions={software:null,list:[],latest:null,raw:false,loading:false,failed:false,error:''};
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
