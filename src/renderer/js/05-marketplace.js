// js/05-marketplace.js — split from app.js (lines 726-925); classic script, load in numeric order.
// Marketplace: search results + install confirm modal.
// FEATURE: install-time detail dialog lives in openInstallModal() below — compatibility panel,
// exact version picker, warnings and byte progress replace the old native confirm() prompts.
// Card grid: icon + title/author + source/kind badges + clamped description + meta foot + Install.
// The kind badge class carries the colour (plugin/mod/datapack), source badge shows the registry.
function renderMarket(items){
  const n=$('#marketResults');
  if(!items?.length){
    n.innerHTML=`<article class="panel market-empty"><p class="text-muted">${esc(t('mkt.noResults'))}</p><div class="market-empty-actions"><button class="btn secondary" onclick="document.getElementById('marketQuery').value='';document.getElementById('marketVersion').value='';document.getElementById('marketSearch').click()">${esc(t('mkt.clear'))}</button></div></article>`;
    return;
  }
  const srv=imDetectServer();
  n.innerHTML=items.map((x,i)=>{
    const kind=x.kind||'plugin';
    const blocked=!!x.blocked;
    const action=blocked?`<button class="btn secondary" data-market-open="${i}">${t('mkt.cfOpenPage')}</button>`:`<button class="btn primary" data-market-install="${i}">${t('mkt.install')}</button>`;
    const badge=blocked?`<span class="mi-badge warn">${t('mkt.cfBlocked')}</span>`:'';
    const itemLoaders = Array.isArray(x.loaders) ? x.loaders : (x.loader ? [x.loader] : []);
    let isCompat = true;
    let compatBadge = '';
    const checkLdr = srv.loader;

    if(kind === 'datapack' || itemLoaders.includes('datapack') || checkLdr === 'datapack'){
      isCompat = true;
    } else if(checkLdr && checkLdr !== 'unknown'){
      const groupMap = { plugin: ['paper','purpur','leaf','folia','spigot','bukkit'], neoforge: ['neoforge'], forge: ['forge'], fabric: ['fabric','quilt'], proxy: ['proxy','velocity'] };
      if(kind === 'neoforge' && checkLdr !== 'neoforge') isCompat = false;
      else if(kind === 'forge' && checkLdr !== 'forge') isCompat = false;
      else if(kind === 'fabric' && checkLdr !== 'fabric') isCompat = false;
      else if(kind === 'plugin' && !groupMap.plugin.includes(checkLdr)) isCompat = false;
      else if(itemLoaders.length && !itemLoaders.some(l => {
        const cl = String(l).toLowerCase();
        return cl === checkLdr || (checkLdr === 'paper' && /paper|spigot|purpur|folia/.test(cl)) || (checkLdr === 'neoforge' && cl === 'neoforge') || (checkLdr === 'fabric' && /fabric|quilt/.test(cl)) || (checkLdr === 'forge' && cl === 'forge');
      })) isCompat = false;

      if(!isCompat){
        compatBadge = `<span class="mi-badge compat-warn">${esc(t('mkt.compatWarn'))}</span>`;
      }
    }

    const kindLabel = t('mkt.' + kind + 'Type') || (kind === 'mod' ? t('mkt.modType') : kind);
    return `<article class="market-item${isCompat?'':' incompatible'}" data-mid="${esc(x.id)}"><div class="market-icon">${x.icon?`<img src="${esc(x.icon)}" alt="" loading="lazy">`:'<svg viewBox="0 0 24 24"><path d="M4 7l8-4 8 4-8 4-8-4z"/><path d="M4 7v10l8 4 8-4V7"/></svg>'}</div><div class="mi-body"><div class="mi-top"><h3>${esc(x.title)}</h3><span class="mi-author">${esc(x.author||t('mkt.unknownAuthor'))}</span></div><div class="mi-badges"><span class="mi-badge src">${esc(x.source)}</span><span class="mi-badge kind-${esc(kind)}">${esc(kindLabel)}</span>${compatBadge}${badge}</div><p>${esc(x.description||t('mkt.noDescription'))}</p><div class="mi-foot"><small>⤓ ${Number(x.downloads||0).toLocaleString()}</small>${action}</div></div></article>`;
  }).join('');
  $$('[data-market-install]').forEach(b=>b.onclick=()=>{
    const item=items[Number(b.dataset.marketInstall)];
    openInstallModal(item);
  });
  $$('[data-market-open]').forEach(b=>b.onclick=()=>{const item=items[Number(b.dataset.marketOpen)];if(item&&item.projectUrl)window.observer.marketOpenExternal(item.projectUrl)});
  const PH='<svg viewBox="0 0 24 24"><path d="M4 7l8-4 8 4-8 4-8-4z"/><path d="M4 7v10l8 4 8-4V7"/></svg>';
  n.querySelectorAll('.market-icon img').forEach(img=>{img.addEventListener('error',()=>{const d=img.parentElement;if(d){d.innerHTML=PH}},{once:true})});
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
  if(state.files?.target?.loader && state.files.target.loader !== 'unknown'){
    return {
      mc: state.files.target.mc || (String(state.files?.jar||'').match(/\b(1\.\d{1,2}(?:\.\d{1,2})?|26\.\d{1,2})\b/)||[])[1]||null,
      loader: state.files.target.loader,
      software: state.files.target.software || state.files.target.loader
    };
  }
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
function imLoaderMatches(targetList, srvLoader){
  if(!srvLoader||srvLoader==='unknown')return null;
  const lds=targetList.map(l=>String(l).toLowerCase());
  if(lds.includes('datapack')||srvLoader==='datapack')return true;
  if(srvLoader==='paper')return lds.some(l=>/paper|spigot|purpur|folia|bukkit/.test(l));
  if(srvLoader==='fabric')return lds.includes('fabric')||lds.includes('quilt');
  if(srvLoader==='neoforge')return lds.includes('neoforge');
  if(srvLoader==='forge')return lds.includes('forge')&&!lds.includes('neoforge');
  if(srvLoader==='proxy')return lds.some(l=>/velocity|bungee|waterfall|proxy/.test(l));
  return lds.includes(srvLoader);
}
function imVersionMatchesLoader(v, ldr){
  if(!ldr||ldr==='auto'||ldr==='unknown'||ldr==='all')return true;
  const lds=(v.loaders||[]).map(l=>String(l).toLowerCase());
  if(!lds.length)return true;
  if(ldr==='neoforge')return lds.includes('neoforge');
  if(ldr==='forge')return lds.includes('forge')&&!lds.includes('neoforge');
  if(ldr==='fabric')return lds.includes('fabric')||lds.includes('quilt');
  if(ldr==='plugin'||ldr==='paper')return lds.some(l=>/paper|spigot|purpur|folia|bukkit/.test(l));
  if(ldr==='proxy')return lds.some(l=>/velocity|bungee|waterfall|proxy/.test(l));
  if(ldr==='datapack')return lds.includes('datapack');
  return lds.includes(ldr);
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
    const chosenLds=(chosen&&chosen.loaders&&chosen.loaders.length)?chosen.loaders:(item.loaders||[]);
    let match=null;
    if(item.kind==='datapack'||chosenLds.map(l=>String(l).toLowerCase()).includes('datapack')){
      match=true;
    }else if(srv.loader!=='unknown'){
      if(chosenLds.length){
        match=imLoaderMatches(chosenLds,srv.loader);
      }else{
        const groupMap={plugin:['paper','spigot','purpur','folia','bukkit','proxy'],neoforge:['neoforge'],forge:['forge'],fabric:['fabric','quilt']};
        const wanted=groupMap[item.kind]||null;
        match=wanted?wanted.includes(srv.loader):null;
      }
    }
    cells.push(`<div class="im-compat-cell"><small>YOUR SERVER</small>${imBadge(match,srv.software==='unknown'?'unknown':srv.software,chosenLds.length&&match===false)}</div>`);
  }
  // server-side support (Modrinth env)
  if(detail?.env){
    const srvVal = (typeof detail.env === 'object' && detail.env) ? (detail.env.server || (detail.env.normalized === 'client-only' ? 'unsupported' : 'required')) : (detail.env === 'client-only' ? 'unsupported' : 'required');
    const isClientOnly = srvVal === 'unsupported';
    const isOptional = srvVal === 'optional';
    const isRequired = srvVal === 'required' || !isClientOnly;
    const ok = isRequired ? true : isOptional ? null : false;
    const label = isClientOnly ? 'client-only' : isOptional ? 'optional' : 'required';
    cells.push(`<div class="im-compat-cell"><small>SERVER-SIDE</small>${imBadge(ok,label,isClientOnly)}</div>`);
  }
  if(chosen?.size)cells.push(`<div class="im-compat-cell"><small>SIZE</small>${imBadge(null,imFmtBytes(chosen.size))}</div>`);
  if(chosen?.date)cells.push(`<div class="im-compat-cell"><small>UPDATED</small>${imBadge(null,new Date(chosen.date).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'}))}</div>`);
  el.innerHTML=cells.map(c=>`<div class="im-compat-cell">${c}</div>`).join('');
}
function imChosenVersion(){
  const {detail,versionId}=installState;
  if(!detail?.versions)return null;
  return detail.versions.find(v=>v.id===versionId)||null;
}
function imSyncCompatAlert(){
  const alertEl=$('#imCompatAlert');
  if(!alertEl)return;
  const srv=imDetectServer();
  const chosen=imChosenVersion();
  const btn=$('#imInstall');
  if(!chosen){alertEl.hidden=true;return}
  let isCompat=true;
  if(srv.mc && chosen.gameVersions?.length && !chosen.gameVersions.includes(srv.mc)){
    isCompat=false;
  }
  const chosenLds=(chosen.loaders||[]).map(l=>String(l).toLowerCase());
  const isDatapack=(installState.item?.kind==='datapack'||chosenLds.includes('datapack'));
  if(!isDatapack && srv.loader && srv.loader!=='unknown' && chosenLds.length){
    const match=imLoaderMatches(chosenLds,srv.loader);
    if(!match) isCompat=false;
  }
  alertEl.hidden=false;
  const lStr=srv.loader!=='unknown'?srv.loader:(chosenLds.length?chosenLds.join('/'):'Minecraft');
  const vStr=srv.mc||(chosen.gameVersions?.length?chosen.gameVersions[0]:'any');
  const buildLdr=chosenLds.length?chosenLds.join('/'):'unknown';
  const slStr=srv.software!=='unknown'?srv.software:(srv.loader!=='unknown'?srv.loader:'unknown');
  if(isCompat){
    alertEl.className='im-compat-alert ok';
    alertEl.innerHTML=`<span>✔</span> ${esc(t('im.compatNotice',{l:lStr,v:vStr}))}`;
    if(btn&&!installState.busy&&!installState.done) btn.textContent=t('im.install');
  } else {
    alertEl.className='im-compat-alert warn';
    alertEl.innerHTML=`<span>⚠</span> ${esc(t('im.incompatNotice',{l:buildLdr,sl:slStr}))}`;
    if(btn&&!installState.busy&&!installState.done) btn.textContent=t('im.installIncompat');
  }
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
    const isDatapack=(item.kind==='datapack'||(chosen?.loaders||[]).map(l=>String(l).toLowerCase()).includes('datapack'));
    const envSrv=(typeof detail?.env==='object'&&detail?.env)?detail.env.server:(detail?.env==='client-only'?'unsupported':'required');
    if(!isDatapack && envSrv==='unsupported')warns.push(t('im.warnClientOnly'));
    if(!isDatapack && envSrv==='optional')warns.push(t('im.warnOptional'));
    if(chosen&&gameV&&!(chosen.gameVersions||[]).includes(gameV))warns.push(t('im.warnMc',{v:(chosen.gameVersions||[]).slice(-1)[0]||'?',s:esc(gameV)}));
    const itemLoaders=item.loaders||[];
    const groupMap={plugin:['paper','spigot','purpur','folia','bukkit'],forge:['forge','neoforge'],fabric:['fabric','quilt']};
    const wanted=groupMap[item.kind];
    if(wanted&&itemLoaders.length&&srv.loader!=='unknown'&&!itemLoaders.some(l=>wanted.includes(srv.loader)&&wanted.includes(l))&&!wanted.includes(srv.loader))warns.push(t('im.warnLoader',{l:esc(itemLoaders.join('/')),s:esc(srv.loader)}));
    warns.push(t('mkt.installsInto',{p:esc(item.kind==='datapack'?(state.files?.datapackFolder||'world/datapacks'):item.kind==='plugin'?'plugins':'mods')}));
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
  const isDatapack=(installState.item?.kind==='datapack'||(chosen?.loaders||[]).map(l=>String(l).toLowerCase()).includes('datapack'));
  if(isDatapack){sec.hidden=true;return}
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
  const allVs=installState.detail?.versions;
  const list=$('#imVersionList'),note=$('#imVersionNote');
  const cards=$('#imVersionCards');
  const srv=imDetectServer();
  const dd=sel.closest('.ol-dd');
  if(!allVs||!allVs.length){sec.hidden=true;if(list)list.hidden=true;if(cards)cards.hidden=true;return}
  sec.hidden=false;
  if(installState.detail.versionPickable===false){
    sel.innerHTML='';
    if(dd&&dd._olSync)dd._olSync();else sel.hidden=true;
    if(cards)cards.hidden=true;
    if(list){
      list.hidden=false;
      const shown=allVs.slice(0,5);
      list.innerHTML=shown.map(v=>`<li class="im-version"><b>${esc(v.number)}</b><span>${esc(imVersionBits(v).join(' · '))}</span></li>`).join('')
        + (allVs.length>shown.length?`<li class="im-version more"><span>${t('mkt.moreBuilds',{n:allVs.length-shown.length})}</span></li>`:'');
    }
    if(note){note.hidden=false;note.textContent=t('mkt.latestOnly')}
    return;
  }
  if(dd)dd.hidden=false;else sel.hidden=false;
  if(list)list.hidden=true;
  if(note)note.hidden=true;

  const targetLoader = installState.targetLoader || (srv.loader !== 'unknown' ? srv.loader : 'all');
  const canFilter = !!(targetLoader && targetLoader !== 'auto' && targetLoader !== 'unknown' && targetLoader !== 'all');
  const matchingVs = canFilter ? allVs.filter(v => imVersionMatchesLoader(v, targetLoader)) : allVs;
  const hasMultipleLoaders = canFilter && matchingVs.length > 0 && matchingVs.length < allVs.length;

  const toggleBtn = $('#imToggleLoaderFilter');
  if(toggleBtn){
    if(hasMultipleLoaders){
      toggleBtn.hidden = false;
      toggleBtn.textContent = installState.showAllLoaders
        ? t('im.filterToLoader', { l: targetLoader })
        : t('im.showAllLoaders', { n: allVs.length });
      toggleBtn.onclick = () => {
        installState.showAllLoaders = !installState.showAllLoaders;
        imRenderVersionPicker();
        imRenderCompat();imRenderWarns();imRenderDeps();imSyncCompatAlert();
      };
    } else {
      toggleBtn.hidden = true;
    }
  }

  const vs = (hasMultipleLoaders && !installState.showAllLoaders) ? matchingVs : allVs;

  let recId=null;
  const isDatapack=(targetLoader==='datapack'||installState.item?.kind==='datapack');
  for(const v of vs){
    const mcMatch=!srv.mc||(v.gameVersions||[]).includes(srv.mc);
    const ldMatch=isDatapack ? (v.loaders||[]).map(l=>l.toLowerCase()).includes('datapack') : (srv.loader==='unknown'||(v.loaders||[]).some(l=>{
      const cl=String(l).toLowerCase();
      return cl===srv.loader||(srv.loader==='paper'&&/paper|spigot|bukkit/.test(cl))||(srv.loader==='neoforge'&&cl==='neoforge')||(srv.loader==='fabric'&&/fabric|quilt/.test(cl))||(srv.loader==='forge'&&cl==='forge');
    }));
    const isRel=(v.versionType||'release')==='release';
    if(mcMatch&&ldMatch&&isRel){recId=v.id;break}
  }
  if(!recId&&vs[0])recId=vs[0].id;
  if(!installState.versionId||!vs.some(v=>v.id===installState.versionId)){
    installState.versionId=recId;
  }

  if(cards){
    cards.hidden=false;
    cards.innerHTML=vs.map(v=>{
      const isSel=v.id===installState.versionId;
      const isRec=v.id===recId;
      const ch=v.versionType||'release';
      const chLabel=ch==='release'?t('im.channelRelease'):ch==='beta'?t('im.channelBeta'):t('im.channelAlpha');
      const mcList=(v.gameVersions||[]).filter(Boolean);
      const mcBadge=mcList.length?(mcList.length>2?`${mcList[0]}–${mcList[mcList.length-1]}`:mcList.join(',')):'';
      return `<div class="im-vcard${isSel?' selected':''}" data-vid="${esc(v.id)}">`
        + `<div class="im-vcard-top"><span class="im-vcard-num">${esc(v.number||v.name||v.id)}</span>`
        + `${isRec?`<span class="im-vcard-badge rec">${esc(t('im.recBadge'))}</span>`:''}`
        + `<span class="im-vcard-badge channel-${ch}">${esc(chLabel)}</span></div>`
        + `<div class="im-vcard-loaders">${(v.loaders||[]).slice(0,3).map(l=>`<span class="im-vcard-loader">${esc(l)}</span>`).join('')}`
        + `${mcBadge?`<span class="im-vcard-loader">MC ${esc(mcBadge)}</span>`:''}</div>`
        + `<div class="im-vcard-foot"><span>${v.date?new Date(v.date).toLocaleDateString():'—'}</span><span>${imFmtBytes(v.size)}</span></div>`
        + `</div>`;
    }).join('');

    cards.querySelectorAll('.im-vcard[data-vid]').forEach(card=>{
      card.onclick=()=>{
        const vid=card.dataset.vid;
        installState.versionId=vid;
        cards.querySelectorAll('.im-vcard').forEach(c=>c.classList.toggle('selected',c.dataset.vid===vid));
        sel.value=vid;
        if(dd&&dd._olSync)dd._olSync();
        imRenderCompat();imRenderWarns();imRenderDeps();imSyncCompatAlert();
      };
    });
  }

  sel.innerHTML=vs.map(v=>{
    const info=imVersionBits(v).join(' · ');
    return `<option value="${esc(v.id)}" title="${esc(info)}"${v.id===installState.versionId?' selected':''}>${esc(v.number)} — ${esc(info)}</option>`;
  }).join('');
  sel.value=installState.versionId;
  if(dd&&dd._olSync)dd._olSync();
  sel.onchange=()=>{
    installState.versionId=sel.value;
    if(cards)cards.querySelectorAll('.im-vcard').forEach(c=>c.classList.toggle('selected',c.dataset.vid===sel.value));
    imRenderCompat();imRenderWarns();imRenderDeps();imSyncCompatAlert();
  };
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
  const isDatapack=(item.kind==='datapack'||(item.loaders||[]).map(l=>String(l).toLowerCase()).includes('datapack'));
  let activeLdr;
  if(isDatapack){
    item.kind='datapack';
    activeLdr='datapack';
  } else {
    activeLdr=(srv.loader!=='unknown'?srv.loader:'all');
    const itemLoaders=(item.loaders||[]).map(l=>String(l).toLowerCase());
    if(itemLoaders.some(l=>/fabric|quilt|neoforge|forge/.test(l))){
      if(activeLdr==='fabric'||(itemLoaders.includes('fabric')&&!itemLoaders.includes('neoforge')&&!itemLoaders.includes('forge'))){
        item.kind='fabric';
      }else if(activeLdr==='neoforge'||(itemLoaders.includes('neoforge')&&!itemLoaders.includes('fabric')&&!itemLoaders.includes('forge'))){
        item.kind='neoforge';
      }else if(activeLdr==='forge'){
        item.kind='forge';
      }else{
        item.kind='mod';
      }
    }
  }
  item.targetLoader=activeLdr;
  installState={item,detail:null,versionId:null,busy:false,done:false,targetLoader:activeLdr,showAllLoaders:false};
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
  const tp=$('#imTargetPill');
  if(tp){
    const sName=srv.software!=='unknown'?srv.software:srv.loader!=='unknown'?srv.loader:'auto';
    tp.textContent=t('im.targetServer',{s:sName,v:srv.mc||'?'});
  }
  const alt=$('#imCompatAlert');if(alt)alt.hidden=true;
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
    imRenderCompat();imRenderWarns();imRenderDeps();imRenderLinks();imSyncCompatAlert();
    const b2=$('#imInstall');b2.disabled=false;
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
    if(p.total){
      const pct=Math.min(100,Math.round(p.received/p.total*100));
      $('#imBar').classList.remove('indeterminate');
      $('#imBar').style.width=pct+'%';
      $('#imBarLabel').textContent=`${p.name} — ${imFmtBytes(p.received)} / ${imFmtBytes(p.total)} (${pct}%)`;
    }else{
      $('#imBar').classList.add('indeterminate');
      $('#imBarLabel').textContent=`${p.name} — ${imFmtBytes(p.received)}`;
    }
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
