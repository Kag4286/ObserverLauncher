// js/03-players.js — split from app.js (lines 539-703); classic script, load in numeric order.
// Players tab: roster, badges, inspector, OP/whitelist/ban.
// TEXT-ONLY item display — no textures, just readable labels. Keeps the same IDs so save logic is untouched.
function itemLabel(id){
  const raw=String(id||'');
  if(!raw)return t('ply.unknownItem');
  const isVanilla=!raw.includes(':')||raw.startsWith('minecraft:');
  if(!isVanilla){
    const i=raw.indexOf(':');
    const ns=raw.slice(0,i);
    const nm=raw.slice(i+1);
    return (ns+' '+nm).replace(/[_.]/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
  }
  return raw.replace(/^minecraft:/,'').replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase())||t('ply.unknownItem');
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
  for(const e of x.enchantments||[])lines.push(`✨ ${itemLabel(e.id)} ${romanNum(e.level)}`);
  for(const e of x.storedEnchantments||[])lines.push(`✨ ${itemLabel(e.id)} ${romanNum(e.level)}`);
  if(x.durability)lines.push(`Durability: ${x.durability.remaining} / ${x.durability.max}`);
  lines.push(`×${x.count} · ${x.id}`);
  return esc(lines.join('\n'));
}
function itemTooltipHtml(x,label){
  const parts=[];
  parts.push(`<div class="tip-title">${esc(label)}</div>`);
  if(x.customName&&x.customName!==label)parts.push(`<div class="tip-sub">${esc(itemLabel(x.id))}</div>`);
  const enchs=[...(x.enchantments||[]),...(x.storedEnchantments||[])];
  if(enchs.length){
    parts.push(enchs.map(e=>`<div class="tip-ench">✨ ${esc(itemLabel(e.id))} ${romanNum(e.level)}</div>`).join(''));
  }
  if(x.durability){
    const pct=Math.round(x.durability.remaining/x.durability.max*100);
    const col=durColor(x.durability);
    parts.push(`<div class="tip-dur" style="color:${col}">Durability: ${x.durability.remaining} / ${x.durability.max} (${pct}%)</div>`);
  }
  parts.push(`<div class="tip-meta"><span>×${x.count}</span><span>${esc(x.id)}</span></div>`);
  return esc(parts.join(''));
}
// ONE place decides which tex:// URL an item id maps to. The inventory grid used to carry this
// logic inline while the equipment row did not, so a mod item worn as armor fell through to the
// initials badge even though the mod jar had the texture. Both call this now.
let iconEpoch = 0;
function itemIconUrl(id){
  const s=String(id||'');
  if(!s) return null;
  const q=iconEpoch?`?e=${iconEpoch}`:'';
  const vanilla=!s.includes(':')||s.startsWith('minecraft:');
  if(vanilla){
    const idNoPrefix=s.replace(/^minecraft:/,'').replace(/[^a-z0-9_]/g, '');
    return `tex://auto/item/${idNoPrefix}.png${q}`;
  }
  // tex:// path segments cannot hold a slash, so pack `<namespace>~<name>` and split it in main.
  // The tilde is not valid in a resource location, so it can never collide with an underscore
  // that lives inside either the namespace or the item name (cofh_core_wrench).
  const [ns, ...rest]=s.split(':');
  const nm=rest.join(':').replace(/\.png$/,'');
  return (ns&&nm)?`tex://auto/itemmod/${encodeURIComponent(ns)}~${encodeURIComponent(nm)}.png${q}`:null;
}
function getInitials(label){
  const words=String(label||'').trim().split(/\s+/).filter(Boolean);
  if(words.length>=2) return (words[0][0]+words[1][0]).toUpperCase();
  return (String(label||'').replace(/[^A-Za-z0-9]/g,'').slice(0,2)||'?').toUpperCase();
}
// tex:// answers a cache miss with a 1x1 transparent PNG and HTTP 200, so onerror never fires.
// Detect that placeholder in onload and swap in the readable label instead of a blank cell.
function itemCellInner(iconUrl,label){
  const initials=getInitials(label);
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
function showInvItemDetail(x){
  const d=$('#invItemDetail');if(!d)return;
  const label=x.customName||itemLabel(x.id);
  const iconUrl=itemIconUrl(x.id);
  const enchs=[...(x.enchantments||[]),...(x.storedEnchantments||[])];
  const enchHtml=enchs.length?`<div class="inv-item-detail-enchs">${enchs.map(e=>`<span class="pd-ench-pill">✨ ${esc(itemLabel(e.id))} ${romanNum(e.level)}</span>`).join('')}</div>`:'';
  const durHtml=x.durability?`<div class="inv-item-detail-meta"><span style="color:${durColor(x.durability)}">Durability: ${x.durability.remaining} / ${x.durability.max} (${Math.round(x.durability.remaining/x.durability.max*100)}%)</span></div>`:'';
  d.hidden=false;
  d.innerHTML=`<div class="inv-item-detail-icon">${itemCellInner(iconUrl,label)}</div><div class="inv-item-detail-info"><div class="inv-item-detail-title"><b>${esc(label)}</b> ${x.count>1?`<span class="inv-count-tag">×${x.count}</span>`:''}</div>${x.customName&&x.customName!==label?`<div class="tip-sub">${esc(itemLabel(x.id))}</div>`:''}${enchHtml}${durHtml}<div class="inv-item-detail-meta"><span>Slot ${x.slot}</span><span>${esc(x.id)}</span></div></div><button type="button" class="btn sm secondary" onclick="$('#invItemDetail').hidden=true">✕</button>`;
}
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
    const iconUrl=itemIconUrl(x.id);
    const tip=itemTooltip(x,label);
    const tipHtml=itemTooltipHtml(x,label);
    const ench=x.enchantments?.length||x.storedEnchantments?.length?' enchanted':'';
    const dur=x.durability?`<span class="inv-dur" style="width:${Math.max(2,Math.round(x.durability.remaining/x.durability.max*100))}%;background:${durColor(x.durability)}"></span>`:'';
    return `<div class="inv-cell${ench}" data-tip="${tip}" data-tip-html="${tipHtml}" data-slot="${x.slot}" tabindex="0">${itemCellInner(iconUrl,label)}${dur}<span class="inv-count">${x.count>1?x.count:''}</span></div>`;
  }).join('');
}
function renderEquipment(armor,offhand){
  const n=$('#equipmentGrid');if(!n)return;
  const slots=[...(armor||[]),...(offhand?[{slot:'Offhand',...offhand}]:[])];
  const order=['Helmet','Chestplate','Leggings','Boots','Offhand'];
  n.innerHTML=order.map(label=>{
    const it=slots.find(x=>x.slot===label);
    let cell='';
    const isEnch=it&&(it.enchantments?.length||it.storedEnchantments?.length);
    const enchCls=isEnch?' enchanted':'';
    let dur='';
    let enchList='';
    if(it&&it.id){
      cell=itemCellInner(itemIconUrl(it.id),itemLabel(it.id));
      if(it.durability){
        dur=`<span class="inv-dur" style="width:${Math.max(2,Math.round(it.durability.remaining/it.durability.max*100))}%;background:${durColor(it.durability)}"></span>`;
      }
      const enchs=[...(it.enchantments||[]),...(it.storedEnchantments||[])];
      if(enchs.length){
        const show=enchs.slice(0,2);
        const rem=enchs.length-show.length;
        const allTip=esc(enchs.map(e=>`${itemLabel(e.id)} ${romanNum(e.level)}`).join(', '));
        enchList=`<div class="pd-equip-ench-list">${show.map(e=>`<span class="pd-ench-pill" title="${esc(itemLabel(e.id))} ${romanNum(e.level)}">${esc(itemLabel(e.id))} ${romanNum(e.level)}</span>`).join('')}${rem>0?`<span class="pd-ench-pill" title="${allTip}">+${rem} more</span>`:''}</div>`;
      }
    }
    const tipHtml=it&&it.id?itemTooltipHtml(it,itemLabel(it.id)):'';
    const tip=it&&it.id?itemTooltip(it,itemLabel(it.id)):t('ply.emptySlot');
    return `<div class="pd-equip">
      <div class="inv-cell${it&&it.id?'':' empty'}${enchCls}" data-tip="${tip}" ${tipHtml?`data-tip-html="${tipHtml}"`:''} tabindex="0">${cell}${dur}</div>
      <span class="pd-equip-slot">${esc(label)}</span>
      ${it&&it.id?`<span class="pd-equip-name" title="${esc(it.customName||itemLabel(it.id))}">${esc(it.customName||itemLabel(it.id))}</span>`:''}
      ${enchList}
    </div>`;
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
function cropPlayerHead(dataUri, onHeadReady){
  if(!dataUri) return;
  const img = new Image();
  img.onload = () => {
    const s = (img.naturalWidth || img.width || 64) / 64;
    const canvas = document.createElement('canvas');
    canvas.width = 64; canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 8 * s, 8 * s, 8 * s, 8 * s, 0, 0, 64, 64);
    ctx.drawImage(img, 40 * s, 8 * s, 8 * s, 8 * s, 0, 0, 64, 64);
    onHeadReady(canvas.toDataURL('image/png'));
  };
  img.src = dataUri;
}
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
        cropPlayerHead(res.dataUri, headUri => {
          headAvatarCache[uuid] = headUri;
          if (selectedPlayer && (selectedPlayer.uuid === uuid || selectedPlayer.name === uuid)) {
            const el = $('#inspectAvatar'); if (el) el.src = headUri;
          }
          try { renderPlayers(); } catch {}
        });
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
// v6.1.7: Stats tab rework — friendly labels, ticks/distance/damage formatters, category filtering & Hero KPIs.
const STAT_FRIENDLY_NAMES = {
  'minecraft:play_time': 'Total Playtime',
  'minecraft:play_one_minute': 'Total Playtime',
  'minecraft:total_world_time': 'Total World Time',
  'minecraft:deaths': 'Deaths',
  'minecraft:time_since_death': 'Time Since Death',
  'minecraft:time_since_rest': 'Time Since Rest',
  'minecraft:sleep_in_bed': 'Slept in Bed',
  'minecraft:leave_game': 'Sessions Left',
  'minecraft:eat_cake_slice': 'Cake Slices Eaten',
  'minecraft:mob_kills': 'Mob Kills',
  'minecraft:player_kills': 'Player Kills',
  'minecraft:damage_dealt': 'Damage Dealt',
  'minecraft:damage_taken': 'Damage Taken',
  'minecraft:damage_blocked_by_shield': 'Damage Blocked (Shield)',
  'minecraft:damage_resisted': 'Damage Resisted',
  'minecraft:damage_absorbed': 'Damage Absorbed',
  'minecraft:damage_dealt_absorbed': 'Damage Dealt (Absorbed)',
  'minecraft:damage_dealt_resisted': 'Damage Dealt (Resisted)',
  'minecraft:raid_trigger': 'Raids Triggered',
  'minecraft:raid_win': 'Raids Won',
  'minecraft:target_hit': 'Targets Hit',
  'minecraft:walk_one_cm': 'Walking Distance',
  'minecraft:sprint_one_cm': 'Sprinting Distance',
  'minecraft:fly_one_cm': 'Flying Distance',
  'minecraft:climb_one_cm': 'Climbing Distance',
  'minecraft:crouch_one_cm': 'Crouching Distance',
  'minecraft:swim_one_cm': 'Swimming Distance',
  'minecraft:fall_one_cm': 'Fall Distance',
  'minecraft:jump': 'Jumps',
  'minecraft:sneak_time': 'Sneak Time',
  'minecraft:boat_one_cm': 'Boat Distance',
  'minecraft:horse_one_cm': 'Horse Distance',
  'minecraft:aviate_one_cm': 'Elytra Distance',
  'minecraft:pig_one_cm': 'Pig Distance',
  'minecraft:strider_one_cm': 'Strider Distance',
  'minecraft:minecart_one_cm': 'Minecart Distance',
  'minecraft:walk_on_water_one_cm': 'Water Walk Distance',
  'minecraft:walk_under_water_one_cm': 'Underwater Walk',
  'minecraft:open_chest': 'Chests Opened',
  'minecraft:open_enderchest': 'Ender Chests Opened',
  'minecraft:open_shulker_box': 'Shulker Boxes Opened',
  'minecraft:open_barrel': 'Barrels Opened',
  'minecraft:interact_with_crafting_table': 'Crafting Table Used',
  'minecraft:interact_with_furnace': 'Furnace Used',
  'minecraft:interact_with_blast_furnace': 'Blast Furnace Used',
  'minecraft:interact_with_smoker': 'Smoker Used',
  'minecraft:interact_with_anvil': 'Anvil Used',
  'minecraft:interact_with_grindstone': 'Grindstone Used',
  'minecraft:interact_with_smithing_table': 'Smithing Table Used',
  'minecraft:interact_with_loom': 'Loom Used',
  'minecraft:interact_with_stonecutter': 'Stonecutter Used',
  'minecraft:interact_with_brewingstand': 'Brewing Stand Used',
  'minecraft:interact_with_beacon': 'Beacon Used',
  'minecraft:interact_with_lectern': 'Lectern Used',
  'minecraft:interact_with_campfire': 'Campfire Used',
  'minecraft:talked_to_villager': 'Talked to Villagers',
  'minecraft:traded_with_villager': 'Traded with Villagers',
  'minecraft:drop': 'Items Dropped',
  'minecraft:bell_ring': 'Bells Rung',
  'minecraft:inspect_dispenser': 'Dispensers Inspected',
  'minecraft:inspect_dropper': 'Droppers Inspected',
  'minecraft:inspect_hopper': 'Hoppers Inspected',
  'minecraft:play_record': 'Music Discs Played',
  'minecraft:play_noteblock': 'Note Blocks Played',
  'minecraft:tune_noteblock': 'Note Blocks Tuned',
  'minecraft:pot_flower': 'Plants Potted',
  'minecraft:trigger_trapped_chest': 'Trapped Chests Triggered',
  'minecraft:clean_armor': 'Armor Washed',
  'minecraft:clean_banner': 'Banners Washed',
  'minecraft:clean_shulker_box': 'Shulker Boxes Washed',
  'minecraft:waystone_activated': 'Waystones Activated'
};

const STAT_ORDER = [
  'minecraft:play_time', 'minecraft:play_one_minute',
  'minecraft:deaths', 'minecraft:mob_kills', 'minecraft:player_kills',
  'minecraft:damage_dealt', 'minecraft:damage_taken', 'minecraft:damage_blocked_by_shield',
  'minecraft:walk_one_cm', 'minecraft:sprint_one_cm', 'minecraft:fly_one_cm', 'minecraft:jump',
  'minecraft:open_chest', 'minecraft:blocks_mined'
];

let currentPdStats = null;
let pdStatsCat = 'all';
let pdStatsSearchQuery = '';

function friendlyStatName(k) {
  if (STAT_FRIENDLY_NAMES[k]) return STAT_FRIENDLY_NAMES[k];
  return String(k).replace(/^[a-z0-9_-]+:/i, '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
function statLabel(k) { return friendlyStatName(k); }

function getStatCategory(k) {
  const raw = String(k).replace(/^[a-z0-9_-]+:/i, '');
  if (/^(play_time|play_one_minute|total_world_time|deaths|time_since_death|time_since_rest|sleep_in_bed|leave_game|eat_cake_slice)$/.test(raw)) {
    return 'survival';
  }
  if (/^(mob_kills|player_kills|damage_|killed_|raid_|target_hit)/.test(raw)) {
    return 'combat';
  }
  if (/(_one_cm|jump|sneak_time|time_since_sneak|walk_|sprint_|fly_|swim_|climb_|fall_|crouch_|boat_|horse_|aviate_)/.test(raw)) {
    return 'movement';
  }
  return 'interaction';
}

function formatTicks(ticks) {
  if (typeof ticks !== 'number' || isNaN(ticks) || ticks < 0) return '0s';
  const totalSec = Math.floor(ticks / 20);
  if (totalSec < 60) return `${totalSec}s`;
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  if (mins < 60) return `${mins}m ${secs}s`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  if (hours < 24) return `${hours}h ${remMins}m`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return `${days}d ${remHours}h`;
}

function formatDistance(cm) {
  const m = (Number(cm) || 0) / 100;
  if (m >= 1000) return `${(m / 1000).toFixed(2)} km`;
  return `${Math.round(m).toLocaleString()} m`;
}

function fmtStat(k, v) {
  const raw = String(k).replace(/^[a-z0-9_-]+:/i, '');
  if (/^(play_time|play_one_minute|total_world_time|time_since_death|time_since_rest|sneak_time|time_since_sneak)$/.test(raw)) {
    return formatTicks(v);
  }
  if (raw.endsWith('_one_cm')) {
    return formatDistance(v);
  }
  if (typeof v === 'number') {
    return v.toLocaleString();
  }
  return String(v);
}

function renderPdHeroKpis(custom) {
  const heroEl = $('#pdStatsHero');
  if (!heroEl) return;
  if (!custom || !Object.keys(custom).length) {
    heroEl.hidden = true;
    return;
  }
  heroEl.hidden = false;

  // 1. Playtime
  const playTicks = custom['minecraft:play_time'] ?? custom['minecraft:play_one_minute'] ?? 0;
  const sessions = custom['minecraft:leave_game'] || 0;
  const ptEl = $('#pdHeroPlaytime'); if (ptEl) ptEl.textContent = formatTicks(playTicks);
  const ptSub = $('#pdHeroPlaytimeSub'); if (ptSub) ptSub.textContent = `${sessions.toLocaleString()} ${sessions === 1 ? 'session' : 'sessions'}`;

  // 2. Combat & K/D
  const mobKills = custom['minecraft:mob_kills'] || 0;
  const playerKills = custom['minecraft:player_kills'] || 0;
  const totalKills = mobKills + playerKills;
  const deaths = custom['minecraft:deaths'] || 0;
  const kd = deaths === 0 ? (totalKills > 0 ? '∞' : '0.0') : (totalKills / deaths).toFixed(1);
  const kdEl = $('#pdHeroKd'); if (kdEl) kdEl.textContent = `K/D ${kd}`;
  const kdSub = $('#pdHeroCombatSub'); if (kdSub) kdSub.textContent = `${totalKills.toLocaleString()} kills · ${deaths.toLocaleString()} deaths`;

  // 3. Travel
  let travelCm = 0;
  for (const [k, v] of Object.entries(custom)) {
    if (k.endsWith('_one_cm') && typeof v === 'number') travelCm += v;
  }
  const walkCm = custom['minecraft:walk_one_cm'] || 0;
  const sprintCm = custom['minecraft:sprint_one_cm'] || 0;
  const trEl = $('#pdHeroTravel'); if (trEl) trEl.textContent = formatDistance(travelCm);
  const trSub = $('#pdHeroTravelSub'); if (trSub) trSub.textContent = `${formatDistance(walkCm)} walk · ${formatDistance(sprintCm)} sprint`;

  // 4. Damage
  const dealt = custom['minecraft:damage_dealt'] || 0;
  const taken = custom['minecraft:damage_taken'] || 0;
  const blocked = custom['minecraft:damage_blocked_by_shield'] || 0;
  const dmgEl = $('#pdHeroDamage'); if (dmgEl) dmgEl.textContent = dealt.toLocaleString();
  const dmgSub = $('#pdHeroDamageSub'); if (dmgSub) dmgSub.textContent = `${taken.toLocaleString()} taken · ${blocked.toLocaleString()} blocked`;
}

function filterAndRenderStatsGrid() {
  const g = $('#pdStatsGrid');
  const toolbar = $('#pdStatsToolbar');
  if (!g) return;

  const custom = (currentPdStats && currentPdStats.stats && currentPdStats.stats['minecraft:custom']) || null;
  if (!custom || !Object.keys(custom).length) {
    if (toolbar) toolbar.hidden = true;
    g.innerHTML = `<div class="inv-empty"><b>${esc(t('pd.noStats'))}</b><span>${esc(t('pd.noStatsSub'))}</span></div>`;
    return;
  }
  if (toolbar) toolbar.hidden = false;

  const allKeys = Object.keys(custom);
  
  // Category counts
  const counts = { all: allKeys.length, survival: 0, combat: 0, movement: 0, interaction: 0 };
  for (const k of allKeys) {
    const cat = getStatCategory(k);
    if (counts[cat] !== undefined) counts[cat]++;
  }
  const cAll = $('#pdCatCountAll'); if (cAll) cAll.textContent = counts.all;
  const cSurv = $('#pdCatCountSurvival'); if (cSurv) cSurv.textContent = counts.survival;
  const cComb = $('#pdCatCountCombat'); if (cComb) cComb.textContent = counts.combat;
  const cMove = $('#pdCatCountMovement'); if (cMove) cMove.textContent = counts.movement;
  const cInt = $('#pdCatCountInteraction'); if (cInt) cInt.textContent = counts.interaction;

  // Filter by category
  let filtered = allKeys;
  if (pdStatsCat !== 'all') {
    filtered = filtered.filter(k => getStatCategory(k) === pdStatsCat);
  }

  // Filter by search query
  if (pdStatsSearchQuery) {
    filtered = filtered.filter(k => {
      const friendly = friendlyStatName(k).toLowerCase();
      const raw = k.toLowerCase();
      return friendly.includes(pdStatsSearchQuery) || raw.includes(pdStatsSearchQuery);
    });
  }

  // Update counter
  const cntEl = $('#pdStatsCount');
  if (cntEl) {
    if (filtered.length === allKeys.length) {
      cntEl.textContent = t('pd.statsShowingCount', { n: allKeys.length });
    } else {
      cntEl.textContent = t('pd.statsShowingFiltered', { m: filtered.length, n: allKeys.length });
    }
  }

  if (!filtered.length) {
    g.innerHTML = `<div class="inv-empty"><b>${esc(t('pd.noStatsMatch'))}</b><span>${esc(t('pd.noStatsMatchSub'))}</span></div>`;
    return;
  }

  // Sort: priority first, then alphabetically
  filtered.sort((a, b) => {
    const ia = STAT_ORDER.indexOf(a);
    const ib = STAT_ORDER.indexOf(b);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return friendlyStatName(a).localeCompare(friendlyStatName(b));
  });

  g.innerHTML = filtered.map((k, i) => {
    const v = custom[k];
    const cat = getStatCategory(k);
    const raw = String(k).replace(/^[a-z0-9_-]+:/i, '');
    const isTime = /^(play_time|play_one_minute|total_world_time|time_since_death|time_since_rest|sneak_time|time_since_sneak)$/.test(raw);
    const isDist = raw.endsWith('_one_cm');
    const isDmg = raw.startsWith('damage_');
    const extra = (isDmg && typeof v === 'number')
      ? `<span class="pd-stat-extra"><svg class="pd-stat-heart" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>${(v / 2).toFixed(1)}</span>`
      : '';
    let tip = '';
    if (isTime && typeof v === 'number') tip = `${v.toLocaleString()} ticks (${(v / 20).toFixed(1)}s)`;
    else if (isDist && typeof v === 'number') tip = `${Math.round(v / 100).toLocaleString()} m (${v.toLocaleString()} cm)`;
    else if (typeof v === 'number') tip = `${k}: ${v.toLocaleString()}`;

    return `<div class="pd-stat cat-${cat}" style="animation-delay:${Math.min(i * 16, 280)}ms"${tip ? ` data-tip="${esc(tip)}"` : ''}>` +
      `<div class="pd-stat-top">` +
        `<span class="pd-stat-label">${esc(friendlyStatName(k))}</span>` +
        `<span class="pd-stat-badge">${esc(cat.toUpperCase())}</span>` +
      `</div>` +
      `<div class="pd-stat-val-row">` +
        `<b class="pd-stat-val">${esc(fmtStat(k, v))}</b>${extra}` +
      `</div>` +
    `</div>`;
  }).join('');
}

function renderPdStats(stats) {
  currentPdStats = stats;
  const custom = (stats && stats.stats && stats.stats['minecraft:custom']) || null;
  renderPdHeroKpis(custom);
  filterAndRenderStatsGrid();
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
$('#pdPanelInventory')?.addEventListener('click',e=>{
  const cell=e.target.closest('.inv-cell');
  if(!cell||cell.classList.contains('empty')||cell.dataset.slot===undefined)return;
  const slotNum=Number(cell.dataset.slot);
  const item=(lastInspectData?.inventory||[]).find(x=>x.slot===slotNum)||
             (lastInspectData?.enderChest||[]).find(x=>x.slot===slotNum);
  if(item)showInvItemDetail(item);
});
$('#pdStatsChips')?.addEventListener('click', e => {
  const chip = e.target.closest('.pd-stat-chip');
  if (!chip || !chip.dataset.cat) return;
  pdStatsCat = chip.dataset.cat;
  $$('.pd-stat-chip').forEach(c => c.classList.toggle('is-active', c === chip));
  filterAndRenderStatsGrid();
});
$('#pdStatsSearch')?.addEventListener('input', e => {
  pdStatsSearchQuery = (e.target.value || '').trim().toLowerCase();
  filterAndRenderStatsGrid();
});

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

  invSearchQuery='';ecSearchQuery='';invShowEmpty=true;ecShowEmpty=true;invSortBy='slot';ecSortBy='slot';
  pdStatsCat='all';pdStatsSearchQuery='';
  const invS=$('#invSearch');if(invS)invS.value='';const ecS=$('#ecSearch');if(ecS)ecS.value='';
  const pdS=$('#pdStatsSearch');if(pdS)pdS.value='';
  $$('.pd-stat-chip').forEach(c=>c.classList.toggle('is-active',c.dataset.cat==='all'));
  const invCb=$('#invShowEmpty');if(invCb)invCb.checked=true;const ecCb=$('#ecShowEmpty');if(ecCb)ecCb.checked=true;
  const invSel=$('#invSort');if(invSel)invSel.value='slot';const ecSel=$('#ecSort');if(ecSel)ecSel.value='slot';
  $('#playerDataEmpty').hidden=true;$('#playerDataForm').hidden=false;
  // BUGFIX: the header avatar used an external mc-heads.net URL, which shows a broken image when
  // offline or when that request is slow. Reuse the 8x8 face we already cached for the roster, then
  // the full skin data URI, then the local placeholder, so the header never shows a broken image.
  $('#inspectAvatar').src = (uuid && headAvatarCache[uuid]) || (name && headAvatarCache[name]) || playerInitialsAvatar(name);
  if ((!uuid || !headAvatarCache[uuid]) && (!name || !headAvatarCache[name])) {
    window.observer.playerSkin(uuid || name).then(res => {
      if (res && res.ok && res.dataUri) {
        cropPlayerHead(res.dataUri, headUri => {
          if (uuid) headAvatarCache[uuid] = headUri;
          if (name) headAvatarCache[name] = headUri;
          const el = $('#inspectAvatar'); if (el) el.src = headUri;
          try { renderPlayers(); } catch {}
        });
      }
    }).catch(() => {});
  }
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

  // v6.0.0 Track B: Render 3D Player non-blockingly so slow skin fetches never stall data inspection
  renderPlayer3D($('#pd3dCanvas'),$('#pd3dStatus'),uuid,name,d.armor).then(uri => {
    if (uri && !headAvatarCache[uuid]) {
      cropPlayerHead(uri, headUri => {
        headAvatarCache[uuid] = headUri;
        const el = $('#inspectAvatar'); if (el) el.src = headUri;
      });
    }
  }).catch(() => {});
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
  iconEpoch++;
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
