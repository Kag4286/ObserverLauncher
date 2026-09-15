// js/01-content.js — split from app.js (lines 88-295); classic script, load in numeric order.
// Content tab: file list empty-states + in-place file editor.
// UX rework: friendly per-kind empty states with a one-click jump to the Marketplace (pre-filtered
// by the loader this server actually uses), and flat hover rows with a reveal-on-hover Delete.
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
      node.querySelectorAll('[data-empty-import]').forEach(b=>b.onclick=()=>window.observer.importContent(kind).then(r=>{ if(r.ok){state.files=r.files;refreshUI();toast(t('toast.imported'),'success')}else if(!r.cancelled) toast(r.error,'error'); }));
      node.querySelectorAll('[data-market-jump]').forEach(b=>b.onclick=()=>jumpToMarket(b.dataset.marketJump));
    }
    return;
  }
  node.innerHTML=files.map(x=>`<li title="${esc(x)}"><span class="file-name">${esc(x)}</span><button class="text-btn danger" data-delete-content="${esc(kind)}" data-delete-file="${esc(x)}" aria-label="${esc(t('cnt.delete'))} ${esc(x)}">${esc(t('cnt.delete'))}</button></li>`).join('');
  node.querySelectorAll('[data-delete-content]').forEach(b=>b.onclick=async()=>{const file=b.dataset.deleteFile;if(!confirm(t('toast.confirmDelete',{n:file})))return;const r=await window.observer.deleteContent({kind,fileName:file});if(!r.ok)return toast(r.error,'error');state.files=r.files;refreshUI();toast(t('toast.deleted',{n:file}),'success')})
}
// ============ FILE EDITOR (Content tab, in-place: bays ↔ browser ↔ editor) ============
let edState={rel:null,content:'',mtime:0,readOnly:false,dirty:false,wrap:false,from:'bays',conflict:false,files:[],fbOpen:new Set()};
function edShow(view){$('#contentBays').hidden=view!=='bays';$('#fileBrowser').hidden=view!=='browser';$('#fileEditor').hidden=view!=='editor'}
function edFmtBytes(n){if(!n&&n!==0)return'—';if(n<1024)return n+' B';if(n<1048576)return (n/1024).toFixed(1)+' KB';return (n/1048576).toFixed(2)+' MB'}
function edUpdateStats(){
  const v=$('#edText').value;
  const lines=v===''?0:v.split('\n').length;
  const bytes=new TextEncoder().encode(v).length;
  $('#edStats').textContent=v===''?t('ed.emptyFile'):t('ed.lines',{a:lines,b:edFmtBytes(bytes)});
  const info=$('#edSavedInfo');
  if(edState.dirty){info.textContent=t('ed.unsaved');info.className='ed-savedinfo ed-dirty'}
  else{info.textContent=t('ed.saved');info.className='ed-savedinfo ed-clean'}
  $('#edDot').hidden=!edState.dirty;
  $('#edSave').disabled=edState.readOnly||!edState.dirty;
}
function edMarkDirty(){edState.dirty=true;edUpdateStats()}
async function openEd(rel,from){
  const r=await window.observer.editorOpen(rel);
  if(!r||!r.ok){
    if(r&&r.error==='tooBig')toast(t('ed.tooBig',{a:edFmtBytes(r.size)}),'error');
    else if(r&&r.error==='binary')toast(t('ed.binary'),'error');
    else toast(t('ed.notFound'),'error');
    return;
  }
  edState={rel:r.rel,content:r.content,mtime:r.mtime,readOnly:!!r.readOnly,dirty:false,wrap:edState.wrap,from,conflict:false,files:edState.files,fbOpen:edState.fbOpen};
  const ta=$('#edText');ta.value=r.content;ta.readOnly=edState.readOnly;
  ta.classList.toggle('wrap-on',edState.wrap);ta.setAttribute('wrap',edState.wrap?'soft':'off');
  $('#edPath').textContent=r.rel;
  $('#edExt').textContent=(r.rel.split('.').pop()||'txt').toUpperCase();
  $('#edReadOnly').hidden=!edState.readOnly;
  $('#edSave').hidden=edState.readOnly;
  $('#edFormat').hidden=!(r.rel.toLowerCase().endsWith('.json')&&!edState.readOnly);
  $('#edRunning').hidden=!state.running;
  $('#edConflict').hidden=true;
  edUpdateStats();
  edRefreshView();
  edShow('editor');
  ta.scrollTop=0;ta.focus();
}
function closeEd(){
  if(edState.dirty&&!confirm(t('ed.confirmCloseDirty')))return;
  edShow(edState.from==='browser'?'browser':'bays');
  edState={...edState,rel:null,dirty:false,conflict:false};
}
async function saveEd(){
  if(edState.readOnly||!edState.rel)return;
  const r=await window.observer.editorSave({rel:edState.rel,content:$('#edText').value,baseMtime:edState.mtime,force:edState.conflict});
  if(!r||!r.ok){
    if(r&&r.conflict){edState.conflict=true;$('#edConflict').hidden=false;toast(t('ed.conflict'),'error');return}
    if(r&&r.error==='tooBigSave'){toast(t('ed.tooBigSave'),'error');return}
    toast(t('ed.notFound'),'error');return;
  }
  edState.mtime=r.mtime;edState.conflict=false;edState.content=$('#edText').value;
  $('#edConflict').hidden=true;
  edState.dirty=false;edUpdateStats();
  toast(t('ed.saved'),'success');
}
function formatEd(){
  if(!edState.rel||!edState.rel.toLowerCase().endsWith('.json'))return;
  const ta=$('#edText');
  try{ta.value=JSON.stringify(JSON.parse(ta.value),null,2);edMarkDirty();edScheduleView();ta.scrollTop=0}
  catch{toast(t('ed.invalidJson'),'error')}
}
function reloadEd(){
  if(edState.dirty&&!confirm(t('ed.confirmReloadDirty')))return;
  edState.conflict=false;$('#edConflict').hidden=true;
  openEd(edState.rel,edState.from);
}
async function openFileBrowser(){
  edShow('browser');
  $('#fbList').innerHTML='<li class="empty"><span>…</span></li>';
  const r=await window.observer.editorList();
  edState.files=(r&&r.files)||[];
  renderFbList();
}
// Build a nested tree from the flat {path,size} list so the browser shows collapsible folders
// instead of one enormous flat list (a real server folder can have 500+ editable files).
function buildFileTree(files){
  const root={name:'',dirs:new Map(),files:[]};
  for(const f of files){
    const parts=f.path.split('/');
    let node=root;
    for(let i=0;i<parts.length-1;i++){
      const seg=parts[i];
      if(!node.dirs.has(seg))node.dirs.set(seg,{name:seg,dirs:new Map(),files:[]});
      node=node.dirs.get(seg);
    }
    node.files.push({name:parts[parts.length-1],rel:f.path,size:f.size});
  }
  return root;
}
function fbDirRow(node,prefix,depth){
  const open=edState.fbOpen.has(prefix);
  const count=countTreeFiles(node);
  return `<div class="fb-row fb-dir${open?' open':''}" data-dir="${esc(prefix)}" style="padding-left:${8+depth*16}px"><span class="fb-caret">${open?'▾':'▸'}</span><span class="file-name">${esc(node.name)}</span><span class="fb-size">${count}</span></div>`;
}
function countTreeFiles(node){
  let n=node.files.length;
  for(const c of node.dirs.values())n+=countTreeFiles(c);
  return n;
}
function renderTree(node,depth,prefix,out){
  // folders first (alphabetical), then files
  const dirs=[...node.dirs.values()].sort((a,b)=>a.name.localeCompare(b.name));
  const files=node.files.slice().sort((a,b)=>a.name.localeCompare(b.name));
  for(const d of dirs){
    const p=prefix?prefix+'/'+d.name:d.name;
    out.push(fbDirRow(d,p,depth));
    if(edState.fbOpen.has(p))renderTree(d,depth+1,p,out);
  }
  for(const f of files){
    out.push(`<div class="fb-row" data-rel="${esc(f.rel)}" title="${esc(f.rel)}" style="padding-left:${8+(depth+1)*16}px"><span class="file-name">${esc(f.name)}</span><span class="fb-size">${edFmtBytes(f.size)}</span></div>`);
  }
}
function renderFbList(){
  const q=$('#fbSearch').value.trim().toLowerCase();
  const box=$('#fbList');
  if(q){
    // Search stays flat: show every matching path in full so a known filename is one glance away.
    const list=edState.files.filter(f=>f.path.toLowerCase().includes(q));
    $('#fbCount').textContent=t('ed.filesCount',{a:list.length});
    box.innerHTML=list.length?list.map(f=>`<div class="fb-row" data-rel="${esc(f.path)}" title="${esc(f.path)}"><span class="file-name">${esc(f.path)}</span><span class="fb-size">${edFmtBytes(f.size)}</span></div>`).join(''):`<li class="empty"><span>${t('ed.noFiles')}</span></li>`;
  } else {
    $('#fbCount').textContent=t('ed.filesCount',{a:edState.files.length});
    // Defensive: if fbOpen was ever lost (edState rebuilt) or a file has an odd path, fall back
    // to the flat list instead of leaving the browser stuck on the loading placeholder.
    if(!(edState.fbOpen instanceof Set))edState.fbOpen=new Set();
    let out=[];
    try { renderTree(buildFileTree(edState.files),0,'',out); }
    catch(e){ console.error('file tree render failed, falling back to flat list:',e); out=[]; }
    box.innerHTML=out.length?out.join(''):(edState.files.length
      ? edState.files.map(f=>`<div class="fb-row" data-rel="${esc(f.path)}" title="${esc(f.path)}"><span class="file-name">${esc(f.path)}</span><span class="fb-size">${edFmtBytes(f.size)}</span></div>`).join('')
      : `<li class="empty"><span>${t('ed.noFiles')}</span></li>`);
  }
  box.querySelectorAll('.fb-row[data-rel]').forEach(row=>row.onclick=()=>openEd(row.dataset.rel,'browser'));
  box.querySelectorAll('.fb-row[data-dir]').forEach(row=>row.onclick=()=>{
    const d=row.dataset.dir;
    if(edState.fbOpen.has(d))edState.fbOpen.delete(d);else edState.fbOpen.add(d);
    renderFbList();
  });
}
$('#edBrowse').onclick=openFileBrowser;
$('#edBrowse').addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openFileBrowser()}});
$('#fbBack').onclick=()=>edShow('bays');
$('#fbSearch').addEventListener('input',renderFbList);
$('#edBack').onclick=closeEd;
$('#edSave').onclick=saveEd;
$('#edFormat').onclick=formatEd;
$('#edReload').onclick=reloadEd;
$('#edReload2').onclick=reloadEd;
$('#edOverwrite').onclick=()=>{edState.conflict=true;$('#edConflict').hidden=true;saveEd()};
$('#edWrap').onclick=()=>{edState.wrap=!edState.wrap;const ta=$('#edText');ta.classList.toggle('wrap-on',edState.wrap);$('#edHl').classList.toggle('wrap-on',edState.wrap);ta.setAttribute('wrap',edState.wrap?'soft':'off');edRefreshView()};
$('#edText').addEventListener('input',()=>{edMarkDirty();edScheduleView()});
$('#edText').addEventListener('scroll',edSyncScroll);
$('#edText').addEventListener('keydown',e=>{
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();saveEd();return}
  if(e.key==='Tab'){e.preventDefault();const ta=e.target,s=ta.selectionStart,en=ta.selectionEnd;ta.setRangeText('  ',s,en,'end');edMarkDirty();edScheduleView()}
});
// --- highlight / gutter / json validity ---
function edEsc(s){return s.replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))}
function edHlJson(code){
  let out='',last=0,m;
  const re=/("(?:[^"\\]|\\.)*")(\s*:)?|\b-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b|\btrue\b|\bfalse\b|\bnull\b/g;
  while((m=re.exec(code))){
    out+=edEsc(code.slice(last,m.index));
    if(m[1])out+=m[2]?`<span class="tok-key">${edEsc(m[1])}</span>${edEsc(m[2])}`:`<span class="tok-str">${edEsc(m[1])}</span>`;
    else out+=`<span class="tok-num">${edEsc(m[0])}</span>`;
    last=re.lastIndex;
  }
  return out+edEsc(code.slice(last));
}
function edHlValue(v){
  const t=v.trim();
  if(/^(true|false|yes|no|on|off|null|~)$/i.test(t))return `<span class="tok-bool">${edEsc(v)}</span>`;
  if(/^-?\d+(\.\d+)?$/.test(t))return `<span class="tok-num">${edEsc(v)}</span>`;
  if(/^".*"$/.test(t)||/^'.*'$/.test(t))return `<span class="tok-str">${edEsc(v)}</span>`;
  return edEsc(v);
}
function edHlLine(code,mode){
  return code.split('\n').map(line=>{
    const t=line.trim();
    if(!t)return edEsc(line);
    if(t.startsWith('#')||t.startsWith('!'))return `<span class="tok-com">${edEsc(line)}</span>`;
    if(mode==='toml'&&/^\[[^\]]*\]$/.test(t))return `<span class="tok-sec">${edEsc(line)}</span>`;
    const kv=line.match(/^(\s*-?\s*)([^:#=\[]{1,120}?)(\s*[:=]\s*)(.*)$/);
    if(kv)return `${edEsc(kv[1])}<span class="tok-key">${edEsc(kv[2])}</span>${edEsc(kv[3])}${edHlValue(kv[4])}`;
    if(mode==='yaml'&&/^\s*-\s/.test(line)){const i=line.indexOf('-')+1;return `<span class="tok-punc">${edEsc(line.slice(0,i))}</span>${edHlValue(line.slice(i))}`}
    return edEsc(line);
  }).join('\n');
}
function edHlJs(code){
  let out='',last=0,m;
  const re=/(\/\/.*$)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|\b(const|let|var|function|return|if|else|for|while|true|false|null|new|class|import|export|from|await|async)\b/gm;
  while((m=re.exec(code))){
    out+=edEsc(code.slice(last,m.index));
    if(m[1])out+=`<span class="tok-com">${edEsc(m[1])}</span>`;
    else if(m[2])out+=`<span class="tok-str">${edEsc(m[2])}</span>`;
    else out+=`<span class="tok-kw">${edEsc(m[3])}</span>`;
    last=re.lastIndex;
  }
  return out+edEsc(code.slice(last));
}
function edHighlightSrc(code,ext){
  if(ext==='json')return edHlJson(code);
  if(ext==='yml'||ext==='yaml')return edHlLine(code,'yaml');
  if(ext==='properties'||ext==='conf'||ext==='cfg'||ext==='lang')return edHlLine(code,'props');
  if(ext==='toml')return edHlLine(code,'toml');
  if(ext==='js')return edHlJs(code);
  return edEsc(code);
}
let edViewRaf=0;
function edScheduleView(){if(edViewRaf)return;edViewRaf=requestAnimationFrame(()=>{edViewRaf=0;edRefreshView()})}
function edRefreshView(){
  const ta=$('#edText');
  const ext=(edState.rel||'').split('.').pop().toLowerCase();
  $('#edHl').innerHTML=edHighlightSrc(ta.value,ext)+(ta.value.endsWith('\n')?'\n':'');
  const lines=ta.value===''?0:ta.value.split('\n').length;
  let g='';for(let i=1;i<=lines;i++)g+=i+'\n';
  const gu=$('#edGutter');gu.textContent=g||'1';gu.style.display=edState.wrap?'none':'';
  edSyncScroll();
  edJsonCheck();
}
function edSyncScroll(){const ta=$('#edText'),hl=$('#edHl'),gu=$('#edGutter');hl.scrollTop=ta.scrollTop;hl.scrollLeft=ta.scrollLeft;gu.scrollTop=ta.scrollTop}
let edJsonTimer=0;
function edJsonCheck(){
  const el=$('#edJsonState');if(!el)return;
  clearTimeout(edJsonTimer);
  if(!edState.rel||!edState.rel.toLowerCase().endsWith('.json')){el.hidden=true;return}
  edJsonTimer=setTimeout(()=>{
    const v=$('#edText').value;
    try{JSON.parse(v);el.textContent='✓ JSON';el.className='ed-json ok';el.hidden=false}
    catch(e){
      let line='?';
      const pm=/position (\d+)/.exec(e.message);
      const lm=/line (\d+)/.exec(e.message);
      if(lm)line=lm[1];else if(pm)line=v.slice(0,+pm[1]).split('\n').length;
      el.textContent=`✗ JSON · ${t('ply.page')} ${line}`;el.className='ed-json bad';el.hidden=false;
    }
  },300);
}
// external-change watcher: auto-reload when clean, conflict banner when dirty
