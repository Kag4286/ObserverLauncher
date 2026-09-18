// js/05-marketplace.js — split from app.js (lines 726-925); classic script, load in numeric order.
// Marketplace: search results + install confirm modal.
// FEATURE: install-time detail dialog lives in openInstallModal() below — compatibility panel,
// exact version picker, warnings and byte progress replace the old native confirm() prompts.
// Card grid: icon + title/author + source/kind badges + clamped description + meta foot + Install.
// The kind badge class carries the colour (plugin/mod/datapack), source badge shows the registry.
function renderMarket(items){const n=$('#marketResults');if(!items?.length){n.innerHTML=`<article class="panel glass market-empty"><p class="text-muted">${esc(t('mkt.noResults'))}</p><div class="market-empty-actions"><button class="btn secondary" onclick="document.getElementById('marketQuery').value='';document.getElementById('marketVersion').value='';document.getElementById('marketSearch').click()">${esc(t('mkt.clear'))}</button></div></article>`;return}n.innerHTML=items.map((x,i)=>{const kind=x.kind||'plugin';return `<article class="panel glass market-item"><div class="market-icon">${x.icon?`<img src="${esc(x.icon)}" alt="" loading="lazy">`:'<svg viewBox="0 0 24 24"><path d="M4 7l8-4 8 4-8 4-8-4z"/><path d="M4 7v10l8 4 8-4V7"/></svg>'}</div><div class="mi-body"><div class="mi-top"><h3>${esc(x.title)}</h3><span class="mi-author">${esc(x.author||'Unknown author')}</span></div><div class="mi-badges"><span class="mi-badge src">${esc(x.source)}</span><span class="mi-badge kind-${esc(kind)}">${esc(t('mkt.'+kind+'Type')||kind)}</span></div><p>${esc(x.description||'No description')}</p><div class="mi-foot"><small>⤓ ${Number(x.downloads||0).toLocaleString()}</small><button class="btn primary" data-market-install="${i}">Install</button></div></div></article>`}).join('');$$('[data-market-install]').forEach(b=>b.onclick=()=>{
  const item=items[Number(b.dataset.marketInstall)];
  openInstallModal(item);
})}

// ============ INSTALL CONFIRM MODAL ============
// Full GUI confirmation for Marketplace installs: compatibility panel (game version / loader /
// server-side support vs the DETECTED server), exact version picker (Modrinth), pre-install
// warnings, and real byte progress — single file for mods/plugins, per-file for modpacks.
let installState={item:null,detail:null,versionId:null,busy:false,done:false};
const imFmtBytes=n=>{if(!n)return'—';if(n<1024)return n+' B';if(n<1048576)return (n/1024).toFixed(0)+' KB';if(n<1073741824)return (n/1048576).toFixed(1)+' MB';return (n/1073741824).toFixed(2)+' GB'};
function imDetectServer(){
  const jar=String(state.files?.jar||'');
  const mc=(jar.match(/\b(1\.\d{1,2}(?:\.\d{1,2})?|26\.\d{1,2})\b/)||[])[1]||null;
  let loader='unknown';
  if(/velocity|bungee|waterfall/i.test(jar))loader='proxy';
  else if(/paper|purpur|leaf|folia/i.test(jar)||state.files?.hasSpigotConfig)loader='paper';
  else if(/forge/i.test(jar))loader='forge';
  else if(/neoforge/i.test(jar))loader='neoforge';
  else if(/fabric|quilt/i.test(jar))loader='fabric';
  else if(jar)loader='vanilla';
  return {mc,loader};
}
function imBadge(ok,label,warn){return `<span class="im-badge ${ok===true?'ok':ok===false?'bad':warn?'warn':''}">${label}</span>`}
function imRenderCompat(){
  const el=$('#imCompat');if(!el)return;
  const {item,detail}=installState;
  const srv=imDetectServer();
  const chosen=imChosenVersion();
  const cells=[];
  // game version
  const filterV=$('#marketVersion')?.value||'';
  const gameV=filterV||(srv.mc||'');
  if(item.kind==='modpack'&&chosen){
    const gv=chosen.gameVersions||[];
    const match=!gameV||gv.includes(gameV);
    cells.push(`<div class="im-compat-cell"><small>MINECRAFT</small>${imBadge(match,gv.length?[...gv].reverse().slice(0,3).join(', '):'—',!match)}${match?'':`<small class="im-sub">server: ${esc(gameV||'unknown')}</small>`}</div>`);
    const ld=(chosen.loaders||[]).filter(l=>!/datapack|minecraft/i.test(l));
    const loaderOk=srv.loader==='unknown'?null:(ld.length?ld.some(l=>l===srv.loader||(srv.loader==='paper'&&/paper|spigot|bukkit/.test(l))):null);
    cells.push(`<div class="im-compat-cell"><small>LOADER</small>${imBadge(ld.length?(loaderOk===null?null:loaderOk):null,ld.length?ld.join(' / '):'vanilla',loaderOk===false)}</div>`);
  } else {
    cells.push(`<div class="im-compat-cell"><small>MINECRAFT</small>${imBadge(gameV?(chosen?(chosen.gameVersions||[]).includes(gameV):null):null,gameV||'all versions',chosen&&gameV&&!(chosen.gameVersions||[]).includes(gameV))}</div>`);
    const itemLoaders=item.loaders||[];
    const groupMap={plugin:['paper','spigot','purpur','folia','bukkit'],forge:['forge','neoforge'],fabric:['fabric','quilt']};
    const wanted=groupMap[item.kind]||null;
    const match=wanted?(srv.loader!=='unknown'&&wanted.includes(srv.loader)):null;
    cells.push(`<div class="im-compat-cell"><small>YOUR SERVER</small>${imBadge(match,srv.loader==='unknown'?'unknown':srv.loader,itemLoaders.length&&match===false)}</div>`);
  }
  // server-side support (Modrinth env)
  if(detail?.env){const sup=detail.env.server;cells.push(`<div class="im-compat-cell"><small>SERVER-SIDE</small>${imBadge(sup==='required'?true:sup==='optional'?null:false,sup==='required'?'required':sup==='optional'?'optional':'client-only',sup!=='required')}</div>`)}
  if(chosen?.size)cells.push(`<div class="im-compat-cell"><small>SIZE</small>${imBadge(null,imFmtBytes(chosen.size))}</div>`);
  if(chosen?.date)cells.push(`<div class="im-compat-cell"><small>UPDATED</small>${imBadge(null,new Date(chosen.date).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'}))}</div>`);
  el.innerHTML=cells.map(c=>`<div class="im-compat-cell">${c}</div>`).join('');
}
function imChosenVersion(){
  const {detail,versionId}=installState;
  if(!detail?.versions)return null;
  return detail.versions.find(v=>v.id===versionId)||null;
}
function imRenderWarns(){
  const el=$('#imWarns');if(!el)return;
  const {item,detail}=installState;
  const srv=imDetectServer();
  const chosen=imChosenVersion();
  const warns=[];
  const filterV=$('#marketVersion')?.value||'';
  const gameV=filterV||(srv.mc||'');
  if(item.kind==='modpack'){
    warns.push(t('im.warnPack'));
    if(chosen){const ld=(chosen.loaders||[]).filter(l=>!/datapack|minecraft/i.test(l));
      if(ld.length&&srv.loader==='unknown')warns.push(t('im.warnPackUnknown',{l:esc(ld.join('/'))}));
      else if(ld.length&&!/forge|neoforge|fabric/i.test(String(state.files?.jar||''))&&srv.loader!=='vanilla'&&srv.loader!=='unknown')warns.push(t('im.warnPackLoader',{l:esc(ld.join('/')),s:esc(srv.loader)}));
      else if(ld.length&&srv.loader==='vanilla')warns.push(t('im.warnPackVanilla',{l:esc(ld.join('/'))}));
    }
    if(gameV&&chosen&&!(chosen.gameVersions||[]).includes(gameV))warns.push(t('im.warnPackMc',{v:(chosen.gameVersions||[]).slice(-1)[0]||'?',s:esc(gameV)}));
    warns.push(t('im.warnOverwrite'));
  } else {
    if(detail?.env?.server==='unsupported')warns.push(t('im.warnClientOnly'));
    if(detail?.env?.server==='optional')warns.push(t('im.warnOptional'));
    if(chosen&&gameV&&!(chosen.gameVersions||[]).includes(gameV))warns.push(t('im.warnMc',{v:(chosen.gameVersions||[]).slice(-1)[0]||'?',s:esc(gameV)}));
    const itemLoaders=item.loaders||[];
    const groupMap={plugin:['paper','spigot','purpur','folia','bukkit'],forge:['forge','neoforge'],fabric:['fabric','quilt']};
    const wanted=groupMap[item.kind];
    if(wanted&&itemLoaders.length&&srv.loader!=='unknown'&&!itemLoaders.some(l=>wanted.includes(srv.loader)&&wanted.includes(l))&&!wanted.includes(srv.loader))warns.push(t('im.warnLoader',{l:esc(itemLoaders.join('/')),s:esc(srv.loader)}));
    warns.push(`Installs into <code>${esc(item.kind==='datapack'?(state.files?.datapackFolder||'world/datapacks'):item.kind==='mod'?'mods':'plugins')}/</code> — restart the server to load it.`);
  }
  el.innerHTML=warns.map(w=>`<li>${w}</li>`).join('');
  $('#imWarnSection').hidden=!warns.length;
}
function imSetBusy(busy,phase,label){
  installState.busy=busy;
  const card=$('#installModal .im');
  if(card){card.classList.toggle('installing',!!busy);if(busy)card.classList.remove('success')}
  const btn=$('#imInstall'),cancel=$('#imCancel'),prog=$('#imProgressSection');
  btn.disabled=busy;cancel.disabled=busy;
  $('#imClose').disabled=busy;
  prog.hidden=!busy&&!installState.done;
  if(busy){btn.textContent='Installing…';$('#imPhase').textContent=phase||'DOWNLOADING';if(label)$('#imBarLabel').textContent=label}
}
function imRenderVersionPicker(){
  const sec=$('#imVersionSection'),sel=$('#imVersion');
  const vs=installState.detail?.versions;
  if(!vs||!vs.length){sec.hidden=true;return}
  sec.hidden=false;
  sel.innerHTML=vs.map((v,i)=>`<option value="${esc(v.id)}">${esc(v.number)} — ${new Date(v.date).toLocaleDateString()} · ${imFmtBytes(v.size)} · ${(v.gameVersions||[]).slice(-1)[0]||'?'}</option>`).join('');
  sel.onchange=()=>{installState.versionId=sel.value;imRenderCompat();imRenderWarns()};
}
function imSetDone(r){
  installState.done=true;installState.busy=false;
  const card=$('#installModal .im');if(card){card.classList.remove('installing');card.classList.add('success')}
  $('#imProgressSection').hidden=false;
  $('#imPhase').textContent=t('im.installed');
  $('#imBar').style.width='100%';$('#imBar').classList.add('ok');
  $('#imBarLabel').textContent=(r.installed!=null?`${r.installed} file(s) installed${r.skipped?`, ${r.skipped} client-only skipped`:''}`:(r.name||'OK'))+t('im.restartNote');
  $('#imFileWrap').hidden=true;
  const btn=$('#imInstall');btn.disabled=false;btn.textContent='Close';
  $('#imCancel').hidden=true;
  $('#imNote').textContent='';
  state.files=r.files||state.files;refreshUI();
}
function imSetError(msg){
  installState.busy=false;
  const card=$('#installModal .im');if(card)card.classList.remove('installing');
  const btn=$('#imInstall');btn.disabled=false;btn.textContent='Retry';
  $('#imCancel').hidden=false;$('#imCancel').disabled=false;$('#imClose').disabled=false;
  $('#imProgressSection').hidden=false;
  $('#imPhase').textContent=t('im.failed');
  $('#imBar').style.width='100%';$('#imBar').classList.remove('ok');$('#imBar').classList.add('bad');
  $('#imBarLabel').textContent=msg;
}
async function startInstall(){
  const {item,versionId}=installState;
  imSetBusy(true,t('im.downloading'),t('nsw.latestSub'));
  $('#imBar').style.width='0%';$('#imBar').classList.remove('ok','bad');
  try{
    let r;
    if(item.kind==='modpack')r=await window.observer.installMarketModpack({id:item.id,version:item.version,versionId:versionId||undefined});
    else r=await window.observer.marketInstall({...item,versionId:versionId||undefined});
    if(r.ok){imSetDone(r);toast(t('toast.installed',{n:r.name||item.title}),'success')}
    else imSetError(r.error||'Install failed.');
  }catch(e){imSetError(e?.message||'Install failed.')}
}
function openInstallModal(item){
  installState={item,detail:null,versionId:null,busy:false,done:false};
  const card=$('#installModal .im');if(card)card.classList.remove('installing','success');
  $('#installModal').hidden=false;
  $('#imTitle').textContent=item.title||'—';
  $('#imMeta').textContent=`${item.author||'Unknown author'} · ${item.source} · ${Number(item.downloads||0).toLocaleString()} downloads`;
  $('#imKind').textContent=item.kind;
  $('#imDesc').textContent=item.description||'';
  $('#imIcon').src=item.icon||'';
  $('#imIcon').style.visibility=item.icon?'visible':'hidden';
  $('#imNote').textContent='';
  $('#imProgressSection').hidden=true;
  $('#imBar').classList.remove('ok','bad');
  const btn=$('#imInstall');btn.disabled=true;btn.textContent='Loading…';
  $('#imCancel').hidden=false;$('#imCancel').disabled=false;$('#imClose').disabled=false;
  $('#imCompat').innerHTML='<span class="nsw2-chiploading">Checking compatibility…</span>';
  $('#imWarns').innerHTML='';
  window.observer.marketDetail(item).then(d=>{
    if(installState.item!==item)return; // modal was reopened for another item meanwhile
    if(!d||!d.ok){$('#imCompat').innerHTML=`<span class="im-badge bad">Could not load details: ${esc(d?.error||'unknown')}</span>`;const b2=$('#imInstall');b2.disabled=false;b2.textContent='Install anyway';return}
    installState.detail=d;
    imRenderVersionPicker();
    installState.versionId=installState.detail.versions?.[0]?.id||null;
    imRenderCompat();imRenderWarns();
    const b2=$('#imInstall');b2.disabled=false;b2.textContent='Install';
  });
}
function closeInstallModal(){const m=$('#installModal');if(installState.busy)return toast(t('toast.waitInstall'),'error');if(m.hidden)return;m.classList.add('closing');setTimeout(()=>{m.hidden=true;m.classList.remove('closing')},140);installState.done=false;const btn=$('#imInstall');btn.textContent='Install'}
$('#imClose').onclick=closeInstallModal;
$('#imCancel').onclick=closeInstallModal;
$('#imInstall').onclick=()=>{if(installState.done)return closeInstallModal();if(installState.busy)return;startInstall()};
window.observer.onMarketProgress(p=>{
  if(!p)return;const sec=$('#imProgressSection');if(sec.hidden&&installState.busy)sec.hidden=false;
  if(p.phase==='extract'){$('#imPhase').textContent=t('im.extracting');$('#imBar').classList.add('indeterminate');$('#imBarLabel').textContent=p.name;return}
  $('#imBar').classList.remove('indeterminate');
  if(p.phase==='pack'||(p.phase==='file'&&!p.index)){
    // single archive / single file download — bytes only
    $('#imPhase').textContent=t('im.downloading');
    const pct=p.total?Math.min(100,Math.round(p.received/p.total*100)):0;
    $('#imBar').style.width=pct+'%';
    $('#imBarLabel').textContent=`${p.name} — ${imFmtBytes(p.received)} / ${imFmtBytes(p.total)} (${pct}%)`;
    return;
  }
  if(p.phase==='modpack'){
    // per-file install: `total` = file count, `fileTotal` = current file's bytes (never mixed)
    $('#imPhase').textContent=t('im.installingFiles',{a:p.index,b:p.total});
    const frac=(p.received||0)/((p.fileTotal||1));
    const pct=Math.min(100,Math.round(((p.index-1)+Math.min(1,frac))/p.total*100));
    $('#imBar').style.width=pct+'%';
    $('#imBarLabel').textContent=t('im.filesOf',{a:p.index,b:p.total});
    const fw=$('#imFileWrap');fw.hidden=false;
    const fp=p.fileTotal?Math.min(100,Math.round((p.received||0)/p.fileTotal*100)):0;
    $('#imFileBar').style.width=fp+'%';
    $('#imFileName').textContent=`${p.name} — ${imFmtBytes(p.received)} / ${imFmtBytes(p.fileTotal)} (${fp}%)`;
  }
});
