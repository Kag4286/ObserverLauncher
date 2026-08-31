const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
// FEATURE: minimal i18n — data-i18n / data-i18n-placeholder attributes are swapped from window.LOCALES
// on locale change; falls back to English for any key missing in the active locale.
let currentLocale = 'en';
const _missingI18nLogged=new Set();
function t(key,repl){
  const val=(window.LOCALES?.[currentLocale]?.[key]) ?? (window.LOCALES?.en?.[key]);
  if(val==null){ if(!_missingI18nLogged.has(key)){ _missingI18nLogged.add(key); console.warn(`[i18n] missing key: ${key} (locale: ${currentLocale})`);} return key; }
  return repl?String(val).replace(/\{(\w+)\}/g,(m,k)=>repl[k]??m):val;
}
function applyLocale(){
  document.documentElement.lang = currentLocale;
  $$('[data-i18n]').forEach(el=>{el.textContent=t(el.dataset.i18n)});
  $$('[data-i18n-html]').forEach(el=>{el.innerHTML=t(el.dataset.i18nHtml)});
  $$('[data-i18n-placeholder]').forEach(el=>{el.placeholder=t(el.dataset.i18nPlaceholder)});
  $$('[data-i18n-title]').forEach(el=>{el.title=t(el.dataset.i18nTitle)});
}
const tf=t;
// "?" bubbles: hover shows the native title, click/tap opens an instant translated bubble.
let kpiTipEl=null;
function closeKpiTip(){if(kpiTipEl){kpiTipEl.remove();kpiTipEl=null}}
function showKpiTip(h){
  if(kpiTipEl){closeKpiTip();return}
  kpiTipEl=document.createElement('div');kpiTipEl.className='kpi-tip';kpiTipEl.textContent=t(h.dataset.i18nTitle);
  document.body.appendChild(kpiTipEl);
  const r=h.getBoundingClientRect(),tr=kpiTipEl.getBoundingClientRect();
  let x=r.left+r.width/2-tr.width/2,y=r.bottom+8;
  x=Math.max(8,Math.min(x,window.innerWidth-tr.width-8));
  if(y+tr.height>window.innerHeight-8)y=r.top-tr.height-8;
  kpiTipEl.style.left=x+'px';kpiTipEl.style.top=y+'px';
}
document.addEventListener('click',e=>{
  const h=e.target.closest('.kpi-help');
  if(h){e.stopPropagation();showKpiTip(h);return}
  closeKpiTip();
});
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeKpiTip()});
window.addEventListener('resize',closeKpiTip);
let state = { settings:{serverPath:'',javaPath:'',memoryMin:2,memoryMax:6,autoEula:true}, files:{plugins:[],mods:[],datapacks:[],worlds:[],backups:[],properties:{}}, running:false, live:{players:[]} };
let samples = Array.from({length:38},()=>({tps:null,mspt:null,cpu:null,ram:null}));
let selectedPlayer = null; let marketSort = 'downloads';
let lastInspectData=null; // kept so icons:update can re-render the open inspector (now text-only, but keep for compat)
let invSearchQuery='', invShowEmpty=false, invSortBy='slot';
let ecSearchQuery='', ecShowEmpty=false, ecSortBy='slot';
const titles={overview:'Overview',console:'Console',players:'Players',performance:'Performance',content:'Content library',marketplace:'Marketplace',worlds:'Worlds & backups',properties:'Server properties',settings:'Launcher settings'};
const esc=s=>String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
function toast(message,kind){const t=$('#toast');t.textContent=message;t.className=kind?`show ${kind}`:'show';clearTimeout(toast.t);toast.t=setTimeout(()=>t.classList.remove('show'),2800)}
function metricChart(canvas,expanded=false,mode='combined'){if(!canvas)return;const ctx=canvas.getContext('2d');const r=canvas.getBoundingClientRect();if(!r.width||!r.height) return;const d=devicePixelRatio||1;canvas.width=r.width*d;canvas.height=r.height*d;ctx.scale(d,d);const w=r.width,h=r.height,p=expanded?30:13;const cs=getComputedStyle(document.documentElement);const cAccent=cs.getPropertyValue('--chart-tps').trim()||'#00e5ff';const cWarn=cs.getPropertyValue('--chart-cpu').trim()||'#d6a24a';const cSuccess=cs.getPropertyValue('--chart-ram').trim()||'#2fd0a0';const cDanger=cs.getPropertyValue('--danger').trim()||'#e5566a';const cMuted=cs.getPropertyValue('--text-dim').trim()||'#5c6470';const cFont=cs.getPropertyValue('--font-ui').trim()||'Space Grotesk, sans-serif';ctx.clearRect(0,0,w,h);
  if(mode==='tick'){
    // Danger band: bottom 25% of the chart (roughly under ~15 TPS / over ~25ms MSPT) tinted red,
    // so a dip reads as "into the red zone" at a glance instead of needing to read the numbers.
    const bandTop=h-p-(h-p*2)*0.25;
    ctx.fillStyle='rgba(229,86,106,.06)';ctx.fillRect(p,bandTop,w-p*2,h-p-bandTop);
  }
  ctx.strokeStyle='rgba(255,255,255,.06)';for(let y=p;y<h-p;y+=(h-p*2)/4){ctx.beginPath();ctx.moveTo(p,y);ctx.lineTo(w-p,y);ctx.stroke()}
  if(mode==='tick'){
    // Target reference line at the very top (20 TPS / 0ms MSPT — the "perfect tick" line).
    ctx.setLineDash([4,4]);ctx.strokeStyle=cMuted;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(p,p);ctx.lineTo(w-p,p);ctx.stroke();ctx.setLineDash([]);
  }
  const draw=(key,color,max,normalize)=>{const good=samples.map((v,i)=>({i,v:v[key]})).filter(x=>x.v!==null);if(!good.length)return;ctx.beginPath();good.forEach((x,j)=>{const n=normalize?normalize(x.v):Math.min(x.v,max)/max;const px=p+x.i*(w-p*2)/(samples.length-1),py=h-p-n*(h-p*2);j?ctx.lineTo(px,py):ctx.moveTo(px,py)});ctx.strokeStyle=color;ctx.lineWidth=2;ctx.stroke()};
  if(mode==='resource'){
    draw('cpu',cWarn,100);draw('ram',cSuccess,100);
    if(expanded){ctx.fillStyle=cMuted;ctx.font=`11px ${cFont}`;ctx.fillText('100%',4,p+4);ctx.fillText('0%',4,h-p+4);ctx.fillText('Live server telemetry',w-120,h-8)}
  } else if(mode==='tick'){
    draw('tps',cAccent,20);
    // MSPT plotted on the SAME up=good axis as TPS: normalized as 1-min(mspt/100,1), so a rising
    // line always means "healthier" for both series, instead of TPS-up/MSPT-down being opposite.
    draw('mspt',cDanger,100,v=>1-Math.min(v,100)/100);
    if(expanded){ctx.fillStyle=cMuted;ctx.font=`11px ${cFont}`;ctx.fillText('Target',4,p-4);ctx.fillText('Danger zone',4,h-6);ctx.fillText('Live server telemetry',w-120,h-8)}
  } else {
    draw('tps',cAccent,20);draw('cpu',cWarn,100);draw('ram',cSuccess,100);
    if(expanded){ctx.fillStyle=cMuted;ctx.font=`11px ${cFont}`;ctx.fillText('20 TPS',4,p+4);ctx.fillText('0',16,h-p+4);ctx.fillText('Live server telemetry',w-120,h-8)}
  }
}
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
let edState={rel:null,content:'',mtime:0,readOnly:false,dirty:false,wrap:false,from:'bays',conflict:false,files:[]};
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
  edState={rel:r.rel,content:r.content,mtime:r.mtime,readOnly:!!r.readOnly,dirty:false,wrap:edState.wrap,from,conflict:false,files:edState.files};
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
function renderFbList(){
  const q=$('#fbSearch').value.trim().toLowerCase();
  const list=q?edState.files.filter(f=>f.path.toLowerCase().includes(q)):edState.files;
  $('#fbCount').textContent=t('ed.filesCount',{a:list.length});
  const box=$('#fbList');
  box.innerHTML=list.length?list.map(f=>`<div class="fb-row" data-rel="${esc(f.path)}" title="${esc(f.path)}"><span class="file-name">${esc(f.path)}</span><span class="fb-size">${edFmtBytes(f.size)}</span></div>`).join(''):`<li class="empty"><span>${t('ed.noFiles')}</span></li>`;
  box.querySelectorAll('.fb-row').forEach(row=>row.onclick=()=>openEd(row.dataset.rel,'browser'));
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
// ============ WORLD MAP (real data from the world save) ============
// --- Terrain preview (approximation, not a cheat): deterministic per-seed colour wash ---
// Uses a fast value-noise derived from the world seed. It looks like biomes at a glance
// without revealing any real structure positions — pure preview, clearly labelled as such.
function hash32(x, z, s) {
  let h = Math.imul(x, 0x9E3779B9) ^ Math.imul(z, 0x85EBCA6B) ^ s;
  h = Math.imul(h ^ (h >>> 16), 0x85EBCB6B);
  h = Math.imul(h ^ (h >>> 13), 0xC2B2AE35);
  return (h ^ (h >>> 16)) >>> 0;
}
function valueNoise(wx, wz, s) {
  const sc = 420;
  const x = wx / sc, z = wz / sc;
  const xi = Math.floor(x), zi = Math.floor(z);
  const xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const n00 = hash32(xi, zi, s), n10 = hash32(xi + 1, zi, s), n01 = hash32(xi, zi + 1, s), n11 = hash32(xi + 1, zi + 1, s);
  const f = v => v / 4294967295 - 0.5;
  const nx0 = f(n00) * (1 - u) + f(n10) * u;
  const nx1 = f(n01) * (1 - u) + f(n11) * u;
  return nx0 * (1 - v) + nx1 * v;
}
function terrainValue(wx, wz, s) {
  return valueNoise(wx, wz, s) * 0.62 + valueNoise(wx * 0.45 + 999, wz * 0.45 - 777, s ^ 0x5A5A5A5A) * 0.38;
}
function getTerrainColor(wx, wz, seedBig, dim) {
  const s = Number(seedBig & 0xFFFFFFFFn) | 0;
  if (dim === 'nether') {
    const n = terrainValue(wx, wz, s);
    if (n < -0.22) return 'rgba(90,26,26,.95)';
    if (n < 0.02) return 'rgba(122,42,26,.95)';
    if (n < 0.24) return 'rgba(58,42,42,.95)';
    return 'rgba(42,90,90,.92)';
  }
  if (dim === 'end') {
    const d = Math.hypot(wx, wz);
    const n = terrainValue(wx * 0.3, wz * 0.3, s);
    if (d > 1700 + n * 500) return 'rgba(8,10,20,.98)';
    return 'rgba(219,207,138,.96)';
  }
  const n = terrainValue(wx, wz, s);
  if (n < -0.34) return 'rgba(15,42,74,.98)';
  if (n < -0.19) return 'rgba(26,74,110,.96)';
  if (n < -0.07) return 'rgba(194,178,128,.96)';
  if (n < 0.09) return 'rgba(123,175,74,.96)';
  if (n < 0.26) return 'rgba(58,125,46,.96)';
  if (n < 0.42) return 'rgba(138,138,138,.96)';
  return 'rgba(208,208,208,.97)';
}

let wm={level:null,players:[],waypoints:[],dim:'overworld',cam:{x:0,z:0},zoom:0.25,addMode:false,drag:null,loaded:false,seedBig:0n,layers:{terrain:true},explored:new Set(),exploredDim:null};
const WM_COLORS=['#FF3B5C','#00E5FF','#FFD23F','#00E5A0','#C792EA','#FF8C42'];
function wmShow(view){$('#wmNoWorld').hidden=view!=='none';$('#wmApp').hidden=view!=='app'}
async function wmLoad(){
  const r=await window.observer.worldmapLoad();
  wm.level=(r&&r.level&&r.level.ok)?r.level:null;
  wm.players=(r&&r.players&&r.players.players)||[];
  wm.waypoints=(r&&r.waypoints)||[];
  if(!wm.level){wmShow('none');return}
  wmShow('app');
  wm.seedBig=BigInt(wm.level.seed);
  $('#wmSeed').textContent=wm.level.seed;
  $('#wmSeed').title=wm.level.levelName+' · '+wm.level.version.name;
  // center on spawn or first player
  const f=wm.players[0]?wm.players[0].pos:wm.level.spawn;
  wm.cam={x:f.x,z:f.z};if(wm.zoom<0.1)wm.zoom=0.25;
  wmLoadChunks(wm.dim);
  wmRenderList();wmDraw();
}
function wmVisible(){
  const list=(wm.dim==='overworld'?[{type:'spawn',...wm.level.spawn,name:t('wm.spawn'),color:'#00E5A0'}]:[]);
  for(const p of wm.players)if(p.dim===wm.dim)list.push({type:'player',...p.pos,name:p.name||p.uuid.slice(0,8),color:'#00E5FF'});
  for(const w of wm.waypoints)if(w.dim===wm.dim)list.push({type:'wp',...w});
  return list;
}
function wmDraw(){
  const cv=$('#wmCanvas'),ctx=cv.getContext('2d');
  const dpr=devicePixelRatio||1;
  const W=cv.clientWidth||800,H=cv.clientHeight||520;
  if(cv.width!==W*dpr||cv.height!==H*dpr){cv.width=W*dpr;cv.height=H*dpr}
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.fillStyle='#0A0F14';ctx.fillRect(0,0,W,H);
  const cx=W/2,cy=H/2;
  const toS=(wx,wz)=>[(wx-wm.cam.x)*wm.zoom+cx,(wz-wm.cam.z)*wm.zoom+cy];
  // adaptive grid: chunk 16, region 512
  const steps=[16,64,256,1024,4096,16384];
  let step=steps[steps.length-1];
  for(const s of steps){if(s*wm.zoom>=26){step=s;break}}
  const [wx0,wz0]=toS(0,0);
  ctx.strokeStyle='rgba(255,255,255,.05)';ctx.lineWidth=1;
  const startWX=Math.floor(wm.cam.x-W/2/wm.zoom/step)*step,endWX=wm.cam.x+W/2/wm.zoom;
  for(let x=startWX;x<=endWX;x+=step){const[sx]=toS(x,0);ctx.beginPath();ctx.moveTo(sx,0);ctx.lineTo(sx,H);ctx.stroke()}
  const startWZ=Math.floor(wm.cam.z-H/2/wm.zoom/step)*step,endWZ=wm.cam.z+H/2/wm.zoom;
  for(let z=startWZ;z<=endWZ;z+=step){const[,sy]=toS(0,z);ctx.beginPath();ctx.moveTo(0,sy);ctx.lineTo(W,sy);ctx.stroke()}
  // axes
  ctx.strokeStyle='rgba(0,229,255,.25)';ctx.lineWidth=1.5;
  const[ax]=toS(0,0);ctx.beginPath();ctx.moveTo(ax,0);ctx.lineTo(ax,H);ctx.stroke();
  const[,ay]=toS(0,0);ctx.beginPath();ctx.moveTo(0,ay);ctx.lineTo(W,ay);ctx.stroke();
  // markers
  ctx.textBaseline='top';
  for(const m of wmVisible()){
    const[sx,sy]=toS(m.x,m.z);
    if(sx<-40||sx>W+40||sy<-30||sy>H+30)continue;
    ctx.fillStyle=m.color;
    if(m.type==='wp'){ctx.save();ctx.translate(sx,sy);ctx.rotate(Math.PI/4);ctx.fillRect(-5,-5,10,10);ctx.restore()}
    else{ctx.beginPath();ctx.arc(sx,sy,5,0,7);ctx.fill()}
    ctx.strokeStyle='rgba(0,0,0,.6)';ctx.lineWidth=1.5;ctx.stroke();
    ctx.font='600 10.5px "JetBrains Mono",monospace';
    ctx.fillStyle=m.color;
    ctx.fillText(m.name,sx+9,sy-14);
    ctx.fillStyle='rgba(232,244,248,.75)';
    ctx.fillText(Math.round(m.x)+' '+Math.round(m.z),sx+9,sy-2);
  }
  // terrain preview wash (behind grid/markers) — MCA-Selector style: only where chunks exist
  if(wm.layers.terrain){
    const cellPx=8;
    const stepW=cellPx/wm.zoom;
    const x0=Math.floor((wm.cam.x-W/2/wm.zoom)/stepW)*stepW;
    const x1=wm.cam.x+W/2/wm.zoom;
    const z0=Math.floor((wm.cam.z-H/2/wm.zoom)/stepW)*stepW;
    const z1=wm.cam.z+H/2/wm.zoom;
    for(let wz=z0;wz<z1;wz+=stepW)for(let wx=x0;wx<x1;wx+=stepW){
      if(wm.explored.size){
        const cx=Math.floor(wx/16),cz=Math.floor(wz/16);
        if(!wm.explored.has(cx+','+cz))continue;
      }
      const[sx,sy]=toS(wx,wz);
      ctx.fillStyle=getTerrainColor(wx,wz,wm.seedBig,wm.dim);
      ctx.fillRect(sx,sy,cellPx,cellPx);
    }
  }
  // scale bar
  const px=step*wm.zoom;
  ctx.fillStyle='rgba(232,244,248,.7)';ctx.font='600 9.5px "JetBrains Mono",monospace';
  ctx.fillText(step+' blocks',14,H-14);
  ctx.strokeStyle='rgba(232,244,248,.7)';ctx.lineWidth=2;
  ctx.beginPath();ctx.moveTo(14,H-24);ctx.lineTo(14+px,H-24);ctx.stroke();
}
function wmJump(x,z){wm.cam={x,z};wmDraw()}
function wmRenderList(){
  const box=$('#wmWpList');const list=wm.waypoints;
  $('#wmWpCount').textContent=String(list.length);
  box.innerHTML=list.length?list.map(w=>`<div class="wm-wprow" data-id="${esc(w.id)}"><span class="wm-dot" style="background:${esc(w.color)}"></span><div class="wm-wpmain"><b>${esc(w.name)}</b><small>${esc(w.dim)} · ${Math.round(w.x)} ${Math.round(w.z)}</small></div><button class="text-btn" data-wm-jump="${esc(w.id)}">${esc(t('wm.jump'))}</button><button class="text-btn danger" data-wm-del="${esc(w.id)}">${esc(t('wm.delete'))}</button></div>`).join(''):`<p class="field-hint">${esc(t('wm.none'))}</p>`;
  box.querySelectorAll('[data-wm-jump]').forEach(b=>b.onclick=()=>{const w=wm.waypoints.find(x=>x.id===b.dataset.wmJump);if(w){wmJump(w.x,w.z);if(w.dim!==wm.dim){wm.dim=w.dim;wmSyncDimTabs();wmDraw()}}});
  box.querySelectorAll('[data-wm-del]').forEach(b=>b.onclick=async()=>{wm.waypoints=wm.waypoints.filter(x=>x.id!==b.dataset.wmDel);await window.observer.worldmapSetWaypoints(wm.waypoints);wmRenderList();wmDraw()});
}
function wmSyncDimTabs(){$$('#wmDims .filter-chip').forEach(c=>c.classList.toggle('active',c.dataset.dim===wm.dim))}
async function wmAddWaypoint(x,z){
  let name=null;
  try{ name=prompt(t('wm.namePrompt'),t('wm.waypoints')+' '+(wm.waypoints.length+1)); }catch{ name=''; }
  if(name===null) return;
  name=String(name).trim()||('Waypoint '+(wm.waypoints.length+1));
  const wp={id:Date.now().toString(36)+Math.random().toString(36).slice(2,6),name,x:Math.round(x),y:64,z:Math.round(z),dim:wm.dim,color:WM_COLORS[wm.waypoints.length%WM_COLORS.length]};
  wm.waypoints.push(wp);
  const r=await window.observer.worldmapSetWaypoints(wm.waypoints);
  if(!r||!r.ok) toast('Could not save waypoint','error');
  else toast(name+' ✓','success');
  wmRenderList();wmDraw();
  wmJump(x,z);
}
// tab activation: load data lazily
(function(){
  const orig=switchTab;
  window.switchTab=function(tab){
    orig(tab);
    if(tab==='worldmap')wmLoad().catch(()=>{});
  };
})();
$('#wmReload').onclick=wmLoad;
$('#wmReload2').onclick=wmLoad;
$('#wmCopySeed').onclick=async()=>{if(!wm.level)return;try{await navigator.clipboard.writeText(wm.level.seed);toast(t('toast.copied'),'success')}catch{toast(wm.level.seed)}};
$$('#wmDims .filter-chip').forEach(c=>c.onclick=()=>{wm.dim=c.dataset.dim;wmSyncDimTabs();wmLoadChunks(wm.dim);wmDraw()});
$('#wmAdd').onclick=()=>{wm.addMode=!wm.addMode;$('#wmAdd').classList.toggle('active',wm.addMode)};
async function wmLoadChunks(dim){
  try{
    const r=await window.observer.worldmapChunks(dim);
    if(r&&r.ok&&r.dim===dim){wm.explored=new Set(r.chunks);wm.exploredDim=dim;wmDraw()}
  }catch{}
}
$('#wmTerrain').onclick=()=>{wm.layers.terrain=!wm.layers.terrain;$('#wmTerrain').classList.toggle('active',wm.layers.terrain);wmDraw()};
wm.layers.terrain=true;
$('#wmExport').onclick=()=>{
  const cv=$('#wmCanvas');
  cv.toBlob(b=>{
    const a=document.createElement('a');
    a.href=URL.createObjectURL(b);
    a.download='observerlauncher-map-'+(wm.level?.seed?.slice(-6)||'map')+'.png';
    a.click();URL.revokeObjectURL(a.href);
    toast(t('wm.exported'),'success');
  });
};
(function(){
  const cv=$('#wmCanvas');
  let dragging=false,lx=0,ly=0;
  cv.addEventListener('mousedown',e=>{dragging=true;lx=e.clientX;ly=e.clientY});
  window.addEventListener('mouseup',()=>dragging=false);
  cv.addEventListener('mousemove',e=>{
    const r=cv.getBoundingClientRect();
    const wx=Math.round((e.clientX-r.left-WM_CX())/wm.zoom+wm.cam.x);
    const wz=Math.round((e.clientY-r.top-WM_CY())/wm.zoom+wm.cam.z);
    $('#wmCoord').textContent=wx+' '+wz;
    if(!dragging)return;
    wm.cam.x-=(e.clientX-lx)/wm.zoom;wm.cam.z-=(e.clientY-ly)/wm.zoom;
    lx=e.clientX;ly=e.clientY;wmDraw();
  });
  cv.addEventListener('wheel',e=>{
    e.preventDefault();
    const r=cv.getBoundingClientRect();
    const wx=(e.clientX-r.left-WM_CX())/wm.zoom+wm.cam.x;
    const wz=(e.clientY-r.top-WM_CY())/wm.zoom+wm.cam.z;
    wm.zoom=Math.max(0.02,Math.min(16,wm.zoom*(e.deltaY<0?1.2:1/1.2)));
    wm.cam={x:wx-(e.clientX-r.left-WM_CX())/wm.zoom,z:wz-(e.clientY-r.top-WM_CY())/wm.zoom};
    wmDraw();
  },{passive:false});
  cv.addEventListener('click',e=>{
    if(!wm.addMode||!wm.level)return;
    const r=cv.getBoundingClientRect();
    const x=Math.round((e.clientX-r.left-WM_CX())/wm.zoom+wm.cam.x);
    const z=Math.round((e.clientY-r.top-WM_CY())/wm.zoom+wm.cam.z);
    wmAddWaypoint(x,z);
    wm.addMode=false;$('#wmAdd').classList.remove('active');
  });
  new ResizeObserver(()=>wmDraw()).observe(cv);
})();
function WM_CX(){return ($('#wmCanvas').clientWidth||800)/2}
function WM_CY(){return ($('#wmCanvas').clientHeight||520)/2}
// external-change watcher: auto-reload when clean, conflict banner when dirty
window.observer.onEditorExternal(r=>{
  if($('#fileEditor').hidden||!edState.rel)return;
  if(r.mtime===edState.mtime)return;
  if(!edState.dirty){openEd(edState.rel,edState.from).then(()=>toast(t('ed.reloadedExternal')))}
  else{edState.conflict=true;$('#edConflict').hidden=false}
});
// icons:update — a placeholder icon just got its real pixels; bump the cache-buster and
// re-render whatever icon grid is on screen (the player inspector).
window.observer.onIconsUpdate(()=>{
  iconVer=Date.now();
  if(!$('#playerInspectModal').hidden&&lastInspectData){
    renderEquipment(lastInspectData.armor,lastInspectData.offhand);
    renderItemGrid('#inventoryList',lastInspectData.inventory);
    renderItemGrid('#enderChestList',lastInspectData.enderChest);
  }
});
// TEXT-ONLY item display — no textures, just readable labels. Keeps the same IDs so save logic is untouched.
function itemLabel(id){return String(id||'').replace(/^minecraft:/,'').replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase())||'Unknown item'}
function renderItemGrid(id,items){
  const n=$(id);if(!n)return;
  const isInv=id==='#inventoryList';
  const q=(isInv?invSearchQuery:ecSearchQuery).trim().toLowerCase();
  const showEmpty=isInv?invShowEmpty:ecShowEmpty;
  const sortBy=isInv?invSortBy:ecSortBy;
  const raw=(items||[]).filter(x=>x.id&&x.id!=='minecraft:air');
  const totalSlots=isInv?36:27;
  const used=raw.length;
  // summary header is handled by caller via #invCount / #ecCount — keep in sync
  const countEl=isInv?$('#invCount'):$('#ecCount');
  if(countEl) countEl.textContent=`${used} / ${totalSlots}`;
  const bar=isInv?$('#invBar'):$('#ecBar');
  if(bar) bar.style.width=`${Math.round(used/totalSlots*100)}%`;
  if(!used && !showEmpty){n.innerHTML=`<div class="inv-empty"><b data-i18n="pd.emptyInv">Inventory is empty</b><span data-i18n="pd.emptyInvSub">No items in this inventory. Use the world to collect items.</span></div>`;return}
  // build full slot map (0..35 or 0..26) for showEmpty, else only used
  let list=[];
  if(showEmpty){
    const bySlot=new Map(raw.map(x=>[x.slot,x]));
    for(let s=0;s<totalSlots;s++){
      const it=bySlot.get(s);
      if(it) list.push(it);
      else list.push({slot:s, id:null, count:0, empty:true});
    }
  } else {
    list=[...raw];
  }
  if(q) list=list.filter(x=>!x.empty && String(x.id).toLowerCase().includes(q));
  // sort
  if(sortBy==='name') list.sort((a,b)=>String(a.id||'').localeCompare(String(b.id||'')));
  else if(sortBy==='count') list.sort((a,b)=>(b.count||0)-(a.count||0));
  else list.sort((a,b)=>a.slot-b.slot);
  if(!list.length){n.innerHTML=`<div class="inv-empty"><b>${esc(t('pd.noMatch'))}</b><span>${esc(t('pd.noMatchSub'))}</span></div>`;return}
  n.innerHTML=list.map((x,i)=>{
    if(x.empty) return `<div class="inv-row empty" style="animation-delay:${i*18}ms"><span class="slot">#${x.slot}</span><span class="item-name muted">— Empty —</span><span class="count"></span></div>`;
    const label=itemLabel(x.id);
    return `<div class="inv-row" style="animation-delay:${i*18}ms" title="${esc(label)}"><span class="slot">#${x.slot}</span><span class="item-name">${esc(label)}</span><span class="count">×${x.count}</span><span class="item-id">${esc(x.id)}</span></div>`;
  }).join('');
}
function renderEquipment(armor,offhand){
  const n=$('#equipmentGrid');if(!n)return;
  const slots=[...(armor||[]),...(offhand?[{slot:'Offhand',id:offhand.id,count:offhand.count}]:[])];
  const order=['Helmet','Chestplate','Leggings','Boots','Offhand'];
  n.innerHTML=order.map((label,i)=>{
    const it=slots.find(x=>x.slot===label);
    const has=!!it;
    return `<div class="inv-row equip ${has?'':'empty'}" style="animation-delay:${i*22}ms"><span class="slot">${esc(label)}</span><span class="item-name ${has?'':'muted'}">${has?esc(itemLabel(it.id)):'— Empty —'}</span><span class="count">${has&&it.count>1?`×${it.count}`:''}</span><span class="item-id">${has?esc(it.id):''}</span></div>`;
  }).join('');
}
let playerFilter='online';
const PLAYERS_PAGE_SIZE=14;
let playerPage=0;
let playerSearchQuery='';
// FEATURE: the Players list used to have just one source (online, or offline usercache) — no way to
// see who's banned or whitelisted, and no clear online/offline split. Now merges 4 sources (live
// players, usercache, whitelist.json, banned-players.json) into one model keyed by name
// (case-insensitive), then filters by the selected tab.
function buildPlayerRows(){
  const online=(state.running?(state.live?.players||[]):[]).map(p=>typeof p==='string'?{name:p}:p);
  const known=state.files?.knownPlayers||[]; const whitelist=state.files?.whitelist||[]; const banned=state.files?.banned||[]; const ops=state.files?.ops||[];
  const byName={}; known.forEach(p=>byName[String(p.name).toLowerCase()]=p);
  const rows={}; const upsert=(name,patch)=>{const k=String(name).toLowerCase();rows[k]={...(rows[k]||{name}),...patch}};
  known.forEach(p=>upsert(p.name,{uuid:p.uuid,hasData:p.hasData}));
  online.forEach(p=>{const k2=byName[String(p.name).toLowerCase()];upsert(p.name,{online:true,uuid:p.uuid||k2?.uuid,hasData:p.hasData??k2?.hasData})});
  whitelist.forEach(p=>{const k=String(p.name).toLowerCase();upsert(p.name,{uuid:p.uuid||rows[k]?.uuid,whitelisted:true})});
  banned.forEach(p=>{const k=String(p.name).toLowerCase();upsert(p.name,{uuid:p.uuid||rows[k]?.uuid,banned:true,banReason:p.reason})});
  ops.forEach(p=>{const k=String(p.name).toLowerCase();upsert(p.name,{uuid:p.uuid||rows[k]?.uuid,op:true})});
  return Object.values(rows);
}
function badgeHtml(p){const b=[];if(p.op)b.push('<span class="player-badge op">OP</span>');if(p.whitelisted)b.push('<span class="player-badge whitelisted">WL</span>');if(p.banned)b.push('<span class="player-badge banned">Banned</span>');return b.join('')}
function rowActionBtn(action,label,active,cls='',extra=''){return `<button class="row-action ${cls} ${active?'active':''}" data-row-action="${action}" ${extra}>${label}</button>`}
function renderPlayers(){
  const n=$('#playersList');if(!n)return;
  const all=buildPlayerRows();
  let list=playerFilter==='online'?all.filter(p=>p.online):playerFilter==='offline'?all.filter(p=>!p.online):playerFilter==='whitelist'?all.filter(p=>p.whitelisted):playerFilter==='banned'?all.filter(p=>p.banned):playerFilter==='ops'?all.filter(p=>p.op):all;
  const q=playerSearchQuery.trim().toLowerCase();
  if(q) list=list.filter(p=>String(p.name).toLowerCase().includes(q));
  const totalPages=Math.max(1,Math.ceil(list.length/PLAYERS_PAGE_SIZE));
  playerPage=Math.min(playerPage,totalPages-1);
  const page=list.slice(playerPage*PLAYERS_PAGE_SIZE,(playerPage+1)*PLAYERS_PAGE_SIZE);
  const pager=$('#playersPager');
  const countEl=$('#rosterCount'); if(countEl) countEl.textContent=t('ply.count',{a:list.length,b:all.filter(p=>p.online).length});
  if(pager){pager.hidden=totalPages<=1;$('#playersPageLabel').textContent=`${t('ply.page')} ${playerPage+1} / ${totalPages}`;$('#playersPrevPage').disabled=playerPage<=0;$('#playersNextPage').disabled=playerPage>=totalPages-1}
  if(!page.length){n.innerHTML=`<div class="player-empty"><b>${t('ply.empty')}</b><span>${t('ply.emptySub')}</span></div>`}else{n.innerHTML=page.map(p=>{
    const attrs=`data-player="${esc(p.name)}" data-uuid="${esc(p.uuid||'')}"`;
    const avatar=p.uuid?`https://mc-heads.net/avatar/${encodeURIComponent(p.uuid)}/36`:`https://mc-heads.net/avatar/MHF_Steve/36`;
    const meta=[p.online?'<span style="color:var(--success)">● Online</span>':'<span>○ Offline</span>', p.hasData?'has data':'no data', p.uuid?`UUID ${esc(p.uuid.slice(0,8))}…`:null].filter(Boolean).join(' • ');
    return `<div class="player-row ${p.online?'online':''}">
      <img class="player-avatar" src="${avatar}" alt="" onerror="this.src='https://mc-heads.net/avatar/MHF_Steve/36'">
      <div class="player-main">
        <div class="player-name"><i class="player-row-dot"></i><b>${esc(p.name)}</b>${badgeHtml(p)}</div>
        <div class="player-meta">${meta}</div>
      </div>
      <div class="player-row-actions">
        ${rowActionBtn('op',p.op?'Remove OP':'Make OP',p.op,'',`${attrs} data-value="${p.op?'off':'on'}"`)}
        ${rowActionBtn('whitelist',p.whitelisted?'Un-whitelist':'Whitelist',p.whitelisted,'',`${attrs} data-value="${p.whitelisted?'off':'on'}"`)}
        ${rowActionBtn('ban',p.banned?'Unban':'Ban',p.banned,'danger',`${attrs} data-value="${p.banned?'off':'on'}"`)}
        <button class="row-action danger" data-row-action="kick" ${attrs} ${p.online?'':'disabled title="Player must be online"'}>Kick</button>
        <button class="row-action ${p.hasData?'':'muted'}" data-row-action="inspect" ${attrs} title="${p.hasData?'Inspect player data':'No saved data'}">Inspect</button>
      </div>
    </div>`;
  }).join('')}
}
async function togglePlayerOp(p,on){if(!p.uuid&&!state.running)return toast('This player has no known UUID yet — start the server and try again, or have them join once first.');const r=await window.observer.playerOpToggle({uuid:p.uuid,name:p.name,op:on});if(!r.ok)return toast(r.error);state.files=r.files;refreshUI();toast(`${p.name} is ${on?'now an operator':'no longer an operator'}.`)}
async function togglePlayerWhitelist(p,add){if(!p.uuid&&!state.running)return toast('This player has no known UUID yet — start the server and try again, or have them join once first.');const r=await window.observer.playerWhitelistToggle({uuid:p.uuid,name:p.name,add});if(!r.ok)return toast(r.error);state.files=r.files;refreshUI();toast(`${p.name} ${add?'added to':'removed from'} the whitelist.`)}
async function togglePlayerBan(p,ban){if(!p.uuid&&!state.running)return toast('This player has no known UUID yet — start the server and try again, or have them join once first.');const r=await window.observer.playerBanToggle({uuid:p.uuid,name:p.name,ban});if(!r.ok)return toast(r.error);state.files=r.files;refreshUI();toast(`${p.name} ${ban?'banned':'unbanned'}.`)}
function openPlayerInspectModal(){const m=$('#playerInspectModal'); m.classList.remove('closing'); m.hidden=false; void m.offsetWidth; }
function closePlayerInspectModal(){const m=$('#playerInspectModal'); if(m.hidden) return; m.classList.add('closing'); setTimeout(()=>{ m.hidden=true; m.classList.remove('closing'); }, 140);}
async function openPlayerInspector(uuid,name){
  selectedPlayer={uuid:uuid||null,name};
  openPlayerInspectModal();
  const saveBtn=$('#savePlayerData');
  if(state.running){ if(saveBtn){ saveBtn.disabled=true; saveBtn.title='Stop the server before editing player data'; } }
  else { if(saveBtn){ saveBtn.disabled=false; saveBtn.title=''; } }
  $('#playerDataForm').hidden=true;$('#playerDataEmpty').hidden=false;$('#playerDataError').textContent='Loading player data…';
  if(!uuid){ const uuidEl=$('#inspectUuid'); if(uuidEl){ uuidEl.textContent='UUID: — unknown (player hasn’t joined yet)'; uuidEl.hidden=false; uuidEl.title='No UUID yet'; uuidEl.onclick=null; } $('#playerDataError').textContent=`No UUID is known for ${name} yet. This usually means they haven't joined this server (or this exact server folder) since it started tracking players. Try clicking "Refresh list" first, or have them join once and try again.`;return}
  let r;
  try{r=await window.observer.playerRead(uuid)}catch(e){$('#playerDataError').textContent=`Unexpected error while reading player data: ${e?.message||e}`;return}
  if(!r||!r.ok){$('#playerDataError').textContent=r?.error||'Unknown error reading player data (no response from the app\'s backend).';return}
  const d=r.data;
  if(!d){$('#playerDataError').textContent='The player data file was found but returned no data — it may be corrupted or in an unsupported format.';return}
  invSearchQuery='';ecSearchQuery='';invShowEmpty=false;ecShowEmpty=false;invSortBy='slot';ecSortBy='slot';
  const invS=$('#invSearch');if(invS)invS.value='';const ecS=$('#ecSearch');if(ecS)ecS.value='';
  const invCb=$('#invShowEmpty');if(invCb)invCb.checked=false;const ecCb=$('#ecShowEmpty');if(ecCb)ecCb.checked=false;
  const invSel=$('#invSort');if(invSel)invSel.value='slot';const ecSel=$('#ecSort');if(ecSel)ecSel.value='slot';
  $('#playerDataEmpty').hidden=true;$('#playerDataForm').hidden=false;
  $('#inspectAvatar').src=`https://mc-heads.net/avatar/${encodeURIComponent(uuid)}/44`;
  $('#inspectName').textContent=name;$('#inspectDim').textContent=d.dimension||'unknown dimension';
  const uuidEl=$('#inspectUuid'); if(uuidEl){ uuidEl.hidden=false; uuidEl.textContent=`UUID: ${uuid}`; uuidEl.title=`${uuid} — click to copy full UUID`; uuidEl.onclick=async()=>{ try{ await navigator.clipboard.writeText(uuid); uuidEl.classList.add('copied'); const prev=uuidEl.textContent; uuidEl.textContent='Copied!'; toast('UUID copied','success'); setTimeout(()=>{ uuidEl.textContent=`UUID: ${uuid}`; uuidEl.classList.remove('copied'); }, 1200); }catch{ toast(uuid)} }; }
  $('#pdHealth').value=d.health??'';$('#pdFood').value=d.food??'';$('#pdSaturation').value=d.saturation??'';$('#pdXpLevel').value=d.xpLevel??0;$('#pdXpTotal').value=d.xpTotal??0;$('#pdGameType').value=d.gameType??0;$('#pdClearInventory').checked=false;
  lastInspectData={armor:d.armor,offhand:d.offhand,inventory:d.inventory,enderChest:d.enderChest};
  renderEquipment(d.armor,d.offhand);renderItemGrid('#inventoryList',d.inventory);renderItemGrid('#enderChestList',d.enderChest);
}
$('#playersList').addEventListener('click',e=>{
  const btn=e.target.closest('[data-row-action]');if(!btn||btn.disabled)return;
  const action=btn.dataset.rowAction,name=btn.dataset.player,uuid=btn.dataset.uuid||null,p={uuid,name};
  if(action==='op')togglePlayerOp(p,btn.dataset.value==='on');
  else if(action==='whitelist')togglePlayerWhitelist(p,btn.dataset.value==='on');
  else if(action==='ban'){if(btn.dataset.value==='on'&&!confirm(`Ban ${name}?`))return;togglePlayerBan(p,btn.dataset.value==='on')}
  else if(action==='kick'){if(confirm(`Kick ${name}?`))command(`kick ${name}`)}
  else if(action==='inspect')openPlayerInspector(uuid,name);
});
$('#invSearch')?.addEventListener('input',e=>{invSearchQuery=e.target.value;renderItemGrid('#inventoryList',lastInspectData?.inventory||[])});$('#invShowEmpty')?.addEventListener('change',e=>{invShowEmpty=e.target.checked;renderItemGrid('#inventoryList',lastInspectData?.inventory||[])});$('#invSort')?.addEventListener('change',e=>{invSortBy=e.target.value;renderItemGrid('#inventoryList',lastInspectData?.inventory||[])});$('#ecSearch')?.addEventListener('input',e=>{ecSearchQuery=e.target.value;renderItemGrid('#enderChestList',lastInspectData?.enderChest||[])});$('#ecShowEmpty')?.addEventListener('change',e=>{ecShowEmpty=e.target.checked;renderItemGrid('#enderChestList',lastInspectData?.enderChest||[])});$('#ecSort')?.addEventListener('change',e=>{ecSortBy=e.target.value;renderItemGrid('#enderChestList',lastInspectData?.enderChest||[])});$('#playerInspectClose').onclick=closePlayerInspectModal;
$$('[data-player-filter]').forEach(b=>b.onclick=()=>{
  playerFilter=b.dataset.playerFilter;playerPage=0;
  $$('[data-player-filter]').forEach(x=>{ const on=x===b; x.classList.toggle('active',on); x.setAttribute('aria-pressed', on?'true':'false'); });
  renderPlayers();
});
$('#playersPrevPage').onclick=()=>{if(playerPage>0){playerPage--;renderPlayers()}};
$('#playersNextPage').onclick=()=>{playerPage++;renderPlayers()};
$('#playerSearch')?.addEventListener('input', debounce(e=>{playerSearchQuery=e.target.value; playerPage=0; renderPlayers();}, 200));
// BUGFIX: "Refresh list" used to be a generic [data-command="list"] button, which only sends the
// console command "list" to a RUNNING server — it never re-read usercache.json/playerdata from disk,
// so a player who joined (recorded on disk) then left could click this forever and never see a working
// UUID/"has data" for themselves. This now actually re-fetches the file listing; it also still sends
// "list" when the server is running, since that's a legitimately faster way to refresh online status.
$('#refreshPlayersBtn').onclick=async()=>{
  $('#refreshPlayersBtn').disabled=true;
  const r=await window.observer.getFiles();
  if(r.ok){state.files=r.files;refreshUI()}else toast(r.error,'error');
  if(state.running)command('list');
  $('#refreshPlayersBtn').disabled=false;
};
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
  $$('[data-restore]').forEach(b=>b.onclick=async()=>{if(!confirm(t('toast.confirmRestore',{n:b.dataset.restore})))return;const r=await window.observer.restoreBackup(b.dataset.restore);if(!r.ok)return toast(r.error);state.files=r.files;refreshUI();toast(t('toast.backupRestored'))});
  $$('[data-delete]').forEach(b=>b.onclick=async()=>{if(!confirm(`Permanently delete this backup? This cannot be undone.`))return;const r=await window.observer.deleteBackup(b.dataset.delete);if(!r.ok)return toast(r.error);state.files=r.files;refreshUI();toast(t('toast.backupDeleted'))});
}
// FEATURE: install-time detail dialog lives in openInstallModal() below — compatibility panel,
// exact version picker, warnings and byte progress replace the old native confirm() prompts.
function renderMarket(items){const n=$('#marketResults');if(!items?.length){n.innerHTML=`<article class="panel glass"><p class="text-muted">${esc(t('mkt.noResults'))}</p><div class="market-empty-actions"><button class="btn secondary" onclick="document.getElementById('marketQuery').value='';document.getElementById('marketVersion').value='';document.getElementById('marketSearch').click()">${esc(t('mkt.clear'))}</button></div></article>`;return}n.innerHTML=items.map((x,i)=>`<article class="panel glass market-item"><div class="market-icon">${x.icon?`<img src="${esc(x.icon)}" alt="">`:'<svg viewBox="0 0 24 24"><path d="M4 7l8-4 8 4-8 4-8-4z"/><path d="M4 7v10l8 4 8-4V7"/></svg>'}</div><div><h3>${esc(x.title)}</h3><p>${esc(x.description||'No description')}</p><small>${esc(x.author||'Unknown author')} · ${Number(x.downloads||0).toLocaleString()} downloads · ${esc(x.source)}</small></div><button class="btn primary" data-market-install="${i}">Install</button></article>`).join('');$$('[data-market-install]').forEach(b=>b.onclick=()=>{
  const item=items[Number(b.dataset.marketInstall)];
  openInstallModal(item);
})}

// ============ INSTALL CONFIRM MODAL ============
// Full GUI confirmation for Marketplace installs: compatibility panel (game version / loader /
// server-side support vs the DETECTED server), exact version picker (Modrinth), pre-install
// warnings, and real byte progress — single file for mods/plugins, per-file for modpacks.
let installState={item:null,detail:null,versionId:null,busy:false,done:false};
const imFmtBytes=n=>{if(!n)return'—';if(n<1024)return n+' B';if(n<1048576)return (n/1024).toFixed(0)+' KB';if(n<1073741824)return (n/1048576).toFixed(1)+' MB';return (n/1073741824).toFixed(2)+' GB'};
function imDetectServer(){
  const jar=String(state.files?.jar||'');
  const mc=(jar.match(/\b(1\.\d{1,2}(?:\.\d{1,2})?|26\.\d{1,2})\b/)||[])[1]||null;
  let loader='unknown';
  if(/velocity|bungee|waterfall/i.test(jar))loader='proxy';
  else if(/paper|purpur|leaf|folia/i.test(jar)||state.files?.hasSpigotConfig)loader='paper';
  else if(/forge/i.test(jar))loader='forge';
  else if(/neoforge/i.test(jar))loader='neoforge';
  else if(/fabric|quilt/i.test(jar))loader='fabric';
  else if(jar)loader='vanilla';
  return {mc,loader};
}
function imBadge(ok,label,warn){return `<span class="im-badge ${ok===true?'ok':ok===false?'bad':warn?'warn':''}">${label}</span>`}
function imRenderCompat(){
  const el=$('#imCompat');if(!el)return;
  const {item,detail}=installState;
  const srv=imDetectServer();
  const chosen=imChosenVersion();
  const cells=[];
  // game version
  const filterV=$('#marketVersion')?.value||'';
  const gameV=filterV||(srv.mc||'');
  if(item.kind==='modpack'&&chosen){
    const gv=chosen.gameVersions||[];
    const match=!gameV||gv.includes(gameV);
    cells.push(`<div class="im-compat-cell"><small>MINECRAFT</small>${imBadge(match,gv.length?[...gv].reverse().slice(0,3).join(', '):'—',!match)}${match?'':`<small class="im-sub">server: ${esc(gameV||'unknown')}</small>`}</div>`);
    const ld=(chosen.loaders||[]).filter(l=>!/datapack|minecraft/i.test(l));
    const loaderOk=srv.loader==='unknown'?null:(ld.length?ld.some(l=>l===srv.loader||(srv.loader==='paper'&&/paper|spigot|bukkit/.test(l))):null);
    cells.push(`<div class="im-compat-cell"><small>LOADER</small>${imBadge(ld.length?(loaderOk===null?null:loaderOk):null,ld.length?ld.join(' / '):'vanilla',loaderOk===false)}</div>`);
  } else {
    cells.push(`<div class="im-compat-cell"><small>MINECRAFT</small>${imBadge(gameV?(chosen?(chosen.gameVersions||[]).includes(gameV):null):null,gameV||'all versions',chosen&&gameV&&!(chosen.gameVersions||[]).includes(gameV))}</div>`);
    const itemLoaders=item.loaders||[];
    const groupMap={plugin:['paper','spigot','purpur','folia','bukkit'],forge:['forge','neoforge'],fabric:['fabric','quilt']};
    const wanted=groupMap[item.kind]||null;
    const match=wanted?(srv.loader!=='unknown'&&wanted.includes(srv.loader)):null;
    cells.push(`<div class="im-compat-cell"><small>YOUR SERVER</small>${imBadge(match,srv.loader==='unknown'?'unknown':srv.loader,itemLoaders.length&&match===false)}</div>`);
  }
  // server-side support (Modrinth env)
  if(detail?.env){const sup=detail.env.server;cells.push(`<div class="im-compat-cell"><small>SERVER-SIDE</small>${imBadge(sup==='required'?true:sup==='optional'?null:false,sup==='required'?'required':sup==='optional'?'optional':'client-only',sup!=='required')}</div>`)}
  if(chosen?.size)cells.push(`<div class="im-compat-cell"><small>SIZE</small>${imBadge(null,imFmtBytes(chosen.size))}</div>`);
  if(chosen?.date)cells.push(`<div class="im-compat-cell"><small>UPDATED</small>${imBadge(null,new Date(chosen.date).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'}))}</div>`);
  el.innerHTML=cells.map(c=>`<div class="im-compat-cell">${c}</div>`).join('');
}
function imChosenVersion(){
  const {detail,versionId}=installState;
  if(!detail?.versions)return null;
  return detail.versions.find(v=>v.id===versionId)||null;
}
function imRenderWarns(){
  const el=$('#imWarns');if(!el)return;
  const {item,detail}=installState;
  const srv=imDetectServer();
  const chosen=imChosenVersion();
  const warns=[];
  const filterV=$('#marketVersion')?.value||'';
  const gameV=filterV||(srv.mc||'');
  if(item.kind==='modpack'){
    warns.push(t('im.warnPack'));
    if(chosen){const ld=(chosen.loaders||[]).filter(l=>!/datapack|minecraft/i.test(l));
      if(ld.length&&srv.loader==='unknown')warns.push(t('im.warnPackUnknown',{l:esc(ld.join('/'))}));
      else if(ld.length&&!/forge|neoforge|fabric/i.test(String(state.files?.jar||''))&&srv.loader!=='vanilla'&&srv.loader!=='unknown')warns.push(t('im.warnPackLoader',{l:esc(ld.join('/')),s:esc(srv.loader)}));
      else if(ld.length&&srv.loader==='vanilla')warns.push(t('im.warnPackVanilla',{l:esc(ld.join('/'))}));
    }
    if(gameV&&chosen&&!(chosen.gameVersions||[]).includes(gameV))warns.push(t('im.warnPackMc',{v:(chosen.gameVersions||[]).slice(-1)[0]||'?',s:esc(gameV)}));
    warns.push(t('im.warnOverwrite'));
  } else {
    if(detail?.env?.server==='unsupported')warns.push(t('im.warnClientOnly'));
    if(detail?.env?.server==='optional')warns.push(t('im.warnOptional'));
    if(chosen&&gameV&&!(chosen.gameVersions||[]).includes(gameV))warns.push(t('im.warnMc',{v:(chosen.gameVersions||[]).slice(-1)[0]||'?',s:esc(gameV)}));
    const itemLoaders=item.loaders||[];
    const groupMap={plugin:['paper','spigot','purpur','folia','bukkit'],forge:['forge','neoforge'],fabric:['fabric','quilt']};
    const wanted=groupMap[item.kind];
    if(wanted&&itemLoaders.length&&srv.loader!=='unknown'&&!itemLoaders.some(l=>wanted.includes(srv.loader)&&wanted.includes(l))&&!wanted.includes(srv.loader))warns.push(t('im.warnLoader',{l:esc(itemLoaders.join('/')),s:esc(srv.loader)}));
    warns.push(`Installs into <code>${esc(item.kind==='datapack'?(state.files?.datapackFolder||'world/datapacks'):item.kind==='mod'?'mods':'plugins')}/</code> — restart the server to load it.`);
  }
  el.innerHTML=warns.map(w=>`<li>${w}</li>`).join('');
  $('#imWarnSection').hidden=!warns.length;
}
function imSetBusy(busy,phase,label){
  installState.busy=busy;
  const card=$('#installModal .im');
  if(card){card.classList.toggle('installing',!!busy);if(busy)card.classList.remove('success')}
  const btn=$('#imInstall'),cancel=$('#imCancel'),prog=$('#imProgressSection');
  btn.disabled=busy;cancel.disabled=busy;
  $('#imClose').disabled=busy;
  prog.hidden=!busy&&!installState.done;
  if(busy){btn.textContent='Installing…';$('#imPhase').textContent=phase||'DOWNLOADING';if(label)$('#imBarLabel').textContent=label}
}
function imRenderVersionPicker(){
  const sec=$('#imVersionSection'),sel=$('#imVersion');
  const vs=installState.detail?.versions;
  if(!vs||!vs.length){sec.hidden=true;return}
  sec.hidden=false;
  sel.innerHTML=vs.map((v,i)=>`<option value="${esc(v.id)}">${esc(v.number)} — ${new Date(v.date).toLocaleDateString()} · ${imFmtBytes(v.size)} · ${(v.gameVersions||[]).slice(-1)[0]||'?'}</option>`).join('');
  sel.onchange=()=>{installState.versionId=sel.value;imRenderCompat();imRenderWarns()};
}
function imSetDone(r){
  installState.done=true;installState.busy=false;
  const card=$('#installModal .im');if(card){card.classList.remove('installing');card.classList.add('success')}
  $('#imProgressSection').hidden=false;
  $('#imPhase').textContent=t('im.installed');
  $('#imBar').style.width='100%';$('#imBar').classList.add('ok');
  $('#imBarLabel').textContent=(r.installed!=null?`${r.installed} file(s) installed${r.skipped?`, ${r.skipped} client-only skipped`:''}`:(r.name||'OK'))+t('im.restartNote');
  $('#imFileWrap').hidden=true;
  const btn=$('#imInstall');btn.disabled=false;btn.textContent='Close';
  $('#imCancel').hidden=true;
  $('#imNote').textContent='';
  state.files=r.files||state.files;refreshUI();
}
function imSetError(msg){
  installState.busy=false;
  const card=$('#installModal .im');if(card)card.classList.remove('installing');
  const btn=$('#imInstall');btn.disabled=false;btn.textContent='Retry';
  $('#imCancel').hidden=false;$('#imCancel').disabled=false;$('#imClose').disabled=false;
  $('#imProgressSection').hidden=false;
  $('#imPhase').textContent=t('im.failed');
  $('#imBar').style.width='100%';$('#imBar').classList.remove('ok');$('#imBar').classList.add('bad');
  $('#imBarLabel').textContent=msg;
}
async function startInstall(){
  const {item,versionId}=installState;
  imSetBusy(true,t('im.downloading'),t('nsw.latestSub'));
  $('#imBar').style.width='0%';$('#imBar').classList.remove('ok','bad');
  try{
    let r;
    if(item.kind==='modpack')r=await window.observer.installMarketModpack({id:item.id,version:item.version,versionId:versionId||undefined});
    else r=await window.observer.marketInstall({...item,versionId:versionId||undefined});
    if(r.ok){imSetDone(r);toast(t('toast.installed',{n:r.name||item.title}),'success')}
    else imSetError(r.error||'Install failed.');
  }catch(e){imSetError(e?.message||'Install failed.')}
}
function openInstallModal(item){
  installState={item,detail:null,versionId:null,busy:false,done:false};
  const card=$('#installModal .im');if(card)card.classList.remove('installing','success');
  $('#installModal').hidden=false;
  $('#imTitle').textContent=item.title||'—';
  $('#imMeta').textContent=`${item.author||'Unknown author'} · ${item.source} · ${Number(item.downloads||0).toLocaleString()} downloads`;
  $('#imKind').textContent=item.kind;
  $('#imDesc').textContent=item.description||'';
  $('#imIcon').src=item.icon||'';
  $('#imIcon').style.visibility=item.icon?'visible':'hidden';
  $('#imNote').textContent='';
  $('#imProgressSection').hidden=true;
  $('#imBar').classList.remove('ok','bad');
  const btn=$('#imInstall');btn.disabled=true;btn.textContent='Loading…';
  $('#imCancel').hidden=false;$('#imCancel').disabled=false;$('#imClose').disabled=false;
  $('#imCompat').innerHTML='<span class="nsw2-chiploading">Checking compatibility…</span>';
  $('#imWarns').innerHTML='';
  window.observer.marketDetail(item).then(d=>{
    if(installState.item!==item)return; // modal was reopened for another item meanwhile
    if(!d||!d.ok){$('#imCompat').innerHTML=`<span class="im-badge bad">Could not load details: ${esc(d?.error||'unknown')}</span>`;const b2=$('#imInstall');b2.disabled=false;b2.textContent='Install anyway';return}
    installState.detail=d;
    imRenderVersionPicker();
    installState.versionId=installState.detail.versions?.[0]?.id||null;
    imRenderCompat();imRenderWarns();
    const b2=$('#imInstall');b2.disabled=false;b2.textContent='Install';
  });
}
function closeInstallModal(){const m=$('#installModal');if(installState.busy)return toast('Wait for the install to finish — closing now would leave a half-written file.','error');if(m.hidden)return;m.classList.add('closing');setTimeout(()=>{m.hidden=true;m.classList.remove('closing')},140);installState.done=false;const btn=$('#imInstall');btn.textContent='Install'}
$('#imClose').onclick=closeInstallModal;
$('#imCancel').onclick=closeInstallModal;
$('#imInstall').onclick=()=>{if(installState.done)return closeInstallModal();if(installState.busy)return;startInstall()};
window.observer.onMarketProgress(p=>{
  if(!p)return;const sec=$('#imProgressSection');if(sec.hidden&&installState.busy)sec.hidden=false;
  if(p.phase==='extract'){$('#imPhase').textContent=t('im.extracting');$('#imBar').classList.add('indeterminate');$('#imBarLabel').textContent=p.name;return}
  $('#imBar').classList.remove('indeterminate');
  if(p.phase==='pack'||(p.phase==='file'&&!p.index)){
    // single archive / single file download — bytes only
    $('#imPhase').textContent=t('im.downloading');
    const pct=p.total?Math.min(100,Math.round(p.received/p.total*100)):0;
    $('#imBar').style.width=pct+'%';
    $('#imBarLabel').textContent=`${p.name} — ${imFmtBytes(p.received)} / ${imFmtBytes(p.total)} (${pct}%)`;
    return;
  }
  if(p.phase==='modpack'){
    // per-file install: `total` = file count, `fileTotal` = current file's bytes (never mixed)
    $('#imPhase').textContent=t('im.installingFiles',{a:p.index,b:p.total});
    const frac=(p.received||0)/((p.fileTotal||1));
    const pct=Math.min(100,Math.round(((p.index-1)+Math.min(1,frac))/p.total*100));
    $('#imBar').style.width=pct+'%';
    $('#imBarLabel').textContent=t('im.filesOf',{a:p.index,b:p.total});
    const fw=$('#imFileWrap');fw.hidden=false;
    const fp=p.fileTotal?Math.min(100,Math.round((p.received||0)/p.fileTotal*100)):0;
    $('#imFileBar').style.width=fp+'%';
    $('#imFileName').textContent=`${p.name} — ${imFmtBytes(p.received)} / ${imFmtBytes(p.fileTotal)} (${fp}%)`;
  }
});
function isProxyServer(){return /velocity/i.test(state.files?.jar||'')}
const PROPERTY_META={
  'motd':{l:'Server message (MOTD)',h:'Shown in the multiplayer server list',g:'gameplay'},
  'max-players':{l:'Max players',h:'Highest number of players allowed online at once',g:'gameplay'},
  'difficulty':{l:'Difficulty',h:'peaceful, easy, normal or hard',g:'gameplay'},
  'gamemode':{l:'Game mode',h:'survival, creative, adventure or spectator',g:'gameplay'},
  'hardcore':{l:'Hardcore mode',h:'Players are banned instead of respawning on death',g:'gameplay'},
  'pvp':{l:'PvP enabled',h:'Allow players to damage each other',g:'gameplay'},
  'force-gamemode':{l:'Force gamemode on join',h:'Overrides a player\'s saved gamemode with the server default',g:'gameplay'},
  'allow-flight':{l:'Allow flight',h:'Survival players won\'t be kicked for flying (needed for some mods)',g:'gameplay'},
  'spawn-monsters':{l:'Spawn monsters',h:'Allow hostile mobs to spawn',g:'gameplay'},
  'spawn-animals':{l:'Spawn animals',h:'Allow passive mobs to spawn',g:'gameplay'},
  'spawn-npcs':{l:'Spawn villagers',h:'Allow villages to generate villagers',g:'gameplay'},
  'allow-nether':{l:'Allow the Nether',h:'Disable to remove Nether portals entirely',g:'gameplay'},
  'player-idle-timeout':{l:'Kick idle players after (minutes)',h:'0 disables the idle kick',g:'gameplay'},
  'level-name':{l:'World folder name',h:'The folder name of the primary world',g:'world'},
  'level-seed':{l:'World seed',h:'Leave blank for a random seed',g:'world'},
  'level-type':{l:'World type',h:'minecraft:normal, flat, large_biomes, amplified…',g:'world'},
  'generate-structures':{l:'Generate structures',h:'Villages, temples, strongholds, etc.',g:'world'},
  'generator-settings':{l:'Generator settings (JSON)',h:'Advanced flat/custom world generation options',g:'world'},
  'spawn-protection':{l:'Spawn protection radius',h:'Blocks around spawn only ops can edit',g:'world'},
  'max-world-size':{l:'Max world border (blocks)',h:'Radius from spawn the world can generate to',g:'world'},
  'view-distance':{l:'View distance (chunks)',h:'How far terrain is sent to players — big impact on performance',g:'world'},
  'simulation-distance':{l:'Simulation distance (chunks)',h:'How far mobs/redstone/etc. keep ticking — big impact on performance',g:'world'},
  'entity-broadcast-range-percentage':{l:'Entity broadcast range %',h:'How far away entities are visible to players',g:'world'},
  'max-tick-time':{l:'Max tick time before watchdog restart (ms)',h:'0 disables the watchdog',g:'network'},
  'server-port':{l:'Server port',h:'The port players connect to (default 25565)',g:'network'},
  'server-ip':{l:'Bind IP address',h:'Usually left blank to bind all network interfaces',g:'network'},
  'network-compression-threshold':{l:'Network compression threshold',h:'Packets larger than this many bytes get compressed',g:'network'},
  'use-native-transport':{l:'Use native transport',h:'Linux performance optimization, has no effect on Windows',g:'network'},
  'prevent-proxy-connections':{l:'Prevent proxy/VPN connections',h:'Blocks connections detected as coming through a proxy',g:'network'},
  'enable-jmx-monitoring':{l:'Enable JMX monitoring',h:'Exposes server stats for external monitoring tools',g:'network'},
  'online-mode':{l:'Online-mode (verify accounts)',h:'Off = cracked/offline accounts can join',g:'security'},
  'white-list':{l:'Whitelist enabled',h:'Only listed players can join',g:'security'},
  'enforce-whitelist':{l:'Enforce whitelist immediately',h:'Kicks already-connected players who aren\'t whitelisted',g:'security'},
  'op-permission-level':{l:'Default OP permission level',h:'1-4, higher levels allow more commands',g:'security'},
  'function-permission-level':{l:'Function/command block permission level',h:'1-4',g:'security'},
  'enable-command-block':{l:'Enable command blocks',h:'',g:'security'},
  'enable-rcon':{l:'Enable RCON',h:'Remote console access for external tools',g:'security'},
  'rcon.port':{l:'RCON port',h:'',g:'security'},
  'rcon.password':{l:'RCON password',h:'',g:'security'},
  'broadcast-console-to-ops':{l:'Broadcast console to ops',h:'',g:'security'},
  'broadcast-rcon-to-ops':{l:'Broadcast RCON to ops',h:'',g:'security'},
  'enable-query':{l:'Enable GameSpy query protocol',h:'Lets server-list sites query player counts',g:'security'},
  'query.port':{l:'Query port',h:'',g:'security'},
  'resource-pack':{l:'Resource pack URL',h:'',g:'security'},
  'resource-pack-sha1':{l:'Resource pack SHA-1',h:'',g:'security'},
  'resource-pack-prompt':{l:'Resource pack prompt message',h:'',g:'security'},
  'require-resource-pack':{l:'Require resource pack',h:'Kicks players who decline the resource pack',g:'security'},
};
const PROPERTY_GROUPS=[{id:'gameplay',label:'Gameplay'},{id:'world',label:'World'},{id:'network',label:'Network & performance'},{id:'security',label:'Security & moderation'}];
// UX rework: booleans render as switches, known enums as selects, everything else as a compact
// text field. The hint lives in the row title (tooltip) instead of a visible line under every
// input — same information, half the noise. data-prop-search/.prop-label/.prop-key are kept so
// the live search keeps working unchanged.
const PROP_ENUMS={difficulty:['peaceful','easy','normal','hard'],gamemode:['survival','creative','adventure','spectator']};
function propRow(k,v){
  const meta=PROPERTY_META[k];const val=String(v??'');const isBool=val==='true'||val==='false';
  const search=esc((meta?.l||k)+' '+k),title=esc(meta?.h||k);
  let ctl;
  if(isBool)ctl=`<span class="prop-ctl"><label class="switch"><input type="checkbox" data-property="${esc(k)}" ${val==='true'?'checked':''}><span class="slider"></span></label></span>`;
  else if(PROP_ENUMS[k])ctl=`<span class="prop-ctl"><select data-property="${esc(k)}">${(PROP_ENUMS[k].includes(val)?PROP_ENUMS[k]:[...PROP_ENUMS[k],val]).map(o=>`<option ${o===val?'selected':''}>${esc(o)}</option>`).join('')}</select></span>`;
  else ctl=`<span class="prop-ctl"><input data-property="${esc(k)}" value="${esc(val)}" placeholder="${esc(meta?.h||'')}" spellcheck="false"></span>`;
  return `<label data-prop-row data-prop-search="${search}" title="${title}" class="prop-row${isBool?' is-bool':''}"><span class="prop-label">${esc(meta?.l||k)}<small class="prop-key">${esc(k)}</small></span>${ctl}</label>`;
}
function renderProperties(props){
  const keys=Object.keys(props);
  const byGroup={};PROPERTY_GROUPS.forEach(g=>byGroup[g.id]=[]);const advanced=[];
  keys.forEach(k=>{const meta=PROPERTY_META[k];if(meta)byGroup[meta.g].push(k);else advanced.push(k)});
  const group=(id,label,arr,advancedG)=>arr.length?`<details class="prop-group${advancedG?' prop-advanced':''}" data-group-id="${id}" ${advancedG?'':'open'}><summary>${esc(label)}<span class="prop-count">${arr.length}</span><i class="prop-chevron">▸</i></summary><div class="properties-grid">${arr.map(k=>propRow(k,props[k])).join('')}</div></details>`:'';
  $('#propertiesGrid').innerHTML=PROPERTY_GROUPS.map(g=>group(g.id,t('prop.group.'+g.id),byGroup[g.id])).join('')+group('advanced',t('prop.advanced'),advanced,true);
}
async function refreshProxyProperties(){const r=await window.observer.readRawProperties();if(r.ok)$('#propertiesRaw').value=r.content}
let uptimeStart=null;
// BUGFIX: the server.properties / velocity.toml editors used to be re-rendered on EVERY refreshUI()
// call (each incoming server:files / server:state event — a whitelist toggle, start/stop, etc.),
// silently wiping whatever the user had typed but not applied yet. While this flag is set, refreshUI
// skips re-rendering both editors; it clears on Apply or when the server folder changes.
let propsDirty=false;
function updateUptime(){const el=$('#heroUptime');if(!el)return;if(!uptimeStart){el.textContent='—';return}const secs=Math.max(0,Math.floor((Date.now()-uptimeStart)/1000));const h=String(Math.floor(secs/3600)).padStart(2,'0'),m=String(Math.floor(secs%3600/60)).padStart(2,'0'),s=String(secs%60).padStart(2,'0');el.textContent=`${h}:${m}:${s}`}
setInterval(updateUptime,1000);
// FEATURE: capability-aware diagnostics — shows what this launcher can measure natively for THIS
// server (TPS/MSPT via Paper's built-in commands, players via /list) and offers manual commands.
// The old panel auto-detected Spark and pushed "spark ..." console commands on a timer; that
// automation is gone (it spammed unknown-command errors on servers without it and duplicated what
// Paper already reports natively). Deep profiling stays available as a MANUAL Marketplace install.
function renderPerfDiagnostics(){
  const n=$('#perfDiagnostics');if(!n)return;
  const jar=String(state.files?.jar||'');
  const proxy=/velocity|bungee|waterfall/i.test(jar);
  const paperLike=/paper|purpur|leaf|folia/i.test(jar)||!!state.files?.hasSpigotConfig;
  const L={full:t('perf.badgeFull'),partial:t('perf.badgePartial'),bodyF:t('perf.diagBodyFull'),bodyP:t('perf.diagBodyPartial'),tpsOk:t('perf.diagTpsOk'),tpsNo:t('perf.diagTpsNo'),msptOk:t('perf.diagMsptOk'),msptNo:t('perf.diagMsptNo'),plOk:t('perf.diagPlayersOk'),list:t('perf.diagListBtn'),spark:t('perf.diagSparkBtn'),hint:t('perf.diagSparkHint')};
  if(proxy){n.innerHTML=`<div class="diag-head"><span class="diag-icon">◆</span><div><b>Proxy detected</b><p>Velocity proxies don't tick a world — TPS/MSPT belong to the backend servers behind it.</p></div><span class="diag-badge">N/A</span></div>`;return}
  const tps=paperLike?L.tpsOk:L.tpsNo;
  const mspt=paperLike?L.msptOk:L.msptNo;
  n.innerHTML=`
    <div class="diag-head"><span class="diag-icon ${paperLike?'ok':''}">${paperLike?'✓':'◆'}</span><div><b>${t('perf.diagT')}</b><p>${paperLike?L.bodyF:L.bodyP}</p></div><span class="diag-badge ${paperLike?'ok':''}">${paperLike?L.full:L.partial}</span></div>
    <ul class="diag-benefits"><li>${paperLike?'✓':'○'} ${tps}</li><li>${paperLike?'✓':'○'} ${mspt}</li><li>✓ ${L.plOk}</li></ul>
    <div class="diag-actions">
      ${paperLike?`<button class="btn secondary" data-command="tps">${t('perf.requestTps')}</button><button class="btn secondary" data-command="tick query">Query tick times</button>`:''}
      <button class="btn secondary" data-command="list">${L.list}</button>
      <button class="btn secondary" data-tab-jump="marketplace">${L.spark}</button>
      <span class="diag-hint">${L.hint}</span>
    </div>`;
  n.querySelectorAll('[data-command]').forEach(b=>b.onclick=()=>command(b.dataset.command));
  n.querySelectorAll('[data-tab-jump]').forEach(b=>b.onclick=()=>switchTab(b.dataset.tabJump));
}
function refreshUI(){const s=state.settings,f=state.files;currentLocale=s.locale||'en';$('#languageSelect').value=currentLocale;applyLocale();$('#serverFolderInput').value=s.serverPath||'';$('#javaPathInput').value=s.javaPath||'';$('#memoryMinInput').value=s.memoryMin??2;$('#memoryMaxInput').value=s.memoryMax??6;$('#jvmArgsInput').value=s.jvmArgs||'';$('#autoEulaInput').checked=!!s.autoEula;$('#autoRestartInput').checked=!!s.autoRestart;$('#autoBackupMinutesInput').value=s.autoBackupMinutes??0;$('#autoRestartMaxAttemptsInput').value=s.autoRestartMaxAttempts??3;$('#autoRestartDelaySecondsInput').value=s.autoRestartDelaySeconds??5;syncAutoRestartFields();syncBackupChips(s.autoBackupMinutes??0);if(state.systemMemoryGB)$('#systemRamHint').textContent=`Your system has about ${state.systemMemoryGB} GB of RAM. When set, JVM args override the two memory fields above.`;$('#serverPath').textContent=s.serverPath||t('top.noServer');$('#serverName').textContent=s.serverPath?s.serverPath.split(/[\\/]/).filter(Boolean).pop():'Your Minecraft server';$('#serverHint').textContent=s.serverPath?(state.status==='starting'?t('ov.hintStarting',{n:f.jar||f.launchScript||'server'}):state.status==='stopping'?t('top.stopping'):state.running?t('ov.hintRunning',{n:f.jar||f.launchScript||'server'}):(f.jar?t('ov.hintReady',{n:f.jar}):(f.launchScript?t('ov.hintReady',{n:f.launchScript}):t('ov.hintNone')))):t('ov.hintSelect');const statusLabel={starting:t('top.starting'),running:t('top.running'),stopping:t('top.stopping'),stopped:t('top.offline')}[state.status||(state.running?'running':'stopped')]||t('top.offline');$('#metricStatus').textContent=statusLabel;$('#statusText').textContent=statusLabel;const sd=$('#statusDot');sd.className='status-dot st-'+(state.status||'stopped');const heroDot=$('#heroDot');if(heroDot)heroDot.className='metric-hero-dot status-dot lg st-'+(state.status||'stopped');if(state.running&&!uptimeStart)uptimeStart=Date.now();if(!state.running)uptimeStart=null;updateUptime();$('#startBtn').disabled=state.status!=='stopped';$('#stopBtn').disabled=!(state.status==='running'||state.status==='starting');
  const proxy=isProxyServer();$('#eulaStatus').textContent=proxy?t('ov.eulaProxy'):(state.eulaAccepted?t('set.eulaOk').replace('✓ ',''):t('ov.eulaPending'));
  $('#worldsProxyNotice').hidden=!proxy;$('#playersProxyNotice').hidden=!proxy;
  $('#propertiesGrid').hidden=proxy;$('#propertiesRaw').hidden=!proxy;$('#saveProperties').textContent=proxy?'Save velocity.toml':t('prop.apply');
  const pt=$('.prop-toolbar');if(pt)pt.hidden=proxy;
  $('#propertiesTitle').textContent=proxy?'Proxy configuration (velocity.toml)':t('prop.title');$('#propertiesHint').textContent=proxy?'Raw file — Velocity generates this on first run, edit carefully (real TOML syntax).':t('prop.sub');
  if(proxy){ if(!propsDirty) refreshProxyProperties(); } else if(!propsDirty) renderProperties(f.properties||{});
   renderFiles('#pluginsList',f.plugins||[],'plugin');renderFiles('#modsList',f.mods||[],'mod');renderFiles('#datapacksList',f.datapacks||[],'datapack');renderWorlds(f.worlds||[]);renderBackups(f.backups||[]);
   const wc=$('#worldsCountPill'), bc=$('#backupsCountPill'), be=$('#backupEmpty'); if(wc) wc.textContent=String((f.worlds||[]).length); if(bc) bc.textContent=String((f.backups||[]).length); if(be) be.hidden=(f.backups||[]).length>0;
   const cpc=$('#contentPluginsCount'), cmc=$('#contentModsCount'), cdc=$('#contentDatapacksCount'); if(cpc) cpc.textContent=String((f.plugins||[]).length); if(cmc) cmc.textContent=String((f.mods||[]).length); if(cdc) cdc.textContent=String((f.datapacks||[]).length);
   const abs=$('#autoBackupStatus');if(abs){const mins=s.autoBackupMinutes||0;abs.innerHTML=mins>0?t('wld.autoOn',{n:mins})+' · <button class="text-btn" data-tab-jump="settings">'+t('wld.configure')+'</button>':t('wld.autoOff')+' · <button class="text-btn" data-tab-jump="settings">'+t('wld.turnOn')+'</button>';abs.querySelectorAll('[data-tab-jump]').forEach(b=>b.onclick=()=>switchTab(b.dataset.tabJump))}
  renderPlayers();renderPerfDiagnostics();const j=state.java||{},n=$('#javaNotice');const is32=j.ok&&j.arch==='32-bit';n.className='java-notice '+(!j.ok?'bad':is32?'warn':'ok');n.textContent=!j.ok?t('set.javaBad',{m:j.message||'Set a Java path or use java from PATH.'}):is32?t('set.java32',{v:j.version,p:j.path}):t('set.javaOk',{v:j.version,p:j.path});$('#javaAutoInstall').hidden=!!j.ok;
  // Launcher settings extras: folder health line + effective launch command preview.
  const fsEl=$('#folderStatus');
  if(fsEl){
    if(!s.serverPath){fsEl.textContent=t('set.folderNone');fsEl.className='field-hint folder-status'}
    else{
      const parts=[f.jar?tf('set.jarOk',{n:f.jar}):f.launchScript?tf('set.jarOk',{n:f.launchScript}):t('set.noJar'),state.eulaAccepted?t('set.eulaOk'):t('set.eulaPending')];
      fsEl.textContent=parts.join(' · ');
      fsEl.className='field-hint folder-status '+((f.jar||f.launchScript)?'ok':'');
    }
  }
  renderJvmPreview();
  // Java compatibility banner — proactive warning + one-click fix
  const jw=$('#javaWarnBanner');
  if(jw){
    const need=state.javaRequired||null;
    const have=(j.ok&&j.version)?(javaMajorOf(j.version)):null;
    const mismatch=need&&have&&have<need;
    jw.hidden=!mismatch;
    if(mismatch){
      $('#javaWarnText').textContent=t('ov.javaMismatch',{need,have});
      $('#javaFixBtn').textContent=t('ov.fixJava')+' '+need;
      $('#javaFixBtn').onclick=async()=>{
        $('#javaFixBtn').disabled=true;$('#javaFixBtn').textContent='…';
        const r=await window.observer.javaAutoInstall();
        $('#javaFixBtn').disabled=false;
        if(r&&r.ok){state.java=r.java;state.settings={...state.settings,javaPath:r.java.path};markSettingsSaved();refreshUI();toast(t('toast.javaInstalled',{v:r.java.version}),'success')}
        else toast(r?.error||'Install failed','error');
      };
    }
  }
  const er=$('#edRunning');if(er&&!$('#fileEditor').hidden)er.hidden=!state.running;
  // console live dot
  const cd=$('#consoleLiveDot'), cl=$('#consoleLiveLabel'); if(cd&&cl){ cd.className='live-dot'+(state.status==='running'?' on':state.status==='starting'||state.status==='stopping'?' busy':''); cl.textContent={starting:t('top.starting'),running:t('con.live'),stopping:t('top.stopping'),stopped:t('top.offline')}[state.status||'stopped']||t('top.offline'); }
  // P0.1: disable Start when no folder / no runnable jar, highlight welcome card
  const hasFolder=!!s.serverPath; const hasJar=!!(f.jar||f.launchScript); const startBtn=$('#startBtn'), stopBtn=$('#stopBtn'), welcomeCard=$('#welcomeCard');
  const canStart=hasFolder && hasJar && !!j.ok && state.status==='stopped';
  if(startBtn){startBtn.disabled=!canStart; if(!hasFolder||!hasJar) startBtn.title=!hasFolder?'Choose a server folder first':!j.ok?'Java not detected — install or set Java path':'No runnable server .jar or run.bat found in this folder'; else if(state.status!=='stopped') startBtn.title={starting:'Server is starting…', stopping:'Server is stopping…', running:'Server is already running'}[state.status]||''; else startBtn.title='';}
  if(stopBtn) stopBtn.disabled=state.status==='stopped';
  if(welcomeCard) welcomeCard.classList.toggle('needs-attention', !hasFolder || !hasJar);
  requestAnimationFrame(()=>{metricChart($('#miniChart'));metricChart($('#perfTickChart'),true,'tick');metricChart($('#perfResourceChart'),true,'resource')})}
function syncAutoRestartFields(){const on=$('#autoRestartInput').checked;const f=$('#autoRestartFields');if(f)f.hidden=!on}
$('#autoRestartInput').addEventListener('change',syncAutoRestartFields);
const BACKUP_PRESETS=[0,15,30,60];
function syncBackupChips(mins){
  const isPreset=BACKUP_PRESETS.includes(mins);
  $$('.backup-chip-row .filter-chip').forEach(c=>c.classList.toggle('active',isPreset?c.dataset.backupMins==String(mins):c.id==='backupCustomChip'));
  const row=$('#backupCustomRow');if(row)row.hidden=isPreset;
  if(!isPreset){const ci=$('#autoBackupCustomInput');if(ci)ci.value=mins||''}
}
$$('.backup-chip-row .filter-chip').forEach(chip=>chip.onclick=()=>{
  const v=chip.dataset.backupMins;
  if(v==='custom'){
    $$('.backup-chip-row .filter-chip').forEach(c=>c.classList.toggle('active',c===chip));
    $('#backupCustomRow').hidden=false;
    $('#autoBackupCustomInput').focus();
    return;
  }
  $('#autoBackupMinutesInput').value=v;syncBackupChips(Number(v));
});
$('#autoBackupCustomInput')?.addEventListener('input',()=>{$('#autoBackupMinutesInput').value=Number($('#autoBackupCustomInput').value)||0});
function getSettings(){return{serverPath:$('#serverFolderInput').value.trim(),javaPath:$('#javaPathInput').value.trim(),memoryMin:Number($('#memoryMinInput').value)||2,memoryMax:Number($('#memoryMaxInput').value)||6,jvmArgs:$('#jvmArgsInput').value.trim(),autoEula:$('#autoEulaInput').checked,autoRestart:$('#autoRestartInput').checked,autoRestartMaxAttempts:Number($('#autoRestartMaxAttemptsInput').value)||3,autoRestartDelaySeconds:Number($('#autoRestartDelaySecondsInput').value)||5,autoBackupMinutes:Number($('#autoBackupMinutesInput').value)||0,locale:$('#languageSelect').value}}
// Launcher settings polish: an "unsaved changes" dot on Apply, a folder health line and a live
// preview of the exact command line the launcher will run for this server.
let settingsDirty=false;
function updateApplyDirty(){const b=$('#saveSettings');if(b)b.classList.toggle('dirty',settingsDirty)}
function markSettingsSaved(){settingsDirty=false;updateApplyDirty()}
function renderJvmPreview(){
  const el=$('#jvmPreview');if(!el)return;
  const s=state.settings||{},f=state.files||{};
  const jar=f.jar||f.launchScript;
  if(!jar){el.hidden=true;return}
  const custom=String(s.jvmArgs||'').trim();
  const args=custom?custom:`-Xms${s.memoryMin||2}G -Xmx${s.memoryMax||6}G`;
  el.hidden=false;
  el.textContent=`${(state.java&&state.java.path)||'java'} ${args} -jar ${jar}${/velocity/i.test(jar)?'':' nogui'}`;
}
(function(){
  const sec=$('#settings');if(!sec)return;
  const onEdit=e=>{if(e.target.closest('#settings')&&!e.target.closest('#newServerModal')){settingsDirty=true;updateApplyDirty()}};
  sec.addEventListener('input',onEdit);sec.addEventListener('change',onEdit);
})();
$('#jvmArgsInput')?.addEventListener('input',renderJvmPreview);
function logLevel(line){if(line.type==='error')return'error';if(line.type==='command')return'command';if(line.type==='system')return'system';const t=line.text||'';if(/\]:\s*\[?WARN/i.test(t)||/\/WARN\]/i.test(t)||/^WARNING:/i.test(t.trim()))return'warn';if(/\/ERROR\]/i.test(t)||/\/SEVERE\]/i.test(t))return'error';return'info'}
let logFilter='all',logPaused=false;
let logQueue=[], logFlushScheduled=false;
function flushLogs(){
  const o=$('#logOutput'); if(!o || !logQueue.length){ logFlushScheduled=false; return; }
  const wasAtBottom=o.scrollHeight - o.scrollTop - o.clientHeight < 40;
  const frag=document.createDocumentFragment();
  let added=0, lastVisible=null;
  while(logQueue.length && added<80){
    const line=logQueue.shift();
    const d=document.createElement('div'), level=logLevel(line);
    d.className=`log-line ${line.type||''}`; d.dataset.level=level;
    d.innerHTML=`<span class="time">${esc(line.time)}</span> ${esc(line.text)}`;
    if(logFilter!=='all'&&level!==logFilter) d.hidden=true; else lastVisible=d;
    frag.appendChild(d); added++;
  }
  o.classList.add('has-content'); o.appendChild(frag);
  const empty=$('#logEmpty'); if(empty) empty.hidden=true;
  while(o.children.length>2000) o.removeChild(o.firstChild);
  if(wasAtBottom && !logPaused) o.scrollTop=o.scrollHeight;
  else if(lastVisible && !lastVisible.hidden){ const j=$('#logJump'); if(j) j.hidden=false; }
  if(logQueue.length) requestAnimationFrame(flushLogs); else logFlushScheduled=false;
}
function addLog(line){ logQueue.push(line); if(!logFlushScheduled){ logFlushScheduled=true; requestAnimationFrame(flushLogs); } }
function addLogsBatch(lines){ if(!lines||!lines.length) return; logQueue.push(...lines); if(!logFlushScheduled){ logFlushScheduled=true; requestAnimationFrame(flushLogs); } }
const channelOrder=['overview','console','players','performance','content','marketplace','worlds','properties'];
function positionChannelIndicator(){const nav=$('#nav'),ind=$('#channelIndicator');if(!nav||!ind)return;const active=nav.querySelector('.nav-item.active');if(!active){ind.style.opacity='0';return} // rail is vertical — indicator is left border via CSS, no horizontal calc needed
  ind.style.opacity='0'; }
function switchTab(tab){
  $$('.nav-item').forEach(b=>{ const on=b.dataset.tab===tab; b.classList.toggle('active',on); b.setAttribute('aria-current', on?'page':'false'); });
  $$('.tab').forEach(s=>s.classList.toggle('active',s.id===tab));
  $('#pageTitle').textContent=t('nav.'+tab)||titles[tab];
  const ci=$('#channelIndex'),idx=channelOrder.indexOf(tab);if(ci)ci.textContent=idx>-1?`${String(idx+1).padStart(2,'0')} / ${String(channelOrder.length).padStart(2,'0')}`:'—';
  positionChannelIndicator();
  // a11y: focus the new tab panel for screen readers
  const panel=document.getElementById(tab); if(panel){ panel.setAttribute('tabindex','-1'); panel.focus({preventScroll:true}); }
  if(tab==='marketplace'&&!$('#marketResults').innerHTML)$('#marketSearch').click();
  if(tab==='performance'){window.observer.getFiles().then(r=>{if(r.ok){state.files=r.files;state.javaRequired=r.javaRequired??state.javaRequired;renderPerfDiagnostics()}}); requestAnimationFrame(()=>{ requestAnimationFrame(()=>{ try{metricChart($('#perfTickChart'),true,'tick'); metricChart($('#perfResourceChart'),true,'resource'); metricChart($('#miniChart'));}catch{}})}); }
  if(tab==='players')window.observer.getFiles().then(r=>{if(r.ok){state.files=r.files;state.javaRequired=r.javaRequired??state.javaRequired;renderPlayers()}});
  if(tab==='content')window.observer.getFiles().then(r=>{if(r.ok){state.files=r.files;state.javaRequired=r.javaRequired??state.javaRequired;refreshUI()}});
}
async function command(c){if(!c.trim())return;const r=await window.observer.command(c);if(!r.ok)toast(r.error)}
let cmdHistory=[],cmdHistoryIdx=-1;
function pushCmdHistory(c){c=c.trim();if(!c)return;cmdHistory=cmdHistory.filter(x=>x!==c);cmdHistory.unshift(c);if(cmdHistory.length>8)cmdHistory.length=8;cmdHistoryIdx=-1;renderRecentCommands()}
function renderRecentCommands(){const wrap=$('#recentCommands'),group=$('#recentCommandsGroup');if(!wrap||!group)return;if(!cmdHistory.length){group.hidden=true;return}group.hidden=false;wrap.innerHTML='';cmdHistory.forEach(c=>{const b=document.createElement('button');b.textContent=c;b.title=c;b.onclick=()=>command(c);wrap.append(b)})}
async function chooseFolder(opts){const f=await window.observer.pickFolder(opts);if(f){const next={...getSettings(),serverPath:f};const r=await window.observer.saveSettings(next);state={...state,settings:next,java:r.java,files:r.files,eulaAccepted:r.eulaAccepted,javaRequired:r.javaRequired??state.javaRequired};propsDirty=false;markSettingsSaved();refreshUI();loadConnectInfo();toast(t('toast.folderSaved'))}return f}
$$('.nav-item').forEach(b=>b.onclick=()=>switchTab(b.dataset.tab));
$('#nav')?.addEventListener('keydown', e=>{
  const items=[...$$('.nav-item')]; const idx=items.indexOf(document.activeElement);
  if(e.key==='ArrowDown' || e.key==='ArrowRight'){ e.preventDefault(); items[(idx+1)%items.length]?.focus(); }
  else if(e.key==='ArrowUp' || e.key==='ArrowLeft'){ e.preventDefault(); items[(idx-1+items.length)%items.length]?.focus(); }
  else if(e.key==='Home'){ e.preventDefault(); items[0]?.focus(); }
  else if(e.key==='End'){ e.preventDefault(); items[items.length-1]?.focus(); }
});
$$('[data-tab-jump]').forEach(b=>b.onclick=()=>switchTab(b.dataset.tabJump));$$('[data-market-jump]').forEach(b=>b.onclick=()=>jumpToMarket(b.dataset.marketJump));$$('[data-command]').forEach(b=>b.onclick=()=>{pushCmdHistory(b.dataset.command);command(b.dataset.command)});$$('[data-open]').forEach(b=>b.onclick=()=>window.observer.openFiles(b.dataset.open));$$('[data-import]').forEach(b=>b.onclick=async()=>{const r=await window.observer.importContent(b.dataset.import);if(r.ok){state.files=r.files;refreshUI();toast('Content imported. Restart the server before using it.')}else if(!r.cancelled)toast(r.error)});
$('#chooseFolder').onclick=chooseFolder;$('#browseBtn').onclick=chooseFolder;$('#welcomeCreateBtn')?.addEventListener('click', async()=>{ const folder=await chooseFolder({suggestNew:true,title:'Choose (or create) an empty folder for your new server'}); if(folder) openNewServerWizard(); });$('#clearConsole').onclick=()=>{const o=$('#logOutput');o.innerHTML=`<div class="log-empty" id="logEmpty"><b>${t('con.empty')}</b><span>${t('con.emptySub')}</span></div>`;o.classList.remove('has-content');const j=$('#logJump');if(j)j.hidden=true};$('#commandForm').onsubmit=async e=>{e.preventDefault();const v=$('#commandInput').value;pushCmdHistory(v);await command(v);$('#commandInput').value=''};
$$('.log-filters .filter-chip').forEach(chip=>chip.onclick=()=>{
  logFilter=chip.dataset.logFilter;
  $$('.log-filters .filter-chip').forEach(c=>{ const on=c===chip; c.classList.toggle('active',on); c.setAttribute('aria-pressed', on?'true':'false'); });
  $$('#logOutput .log-line').forEach(el=>{el.hidden=logFilter!=='all'&&el.dataset.level!==logFilter});
  const countVisible=$$('#logOutput .log-line:not([hidden])').length;
  const hint=$('.log-hint'); if(hint) hint.textContent=countVisible?`${countVisible} · ${t('con.tip')}`:`${t('con.filterAll')}: 0`;
});
document.addEventListener('keydown', e=>{
  const isConsole=document.getElementById('console')?.classList.contains('active');
  if(!isConsole) return;
  if((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='l'){ e.preventDefault(); $('#clearConsole')?.click(); }
  if(e.key==='/' && !e.ctrlKey && document.activeElement?.tagName!=='INPUT' && document.activeElement?.tagName!=='TEXTAREA'){ e.preventDefault(); $('#commandInput')?.focus(); }
});
const logOutputEl=$('#logOutput');if(logOutputEl)logOutputEl.addEventListener('scroll',()=>{const atBottom=logOutputEl.scrollHeight-logOutputEl.scrollTop-logOutputEl.clientHeight<40;logPaused=!atBottom;if(atBottom){const j=$('#logJump');if(j)j.hidden=true}});
const logJumpEl=$('#logJump');if(logJumpEl)logJumpEl.onclick=()=>{logOutputEl.scrollTop=logOutputEl.scrollHeight;logJumpEl.hidden=true;logPaused=false};
const cmdInputEl=$('#commandInput');if(cmdInputEl)cmdInputEl.addEventListener('keydown',e=>{if(e.key==='ArrowUp'){if(!cmdHistory.length)return;e.preventDefault();cmdHistoryIdx=Math.min(cmdHistory.length-1,cmdHistoryIdx+1);cmdInputEl.value=cmdHistory[cmdHistoryIdx]||''}else if(e.key==='ArrowDown'){e.preventDefault();cmdHistoryIdx=Math.max(-1,cmdHistoryIdx-1);cmdInputEl.value=cmdHistoryIdx===-1?'':cmdHistory[cmdHistoryIdx]}});
$('#saveSettings').onclick=async()=>{
  const next=getSettings();
  const folderInput=$('#serverFolderInput'), javaInput=$('#javaPathInput');
  if(folderInput) folderInput.style.borderColor='';
  if(javaInput) javaInput.style.borderColor='';
  if(!next.serverPath){ if(folderInput){ folderInput.style.borderColor='var(--danger)'; folderInput.focus(); } return toast('Server folder is required — choose a folder or create a new server.','error'); }
  if(next.memoryMax < next.memoryMin) return toast('Maximum memory must be at least minimum memory.','error');
  if(next.memoryMax>32) return toast('Maximum memory is very high (>32GB) — ensure your PC has enough RAM.','error');
  if(next.memoryMin<1) return toast('Minimum memory must be at least 1GB.','error');
  if(next.jvmArgs && next.jvmArgs.length>2000) return toast('JVM arguments are too long (>2000 chars).','error');
  if(next.jvmArgs && /["'<>|]/.test(next.jvmArgs)) return toast('JVM arguments contain invalid characters.','error');
  if(state.java?.arch==='32-bit' && next.memoryMax>2) return toast('32-bit Java detected — cannot allocate >2GB RAM. Install 64-bit Java or lower Maximum memory.','error');
  const r=await window.observer.saveSettings(next);
  if(!r.java?.ok && next.javaPath){ if(javaInput){ javaInput.style.borderColor='var(--danger)'; javaInput.focus(); } return toast(`Java not found at "${next.javaPath}" — ${r.java?.message||'check the path or use auto-install.'}`,'error'); }
  state={...state,settings:next,java:r.java,files:r.files,eulaAccepted:r.eulaAccepted,javaRequired:r.javaRequired??state.javaRequired};propsDirty=false;markSettingsSaved();refreshUI();
  toast(r.java?.ok?t('toast.settingsSavedJava',{v:r.java.version}):t('toast.settingsSavedNoJava'),'success');
};
$('#saveRamOverview').onclick=async()=>{
  const next=getSettings();
  if(next.memoryMax<next.memoryMin)return toast('Maximum memory must be at least minimum memory.','error');
  const r=await window.observer.saveSettings(next);state={...state,settings:next,java:r.java,files:r.files,eulaAccepted:r.eulaAccepted,javaRequired:r.javaRequired??state.javaRequired};markSettingsSaved();refreshUI();toast(t('toast.ramSaved'),'success');
};
$('#languageSelect').onchange=async()=>{currentLocale=$('#languageSelect').value;applyLocale();const next={...getSettings(),locale:currentLocale};const r=await window.observer.saveSettings(next);state.settings=next;state.java=r.java;markSettingsSaved();refreshUI();renderJvmPreview();if(!$('#newServerModal').hidden)nswRender();if(!$('#installModal').hidden){imRenderCompat();imRenderWarns()}};
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
$('#createBackup').onclick=async()=>{if(!confirm(t('toast.confirmBackup')))return;const r=await window.observer.createBackup();if(r.ok){state.files=r.files;refreshUI();toast(`Backup created: ${r.name}`)}else toast(r.error)};
let marketItems=[];let marketPage=1;let marketHasNext=false;let marketTotal=null;let marketReqSeq=0;
// FEATURE: replaced "Load more" (which appended to the same growing list, so paging forward meant
// scrolling down and paging back meant scrolling all the way back up) with real Prev/Next pages that
// REPLACE the results and scroll back to the top of the results themselves — no more manual scrolling
// either direction. Modrinth and Hangar report an exact total, so those sources show "Page N of M";
// Spiget (Spigot) doesn't expose a total count at all, so Next just stays enabled as long as the last
// page came back full (the same "probably more" heuristic the old Load More button used).
function debounce(fn,ms){let t;return (...a)=>{clearTimeout(t);t=setTimeout(()=>fn(...a),ms)}}
async function runMarketSearch(page){
  // BUGFIX: rapid typing fired overlapping requests; slower older responses could land AFTER a
  // newer one and overwrite fresh results with stale ones (felt like the search box "not working").
  // A sequence token drops any response that is not the latest request.
  const seq=++marketReqSeq;
  const source=$('#marketSource').value,kind=$('#marketKind').value,query=$('#marketQuery').value.trim(),version=$('#marketVersion').value,status=$('#marketStatus');
  marketPage=page;
  $('#marketSearch').disabled=true;$$('.market-sort').forEach(b=>b.disabled=true);$('#marketPrev').disabled=true;$('#marketNext').disabled=true;status.classList.add('loading'); status.setAttribute('aria-busy','true');
  // skeleton instead of single text line
  $('#marketResults').setAttribute('aria-busy','true');
  $('#marketResults').innerHTML=Array.from({length:4}).map(()=>`<article class="panel glass market-item skeleton" aria-hidden="true"><div class="market-icon skeleton-box"></div><div><div class="skeleton-line w60"></div><div class="skeleton-line w90"></div><div class="skeleton-line w40"></div></div><div class="skeleton-btn"></div></article>`).join('');
  status.textContent=t('mkt.searching');
  const r=await window.observer.marketSearch({source,kind,query,version,sort:marketSort,offset:(page-1)*20});
  if(seq!==marketReqSeq)return; // a newer request superseded this one — drop the stale response
  $('#marketSearch').disabled=false;$$('.market-sort').forEach(b=>b.disabled=false);status.classList.remove('loading'); status.removeAttribute('aria-busy'); $('#marketResults').removeAttribute('aria-busy');
  if(!r.ok){
    status.textContent=`Could not load results: ${r.error}`;
    const n=$('#marketResults');
    n.innerHTML=`<article class="panel glass"><div style="display:flex;gap:12px;align-items:center"><span style="font-size:18px">⚠</span><div><b>Could not load marketplace</b><p class="text-muted" style="margin:4px 0 0">${esc(r.error)}</p></div><button class="btn primary" onclick="document.getElementById('marketSearch').click()">Retry</button></div><p class="text-muted" style="margin-top:10px;font:500 11px var(--font-ui)">Check your internet — Modrinth/Hangar/Spiget need online. Try switching Source to Modrinth.</p></article>`;
    $('#marketPager').hidden=true;
    const countEl=$('#marketplaceCount'); if(countEl) countEl.textContent='error';
    toast(r.error,'error');return;
  }
  marketItems=r.items.map(x=>({...x,kind}));
  marketTotal=r.total??null;
  marketHasNext=marketTotal!=null?page*20<marketTotal:marketItems.length>=20;
  const sortLabel=marketSort==='downloads'?t('mkt.sortDl'):marketSort==='latest'?t('mkt.sortLatest'):t('mkt.sortRel');
  const relaxedNote=r.relaxed==='version'?' (no exact match for that game version — showing all versions)':r.relaxed==='loader'?' (no match for this server type — showing all matching mods/plugins)':'';
  const countLabel=marketTotal!=null?`${marketTotal} ${sortLabel}`:`${marketItems.length} ${sortLabel}`;
  status.textContent=`${countLabel} · ${source}.${relaxedNote}`;
  const countEl=$('#marketplaceCount'); if(countEl) countEl.textContent=marketTotal!=null?tf('mkt.found',{a:marketTotal}):`${marketItems.length}`;
  renderMarket(marketItems);
  $('#marketPager').hidden=!(page>1||marketHasNext);
  $('#marketPrev').disabled=page<=1;$('#marketNext').disabled=!marketHasNext;
  $('#marketPageLabel').textContent=marketTotal!=null?`Page ${page} of ${Math.max(1,Math.ceil(marketTotal/20))}`:`Page ${page}`;
}
$('#marketSearch').onclick=()=>runMarketSearch(1);
$('#marketPrev').onclick=()=>{if(marketPage>1)runMarketSearch(marketPage-1)};
$('#marketNext').onclick=()=>{if(marketHasNext)runMarketSearch(marketPage+1)};
const debouncedMarketSearch=debounce(()=>runMarketSearch(1),400);
$('#marketQuery').addEventListener('input', debouncedMarketSearch);
$('#marketQuery').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault(); runMarketSearch(1)}});
function flashMarketField(el){el.classList.remove('just-changed');void el.offsetWidth;el.classList.add('just-changed')}
$('#marketSource').onchange=e=>{flashMarketField(e.target);runMarketSearch(1)};$('#marketKind').onchange=e=>{flashMarketField(e.target);runMarketSearch(1)};$('#marketVersion').onchange=e=>{flashMarketField(e.target);runMarketSearch(1)};
$$('.market-sort').forEach(b=>b.onclick=()=>{marketSort=b.dataset.sort;$$('.market-sort').forEach(x=>x.classList.toggle('active',x===b));runMarketSearch(1)});
$('#importModpack').onclick=async()=>{const r=await window.observer.importModpack();if(r.cancelled)return;if(!r.ok)return toast(r.error,'error');state.files=r.files;refreshUI();toast(`${r.name} imported — ${r.installed} file(s) installed${r.skipped?`, ${r.skipped} client-only file(s) skipped`:''}. Restart the server to use it.`,'success')};
$('#exportModpack').onclick=async()=>{const r=await window.observer.exportModpack();if(r.cancelled)return;if(!r.ok)return toast(r.error,'error');toast(`Exported ${r.count} item(s) to ${r.path}`,'success')};
window.observer.onBuildDone(v=>{state.files=v.files;refreshUI();toast(v.ok?'Build finished — server jar is ready. Configure settings, then start.':'Build failed — check the Console tab for the error.')});
function manualPlayer(){const name=$('#playerActionName').value.trim();if(!name){toast('Type a name first.');return null}return {uuid:null,name}}
$('#manualOpBtn').onclick=()=>{const p=manualPlayer();if(p)togglePlayerOp(p,true)};
$('#manualWhitelistBtn').onclick=()=>{const p=manualPlayer();if(p)togglePlayerWhitelist(p,true)};
$('#manualBanBtn').onclick=()=>{const p=manualPlayer();if(p&&confirm(`Ban ${p.name}?`))togglePlayerBan(p,true)};
$('#manualKickBtn').onclick=()=>{const p=manualPlayer();if(p&&confirm(`Kick ${p.name}?`))command(`kick ${p.name}`)};
$('#savePlayerData').onclick=async()=>{if(!selectedPlayer)return toast('Choose a player with offline data first.');if(!confirm(`Apply player data for ${selectedPlayer.name}? ObserverLauncher will create a backup first.`))return;const changes={health:$('#pdHealth').value,food:$('#pdFood').value,saturation:$('#pdSaturation').value,xpLevel:$('#pdXpLevel').value,xpTotal:$('#pdXpTotal').value,gameType:$('#pdGameType').value};const r=await window.observer.playerSave({uuid:selectedPlayer.uuid,changes,clearInventory:$('#pdClearInventory').checked});if(!r.ok)return toast(r.error);toast(`Player data saved; backup: ${r.backup}`);refreshUI()};
$('#startBtn').onclick=async()=>{const r=await window.observer.start(getSettings());if(!r.ok){toast(r.error,'error');if(r.error&&r.error.includes('Java')){switchTab('overview');const jw=$('#javaWarnBanner');if(jw&&!jw.hidden)jw.scrollIntoView({behavior:'smooth',block:'center'})}}else toast('Server start requested. Check Console for output.')};$('#stopBtn').onclick=async()=>{const r=await window.observer.stop();if(!r.ok)toast(r.error)};
window.observer.onLog(addLog);window.observer.onState(v=>{state.running=v.running;state.status=v.status||(v.running?'running':'stopped');
  if(state.status==='running'&&!uptimeStart)uptimeStart=Date.now();else if(state.status==='stopped')uptimeStart=null;
  refreshUI()});window.observer.onFiles(f=>{state.files=f.files||f;state.javaRequired=f.javaRequired??state.javaRequired;refreshUI()});let lastLivePlayersKey='';
let lastMetrics=null;
function applyLiveToUI(live){
  try{
    const tpsText = live?.tps?.toFixed?.(2) ?? '—';
    const msptText = live?.mspt?.toFixed?.(2) ?? '—';
    const tpsEl=$('#tps'); if(tpsEl && tpsEl.textContent==='—' && live?.tps!=null) tpsEl.textContent=tpsText;
    const perfTpsEl=$('#perfTps'); if(perfTpsEl && perfTpsEl.textContent==='—' && live?.tps!=null) perfTpsEl.textContent=tpsText;
    const msptEl=$('#perfMspt'); if(msptEl && msptEl.textContent==='—' && live?.mspt!=null) msptEl.textContent=msptText;
  }catch{}
}
window.observer.onLive(v=>{state.live=v; applyLiveToUI(v);
  const key=(v.players||[]).slice().sort().join(',');if(key!==lastLivePlayersKey){lastLivePlayersKey=key;try{renderPlayers()}catch{}}
});window.observer.onMetrics(v=>{lastMetrics=v; state.live = {...state.live, tps:v.tps??state.live?.tps??null, mspt:v.mspt??state.live?.mspt??null, players:v.players??state.live?.players??[]}; const displayTps = v.tps ?? state.live?.tps ?? null; const displayMspt = v.mspt ?? state.live?.mspt ?? null; const limitGB=state.settings.memoryMax||6;const usedGB=(v.serverMemory||0)/1024;const ram=v.running?Math.min(100,Math.round((v.serverMemory||0)/Math.max(1,limitGB*1024)*100)):null;samples=[...samples.slice(1),{tps:displayTps,mspt:v.running?(displayMspt):null,cpu:v.running?(v.cpu??null):null,ram}]; try{$('#appMemory').textContent=`${v.appMemory||0} MB`;}catch{} const ramLabel=v.running?`${usedGB.toFixed(1)} / ${limitGB} GB`:'—'; try{$('#perfServerRam').textContent=ramLabel;}catch{} try{$('#serverRam').textContent=ramLabel;}catch{} try{$('#overviewCpu').textContent=v.running?`${v.cpu||0}%`:'—';}catch{} try{$('#perfCpu').textContent=v.running?`${v.cpu||0}%`:'—';}catch{} try{$('#playerCount').textContent=v.running?String((v.players||[]).length):'—';}catch{} try{$('#tps').textContent=displayTps?.toFixed?.(2)??'—';}catch{} try{$('#perfTps').textContent=displayTps?.toFixed?.(2)??'—';}catch{}
  const msptEl=$('#perfMspt');if(msptEl){msptEl.textContent=displayMspt?.toFixed?.(2)??'—';const hint=$('#perfMsptHint');if(hint)hint.textContent=displayMspt!=null?'Target: under 50 ms':(v.running?'Needs Paper 1.20.2+ (/tick query) — not reported by this server':'Target: under 50 ms')}
  // overview color coding
  const tpsClass=displayTps==null?'':displayTps>=19?'ok':displayTps>=17?'warn':'bad';
  const cpuClass=v.cpu==null||!v.running?'':v.cpu<60?'ok':v.cpu<85?'warn':'bad';
  const ramClass=ram==null?'':ram<75?'ok':ram<90?'warn':'bad';
  const tpsOv=$('#tps'), perfTpsEl2=$('#perfTps'), heroTps=$('#metricStatus');
  if(tpsOv) tpsOv.className=tpsClass;
  if(perfTpsEl2) perfTpsEl2.className=tpsClass;
  if(heroTps) heroTps.className=tpsClass;
  const cpuOv=$('#overviewCpu'), perfCpuEl2=$('#perfCpu');
  if(cpuOv) cpuOv.className=cpuClass;
  if(perfCpuEl2) perfCpuEl2.className=cpuClass;
  const ramOv=$('#serverRam'), perfRamEl2=$('#perfServerRam');
  if(ramOv) ramOv.className=ramClass;
  if(perfRamEl2) perfRamEl2.className=ramClass;
  // perf badges + bars
  const setBadge=(id,val,good,mid)=>{const el=$(id); if(!el) return; const level=val==null?'':val>=good?'ok':val>=mid?'warn':'bad'; el.className='kpi-badge '+(level||''); el.textContent=val==null?'—':level==='ok'?'Good':level==='warn'?'Warn':'Critical'; };
  setBadge('#perfTpsBadge', displayTps, 19, 17); setBadge('#perfMsptBadge', displayMspt!=null? (100 - Math.min(100,displayMspt)):null, 60, 30); // invert mspt for badge
  setBadge('#perfCpuBadge', v.cpu, 40, 70); // lower is better, so invert logic: we treat high as bad
  const perfCpuBadge=$('#perfCpuBadge'); if(perfCpuBadge && v.cpu!=null){ perfCpuBadge.className='kpi-badge '+(v.cpu<60?'ok':v.cpu<85?'warn':'bad'); perfCpuBadge.textContent=v.cpu<60?'Good':v.cpu<85?'High':'Critical'; }
  setBadge('#perfRamBadge', ram, 30, 60); // placeholder, will override below
  const ramBadge=$('#perfRamBadge'); if(ramBadge && ram!=null){ ramBadge.className='kpi-badge '+(ram<75?'ok':ram<90?'warn':'bad'); ramBadge.textContent=ram<75?'Good':ram<90?'High':'Critical'; } else if(ramBadge && ram==null){ ramBadge.className='kpi-badge'; ramBadge.textContent='—'; }
  const bar=(id,pct)=>{const el=$(id); if(el) el.style.width=(pct==null?0:Math.max(4,Math.min(100,pct)))+'%';};
  bar('#perfTpsBar', displayTps!=null? (displayTps/20*100):null); bar('#perfMsptBar', displayMspt!=null? Math.min(100, displayMspt/100*100):null); bar('#perfCpuBar', v.cpu); bar('#perfRamBar', ram);
  const liveDot=$('#perfLiveDot'), liveText=$('#perfLiveText'), uptimeEl=$('#perfUptime'); if(liveDot){ liveDot.className='live-dot'+(v.running?' on':''); } if(liveText) liveText.textContent=v.running?`${t('con.live')} • ${t('top.running')}`:t('top.offline'); if(uptimeEl) uptimeEl.textContent=uptimeStart? document.getElementById('heroUptime')?.textContent || '—' : '—';
  const launcherMem=$('#perfLauncherMem'); if(launcherMem) launcherMem.textContent=`${v.appMemory||0} MB launcher`;
  const tickEmpty=$('#tickChartEmpty'), resEmpty=$('#resourceChartEmpty');
  if(tickEmpty) tickEmpty.hidden=!!(displayTps!=null || displayMspt!=null);
  if(resEmpty) resEmpty.hidden=!!(v.cpu!=null || ram!=null);
  const liveBadge=$('#resourceLiveBadge'); if(liveBadge){ liveBadge.textContent=v.running?'● LIVE':'○ OFFLINE'; liveBadge.style.color=v.running?'var(--success)':'var(--text-dim)'; liveBadge.style.borderColor=v.running?'rgba(0,229,160,.25)':'var(--border)'; }
  metricChart($('#miniChart'));metricChart($('#perfTickChart'),true,'tick');metricChart($('#perfResourceChart'),true,'resource')});
 // Fallback: nếu main gửi chậm hoặc miss, vẫn giữ UI đồng bộ mỗi 2s từ lastMetrics/live
 setInterval(()=>{ try{ if(lastMetrics){ const v=lastMetrics; const displayTps=v.tps??state.live?.tps??null; const displayMspt=v.mspt??state.live?.mspt??null; if(displayTps!=null){ const el=$('#tps'); if(el && el.textContent==='—') el.textContent=displayTps.toFixed(2); const el2=$('#perfTps'); if(el2 && el2.textContent==='—') el2.textContent=displayTps.toFixed(2); } if(displayMspt!=null){ const el=$('#perfMspt'); if(el && el.textContent==='—') el.textContent=displayMspt.toFixed(2); } } }catch{} }, 2500);
 // Redraw charts định kỳ khi tab performance đang mở (fix canvas 0x0 khi tab hidden lúc metrics đến)
 setInterval(()=>{ try{ if(document.getElementById('performance')?.classList.contains('active')){ metricChart($('#perfTickChart'),true,'tick'); metricChart($('#perfResourceChart'),true,'resource'); } }catch{} }, 2000);
// FEATURE: Aikar's flags preset (a widely recommended JVM/G1GC config for Paper/Purpur servers),
// auto-filled from the current memoryMin/memoryMax instead of making the user type the long flag string.
function aikarFlags(minGB,maxGB){return `-Xms${minGB}G -Xmx${maxGB}G -XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200 -XX:+UnlockExperimentalVMOptions -XX:+DisableExplicitGC -XX:+AlwaysPreTouch -XX:G1NewSizePercent=30 -XX:G1MaxNewSizePercent=40 -XX:G1HeapRegionSize=8M -XX:G1ReservePercent=20 -XX:G1HeapWastePercent=5 -XX:G1MixedGCCountTarget=4 -XX:InitiatingHeapOccupancyPercent=15 -XX:G1MixedGCLiveThresholdPercent=90 -XX:G1RSetUpdatingPauseTimePercent=5 -XX:SurvivorRatio=32 -XX:+PerfDisableSharedMem -XX:MaxTenuringThreshold=1 -Dusing.aikars.flags=https://mcflags.emc.gs -Dfile.encoding=UTF-8`}
$('#applyAikarFlags').onclick=()=>{const min=Number($('#memoryMinInput').value)||2,max=Number($('#memoryMaxInput').value)||6;$('#jvmArgsInput').value=aikarFlags(min,max);toast("Aikar's flags filled in — remember to click Apply settings to save.")};
$('#showWelcomeAgain').onclick=()=>showOnboarding();

// FEATURE: "How friends can join" — surfaces the LAN address (instant, no network call) and lets the
// user look up their public IP on demand. Both are just the IP; the port is read from server.properties
// (or the Velocity default) so the whole thing stays correct if the user changes server-port.
async function loadConnectInfo(){
  const r=await window.observer.networkInfo();if(!r.ok)return;
  const port=r.port;
  $('#connectLocal').value=r.localIps.length?r.localIps.map(ip=>`${ip}:${port}`).join(', '):t('conn.noLan');
  $('#allowFirewall').dataset.port=port;
}
$('#refreshConnectInfo').onclick=loadConnectInfo;
$('#checkPublicIp').onclick=async()=>{
  const btn=$('#checkPublicIp');btn.disabled=true;const original=btn.textContent;btn.textContent='…';
  const r=await window.observer.checkPublicIp();
  btn.disabled=false;btn.textContent=original;
  if(!r.ok)return toast(r.error,'error');
  const port=$('#allowFirewall').dataset.port||25565;
  $('#connectPublic').value=`${r.ip}:${port}`;
};
$('#allowFirewall').onclick=async()=>{
  const port=Number($('#allowFirewall').dataset.port)||25565;
  if(!confirm(`Add a Windows Firewall rule allowing inbound TCP traffic on port ${port}? A Windows security prompt (UAC) will appear — approve it to continue.`))return;
  const r=await window.observer.allowFirewall(port);
  if(!r.ok)return toast(r.error,'error');
  toast(`Port ${port} is now allowed through Windows Firewall. You still need to forward it on your router for friends outside your WiFi.`,'success');
};
$$('[data-copy]').forEach(b=>b.onclick=async()=>{
  const input=$(b.dataset.copy);if(!input||!input.value||input.value==='—')return toast('Nothing to copy yet.');
  try{
    await navigator.clipboard.writeText(input.value);
    const orig=b.textContent; b.textContent='Copied!'; b.classList.add('copied');
    toast(t('toast.copied'),'success');
    setTimeout(()=>{b.textContent=orig; b.classList.remove('copied')}, 1400);
  }catch{toast('Could not copy — select and copy manually.','error')}
});

// FEATURE: one-click portable Java install — shown only when Java isn't already detected, so
// beginners never have to find/install a JDK themselves before they can start their first server.
window.observer.onJavaProgress(({received, total})=>{
  const fill=$('#javaProgressFill'), label=$('#javaProgressLabel'), wrap=$('#javaProgress'); if(!fill||!wrap) return;
  wrap.hidden=false;
  if(total>0){ fill.classList.remove('indeterminate'); fill.style.width=`${Math.min(100,Math.round(received/total*100))}%`; label.textContent=`${formatBytes(received)} / ${formatBytes(total)} (${Math.min(100,Math.round(received/total*100))}%)`; }
  else { fill.classList.add('indeterminate'); label.textContent=`${formatBytes(received)} downloaded…`; }
});
$('#javaAutoInstall').onclick=async()=>{
  const btn=$('#javaAutoInstall');btn.disabled=true;const original=btn.textContent;btn.textContent='Downloading Java… this can take a minute';
  $('#javaProgress').hidden=false; $('#javaProgressFill').style.width='0%'; $('#javaProgressFill').classList.add('indeterminate'); $('#javaProgressLabel').textContent='Starting download…';
  const r=await window.observer.javaAutoInstall();
  btn.disabled=false;btn.textContent=original; $('#javaProgress').hidden=true;
  if(!r.ok)return toast(r.error,'error');
  state.java=r.java;state.settings={...state.settings,javaPath:r.java.path};markSettingsSaved();refreshUI();
  toast(t('toast.javaInstalled',{v:r.java.version}),'success');
};

// FEATURE: first-run onboarding flow — create a new server (recommended for beginners), pick an
// existing server folder, or skip to explore on your own. Doesn't ask again once completed
// (settings.onboarded).
function showOnboarding(){$('#onboardingModal').hidden=false}
function hideOnboarding(){$('#onboardingModal').hidden=true}
async function markOnboarded(){await window.observer.onboardingComplete();state.settings={...state.settings,onboarded:true}}
// BUGFIX: this modal had no way to dismiss it besides picking one of the 3 onboarding choices — fine
// on a genuinely first run, but "Show welcome guide again" (Settings) reopens this same modal on an
// ALREADY-configured install, and there was no way back out except re-running one of those 3 actions.
// A close (×) button, Escape, and clicking the dimmed backdrop now all dismiss any open modal — added
// once, generically, so this can't quietly happen again for a future modal either.
$('#onboardingClose').onclick=()=>hideOnboarding();
$('#obSkip').onclick=async()=>{hideOnboarding();await markOnboarded()};
$('#obPickExisting').onclick=async()=>{hideOnboarding();await markOnboarded();await chooseFolder()};
$('#obCreateNew').onclick=async()=>{
  const folder=await chooseFolder({suggestNew:true,title:'Choose (or create) an empty folder for your new server'});
  hideOnboarding();await markOnboarded();
  if(!folder)return;
  openNewServerWizard();
};

// FEATURE: guided 4-step "create a new server" wizard for people who don't already know what
// software/version/memory means — separate from the full App settings tab (Java path, JVM args,
// auto-restart...) which stays available for people who already know what they're doing (accessible
// directly via the Server properties / Launcher settings tabs, unchanged).
let nsw={step:1,software:'vanilla'};
// Real-time version data for the wizard — loaded live from each software's official API
// (wizard:versions IPC) instead of hardcoded chips that drifted out of date.
let nswVersions={software:null,list:[],latest:null,raw:false,loading:false,failed:false,error:''};
const NSW_SOFTWARE_LABEL={vanilla:'Vanilla',paper:'Paper',purpur:'Purpur',leaf:'Leaf',fabric:'Fabric',neoforge:'NeoForge',forge:'Forge',folia:'Folia',spigot:'Spigot',velocity:'Velocity'};
async function loadNswVersions(software){
  if(nswVersions.software===software)return;
  nswVersions={software,list:[],latest:null,raw:false,loading:true,failed:false,error:''};
  renderNswChips('');
  $('#nswLatestLabel').textContent=t('nsw.latestSub');
  const r=await window.observer.wizardVersions(software);
  if(nswVersions.software!==software)return; // user switched software mid-request
  nswVersions.loading=false;
  if(!r||!r.ok){nswVersions.failed=true;nswVersions.error=r?.error||'Could not reach the version API.';}
  else{nswVersions.list=r.versions||[];nswVersions.latest=r.latest||null;nswVersions.raw=!!r.raw;nswVersions.note=r.note||'';}
  renderNswChips($('#nswVersionInput')?.value.trim()||'');
  $('#nswLatestLabel').textContent=nswVersions.latest?`${t('nsw.latest')}: ${nswVersions.latest}`:'';
  const mode=$$('input[name="nswVersionMode"]').find(r=>r.checked)?.value;
  if(nswVersions.latest&&mode!=='specific')checkNswJava(nswVersions.latest);
}
function renderNswChips(filter){
  const box=$('#nswVersionChips');if(!box)return;
  if(nswVersions.loading){box.innerHTML='<span class="nsw2-chiploading">Loading live versions…</span>';return}
  if(nswVersions.failed){box.innerHTML=`<span class="nsw2-chiploading">${esc(nswVersions.error)} — type a version manually.</span>`;return}
  const q=(filter||'').toLowerCase();
  const list=q?nswVersions.list.filter(v=>v.toLowerCase().includes(q)):nswVersions.list;
  box.innerHTML=list.length?list.map(v=>`<button class="version-chip" data-version="${esc(v)}">${esc(v)}</button>`).join(''):'<span class="nsw2-chiploading">No matches — the exact text you type will be used as-is.</span>';
}
function nswValidateVersion(v){
  if(!v)return'';
  if(nswVersions.loading)return'Checking the live list…';
  if(nswVersions.failed)return'Live list unavailable — the download step will verify it.';
  if(v==='latest')return'';
  if(nswVersions.list.includes(v))return`✓ ${v} is available for ${NSW_SOFTWARE_LABEL[nsw.software]||nsw.software}.`;
  const near=nswVersions.list.find(x=>x.startsWith(v));
  return near?`✗ "${v}" not found — did you mean ${near}?`:`✗ "${v}" is not in the live list for ${NSW_SOFTWARE_LABEL[nsw.software]||nsw.software}.`;
}
// HARD-SYNC Java requirement: asks Mojang's manifest (via wizard:java-check) for the authoritative
// javaVersion of the selected MC version instead of trusting the static mapping. Result is shown
// live in step 2 and repeated as a "Java" row in the step 4 summary.
let nswJava={version:'',java:null,exact:false};
const javaMajorOf=s=>{const m=String(s||'').match(/(?:1\.)?(\d+)/);return m?Number(m[1]):null};
function renderNswJava(){
  const el=$('#nswJavaCheck');if(!el)return;
  if(!nswJava.java){el.hidden=true;return}
  const jm=state.java&&state.java.ok?javaMajorOf(state.java.version):null;
  const tooOld=jm!=null&&jm<nswJava.java;
  el.hidden=false;
  el.className='nsw-java '+(tooOld?'warn':'ok');
  el.textContent=(nswJava.exact?'☕ This version runs on Java ':'☕ Estimated: Java ')+nswJava.java+(nswJava.exact?' (verified from Mojang)':'+')+(tooOld?` — ⚠ your Java ${jm} is too old; use auto-install in Settings or pick a newer path.`:tooOld===false&&jm!=null?` — your Java ${jm} is ready.`:'');
}
function checkNswJava(v){
  if(!v||v==='latest'){nswJava={version:'',java:null,exact:false};const el=$('#nswJavaCheck');if(el)el.hidden=true;return}
  const el=$('#nswJavaCheck');
  if(el){el.hidden=false;el.className='nsw-java loading';el.textContent='Checking Java requirement…'}
  window.observer.wizardJavaCheck({software:nsw.software,version:v}).then(r=>{
    if(r&&r.ok&&r.java){nswJava={version:v,java:r.java,exact:!!r.exact}}
    else{nswJava={version:v,java:null,exact:false}}
    renderNswJava();
  }).catch(()=>{nswJava={version:v,java:null,exact:false};const e2=$('#nswJavaCheck');if(e2)e2.hidden=true});
}
function nswRender(){
  $$('.nsw-step').forEach(s=>s.classList.toggle('active',Number(s.dataset.step)===nsw.step));
  $$('.nsw2-step').forEach(d=>{const n=Number(d.dataset.dot);d.classList.toggle('active',n===nsw.step);d.classList.toggle('done',n<nsw.step)});
  $('#nswStepLabel').textContent=t('nsw.step',{a:nsw.step,b:4});
  $('#nswBack').hidden=nsw.step===1;
  $('#nswNext').textContent=nsw.step===4?t('nsw.create'):t('nsw.next');
  const versionMode=$$('input[name="nswVersionMode"]').find(r=>r.checked)?.value;
  const version=versionMode==='specific'?($('#nswVersionInput').value.trim()||'—'):(nswVersions.latest||'Latest');
  $('#nswRailSub1').textContent=NSW_SOFTWARE_LABEL[nsw.software]||nsw.software;
  $('#nswRailSub2').textContent=version;
  $('#nswRailSub3').textContent=`${$('#nswMemorySlider').value} GB`;
  if(nsw.step===2)loadNswVersions(nsw.software);
  if(nsw.step===3){
    if(state.systemMemoryGB){$('#nswMemorySlider').max=Math.max(2,state.systemMemoryGB-1);$('#nswRamHint').textContent=`Your computer has about ${state.systemMemoryGB} GB of RAM — the server can use part of it. More isn't always better; 2–4 GB is plenty for friends.`}
    nswUpdateMemory();
  }
  if(nsw.step===4){
    const memory=$('#nswMemorySlider').value;
    $('#nswSummary').innerHTML=`<div class="nsw2-kv"><span>${t('nsw.sumSoftware')}</span><b>${esc(NSW_SOFTWARE_LABEL[nsw.software]||nsw.software)}</b></div><div class="nsw2-kv"><span>${t('nsw.sumVersion')}</span><b>${esc(version)}</b></div><div class="nsw2-kv"><span>${t('nsw.sumJava')}</span><b>${nswJava.java?`Java ${nswJava.java}${nswJava.exact?' (verified)':'+'}`:'—'}</b></div><div class="nsw2-kv"><span>${t('nsw.sumMemory')}</span><b>${esc(memory)} GB</b></div><div class="nsw2-kv"><span>${t('nsw.sumFolder')}</span><b>${esc(state.settings.serverPath||'—')}</b></div>`;
  }
  const spigotHint=$('#nswSpigotHint'); if(spigotHint) spigotHint.hidden=!(nsw.step===4&&nsw.software==='spigot');
}
$$('[data-software]').forEach(c=>c.onclick=()=>{
  if(nsw.software===c.dataset.software)return;
  nsw.software=c.dataset.software;
  $$('[data-software]').forEach(x=>x.classList.toggle('active',x===c));
  // invalidate the cached live list so step 2 refetches for this software
  nswVersions={software:null,list:[],latest:null,raw:false,loading:false,failed:false,error:''};
  if(nsw.step===2)loadNswVersions(nsw.software);
  nswRender();
});
$$('input[name="nswVersionMode"]').forEach(r=>r.onchange=()=>{
  const isSpecific=$$('input[name="nswVersionMode"]').find(x=>x.checked)?.value==='specific';
  $('#nswVersionInput').disabled=!isSpecific;
  const picker=$('#nswVersionPicker'); if(picker) picker.hidden=!isSpecific;
  $$('.nsw-radio-card').forEach(c=>c.classList.toggle('active', c.querySelector('input')?.checked));
  if(isSpecific){renderNswChips($('#nswVersionInput').value.trim());$('#nswVersionInput')?.focus()}
  checkNswJava(isSpecific?$('#nswVersionInput').value.trim():nswVersions.latest);
  nswRender();
});
// Chips are rendered live from the API (renderNswChips), so bind once via delegation.
$('#nswVersionChips').addEventListener('click',e=>{
  const chip=e.target.closest('.version-chip');if(!chip)return;
  const v=chip.dataset.version;
  $('#nswVersionInput').value=v;
  $('#nswVersionClear').hidden=false;
  $$('input[name="nswVersionMode"]').forEach(r=>r.checked=r.value==='specific');
  $('#nswVersionInput').disabled=false;
  $$('.nsw-radio-card').forEach(c=>c.classList.toggle('active', c.querySelector('input')?.checked));
  $('#nswVersionInfo').textContent=nswValidateVersion(v);
  checkNswJava(v);
  nswRender();
});
const debouncedNswValidate=debounce(()=>{
  const v=$('#nswVersionInput').value.trim();
  $('#nswVersionClear').hidden=!v;
  renderNswChips(v);
  const info=$('#nswVersionInfo');
  if(info)info.textContent=v?nswValidateVersion(v):'Pick a chip above or type any version — checked live against the official list.';
  checkNswJava(v);
  nswRender();
},250);
$('#nswVersionInput')?.addEventListener('input',debouncedNswValidate);
$('#nswVersionClear')?.addEventListener('click',()=>{
  $('#nswVersionInput').value='';
  $('#nswVersionClear').hidden=true;
  renderNswChips('');
  $('#nswVersionInfo').textContent='Pick a chip above or type any version — checked live against the official list.';
  $('#nswVersionInput').focus();
});
// Memory step: one updater drives the big readout, slider fill, preset chips and the rail.
function nswUpdateMemory(){
  const s=$('#nswMemorySlider');
  const v=Number(s.value)||4,min=Number(s.min)||1,max=Number(s.max)||16;
  $('#nswMemoryValue').textContent=v;
  s.style.setProperty('--p',Math.round((v-min)/(max-min)*100)+'%');
  const desc=$('#nswRamDesc');
  if(desc){desc.textContent=t('nsw.mem'+(v<=2?1:v<=4?2:v<=8?3:4));desc.className='nsw2-memory-desc '+(v<=4?'ok':v<=8?'warn':'bad')}
  $$('.nsw2-mempresets .filter-chip').forEach(c=>c.classList.toggle('active',Number(c.dataset.mem)===v));
  $('#nswRailSub3').textContent=`${v} GB`;
}
$$('.nsw2-mempresets .filter-chip').forEach(b=>b.onclick=()=>{$('#nswMemorySlider').value=b.dataset.mem;nswUpdateMemory()});
$('#nswMemorySlider').addEventListener('input',nswUpdateMemory);
$('#nswShowTech')?.addEventListener('change', e=>{ const show=e.target.checked; $$('.card-tech').forEach(el=> el.hidden=!show); });
$('#nswBack').onclick=()=>{nsw.step=Math.max(1,nsw.step-1);nswRender()};
function formatBytes(n){if(n==null)return'';if(n<1024)return`${n} B`;if(n<1024*1024)return`${(n/1024).toFixed(0)} KB`;return`${(n/1024/1024).toFixed(1)} MB`}
// FEATURE: real byte progress for the wizard's download step — registered once here (same pattern as
// onLog/onState/onFiles above) rather than subscribed per-click, so repeated wizard runs don't stack
// up duplicate listeners. Harmless to keep receiving events when the modal isn't open; the elements
// just sit updated and hidden.
window.observer.onWizardProgress(({received,total})=>{
  const fill=$('#nswProgressFill'),label=$('#nswProgressLabel');if(!fill)return;
  if(total>0){fill.classList.remove('indeterminate');fill.style.width=`${Math.min(100,Math.round(received/total*100))}%`;label.textContent=`${formatBytes(received)} / ${formatBytes(total)} (${Math.min(100,Math.round(received/total*100))}%)`}
  else{fill.classList.add('indeterminate');label.textContent=`${formatBytes(received)} downloaded…`}
});
$('#nswNext').onclick=async()=>{
  if(nsw.step<4){nsw.step++;nswRender();return}
  const software=nsw.software;
  const versionMode=$$('input[name="nswVersionMode"]').find(r=>r.checked)?.value;
  const version=versionMode==='specific'?$('#nswVersionInput').value.trim():'';
  const memory=Number($('#nswMemorySlider').value)||4;
  $('#nswNext').disabled=true;$('#nswNext').textContent='Downloading…';$('#nswBack').disabled=true;
  $('#nswProgress').hidden=false;$('#nswProgressFill').style.width='0%';$('#nswProgressFill').classList.add('indeterminate');$('#nswProgressLabel').textContent='Starting download…';
  const settingsNext={...getSettings(),memoryMin:Math.max(1,Math.floor(memory/2)),memoryMax:memory};
  const sr=await window.observer.saveSettings(settingsNext);state={...state,settings:settingsNext,java:sr.java};
  const r=await window.observer.wizardCreate({software,version});
  $('#nswNext').disabled=false;$('#nswBack').disabled=false;$('#nswProgress').hidden=true;
  if(!r.ok){toast(r.error,'error');return}
  $('#newServerModal').hidden=true;nsw={step:1,software:'vanilla'};nswVersions={software:null,list:[],latest:null,raw:false,loading:false,failed:false,error:''};
  if(r.building){toast(`${r.name} started in the background — this can take several minutes. Watch the Console tab for progress.`);switchTab('console');return}
  state.files=r.files;refreshUI();switchTab('overview');
  toast(`Your server is ready. Press "Start server" at the top when you're ready to play.`,'success');
};
function openNewServerWizard(){
  nsw={step:1,software:'vanilla'};
  nswVersions={software:null,list:[],latest:null,raw:false,loading:false,failed:false,error:''};
  nswJava={version:'',java:null,exact:false};
  const jc=$('#nswJavaCheck');if(jc)jc.hidden=true;
  $$('[data-software]').forEach(x=>x.classList.toggle('active',x.dataset.software==='vanilla'));
  $('#nswVersionInput').disabled=true;
  $$('input[name="nswVersionMode"]').forEach(r=>r.checked=r.value==='latest');
  $$('.nsw-radio-card').forEach(c=>c.classList.toggle('active', c.querySelector('input')?.value==='latest'));
  $('#nswVersionPicker').hidden=true;
  $('#nswVersionInput').value='';$('#nswVersionClear').hidden=true;
  $('#nswLatestLabel').textContent='Resolving latest…';
  $('#nswMemorySlider').value=4;$('#nswMemoryValue').textContent='4';
  $('#nswProgress').hidden=true;
  nswRender();$('#newServerModal').hidden=false;
}
$('#newServerClose').onclick=()=>{if($('#nswNext').disabled)return toast('Wait for the download to finish before closing this.','error'); closeOverlayAnimated($('#newServerModal'));};
// FEATURE: generic modal dismissal — Escape key, or clicking the dimmed backdrop outside the modal
// card, closes whichever .modal-overlay is currently open. Covers every current and future modal from
// one place instead of each modal needing its own escape-hatch wiring (see the note above on why that
// was missing for onboarding). Guarded so it can't close the create-server modal mid-download — the
// download itself isn't cancellable, so closing then would just hide the progress from a job still
// running, and its completion toast/tab-switch would fire later with no modal left to explain why.
const modalBusy=overlay=>overlay.id==='newServerModal'&&$('#nswNext').disabled||overlay.id==='installModal'&&installState.busy;
function closeOverlayAnimated(el){ el.classList.add('closing'); setTimeout(()=>{ el.hidden=true; el.classList.remove('closing'); }, 140); }
document.addEventListener('keydown',e=>{if(e.key==='Escape'){const open=$$('.modal-overlay').find(m=>!m.hidden);if(open&&!modalBusy(open)){ if(open.id==='playerInspectModal') closePlayerInspectModal(); else closeOverlayAnimated(open); }}});
$$('.modal-overlay').forEach(overlay=>overlay.addEventListener('click',e=>{if(e.target===overlay&&!modalBusy(overlay)){ if(overlay.id==='playerInspectModal') closePlayerInspectModal(); else closeOverlayAnimated(overlay); }}));

(async()=>{const langSel=$('#languageSelect');if(langSel&&window.LOCALES_META)langSel.innerHTML=window.LOCALES_META.map(l=>`<option value="${esc(l.code)}">${esc(l.name)}</option>`).join('');
const initial=await window.observer.getState();state={...state,...initial};addLogsBatch(initial.logs||[]);refreshUI();loadConnectInfo();if(!state.settings?.onboarded)showOnboarding();
// BUGFIX: the native min/max/close caption buttons overlay the top-right of the page and used to
// cover the server-path text in the command bar. Detect the Window Controls Overlay and flag it so
// CSS can reserve its width (.wco-app rules in style.css).
try{const wco=navigator.windowControlsOverlay;if(wco){const sync=()=>document.documentElement.classList.toggle('wco-app',!!wco.visible);sync();wco.addEventListener('geometrychange',sync);}}catch{}
const v=await window.observer.marketVersions();if(v.ok)$('#marketVersion').innerHTML='<option value="">All versions</option>'+v.versions.map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join('');requestAnimationFrame(positionChannelIndicator);window.addEventListener('resize',()=>{metricChart($('#miniChart'));metricChart($('#perfTickChart'),true,'tick');metricChart($('#perfResourceChart'),true,'resource');positionChannelIndicator()})})();

// ===== AUTO-UPDATE UI =====
const updateBtn=$('#checkUpdateBtn');
if(updateBtn)updateBtn.onclick=async()=>{const st=$('#updateStatus');if(st)st.textContent=t('upd.checking');await window.observer.checkUpdate();};
window.observer.onUpdateAvailable(v=>{const st=$('#updateStatus');if(st)st.innerHTML=t('upd.available',{v:v.version})+' <button class="btn primary sm" id="dlBtn">'+t('upd.download')+'</button>';const b=$('#dlBtn');if(b)b.onclick=()=>window.observer.downloadUpdate();});
window.observer.onUpdateProgress(p=>{const st=$('#updateStatus');if(st)st.textContent=t('upd.downloading',{p:Math.round(p.percent)});});
window.observer.onUpdateDownloaded(()=>{const st=$('#updateStatus');if(st)st.innerHTML=t('upd.ready')+' <button class="btn primary sm" id="installBtn">'+t('upd.install')+'</button>';const b=$('#installBtn');if(b)b.onclick=()=>window.observer.quitInstall();});
window.observer.onUpdateNone&&window.observer.onUpdateNone(()=>{const st=$('#updateStatus');if(st)st.textContent=t('upd.none');});
