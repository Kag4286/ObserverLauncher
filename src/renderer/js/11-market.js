// js/11-market.js — split out of 08-shell.js; classic script, load AFTER 08-shell.js.
// Marketplace tab: search/paging wiring. Uses renderMarket/openInstallModal (05-marketplace.js),
// debounce/marketSort/esc/t (defined earlier or in 08), all at click time.
let marketItems=[];let marketPage=1;let marketHasNext=false;let marketTotal=null;let marketReqSeq=0;
// FEATURE: real Prev/Next pages that REPLACE the results and scroll back to the top of the results
// themselves. Modrinth and Hangar report an exact total ("Page N of M"); Spigot has no total, so Next
// stays enabled while the last page came back full.
async function runMarketSearch(page){
  // BUGFIX: rapid typing fired overlapping requests; slower older responses could land AFTER a
  // newer one and overwrite fresh results with stale ones. A sequence token drops stale responses.
  const seq=++marketReqSeq;
  const source=$('#marketSource').value,kind=$('#marketKind').value,query=$('#marketQuery').value.trim(),version=$('#marketVersion').value,status=$('#marketStatus');
  marketPage=page;
  $('#marketSearch').disabled=true;$('#marketSort').disabled=true;$('#marketPrev').disabled=true;$('#marketNext').disabled=true;status.classList.add('loading'); status.setAttribute('aria-busy','true');
  $('#marketResults').setAttribute('aria-busy','true');
  $('#marketResults').innerHTML=Array.from({length:4}).map(()=>`<article class="panel glass market-item skeleton" aria-hidden="true"><div class="market-icon skeleton-box"></div><div><div class="skeleton-line w60"></div><div class="skeleton-line w90"></div><div class="skeleton-line w40"></div></div><div class="skeleton-btn"></div></article>`).join('');
  status.textContent=t('mkt.searching');
  const r=await window.observer.marketSearch({source,kind,query,version,sort:marketSort,offset:(page-1)*20});
  if(seq!==marketReqSeq)return; // a newer request superseded this one — drop the stale response
  $('#marketSearch').disabled=false;$('#marketSort').disabled=false;status.classList.remove('loading'); status.removeAttribute('aria-busy'); $('#marketResults').removeAttribute('aria-busy');
  if(!r.ok){
    status.textContent=t('mkt.couldNotLoadResults',{m:r.error});
    const n=$('#marketResults');
    n.innerHTML=`<article class="panel glass"><div style="display:flex;gap:12px;align-items:center"><span style="font-size:18px">⚠</span><div><b>${t('mkt.couldNotLoadMarket')}</b><p class="text-muted" style="margin:4px 0 0">${esc(r.error)}</p></div><button class="btn primary" onclick="document.getElementById('marketSearch').click()">${t('mkt.retry')}</button></div><p class="text-muted" style="margin-top:10px;font:500 11px var(--font-ui)">${t('mkt.checkInternet')}</p></article>`;
    $('#marketPager').hidden=true;
    const countEl=$('#marketplaceCount'); if(countEl) countEl.textContent=t('mkt.error');
    toast(r.error,'error');return;
  }
  marketItems=r.items.map(x=>({...x,kind}));
  marketTotal=r.total??null;
  marketHasNext=marketTotal!=null?page*20<marketTotal:marketItems.length>=20;
  const sortLabel=marketSort==='downloads'?t('mkt.sortDl'):marketSort==='latest'?t('mkt.sortLatest'):t('mkt.sortRel');
  const relaxedNote=r.relaxed==='version'?t('mkt.relaxedVersion'):r.relaxed==='loader'?t('mkt.relaxedLoader'):'';
  const countLabel=marketTotal!=null?`${marketTotal} ${sortLabel}`:`${marketItems.length} ${sortLabel}`;
  status.textContent=`${countLabel} · ${source}.${relaxedNote}`;
  const countEl=$('#marketplaceCount'); if(countEl) countEl.textContent=marketTotal!=null?tf('mkt.found',{a:marketTotal}):`${marketItems.length}`;
  renderMarket(marketItems);
  if(typeof renderMarketChips==='function')renderMarketChips();
  $('#marketPager').hidden=!(page>1||marketHasNext);
  $('#marketPrev').disabled=page<=1;$('#marketNext').disabled=!marketHasNext;
  $('#marketPageLabel').textContent=marketTotal!=null?t('mkt.pageOf',{p:page,t:Math.max(1,Math.ceil(marketTotal/20))}):t('mkt.page',{p:page});
}
$('#marketSearch').onclick=()=>runMarketSearch(1);
$('#marketPrev').onclick=()=>{if(marketPage>1)runMarketSearch(marketPage-1)};
$('#marketNext').onclick=()=>{if(marketHasNext)runMarketSearch(marketPage+1)};
const debouncedMarketSearch=debounce(()=>runMarketSearch(1),400);
$('#marketQuery').addEventListener('input', debouncedMarketSearch);
$('#marketQuery').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault(); runMarketSearch(1)}});
function flashMarketField(el){el.classList.remove('just-changed');void el.offsetWidth;el.classList.add('just-changed')}
$('#marketKind').onchange=e=>{flashMarketField(e.target);runMarketSearch(1)};$('#marketVersion').onchange=e=>{flashMarketField(e.target);runMarketSearch(1)};
// Sort is now a single dropdown (was 3 buttons) — fewer controls, same three modes.
$('#marketSort').onchange=e=>{marketSort=e.target.value;runMarketSearch(1)};
// Source is a segmented control; it drives the hidden #marketSource input the search reads.
$$('#marketSourceSeg .seg').forEach(b=>b.onclick=()=>{$$('#marketSourceSeg .seg').forEach(x=>x.classList.toggle('active',x===b));$('#marketSource').value=b.dataset.source;flashMarketField($('#marketSourceSeg'));runMarketSearch(1)});
// Quick-pick chips: fill the query and search immediately.
$$('.quick-chip').forEach(c=>c.onclick=()=>{$('#marketQuery').value=c.dataset.quick;runMarketSearch(1)});
// Active-filter chips: show what is currently narrowing the results, each removable in one click.
function renderMarketChips(){
  const box=$('#marketChips');if(!box)return;
  const chips=[];
  const src=$('#marketSource').value,kind=$('#marketKind').value,ver=$('#marketVersion').value;
  if(src)chips.push({k:'src',label:t('mkt.filterSource',{s:src}),clear:()=>{}});
  if(kind)chips.push({k:'kind',label:t('mkt.filterType',{t:$('#marketKind').selectedOptions[0]?.textContent||kind}),clear:()=>{}});
  if(ver)chips.push({k:'ver',label:t('mkt.filterVersion',{v:ver}),clear:()=>{}});
  box.hidden=!chips.length;
  box.innerHTML=chips.length?chips.map(c=>`<span class="market-chip">${esc(c.label)}</span>`).join(''):'';
}
$('#importModpack').onclick=async()=>{const r=await window.observer.importModpack();if(r.cancelled)return;if(!r.ok)return toast(r.error,'error');state.files=r.files;refreshUI();toast(t('mkt.imported',{n:r.name,c:r.installed,s:r.skipped?t('mkt.importedSkipped',{k:r.skipped}):''}),'success');if(r.blocked&&r.blocked.length)openBlockedDialog(r)};
// --- Blocked mods dialog (CurseForge import; Prism-style manual fallback) ---
// When a CF modpack includes mods whose author disabled third-party downloads, the API returns no
// URL. We list them, link their page, and let the user drop the files into the server folder then
// click Check — verifyBlockedMods hashes what is on disk against the expected SHA1.
let blockedState={list:[],destFolder:'mods'};
function openBlockedDialog(r){blockedState={list:r.blocked||[],destFolder:r.destFolder||'mods'};const m=$('#blockedModal');if(!m)return;m.hidden=false;renderBlockedList()}function renderBlockedList(){const box=$('#blockedList');if(!box)return;box.innerHTML=blockedState.list.map((b,i)=>`<li class="blocked-row" data-i="${i}"><span class="blocked-name">${esc(b.name||b.fileName||('project '+b.projectID))}</span><button type="button" class="text-btn" data-open="${i}">${esc(t('cfi.openPage'))} ↗</button><span class="blocked-tag">${esc(t('cfi.pending'))}</span></li>`).join('')||`<li class="empty"><span>${esc(t('cfi.done'))}</span></li>`;box.querySelectorAll('[data-open]').forEach(x=>x.onclick=()=>{const b=blockedState.list[Number(x.dataset.open)];if(b&&b.pageUrl)window.observer.marketOpenExternal(b.pageUrl);else if(b&&b.projectID)window.observer.marketOpenExternal('https://www.curseforge.com/minecraft/mc-mods/'+b.projectID)});$('#blockedHint').textContent=t('cfi.hint',{f:blockedState.destFolder})}async function checkBlocked(){const r=await window.observer.verifyBlockedMods({blocked:blockedState.list,destFolder:blockedState.destFolder});if(r&&r.ok){blockedState.list=r.missing||[];renderBlockedList();if(!blockedState.list.length)toast(t('cfi.done'),'success')}}$('#blockedCheck')&&($('#blockedCheck').onclick=checkBlocked);$('#blockedClose')&&($('#blockedClose').onclick=()=>{$('#blockedModal').hidden=true});
$('#exportModpack').onclick=async()=>{const r=await window.observer.exportModpack();if(r.cancelled)return;if(!r.ok)return toast(r.error,'error');toast(t('mkt.exported',{c:r.count,p:r.path}),'success')};

// --- CurseForge source (optional): only shown once the user has saved an API key ---
// The app never bundles a key (CurseForge ToS forbids sharing). When the key is present the seg
// appears; when a search hits a key-less/misconfigured state the backend returns a clear error.
async function refreshCurseforgeSource(){
  const seg=$('#marketCfSeg');if(!seg)return;
  let hasKey=false;
  try{const r=await window.observer.marketCurseforgeStatus();hasKey=!!(r&&r.hasKey)}catch{}
  seg.hidden=!hasKey;
  // If CF was the active source and the key just went away, fall back to Modrinth.
  if(!hasKey&&$('#marketSource').value==='curseforge'){
    $('#marketSource').value='modrinth';
    $$('#marketSourceSeg .seg').forEach(x=>x.classList.toggle('active',x.dataset.source==='modrinth'));
  }
}
refreshCurseforgeSource();
// Re-check after settings are saved (the user may have just pasted a key).
$('#saveSettings')?.addEventListener('click',()=>setTimeout(refreshCurseforgeSource,400));
