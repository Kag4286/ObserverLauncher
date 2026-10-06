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

// ============ v4.0.0 CONTENT UX: reveal + right-click ============
// The three lists share a delegation root so a row can be revealed in the OS file manager
// (double-click) or given a context menu (right-click) without re-binding per render.
const CONTENT_LIST_SEL='#pluginsList,#modsList,#datapacksList';
function contentRelPath(li){
  const list=li.closest('ul');
  const kind=(list&&list.dataset.dkKind)||'plugin';
  const name=li.dataset.name;
  if(!name)return null;
  const folder=CONTENT_META[kind]?CONTENT_META[kind].folder:'plugins';
  return { rel:folder+'/'+name, name, kind };
}
$$(CONTENT_LIST_SEL).forEach(list=>{
  // Double-click a row -> show the file in Explorer/Finder (highlighted).
  list.addEventListener('dblclick',e=>{
    const li=e.target.closest('li[data-name]');if(!li)return;
    const p=contentRelPath(li);if(!p)return;
    window.observer.revealFiles(p.rel);
  });
  // Right-click a row -> a small context menu with the same actions the row already exposes.
  list.addEventListener('contextmenu',e=>{
    const li=e.target.closest('li[data-name]');if(!li)return;
    const p=contentRelPath(li);if(!p)return;
    e.preventDefault();
    openContentMenu(e.clientX,e.clientY,p,li);
  });
});
function closeContentMenu(){const m=$('#contentCtx');if(m)m.remove()}
function openContentMenu(x,y,p,li){
  closeContentMenu();
  const off=li.classList.contains('is-disabled');
  const info=(state.contentUpdates&&state.contentUpdates.byFile&&state.contentUpdates.byFile[p.name])||null;
  const hasUpdate=info&&info.status==='update'&&!off;
  const menu=document.createElement('div');
  menu.id='contentCtx';menu.className='ctx-menu';menu.setAttribute('role','menu');
  // Each entry: [label, action, extraClass]. Actions reuse the row's OWN buttons so every guard
  // (confirm dialogs, running-server checks) stays in ONE place — never re-implemented here.
  const entries=[
    [t('cnt.reveal'),()=>window.observer.revealFiles(p.rel),''],
    hasUpdate?[t('cnt.update'),()=>li.querySelector('[data-update-content]')?.click(),'']:null,
    [t(off?'cnt.enable':'cnt.disable'),()=>li.querySelector('[data-toggle-content]')?.click(),''],
    [t('cnt.delete'),()=>li.querySelector('[data-delete-content]')?.click(),'danger'],
  ].filter(Boolean);
  entries.forEach(([label,fn,cls])=>{
    const b=document.createElement('button');b.type='button';b.setAttribute('role','menuitem');b.textContent=label;if(cls)b.className=cls;
    b.onclick=()=>{closeContentMenu();fn();};
    menu.appendChild(b);
  });
  // Keep it on-screen.
  menu.style.left=Math.min(x,innerWidth-200)+'px';
  menu.style.top=Math.min(y,innerHeight-160)+'px';
  document.body.appendChild(menu);
  setTimeout(()=>document.addEventListener('pointerdown',closeContentMenu,{once:true}),0);
}
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeContentMenu()});
// ============ v4.0.0 dropdown menus (+ Add / More) ============
// WHY a portal: a menu inside the scrollable <main> gets CLIPPED, and position:fixed inside an
// animated/transformed ancestor is anchored wrong. So on open the menu-body is MOVED to
// <body> (position:fixed against the viewport), placed under its button, and moved back on close.
// The menu-body gets PORTALED to <body>, so after that it is no longer a descendant of d — cache the
// references once (else querySelector would return null after opening and the menu could never close).
function menuParts(d){
  if(!d._mBtn) d._mBtn = d.querySelector('.menu-summary');
  if(!d._mBody) d._mBody = d.querySelector('.menu-body');
  return { body: d._mBody, btn: d._mBtn };
}
function closeMenu(d){
  const { body, btn } = menuParts(d);
  if(!body || body.hidden) return;
  body.hidden = true;
  if(btn) btn.setAttribute('aria-expanded','false');
  if(body.parentElement === document.body) d.appendChild(body); // move home
}
function closeMenus(except){ $$('.menu').forEach(d=>{ if(d!==except) closeMenu(d); }); }
function openMenu(d){
  const { body, btn } = menuParts(d);
  if(!body || !btn || !body.hidden) return;
  closeMenus(d);
  document.body.appendChild(body); // PORTAL: escape any clipping ancestor
  body.hidden = false;
  btn.setAttribute('aria-expanded','true');
  const r = btn.getBoundingClientRect();
  const w = body.offsetWidth || 210, h = body.offsetHeight || 120;
  body.style.left = Math.max(8, Math.min(r.right - w, innerWidth - w - 8)) + 'px';
  body.style.top  = (r.bottom + 6 + h > innerHeight ? r.top - h - 6 : r.bottom + 6) + 'px';
}
$$('.menu').forEach(d=>{
  const { btn } = menuParts(d);
  if(!btn) return;
  btn.addEventListener('click',e=>{
    e.stopPropagation();
    const { body } = menuParts(d);
    if(body && body.hidden) openMenu(d); else closeMenu(d);
  });
});
// Close on outside click, Escape, scroll or resize.
// The menu-body is portaled to <body>, so an item click no longer matches .menu — exclude it too,
// or the pointerdown would close the menu before the item's click fires.
document.addEventListener('pointerdown',e=>{ if(!e.target.closest('.menu') && !e.target.closest('.menu-body')) closeMenus(null); });
document.addEventListener('keydown',e=>{ if(e.key==='Escape') closeMenus(null); });
window.addEventListener('resize',()=>closeMenus(null));
window.addEventListener('scroll',()=>closeMenus(null),true);
