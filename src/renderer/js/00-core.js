// js/00-core.js — split from app.js (lines 1-87); classic script, load in numeric order.
// core helpers: $/$$, i18n t(), state, toast, validation, charts.
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
// SECURITY (mirror of src/main/validate.js — renderer has no require()).
// Player names are interpolated into console commands (`kick ${name}`) and
// sent to whitelist/ban/op handlers. A name with a newline would execute as
// a SECOND command on the server stdin, so reject it HERE for instant
// feedback (the backend re-validates as defense in depth).
function isSafePlayerName(name){return typeof name==='string'&&/^[A-Za-z0-9_]{3,16}$/.test(name)}
function playerNameError(name){
  if(!name) return 'Type a name first.';
  if(/[\r\n]/.test(name)) return 'Invalid player name — line breaks are not allowed.';
  if(!isSafePlayerName(name)) return 'Invalid player name — use 3-16 letters, numbers or underscores.';
  return null;
}
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
