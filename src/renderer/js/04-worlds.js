// js/04-worlds.js — split from app.js (lines 704-725); classic script, load in numeric order.
// Worlds tab: world list + backup list rendering.
function renderWorlds(worlds){
  const n=$('#worldsList');if(!n)return;
  if(!worlds.length){
    n.innerHTML=`<div class="wld-none"><img src="./assets/icons/ui/grid.svg" alt=""><div><b>${t('wld.noneT')}</b><span>${t('wld.noneS')}</span></div><button class="btn secondary sm" data-open-world=".">${t('wld.openFolder')} ↗</button></div>`;
  } else {
    const kindOf=x=>/_the_end$/i.test(x)?{tag:'THE END',icon:'grid'}:/_nether$/i.test(x)?{tag:'NETHER',icon:'shield'}:{tag:'OVERWORLD',icon:'cube'};
    n.innerHTML=worlds.map(x=>{const k=kindOf(x);return `<div class="wld-row" title="${esc(x)}"><img class="wld-row-icon" src="./assets/icons/ui/${k.icon}.svg" alt=""><div class="wld-row-main"><b>${esc(x)}</b><small>${k.tag}</small></div><button class="text-btn" data-open-world="${esc(x)}">Open ↗</button></div>`}).join('');
  }
  $$('[data-open-world]').forEach(b=>b.onclick=()=>window.observer.openFiles(b.dataset.openWorld));
  const wc=$('#worldsCountPill'); if(wc) wc.textContent=String(worlds.length);
}
function fmtBytes(n){if(!n)return '0 MB';const mb=n/1024/1024;return mb>=1024?`${(mb/1024).toFixed(2)} GB`:`${mb.toFixed(1)} MB`}
function fmtBackupDate(mtime){if(!mtime)return 'unknown date';const d=new Date(mtime);return d.toLocaleDateString(undefined,{day:'numeric',month:'short'})+', '+d.toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'})}
function renderBackups(items){
  const n=$('#backupsList');if(!n)return;
  const totalEl=$('#backupsTotal');
  if(totalEl){ if(items.length){ totalEl.hidden=false; totalEl.textContent=`${items.length} backup${items.length===1?'':'s'} · ${fmtBytes(items.reduce((s,x)=>s+(x.size||0),0))} on disk`; } else { totalEl.hidden=true; totalEl.textContent=''; } }
  // Timeline rows, newest first (server-files sorts desc). First entry gets the LATEST treatment.
  n.innerHTML=items.length?items.map((x,i)=>`<div class="bk-row${i===0?' latest':''}"><span class="bk-dot"></span><div class="bk-main"><b>${esc(fmtBackupDate(x.mtime))}</b><small title="${esc(x.name)}">${esc(x.name)}</small></div>${i===0?'<em class="bk-flag">LATEST</em>':''}<span class="bk-size">${esc(fmtBytes(x.size))}</span><div class="bk-actions"><button class="btn sm secondary" data-restore="${esc(x.name)}">Restore</button><button class="btn sm danger-ghost" data-delete="${esc(x.name)}">Delete</button></div></div>`).join(''):'';
  $$('[data-restore]').forEach(b=>b.onclick=async()=>{if(!await confirmDialog({title:t('wld.restore'),body:t('toast.confirmRestore',{n:b.dataset.restore}),ok:t('wld.restore')}))return;const r=await window.observer.restoreBackup(b.dataset.restore);if(!r.ok)return toast(r.error);state.files=r.files;refreshUI();toast(t('toast.backupRestored'))});
  $$('[data-delete]').forEach(b=>b.onclick=async()=>{if(!await confirmDialog({title:t('wld.delete'),body:`Permanently delete this backup? This cannot be undone.`,ok:t('wld.delete'),danger:true}))return;const r=await window.observer.deleteBackup(b.dataset.delete);if(!r.ok)return toast(r.error);state.files=r.files;refreshUI();toast(t('toast.backupDeleted'))});
}
