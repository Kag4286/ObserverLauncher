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
  node.innerHTML=files.map(x=>`<li data-name="${esc(x)}" title="${esc(x)}"><span class="file-name">${esc(x)}</span><button class="text-btn danger" data-delete-content="${esc(kind)}" data-delete-file="${esc(x)}" aria-label="${esc(t('cnt.delete'))} ${esc(x)}">${esc(t('cnt.delete'))}</button></li>`).join('');
  node.querySelectorAll('[data-delete-content]').forEach(b=>b.onclick=async()=>{const file=b.dataset.deleteFile;if(!await confirmDialog({title:t('cnt.delete'),body:t('toast.confirmDelete',{n:file}),ok:t('cnt.delete'),danger:true}))return;if(state.running&&!await confirmDialog({title:t('cnt.delete'),body:t('cnt.confirmRunningDelete'),ok:t('cnt.delete'),danger:true}))return;const r=await window.observer.deleteContent({kind,fileName:file});if(!r.ok)return toast(r.error,'error');state.files=r.files;refreshUI();toast(t('toast.deleted',{n:file}),'success')})
}
// Wire the segmented switch + filter once (delegation-free: elements are static in index.html).
$$('#contentSeg .seg').forEach(b=>b.onclick=()=>setContentKind(b.dataset.ckind));
$('#contentFilter')?.addEventListener('input',filterContentList);
