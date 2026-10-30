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
  loadContentConflicts();
  refreshUI();
}
async function loadContentConflicts(){
  if(!window.observer.contentConflicts)return;
  try{
    const r=await window.observer.contentConflicts();
    state.contentConflicts=r||null;
  }catch{state.contentConflicts=null}
  renderContentConflicts();
  updateContentToolbarState();
  if(state.files){
    const f=state.files;
    renderFiles('#pluginsList',f.plugins||[],'plugin');
    renderFiles('#modsList',f.mods||[],'mod');
    renderFiles('#datapacksList',f.datapacks||[],'datapack');
  }
}
function renderContentConflicts(){
  const box=$('#contentConflictsBanner'),title=$('#ccbTitle'),list=$('#ccbList'),toggle=$('#ccbToggle');
  if(!box)return;
  const data=state.contentConflicts;
  const issues=(data&&data.issues)||[];
  if(!issues.length){
    box.hidden=true;
    box.classList.remove('is-open');
    return;
  }
  box.hidden=false;
  if(title)title.textContent=t('cnt.conflictsFound',{n:issues.length});
  if(toggle){
    const isExpanded=box.classList.contains('is-open');
    toggle.textContent=isExpanded?t('cnt.hideDetails'):t('cnt.showDetails');
    toggle.onclick=()=>{
      const show=!box.classList.contains('is-open');
      box.classList.toggle('is-open',show);
      toggle.textContent=show?t('cnt.hideDetails'):t('cnt.showDetails');
    };
  }
  if(list){
    list.innerHTML=issues.map(iss=>{
      const isDup=iss.type==='duplicate';
      const isMismatch=iss.type==='loader-mismatch';
      const isMissing=iss.type==='missing-dep';
      const badgeClass=isDup?'bad':isMismatch?'bad':isMissing?'warn':'';
      let badgeText=t('cnt.conflictBadge');
      if(iss.type==='duplicate')badgeText=t('cnt.issue_duplicate');
      else if(iss.type==='loader-mismatch')badgeText=t('cnt.issue_loader_mismatch');
      else if(iss.type==='missing-dep')badgeText=t('cnt.issue_missing_dep');
      else if(iss.type==='conflict')badgeText=t('cnt.issue_conflict');
      else if(iss.type==='client-only')badgeText=t('cnt.issue_client_only');
      return `<li class="ccb-item"><span class="ccb-badge ${badgeClass}">${esc(badgeText)}</span><span class="ccb-file mono">${esc(iss.fileName||iss.neededBy||'')}</span><span class="ccb-detail">${esc(iss.detail)}</span></li>`;
    }).join('');
  }
}
async function renderContentUpdatesPill(){
  const pill=$('#contentUpdatesPill'), upAll=$('#contentUpdateAll'), rbBtn=$('#contentRollbackUpdate');
  const n=state.contentUpdates?state.contentUpdates.updates:0;
  if(pill){
    if(n>0){pill.hidden=false;pill.textContent=t('cnt.updatesAvailable',{n});pill.classList.add('accent')}
    else{pill.hidden=true}
  }
  if(upAll){
    upAll.hidden=n<=0;
  }
  if(rbBtn && window.observer && window.observer.contentLastUpdate){
    try{
      const r=await window.observer.contentLastUpdate();
      rbBtn.hidden=!r || !r.session || r.session.status==='rolled_back';
      if(r && r.session && r.session.items){
        state.lastUpdateSession=r.session;
      }else{
        state.lastUpdateSession=null;
      }
    }catch{
      rbBtn.hidden=true;
      state.lastUpdateSession=null;
    }
  }
}
async function rollbackLastContentUpdate(sessionId){
  if(!window.observer || !window.observer.contentRollback)return;
  const r=await window.observer.contentRollback({sessionId});
  if(!r||!r.ok)return toast((r&&r.error)||t('toast.rollbackFailed',{m:'error'}),'error');
  state.files=r.files||state.files;
  await loadContentUpdates();
  refreshUI();
  toast(t('toast.rollbackSuccess',{n:r.rolledBackCount||1}),'success');
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
  // v6.0.0 C5c: the load-order panel is datapack-only. Hide it elsewhere so it cannot be confused
  // with the mod/plugin lists.
  const dpBox=$('#dpOrderBox'); if(dpBox) dpBox.hidden=kind!=='datapack';
  if(kind==='datapack') renderDatapackOrder();
  filterContentList();
}
// v6.0.0 C5c: read the enabled datapack list from level.dat (readDatapackOrder) and paint it with
// up/down arrows. A pack that is a file under <world>/datapacks lives with 'file/<name>'; a pack
// that is built into the game or a mod carries a short tag and no arrows (its position is fixed).
let lastDpOrderSig='';
// Mirror of datapack-order.js parsePackEntry for the renderer (the main module is not importable
// from a classic script). Same 'file/<name>' contract; anything else is a builtin entry.
function parsePackEntry(entry){
  const s=String(entry||'');
  if(!s)return null;
  if(s.startsWith('file/'))return {kind:'file',name:s.slice(5)};
  return {kind:s==='vanilla'?'vanilla':'builtin',name:s};
}
async function renderDatapackOrder(force){
  const box=$('#dpOrderBox'),host=$('#dpOrderList');
  if(!box||!host)return;
  if(box.hidden)return;
  let r; try{ r=await window.observer.datapacksOrder(); }catch{ r=null; }
  if(!r||!r.ok){ host.innerHTML='<li class="dp-order-empty">'+esc((r&&r.error)||t('dp.orderFail'))+'</li>'; lastDpOrderSig=''; return; }
  const enabled=Array.isArray(r.enabled)?r.enabled:[];
  const sig=JSON.stringify(enabled);
  if(!force&&sig===lastDpOrderSig)return;
  lastDpOrderSig=sig;
  if(!enabled.length){ host.innerHTML='<li class="dp-order-empty">'+esc(t('dp.orderEmpty'))+'</li>'; return; }
  // v6.0.0 C5c: SVG chevrons keep the two arrow buttons optically identical at 24x24. The two arrows
  // live in a .dp-order-arrows wrapper so the grid's third column is one cell (arrows OR tag), and
  // the row never reflows when the arrows disable at the ends of the list.
  //
  // DISPLAY ORDER: DataPacks.Enabled is stored lowest-priority first (index 0 = runs first). We
  // REVERSE it for display so the highest priority is at the TOP of the list. That way the up arrow
  // (which the backend maps to a higher index = higher priority) moves the row UP on screen, which
  // is what the user expects. Without the reverse the up arrow moved the row down.
  const svgUp='<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 8l3-3 3 3"/></svg>';
  const svgDown='<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4l3 3 3-3"/></svg>';
  const displayed=enabled.slice().reverse();
  host.innerHTML=displayed.map((entry,i)=>{
    const parsed=parsePackEntry(entry)||{kind:'builtin',name:entry};
    const tag=parsed.kind==='vanilla'?esc(t('dp.tagVanilla')):parsed.kind==='builtin'?esc(t('dp.tagBuiltin')):'';
    const arrows=parsed.kind==='file'
      ? '<span class="dp-order-arrows">'
        +'<button type="button" data-dp-move="up" data-dp-name="'+esc(entry)+'" '+(i===0?'disabled':'')+' aria-label="'+esc(t('dp.moveUp'))+'" title="'+esc(t('dp.moveUp'))+'">'+svgUp+'</button>'
        +'<button type="button" data-dp-move="down" data-dp-name="'+esc(entry)+'" '+(i===displayed.length-1?'disabled':'')+' aria-label="'+esc(t('dp.moveDown'))+'" title="'+esc(t('dp.moveDown'))+'">'+svgDown+'</button>'
        +'</span>'
      : '<span class="dp-order-tag">'+tag+'</span>';
    return '<li class="dp-order-row"><span class="dp-order-idx">'+(i+1)+'</span><span class="dp-order-name">'+esc(parsed.name)+'</span>'+arrows+'</li>';
  }).join('');
  host.querySelectorAll('[data-dp-move]').forEach(b=>b.onclick=async()=>{
    b.disabled=true;
    let r2; try{ r2=await window.observer.datapacksReorder({name:b.dataset.dpName,direction:b.dataset.dpMove}); }catch(e){ r2={ok:false,error:e?.message||'Reorder failed.'}; }
    if(!r2||!r2.ok)return toast((r2&&r2.error)||'Reorder failed.','error');
    await renderDatapackOrder(true);
  });
}
// Hide rows in the ACTIVE list that don't contain the query (case-insensitive). Empty-state rows
// (no data-name) stay visible so the friendly message is never hidden by a stray filter.

let contentQuickFilter = 'all';

function cleanModTitle(fileName, metaName) {
  if (metaName && typeof metaName === 'string' && metaName.trim() && metaName !== fileName) {
    return metaName.trim();
  }
  let s = String(fileName || '')
    .replace(/\.disabled$/i, '')
    .replace(/\.(jar|zip)$/i, '');
  s = s.replace(/[-_+]\s*(?:forge|fabric|neoforge|quilt|bukkit|spigot|paper)\b/gi, ' ');
  s = s.replace(/\b(?:forge|fabric|neoforge|quilt|bukkit|spigot|paper)\b/gi, ' ');
  s = s.replace(/\+(?:mc)?\d+[\d.\-_+a-z]*/gi, ' ');
  s = s.replace(/[-_+](?:mc)?1\.\d+(\.\d+)?/gi, ' ');
  s = s.replace(/[-_+](?:v|r)?\d+[\d.\-_+a-z]*/gi, ' ');
  s = s.replace(/\b(?:v|r)?\d+[\d.]*\b/gi, ' ');
  s = s.replace(/[-_]+/g, ' ').trim();
  s = s.replace(/([a-z])([A-Z])/g, '$1 $2');
  s = s.replace(/(?:^|\s)[a-z]/g, c => c.toUpperCase());
  s = s.replace(/'S\b/g, "'s");
  return s.trim() || fileName;
}

function syncContentKindAuto() {
  const f = state.files || {};
  const pCount = (f.plugins || []).length;
  const mCount = (f.mods || []).length;
  const dCount = (f.datapacks || []).length;

  if (contentKind === 'plugin' && pCount === 0 && mCount > 0) {
    setContentKind('mod');
  } else if (contentKind === 'mod' && mCount === 0 && pCount > 0) {
    setContentKind('plugin');
  } else if (contentKind === 'datapack' && dCount === 0) {
    if (mCount > 0) setContentKind('mod');
    else if (pCount > 0) setContentKind('plugin');
  }
}

function glyphProps(name) {
  const clean = String(name || '').trim();
  const words = clean.split(/\s+/).filter(Boolean);
  let text = 'M';
  if (words.length >= 2) {
    text = (words[0][0] + words[1][0]).toUpperCase();
  } else if (clean.length > 0) {
    text = clean.slice(0, Math.min(2, clean.length)).toUpperCase();
  }
  let hash = 0;
  for (let i = 0; i < clean.length; i++) hash = (hash << 5) - hash + clean.charCodeAt(i);
  const hue = Math.abs(hash) % 360;
  return {
    text,
    bg: `hsl(${hue}, 42%, 18%)`,
    border: `hsl(${hue}, 46%, 28%)`,
    color: `hsl(${hue}, 80%, 75%)`
  };
}

async function jumpToModConfig(fileName, kind) {
  try {
    const meta = (state.contentConflicts && state.contentConflicts.metadata && state.contentConflicts.metadata[fileName]) || {};
    const modId = (meta.modId || '').toLowerCase();
    const rawBase = fileName.replace(/\.disabled$/i, '').replace(/\.(jar|zip)$/i, '');
    const clean = rawBase.replace(/[-_+](?:forge|fabric|neoforge|quilt|bukkit|spigot|paper)[-_+]?/gi, '')
                         .replace(/[-_+](?:mc)?1\.\d+(\.\d+)?/gi, '')
                         .replace(/[-_+](?:v|r)?\d+[\d.\-_+a-z]*$/i, '')
                         .toLowerCase()
                         .replace(/[-_]/g, '');

    const r = await window.observer.editorList();
    if (!r || !r.ok || !r.files || !r.files.length) {
      if (typeof openFileBrowser === 'function') openFileBrowser();
      return;
    }

    const configFiles = r.files.filter(f => {
      const p = f.path.toLowerCase();
      return p.startsWith('config/') || p.startsWith('defaultconfigs/') || p.startsWith('plugins/');
    });

    let match = null;
    if (modId) {
      match = configFiles.find(f => {
        const base = f.path.split('/').pop().toLowerCase();
        return base.startsWith(modId + '.') || base.startsWith(modId + '-') || base.startsWith(modId + '_');
      });
    }
    if (!match && clean.length >= 3) {
      match = configFiles.find(f => {
        const p = f.path.toLowerCase().replace(/[-_]/g, '');
        return p.includes(clean);
      });
    }

    if (match) {
      if (typeof openEd === 'function') {
        openEd(match.path, 'bays');
        toast(t('cnt.jumpConfig') + ': ' + match.path, 'info');
      }
    } else {
      if (typeof openFileBrowser === 'function') {
        openFileBrowser();
        const searchBox = $('#fbFilter');
        if (searchBox && (modId || clean)) {
          searchBox.value = modId || clean;
          searchBox.dispatchEvent(new Event('input'));
        }
      }
    }
  } catch {
    if (typeof openFileBrowser === 'function') openFileBrowser();
  }
}

function updateContentToolbarState() {
  const kind = contentKind || 'plugin';
  const f = state.files || {};
  const files = (kind === 'plugin' ? f.plugins : kind === 'mod' ? f.mods : f.datapacks) || [];
  const total = files.length;
  const enabled = files.filter(x => !/\.disabled$/i.test(x)).length;
  const disabled = total - enabled;

  const upd = (state.contentUpdates && state.contentUpdates.byFile) || {};
  const updates = files.filter(x => upd[x] && upd[x].status === 'update' && !/\.disabled$/i.test(x)).length;

  const conflictList = (state.contentConflicts && state.contentConflicts.issues) || [];
  const issues = files.filter(x => conflictList.some(iss => String(iss.fileName || iss.neededBy).toLowerCase() === String(x).toLowerCase())).length;

  const chipAll = $('#chipAllCount'); if (chipAll) chipAll.textContent = String(total);
  const chipEn = $('#chipEnabledCount'); if (chipEn) chipEn.textContent = String(enabled);
  const chipDis = $('#chipDisabledCount'); if (chipDis) chipDis.textContent = String(disabled);
  const chipUpd = $('#chipUpdatesCount'); if (chipUpd) chipUpd.textContent = String(updates);
  const chipIss = $('#chipIssuesCount'); if (chipIss) chipIss.textContent = String(issues);

  const chipUpdBtn = $('[data-qfilter="updates"]');
  if (chipUpdBtn) chipUpdBtn.hidden = updates <= 0;
  const chipIssBtn = $('[data-qfilter="issues"]');
  if (chipIssBtn) chipIssBtn.hidden = issues <= 0;

  if ((contentQuickFilter === 'updates' && updates === 0) || (contentQuickFilter === 'issues' && issues === 0)) {
    contentQuickFilter = 'all';
    $$('#contentFilterChips .filter-chip').forEach(c => c.classList.toggle('active', c.dataset.qfilter === 'all'));
  }

  const sumPill = $('#contentSummaryPill');
  if (sumPill) {
    sumPill.textContent = t('cnt.summary', { n: total }) + (disabled > 0 ? ` (${enabled} on, ${disabled} off)` : '');
  }
}

function filterContentList() {
  const q = ($('#contentFilter')?.value || '').trim().toLowerCase();
  const clearBtn = $('#contentFilterClear');
  if (clearBtn) clearBtn.hidden = !q;

  const list = $(contentKind === 'plugin' ? '#pluginsList' : contentKind === 'mod' ? '#modsList' : '#datapacksList');
  if (!list) return;

  let visibleCount = 0;
  const rows = list.querySelectorAll('.content-row');
  rows.forEach(li => {
    const name = (li.dataset.name || '').toLowerCase();
    const title = (li.dataset.title || '').toLowerCase();
    const matchesQuery = !q || name.includes(q) || title.includes(q);

    let matchesFilter = true;
    if (contentQuickFilter === 'enabled') matchesFilter = li.dataset.off === '0';
    else if (contentQuickFilter === 'disabled') matchesFilter = li.dataset.off === '1';
    else if (contentQuickFilter === 'updates') matchesFilter = li.dataset.hasUpdate === '1';
    else if (contentQuickFilter === 'issues') matchesFilter = li.dataset.hasIssue === '1';

    const show = matchesQuery && matchesFilter;
    li.hidden = !show;
    if (show) visibleCount++;
  });

  let emptyMsg = list.querySelector('.cr-empty-search');
  if (rows.length > 0 && visibleCount === 0) {
    if (!emptyMsg) {
      emptyMsg = document.createElement('li');
      emptyMsg.className = 'cr-empty-search';
      emptyMsg.innerHTML = `<span class="empty-icon">⌕</span><b>${esc(t('cnt.noMatches'))}</b><button type="button" class="btn xs secondary" id="crClearFilterBtn">${esc(t('cnt.filterAll'))}</button>`;
      list.appendChild(emptyMsg);
      emptyMsg.querySelector('#crClearFilterBtn').onclick = () => {
        const inp = $('#contentFilter'); if (inp) inp.value = '';
        contentQuickFilter = 'all';
        $$('#contentFilterChips .filter-chip').forEach(c => c.classList.toggle('active', c.dataset.qfilter === 'all'));
        filterContentList();
      };
    }
    emptyMsg.hidden = false;
  } else if (emptyMsg) {
    emptyMsg.hidden = true;
  }
}

function renderFiles(id, files, kind) {
  const node = $(id);
  if (!node) return;
  if (!files.length) {
    node._renderedHtml = '';
    const [tk, sk] = CONTENT_HINTS[kind] || ['cnt.emptyPT', 'cnt.emptyPS'];
    const importLabel = kind === 'datapack' ? t('cnt.importZip') : t('cnt.importJar');
    node.innerHTML = `<li class="empty"><div><b>${esc(t(tk))}</b><span>${esc(t(sk))}</span></div><div class="empty-actions"><button class="btn sm primary" data-empty-import="${esc(kind)}">${esc(importLabel)}</button><button class="text-btn" data-market-jump="${esc(kind)}">${esc(t('cnt.market'))}</button></div></li>`;
    if (kind) {
      node.querySelectorAll('[data-empty-import]').forEach(b => b.onclick = async () => {
        if (state.running && !await confirmDialog({ title: t('cnt.importJar'), body: t('cnt.confirmRunningImport'), ok: t('cnt.import') })) return;
        window.observer.importContent(kind).then(r => {
          if (r.ok) {
            state.files = r.files;
            refreshUI();
            toast(t('toast.imported'), 'success');
          } else if (!r.cancelled) toast(r.error, 'error');
        });
      });
      node.querySelectorAll('[data-market-jump]').forEach(b => b.onclick = () => jumpToMarket(b.dataset.marketJump));
    }
    updateContentToolbarState();
    return;
  }

  const upd = (state.contentUpdates && state.contentUpdates.byFile) || {};
  const conflictList = (state.contentConflicts && state.contentConflicts.issues) || [];
  const metaMap = (state.contentConflicts && state.contentConflicts.metadata) || {};

  const html = files.map(x => {
    const off = /\.disabled$/i.test(x);
    const info = upd[x] || null;
    const fileMeta = metaMap[x] || null;
    const cleanTitle = cleanModTitle(x, fileMeta && fileMeta.name);
    const glyph = glyphProps(cleanTitle);

    let loaderName = (fileMeta && fileMeta.loader) || '';
    if (!loaderName && kind === 'mod') {
      loaderName = (state.files?.target?.loader) || (state.contentConflicts?.server?.loader) || '';
      if (loaderName === 'unknown') loaderName = '';
    }
    if (loaderName) {
      loaderName = loaderName.toLowerCase() === 'neoforge' ? 'NeoForge' : (loaderName[0].toUpperCase() + loaderName.slice(1).toLowerCase());
    }
    const loaderClass = loaderName ? 'loader-' + loaderName.toLowerCase() : '';
    const loaderBadge = loaderName ? `<span class="cr-badge ${loaderClass}">${esc(loaderName)}</span>` : '';

    const verStr = (info && info.version) || (fileMeta && fileMeta.version) || '';
    const verBadge = verStr ? `<span class="cr-badge ver mono">${esc(verStr)}</span>` : '';

    const hasUpdate = info && info.status === 'update' && !off;
    const upBtn = hasUpdate ? `<button type="button" class="cr-badge update" data-update-content="${esc(kind)}" data-update-file="${esc(x)}" title="${esc(t('cnt.confirmUpdate', { n: x }))}">↳ ${esc(info.latestNumber || '')} ⚡</button>` : '';

    const fileConflict = conflictList.find(iss => String(iss.fileName || iss.neededBy).toLowerCase() === String(x).toLowerCase());
    let conflictBadge = '';
    if (fileConflict) {
      let badgeText = t('cnt.conflictBadge');
      if (fileConflict.type === 'duplicate') badgeText = t('cnt.issue_duplicate');
      else if (fileConflict.type === 'loader-mismatch') badgeText = t('cnt.issue_loader_mismatch');
      else if (fileConflict.type === 'missing-dep') badgeText = t('cnt.issue_missing_dep');
      else if (fileConflict.type === 'conflict') badgeText = t('cnt.issue_conflict');
      else if (fileConflict.type === 'client-only') badgeText = t('cnt.issue_client_only');
      conflictBadge = `<span class="cr-badge issue" title="${esc(fileConflict.detail)}">⚠ ${esc(badgeText)}</span>`;
    }

    let dpBtns = '';
    if (kind === 'datapack' && !off) {
      dpBtns += '<button class="text-btn sm" data-validate-dp="' + esc(x) + '">' + esc(t('cnt.validate')) + '</button>';
      if (/\.zip$/i.test(x)) dpBtns += '<button class="text-btn sm" data-extract-dp="' + esc(x) + '">' + esc(t('cnt.extract')) + '</button>';
    }

    return `<li data-name="${esc(x)}" data-title="${esc(cleanTitle)}" data-off="${off ? '1' : '0'}" data-has-update="${hasUpdate ? '1' : '0'}" data-has-issue="${fileConflict ? '1' : '0'}" class="content-row ${off ? 'is-disabled' : ''}" title="${esc(x)}">
      <div class="cr-left">
        <div class="cr-glyph" style="background:${glyph.bg};border:1px solid ${glyph.border};color:${glyph.color};" aria-hidden="true">${glyph.text}</div>
        <div class="cr-info">
          <div class="cr-title-row">
            <span class="cr-title">${esc(cleanTitle)}</span>
            ${off ? `<span class="cr-state-badge off">${esc(t('cnt.filterDisabled'))}</span>` : ''}
          </div>
          <div class="cr-filename mono">${esc(x)}</div>
        </div>
      </div>
      <div class="cr-meta">
        ${loaderBadge}
        ${verBadge}
        ${conflictBadge}
        ${dpBtns}
      </div>
      <div class="cr-actions">
        <button type="button" class="cr-btn cr-btn-config" data-config-file="${esc(x)}" title="${esc(t('cnt.jumpConfig'))}" aria-label="${esc(t('cnt.jumpConfig'))}">
          <span>{&nbsp;}</span>
        </button>
        ${upBtn}
        <label class="switch sm" title="${esc(t(off ? 'cnt.enable' : 'cnt.disable'))}">
          <input type="checkbox" ${off ? '' : 'checked'} data-toggle-content="${esc(kind)}" data-toggle-file="${esc(x)}" aria-label="${esc(t(off ? 'cnt.enable' : 'cnt.disable'))}">
          <span class="slider"></span>
        </label>
        <button type="button" class="cr-btn danger" data-delete-content="${esc(kind)}" data-delete-file="${esc(x)}" aria-label="${esc(t('cnt.delete'))} ${esc(x)}" title="${esc(t('cnt.delete'))}">
          <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor" aria-hidden="true"><path d="M2.5 4h11v1.5h-1v9a1.5 1.5 0 0 1-1.5 1.5h-6A1.5 1.5 0 0 1 3.5 14.5v-9h-1V4zm2 1.5v9a.5.5 0 0 0 .5.5h6a.5.5 0 0 0 .5-.5v-9h-7zM6 2h4a1 1 0 0 1 1 1v1H5V3a1 1 0 0 1 1-1z"/></svg>
        </button>
      </div>
    </li>`;
  }).join('');

  if (node._renderedHtml === html) {
    updateContentToolbarState();
    filterContentList();
    return;
  }
  node._renderedHtml = html;
  node.innerHTML = html;

  if (kind === 'datapack') { try { renderDatapackOrder(); } catch {} }

  updateContentToolbarState();
  filterContentList();
}

// Wire the segmented switch + filter once (delegation-free: elements are static in index.html).
$$('#contentSeg .seg').forEach(b=>b.onclick=()=>setContentKind(b.dataset.ckind));
$('#contentFilter')?.addEventListener('input',filterContentList);

// Wire quick filter chips & clear button
$$('#contentFilterChips .filter-chip').forEach(btn => {
  btn.onclick = () => {
    contentQuickFilter = btn.dataset.qfilter || 'all';
    $$('#contentFilterChips .filter-chip').forEach(c => c.classList.toggle('active', c === btn));
    filterContentList();
  };
});
$('#contentFilterClear')?.addEventListener('click', () => {
  const inp = $('#contentFilter');
  if (inp) { inp.value = ''; inp.focus(); }
  filterContentList();
});
document.addEventListener('keydown', e => {
  if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
    const activeTab = document.querySelector('.tab.active');
    if (activeTab && activeTab.id === 'content') {
      e.preventDefault();
      const inp = $('#contentFilter');
      if (inp) { inp.focus(); inp.select(); }
    }
  }
});

$('#contentCheckUpdates')?.addEventListener('click',e=>loadContentUpdates(e.currentTarget));
$('#contentUpdateAll')?.addEventListener('click',async()=>{
  const n=state.contentUpdates?state.contentUpdates.updates:0;
  if(n<=0)return;
  if(state.running){
    return toast(t('cnt.confirmRunningDelete'),'error');
  }
  if(!await confirmDialog({
    title:t('cnt.updateAll'),
    body:t('cnt.confirmUpdateAll',{n}),
    ok:t('cnt.updateAll')
  }))return;
  const r=await window.observer.contentUpdate({names:null});
  if(!r||!r.ok)return toast((r&&r.error)||t('toast.updateFailed',{n:'all'}),'error');
  state.files=r.files||state.files;
  await loadContentUpdates();
  refreshUI();
  const updatedCount=r.updated?r.updated.length:n;
  toast(t('toast.updated',{n:updatedCount}),'success',{
    label:t('toast.undo'),
    fn:()=>rollbackLastContentUpdate(r.sessionId)
  });
});

$('#contentRollbackUpdate')?.addEventListener('click',async()=>{
  const sess=state.lastUpdateSession;
  const count=(sess&&sess.items)?sess.items.length:1;
  if(!await confirmDialog({
    title:t('cnt.rollbackUpdate'),
    body:t('cnt.confirmRollback',{n:count}),
    ok:t('cnt.rollbackUpdate'),
    danger:true
  }))return;
  await rollbackLastContentUpdate(sess?.id);
});

if(window.observer&&window.observer.onContentRolledBack){
  window.observer.onContentRolledBack(d=>{
    window.observer.getFiles().then(r=>{
      if(r&&r.ok){state.files=r.files;refreshUI();}
      loadContentUpdates();
    });
    toast(t('toast.rollbackSuccess',{n:d?.rolledBack?.length||1}),'warn');
  });
}

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
    [t('cnt.jumpConfig'),()=>jumpToModConfig(p.name,p.kind),''],
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
// Memory & Performance Optimization: Event Delegation for content lists.
// Replaces hundreds of per-element closures with single listeners on the parent container.
$$(CONTENT_LIST_SEL).forEach(list => {
  const kind = list.id === 'pluginsList' ? 'plugin' : list.id === 'modsList' ? 'mod' : 'datapack';

  list.addEventListener('change', async e => {
    const input = e.target.closest('input[data-toggle-content]');
    if (!input) return;
    const file = input.dataset.toggleFile;
    const k = input.dataset.toggleContent || kind;
    const r = await window.observer.toggleContent({ kind: k, fileName: file });
    if (!r || !r.ok) {
      input.checked = !input.checked;
      return toast((r && r.error) || 'Toggle failed', 'error');
    }
    state.files = r.files;
    refreshUI();
    loadContentConflicts();
  });

  list.addEventListener('click', async e => {
    const cfgBtn = e.target.closest('[data-config-file]');
    if (cfgBtn) {
      jumpToModConfig(cfgBtn.dataset.configFile, kind);
      return;
    }

    const upBtn = e.target.closest('[data-update-content]');
    if (upBtn) {
      const file = upBtn.dataset.updateFile;
      if (!await confirmDialog({
        title: t('cnt.update'),
        body: t('cnt.confirmUpdate', { n: file }),
        ok: t('cnt.update')
      })) return;
      const r = await window.observer.contentUpdate({ names: [file] });
      if (!r || !r.ok) return toast((r && r.error) || t('toast.updateFailed', { n: file }), 'error');
      state.files = r.files || state.files;
      await loadContentUpdates();
      toast(t('toast.updated', { n: file }), 'success', {
        label: t('toast.undo'),
        fn: () => rollbackLastContentUpdate(r.sessionId)
      });
      return;
    }

    const delBtn = e.target.closest('[data-delete-content]');
    if (delBtn) {
      const file = delBtn.dataset.deleteFile;
      if (!await confirmDialog({
        title: t('cnt.delete'),
        body: t('toast.confirmDelete', { n: file }),
        ok: t('cnt.delete'),
        danger: true
      })) return;
      if (state.running && !await confirmDialog({
        title: t('cnt.delete'),
        body: t('cnt.confirmRunningDelete'),
        ok: t('cnt.delete'),
        danger: true
      })) return;
      const r = await window.observer.deleteContent({ kind, fileName: file });
      if (!r || !r.ok) return toast((r && r.error) || 'Delete failed', 'error');
      state.files = r.files;
      refreshUI();
      loadContentConflicts();
      toast(t('toast.deleted', { n: file }), 'success');
      return;
    }

    const valBtn = e.target.closest('[data-validate-dp]');
    if (valBtn) {
      const file = valBtn.dataset.validateDp;
      valBtn.disabled = true;
      let r;
      try { r = await window.observer.contentValidateDatapack(file); } catch (err) {
        valBtn.disabled = false;
        return toast(err?.message || 'Validate failed.', 'error');
      }
      valBtn.disabled = false;
      if (!r || !r.ok) return toast((r && r.error) || 'Validate failed.', 'error');
      const lvl = r.result && r.result.level;
      const note = (r.result && r.result.note) || '';
      toast(note, lvl === 'ok' ? 'success' : lvl === 'warn' ? 'error' : undefined);
      return;
    }

    const extBtn = e.target.closest('[data-extract-dp]');
    if (extBtn) {
      const file = extBtn.dataset.extractDp;
      if (!await confirmDialog({
        title: t('cnt.extract'),
        body: t('cnt.extractConfirm', { n: file }),
        ok: t('cnt.extract')
      })) return;
      let r;
      try { r = await window.observer.contentExtractDatapack(file); } catch (err) {
        return toast(err?.message || 'Extract failed.', 'error');
      }
      if (!r || !r.ok) return toast((r && r.error) || 'Extract failed.', 'error');
      state.files = r.files || state.files;
      refreshUI();
      toast(t('toast.extracted', { n: r.folder }), 'success');
      return;
    }
  });
});