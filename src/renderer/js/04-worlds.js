// js/04-worlds.js — split from app.js (lines 704-725); classic script, load in numeric order.
// Worlds tab: world list + backup list rendering.
function renderWorlds(worlds){
  const n=$('#worldsList');if(!n)return;
  if(!worlds.length){
    n.innerHTML=`<div class="wld-none"><img src="./assets/icons/ui/grid.svg" alt=""><div><b>${t('wld.noneT')}</b><span>${t('wld.noneS')}</span></div><button class="btn secondary sm" data-open-world=".">${t('wld.openFolder')} ↗</button></div>`;
  } else {
    const kindOf=x=>/_the_end$/i.test(x)?{tag:t('wld.tagEnd'),cls:'end'}:/_nether$/i.test(x)?{tag:t('wld.tagNether'),cls:'nether'}:{tag:t('wld.tagOverworld'),cls:'over'};
    n.innerHTML=worlds.map(x=>{
      const k=kindOf(x);
      const isSub=/_the_end$/i.test(x)||/_nether$/i.test(x);
      const extraBtns=isSub?'':`<button class="btn sm secondary" data-rename-world="${esc(x)}">${t('wld.renameBtn')}</button><button class="btn sm secondary" data-seed-world="${esc(x)}">${t('wld.seedTitle')}</button><button class="btn sm danger-ghost" data-reset-dim="${esc(x)}">${t('wld.resetDimBtn')}</button>`;
      return `<div class="entity-card wld-card" title="${esc(x)}"><span class="entity-avatar accent">◫</span><div class="entity-body"><div class="entity-title">${esc(x)}</div><div class="entity-meta"><span class="badge wld-tag-${k.cls}">${esc(k.tag)}</span></div></div><div class="entity-actions">${extraBtns}<button class="btn sm secondary" data-open-world="${esc(x)}">${t('wld.open')}</button></div></div>`;
    }).join('');
  }
  $$('[data-open-world]').forEach(b=>b.onclick=()=>window.observer.openFiles(b.dataset.openWorld));
  $$('[data-rename-world]').forEach(b=>b.onclick=async()=>{
    if(state.running)return toast(t('wld.cantRunning'));
    const curr=b.dataset.renameWorld;
    const next=await promptDialog({title:t('wld.renameTitle'),value:curr,ok:t('wld.renameBtn')});
    if(!next||next===curr)return;
    const r=await window.observer.worldRename(curr,next);
    if(!r.ok)return toast(r.error||'Failed');
    toast(t('wld.renamedSuccess'));
    state.files=r.files;refreshUI();
  });
  $$('[data-seed-world]').forEach(b=>b.onclick=async()=>{
    if(state.running)return toast(t('wld.cantRunning'));
    const w=b.dataset.seedWorld;
    const nextSeed=await promptDialog({title:t('wld.seedTitle'),placeholder:t('wld.seedPlaceholder'),ok:t('wld.seedSave')});
    if(nextSeed===null||nextSeed===undefined||!nextSeed.trim())return;
    const r=await window.observer.worldSetSeed(w,nextSeed.trim());
    if(!r.ok)return toast(r.error||'Failed');
    toast(t('wld.seedSuccess',{s:r.seed}));
  });
  $$('[data-reset-dim]').forEach(b=>b.onclick=async()=>{
    if(state.running)return toast(t('wld.cantRunning'));
    const w=b.dataset.resetDim;
    const choice=await promptDialog({title:t('wld.resetDimTitle'),placeholder:'nether or end',ok:t('wld.resetDimBtn')});
    if(!choice)return;
    const dim=choice.toLowerCase().trim();
    if(dim!=='nether'&&dim!=='end')return toast(t('wld.invalidDim'));
    if(!await confirmDialog({title:t('wld.resetDimTitle'),body:t('wld.resetDimConfirm',{d:dim}),ok:t('wld.resetDimBtn'),danger:true}))return;
    const r=await window.observer.worldDeleteDimension(w,dim);
    if(!r.ok)return toast(r.error||'Failed');
    toast(t('wld.resetDimSuccess'));
    refreshUI();
  });
  const wc=$('#worldsCountPill'); if(wc) wc.textContent=String(worlds.length);
}
function fmtBytes(n){if(!n)return '0 MB';const mb=n/1024/1024;return mb>=1024?`${(mb/1024).toFixed(2)} GB`:`${mb.toFixed(1)} MB`}
function fmtBackupDate(mtime){if(!mtime)return t('wld.unknownDate');const d=new Date(mtime);return d.toLocaleDateString(undefined,{day:'numeric',month:'short'})+', '+d.toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'})}
function renderBackups(items){
  const n=$('#backupsList');if(!n)return;
  const totalEl=$('#backupsTotal');
  if(totalEl){ if(items.length){ totalEl.hidden=false; totalEl.textContent=t('wld.backupsTotal',{n:items.length,s:fmtBytes(items.reduce((s,x)=>s+(x.size||0),0))}); } else { totalEl.hidden=true; totalEl.textContent=''; } }
  // Timeline rows, newest first (server-files sorts desc). First entry gets the LATEST treatment.
  n.innerHTML=items.length?items.map((x,i)=>`<div class="bk-row${i===0?' latest':''}"><span class="bk-dot"></span><div class="bk-main"><b>${esc(fmtBackupDate(x.mtime))}</b><small title="${esc(x.name)}">${esc(x.name)}</small></div>${i===0?`<em class="bk-flag">${t('wld.latest')}</em>`:''}<span class="bk-size">${esc(fmtBytes(x.size))}</span><div class="bk-actions"><button class="btn sm secondary" data-restore="${esc(x.name)}">${t('wld.restore')}</button><button class="btn sm danger-ghost" data-delete="${esc(x.name)}">${t('wld.delete')}</button></div></div>`).join(''):'';
  $$('[data-restore]').forEach(b=>b.onclick=async()=>{if(!await confirmDialog({title:t('wld.restore'),body:t('toast.confirmRestore',{n:b.dataset.restore}),ok:t('wld.restore')}))return;const r=await window.observer.restoreBackup(b.dataset.restore);if(!r.ok)return toast(r.error);state.files=r.files;refreshUI();toast(t('toast.backupRestored'))});
  $$('[data-delete]').forEach(b=>b.onclick=async()=>{if(!await confirmDialog({title:t('wld.delete'),body:t('wld.confirmDelete'),ok:t('wld.delete'),danger:true}))return;const r=await window.observer.deleteBackup(b.dataset.delete);if(!r.ok)return toast(r.error);state.files=r.files;refreshUI();toast(t('toast.backupDeleted'))});
}
// The empty state's own Create button routes to the same handler as the header one.
$$('[data-create-backup]').forEach(b=>b.onclick=()=>$('#createBackup')?.click());
