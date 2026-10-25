// js/11-market.js — split out of 08-shell.js; classic script, load AFTER 08-shell.js.
// Marketplace tab: search/paging wiring. Uses renderMarket/openInstallModal (05-marketplace.js),
// debounce/marketSort/esc/t (defined earlier or in 08), all at click time.
let marketItems=[];let marketPage=1;let marketHasNext=false;let marketTotal=null;let marketReqSeq=0;
let marketStrict=true;
let marketTypeCategory='';
let marketKindUserChanged=false;

function updateMarketServerBanner(){
  const srv=typeof imDetectServer==='function'?imDetectServer():{loader:'unknown',software:'unknown',mc:null};
  const targetEl=$('#marketServerTarget');
  const badgeEl=$('#marketServerBadge');
  const toggleBtn=$('#marketStrictToggle');
  const srvName=srv.software!=='unknown'?srv.software:srv.loader!=='unknown'?srv.loader:'auto';
  if(targetEl){
    targetEl.textContent=srv.mc?`${srvName} (${srv.mc})`:srvName;
  }
  if(badgeEl){
    badgeEl.textContent=marketStrict
      ? t('mkt.lockedCompat',{s:srvName,v:srv.mc?`(${srv.mc})`:''}).replace(/\s+/g,' ').trim()
      : t('mkt.strictFilterOff');
  }
  if(toggleBtn){
    toggleBtn.classList.toggle('active',marketStrict);
    toggleBtn.title=marketStrict?t('mkt.strictFilterOn',{s:srvName}):t('mkt.strictFilterOff');
    toggleBtn.setAttribute('aria-pressed',String(marketStrict));
  }
}

function initMarketKindForServer(){
  if(marketKindUserChanged)return;
  const srv=typeof imDetectServer==='function'?imDetectServer():{loader:'unknown'};
  const kindEl=$('#marketKind');
  if(!kindEl||srv.loader==='unknown')return;
  if(srv.loader==='neoforge')kindEl.value='neoforge';
  else if(srv.loader==='fabric')kindEl.value='fabric';
  else if(srv.loader==='forge')kindEl.value='forge';
  else if(/paper|purpur|leaf|folia|spigot/.test(srv.loader))kindEl.value='plugin';
}

// FEATURE: real Prev/Next pages that REPLACE the results and scroll back to the top of the results
// themselves. Modrinth and Hangar report an exact total ("Page N of M"); Spigot has no total, so Next
// stays enabled while the last page came back full.
async function runMarketSearch(page){
  initMarketKindForServer();
  updateMarketServerBanner();
  const seq=++marketReqSeq;
  const srv=typeof imDetectServer==='function'?imDetectServer():{loader:'unknown',software:'unknown',mc:null};
  const source=$('#marketSource').value,kind=$('#marketKind').value,query=$('#marketQuery').value.trim(),version=$('#marketVersion').value,status=$('#marketStatus');
  marketPage=page;
  $('#marketSearch').disabled=true;$('#marketSort').disabled=true;$('#marketPrev').disabled=true;$('#marketNext').disabled=true;status.classList.add('loading'); status.setAttribute('aria-busy','true');
  $('#marketResults').setAttribute('aria-busy','true');
  $('#marketResults').innerHTML=Array.from({length:4}).map(()=>`<article class="panel market-item skeleton" aria-hidden="true"><div class="market-icon skeleton-box"></div><div><div class="skeleton-line w60"></div><div class="skeleton-line w90"></div><div class="skeleton-line w40"></div></div><div class="skeleton-btn"></div></article>`).join('');
  status.hidden=false;status.textContent=t('mkt.searching');

  let reqLoader=undefined;
  if(kind==='neoforge') reqLoader='neoforge';
  else if(kind==='fabric') reqLoader='fabric';
  else if(kind==='forge') reqLoader='forge';
  else if(kind==='plugin') reqLoader=(srv.loader==='velocity'?'velocity':'paper');
  else if(kind==='datapack') reqLoader='datapack';
  else if(marketStrict && srv.loader!=='unknown') reqLoader=srv.loader;

  const reqVersion=version||(marketStrict&&srv.mc?srv.mc:'');
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
  $('#marketSearch').disabled=false;$('#marketSort').disabled=false;status.classList.remove('loading'); status.removeAttribute('aria-busy'); $('#marketResults').removeAttribute('aria-busy');
  if(!r.ok){
    status.textContent=t('mkt.couldNotLoadResults',{m:r.error});
    const n=$('#marketResults');
    status.hidden=false;
    n.innerHTML=`<article class="panel"><div style="display:flex;gap:12px;align-items:center"><span style="font-size:18px">⚠</span><div><b>${t('mkt.couldNotLoadMarket')}</b><p class="text-muted" style="margin:4px 0 0">${esc(r.error)}</p></div><button class="btn primary" onclick="document.getElementById('marketSearch').click()">${t('mkt.retry')}</button></div><p class="text-muted" style="margin-top:10px;font:500 11px var(--font-ui)">${t('mkt.checkInternet')}</p></article>`;
    $('#marketPager').hidden=true;
    const countEl=$('#marketplaceCount'); if(countEl) countEl.textContent=t('mkt.error');
    toast(r.error,'error');return;
  }
  let items=r.items.map(x=>{
    let itemKind=kind;
    const lds=(x.loaders||[]).map(l=>String(l).toLowerCase());
    if(lds.some(l=>/fabric|quilt|neoforge|forge/.test(l))){
      if(lds.includes('fabric')&&!lds.includes('neoforge')&&!lds.includes('forge'))itemKind='fabric';
      else if(lds.includes('neoforge')&&!lds.includes('fabric'))itemKind='neoforge';
      else if(lds.includes('forge')&&!lds.includes('fabric')&&!lds.includes('neoforge'))itemKind='forge';
      else itemKind='mod';
    }
    return {...x,kind:x.kind||itemKind};
  });
  if(marketStrict && srv.loader!=='unknown' && !query){
    if(srv.loader==='neoforge'){
      items=items.filter(x=>!x.loaders?.length||x.loaders.some(l=>String(l).toLowerCase().includes('neoforge')));
    } else if(srv.loader==='fabric'){
      items=items.filter(x=>!x.loaders?.length||x.loaders.some(l=>String(l).toLowerCase().includes('fabric')));
    } else if(srv.loader==='forge'){
      items=items.filter(x=>!x.loaders?.length||x.loaders.some(l=>String(l).toLowerCase().includes('forge')&&!String(l).toLowerCase().includes('neoforge')));
    }
  }
  marketItems=items;
  marketTotal=r.total??null;
  marketHasNext=marketTotal!=null?page*20<marketTotal:marketItems.length>=20;
  const relaxedNote=r.relaxed==='version'?t('mkt.relaxedVersion'):r.relaxed==='loader'?t('mkt.relaxedLoader'):'';
  status.hidden=!relaxedNote;status.textContent=relaxedNote;
  const countEl=$('#marketplaceCount'); if(countEl) countEl.textContent=marketTotal!=null?tf('mkt.found',{a:marketTotal}):`${marketItems.length}`;
  renderMarket(marketItems);
  if(page>1){const top=$('#marketResults');if(top)top.scrollIntoView({block:'start'});}
  $('#marketPager').hidden=!(page>1||marketHasNext);
  $('#marketPrev').disabled=page<=1;$('#marketNext').disabled=!marketHasNext;
  $('#marketPageLabel').textContent=marketTotal!=null?t('mkt.pageOf',{p:page,t:Math.max(1,Math.ceil(marketTotal/20))}):t('mkt.page',{p:page});
}

$('#marketStrictToggle')?.addEventListener('click',()=>{
  marketStrict=!marketStrict;
  updateMarketServerBanner();
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
const debouncedMarketSearch=debounce(()=>runMarketSearch(1),400);
$('#marketQuery').addEventListener('input', debouncedMarketSearch);
$('#marketQuery').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault(); runMarketSearch(1)}});
function flashMarketField(el){el.classList.remove('just-changed');void el.offsetWidth;el.classList.add('just-changed')}
$('#marketKind').onchange=e=>{marketKindUserChanged=true;flashMarketField(e.target);runMarketSearch(1)};$('#marketVersion').onchange=e=>{flashMarketField(e.target);runMarketSearch(1)};
$('#marketSort').onchange=e=>{marketSort=e.target.value;runMarketSearch(1)};
$$('#marketSourceSeg .seg').forEach(b=>b.onclick=()=>{$$('#marketSourceSeg .seg').forEach(x=>x.classList.toggle('active',x===b));$('#marketSource').value=b.dataset.source;flashMarketField($('#marketSourceSeg'));runMarketSearch(1)});
$$('.quick-chip').forEach(c=>c.onclick=()=>{$('#marketQuery').value=c.dataset.quick;runMarketSearch(1)});
$('#importModpack').onclick=async()=>{const r=await window.observer.importModpack();if(r.cancelled)return;if(!r.ok)return toast(r.error,'error');state.files=r.files;refreshUI();toast(t('mkt.imported',{n:r.name,c:r.installed,s:r.skipped?t('mkt.importedSkipped',{k:r.skipped}):''}),'success');if(r.blocked&&r.blocked.length)openBlockedDialog(r)};
let blockedState={list:[],destFolder:'mods'};
function openBlockedDialog(r){blockedState={list:r.blocked||[],destFolder:r.destFolder||'mods'};const m=$('#blockedModal');if(!m)return;m.hidden=false;renderBlockedList()}function renderBlockedList(){const box=$('#blockedList');if(!box)return;box.innerHTML=blockedState.list.map((b,i)=>`<li class="blocked-row" data-i="${i}"><span class="blocked-name">${esc(b.name||b.fileName||('project '+b.projectID))}</span><button type="button" class="text-btn" data-open="${i}">${esc(t('cfi.openPage'))} ↗</button><span class="blocked-tag">${esc(t('cfi.pending'))}</span></li>`).join('')||`<li class="empty"><span>${esc(t('cfi.done'))}</span></li>`;box.querySelectorAll('[data-open]').forEach(x=>x.onclick=()=>{const b=blockedState.list[Number(x.dataset.open)];if(b&&b.pageUrl)window.observer.marketOpenExternal(b.pageUrl);else if(b&&b.projectID)window.observer.marketOpenExternal('https://www.curseforge.com/minecraft/mc-mods/'+b.projectID)});$('#blockedHint').textContent=t('cfi.hint',{f:blockedState.destFolder})}async function checkBlocked(){const r=await window.observer.verifyBlockedMods({blocked:blockedState.list,destFolder:blockedState.destFolder});if(r&&r.ok){blockedState.list=r.missing||[];renderBlockedList();if(!blockedState.list.length)toast(t('cfi.done'),'success')}}$('#blockedCheck')&&($('#blockedCheck').onclick=checkBlocked);$('#blockedClose')&&($('#blockedClose').onclick=()=>{$('#blockedModal').hidden=true});
$('#exportModpack').onclick=async()=>{const r=await window.observer.exportModpack();if(r.cancelled)return;if(!r.ok)return toast(r.error,'error');toast(t('mkt.exported',{c:r.count,p:r.path}),'success')};

async function refreshCurseforgeSource(){
  const seg=$('#marketCfSeg');if(!seg)return;
  let hasKey=false;
  try{const r=await window.observer.marketCurseforgeStatus();hasKey=!!(r&&r.hasKey)}catch{}
  seg.hidden=!hasKey;
  if(!hasKey&&$('#marketSource').value==='curseforge'){
    $('#marketSource').value='modrinth';
    $$('#marketSourceSeg .seg').forEach(x=>x.classList.toggle('active',x.dataset.source==='modrinth'));
  }
}
refreshCurseforgeSource();
initMarketKindForServer();
updateMarketServerBanner();
$('#saveSettings')?.addEventListener('click',()=>setTimeout(refreshCurseforgeSource,400));
