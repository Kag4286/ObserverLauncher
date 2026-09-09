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
