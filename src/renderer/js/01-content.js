// js/01-content.js — split from app.js (lines 88-295); classic script, load in numeric order.
// Content tab: plugin/mod/datapack file list with friendly per-kind empty states and a one-click
// jump to the Marketplace (pre-filtered by the loader this server actually uses).
// REDESIGN (0.7.0): one large list with a segmented kind switch + filter box replaces the old
// three narrow columns that each scrolled on their own — with hundreds of jars that was painful.
// All three lists are still rendered (instant switching); only the active kind is shown, and the
// filter hides non-matching rows in place.
// The in-place file editor (bays ↔ browser ↔ editor, folder tree, highlighting) now lives in
// 01b-editor.js, which must load right after this file (02-worldmap.js calls openEd/edState).
const CONTENT_HINTS={plugin:['cnt.emptyPT','cnt.emptyPS'],mod:['cnt.emptyMT','cnt.emptyMS'],datapack:['cnt.emptyDT','cnt.emptyDS']};
// Maps a content kind to the target folder + import extension, so the toolbar buttons can be
// re-pointed when the user switches kind without duplicating three button sets.
const CONTENT_META={
  plugin:{folder:'plugins',ext:'jar'},
  mod:{folder:'mods',ext:'jar'},
  datapack:{folder:'world/datapacks',ext:'zip'}
};
let contentKind='plugin';
// CB4/CB5 (v3.3.0): content update state. { byFile:{name:{status,version,latestNumber}}, updates:N }.
// Loaded lazily when the Content tab opens (or via the Check updates button); NEVER polled.
async function loadContentUpdates(btn){
  if(btn)btn.disabled=true;
  try{
    const r=await window.observer.contentUpdates();
    if(!r||!r.ok){state.contentUpdates=null;}
    else{const byFile={};for(const it of (r.items||[]))byFile[it.fileName]=it;state.contentUpdates={byFile,updates:r.updates||0};}
  }catch{state.contentUpdates=null}
  if(btn)btn.disabled=false;
  renderContentUpdatesPill();
  refreshUI();
}
function renderContentUpdatesPill(){
  const pill=$('#contentUpdatesPill');if(!pill)return;
  const n=state.contentUpdates?state.contentUpdates.updates:0;
  if(n>0){pill.hidden=false;pill.textContent=t('cnt.updatesAvailable',{n});pill.classList.add('accent')}
  else{pill.hidden=true}
}
function jumpToMarket(kind){
  switchTab('marketplace');
  const map={plugin:'plugin',datapack:'datapack',mod:/forge|neoforge/i.test(state.files?.jar||'')?'forge':/fabric|quilt/i.test(state.files?.jar||'')?'fabric':'plugin'};
  if(map[kind])$('#marketKind').value=map[kind];
  $('#marketQuery').value='';
  runMarketSearch(1);
  setTimeout(()=>$('#marketQuery')?.focus(),200);
}
// Show only the list for `kind`, re-point the toolbar import/open/market buttons, and re-apply filter.
function setContentKind(kind){
  contentKind=kind;
  $$('#contentSeg .seg').forEach(b=>b.classList.toggle('active',b.dataset.ckind===kind));
  $('#pluginsList').hidden=kind!=='plugin';
  $('#modsList').hidden=kind!=='mod';
  $('#datapacksList').hidden=kind!=='datapack';
  const imp=$('#contentImport'),open=$('#contentOpen'),mkt=$('#contentMarket');
  if(imp){imp.dataset.import=kind;imp.textContent=t(kind==='datapack'?'cnt.importZip':'cnt.importJar')}
  if(open)open.dataset.open=CONTENT_META[kind].folder;
  if(mkt)mkt.dataset.marketJump=kind;
  filterContentList();
}
// Hide rows in the ACTIVE list that don't contain the query (case-insensitive). Empty-state rows
// (no data-name) stay visible so the friendly message is never hidden by a stray filter.
function filterContentList(){
  const q=($('#contentFilter')?.value||'').trim().toLowerCase();
  const list=$(contentKind==='plugin'?'#pluginsList':contentKind==='mod'?'#modsList':'#datapacksList');
  if(!list)return;
  list.querySelectorAll('li[data-name]').forEach(li=>{
    li.hidden=!!q&&!li.dataset.name.toLowerCase().includes(q);
  });
}
function renderFiles(id,files,kind){const node=$(id);if(!node) return;
  if(!files.length){
    const [tk,sk]=CONTENT_HINTS[kind]||['cnt.emptyPT','cnt.emptyPS'];
    const importLabel=kind==='datapack'?t('cnt.importZip'):t('cnt.importJar');
    node.innerHTML=`<li class="empty"><div><b>${esc(t(tk))}</b><span>${esc(t(sk))}</span></div><div class="empty-actions"><button class="btn sm primary" data-empty-import="${esc(kind)}">${esc(importLabel)}</button><button class="text-btn" data-market-jump="${esc(kind)}">${esc(t('cnt.market'))}</button></div></li>`;
    if(kind){
      node.querySelectorAll('[data-empty-import]').forEach(b=>b.onclick=async()=>{if(state.running&&!await confirmDialog({title:t('cnt.importJar'),body:t('cnt.confirmRunningImport'),ok:t('cnt.import')}))return;window.observer.importContent(kind).then(r=>{ if(r.ok){state.files=r.files;refreshUI();toast(t('toast.imported'),'success')}else if(!r.cancelled) toast(r.error,'error'); })});
      node.querySelectorAll('[data-market-jump]').forEach(b=>b.onclick=()=>jumpToMarket(b.dataset.marketJump));
    }
    return;
  }
  const upd=(state.contentUpdates&&state.contentUpdates.byFile)||{};
  node.innerHTML=files.map(x=>{
    const off=/\.disabled$/i.test(x);
    const info=upd[x]||null;
    // version badge: shows the installed version, and "-> latest" when an update is available.
    const ver=info&&info.version?`<span class="file-ver mono">${esc(info.version)}${info.status==='update'&&info.latestNumber?' → '+esc(info.latestNumber):''}</span>`:'';
    const upBtn=(info&&info.status==='update'&&!off)?`<button class="text-btn" data-update-content="${esc(kind)}" data-update-file="${esc(x)}">${esc(t('cnt.update'))}</button>`:'';
    return `<li data-name="${esc(x)}" class="${off?'is-disabled':''}" title="${esc(x)}"><span class="file-name">${esc(x)}</span>${ver}<button class="text-btn" data-toggle-content="${esc(kind)}" data-toggle-file="${esc(x)}">${esc(t(off?'cnt.enable':'cnt.disable'))}</button>${upBtn}<button class="text-btn danger" data-delete-content="${esc(kind)}" data-delete-file="${esc(x)}" aria-label="${esc(t('cnt.delete'))} ${esc(x)}">${esc(t('cnt.delete'))}</button></li>`}).join('');
  // CB6 (v3.3.0): enable/disable a content file (rename <name> <-> <name>.disabled). Cheap + reversible.
  node.querySelectorAll('[data-toggle-content]').forEach(b=>b.onclick=async()=>{const r=await window.observer.toggleContent({kind,fileName:b.dataset.toggleFile});if(!r.ok)return toast(r.error,'error');state.files=r.files;refreshUI()});
  // CB5 (v3.3.0): update one file to its newer build (backup first). Refused while the server runs.
  node.querySelectorAll('[data-update-content]').forEach(b=>b.onclick=async()=>{const file=b.dataset.updateFile;if(!await confirmDialog({title:t('cnt.update'),body:t('cnt.confirmUpdate',{n:file}),ok:t('cnt.update')}))return;const r=await window.observer.contentUpdate({names:[file]});if(!r||!r.ok)return toast((r&&r.error)||t('toast.updateFailed',{n:file}),'error');state.files=r.files||state.files;await loadContentUpdates();toast(t('toast.updated',{n:file}),'success')});
  node.querySelectorAll('[data-delete-content]').forEach(b=>b.onclick=async()=>{const file=b.dataset.deleteFile;if(!await confirmDialog({title:t('cnt.delete'),body:t('toast.confirmDelete',{n:file}),ok:t('cnt.delete'),danger:true}))return;if(state.running&&!await confirmDialog({title:t('cnt.delete'),body:t('cnt.confirmRunningDelete'),ok:t('cnt.delete'),danger:true}))return;const r=await window.observer.deleteContent({kind,fileName:file});if(!r.ok)return toast(r.error,'error');state.files=r.files;refreshUI();toast(t('toast.deleted',{n:file}),'success')})
}
// Wire the segmented switch + filter once (delegation-free: elements are static in index.html).
$$('#contentSeg .seg').forEach(b=>b.onclick=()=>setContentKind(b.dataset.ckind));
$('#contentFilter')?.addEventListener('input',filterContentList);
$('#contentCheckUpdates')?.addEventListener('click',e=>loadContentUpdates(e.currentTarget));
