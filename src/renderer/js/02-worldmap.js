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

let wm={level:null,players:[],waypoints:[],dim:'overworld',cam:{x:0,z:0},zoom:0.25,addMode:false,drag:null,dragWp:null,loaded:false,seedBig:0n,layers:{terrain:true},explored:new Set(),exploredDim:null,biomes:new Map(),biomeReqSeq:0,biomeTimer:null,lastBiomeRect:'',biomeLoading:false,biomeTooWide:false,biomeTruncated:false,terrainCache:new Map(),miniAt:0};
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
// Brightness tint by surface height for a subtle relief (0..~320 → ~0.72..1.25).
function shadeHex(hex,h){
  const f=0.72+Math.max(0,Math.min(1,(Number(h)-60)/140))*0.53;
  const n=parseInt(String(hex).slice(1),16);
  const r=Math.max(0,Math.min(255,Math.round(((n>>16)&255)*f)));
  const g=Math.max(0,Math.min(255,Math.round(((n>>8)&255)*f)));
  const b=Math.max(0,Math.min(255,Math.round((n&255)*f)));
  return '#'+((1<<24)+(r<<16)+(g<<8)+b).toString(16).slice(1);
}
// Blend toward a target colour (used to tint water cells toward ocean blue).
function mixHex(a,b,t){
  const na=parseInt(String(a).slice(1),16),nb=parseInt(String(b).slice(1),16);
  const r=Math.round(((na>>16)&255)*(1-t)+((nb>>16)&255)*t);
  const g=Math.round(((na>>8)&255)*(1-t)+((nb>>8)&255)*t);
  const bl=Math.round((na&255)*(1-t)+(nb&255)*t);
  return '#'+((1<<24)+(r<<16)+(g<<8)+bl).toString(16).slice(1);
}
// Colors depend only on a chunk's own data (biome + 4x4 heights + water), NOT the camera, so we
// compute them ONCE per chunk and reuse across every frame/pan. Before this, biomeColor/shadeHex/
// mixHex (all string parsing) ran for every on-screen cell on every draw — the main source of pan lag.
const wmColorCache=new Map();
function wmChunkColors(ck,cx,cz){
  // W1 (3.2.5): key BOTH caches by dimension so data can NEVER leak across dims, regardless of any
  // clear/timing gap. A stale overworld fetch that lands after a switch writes to 'overworld:*' keys
  // that are never read while wm.dim is 'nether'/'end'. This is the authoritative fix (the clear +
  // seq-bump in the dim handler alone did not fully stop the leak on the user's machine).
  const key=wm.dim+':'+ck;
  const hit=wmColorCache.get(key); if(hit)return hit;
  const rec=wm.biomes.get(key);
  let out;
  if(rec&&rec[2]!==undefined){
    // rec = [cx, cz, biome, heights?, water?, grid?]. rec[5] (1.2.0) is a 4x4 grid of per-cell
    // biome ids — real biome boundaries inside one chunk (coastlines, forest edges) instead of a
    // single flat colour. Falls back to the whole-chunk biome when the grid is absent.
    const grid=rec[5];
    const base=biomeColor(rec[2]);
    if(rec[3]){
      out=new Array(16);
      for(let i=0;i<16;i++){
        const cellBase=grid?biomeColor(grid[i]):base;
        let c=shadeHex(cellBase,rec[3][i]);
        if(rec[4]&&rec[4][i])c=mixHex(c,'#2E5A8A',0.6);
        out[i]=c;
      }
    } else if(grid){
      out=new Array(16);
      for(let i=0;i<16;i++)out[i]=grid[i]?biomeColor(grid[i]):'#20262E';
    } else out=[rec[2]?base:'#20262E'];
  } else if(rec){ out=['#20262E']; }
  else { out=null; } // not loaded — caller uses seed wash
  lruSet(wmColorCache,key,out,4000);
  return out;
}
// MODDED SUPPORT: a biome id we don't recognise (usually added by a mod) still gets a colour,
// derived from a hash of its name so it is stable across sessions/frames and distinct per biome.
// Without this every custom biome collapsed to the same grey.
function hashBiomeColor(k){
  let h=0;const s=String(k||'');
  for(let i=0;i<s.length;i++)h=(h*31+s.charCodeAt(i))>>>0;
  const hue=h%360,sat=0.34,lig=0.52;
  const c=(1-Math.abs(2*lig-1))*sat,x=c*(1-Math.abs((hue/60)%2-1)),m=lig-c/2;
  let r=0,g=0,b=0;
  if(hue<60){r=c;g=x}else if(hue<120){r=x;g=c}else if(hue<180){g=c;b=x}else if(hue<240){g=x;b=c}else if(hue<300){r=x;b=c}else{r=c;b=x}
  const to=n=>Math.round((n+m)*255).toString(16).padStart(2,'0');
  return '#'+to(r)+to(g)+to(b);
}
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
  return hashBiomeColor(k);
}
// Max chunks we ask the backend to parse in one go. Beyond this we skip the fetch and keep
// the seed wash, so panning at a far zoom-out can't tie up the main process (~3s of parsing).
const WM_BIOME_MAX_CHUNKS=1600;
// Below this zoom the viewport spans too many chunks to be worth fetching.
const WM_BIOME_MIN_ZOOM=0.06;
// Hide marker text labels below this zoom so they don't overlap into a smear.
const WM_LABEL_MIN_ZOOM=0.15;
// W4: wm.biomes accumulates every fetched chunk and previously had NO cap - panning a large world
// grew it without bound. Cap it like wmColorCache (evict the oldest entry) so memory stays flat.
const WM_BIOME_CACHE_MAX=6000;
// Store under a dim-scoped key. `dim` is the dim the FETCH was for (captured at call time), so a
// late reply for an old dim can never overwrite the current dim's data.
function wmSetBiome(ck,row,dim){ lruSet(wm.biomes,(dim||wm.dim)+':'+ck,row,WM_BIOME_CACHE_MAX); }
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
    const fetchDim=wm.dim;               // capture NOW so a late reply stores under its OWN dim
    wm.biomeLoading=true;wmDraw();
    let r;
    try{r=await window.observer.worldmapBiomes({dim:fetchDim,cx0,cz0,cx1,cz1})}catch{wm.biomeLoading=false;return}
    if(seq!==wm.biomeReqSeq)return;
    wm.biomeLoading=false;
    if(!r||!r.ok)return;
    wm.biomeTruncated=!!r.truncated;
    let added=0;
    // Each row is [cx, cz, biome, heights?, water?] — store the whole record so the renderer can
    // draw real 4x4 relief + water when present.
    for(const row of r.biomes){if(row&&row.length>=2){wmSetBiome(row[0]+','+row[1],row,fetchDim);added++}}
    if(added||wm.biomeTruncated)wmDraw();
  },220);
}
// Fetch a bounded square of chunks around a centre, ignoring the zoom/viewport limit. Used on
// load so the spawn area shows real biomes even when the whole viewport is too wide to fetch.
async function wmPrefetchBiomes(ccx,ccz,half){
  if(!wm.level)return;
  const seq=++wm.biomeReqSeq;
  const fetchDim=wm.dim;                 // dim-scoped store (W1)
  wm.biomeLoading=true;wmDraw();
  let r;
  try{r=await window.observer.worldmapBiomes({dim:fetchDim,cx0:ccx-half,cz0:ccz-half,cx1:ccx+half,cz1:ccz+half})}catch{wm.biomeLoading=false;return}
  if(seq!==wm.biomeReqSeq)return;
  wm.biomeLoading=false;
  if(!r||!r.ok)return;
  for(const row of r.biomes)if(row&&row.length>=2)wmSetBiome(row[0]+','+row[1],row,fetchDim);
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
  // MODDED HONESTY: custom biomes get approximate colours and custom dimensions can't be drawn.
  // Show a short note (JS-owned text — NOT data-i18n, or applyLocale would clobber it) when the
  // server looks modded OR the world declares dimensions outside the minecraft: namespace.
  (function(){
    const note=$('#wmModdedNote'); if(!note)return;
    const jar=String((typeof state!=='undefined'&&state.files&&state.files.jar)||'');
    const modded=/forge|neoforge|fabric|quilt/i.test(jar);
    const custom=(r.dimensions||[]).filter(d=>!d.startsWith('minecraft:'));
    if(!modded&&!custom.length){note.hidden=true;note.textContent='';return}
    let msg=t('wm.moddedNote');
    if(custom.length)msg+=' '+t('wm.moddedDims',{list:custom.join(', ')});
    note.textContent=msg;note.hidden=false;
  })();
  try { wm.seedBig=BigInt(wm.level.seed); } catch { wm.seedBig=0n }
  $('#wmSeed').textContent=wm.level.seed;
  $('#wmSeed').title=wm.level.levelName+' · '+wm.level.version.name;
  // center on spawn or first player
  const f=wm.players[0]?wm.players[0].pos:wm.level.spawn;
  wm.cam={x:f.x,z:f.z};if(wm.zoom<0.1)wm.zoom=0.25;
  // A1: a reload must not keep stale biome colours from a previous world/session.
  wmClearCaches();
  wmLoadChunks(wm.dim);
  wmRenderList();wmRenderLegend();wmDraw();
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
// WM-1 (3.3.0 perf): the seed-wash colour is a pure function of (dim, wx, wz). Panning re-computed
// valueNoise+hash32 (8 Math.imul) for EVERY unloaded cell EVERY frame - the worst part of pan lag.
// Cache it (bounded LRU), like wmChunkColors already caches real biome colours.
function getTerrainColorCached(wx,wz){
  const k=wm.dim+':'+wx+','+wz;
  let c=wm.terrainCache.get(k);
  if(c===undefined){ c=getTerrainColor(wx,wz,wm.seedBig,wm.dim); lruSet(wm.terrainCache,k,c,6000); }
  return c;
}
// RAM-1 (3.3.0): release the world-map caches (real biomes + colour + terrain wash) when the tab is
// left or the dim/world changes. These Maps are the biggest app-controlled chunk of renderer memory;
// keeping them while the user is on another tab is pure waste. Rebuilt lazily on next open.
function wmClearCaches(){ wm.biomes.clear(); wmColorCache.clear(); wm.terrainCache.clear(); wm.lastBiomeRect=''; wm.biomeTooWide=false; wm.biomeTruncated=false; }
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
    const chunkPx=16*wm.zoom;
    // Close enough to spend pixels on the real 4x4 per-chunk heightmap (relief + water); when
    // zoomed out a single flat cell per chunk is faster and looks the same.
    const detailed=chunkPx>=24;
    const stepW=detailed?4:16;
    const cellPx=Math.max(detailed?3:8,Math.round(stepW*wm.zoom));
    const x0=Math.floor((wm.cam.x-W/2/wm.zoom)/stepW)*stepW;
    const x1=wm.cam.x+W/2/wm.zoom;
    const z0=Math.floor((wm.cam.z-H/2/wm.zoom)/stepW)*stepW;
    const z1=wm.cam.z+H/2/wm.zoom;
    // W3: only touch ctx.fillStyle when the colour actually changes. Assigning it per cell forces a
    // canvas state update even when it is identical, and a biome region is hundreds of same-colour
    // cells in a row. fillRect still runs per cell (that IS the draw); this only drops redundant
    // state sets. Pixel-identical output.
    // WM-1 (3.3.0 perf): draw each HORIZONTAL RUN of one colour as a single fillRect instead of one
    // fillRect per cell. A biome region is hundreds of same-colour cells in a row, so this cuts the
    // fillRect count by 10-100x. Positions use toS() only when a run starts (exact: toS is linear, so
    // width = runW*stepW*zoom). getTerrainColorCached() replaces the per-cell noise re-compute.
    let lastCol=null,runW=0,runSx=0,runSy=0;
    // Exact footprint match: the old loop drew cell i at sx_0 + i*stepW*zoom with width cellPx, so a
    // run of N cells spans (N-1)*stepW*zoom + cellPx (NOT N*stepW*zoom - that leaves gaps at far
    // zoom-out where cellPx is rounded UP to 8).
    const flushRun=()=>{ if(runW>0){ ctx.fillStyle=lastCol; ctx.fillRect(runSx,runSy,(runW-1)*stepW*wm.zoom+cellPx,cellPx); runW=0; } };
    for(let wz=z0;wz<z1;wz+=stepW){
      runW=0; lastCol=null;
      for(let wx=x0;wx<x1;wx+=stepW){
        const cx=Math.floor(wx/16),cz=Math.floor(wz/16);
        if(wm.explored.size && !wm.explored.has(cx+','+cz)){ flushRun(); lastCol=null; continue; }
        const cols=wmChunkColors(cx+','+cz,cx,cz);
        let col;
        if(cols){
          if(cols.length===16){
            const lx=((wx%16)+16)%16, lz=((wz%16)+16)%16;
            col=cols[Math.floor(lz/4)*4+Math.floor(lx/4)];
          } else col=cols[0];
        } else {
          col=getTerrainColorCached(wx,wz);
        }
        if(col!==lastCol){ flushRun(); lastCol=col; const[sx,sy]=toS(wx,wz); runSx=sx; runSy=sy; runW=1; }
        else runW++;
      }
      flushRun();
    }
  }
  wmScheduleBiomes();
  // biome status hint (top-left): a loading indicator while a fetch is in flight, or a
  // "zoom in" note when the viewport is too wide / the backend hit its chunk cap.
  { const hint=wm.biomeLoading?t('wm.loadingBiomes'):((wm.biomeTooWide||wm.biomeTruncated)?t('wm.zoomInBiomes'):null);
    if(hint){ ctx.fillStyle='rgba(232,244,248,.75)';ctx.font='600 10.5px "JetBrains Mono",monospace';ctx.fillText(hint,14,20); } }
  wmDrawMini();
  // scale bar
  const px=step*wm.zoom;
  ctx.fillStyle='rgba(232,244,248,.7)';ctx.font='600 9.5px "JetBrains Mono",monospace';
  ctx.fillText(step+' blocks',14,H-14);
  ctx.strokeStyle='rgba(232,244,248,.7)';ctx.lineWidth=2;
  ctx.beginPath();ctx.moveTo(14,H-24);ctx.lineTo(14+px,H-24);ctx.stroke();
}
// W2: coalesce rapid redraws (pan/wheel fire hundreds of times per second) into ONE draw per frame.
// 3.2.5: shared core helper (was a local copy - same idiom as the editor's edScheduleView).
const wmDrawSoon=rafCoalesce(()=>wmDraw());
function wmJump(x,z){wm.cam={x,z};wmDraw()}
// R1: jump to typed coordinates — accepts "X Z", "X, Z", or "X Z Y" (Y ignored, map is 2D).
function wmGoTo(){
  const el=$('#wmGotoInput');if(!el)return;
  const nums=String(el.value).match(/-?\d+(?:\.\d+)?/g);
  if(!nums||nums.length<2){toast(t('wm.badCoords'));return}
  wmJump(Number(nums[0]),Number(nums[1]));
}
$('#wmGotoBtn')?.addEventListener('click',wmGoTo);
$('#wmGotoInput')?.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();wmGoTo()}});
// W7: zoom buttons + fit-to-spawn. Zoom keeps the camera centre fixed (buttons have no cursor anchor,
// unlike the wheel which zooms toward the pointer).
function wmZoomBy(f){ wm.zoom=Math.max(0.02,Math.min(16,wm.zoom*f)); wmDraw(); }
$('#wmZoomIn')?.addEventListener('click',()=>wmZoomBy(1.25));
$('#wmZoomOut')?.addEventListener('click',()=>wmZoomBy(1/1.25));
// Fit spawn: frame the spawn area (~256 blocks) and centre the camera on it.
function wmFitSpawn(){
  const sp=(wm.level&&wm.level.spawn)||{x:0,z:0};
  const cv=$('#wmCanvas'); const span=Math.min(cv.clientWidth||800,cv.clientHeight||520);
  wm.zoom=Math.max(0.02,Math.min(16,span/512));
  wm.cam={x:sp.x,z:sp.z};
  wmDraw();
}
$('#wmFitSpawn')?.addEventListener('click',wmFitSpawn);
function wmRenderList(){
  const box=$('#wmWpList');const list=wm.waypoints;
  $('#wmWpCount').textContent=String(list.length);
  box.innerHTML=list.length?list.map(w=>`<div class="wm-wprow" data-id="${esc(w.id)}"><span class="wm-dot" style="background:${esc(w.color)}"></span><div class="wm-wpmain"><b>${esc(w.name)}</b><small>${esc(w.dim)} · ${Math.round(w.x)} ${Math.round(w.z)}</small></div><button class="text-btn" data-wm-jump="${esc(w.id)}">${esc(t('wm.jump'))}</button><button class="text-btn danger" data-wm-del="${esc(w.id)}">${esc(t('wm.delete'))}</button></div>`).join(''):`<p class="field-hint">${esc(t('wm.none'))}</p>`;
  box.querySelectorAll('[data-wm-jump]').forEach(b=>b.onclick=()=>{const w=wm.waypoints.find(x=>x.id===b.dataset.wmJump);if(w){wmJump(w.x,w.z);if(w.dim!==wm.dim){wm.dim=w.dim;wmSyncDimTabs();wmDraw()}}});
  box.querySelectorAll('[data-wm-del]').forEach(b=>b.onclick=async()=>{wm.waypoints=wm.waypoints.filter(x=>x.id!==b.dataset.wmDel);await window.observer.worldmapSetWaypoints(wm.waypoints);wmRenderList();wmDraw()});
}
function wmSyncDimTabs(){$$('#wmDims .filter-chip').forEach(c=>c.classList.toggle('active',c.dataset.dim===wm.dim))}
// W8: biome legend - a compact key of the colour families the map uses, per dimension. Colours
// are the same representative swatches as BIOME_COLORS/getTerrainColor, so the key always matches
// what is on screen. Rebuilt on load + whenever the dimension changes.
const WM_LEGEND={
  overworld:[['water','#2E5A8A'],['plains','#6FA84E'],['forest','#3F7A3A'],['desert','#D8C77A'],['snow','#D7DCE0'],['mountain','#8A8A7E'],['swamp','#5A6B45']],
  nether:[['nether','#7A3B33']],
  end:[['end','#C9C29A']]
};
function wmRenderLegend(){
  const box=$('#wmLgGrid');if(!box)return;
  const rows=WM_LEGEND[wm.dim]||WM_LEGEND.overworld;
  box.innerHTML=rows.map(([k,c])=>`<span class="wm-lg-chip"><i style="background:${c}"></i>${esc(t('wm.lg.'+k))}</span>`).join('');
}
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
  if(!r||!r.ok) toast(t('toast.wpSaveFail'),'error');
  else toast(name+' ✓','success');
  wmRenderList();wmDraw();
  wmJump(x,z);
}
// (Tab activation hook lives in switchTab — see js/08-shell.js.)
$('#wmReload').onclick=wmLoad;
$('#wmReload2').onclick=wmLoad;
$('#wmCopySeed').onclick=async()=>{if(!wm.level)return;try{await navigator.clipboard.writeText(wm.level.seed);toast(t('toast.copied'),'success')}catch{toast(wm.level.seed)}};
// W1: switching dimension MUST clear wmColorCache too. Its key is 'cx,cz' with no dim, so a chunk
// viewed in one dimension kept that dimension's colour after switching (until the 4000-entry LRU
// evicted it). wmLoad() already clears both; this path must match.
// W1: switching dimension must (a) clear BOTH caches and (b) INVALIDATE any in-flight/queued biome
// fetch from the OLD dimension, or its response lands after the switch and paints old-dimension
// biome colours into the new one. Bump the request seq + cancel the debounce timer so a late reply
// is dropped (the seq check in wmScheduleBiomes/wmPrefetchBiomes discards stale responses).
$$('#wmDims .filter-chip').forEach(c=>c.onclick=()=>{wm.dim=c.dataset.dim;clearTimeout(wm.biomeTimer);wm.biomeReqSeq++;wm.biomeLoading=false;wmClearCaches();wm.explored=new Set();wm.exploredDim=null;wmSyncDimTabs();wmRenderLegend();wmLoadChunks(wm.dim);wmDraw()});
$('#wmAdd').onclick=()=>{wm.addMode=!wm.addMode;$('#wmAdd').classList.toggle('active',wm.addMode)};
async function wmLoadChunks(dim){
  if(!dim)dim=wm.dim; // defensive: default to the ACTIVE dim so an undefined caller can't null wm.exploredDim
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
  // W6: Pointer Events (not mouse-only) so touch + pen pan/click work too. touch-action:none
  // (CSS) stops the browser from scrolling instead of panning. pointerdown/up fire for every
  // pointer type; hover coords still update for a mouse (pointermove without a pressed button).
  cv.addEventListener('pointerdown',e=>{
    if(e.button!==0&&e.pointerType==='mouse')return; // left button / any touch or pen
    try{cv.focus({preventScroll:true})}catch{} // W8: focus the canvas so keyboard pan/zoom works
    // W8: grabbing a waypoint marker DRAGS it instead of panning. Only a marker in the current
    // dimension, and never in add mode (there a click places a NEW waypoint). Hit test is the
    // same 14px radius as click-to-inspect, done newest-first so overlapping pins pick the top one.
    if(!wm.addMode&&wm.level){
      const r=cv.getBoundingClientRect(),px=e.clientX-r.left,py=e.clientY-r.top;
      const wps=wm.waypoints.filter(w=>w.dim===wm.dim);
      for(let i=wps.length-1;i>=0;i--){
        const[sx,sy]=wmToScreen(wps[i].x,wps[i].z);
        if(Math.hypot(px-sx,py-sy)<=14){wm.dragWp=wps[i];downPos=null;try{cv.setPointerCapture(e.pointerId)}catch{};wmHidePopup();return}
      }
    }
    dragging=true;lx=e.clientX;ly=e.clientY;downPos={x:e.clientX,y:e.clientY};
    try{cv.setPointerCapture(e.pointerId)}catch{}
    wmHidePopup();
  });
  cv.addEventListener('pointerup',e=>{
    if(wm.dragWp){
      wm.dragWp=null;
      try{cv.releasePointerCapture(e.pointerId)}catch{}
      // Persist the moved waypoint; refresh the side list so its coords update. No toast - the
      // marker visibly moved and a toast per drag would be noisy.
      window.observer.worldmapSetWaypoints(wm.waypoints).catch(()=>{});
      wmRenderList();
      return;
    }
    if(!dragging)return;
    dragging=false;
    try{cv.releasePointerCapture(e.pointerId)}catch{}
    // A drag-pan also fires pointerup — only treat near-stationary presses as clicks so
    // panning never pops the inspector open.
    if(!wm.level){downPos=null;return}
    if(downPos&&Math.hypot(e.clientX-downPos.x,e.clientY-downPos.y)>5){downPos=null;return}
    downPos=null;
    const r=cv.getBoundingClientRect();
    const x=Math.round((e.clientX-r.left-WM_CX())/wm.zoom+wm.cam.x);
    const z=Math.round((e.clientY-r.top-WM_CY())/wm.zoom+wm.cam.z);
    if(wm.addMode){
      wmAddWaypoint(x,z);
      wm.addMode=false;$('#wmAdd').classList.remove('active');
      return;
    }
    wmMapClick(e.clientX-r.left,e.clientY-r.top,x,z);
  });
  cv.addEventListener('pointercancel',()=>{dragging=false;downPos=null;wm.dragWp=null});
  cv.addEventListener('pointermove',e=>{
    const r=cv.getBoundingClientRect();
    const wx=Math.round((e.clientX-r.left-WM_CX())/wm.zoom+wm.cam.x);
    const wz=Math.round((e.clientY-r.top-WM_CY())/wm.zoom+wm.cam.z);
    $('#wmCoord').textContent=wx+' '+wz;
    if(wm.dragWp){wm.dragWp.x=wx;wm.dragWp.z=wz;wmDrawSoon();return}
    if(!dragging)return;
    wm.cam.x-=(e.clientX-lx)/wm.zoom;wm.cam.z-=(e.clientY-ly)/wm.zoom;
    lx=e.clientX;ly=e.clientY;wmDrawSoon();
  });
  cv.addEventListener('wheel',e=>{
    e.preventDefault();
    const r=cv.getBoundingClientRect();
    const wx=(e.clientX-r.left-WM_CX())/wm.zoom+wm.cam.x;
    const wz=(e.clientY-r.top-WM_CY())/wm.zoom+wm.cam.z;
    wm.zoom=Math.max(0.02,Math.min(16,wm.zoom*(e.deltaY<0?1.2:1/1.2)));
    wm.cam={x:wx-(e.clientX-r.left-WM_CX())/wm.zoom,z:wz-(e.clientY-r.top-WM_CY())/wm.zoom};
    wmDrawSoon();
  },{passive:false});
  // W6: the old separate 'click' handler is GONE - pointerup now owns click-to-inspect and
  // add-waypoint. Keeping both would fire the action twice (pointerup AND the synthetic click).
  // W8: keyboard pan/zoom - canvas has tabindex=0 (index.html) so arrows move the camera,
  // +/- zoom, 0 fits spawn. Skips when a modifier is held so it never fights browser shortcuts.
  cv.addEventListener('keydown',e=>{
    if(e.ctrlKey||e.metaKey||e.altKey)return;
    const pan=80/wm.zoom;
    switch(e.key){
      case 'ArrowLeft':  wm.cam.x-=pan; break;
      case 'ArrowRight': wm.cam.x+=pan; break;
      case 'ArrowUp':    wm.cam.z-=pan; break;
      case 'ArrowDown':  wm.cam.z+=pan; break;
      case '+': case '=': wmZoomBy(1.25);   e.preventDefault(); return;
      case '-': case '_': wmZoomBy(1/1.25); e.preventDefault(); return;
      case '0': wmFitSpawn(); e.preventDefault(); return;
      default: return;
    }
    e.preventDefault();
    wmDrawSoon();
  });
  new ResizeObserver(()=>wmDraw()).observe(cv);
})();
function WM_CX(){return ($('#wmCanvas').clientWidth||800)/2}
function WM_CY(){return ($('#wmCanvas').clientHeight||520)/2}
// W8: overview minimap - a small fixed canvas showing explored chunks + the current viewport
// rectangle, so panning a large world keeps a sense of where you are. Pointer-events:none
// (CSS) so it never steals a map drag; redrawn from wmDraw so it always matches the main view.
const WM_MINI_PX=160;
// WM-2 (3.3.0 perf): two fixes. (1) Throttle: the minimap redraws at most every 400ms instead of
// on EVERY pan frame (force:true for explicit redraws). (2) One pass instead of two: split+parse the
// explored set ONCE, keep the bbox, and draw a SAMPLED subset (stride) rather than a hard 4000 cap
// that just skipped the tail. Much cheaper on a big world.
function wmDrawMini(force){
  const cv=$('#wmMini');if(!cv||!wm.level)return;
  const now=Date.now(); if(!force&&now-(wm.miniAt||0)<400)return; wm.miniAt=now;
  const ctx=cv.getContext('2d'),S=WM_MINI_PX,dpr=devicePixelRatio||1;
  if(cv.width!==S*dpr){cv.width=S*dpr;cv.height=S*dpr}
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.clearRect(0,0,S,S);
  // World extent: explored chunk bounds unioned with the current viewport (so the rect is always
  // on the minimap). No explored data -> a fixed window around the camera.
  let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;
  const size=wm.explored.size, stride=size>4000?Math.ceil(size/4000):1;
  const pts=[]; let idx=0;
  for(const k of wm.explored){
    const p=k.split(','),ax=Number(p[0]),az=Number(p[1]);
    if(!isFinite(ax)||!isFinite(az))continue;
    if(ax<minX)minX=ax;if(ax>maxX)maxX=ax;if(az<minZ)minZ=az;if(az>maxZ)maxZ=az;
    if(idx++%stride===0)pts.push([ax,az]);
  }
  const vw=((($('#wmCanvas').clientWidth||800))/2)/wm.zoom,vh=((($('#wmCanvas').clientHeight||520))/2)/wm.zoom;
  minX=Math.min(minX,wm.cam.x-vw);maxX=Math.max(maxX,wm.cam.x+vw);
  minZ=Math.min(minZ,wm.cam.z-vh);maxZ=Math.max(maxZ,wm.cam.z+vh);
  if(!isFinite(minX)){minX=wm.cam.x-1000;maxX=wm.cam.x+1000;minZ=wm.cam.z-1000;maxZ=wm.cam.z+1000}
  const span=Math.max(maxX-minX,maxZ-minZ,32)*1.12,midX=(minX+maxX)/2,midZ=(minZ+maxZ)/2;
  const toM=(wx,wz)=>[(wx-(midX-span/2))/span*S,(wz-(midZ-span/2))/span*S];
  const dot=Math.max(1,(16/span)*S);
  ctx.fillStyle='rgba(0,229,255,.28)';
  for(const[ax,az]of pts){const[sx,sy]=toM(ax*16+8,az*16+8);if(sx<0||sx>S||sy<0||sy>S)continue;ctx.fillRect(sx,sy,dot,dot)}
  for(const m of wmVisible()){const[sx,sy]=toM(m.x,m.z);ctx.fillStyle=m.color;ctx.beginPath();ctx.arc(sx,sy,1.8,0,7);ctx.fill()}
  const[vx0,vy0]=toM(wm.cam.x-vw,wm.cam.z-vh),[vx1,vy1]=toM(wm.cam.x+vw,wm.cam.z+vh);
  ctx.strokeStyle='rgba(232,244,248,.85)';ctx.lineWidth=1;
  ctx.strokeRect(vx0,vy0,Math.max(2,vx1-vx0),Math.max(2,vy1-vy0));
}
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
  if(!$('#playerInspectModal').hidden&&lastInspectData){
    renderEquipment(lastInspectData.armor,lastInspectData.offhand);
    renderItemGrid('#inventoryList',lastInspectData.inventory);
    renderItemGrid('#enderChestList',lastInspectData.enderChest);
  }
});
