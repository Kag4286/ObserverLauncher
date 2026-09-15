// js/02-worldmap.js — split from app.js (lines 296-538); classic script, load in numeric order.
// World Map tab: canvas, terrain preview, waypoints, chunks.
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

let wm={level:null,players:[],waypoints:[],dim:'overworld',cam:{x:0,z:0},zoom:0.25,addMode:false,drag:null,loaded:false,seedBig:0n,layers:{terrain:true},explored:new Set(),exploredDim:null,biomes:new Map(),biomeReqSeq:0,biomeTimer:null,lastBiomeRect:'',biomeLoading:false,biomeTooWide:false,biomeTruncated:false};
// REAL biome colours (terrain-map style). Keyed by exact biome id with family fallbacks, so a
// brand-new biome still gets a sensible colour instead of grey. Slightly desaturated to sit on
// the dark canvas without glowing.
const BIOME_COLORS={
  ocean:'#2E5A8A',deep_ocean:'#1E3F63',warm_ocean:'#3A7CA5',lukewarm_ocean:'#3E7EA0',cold_ocean:'#274E77',frozen_ocean:'#2B4C6B',deep_cold_ocean:'#1C3A57',deep_frozen_ocean:'#1E3D55',deep_lukewarm_ocean:'#2A5878',
  river:'#3E7FB0',frozen_river:'#4E7C9E',beach:'#C9BE8A',snowy_beach:'#D5D8DA',stony_shore:'#8A8477',
  plains:'#6FA84E',sunflower_plains:'#7FB255',snowy_plains:'#D7DCE0',ice_spikes:'#C6D2DE',meadow:'#86B562',
  forest:'#3F7A3A',flower_forest:'#568F45',birch_forest:'#6E9A55',old_growth_birch_forest:'#7BA25E',dark_forest:'#2E5A2E',taiga:'#4E7A5A',snowy_taiga:'#5C7C72',old_growth_pine_taiga:'#3F6B4A',old_growth_spruce_taiga:'#3D6448',
  jungle:'#2E7D32',sparse_jungle:'#4E8B3E',bamboo_jungle:'#5C9A3E',
  desert:'#D8C77A',badlands:'#B5713E',eroded_badlands:'#A85E33',wooded_badlands:'#9C6B3F',savanna:'#B0A24E',savanna_plateau:'#A99A44',windswept_savanna:'#9E9143',
  swamp:'#5A6B45',mangrove_swamp:'#4E6B4A',
  snowy_slopes:'#D7DCE0',snowy_plains_peaks:'#D7DCE0',grove:'#5E7C6A',snowy_taiga_peaks:'#6A8277',
  windswept_hills:'#8A8A7E',windswept_gravelly_hills:'#97968B',windswept_forest:'#5E7A55',jagged_peaks:'#C9CDD2',frozen_peaks:'#DCE2E6',stony_peaks:'#9A9C92',
  mushroom_fields:'#8A7C8E',
  nether_wastes:'#7A3B33',crimson_forest:'#8E2E3E',warped_forest:'#2E7A72',soul_sand_valley:'#5A4A3E',basalt_deltas:'#54545C',
  the_end:'#C9C29A',end_highlands:'#C2BB92',end_midlands:'#B8B189',small_end_islands:'#A8A17C',end_barrens:'#9C9577',
  the_void:'#0A0F14',dripstone_caves:'#8A7355',lush_caves:'#4E8A5A',deep_dark:'#1E3A4A',
};
function biomeColor(id){
  if(!id)return '#3A4250';
  const k=String(id).replace(/^minecraft:/,'');
  if(BIOME_COLORS[k])return BIOME_COLORS[k];
  if(/ocean|sea/.test(k))return '#2E5A8A';
  if(/river/.test(k))return '#3E7FB0';
  if(/forest|wood|taiga|grove/.test(k))return '#3F7A3A';
  if(/jungle/.test(k))return '#2E7D32';
  if(/desert|sand|badland/.test(k))return '#D8C77A';
  if(/snow|frozen|ice/.test(k))return '#D7DCE0';
  if(/mountain|peak|hill|slope/.test(k))return '#8A8A7E';
  if(/swamp|mangrove/.test(k))return '#5A6B45';
  if(/savanna/.test(k))return '#B0A24E';
  if(/beach|shore/.test(k))return '#C9BE8A';
  if(/cave|dripstone|deep_dark/.test(k))return '#5A5548';
  if(/nether|crimson|warped|basalt|soul/.test(k))return '#7A3B33';
  if(/end/.test(k))return '#C2BB92';
  return '#4A5442';
}
// Max chunks we ask the backend to parse in one go. Beyond this we skip the fetch and keep
// the seed wash, so panning at a far zoom-out can't tie up the main process (~3s of parsing).
const WM_BIOME_MAX_CHUNKS=1600;
// Below this zoom the viewport spans too many chunks to be worth fetching.
const WM_BIOME_MIN_ZOOM=0.06;
// Hide marker text labels below this zoom so they don't overlap into a smear.
const WM_LABEL_MIN_ZOOM=0.15;
// Debounced biome fetch for the visible chunk range. Drops stale responses via a sequence token.
function wmScheduleBiomes(){
  if(!wm.level||!wm.layers.terrain)return;
  const cv=$('#wmCanvas');if(!cv)return;
  const W=cv.clientWidth||800,H=cv.clientHeight||520;
  const cx0=Math.floor((wm.cam.x-W/2/wm.zoom)/16),cx1=Math.floor((wm.cam.x+W/2/wm.zoom)/16);
  const cz0=Math.floor((wm.cam.z-H/2/wm.zoom)/16),cz1=Math.floor((wm.cam.z+H/2/wm.zoom)/16);
  // Too wide (far zoom-out or huge viewport): don't fetch — keep the seed wash and show a hint.
  const chunkCount=(cx1-cx0+1)*(cz1-cz0+1);
  if(wm.zoom<WM_BIOME_MIN_ZOOM||chunkCount>WM_BIOME_MAX_CHUNKS){
    wm.lastBiomeRect='';
    wm.biomeTooWide=true;
    return;
  }
  if(wm.biomeTooWide)wm.biomeTooWide=false;
  const rect=[cx0,cz0,cx1,cz1].join(',');
  if(rect===wm.lastBiomeRect)return;
  clearTimeout(wm.biomeTimer);
  wm.biomeTimer=setTimeout(async()=>{
    wm.lastBiomeRect=rect;
    const seq=++wm.biomeReqSeq;
    wm.biomeLoading=true;wmDraw();
    let r;
    try{r=await window.observer.worldmapBiomes({dim:wm.dim,cx0,cz0,cx1,cz1})}catch{wm.biomeLoading=false;return}
    if(seq!==wm.biomeReqSeq)return;
    wm.biomeLoading=false;
    if(!r||!r.ok)return;
    wm.biomeTruncated=!!r.truncated;
    let added=0;
    for(const[cx,cz,b]of r.biomes){wm.biomes.set(cx+','+cz,b);added++}
    if(added||wm.biomeTruncated)wmDraw();
  },220);
}
// Fetch a bounded square of chunks around a centre, ignoring the zoom/viewport limit. Used on
// load so the spawn area shows real biomes even when the whole viewport is too wide to fetch.
async function wmPrefetchBiomes(ccx,ccz,half){
  if(!wm.level)return;
  const seq=++wm.biomeReqSeq;
  wm.biomeLoading=true;wmDraw();
  let r;
  try{r=await window.observer.worldmapBiomes({dim:wm.dim,cx0:ccx-half,cz0:ccz-half,cx1:ccx+half,cz1:ccz+half})}catch{wm.biomeLoading=false;return}
  if(seq!==wm.biomeReqSeq)return;
  wm.biomeLoading=false;
  if(!r||!r.ok)return;
  for(const[cx,cz,b]of r.biomes)wm.biomes.set(cx+','+cz,b);
  wmDraw();
}
const WM_COLORS=['#FF3B5C','#00E5FF','#FFD23F','#00E5A0','#C792EA','#FF8C42'];
function wmShow(view){$('#wmNoWorld').hidden=view!=='none';$('#wmApp').hidden=view!=='app'}
async function wmLoad(){
  // NOTE: tab activation lives in switchTab (js/08-shell.js) — do NOT capture
  // switchTab here at load time. This file evaluates BEFORE 08-shell.js, so
  // `const orig=switchTab` used to throw ReferenceError, aborting this script
  // (Reload buttons included) and leaving the Map tab permanently blank.
  let r;
  try {
    r = await window.observer.worldmapLoad();
  } catch (e) {
    wmShow('none');
    toast(`Could not load world data: ${e?.message || e}`, 'error');
    return;
  }
  if (!r) { wmShow('none'); return }
  wm.level=(r&&r.level&&r.level.ok)?r.level:null;
  wm.players=(r&&r.players&&r.players.players)||[];
  wm.waypoints=(r&&r.waypoints)||[];
  if(!wm.level){wmShow('none');if(r.error)toast(`World Map: ${r.error}`,'error');return}
  wmShow('app');
  try { wm.seedBig=BigInt(wm.level.seed); } catch { wm.seedBig=0n }
  $('#wmSeed').textContent=wm.level.seed;
  $('#wmSeed').title=wm.level.levelName+' · '+wm.level.version.name;
  // center on spawn or first player
  const f=wm.players[0]?wm.players[0].pos:wm.level.spawn;
  wm.cam={x:f.x,z:f.z};if(wm.zoom<0.1)wm.zoom=0.25;
  // A1: a reload must not keep stale biome colours from a previous world/session.
  wm.biomes.clear();wm.lastBiomeRect='';wm.biomeTooWide=false;wm.biomeTruncated=false;
  wmLoadChunks(wm.dim);
  wmRenderList();wmDraw();
  // C: at the default zoom the viewport spans tens of thousands of chunks, so the normal
  // biome fetch is skipped and spawn stays on the seed wash. Fetch a bounded block around
  // spawn so real biomes appear immediately.
  wmPrefetchBiomes(Math.floor(f.x/16),Math.floor(f.z/16),12);
}
function wmVisible(){
  // BUGFIX: the ResizeObserver can fire wmDraw() before wmLoad() has set wm.level,
  // so this ran with wm.level=null and threw on `...wm.level.spawn`.
  if(!wm.level)return[];
  const list=(wm.dim==='overworld'?[{type:'spawn',...wm.level.spawn,name:t('wm.spawn'),color:'#00E5A0'}]:[]);
  for(const p of wm.players)if(p.dim===wm.dim)list.push({type:'player',...p.pos,name:p.name||p.uuid.slice(0,8),color:'#00E5FF'});
  for(const w of wm.waypoints)if(w.dim===wm.dim)list.push({type:'wp',...w});
  return list;
}
function wmDraw(){
  if(!wm.level)return; // no world loaded yet — nothing to draw (see wmVisible guard)
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
  // BUGFIX (markers hard to see): spawn and player used to be the SAME 5px dot
  // (only the colour differed) with a faint 1.5px black outline, so on the dark
  // canvas + terrain wash they were nearly invisible. Give each type a distinct
  // shape, a dark halo behind it, and a stroked label so it reads on any background.
  for(const m of wmVisible()){
    const[sx,sy]=toS(m.x,m.z);
    if(sx<-40||sx>W+40||sy<-30||sy>H+30)continue;
    ctx.beginPath();ctx.arc(sx,sy,9,0,7);ctx.fillStyle='rgba(0,0,0,.55)';ctx.fill(); // contrast halo
    ctx.fillStyle=m.color;ctx.strokeStyle='#05070A';ctx.lineWidth=2;
    if(m.type==='wp'){
      ctx.save();ctx.translate(sx,sy);ctx.rotate(Math.PI/4);ctx.fillRect(-5.5,-5.5,11,11);ctx.strokeRect(-5.5,-5.5,11,11);ctx.restore();
    } else if(m.type==='spawn'){
      // 5-point star — unmistakably "spawn" (was a plain dot identical to players)
      ctx.beginPath();
      for(let i=0;i<10;i++){const r=i%2?3:7,a=-Math.PI/2+i*Math.PI/5;ctx.lineTo(sx+Math.cos(a)*r,sy+Math.sin(a)*r)}
      ctx.closePath();ctx.fill();ctx.stroke();
    } else {
      // player — filled ring with a dark core (reads at a glance)
      ctx.beginPath();ctx.arc(sx,sy,6,0,7);ctx.fill();ctx.stroke();
      ctx.beginPath();ctx.arc(sx,sy,2,0,7);ctx.fillStyle='#05070A';ctx.fill();
    }
    // Labels only when zoomed in enough — at far zoom-out every name would overlap into a smear.
    // Draw to the RIGHT of the marker, but flip to the LEFT when the text would run off the
    // canvas edge, and clamp vertically so a marker near the top/bottom keeps its label visible.
    if(wm.zoom>=WM_LABEL_MIN_ZOOM){
      ctx.font='700 10.5px "JetBrains Mono",monospace';
      const coordText=Math.round(m.x)+' '+Math.round(m.z);
      const tw=Math.max(ctx.measureText(m.name).width,ctx.measureText(coordText).width);
      const right=sx+11+tw<W-4;
      const lx=right?sx+11:Math.max(4,sx-11-tw);
      const ly=Math.max(2,Math.min(sy-14,H-22));
      ctx.lineWidth=3;ctx.strokeStyle='rgba(0,0,0,.75)';
      ctx.strokeText(m.name,lx,ly);ctx.strokeText(coordText,lx,ly+12);
      ctx.fillStyle=m.color;ctx.fillText(m.name,lx,ly);
      ctx.fillStyle='rgba(232,244,248,.9)';ctx.fillText(coordText,lx,ly+12);
    }
  }
  // terrain / biome layer (behind grid/markers). When real biome data for the viewport has
  // been loaded (wm.biomes), each cell is coloured by its chunk's actual surface biome; cells
  // without data fall back to the seed-coloured approximation. Only explored chunks render
  // when a chunk mask is present.
  if(wm.layers.terrain){
    const cellPx=Math.max(8,Math.round(16*wm.zoom));
    const stepW=cellPx/wm.zoom;
    const x0=Math.floor((wm.cam.x-W/2/wm.zoom)/stepW)*stepW;
    const x1=wm.cam.x+W/2/wm.zoom;
    const z0=Math.floor((wm.cam.z-H/2/wm.zoom)/stepW)*stepW;
    const z1=wm.cam.z+H/2/wm.zoom;
    for(let wz=z0;wz<z1;wz+=stepW)for(let wx=x0;wx<x1;wx+=stepW){
      const cx=Math.floor(wx/16),cz=Math.floor(wz/16);
      if(wm.explored.size && !wm.explored.has(cx+','+cz))continue;
      const[sx,sy]=toS(wx,wz);
      const ck=cx+','+cz;
      if(wm.biomes.has(ck)){
        const bio=wm.biomes.get(ck);
        // Known chunk: real biome colour, or a neutral slate when the chunk had no biome data
        // (proto-chunk / no section) — so "checked, none" is visibly different from "not loaded".
        ctx.fillStyle=bio?biomeColor(bio):'#20262E';
      } else {
        ctx.fillStyle=getTerrainColor(wx,wz,wm.seedBig,wm.dim);
      }
      ctx.fillRect(sx,sy,cellPx,cellPx);
    }
  }
  wmScheduleBiomes();
  // biome status hint (top-left): a loading indicator while a fetch is in flight, or a
  // "zoom in" note when the viewport is too wide / the backend hit its chunk cap.
  { const hint=wm.biomeLoading?t('wm.loadingBiomes'):((wm.biomeTooWide||wm.biomeTruncated)?t('wm.zoomInBiomes'):null);
    if(hint){ ctx.fillStyle='rgba(232,244,248,.75)';ctx.font='600 10.5px "JetBrains Mono",monospace';ctx.fillText(hint,14,20); } }
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
// FEATURE: click-to-inspect — click a marker for a popup with exact coords +
// Copy; click empty map for that point's coords. (Hover already shows coords
// in #wmCoord; the popup persists so you can copy/keep it while panning.)
function wmToScreen(wx,wz){const W=$('#wmCanvas').clientWidth||800,H=$('#wmCanvas').clientHeight||520;return [(wx-wm.cam.x)*wm.zoom+W/2,(wz-wm.cam.z)*wm.zoom+H/2]}
function wmHidePopup(){const p=$('#wmPopup');if(p)p.hidden=true}
function wmShowPopup(px,py,{color,title,lines,copy}){
  let p=$('#wmPopup');
  if(!p){const host=document.querySelector('#wmApp .wm-main');if(!host)return;p=document.createElement('div');p.id='wmPopup';p.hidden=true;host.appendChild(p)}
  p.innerHTML=`<button class="wm-pop-x" aria-label="Close">×</button><div class="wm-pop-title"><span class="wm-dot" style="background:${esc(color||'#B8C2CC')}"></span><b>${esc(title)}</b></div>${lines.map(l=>`<div class="wm-pop-line mono">${esc(l)}</div>`).join('')}<button class="btn sm secondary wm-pop-copy">${esc(t('conn.copy'))}</button>`;
  p.hidden=false;
  p.querySelector('.wm-pop-x').onclick=e=>{e.stopPropagation();wmHidePopup()};
  p.querySelector('.wm-pop-copy').onclick=async e=>{e.stopPropagation();try{await navigator.clipboard.writeText(copy);toast(t('toast.copied'),'success')}catch{toast(copy)}};
  const wrap=p.parentElement.getBoundingClientRect();
  const pw=p.offsetWidth||180,ph=p.offsetHeight||120;
  p.style.left=Math.max(8,Math.min(px+14,wrap.width-pw-8))+'px';
  p.style.top=Math.max(8,Math.min(py-10,wrap.height-ph-8))+'px';
}
function wmMapClick(px,py,wx,wz){
  const marks=wmVisible();
  for(let i=marks.length-1;i>=0;i--){
    const m=marks[i];const[sx,sy]=wmToScreen(m.x,m.z);
    if(Math.hypot(px-sx,py-sy)<=14){
      const y=Math.round(m.y??64);
      const lines=[`${Math.round(m.x)} ${y} ${Math.round(m.z)}`,m.dim];
      if(m.type==='player'&&m.seenAt)lines.push(new Date(m.seenAt).toLocaleTimeString());
      wmShowPopup(px,py,{color:m.color,title:m.name,lines,copy:`${Math.round(m.x)} ${y} ${Math.round(m.z)}`});
      return;
    }
  }
  wmShowPopup(px,py,{title:`${wx} ${wz}`,lines:[wm.dim],copy:`${wx} ${wz}`});
}
// FEATURE: live layer — while the server runs and this tab is open, re-read
// player positions every 15s (the server flushes playerdata on logout +
// periodic autosave; seenAt tells how fresh each dot is) and re-scan explored
// chunks every 3rd tick. Camera/zoom are never touched. Singleton ticker,
// no-ops when idle — same pattern as the uptime interval.
let wmLiveTick=0,wmRefreshing=false;
setInterval(()=>{if(wmRefreshing||!state.running||!wm.level)return;const tab=document.getElementById('worldmap');if(!tab||!tab.classList.contains('active'))return;wmLiveRefresh()},15000);
async function wmLiveRefresh(){
  if(wmRefreshing||!state.running||!wm.level)return;
  wmRefreshing=true;
  try{
    const r=await window.observer.worldmapLoad();
    if(r&&r.level&&r.level.ok){
      wm.players=(r.players&&r.players.players)||[];
      wm.level=r.level;
      try{$('#wmSeed').textContent=wm.level.seed}catch{}
      wmRenderList();wmDraw();
      if(++wmLiveTick%3===0)wmLoadChunks(wm.dim);
    }
  }catch{}
  wmRefreshing=false;
}
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
// (Tab activation hook lives in switchTab — see js/08-shell.js.)
$('#wmReload').onclick=wmLoad;
$('#wmReload2').onclick=wmLoad;
$('#wmCopySeed').onclick=async()=>{if(!wm.level)return;try{await navigator.clipboard.writeText(wm.level.seed);toast(t('toast.copied'),'success')}catch{toast(wm.level.seed)}};
$$('#wmDims .filter-chip').forEach(c=>c.onclick=()=>{wm.dim=c.dataset.dim;wm.biomes.clear();wm.lastBiomeRect='';wm.biomeTooWide=false;wm.biomeTruncated=false;wm.explored=new Set();wm.exploredDim=null;wmSyncDimTabs();wmLoadChunks(wm.dim);wmDraw()});
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
  let dragging=false,lx=0,ly=0,downPos=null;
  cv.addEventListener('mousedown',e=>{dragging=true;lx=e.clientX;ly=e.clientY;downPos={x:e.clientX,y:e.clientY};wmHidePopup()});
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
    if(!wm.level)return;
    const r=cv.getBoundingClientRect();
    // A drag-pan also fires click on release — only treat near-stationary
    // presses as clicks so panning never pops the inspector open.
    if(downPos&&Math.hypot(e.clientX-downPos.x,e.clientY-downPos.y)>5){downPos=null;return}
    downPos=null;
    const x=Math.round((e.clientX-r.left-WM_CX())/wm.zoom+wm.cam.x);
    const z=Math.round((e.clientY-r.top-WM_CY())/wm.zoom+wm.cam.z);
    if(wm.addMode){
      wmAddWaypoint(x,z);
      wm.addMode=false;$('#wmAdd').classList.remove('active');
      return;
    }
    wmMapClick(e.clientX-r.left,e.clientY-r.top,x,z);
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
