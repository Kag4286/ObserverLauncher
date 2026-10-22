// js/03-players.js — split from app.js (lines 539-703); classic script, load in numeric order.
// Players tab: roster, badges, inspector, OP/whitelist/ban.
// TEXT-ONLY item display — no textures, just readable labels. Keeps the same IDs so save logic is untouched.
function itemLabel(id){
  const raw=String(id||'');
  // Keep the namespace when it's a MOD's: "create:wrench" must not render as the vanilla
  // "Wrench" -- different items, and the player would be looking at the wrong thing.
  const i=raw.indexOf(':');
  if(i>0)return (raw.slice(0,i)+' '+raw.slice(i+1)).replace(/[_.]/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
  return raw.replace(/^minecraft:/,'').replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase())||t('ply.unknownItem')
}
// Durability bar colour follows the game's own convention: green -> yellow -> red.
function durColor(d){const r=d.remaining/d.max;return r>0.5?'var(--success)':r>0.25?'#e2b93b':'#e05a4a'}
const ROMAN=['','I','II','III','IV','V','VI','VII','VIII','IX','X'];
const romanNum=n=>ROMAN[n]||String(n);
// Hover text: real item name (or the anvil name), enchantments in roman numerals, remaining
// durability, and the raw id so a mod item can be looked up.
function itemTooltip(x,label){
  const lines=[label];
  if(x.customName&&x.customName!==label)lines.push(itemLabel(x.id));
  for(const e of x.enchantments||[])lines.push(`${itemLabel(e.id)} ${romanNum(e.level)}`);
  for(const e of x.storedEnchantments||[])lines.push(`${itemLabel(e.id)} ${romanNum(e.level)}`);
  if(x.durability)lines.push(`${x.durability.remaining} / ${x.durability.max}`);
  lines.push(`×${x.count}`,x.id);
  return esc(lines.join('\n'));
}
// ONE place decides which tex:// URL an item id maps to. The inventory grid used to carry this
// logic inline while the equipment row did not, so a mod item worn as armor fell through to the
// initials badge even though the mod jar had the texture. Both call this now.
function itemIconUrl(id){
  const s=String(id||'');
  if(!s) return null;
  const vanilla=!s.includes(':')||s.startsWith('minecraft:');
  if(vanilla){
    const idNoPrefix=s.replace(/^minecraft:/,'').replace(/[^a-z0-9_]/g, '');
    return `tex://auto/item/${idNoPrefix}.png`;
  }
  // tex:// path segments cannot hold a slash, so pack `<namespace>~<name>` and split it in main.
  // The tilde is not valid in a resource location, so it can never collide with an underscore
  // that lives inside either the namespace or the item name (cofh_core_wrench).
  const [ns, ...rest]=s.split(':');
  const nm=rest.join(':').replace(/\.png$/,'');
  return (ns&&nm)?`tex://auto/itemmod/${encodeURIComponent(ns)}~${encodeURIComponent(nm)}.png`:null;
}
// tex:// answers a cache miss with a 1x1 transparent PNG and HTTP 200, so onerror never fires.
// Detect that placeholder in onload and swap in the readable label instead of a blank cell.
function itemCellInner(iconUrl,label){
  // Fallback: two-letter initials inside the square cell. The full label used to be written as
  // text, which overflowed neighbouring cells (a grid item's min-width was auto) and could never
  // be replaced when the real icon finally arrived. Initials stay short enough to keep the cell
  // square.
  const initials=(String(label||'').replace(/[^A-Za-z0-9]/g,'').slice(0,2)||'?').toUpperCase();
  if(!iconUrl)return `<span class="inv-initial">${esc(initials)}</span>`;
  return `<img src="${iconUrl}" alt="" data-fb="${esc(initials)}">`;
}
// A load event that resolves to the 1x1 placeholder means the texture is not on the mirror (or not
// in the mod jar). Mark the parent cell so CSS shows the initials badge, and clear the mark when a
// real texture arrives on a re-render. Do NOT swap the img for text: that change is what made a
// long label stretch the whole row.
document.addEventListener('load', (e) => {
  const img = e.target;
  if (!img || img.tagName !== 'IMG' || !img.dataset || img.dataset.fb === undefined) return;
  const cell = img.closest && img.closest('.inv-cell');
  if (!cell) return;
  if (img.naturalWidth > 1) { cell.classList.remove('icon-missing'); return; }
  cell.classList.add('icon-missing');
  cell.setAttribute('data-initial', img.dataset.fb);
}, true);
// v4.0.0: config-driven grid so hotbar (0-8) / main inventory (9-35) / ender chest (0-26)
// share one renderer. base = first slot index, slots = how many.
const GRID_CFG={
  '#hotbarList':{slots:9,base:0,count:'#hotbarCount',bar:null,getQ:()=>'',getShow:()=>invShowEmpty,getSort:()=>invSortBy},
  '#inventoryList':{slots:27,base:9,count:'#invCount',bar:'#invBar',getQ:()=>invSearchQuery,getShow:()=>invShowEmpty,getSort:()=>invSortBy},
  '#enderChestList':{slots:27,base:0,count:'#ecCount',bar:'#ecBar',getQ:()=>ecSearchQuery,getShow:()=>ecShowEmpty,getSort:()=>ecSortBy},
};
function renderItemGrid(id,items){
  const n=$(id);if(!n)return;
  const cfg=GRID_CFG[id];if(!cfg)return;
  const q=String(cfg.getQ()||'').trim().toLowerCase();
  const showEmpty=cfg.getShow();
  const sortBy=cfg.getSort();
  const raw=(items||[]).filter(x=>x&&x.id&&x.id!=='minecraft:air'&&x.slot>=cfg.base&&x.slot<cfg.base+cfg.slots);
  const totalSlots=cfg.slots;
  const used=raw.length;
  const countEl=$(cfg.count); if(countEl) countEl.textContent=`${used} / ${totalSlots}`;
  const bar=cfg.bar?$(cfg.bar):null; if(bar) bar.style.width=`${Math.round(used/totalSlots*100)}%`;
  if(!used && !showEmpty){n.innerHTML=`<div class="inv-empty"><b>${esc(t('pd.emptyInv'))}</b><span>${esc(t('pd.emptyInvSub'))}</span></div>`;return}
  let list;
  if(showEmpty){
    const bySlot=new Map(raw.map(x=>[x.slot,x]));
    list=[];
    for(let s=cfg.base;s<cfg.base+totalSlots;s++){const it=bySlot.get(s);list.push(it||{slot:s,id:null,count:0,empty:true})}
  }else{list=[...raw]}
  if(q) list=list.filter(x=>!x.empty && String(x.id).toLowerCase().includes(q));
  if(sortBy==='name') list.sort((a,b)=>String(a.id||'').localeCompare(String(b.id||'')));
  else if(sortBy==='count') list.sort((a,b)=>(b.count||0)-(a.count||0));
  else list.sort((a,b)=>a.slot-b.slot);
  if(!list.length){n.innerHTML=`<div style="grid-column:1/-1" class="inv-empty"><b>${esc(t('pd.noMatch'))}</b><span>${esc(t('pd.noMatchSub'))}</span></div>`;return}
  n.innerHTML=list.map((x,i)=>{
    if(x.empty) return `<div class="inv-cell empty" data-tip="Slot ${x.slot}"></div>`;
    const label=x.customName||itemLabel(x.id);
    // Vanilla ids resolve on the PrismarineJS mirror; a mod id is read from the server's own
    // mods/*.jar through the tex:// itemmod kind (see itemIconUrl).
    const iconUrl=itemIconUrl(x.id);
    const tip=itemTooltip(x,label);
    // BUGFIX: `ench` was computed and then never applied, and no .enchanted rule existed, so an
    // enchanted item looked identical to a plain one. The flag is applied now and the CSS draws a
    // subtle glint overlay. The old `no-tex` class is gone too: the initials badge replaced it
    // during the redesign and nothing styles it any more.
    const ench=x.enchantments?.length||x.storedEnchantments?.length?' enchanted':'';
    const dur=x.durability?`<span class="inv-dur" style="width:${Math.max(2,Math.round(x.durability.remaining/x.durability.max*100))}%;background:${durColor(x.durability)}"></span>`:'';
    return `<div class="inv-cell${ench}" data-tip="${tip}">${itemCellInner(iconUrl,label)}${dur}<span class="inv-count">${x.count>1?x.count:''}</span></div>`;
  }).join('');
}
function renderEquipment(armor,offhand){
  // v6.0.0 redesign: equipment is a row of real icon tiles that reuses the inventory cell, so the
  // icon sizing, the durability bar and the missing-texture fallback are shared instead of a
  // second implementation (the old version was a text row with a dashed border).
  const n=$('#equipmentGrid');if(!n)return;
  const slots=[...(armor||[]),...(offhand?[{slot:'Offhand',id:offhand.id,count:offhand.count}]:[])];
  const order=['Helmet','Chestplate','Leggings','Boots','Offhand'];
  n.innerHTML=order.map(label=>{
    const it=slots.find(x=>x.slot===label);
    // A short dash, not the long "— Empty —" label: inside a fixed-height square cell the long
    // string wrapped onto three lines and stretched that one tile taller than the icon tiles
    // beside it (the uneven row the user saw). The slot name under the tile already says which
    // piece is empty.
    let cell='–';
    if(it&&it.id){
      // BUGFIX: this used to build a vanilla-only URL and pass null for a mod item, so worn mod
      // armor always showed the initials badge. itemIconUrl routes a mod id to the jar texture.
      cell=itemCellInner(itemIconUrl(it.id),itemLabel(it.id));
    }
    // The long "— Empty —" label stays available as the hover title instead of being rendered
    // inside the tile, where it wrapped and stretched the row.
    // Use the same rich tooltip as the inventory grid (enchantments, durability, count), not the
    // bare id, so a worn enchanted chestplate says so on hover.
    const tip = it && it.id ? itemTooltip(it, itemLabel(it.id)) : t('ply.emptySlot');
    return `<div class="pd-equip"><div class="inv-cell${it&&it.id?'':' empty'}" data-tip="${esc(tip)}">${cell}</div><span>${esc(label)}</span></div>`;
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
function badgeHtml(p){const b=[];if(p.op)b.push('<span class="player-badge op">OP</span>');if(p.whitelisted)b.push('<span class="player-badge whitelisted">WL</span>');if(p.banned)b.push(`<span class="player-badge banned">${t('ply.bannedBadge')}</span>`);return b.join('')}
function rowActionBtn(action,label,active,cls='',extra=''){return `<button class="row-action ${cls} ${active?'active':''}" data-row-action="${action}" ${extra}>${label}</button>`}
let lastPlayersSig='';
// v6.0.0 Track B: local avatar cache to avoid CSP-blocked external images.
const headAvatarCache = {};
const pendingHeadFetches = new Set();
// A colored square with the player's initial, used whenever no Mojang skin is available
// (offline UUID, failed fetch). This replaces the faint generic person icon so the roster
// and inspector header always show a stable, visible face.
function playerInitialsAvatar(name) {
  const initial = String(name || '?').trim().charAt(0).toUpperCase() || '?';
  let hash = 0;
  for (const c of String(name || '?')) hash = (hash * 31 + c.charCodeAt(0)) & 0xffffffff;
  const hue = Math.abs(hash) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" rx="6" fill="hsl(${hue},32%,24%)"/><text x="32" y="34" dominant-baseline="central" text-anchor="middle" font-family="system-ui,sans-serif" font-size="28" font-weight="700" fill="hsl(${hue},60%,75%)">${initial}</text></svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}
function getHeadAvatarHtml(uuid, name) {
  const fallback = `<img class="player-avatar" src="${playerInitialsAvatar(name)}" alt="">`;
  if (!uuid) return fallback;
  if (headAvatarCache[uuid]) return `<img class="player-avatar" src="${headAvatarCache[uuid]}" alt="">`;
  // Offline UUIDs are no longer short-circuited: the backend now falls back to the user's own
  // Steve/Alex texture, and the face crop below turns that into a real default avatar.
  if (!pendingHeadFetches.has(uuid)) {
    pendingHeadFetches.add(uuid);
    window.observer.playerSkin(uuid).then(res => {
      if (res && res.ok && res.dataUri) {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = 8; canvas.height = 8;
          const ctx = canvas.getContext('2d');
          // Draw face (8x8 at 8,8)
          ctx.drawImage(img, 8, 8, 8, 8, 0, 0, 8, 8);
          // Draw hat layer (8x8 at 40,8)
          ctx.drawImage(img, 40, 8, 8, 8, 0, 0, 8, 8);
          headAvatarCache[uuid] = canvas.toDataURL('image/png');
          try { renderPlayers(); } catch {}
        };
        img.src = res.dataUri;
      } else {
        // Transient failure (network, timeout): allow the next render to retry.
        pendingHeadFetches.delete(uuid);
      }
    }).catch(() => { pendingHeadFetches.delete(uuid); });
  }
  return fallback;
}
function renderPlayers(){
  const n=$('#playersList');if(!n)return;
  const all=buildPlayerRows();
  let list=playerFilter==='online'?all.filter(p=>p.online):playerFilter==='offline'?all.filter(p=>!p.online):playerFilter==='whitelist'?all.filter(p=>p.whitelisted):playerFilter==='banned'?all.filter(p=>p.banned):playerFilter==='ops'?all.filter(p=>p.op):all;
  const q=playerSearchQuery.trim().toLowerCase();
  if(q) list=list.filter(p=>String(p.name).toLowerCase().includes(q));
  const totalPages=Math.max(1,Math.ceil(list.length/PLAYERS_PAGE_SIZE));
  playerPage=Math.min(playerPage,totalPages-1);
  const page=list.slice(playerPage*PLAYERS_PAGE_SIZE,(playerPage+1)*PLAYERS_PAGE_SIZE);
  // Signature guard: refreshUI() (server:files / server:state / live) can call this many times a
  // second. Rebuilding innerHTML each time restarts the row stagger animation -> visible flicker.
  // If the page content is unchanged, leave the DOM alone.
  // BUGFIX: include the avatar cache size in the signature. getHeadAvatarHtml() fetches the skin
  // asynchronously and then calls renderPlayers() to swap the placeholder for the real face, but the
  // signature did not change, so the early-return below left every row on person.svg forever.
  const sig=JSON.stringify([currentLocale,playerPage,playerFilter,q,totalPages,list.length,Object.keys(headAvatarCache).length,page.map(p=>[p.name,p.uuid,p.online,p.hasData,p.op,p.whitelisted,p.banned])]);
  if(sig===lastPlayersSig)return;
  lastPlayersSig=sig;
  const pager=$('#playersPager');
  const countEl=$('#rosterCount'); if(countEl) countEl.textContent=t('ply.count',{a:list.length,b:all.filter(p=>p.online).length});
  if(pager){pager.hidden=totalPages<=1;$('#playersPageLabel').textContent=`${t('ply.page')} ${playerPage+1} / ${totalPages}`;$('#playersPrevPage').disabled=playerPage<=0;$('#playersNextPage').disabled=playerPage>=totalPages-1}
  if(!page.length){n.innerHTML=`<div class="player-empty"><b>${t('ply.empty')}</b><span>${t('ply.emptySub')}</span></div>`}else{n.innerHTML=page.map(p=>{
    const attrs=`data-player="${esc(p.name)}" data-uuid="${esc(p.uuid||'')}"`;
    const avatar = getHeadAvatarHtml(p.uuid, p.name);
    const meta=[p.online?`<span style="color:var(--success)">${t('ply.online')}</span>`:`<span>${t('ply.offline')}</span>`, p.hasData?t('ply.hasData'):t('ply.noData'), p.uuid?`UUID ${esc(p.uuid.slice(0,8))}…`:null].filter(Boolean).join(' • ');
    return `<div class="player-row ${p.online?'online':''}" tabindex="0" role="listitem">
      ${avatar}
      <div class="player-main">
        <div class="player-name"><i class="player-row-dot"></i><b>${esc(p.name)}</b>${badgeHtml(p)}</div>
        <div class="player-meta">${meta}</div>
      </div>
      <div class="player-row-actions">
        ${rowActionBtn('op',p.op?t('ply.removeOp'):t('ply.makeOp'),p.op,'',`${attrs} data-value="${p.op?'off':'on'}"`)}
        ${rowActionBtn('whitelist',p.whitelisted?t('ply.unwhitelist'):t('ply.whitelist'),p.whitelisted,'',`${attrs} data-value="${p.whitelisted?'off':'on'}"`)}
        ${rowActionBtn('ban',p.banned?t('ply.unban'):t('ply.ban'),p.banned,'danger',`${attrs} data-value="${p.banned?'off':'on'}"`)}
        <button class="row-action danger" data-row-action="kick" ${attrs} ${p.online?'':`disabled data-tip="${t('ply.kickHint')}"`}>${t('ply.kick')}</button>
        <button class="row-action ${p.hasData?'':'muted'}" data-row-action="inspect" ${attrs} data-tip="${p.hasData?t('ply.inspectHint'):t('ply.noDataHint')}">${t('ply.inspect')}</button>
      </div>
    </div>`;
  }).join('')}
}
async function togglePlayerOp(p,on){const bad=playerNameError(p.name);if(bad)return toast(bad);if(!p.uuid&&!state.running)return toast(t('toast.noUuid'));const r=await window.observer.playerOpToggle({uuid:p.uuid,name:p.name,op:on});if(!r.ok)return toast(r.error);state.files=r.files;refreshUI();toast(t(on?'toast.nowOp':'toast.noLongerOp',{n:p.name}))}
async function togglePlayerWhitelist(p,add){const bad=playerNameError(p.name);if(bad)return toast(bad);if(!p.uuid&&!state.running)return toast(t('toast.noUuid'));const r=await window.observer.playerWhitelistToggle({uuid:p.uuid,name:p.name,add});if(!r.ok)return toast(r.error);state.files=r.files;refreshUI();toast(t(add?'toast.addedWl':'toast.removedWl',{n:p.name}))}
async function togglePlayerBan(p,ban){const bad=playerNameError(p.name);if(bad)return toast(bad);if(!p.uuid&&!state.running)return toast(t('toast.noUuid'));const r=await window.observer.playerBanToggle({uuid:p.uuid,name:p.name,ban});if(!r.ok)return toast(r.error);state.files=r.files;refreshUI();toast(t(ban?'toast.banned':'toast.unbanned',{n:p.name}))}
function openPlayerInspectModal(){const m=$('#playerInspectModal'); m.classList.remove('closing'); m.hidden=false; void m.offsetWidth; trapFocus(m);
  // BUGFIX: the Live actions and Saved data selects were plain <select> elements, so the OS drew
  // their popup and it looked foreign next to the animated dropdowns elsewhere. They now carry
  // .ol-select; this call covers a case where the modal was rebuilt after enhanceAll() ran at load.
  if(window.enhanceAllSelects)try{window.enhanceAllSelects(m)}catch{} }
// Fade-out is handled by the universal .modal-overlay [hidden] transition (08-motion.css) — just
// flip the attribute and drop the transient class after the fade finishes.
function closePlayerInspectModal(){const m=$('#playerInspectModal'); if(m.hidden) return; const cv=$('#pd3dCanvas'); if(cv&&cv._playerRenderer&&typeof cv._playerRenderer.destroy==='function') cv._playerRenderer.destroy(); releaseFocus(); m.classList.add('closing'); m.hidden=true; setTimeout(()=>m.classList.remove('closing'),220);}
// ============ PLAYER INSPECTOR (3-tab rework) ============
// Overview (always read-only) · Live actions (console commands while the server runs) ·
// Saved data (edit the .dat — server must be stopped). Separating these keeps reading, live
// admin and risky file edits apart, so a read never sits next to a destructive checkbox.
let pdActiveTab='overview';
function pdSetTab(tab){
  pdActiveTab=tab;
  $$('.inspect-tab').forEach(b=>{const on=b.dataset.pdTab===tab;b.classList.toggle('active',on);b.setAttribute('aria-selected',on?'true':'false')});
  $$('.inspect-panel').forEach(p=>p.classList.toggle('active',p.id==='pdPanel'+tab.charAt(0).toUpperCase()+tab.slice(1)));
}
function pdIsOnline(name,uuid){
  if(!state.running)return false;
  const live=(state.live?.players||[]).map(p=>typeof p==='string'?{name:p}:p);
  const n=String(name||'').toLowerCase();
  return live.some(p=>String(p.name||'').toLowerCase()===n||(uuid&&p.uuid===uuid));
}
function renderPdReadout(d,isOnline){
  // v6.0.0 redesign: hierarchy before decoration (DESIGN.md 2.2). Four headline facts at display
  // weight, one supporting line, and the full detail behind a disclosure (2.4).
  //
  // FOLLOW-UP: the four numbers read as one block of identical text, which is what the user meant
  // by "all text". Three signals now carry information the numbers alone could not:
  //   - health and food render as 10-segment meters, the same count as the in-game hearts and
  //     drumsticks, so a player at 18 HP shows nine lit segments without reading the digit;
  //   - gamemode carries its in-game colour (survival green, creative violet, adventure orange);
  //   - the dimension is a chip tinted by the vanilla world it belongs to, and the 3D backdrop
  //     takes the same tint (see data-dim on #pd3dContainer), so the model visibly sits IN a world.
  // Every value still appears in All stats below, nothing is lost.
  const gm=['Survival','Creative','Adventure','Spectator'][d.gameType??0]||'—';
  const gmClass=['gm-survival','gm-creative','gm-adventure','gm-spectator'][d.gameType??0]||'';
  const vital=(k,v,c)=>`<div class="pd-vital"><span>${esc(k)}</span><b class="${c||''}">${esc(String(v))}</b></div>`;
  const meter=(k,value,cls)=>{
    const max=20, segments=10;
    const hasValue = value !== null && value !== undefined;
    const n = hasValue ? Math.max(0, Math.min(max, Number(value) || 0)) : 0;
    const filled = hasValue ? Math.round(n / max * segments) : 0;
    const segs = Array.from({length: segments}, (_, i) => `<i class="${i < filled ? cls : ''}"></i>`).join('');
    return `<div class="pd-vital pd-vital-meter"><span>${esc(k)}</span><b>${hasValue ? esc(String(n)) : '—'}</b>` +
      `<div class="pd-meter" role="meter" aria-valuemin="0" aria-valuemax="${max}" aria-valuenow="${n}"${hasValue ? '' : ' aria-disabled="true"'}>${segs}</div></div>`;
  };
  const vitals=$('#pdVitals');
  if(vitals) vitals.innerHTML=[
    vital(t('pd.stateLabel'), isOnline?t('pd.stateOnline'):t('pd.stateOffline'), isOnline?'ok':'dim'),
    vital(t('pd.gamemode'), gm, gmClass),
    meter(t('pd.health'), d.health, 'hp'),
    meter(t('pd.food'), d.food, 'food'),
  ].join('');
  // Dimension -> tint key. Only the three vanilla worlds have an in-game colour; a mod dimension
  // falls back to the neutral tone so it does not claim to be the Overworld.
  const dim=String(d.dimension||'');
  const dimKey = dim.includes('nether') ? 'nether' : (dim.includes('the_end') || /(^|:)end$/.test(dim)) ? 'end' : dim.includes('overworld') ? 'overworld' : 'other';
  const support=$('#pdSupport');
  if(support) support.innerHTML=[
    `<span>${esc(t('pd.dimension'))} <span class="pd-dim-chip pd-dim-${dimKey}">${esc(dim||t('ply.unknownDim'))}</span></span>`,
    `<span>${esc(t('pd.saturation'))} <b>${esc(String(d.saturation??'—'))}</b></span>`,
    `<span>${esc(t('pd.xp'))} <b>${esc(String(d.xpLevel??0))}</b></span>`,
    `<span>${esc(t('pd.totalXp'))} <b>${esc(String(d.xpTotal??0))}</b></span>`,
  ].join('');
  // Tint the 3D backdrop by dimension so the model sits in its world.
  const cont=$('#pd3dContainer'); if(cont) cont.dataset.dim=dimKey;
  // The disclosure keeps every value the old readout had, so nothing is lost (DESIGN.md 2.4).
  const el=$('#pdReadout');if(!el)return;
  const rows=[
    [t('pd.stateLabel'),isOnline?t('pd.stateOnline'):t('pd.stateOffline'),isOnline?'ok':'dim'],
    [t('pd.dimension'),d.dimension||t('ply.unknownDim'),'dim'],
    [t('pd.health'),d.health??'—',''],
    [t('pd.food'),d.food??'—',''],
    [t('pd.saturation'),d.saturation??'—',''],
    [t('pd.xp'),d.xpLevel??0,''],
    [t('pd.totalXp'),d.xpTotal??0,''],
    [t('pd.gamemode'),gm,''],
  ];
  el.innerHTML=rows.map(([k,v,c])=>vital(k,v,c)).join('');
}
// v4.0.0: header badges (OP / WL / banned) from the roster model, so the inspector shows role at a glance.
function renderPdBadges(name){
  const el=$('#inspectBadges');if(!el)return;
  const all=buildPlayerRows();
  const p=all.find(x=>String(x.name).toLowerCase()===String(name).toLowerCase())||{};
  el.innerHTML=badgeHtml(p);
}
// v4.0.0: active effects (from NBT). Empty when the player has none.
function renderPdEffects(effects){
  const sec=$('#pdEffectsSec'),list=$('#pdEffectsList');if(!list)return;
  const arr=effects||[];
  if(!arr.length){if(sec)sec.hidden=true;return}
  if(sec)sec.hidden=false;
  const cnt=$('#pdEffectsCount');if(cnt)cnt.textContent=`${arr.length} active`;
  list.innerHTML=arr.map((e,i)=>`<div class="inv-row" style="animation-delay:${i*18}ms"><span class="slot">${esc((e.name||'?').replace(/^minecraft:/,''))}</span><span class="item-name">${esc(e.name||'')}</span><span class="count">${e.amplifier!==undefined?`Lv ${(e.amplifier||0)+1}`:''}${e.duration?` · ${Math.round(e.duration/20)}s`:''}</span></div>`).join('');
}
// v4.0.0: Stats tab — pulled from the world save stats (see backend). Hidden-friendly when missing.
// v4.0.0: Stats tab. The saved stats JSON is {stats:{ 'minecraft:custom':{ 'minecraft:deaths':N, ... }}}.
// We surface the 'custom' category (the human-interest numbers) as labelled rows; unknown keys get a
// cleaned-up label. Playtime/deaths/kills/walk are highlighted first.
const STAT_ORDER=['minecraft:play_time','minecraft:walk_one_cm','minecraft:deaths','minecraft:mob_kills','minecraft:player_kills','minecraft:jump','minecraft:damage_dealt','minecraft:blocks_mined'];
function statLabel(k){return String(k).replace(/^minecraft:/,'').replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase())}
function fmtStat(k,v){
  if(k==='minecraft:play_time'||k==='minecraft:play_one_minute') return `${Math.round((v/20)/60)} min`;
  if(k==='minecraft:walk_one_cm'||k.endsWith('_one_cm')) return `${(v/100).toFixed(0)} m`;
  return String(v);
}
function renderPdStats(stats){
  const g=$('#pdStatsGrid');if(!g)return;
  const custom=(stats&&stats.stats&&stats.stats['minecraft:custom'])||null;
  if(!custom||!Object.keys(custom).length){g.innerHTML=`<div class="inv-empty"><b>${esc(t('pd.noStats'))}</b><span>${esc(t('pd.noStatsSub'))}</span></div>`;return}
  const keys=Object.keys(custom);
  const ordered=[...STAT_ORDER.filter(k=>k in custom),...keys.filter(k=>!STAT_ORDER.includes(k))].slice(0,24);
  g.innerHTML=ordered.map((k,i)=>`<div class="pd-stat" style="animation-delay:${i*20}ms"><span>${esc(statLabel(k))}</span><b>${esc(fmtStat(k,custom[k]))}</b></div>`).join('');
}
async function pdLiveAction(action){
  const name=selectedPlayer?.name;if(!name)return;
  if(!state.running)return toast(t('pd.needServer'),'error');
  const send=cmd=>{try{command(cmd)}catch(e){toast(e?.message||String(e),'error')}};
  if(action==='gamemode'){send(`gamemode ${$('#liveGameType').value} ${name}`)}
  else if(action==='xp'){const n=Number($('#liveXp').value);if(!Number.isFinite(n)||n<0)return toast(t('pd.badNumber'),'error');send(`xp set ${name} ${Math.floor(n)}`)}
  else if(action==='give'){const id=String($('#liveGiveId').value||'').trim();if(!/^[a-z0-9_:.]+$/i.test(id))return toast(t('pd.badItem'),'error');const c=Math.max(1,Math.min(6400,Math.floor(Number($('#liveGiveCount').value)||1)));send(`give ${name} ${id} ${c}`)}
  else if(action==='heal'){send(`effect give ${name} minecraft:instant_health 1 10 true`)}
  else if(action==='feed'){send(`effect give ${name} minecraft:saturation 1 10 true`)}
  else if(action==='clear'){if(await confirmDialog({title:t('pd.clearInvBtn'),body:t('pd.confirmClear',{n:name}),ok:t('pd.clearInvBtn'),danger:true}))send(`clear ${name}`)}
  else if(action==='kick'){if(await confirmDialog({title:t('ply.kick'),body:t('ply.confirmKick',{n:name}),ok:t('ply.kick'),danger:true}))send(`kick ${name}`)}
  else if(action==='tp'){const parts=String($('#liveTp').value||'').trim().split(/\s+/).map(Number);if(parts.length<3||parts.some(n=>!Number.isFinite(n)))return toast(t('pd.badCoords'),'error');send(`tp ${name} ${parts[0]} ${parts[1]} ${parts[2]}`)}
}
$$('.inspect-tab').forEach(b=>b.onclick=()=>pdSetTab(b.dataset.pdTab));
$('#pdPanelLive')?.addEventListener('click',e=>{const b=e.target.closest('[data-live-cmd]');if(b&&!b.disabled)pdLiveAction(b.dataset.liveCmd)});

// Build (or rebuild) the 3D model in the inspector. Extracted from openPlayerInspector so the
// icons:update handler can call it again: tex:// serves a 1x1 placeholder on a cache miss, and
// that <img> has already fired onload by the time the real armor texture is fetched, so without
// a rebuild the armor would stay invisible for the rest of the session.
async function renderPlayer3D(canvas,status,uuid,name,armor){
  if(!canvas||!status)return;
  status.hidden=false;
  status.textContent=t('pd.loadingSkin');
  canvas.style.opacity='0';
  let skinRes;
  try{ skinRes=await window.observer.playerSkin(uuid||name); }catch{ skinRes=null; }
  if(skinRes&&skinRes.ok&&skinRes.dataUri){
    status.hidden=true;
    canvas.style.opacity='1';
    // Only pass equipment if there is actually armor to render. Passing an empty
    // object causes the renderer to try loading texture files for 'undefined' materials.
    let equipment=null;
    if(armor&&armor.length>0){
      equipment={
        helmet:armor.find(x=>x.slot==='Helmet'),
        chest:armor.find(x=>x.slot==='Chestplate'),
        legs:armor.find(x=>x.slot==='Leggings'),
        boots:armor.find(x=>x.slot==='Boots'),
      };
    }
    try{
      const rModel=createPlayerRenderer(canvas,skinRes.dataUri,skinRes.model==='slim',equipment);
      if(!rModel)throw new Error('WebGL not supported');
      return skinRes.dataUri;
    }catch(e){ status.hidden=false; status.textContent=t('pd.renderFail'); }
  }else{
    status.innerHTML=`<div style="padding:20px;text-align:center;color:var(--text-muted)"><b>${esc(t('pd.no3dTitle'))}</b><br><span style="font-size:11px;opacity:0.8">${esc(t('pd.no3dSub'))}</span></div>`;
  }
  return null;
}
async function openPlayerInspector(uuid,name){
  selectedPlayer={uuid:uuid||null,name};
  openPlayerInspectModal();
  pdSetTab('overview');

  const isOnline=pdIsOnline(name,uuid);
  const stEl=$('#inspectState');
  if(stEl){stEl.textContent=isOnline?t('pd.stateOnline'):t('pd.stateOffline');stEl.className='inspect-badge '+(isOnline?'online':'offline')}
  // Live tab needs a running server; offline edit needs it stopped. Gate both clearly.
  $$('#pdPanelLive [data-live-cmd]').forEach(b=>b.disabled=!state.running);
  const saveBtn=$('#savePlayerData');
  const offHint=$('#pdOfflineHint');
  if(saveBtn){saveBtn.disabled=state.running;if(state.running)saveBtn.setAttribute('data-tip',t('ply.stopBeforeEdit'));else saveBtn.removeAttribute('data-tip')}
  if(offHint)offHint.textContent=state.running?t('pd.stopToEdit'):'';
  $('#playerDataForm').hidden=true;$('#playerDataEmpty').hidden=false;$('#playerDataError').textContent=t('ply.loadingData');
  let r;
  try{r=await window.observer.playerRead(uuid, name)}catch(e){$('#playerDataError').textContent=t('ply.readError',{m:e?.message||e});return}
  if(!r||!r.ok){
    if(!uuid){ const uuidEl=$('#inspectUuid'); if(uuidEl){ uuidEl.textContent=t('ply.uuidUnknown'); uuidEl.hidden=false; uuidEl.setAttribute('data-tip', t('ply.uuidNone')); uuidEl.onclick=null; } $('#playerDataError').textContent=t('ply.noUuidLong',{n:name}); }
    else { $('#playerDataError').textContent=r?.error||t('ply.unknownReadError'); }
    return;
  }
  if(!r||!r.ok){$('#playerDataError').textContent=r?.error||t('ply.unknownReadError');return}
  const d=r.data;
  if(!d){$('#playerDataError').textContent=t('ply.corrupt');return}

  // v6.0.0 Track B: Render 3D Player
  let _skinDataUri = null;
  _skinDataUri=await renderPlayer3D($('#pd3dCanvas'),$('#pd3dStatus'),uuid,name,d.armor);

  invSearchQuery='';ecSearchQuery='';invShowEmpty=true;ecShowEmpty=true;invSortBy='slot';ecSortBy='slot';
  const invS=$('#invSearch');if(invS)invS.value='';const ecS=$('#ecSearch');if(ecS)ecS.value='';
  const invCb=$('#invShowEmpty');if(invCb)invCb.checked=true;const ecCb=$('#ecShowEmpty');if(ecCb)ecCb.checked=true;
  const invSel=$('#invSort');if(invSel)invSel.value='slot';const ecSel=$('#ecSort');if(ecSel)ecSel.value='slot';
  $('#playerDataEmpty').hidden=true;$('#playerDataForm').hidden=false;
  // BUGFIX: the header avatar used an external mc-heads.net URL, which shows a broken image when
  // offline or when that request is slow. Reuse the 8x8 face we already cached for the roster, then
  // the full skin data URI, then the local placeholder, so the header never shows a broken image.
  $('#inspectAvatar').src = headAvatarCache[uuid] || _skinDataUri || playerInitialsAvatar(name);
  $('#inspectName').textContent=name;$('#inspectDim').textContent=d.dimension||t('ply.unknownDim');
  renderPdBadges(name);
  const posEl=$('#inspectPos');
  if(posEl){const p=d.pos||[];if(p.length>=3){posEl.hidden=false;posEl.textContent=`X ${Math.round(p[0])}  Y ${Math.round(p[1])}  Z ${Math.round(p[2])}`}else{posEl.hidden=true}}
  renderPdReadout(d,isOnline);
  const uuidEl=$('#inspectUuid'); if(uuidEl){ uuidEl.hidden=false; uuidEl.textContent=t('ply.uuidLabel',{v:uuid}); uuidEl.setAttribute('data-tip', `${uuid} — ${t('ply.copyUuidHint')}`); uuidEl.onclick=async()=>{ try{ await navigator.clipboard.writeText(uuid); uuidEl.classList.add('copied'); const prev=uuidEl.textContent; uuidEl.textContent=t('toast.uuidCopied'); toast(t('toast.uuidCopied'),'success'); setTimeout(()=>{ uuidEl.textContent=t('ply.uuidLabel',{v:uuid}); uuidEl.classList.remove('copied'); }, 1200); }catch{ toast(uuid)} }; }
  $('#pdHealth').value=d.health??'';$('#pdFood').value=d.food??'';$('#pdSaturation').value=d.saturation??'';$('#pdXpLevel').value=d.xpLevel??0;$('#pdXpTotal').value=d.xpTotal??0;$('#pdGameType').value=d.gameType??0;$('#pdClearInventory').checked=false;
  lastInspectData={armor:d.armor,offhand:d.offhand,inventory:d.inventory,enderChest:d.enderChest};
  renderEquipment(d.armor,d.offhand);
  renderItemGrid('#hotbarList',d.inventory);renderItemGrid('#inventoryList',d.inventory);renderItemGrid('#enderChestList',d.enderChest);
  renderPdEffects(d.effects);
  renderPdStats(d.stats);
}
// v6.0.0 Track B - B2: Leaderboard toggle
// BUGFIX: the toggle added `primary` on top of `secondary`. Both rules have the same specificity
// and `secondary` comes later in the cascade, so `background:transparent` won while `color` came
// from `primary` (--brand-ink, near black) -> dark text on a dark button, invisible. The active
// state is its own class now (`is-active`) with a single, unambiguous style.
let showLeaderboard = false;
$('#toggleLeaderboardBtn')?.addEventListener('click', () => {
  showLeaderboard = !showLeaderboard;
  $('#toggleLeaderboardBtn').classList.toggle('is-active', showLeaderboard);
  $('#toggleLeaderboardBtn').setAttribute('aria-pressed', showLeaderboard ? 'true' : 'false');
  $('#playersList').hidden = showLeaderboard;
  $('#playersPager').hidden = showLeaderboard || $('#playersPager').hidden;
  $('#playersLeaderboard').hidden = !showLeaderboard;
  // The filter row belongs to the roster; hide it too while the leaderboard is showing.
  const toolbar = document.querySelector('.roster-toolbar'); if (toolbar) toolbar.hidden = showLeaderboard;
  if (showLeaderboard) renderLeaderboard();
  else renderPlayers();
});

async function renderLeaderboard() {
  const tbody = $('#leaderboardBody');
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="6" class="text-muted" style="text-align:center;padding:20px">${esc(t('pd.loadingStats'))}</td></tr>`;
  const r = await window.observer.playerAnalytics();
  if (!r || !r.ok) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-muted" style="text-align:center;padding:20px;color:var(--danger)">${esc(r?.error || 'Failed to load leaderboard')}</td></tr>`;
    return;
  }
  if (!r.rows || !r.rows.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-muted" style="text-align:center;padding:20px">${esc(t('pd.noStats'))}</td></tr>`;
    return;
  }
  tbody.innerHTML = r.rows.map((p, i) => {
    const h = Math.floor(p.playTimeSec / 3600);
    const m = Math.floor((p.playTimeSec % 3600) / 60);
    const time = h > 0 ? `${h}h ${m}m` : `${m}m`;
    return `<tr>
      <td>${i + 1}</td>
      <td>${esc(p.name)}</td>
      <td>${time}</td>
      <td>${p.deaths}</td>
      <td>${p.mobKills}</td>
      <td>${p.blocksMined}</td>
    </tr>`;
  }).join('');
}

$('#playersList').addEventListener('click',async e=>{
  const btn=e.target.closest('[data-row-action]');if(!btn||btn.disabled)return;
  const action=btn.dataset.rowAction,name=btn.dataset.player,uuid=btn.dataset.uuid||null,p={uuid,name};
  // UX (2.6.0): disable the row button for the duration of the async action so a double-click
  // cannot fire op/whitelist/ban/kick twice against the server files or the console.
  if(action==='op')return withBusy(btn,()=>togglePlayerOp(p,btn.dataset.value==='on'));
  if(action==='whitelist')return withBusy(btn,()=>togglePlayerWhitelist(p,btn.dataset.value==='on'));
  if(action==='ban')return withBusy(btn,async()=>{if(btn.dataset.value==='on'&&!await confirmDialog({title:t('ply.ban'),body:t('ply.confirmBan',{n:name}),ok:t('ply.ban'),danger:true}))return;return togglePlayerBan(p,btn.dataset.value==='on')});
  if(action==='kick')return withBusy(btn,async()=>{const bad=playerNameError(name);if(bad)return toast(bad);if(await confirmDialog({title:t('ply.kick'),body:t('ply.confirmKick',{n:name}),ok:t('ply.kick'),danger:true}))command(`kick ${name}`)});
  if(action==='inspect')openPlayerInspector(uuid,name);
});
$('#invSearch')?.addEventListener('input',e=>{invSearchQuery=e.target.value;renderItemGrid('#inventoryList',lastInspectData?.inventory||[])});
// v4.0.0: the hotbar shares invShowEmpty + invSort, so a change re-renders both grids.
const rerenderInv=()=>{renderItemGrid('#hotbarList',lastInspectData?.inventory||[]);renderItemGrid('#inventoryList',lastInspectData?.inventory||[])};
$('#invShowEmpty')?.addEventListener('change',e=>{invShowEmpty=e.target.checked;rerenderInv()});
$('#invSort')?.addEventListener('change',e=>{invSortBy=e.target.value;rerenderInv()});$('#ecSearch')?.addEventListener('input',e=>{ecSearchQuery=e.target.value;renderItemGrid('#enderChestList',lastInspectData?.enderChest||[])});$('#ecShowEmpty')?.addEventListener('change',e=>{ecShowEmpty=e.target.checked;renderItemGrid('#enderChestList',lastInspectData?.enderChest||[])});$('#ecSort')?.addEventListener('change',e=>{ecSortBy=e.target.value;renderItemGrid('#enderChestList',lastInspectData?.enderChest||[])});$('#playerInspectClose').onclick=closePlayerInspectModal;
$$('[data-player-filter]').forEach(b=>b.onclick=()=>{
  playerFilter=b.dataset.playerFilter;playerPage=0;
  $$('[data-player-filter]').forEach(x=>{ const on=x===b; x.classList.toggle('active',on); x.setAttribute('aria-pressed', on?'true':'false'); });
  renderPlayers();
});
// UX (2.6.0) a11y: arrow keys move focus between roster rows (like the rail nav). Enter/Space on a
// focused row is left to the inner action buttons; the row itself is a focus target only.
$('#playersList')?.addEventListener('keydown',e=>{
  if(e.key!=='ArrowDown'&&e.key!=='ArrowUp')return;
  const rows=[...$$('#playersList .player-row')]; if(!rows.length)return;
  const cur=rows.indexOf(document.activeElement); if(cur<0)return;
  e.preventDefault();
  const next=e.key==='ArrowDown'?Math.min(rows.length-1,cur+1):Math.max(0,cur-1);
  rows[next].focus();
});
$('#playersPrevPage').onclick=()=>{if(playerPage>0){playerPage--;renderPlayers();$('#playersList')?.scrollIntoView({block:'start'})}};
$('#playersNextPage').onclick=()=>{playerPage++;renderPlayers();$('#playersList')?.scrollIntoView({block:'start'})};
// BUGFIX: this file loads BEFORE 08-shell.js (where debounce() is defined), so calling
// debounce() here at load time threw ReferenceError and the search box never got a
// listener. Use an inline debounce so this file is self-contained.
let playerSearchTimer=null;
$('#playerSearch')?.addEventListener('input', e=>{ clearTimeout(playerSearchTimer); playerSearchTimer=setTimeout(()=>{ playerSearchQuery=e.target.value; playerPage=0; renderPlayers(); }, 200); });
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
// icons:update — a placeholder icon just got its real pixels; re-render the open player
// inspector grid. Lives with the inspector that owns lastInspectData (was misplaced in 02-worldmap.js).
window.observer.onIconsUpdate(()=>{
  if($('#playerInspectModal').hidden||!lastInspectData)return;
  renderEquipment(lastInspectData.armor,lastInspectData.offhand);
  renderItemGrid('#inventoryList',lastInspectData.inventory);
  renderItemGrid('#enderChestList',lastInspectData.enderChest);
  renderItemGrid('#hotbarList',lastInspectData.inventory);
  // Worn-armor textures are fetched through the same protocol, and the first request may well
  // have been served the 1x1 placeholder. Rebuild the model so the armor actually appears.
  if(selectedPlayer&&selectedPlayer.uuid&&lastInspectData.armor?.length){
    renderPlayer3D($('#pd3dCanvas'),$('#pd3dStatus'),selectedPlayer.uuid,selectedPlayer.name,lastInspectData.armor);
  }
});
