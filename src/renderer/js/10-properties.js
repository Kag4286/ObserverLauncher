// js/10-properties.js — split out of 08-shell.js; classic script, load AFTER 08-shell.js.
// Server properties tab: live search + group filter, and saving server.properties / velocity.toml.
// Search + group chips share one filter pass: text matches highlight and auto-open collapsed
// groups; the active chip narrows which groups are shown at all.
let propGroupFilter='all';
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
// renderProperties/refreshProxyProperties don't fire 'input', so this only trips on real typing.
document.addEventListener('input',e=>{const el=e.target;if(el&&(el.closest?.('#propertiesGrid')||el.id==='propertiesRaw'))propsDirty=true});
$('#saveProperties').onclick=async()=>{
  if(isProxyServer()){
    const raw=$('#propertiesRaw').value;
    if(raw.length>200000) return toast('velocity.toml is too large (>200KB) — check for accidental paste','error');
    const r=await window.observer.saveRawProperties(raw);if(r.ok)propsDirty=false;return r.ok?toast('velocity.toml saved. Restart the proxy to apply changes.','success'):toast(r.error||'Choose and apply a server folder first.','error');
  }
  const p={}; let firstInvalid=null;
  const validators={
    'max-players':v=>{ const n=Number(v); if(!Number.isInteger(n)||n<1||n>100000) return 'Max players must be an integer 1–100000'; },
    'server-port':v=>{ const n=Number(v); if(!Number.isInteger(n)||n<1||n>65535) return 'Server port must be 1–65535'; },
    'view-distance':v=>{ const n=Number(v); if(!Number.isInteger(n)||n<2||n>32) return 'View distance must be 2–32'; },
    'simulation-distance':v=>{ const n=Number(v); if(!Number.isInteger(n)||n<2||n>32) return 'Simulation distance must be 2–32'; },
    'max-world-size':v=>{ const n=Number(v); if(!Number.isInteger(n)||n<1||n>29999984) return 'Max world size must be 1–29999984'; },
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
  const r=await window.observer.saveProperties(p);if(r.ok){propsDirty=false;state.files.properties=p;loadConnectInfo();toast('server.properties updated. Restart server to apply most changes.','success')}else toast('Choose and apply a server folder first.','error')
};
