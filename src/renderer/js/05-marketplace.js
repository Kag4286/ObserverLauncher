// js/05-marketplace.js — split from app.js (lines 726-925); classic script, load in numeric order.
// Marketplace: search results + install confirm modal.
// FEATURE: install-time detail dialog lives in openInstallModal() below — compatibility panel,
// exact version picker, warnings and byte progress replace the old native confirm() prompts.
// Card grid: icon + title/author + source/kind badges + clamped description + meta foot + Install.
// The kind badge class carries the colour (plugin/mod/datapack), source badge shows the registry.
function renderMarket(items){const n=$('#marketResults');if(!items?.length){n.innerHTML=`<article class="panel market-empty"><p class="text-muted">${esc(t('mkt.noResults'))}</p><div class="market-empty-actions"><button class="btn secondary" onclick="document.getElementById('marketQuery').value='';document.getElementById('marketVersion').value='';document.getElementById('marketSearch').click()">${esc(t('mkt.clear'))}</button></div></article>`;return}n.innerHTML=items.map((x,i)=>{const kind=x.kind||'plugin';const blocked=!!x.blocked;const action=blocked?`<button class="btn secondary" data-market-open="${i}">${t('mkt.cfOpenPage')}</button>`:`<button class="btn primary" data-market-install="${i}">${t('mkt.install')}</button>`;const badge=blocked?`<span class="mi-badge warn">${t('mkt.cfBlocked')}</span>`:'';return `<article class="market-item" data-mid="${esc(x.id)}"><div class="market-icon">${x.icon?`<img src="${esc(x.icon)}" alt="" loading="lazy">`:'<svg viewBox="0 0 24 24"><path d="M4 7l8-4 8 4-8 4-8-4z"/><path d="M4 7v10l8 4 8-4V7"/></svg>'}</div><div class="mi-body"><div class="mi-top"><h3>${esc(x.title)}</h3><span class="mi-author">${esc(x.author||t('mkt.unknownAuthor'))}</span></div><div class="mi-badges"><span class="mi-badge src">${esc(x.source)}</span><span class="mi-badge kind-${esc(kind)}">${esc(t('mkt.'+kind+'Type')||kind)}</span>${badge}</div><p>${esc(x.description||t('mkt.noDescription'))}</p><div class="mi-foot"><small>⤓ ${Number(x.downloads||0).toLocaleString()}</small>${action}</div></div></article>`}).join('');$$('[data-market-install]').forEach(b=>b.onclick=()=>{
  const item=items[Number(b.dataset.marketInstall)];
  openInstallModal(item);
});$$('[data-market-open]').forEach(b=>b.onclick=()=>{const item=items[Number(b.dataset.marketOpen)];if(item&&item.projectUrl)window.observer.marketOpenExternal(item.projectUrl)});
  // CSP-safe broken-image fallback: a remote icon that 404s / is blocked must show the generic
  // placeholder, not the browser's broken-image glyph. Inline onerror is forbidden by the CSP, so
  // bind here instead.
  const PH='<svg viewBox="0 0 24 24"><path d="M4 7l8-4 8 4-8 4-8-4z"/><path d="M4 7v10l8 4 8-4V7"/></svg>';
  n.querySelectorAll('.market-icon img').forEach(img=>{img.addEventListener('error',()=>{const d=img.parentElement;if(d){d.innerHTML=PH}},{once:true})});
  // Spigot lazily enriches its rows (search has no icon/author) WITHOUT re-rendering: fetch the page's
  // details in the background and patch each card in place. Cached backend-side, so re-paging is free.
  if(items.some(x=>x.source==='spigot')&&window.observer.marketSpigotDetails){
    const ids=items.filter(x=>x.source==='spigot').map(x=>String(x.id));
    window.observer.marketSpigotDetails(ids).then(r=>{
      if(!r||!r.ok||!r.details)return;
      const map=r.details;
      n.querySelectorAll('.market-item[data-mid]').forEach(card=>{
        const d=map[card.dataset.mid];if(!d)return;
        if(d.icon){const box=card.querySelector('.market-icon');if(box&&!box.querySelector('img')){const im=document.createElement('img');im.loading='lazy';im.alt='';im.onerror=()=>{box.innerHTML=PH};im.src=d.icon;box.innerHTML='';box.appendChild(im)}}
        if(d.author){const a=card.querySelector('.mi-author');if(a)a.textContent=d.author}
      });
      // BUGFIX: the enrichment only patched the DOM, so the MODEL kept the empty author. Clicking
      // Install handed that raw row to the modal, which then showed "Unknown author" for a
      // project whose name was already on screen in the list. Write it back into the model too.
      for(const x of items){const d=map[String(x.id)];if(!d)continue;if(d.author)x.author=d.author;if(d.icon)x.icon=d.icon}
    }).catch(()=>{});
  }
}

// ============ INSTALL CONFIRM MODAL ============
// Full GUI confirmation for Marketplace installs: compatibility panel (game version / loader /
// server-side support vs the DETECTED server), exact version picker (Modrinth), pre-install
// warnings, and real byte progress — single file for mods/plugins, per-file for modpacks.
let installState={item:null,detail:null,versionId:null,busy:false,done:false};
const imFmtBytes=n=>{if(!n)return'—';if(n<1024)return n+' B';if(n<1048576)return (n/1024).toFixed(0)+' KB';if(n<1073741824)return (n/1048576).toFixed(1)+' MB';return (n/1073741824).toFixed(2)+' GB'};
// v5.3.0: return BOTH `loader` (the matching FAMILY - paper/purpur/leaf/folia all accept Paper
// plugins, so the compat match keeps the coarse group) and `software` (the EXACT jar name, for the
// "YOUR SERVER" label). Before this, the family value WAS the label, so a Leaf server showed
// "YOUR SERVER: paper". neoforge is checked BEFORE forge on purpose: "neoforge" contains "forge",
// so a forge test first would mislabel every NeoForge server as Forge.
function imDetectServer(){
  const jar=String(state.files?.jar||'');
  const mc=(jar.match(/\b(1\.\d{1,2}(?:\.\d{1,2})?|26\.\d{1,2})\b/)||[])[1]||null;
  let loader='unknown',software='unknown';
  if(/velocity|bungee|waterfall/i.test(jar)){loader='proxy';software='velocity'}
  else if(/purpur/i.test(jar)){loader='paper';software='purpur'}
  else if(/leaf/i.test(jar)){loader='paper';software='leaf'}
  else if(/folia/i.test(jar)){loader='paper';software='folia'}
  else if(/paper/i.test(jar)){loader='paper';software='paper'}
  else if(state.files?.hasSpigotConfig){loader='paper';software='paper'}
  else if(/neoforge/i.test(jar)){loader='neoforge';software='neoforge'}
  else if(/forge/i.test(jar)){loader='forge';software='forge'}
  else if(/fabric|quilt/i.test(jar)){loader='fabric';software='fabric'}
  else if(jar){loader='vanilla';software='vanilla'}
  return {mc,loader,software};
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
    cells.push(`<div class="im-compat-cell"><small>MINECRAFT</small>${imBadge(match,gv.length?[...gv].reverse().slice(0,3).join(', '):'—',!match)}${match?'':`<small class="im-sub">${t('mkt.serverShort',{v:esc(gameV||'unknown')})}</small>`}</div>`);
    const ld=(chosen.loaders||[]).filter(l=>!/datapack|minecraft/i.test(l));
    const loaderOk=srv.loader==='unknown'?null:(ld.length?ld.some(l=>l===srv.loader||(srv.loader==='paper'&&/paper|spigot|bukkit/.test(l))):null);
    cells.push(`<div class="im-compat-cell"><small>LOADER</small>${imBadge(ld.length?(loaderOk===null?null:loaderOk):null,ld.length?ld.join(' / '):'vanilla',loaderOk===false)}</div>`);
  } else {
    // BUGFIX: this cell used to LABEL itself with the server's Minecraft version (gameV), so on a
    // 26.3 server a plugin that supports 1.8-1.16 showed "MINECRAFT 26.3" in red, which reads as
    // "the mod targets 26.3". The label is what the BUILD supports now; the red/green still says
    // whether the server's version is inside that list.
    const buildMc=(chosen&&chosen.gameVersions||[]).filter(Boolean);
    const buildMcLabel=buildMc.length?(buildMc.length>2?`${buildMc[0]} – ${buildMc[buildMc.length-1]}`:buildMc.join(', ')):(gameV||t('mkt.allVersionsShort'));
    const mcMatches=!(chosen&&gameV&&buildMc.length&&!buildMc.includes(gameV));
    cells.push(`<div class="im-compat-cell"><small>MINECRAFT</small>${imBadge(mcMatches,buildMcLabel,!mcMatches)}${(!mcMatches&&gameV)?`<small class="im-sub">${esc(t('mkt.serverShort',{v:gameV}))}</small>`:''}</div>`);
    const itemLoaders=item.loaders||[];
    const groupMap={plugin:['paper','spigot','purpur','folia','bukkit','proxy'],forge:['forge','neoforge'],fabric:['fabric','quilt']};
    const wanted=groupMap[item.kind]||null;
    const match=wanted?(srv.loader!=='unknown'&&wanted.includes(srv.loader)):null;
    cells.push(`<div class="im-compat-cell"><small>YOUR SERVER</small>${imBadge(match,srv.software==='unknown'?'unknown':srv.software,itemLoaders.length&&match===false)}</div>`);
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
    warns.push(t('mkt.installsInto',{p:esc(item.kind==='datapack'?(state.files?.datapackFolder||'world/datapacks'):item.kind==='mod'?'mods':'plugins')}));
  }
  el.innerHTML=warns.map(w=>`<li>${w}</li>`).join('');
  $('#imWarnSection').hidden=!warns.length;
}
// DEPENDENCIES (1.3.0): a Modrinth version's required deps (and incompatible flags). Shows a name
// if we fetched metadata, an 'installed' tick if a plugin/mod file matches the dep slug, and a
// one-click 'install all required' that chains marketInstall for each. Optional deps are listed
// but never auto-installed.
function imDepInstalled(dep){
  const lists=[...(state.files?.plugins||[]),...(state.files?.mods||[]),...(state.files?.datapacks||[])];
  const slug=String(dep.slug||'').toLowerCase();
  if(!slug) return false;
  return lists.some(f=>String(f).toLowerCase().includes(slug.replace(/[^a-z0-9]/g,''))||String(f).toLowerCase().includes(slug));
}
function imRenderDeps(){
  const sec=$('#imDepsSection'),list=$('#imDeps'),btn=$('#imInstallDeps');
  if(!sec)return;
  const chosen=imChosenVersion();
  const deps=(chosen?.dependencies||[]).filter(d=>d.type==='required'||d.type==='incompatible');
  if(!deps.length){sec.hidden=true;return}
  installState.deps=deps;
  sec.hidden=false;
  list.innerHTML=deps.map((d,i)=>{
    const name=d.title||d.slug||(d.projectId?('project '+String(d.projectId).slice(0,8)):t('im.depUnknown'));
    const bad=d.type==='incompatible';
    const done=!bad&&imDepInstalled(d);
    return `<li class="im-dep${bad?' bad':''}${done?' done':''}">${d.icon?`<img src="${esc(d.icon)}" alt="">`:''}<span class="im-dep-name">${esc(name)}</span><span class="im-dep-tag">${bad?esc(t('im.depIncompat')):done?esc(t('im.depInstalled')):esc(t('im.depRequired'))}</span></li>`;
  }).join('');
  const need=deps.filter(d=>d.type==='required'&&!imDepInstalled(d)).length;
  // v5.3.0: CurseForge has no official relationType table, so its deps are best-effort (uncertain).
  // List them, but never offer the one-click auto-install for a CurseForge item (matches the MCP
  // planner, which also refuses to auto-install uncertain CF deps).
  const cfNoAuto=installState.item?.source==='curseforge';
  btn.hidden=cfNoAuto||need===0;
  btn.textContent=t('im.installDeps',{n:need});
}
// SOURCE LINKS: project page + source (if Modrinth gave one). Both go through the allowlisted
// market:open-external IPC; the URL is never navigated in-app.
function imRenderLinks(){
  const el=$('#imLinks');if(!el)return;
  const d=installState.detail||{};
  const links=[];
  if(d.projectUrl)links.push({url:d.projectUrl,label:t('im.viewProject')});
  if(d.sourceUrl)links.push({url:d.sourceUrl,label:t('im.viewSource')});
  el.innerHTML=links.map(l=>`<button type="button" class="text-btn im-link" data-im-link="${esc(l.url)}">${esc(l.label)} ↗</button>`).join('');
  el.querySelectorAll('[data-im-link]').forEach(b=>b.onclick=()=>window.observer.marketOpenExternal(b.dataset.imLink));
}
function imSetBusy(busy,phase,label){
  installState.busy=busy;
  const card=$('#installModal .im');
  if(card){card.classList.toggle('installing',!!busy);if(busy)card.classList.remove('success')}
  const btn=$('#imInstall'),cancel=$('#imCancel'),prog=$('#imProgressSection');
  btn.disabled=busy;cancel.disabled=busy;
  $('#imClose').disabled=busy;
  prog.hidden=!busy&&!installState.done;
  if(busy){btn.textContent=t('im.installing');$('#imPhase').textContent=phase||t('im.downloading');if(label)$('#imBarLabel').textContent=label}
}
// The information line for one version: date, size and the Minecraft versions it supports.
// A Spigot version has no per-build MC list, so the RESOURCE's declared range is shown.
// Shared by the picker options and the read-only list (the no-dup guard rejects a copy).
function imVersionBits(v){
  const mcList=(v.gameVersions||[]).filter(Boolean);
  const mc=mcList.length?(mcList.length>2?`${mcList[0]} – ${mcList[mcList.length-1]}`:mcList.join(', ')):'—';
  const bits=[new Date(v.date).toLocaleDateString()];
  if(v.size)bits.push(imFmtBytes(v.size));
  bits.push(`Minecraft ${mc}`);
  if(v.blocked)bits.push(t('mkt.cfBlocked'));
  return bits;
}
function imRenderVersionPicker(){
  const sec=$('#imVersionSection'),sel=$('#imVersion');
  const vs=installState.detail?.versions;
  const list=$('#imVersionList'),note=$('#imVersionNote');
  // The <select> is a custom dropdown: enhanceSelect() wraps it in a div.ol-dd and moves the
  // native select inside. Hiding the select alone leaves the WRAPPER on screen, which is how an
  // empty dropdown box ended up under the VERSION heading. Hide the wrapper.
  const dd=sel.closest('.ol-dd');
  if(!vs||!vs.length){sec.hidden=true;if(list)list.hidden=true;return}
  sec.hidden=false;
  // A source that cannot install a chosen build must not offer the choice. Spiget serves only
  // the resource's latest build: the version-specific download endpoint answers 403 and the
  // ?version= parameter is ignored (every version returns the same file). The list is still
  // shown, read-only, because it carries the Minecraft versions the resource declares.
  if(installState.detail.versionPickable===false){
    // Nothing to choose: the select is emptied, and the dropdown hides itself (a select with no
    // options has no dropdown to show). The list below carries the information instead.
    sel.innerHTML='';
    if(dd&&dd._olSync)dd._olSync();else sel.hidden=true;
    if(list){
      list.hidden=false;
      // A Spigot resource can have 25+ builds. Listing them all pushed the Install button off
      // the bottom of the window, so only the newest few are shown; the note below says how many
      // the resource has in total.
      const shown=vs.slice(0,5);
      list.innerHTML=shown.map(v=>`<li class="im-version"><b>${esc(v.number)}</b><span>${esc(imVersionBits(v).join(' · '))}</span></li>`).join('')
        + (vs.length>shown.length?`<li class="im-version more"><span>${t('mkt.moreBuilds',{n:vs.length-shown.length})}</span></li>`:'');
    }
    if(note){note.hidden=false;note.textContent=t('mkt.latestOnly')}
    return;
  }
  if(dd)dd.hidden=false;else sel.hidden=false;
  if(list)list.hidden=true;
  if(note)note.hidden=true;  // BUGFIX (v6.0.0 follow-up): the option label packed version, date, size and a Minecraft version
  // onto one line. In the narrow modal the dot in "1.16" was lost at that font size, so it read
  // "116". Split it: the version number is the label, the rest is the title tooltip.
  sel.innerHTML=vs.map(v=>{
    const info=imVersionBits(v).join(' · ');
    return `<option value="${esc(v.id)}" title="${esc(info)}">${esc(v.number)} — ${esc(info)}</option>`;
  }).join('');
  // The custom dropdown caches the button label from the moment it was enhanced, and this
  // select was empty then. Without this the button shows no text at all, which reads as an
  // empty version list.
  if(dd&&dd._olSync)dd._olSync();
  sel.onchange=()=>{installState.versionId=sel.value;imRenderCompat();imRenderWarns();imRenderDeps()};
}
function imSetDone(r){
  installState.done=true;installState.busy=false;
  const card=$('#installModal .im');if(card){card.classList.remove('installing');card.classList.add('success')}
  $('#imProgressSection').hidden=false;
  $('#imPhase').textContent=t('im.installed');
  $('#imBar').style.width='100%';$('#imBar').classList.add('ok');
  $('#imBarLabel').textContent=(r.installed!=null?`${r.installed} file(s) installed${r.skipped?`, ${r.skipped} client-only skipped`:''}`:(r.name||'OK'))+t('im.restartNote');
  $('#imFileWrap').hidden=true;
  const btn=$('#imInstall');btn.disabled=false;btn.textContent=t('im.close');
  $('#imCancel').hidden=true;
  $('#imNote').textContent='';
  state.files=r.files||state.files;refreshUI();
}
function imSetError(msg){
  installState.busy=false;
  const card=$('#installModal .im');if(card)card.classList.remove('installing');
  const btn=$('#imInstall');btn.disabled=false;btn.textContent=t('im.retry');
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
    else if(r.blocked){imSetError(r.error||t('mkt.cfBlocked'));if(r.projectUrl)window.observer.marketOpenExternal(r.projectUrl)}
    else imSetError(r.error||t('mkt.installFailed'));
  }catch(e){imSetError(e?.message||t('mkt.installFailed'))}
}
// Install every REQUIRED dependency that is not already present, one after another (the market
// install IPC is one-file-at-a-time). Each dep is fetched by its project id + the current MC
// version. Failures are collected and reported, never silently swallowed. The main item is NOT
// reinstalled here — this only fills the missing deps.
async function imInstallDeps(){
  const deps=(installState.deps||[]).filter(d=>d.type==='required'&&!imDepInstalled(d));
  if(!deps.length)return;
  const conf=await confirmDialog({title:t('im.installDepsTitle'),body:t('im.installDepsConfirm',{n:deps.length}),ok:t('im.install')});
  if(!conf)return;
  const mc=imDetectServer().mc||'';
  imSetBusy(true,t('im.depsInstalling'));
  $('#imBar').style.width='0%';$('#imBar').classList.remove('ok','bad');
  let done=0;const failed=[];
  for(const d of deps){
    try{
      const r=await window.observer.marketInstall({id:d.projectId,kind:installState.item.kind,version:mc||undefined,title:d.title||d.slug});
      if(r.ok)done++;else failed.push(d.title||d.slug||d.projectId);
    }catch{failed.push(d.title||d.slug||d.projectId)}
    $('#imBar').style.width=Math.round((done+failed.length)/deps.length*100)+'%';
    $('#imBarLabel').textContent=t('im.depsProgress',{a:done+failed.length,b:deps.length});
  }
  installState.busy=false;
  imRenderDeps();
  if(failed.length){imSetError(t('im.depsPartial',{ok:done,fail:failed.length}));toast(t('im.depsPartial',{ok:done,fail:failed.length}),'error')}
  else{imSetBusy(false);$('#imProgressSection').hidden=true;toast(t('im.depsDone',{n:done}),'success')}
}
$('#imInstallDeps')&&($('#imInstallDeps').onclick=()=>{imInstallDeps()});
function openInstallModal(item){
  const srv=imDetectServer();
  item.software=srv.software;
  item.loader=srv.loader;
  installState={item,detail:null,versionId:null,busy:false,done:false};
  const m=$('#installModal');
  // Cancel a pending close from the previous modal, or its timer will hide THIS one mid-open.
  if(m._closeTimer){ clearTimeout(m._closeTimer); m._closeTimer=0; }
  m.classList.remove('closing');
  const card=$('#installModal .im');if(card)card.classList.remove('installing','success');
  m.hidden=false;
  trapFocus(m);
  $('#imTitle').textContent=item.title||'—';
  $('#imMeta').textContent=`${item.author||t('mkt.unknownAuthor')} · ${item.source} · ${t('mkt.downloads',{n:Number(item.downloads||0).toLocaleString()})}`;
  $('#imKind').textContent=item.kind;
  $('#imDesc').textContent=item.description||'';
  $('#imIcon').src=item.icon||'';
  $('#imIcon').style.visibility=item.icon?'visible':'hidden';
  $('#imNote').textContent='';
  $('#imProgressSection').hidden=true;
  $('#imBar').classList.remove('ok','bad');
  const btn=$('#imInstall');btn.disabled=true;btn.textContent=t('mkt.loading');
  $('#imCancel').hidden=false;$('#imCancel').disabled=false;$('#imClose').disabled=false;
  $('#imCompat').innerHTML=`<span class="nsw2-chiploading">${t('mkt.checkingCompat')}</span>`;
  $('#imWarns').innerHTML='';
  const ds=$('#imDepsSection');if(ds)ds.hidden=true;
  const dl=$('#imDeps');if(dl)dl.innerHTML='';
  const dlk=$('#imLinks');if(dlk)dlk.innerHTML='';
  const dib=$('#imInstallDeps');if(dib)dib.hidden=true;
  window.observer.marketDetail(item).then(d=>{
    if(installState.item!==item)return; // modal was reopened for another item meanwhile
    if(!d||!d.ok){$('#imCompat').innerHTML=`<span class="im-badge bad">${t('mkt.couldNotLoad',{m:esc(d?.error||'unknown')})}</span>`;const b2=$('#imInstall');b2.disabled=false;b2.textContent=t('mkt.installAnyway');return}
    installState.detail=d;
    // BUGFIX: the meta line was written once, from the search row, before the detail was loaded.
    // A Spigot search row carries only the author's numeric id, so the modal said "Unknown
    // author" for every Spigot project even though the list card had resolved the name in the
    // background. The detail response has the real name, so refresh the line with it.
    if(d.author||d.icon){
      $('#imMeta').textContent=`${d.author||item.author||t('mkt.unknownAuthor')} · ${item.source} · ${t('mkt.downloads',{n:Number(item.downloads||0).toLocaleString()})}`;
      if(d.icon){$('#imIcon').src=d.icon;$('#imIcon').style.visibility='visible'}
    }
    imRenderVersionPicker();
    installState.versionId=installState.detail.versions?.[0]?.id||null;
    imRenderCompat();imRenderWarns();imRenderDeps();imRenderLinks();
    const b2=$('#imInstall');b2.disabled=false;b2.textContent=t('mkt.install');
  });
}
// BUGFIX (v6.0.0 follow-up): closing scheduled a 140 ms hide timer but never stored it. If the user
// closed the modal and opened another mod within that window, the STALE timer fired after the new
// modal was already open and set hidden=true, so the modal for the second mod was invisible while
// JS believed it was open. Clicking Install then did nothing visible. The timer is stored on the
// modal now and cancelled the moment the modal is reopened.
function closeInstallModal(){
  const m=$('#installModal');
  if(installState.busy)return toast(t('toast.waitInstall'),'error');
  if(m.hidden)return;
  releaseFocus();
  m.classList.add('closing');
  m._closeTimer=setTimeout(()=>{m.hidden=true;m.classList.remove('closing');m._closeTimer=0},140);
  installState.done=false;
  const btn=$('#imInstall');btn.textContent=t('mkt.install');
}
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
