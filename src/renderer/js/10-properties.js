// js/10-properties.js — split out of 08-shell.js; classic script, load AFTER 08-shell.js.
// Server properties tab: live search + group filter, and saving server.properties / velocity.toml.
// Search + group chips share one filter pass: text matches highlight and auto-open collapsed
// groups; the active chip narrows which groups are shown at all.
let propGroupFilter='all';
// 5.4.0: mirror propsDirty onto the Apply button (same .dirty cue as Settings). propsDirty alone
// only suppressed re-renders, so the button never showed that there were unsaved edits.
function updatePropsDirty(){const b=$('#saveProperties');if(b)b.classList.toggle('dirty',propsDirty)}
function applyPropFilters(){
  const qRaw=$('#propertiesSearch').value.trim();
  const q=qRaw.toLowerCase();
  $$('.prop-group').forEach(g=>{
    const passGroup=propGroupFilter==='all'||propGroupFilter===g.dataset.groupId;
    let anyVisible=false;
    g.querySelectorAll('[data-prop-row]').forEach(row=>{
      const match=!q||row.dataset.propSearch.toLowerCase().includes(q);
      row.hidden=!match;
      if(match)anyVisible=true;
      const label=row.querySelector('.prop-label');
      if(label){
        const orig=label.dataset.orig || (label.dataset.orig=label.innerHTML);
        if(qRaw && match){
          const regex=new RegExp(`(${qRaw.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})`,'gi');
          label.innerHTML=orig.replace(regex,'<mark>$1</mark>');
        } else label.innerHTML=orig;
      }
      if(match&&q){const det=row.closest('details');if(det)det.open=true}
    });
    g.hidden=!passGroup||!anyVisible;
  });
  const noResults=$('#propertiesNoResults'); if(noResults){ const anyVisible=$$('.prop-group:not([hidden])').length>0; noResults.hidden=!q || anyVisible; const qEl=$('#propertiesNoResultsQuery'); if(qEl) qEl.textContent=qRaw; }
}
$('#propertiesSearch').addEventListener('input',applyPropFilters);
$$('[data-prop-filter]').forEach(c=>c.onclick=()=>{
  propGroupFilter=c.dataset.propFilter;
  $$('[data-prop-filter]').forEach(x=>{const on=x===c;x.classList.toggle('active',on);x.setAttribute('aria-pressed',on?'true':'false')});
  applyPropFilters();
});
// Track unsaved edits in both property editors (see propsDirty above). Programmatic value writes in
// renderProperties/refreshProxyProperties don't fire these, so this only trips on real edits.
// 5.4.0 BUGFIX: text fields fire 'input', but the enum dropdown (ol-select) and the boolean switch
// only fire 'change' — listening to 'input' alone meant picking a new difficulty/gamemode or toggling
// a switch never marked the form dirty, so the Apply pulse never appeared (and a background
// refreshUI could then re-render the grid and drop the edit). Listen to BOTH.
const markPropsDirty=e=>{const el=e.target;if(!el||!(el.closest?.('#propertiesGrid')||el.id==='propertiesRaw'))return;
  // v6.0.0 G1: live MOTD preview. When the motd field changes, re-render its preview span in place
  // (no grid rebuild, so the input keeps focus and caret).
  if(el.dataset&&el.dataset.property==='motd'){const pv=el.closest('[data-prop-row]')?.querySelector('[data-motd-preview]');if(pv)pv.innerHTML=renderMotdPreview(el.value);}
  // Compare against the last snapshot so returning a field to its original value clears the cue.
  let cur=null;try{cur=snapshotPropsForm()}catch{}
  propsDirty=_propsBaseline===null?true:(cur!==_propsBaseline);
  updatePropsDirty();
};
document.addEventListener('input',markPropsDirty);
document.addEventListener('change',markPropsDirty);
// v6.0.2: click handler for MOTD color and format chips
document.addEventListener('click',e=>{
  const chip=e.target.closest('[data-motd-code]');
  if(!chip)return;
  const row=chip.closest('[data-prop-row]');
  const input=row?.querySelector('input[data-property="motd"]');
  if(!input)return;
  e.preventDefault();
  const code=chip.dataset.motdCode;
  const start=input.selectionStart??input.value.length;
  const end=input.selectionEnd??input.value.length;
  input.value=input.value.slice(0,start)+code+input.value.slice(end);
  input.selectionStart=input.selectionEnd=start+code.length;
  input.focus();
  input.dispatchEvent(new Event('input',{bubbles:true}));
});
// v6.0.0 G2: server.properties history modal — list snapshots, show a line diff, restore one.
let _propHistSel=null;
function openPropHistory(){
  const m=$('#propHistoryModal'); if(!m) return; m.hidden=false; void m.offsetWidth; trapFocus(m);
  _propHistSel=null;
  const restore=$('#propHistoryRestore'); if(restore)restore.disabled=true;
  const d=$('#propHistoryDiff'); if(d){d.hidden=true;d.innerHTML=''}
  const list=$('#propHistoryList'); if(list)list.innerHTML=`<p class="text-muted">${esc(t('prop.historyLoading'))}</p>`;
  window.observer.propertiesHistory().then(r=>{
    if(!list)return;
    if(!r||!r.ok){list.innerHTML=`<p class="text-muted">${esc((r&&r.error)||t('prop.historyEmpty'))}</p>`;return}
    const snaps=r.snapshots||[];
    if(!snaps.length){list.innerHTML=`<p class="text-muted">${esc(t('prop.historyEmpty'))}</p>`;return}
    list.innerHTML=snaps.map(s=>`<button type="button" class="prop-hist-row" data-t="${s.t}"><span>${esc(new Date(s.t).toLocaleString())}</span><small>${s.size} B</small></button>`).join('');
  }).catch(()=>{ if(list)list.innerHTML=`<p class="text-muted">${esc(t('prop.historyEmpty'))}</p>` });
}
function closePropHistory(){const m=$('#propHistoryModal');if(!m||m.hidden)return;releaseFocus();m.hidden=true;}
// v6.0.0 G5: save the current server config as a reusable template.
$('#saveAsTemplateBtn')?.addEventListener('click',()=>withBusy($('#saveAsTemplateBtn'),async()=>{
  if(isProxyServer())return toast(t('prop.tplProxy'),'error');
  const name=await promptDialog({title:t('prop.saveAsTemplate'),placeholder:t('prop.tplNamePh')});
  if(!name)return;
  const properties={};
  $$('[data-property]').forEach(input=>{properties[input.dataset.property]=input.type==='checkbox'?(input.checked?'true':'false'):input.value.trim()});
  const jar=(state.files&&state.files.jar)||'';
  const sw=/paper/i.test(jar)?'paper':/purpur/i.test(jar)?'purpur':/fabric/i.test(jar)?'fabric':/neoforge/i.test(jar)?'neoforge':/forge/i.test(jar)?'forge':/leaf/i.test(jar)?'leaf':'vanilla';
  const r=await window.observer.templatesSave({name,software:sw,memoryGB:Number($('#memoryMaxInput')?.value)||4,port:Number(properties['server-port'])||25565,properties});
  if(!r||!r.ok)return toast((r&&r.error)||t('prop.tplFail'),'error');
  toast(t('prop.tplSaved',{n:name}),'success');
}));
$('#propHistoryBtn')?.addEventListener('click',openPropHistory);
$('#propHistoryClose')?.addEventListener('click',closePropHistory);
$('#propHistoryModal')?.addEventListener('click',e=>{if(e.target.id==='propHistoryModal')closePropHistory()});
$('#propHistoryList')?.addEventListener('click',async e=>{
  const b=e.target.closest('[data-t]'); if(!b) return;
  const t0=Number(b.dataset.t); _propHistSel=t0;
  $$('#propHistoryList .prop-hist-row').forEach(x=>x.classList.toggle('active',x===b));
  const restore=$('#propHistoryRestore'); if(restore)restore.disabled=false;
  const d=$('#propHistoryDiff'); if(!d)return;
  d.hidden=false; d.innerHTML=`<p class="text-muted">${esc(t('prop.historyLoading'))}</p>`;
  try{
    const r=await window.observer.propertiesDiff(t0);
    if(!r||!r.ok){d.innerHTML=`<p class="text-muted">${esc((r&&r.error)||'—')}</p>`;return}
    const diff=r.diff;
    d.innerHTML=(diff.added||diff.removed?`<p class="text-muted">+${diff.added} / -${diff.removed}</p>`:'')+'<pre class="prop-hist-diff">'+diff.lines.map(l=>`<span class="dl ${l.type==='+'?'add':l.type==='-'?'del':''}">${esc(l.type+l.text)}</span>`).join('')+'</pre>';
  }catch{d.innerHTML=`<p class="text-muted">—</p>`}
});
$('#propHistoryRestore')?.addEventListener('click',()=>withBusy($('#propHistoryRestore'),async()=>{
  if(_propHistSel==null)return;
  if(!await confirmDialog({title:t('prop.historyRestore'),body:esc(t('prop.historyRestoreConfirm')),ok:t('prop.historyRestore'),danger:true}))return;
  const r=await window.observer.propertiesRestore(_propHistSel);
  if(!r||!r.ok)return toast((r&&r.error)||t('prop.historyRestoreFail'),'error');
  toast(t('prop.historyRestored'),'success'); closePropHistory();
  try{ const s=await window.observer.getState(); state={...state,...s}; refreshUI(); }catch{}
}));
$('#saveProperties').onclick=()=>withBusy($('#saveProperties'),async()=>{
  if(isProxyServer()){
    const raw=$('#propertiesRaw').value;
    if(raw.length>200000) return toast(t('toast.tomlBig'),'error');
    const r=await window.observer.saveRawProperties(raw);if(r.ok){capturePropsBaseline();propsDirty=false;updatePropsDirty()}return r.ok?toast(t('toast.tomlSaved'),'success'):toast(r.error||t('toast.propsFolder'),'error');
  }
  const p={}; let firstInvalid=null;
  const validators={
    'max-players':v=>{ const n=Number(v); if(!Number.isInteger(n)||n<1||n>100000) return t('propErr.max-players'); },
    'server-port':v=>{ const n=Number(v); if(!Number.isInteger(n)||n<1||n>65535) return t('propErr.server-port'); },
    'view-distance':v=>{ const n=Number(v); if(!Number.isInteger(n)||n<2||n>32) return t('propErr.view-distance'); },
    'simulation-distance':v=>{ const n=Number(v); if(!Number.isInteger(n)||n<2||n>32) return t('propErr.simulation-distance'); },
    'max-world-size':v=>{ const n=Number(v); if(!Number.isInteger(n)||n<1||n>29999984) return t('propErr.max-world-size'); },
  };
  $$('[data-property]').forEach(input=>{
    const key=input.dataset.property;
    // Boolean properties render as switches — checkboxes carry "on"/"" as .value, so translate.
    const val=input.type==='checkbox'?(input.checked?'true':'false'):input.value.trim();
    p[key]=val;
    const fn=validators[key];
    if(fn){
      const err=fn(val);
      input.style.borderColor=err?'var(--danger)':'';
      if(err && !firstInvalid){ firstInvalid=input; toast(err,'error'); }
    } else {
      input.style.borderColor='';
    }
  });
  if(firstInvalid){ firstInvalid.focus(); return; }
  const r=await window.observer.saveProperties(p);if(r.ok){capturePropsBaseline();propsDirty=false;updatePropsDirty();state.files.properties=p;loadConnectInfo();toast(t('toast.propsSaved'),'success')}else toast(friendlyError(r.error)||t('toast.propsFolder'),'error')
});
