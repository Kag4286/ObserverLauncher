// js/01-content.js — split from app.js (lines 88-295); classic script, load in numeric order.
// Content tab: plugin/mod/datapack file list with friendly per-kind empty states and a one-click
// jump to the Marketplace (pre-filtered by the loader this server actually uses).
// The in-place file editor (bays ↔ browser ↔ editor, folder tree, highlighting) now lives in
// 01b-editor.js, which must load right after this file (02-worldmap.js calls openEd/edState).
const CONTENT_HINTS={plugin:['cnt.emptyPT','cnt.emptyPS'],mod:['cnt.emptyMT','cnt.emptyMS'],datapack:['cnt.emptyDT','cnt.emptyDS']};
function jumpToMarket(kind){
  switchTab('marketplace');
  const map={plugin:'plugin',datapack:'datapack',mod:/forge|neoforge/i.test(state.files?.jar||'')?'forge':/fabric|quilt/i.test(state.files?.jar||'')?'fabric':'plugin'};
  if(map[kind])$('#marketKind').value=map[kind];
  $('#marketQuery').value='';
  runMarketSearch(1);
  setTimeout(()=>$('#marketQuery')?.focus(),200);
}
function renderFiles(id,files,kind){const node=$(id);if(!node) return;
  if(!files.length){
    const [tk,sk]=CONTENT_HINTS[kind]||['cnt.emptyPT','cnt.emptyPS'];
    const importLabel=kind==='datapack'?t('cnt.importZip'):t('cnt.importJar');
    node.innerHTML=`<li class="empty"><div><b>${esc(t(tk))}</b><span>${esc(t(sk))}</span></div><div class="empty-actions"><button class="btn sm primary" data-empty-import="${esc(kind)}">${esc(importLabel)}</button><button class="text-btn" data-market-jump="${esc(kind)}">${esc(t('cnt.market'))}</button></div></li>`;
    if(kind){
      node.querySelectorAll('[data-empty-import]').forEach(b=>b.onclick=()=>{if(state.running&&!confirm(t('cnt.confirmRunningImport')))return;window.observer.importContent(kind).then(r=>{ if(r.ok){state.files=r.files;refreshUI();toast(t('toast.imported'),'success')}else if(!r.cancelled) toast(r.error,'error'); })});
      node.querySelectorAll('[data-market-jump]').forEach(b=>b.onclick=()=>jumpToMarket(b.dataset.marketJump));
    }
    return;
  }
  node.innerHTML=files.map(x=>`<li title="${esc(x)}"><span class="file-name">${esc(x)}</span><button class="text-btn danger" data-delete-content="${esc(kind)}" data-delete-file="${esc(x)}" aria-label="${esc(t('cnt.delete'))} ${esc(x)}">${esc(t('cnt.delete'))}</button></li>`).join('');
  node.querySelectorAll('[data-delete-content]').forEach(b=>b.onclick=async()=>{const file=b.dataset.deleteFile;if(!confirm(t('toast.confirmDelete',{n:file})))return;if(state.running&&!confirm(t('cnt.confirmRunningDelete')))return;const r=await window.observer.deleteContent({kind,fileName:file});if(!r.ok)return toast(r.error,'error');state.files=r.files;refreshUI();toast(t('toast.deleted',{n:file}),'success')})
}
