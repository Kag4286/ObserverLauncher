// js/11-market.js — split out of 08-shell.js; classic script, load AFTER 08-shell.js.
// Marketplace tab: search/paging wiring + server-target synchronization.
let marketItems=[];let marketPage=1;let marketHasNext=false;let marketTotal=null;let marketReqSeq=0;
let marketStrict=true;
let marketTypeCategory='';
let marketKindUserChanged=false;
let marketVersionUserChanged=false;
let marketLoaderUserChanged=false;
let _lastMarketSrvSig='';

const MARKET_QUICK_CHIPS={
  fabric:['Fabric API','Sodium','Lithium','FerriteCore','Simple Voice Chat','LuckPerms'],
  quilt:['QFAPI','Sodium','Lithium','FerriteCore','Simple Voice Chat'],
  neoforge:['JEI','Sodium','FerriteCore','Create','Kotlin for Forge','Simple Voice Chat'],
  forge:['JEI','Sodium','FerriteCore','Create','Kotlin for Forge','Simple Voice Chat'],
  mod:['Sodium','JEI','FerriteCore','Simple Voice Chat','LuckPerms','Cloth Config'],
  modpack:['Fabulously Optimized','Simply Optimized','Better MC','Cobblemon','Prominence'],
  datapack:['Terralith','Incendium','Nullscape','BlazeandCave','Vanilla Tweaks'],
  plugin:['EssentialsX','LuckPerms','ViaVersion','Spark','WorldEdit','Vault']
};

function syncOlSelect(sel){
  try{sel?.closest('.ol-dd')?._olSync?.()}catch{}
}
function ensureMarketVersionOption(ver){
  const sel=$('#marketVersion');
  if(!sel||!ver)return;
  const exists=Array.from(sel.options).some(o=>o.value===ver);
  if(!exists){
    const opt=document.createElement('option');
    opt.value=ver;opt.textContent=ver;
    if(sel.options.length>0)sel.insertBefore(opt,sel.options[1]||null);
    else sel.appendChild(opt);
  }
}

function updateMarketServerBanner(){
  const srv=typeof imDetectServer==='function'?imDetectServer():{loader:'unknown',software:'unknown',mc:null};
  const targetEl=$('#marketServerTarget');
  const badgeEl=$('#marketServerBadge');
  const toggleBtn=$('#marketStrictToggle');
  const dotEl=$('#marketServerDot');
  const srvName=srv.software!=='unknown'?srv.software:srv.loader!=='unknown'?srv.loader:'auto';
  const hasSrv=srv.loader!=='unknown'||!!srv.mc;
  if(dotEl)dotEl.classList.toggle('is-live',hasSrv);
  if(targetEl){
    targetEl.textContent=hasSrv?(srv.mc?`${srvName} · ${srv.mc}`:srvName):t('top.noServer');
  }
  const activeVer=$('#marketVersion')?.value||srv.mc||'';
  if(badgeEl){
    badgeEl.textContent=marketStrict
      ?t('mkt.lockedCompat',{s:srvName,v:activeVer?`(${activeVer})`:''}).replace(/\s+/g,' ').trim()
      :t('mkt.browseAny');
  }
  if(toggleBtn){
    toggleBtn.classList.toggle('active',marketStrict);
    toggleBtn.textContent=marketStrict?t('mkt.matchServer'):t('mkt.browseAny');
    toggleBtn.title=marketStrict?t('mkt.strictFilterOn',{s:srvName}):t('mkt.strictFilterOff');
    toggleBtn.setAttribute('aria-pressed',String(marketStrict));
  }
}

function renderMarketQuickChips(kind){
  const host=$('#marketQuickChips');
  if(!host)return;
  const ldr=$('#marketLoader')?.value||'';
  const bucket=kind==='modpack'?'modpack':kind==='datapack'?'datapack':(MARKET_QUICK_CHIPS[kind]?kind:(MARKET_QUICK_CHIPS[ldr]?ldr:'plugin'));
  const words=MARKET_QUICK_CHIPS[bucket]||MARKET_QUICK_CHIPS.plugin;
  host.innerHTML=words.map(w=>`<button type="button" class="quick-chip" data-quick="${esc(w)}">${esc(w)}</button>`).join('');
  host.querySelectorAll('.quick-chip').forEach(c=>{
    c.onclick=()=>{$('#marketQuery').value=c.dataset.quick;runMarketSearch(1);};
  });
}

function syncMarketUiFromKind(){
  const kindEl=$('#marketKind');
  const ldrEl=$('#marketLoader');
  const ldrWrap=$('#marketLoaderWrap');
  const impBtn=$('#marketImportModpackBtn');
  const srv=typeof imDetectServer==='function'?imDetectServer():{loader:'unknown',mc:null};
  const val=kindEl?.value||'plugin';
  const tabKind=(val==='plugin'||val==='datapack'||val==='modpack')?val:'mod';

  $$('#marketKindSeg .seg').forEach(b=>{
    const on=b.dataset.mkind===tabKind;
    b.classList.toggle('active',on);
    b.setAttribute('aria-selected',String(on));
  });
  if(ldrWrap)ldrWrap.hidden=(tabKind!=='mod'&&tabKind!=='modpack');
  if(ldrEl){
    if(tabKind==='mod'){
      ldrEl.value=['fabric','neoforge','forge','quilt'].includes(val)?val:'';
    }else if(tabKind==='modpack'&&!marketKindUserChanged&&['fabric','neoforge','forge','quilt'].includes(srv.loader)){
      ldrEl.value=srv.loader;
    }
    syncOlSelect(ldrEl);
  }
  if(impBtn)impBtn.hidden=(tabKind!=='modpack');

  // Hangar and Spigot are Paper/Velocity/Bukkit plugin registries only.
  const isPluginsOnlyTab=(tabKind==='plugin');
  $$('#marketSourceSeg .seg').forEach(b=>{
    const s=b.dataset.source;
    if(s==='hangar'||s==='spigot'){
      b.disabled=!isPluginsOnlyTab;
      b.title=isPluginsOnlyTab?'':t('mkt.pluginsOnlySrc');
    }else{
      b.disabled=false;
      b.title='';
    }
  });
  const srcInput=$('#marketSource');
  if(!isPluginsOnlyTab&&srcInput&&(srcInput.value==='hangar'||srcInput.value==='spigot')){
    srcInput.value='modrinth';
    $$('#marketSourceSeg .seg').forEach(x=>{
      const on=x.dataset.source==='modrinth';
      x.classList.toggle('active',on);
      x.setAttribute('aria-selected',String(on));
    });
  }
  renderMarketQuickChips(val);
}

function syncMarketControls(force){
  const srv=typeof imDetectServer==='function'?imDetectServer():{loader:'unknown',software:'unknown',mc:null};
  const sig=`${srv.loader}|${srv.software}|${srv.mc||''}`;
  const serverChanged=(sig!==_lastMarketSrvSig);
  if(serverChanged){
    _lastMarketSrvSig=sig;
    marketKindUserChanged=false;
    marketVersionUserChanged=false;
    marketLoaderUserChanged=false;
  }
  if(force||!marketKindUserChanged){
    const kindEl=$('#marketKind');
    if(kindEl&&srv.loader!=='unknown'){
      if(srv.loader==='neoforge')kindEl.value='neoforge';
      else if(srv.loader==='fabric')kindEl.value='fabric';
      else if(srv.loader==='forge')kindEl.value='forge';
      else if(srv.loader==='quilt')kindEl.value='quilt';
      else if(/paper|purpur|leaf|folia|spigot|proxy/.test(srv.loader))kindEl.value='plugin';
    }
  }
  const verEl=$('#marketVersion');
  if(verEl){
    if(srv.mc)ensureMarketVersionOption(srv.mc);
    if(force||(marketStrict&&!marketVersionUserChanged)){
      verEl.value=srv.mc||'';
      syncOlSelect(verEl);
    }
  }
  syncMarketUiFromKind();
  updateMarketServerBanner();
}

function initMarketKindForServer(){
  syncMarketControls(false);
}

async function runMarketSearch(page){
  syncMarketControls(false);
  const seq=++marketReqSeq;
  const srv=typeof imDetectServer==='function'?imDetectServer():{loader:'unknown',software:'unknown',mc:null};
  const source=$('#marketSource').value;
  const kind=$('#marketKind').value;
  const pickedLdr=$('#marketLoader')?.value||'';
  const query=$('#marketQuery').value.trim();
  const version=$('#marketVersion').value;
  const status=$('#marketStatus');
  marketPage=page;
  $('#marketSearch').disabled=true;$('#marketSort').disabled=true;$('#marketPrev').disabled=true;$('#marketNext').disabled=true;
  status.classList.add('loading');status.setAttribute('aria-busy','true');
  $('#marketResults').setAttribute('aria-busy','true');
  $('#marketResults').innerHTML=Array.from({length:4}).map(()=>`<article class="panel market-item skeleton" aria-hidden="true"><div class="market-icon skeleton-box"></div><div><div class="skeleton-line w60"></div><div class="skeleton-line w90"></div><div class="skeleton-line w40"></div></div><div class="skeleton-btn"></div></article>`).join('');
  status.hidden=false;status.textContent=t('mkt.searching');

  let reqLoader=undefined;
  if(['neoforge','forge','fabric','quilt'].includes(kind)) reqLoader=kind;
  else if(kind==='plugin') reqLoader=(srv.loader==='velocity'||srv.loader==='proxy'?'velocity':'paper');
  else if(kind==='datapack') reqLoader='datapack';
  else if(kind==='mod'||kind==='modpack') reqLoader=pickedLdr||(marketStrict&&!marketLoaderUserChanged&&['neoforge','forge','fabric','quilt'].includes(srv.loader)?srv.loader:undefined);

  const reqVersion=version||(marketStrict&&!marketVersionUserChanged&&srv.mc?srv.mc:'');
  const r=await window.observer.marketSearch({
    source,
    kind,
    query,
    version:reqVersion,
    loader:reqLoader,
    category:marketTypeCategory||undefined,
    sort:marketSort,
    offset:(page-1)*20
  });
  if(seq!==marketReqSeq)return;
  $('#marketSearch').disabled=false;$('#marketSort').disabled=false;status.classList.remove('loading');status.removeAttribute('aria-busy');$('#marketResults').removeAttribute('aria-busy');
  if(!r||!r.ok){
    const errRaw=r&&r.error?r.error:'Failed to load marketplace';
    const isRateLimit=/429|rate\s*limit/i.test(String(errRaw));
    const errMsg=isRateLimit?t('mkt.rateLimit'):errRaw;
    status.textContent=t('mkt.couldNotLoadResults',{m:errMsg});
    const n=$('#marketResults');
    status.hidden=false;
    n.innerHTML=`<article class="panel market-empty"><div style="display:flex;gap:12px;align-items:center;justify-content:center;flex-wrap:wrap"><b>${esc(isRateLimit?t('mkt.rateLimitTitle'):t('mkt.couldNotLoadMarket'))}</b><button type="button" class="btn primary sm" data-market-retry>${esc(t('mkt.retry'))}</button></div><p class="text-muted">${esc(errMsg)}</p><p class="text-muted">${esc(isRateLimit?t('mkt.rateLimitHint'):t('mkt.checkInternet'))}</p></article>`;
    const retryBtn=n.querySelector('[data-market-retry]');
    if(retryBtn) retryBtn.onclick=()=>document.getElementById('marketSearch')?.click();
    $('#marketPager').hidden=true;
    const countEl=$('#marketplaceCount');if(countEl)countEl.textContent=t('mkt.error');
    toast(errMsg,'error');return;
  }
  const rawItems=Array.isArray(r.items)?r.items:[];
  let items=rawItems.map(x=>{
    let itemKind=kind;
    const lds=(x.loaders||[]).map(l=>String(l).toLowerCase());
    if(kind!=='modpack'&&kind!=='datapack'&&lds.some(l=>/fabric|quilt|neoforge|forge/.test(l))){
      if(lds.includes('fabric')&&!lds.includes('neoforge')&&!lds.includes('forge'))itemKind='fabric';
      else if(lds.includes('quilt')&&!lds.includes('fabric')&&!lds.includes('neoforge')&&!lds.includes('forge'))itemKind='quilt';
      else if(lds.includes('neoforge')&&!lds.includes('fabric'))itemKind='neoforge';
      else if(lds.includes('forge')&&!lds.includes('fabric')&&!lds.includes('neoforge'))itemKind='forge';
      else itemKind='mod';
    }
    return {...x,kind:x.kind||itemKind};
  });
  const activeLoaderFilter=reqLoader;
  if(marketStrict&&activeLoaderFilter&&['neoforge','forge','fabric','quilt'].includes(activeLoaderFilter)&&!query){
    if(activeLoaderFilter==='neoforge'){
      items=items.filter(x=>!x.loaders?.length||x.loaders.some(l=>String(l).toLowerCase().includes('neoforge')));
    }else if(activeLoaderFilter==='fabric'){
      items=items.filter(x=>!x.loaders?.length||x.loaders.some(l=>/fabric|quilt/i.test(String(l))));
    }else if(activeLoaderFilter==='quilt'){
      items=items.filter(x=>!x.loaders?.length||x.loaders.some(l=>/quilt|fabric/i.test(String(l))));
    }else if(activeLoaderFilter==='forge'){
      items=items.filter(x=>!x.loaders?.length||x.loaders.some(l=>String(l).toLowerCase()==='forge'));
    }
  }
  marketItems=items;
  marketTotal=r.total??null;
  marketHasNext=marketTotal!=null?page*20<marketTotal:marketItems.length>=20;
  const relaxedNote=r.relaxed==='version'?t('mkt.relaxedVersion'):r.relaxed==='loader'?t('mkt.relaxedLoader'):'';
  status.hidden=!relaxedNote;status.textContent=relaxedNote;
  const countEl=$('#marketplaceCount');if(countEl)countEl.textContent=marketTotal!=null?tf('mkt.found',{a:marketTotal}):`${marketItems.length}`;
  renderMarket(marketItems);
  if(page>1){const top=$('#marketResults');if(top)top.scrollIntoView({block:'start'});}
  $('#marketPager').hidden=!(page>1||marketHasNext);
  $('#marketPrev').disabled=page<=1;$('#marketNext').disabled=!marketHasNext;
  $('#marketPageLabel').textContent=marketTotal!=null?t('mkt.pageOf',{p:page,t:Math.max(1,Math.ceil(marketTotal/20))}):t('mkt.page',{p:page});
}

$('#marketStrictToggle')?.addEventListener('click',()=>{
  marketStrict=!marketStrict;
  if(marketStrict){
    marketKindUserChanged=false;
    marketVersionUserChanged=false;
    marketLoaderUserChanged=false;
    syncMarketControls(true);
  }else{
    const verEl=$('#marketVersion');
    if(verEl){verEl.value='';syncOlSelect(verEl);}
    const ldrEl=$('#marketLoader');
    if(ldrEl&&$('#marketKind')?.value!=='plugin'&&$('#marketKind')?.value!=='datapack'){
      if($('#marketKind')?.value!=='modpack')$('#marketKind').value='mod';
      ldrEl.value='';syncOlSelect(ldrEl);
    }
    syncMarketUiFromKind();
    updateMarketServerBanner();
  }
  runMarketSearch(1);
});

$$('#marketKindSeg .seg').forEach(btn=>{
  btn.onclick=()=>{
    const tabKind=btn.dataset.mkind;
    const srv=typeof imDetectServer==='function'?imDetectServer():{loader:'unknown'};
    marketKindUserChanged=true;
    const kindEl=$('#marketKind');
    if(tabKind==='mod'){
      const picked=$('#marketLoader')?.value;
      kindEl.value=picked||(['fabric','quilt','neoforge','forge'].includes(srv.loader)?srv.loader:'mod');
    }else{
      kindEl.value=tabKind;
    }
    syncMarketUiFromKind();
    updateMarketServerBanner();
    runMarketSearch(1);
  };
});

$('#marketLoader')?.addEventListener('change',e=>{
  marketKindUserChanged=true;
  marketLoaderUserChanged=true;
  const v=e.target.value;
  const curTab=$('#marketKindSeg .seg.active')?.dataset?.mkind||'mod';
  if(curTab!=='modpack'){
    $('#marketKind').value=v||'mod';
  }
  flashMarketField(e.target);
  syncMarketUiFromKind();
  runMarketSearch(1);
});

$$('#marketTypeChips .type-chip').forEach(chip=>{
  chip.onclick=()=>{
    $$('#marketTypeChips .type-chip').forEach(c=>c.classList.toggle('active',c===chip));
    marketTypeCategory=chip.dataset.type||'';
    runMarketSearch(1);
  };
});

$('#marketSearch').onclick=()=>runMarketSearch(1);
$('#marketPrev').onclick=()=>{if(marketPage>1)runMarketSearch(marketPage-1)};
$('#marketNext').onclick=()=>{if(marketHasNext)runMarketSearch(marketPage+1)};
const debouncedMarketSearch=debounce(()=>runMarketSearch(1),250);
$('#marketQuery').addEventListener('input', debouncedMarketSearch);
$('#marketQuery').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault(); runMarketSearch(1)}});
function flashMarketField(el){el.classList.remove('just-changed');void el.offsetWidth;el.classList.add('just-changed')}
$('#marketKind').onchange=e=>{marketKindUserChanged=true;syncMarketUiFromKind();flashMarketField(e.target);runMarketSearch(1)};
$('#marketVersion').onchange=e=>{
  marketVersionUserChanged=true;
  flashMarketField(e.target);
  updateMarketServerBanner();
  runMarketSearch(1);
};
$('#marketSort').onchange=e=>{marketSort=e.target.value;runMarketSearch(1)};
$$('#marketSourceSeg .seg').forEach(b=>b.onclick=()=>{
  if(b.disabled)return;
  $$('#marketSourceSeg .seg').forEach(x=>{const on=x===b;x.classList.toggle('active',on);x.setAttribute('aria-selected',String(on));});
  $('#marketSource').value=b.dataset.source;flashMarketField($('#marketSourceSeg'));runMarketSearch(1);
});
async function triggerImportModpack(){
  const r=await window.observer.importModpack();
  if(r.cancelled)return;
  if(!r.ok)return toast(r.error,'error');
  state.files=r.files;
  refreshUI();
  toast(t('mkt.imported',{n:r.name,c:r.installed,s:r.skipped?t('mkt.importedSkipped',{k:r.skipped}):''}),'success');
  if(r.blocked&&r.blocked.length)openBlockedDialog(r);
}
$('#importModpack')?.addEventListener('click',triggerImportModpack);
$('#marketImportModpackBtn')?.addEventListener('click',triggerImportModpack);
let blockedState={list:[],destFolder:'mods'};
function openBlockedDialog(r){blockedState={list:r.blocked||[],destFolder:r.destFolder||'mods'};const m=$('#blockedModal');if(!m)return;m.hidden=false;if(typeof trapFocus==='function')trapFocus(m);renderBlockedList()}function renderBlockedList(){const box=$('#blockedList');if(!box)return;box.innerHTML=blockedState.list.map((b,i)=>`<li class="blocked-row" data-i="${i}"><span class="blocked-name">${esc(b.name||b.fileName||('project '+b.projectID))}</span><button type="button" class="text-btn" data-open="${i}">${esc(t('cfi.openPage'))} ↗</button><span class="blocked-tag">${esc(t('cfi.pending'))}</span></li>`).join('')||`<li class="empty"><span>${esc(t('cfi.done'))}</span></li>`;box.querySelectorAll('[data-open]').forEach(x=>x.onclick=()=>{const b=blockedState.list[Number(x.dataset.open)];if(b&&b.pageUrl)window.observer.marketOpenExternal(b.pageUrl);else if(b&&b.projectID)window.observer.marketOpenExternal('https://www.curseforge.com/minecraft/mc-mods/'+b.projectID)});$('#blockedHint').textContent=t('cfi.hint',{f:blockedState.destFolder})}async function checkBlocked(){const r=await window.observer.verifyBlockedMods({blocked:blockedState.list,destFolder:blockedState.destFolder});if(r&&r.ok){blockedState.list=r.missing||[];renderBlockedList();if(!blockedState.list.length)toast(t('cfi.done'),'success')}}$('#blockedCheck')&&($('#blockedCheck').onclick=checkBlocked);$('#blockedClose')&&($('#blockedClose').onclick=()=>{$('#blockedModal').hidden=true;if(typeof releaseFocus==='function')releaseFocus()});
$('#exportModpack').onclick=async()=>{const r=await window.observer.exportModpack();if(r.cancelled)return;if(!r.ok)return toast(r.error,'error');toast(t('mkt.exported',{c:r.count,p:r.path}),'success')};

async function refreshCurseforgeSource(){
  const seg=$('#marketCfSeg');if(!seg)return;
  let hasKey=false;
  try{const r=await window.observer.marketCurseforgeStatus();hasKey=!!(r&&r.hasKey)}catch{}
  seg.hidden=!hasKey;
  if(!hasKey&&$('#marketSource').value==='curseforge'){
    $('#marketSource').value='modrinth';
    $$('#marketSourceSeg .seg').forEach(x=>{const on=x.dataset.source==='modrinth';x.classList.toggle('active',on);x.setAttribute('aria-selected',String(on));});
  }
}
refreshCurseforgeSource();
initMarketKindForServer();
updateMarketServerBanner();
$('#saveSettings')?.addEventListener('click',()=>setTimeout(refreshCurseforgeSource,400));
