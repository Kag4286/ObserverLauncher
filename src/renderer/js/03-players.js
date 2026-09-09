// js/03-players.js — split from app.js (lines 539-703); classic script, load in numeric order.
// Players tab: roster, badges, inspector, OP/whitelist/ban.
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
async function togglePlayerOp(p,on){const bad=playerNameError(p.name);if(bad)return toast(bad);if(!p.uuid&&!state.running)return toast('This player has no known UUID yet — start the server and try again, or have them join once first.');const r=await window.observer.playerOpToggle({uuid:p.uuid,name:p.name,op:on});if(!r.ok)return toast(r.error);state.files=r.files;refreshUI();toast(`${p.name} is ${on?'now an operator':'no longer an operator'}.`)}
async function togglePlayerWhitelist(p,add){const bad=playerNameError(p.name);if(bad)return toast(bad);if(!p.uuid&&!state.running)return toast('This player has no known UUID yet — start the server and try again, or have them join once first.');const r=await window.observer.playerWhitelistToggle({uuid:p.uuid,name:p.name,add});if(!r.ok)return toast(r.error);state.files=r.files;refreshUI();toast(`${p.name} ${add?'added to':'removed from'} the whitelist.`)}
async function togglePlayerBan(p,ban){const bad=playerNameError(p.name);if(bad)return toast(bad);if(!p.uuid&&!state.running)return toast('This player has no known UUID yet — start the server and try again, or have them join once first.');const r=await window.observer.playerBanToggle({uuid:p.uuid,name:p.name,ban});if(!r.ok)return toast(r.error);state.files=r.files;refreshUI();toast(`${p.name} ${ban?'banned':'unbanned'}.`)}
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
  else if(action==='kick'){const bad=playerNameError(name);if(bad)return toast(bad);if(confirm(`Kick ${name}?`))command(`kick ${name}`)}
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
