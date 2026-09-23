// js/03-players.js — split from app.js (lines 539-703); classic script, load in numeric order.
// Players tab: roster, badges, inspector, OP/whitelist/ban.
// TEXT-ONLY item display — no textures, just readable labels. Keeps the same IDs so save logic is untouched.
function itemLabel(id){return String(id||'').replace(/^minecraft:/,'').replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase())||t('ply.unknownItem')}
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
    if(x.empty) return `<div class="inv-row empty" style="animation-delay:${i*18}ms"><span class="slot">#${x.slot}</span><span class="item-name muted">${t('ply.emptySlot')}</span><span class="count"></span></div>`;
    const label=itemLabel(x.id);
    return `<div class="inv-row" style="animation-delay:${i*18}ms" title="${esc(label)} — ${esc(x.id)}"><span class="slot">#${x.slot}</span><span class="item-name">${esc(label)}</span><span class="count">×${x.count}</span></div>`;
  }).join('');
}
function renderEquipment(armor,offhand){
  const n=$('#equipmentGrid');if(!n)return;
  const slots=[...(armor||[]),...(offhand?[{slot:'Offhand',id:offhand.id,count:offhand.count}]:[])];
  const order=['Helmet','Chestplate','Leggings','Boots','Offhand'];
  n.innerHTML=order.map((label,i)=>{
    const it=slots.find(x=>x.slot===label);
    const has=!!it;
    return `<div class="inv-row equip ${has?'':'empty'}" style="animation-delay:${i*22}ms"${has?` title="${esc(it.id)}"`:''}><span class="slot">${esc(label)}</span><span class="item-name ${has?'':'muted'}">${has?esc(itemLabel(it.id)):t('ply.emptySlot')}</span></div>`;
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
  const sig=JSON.stringify([currentLocale,playerPage,playerFilter,q,totalPages,list.length,page.map(p=>[p.name,p.uuid,p.online,p.hasData,p.op,p.whitelisted,p.banned])]);
  if(sig===lastPlayersSig)return;
  lastPlayersSig=sig;
  const pager=$('#playersPager');
  const countEl=$('#rosterCount'); if(countEl) countEl.textContent=t('ply.count',{a:list.length,b:all.filter(p=>p.online).length});
  if(pager){pager.hidden=totalPages<=1;$('#playersPageLabel').textContent=`${t('ply.page')} ${playerPage+1} / ${totalPages}`;$('#playersPrevPage').disabled=playerPage<=0;$('#playersNextPage').disabled=playerPage>=totalPages-1}
  if(!page.length){n.innerHTML=`<div class="player-empty"><b>${t('ply.empty')}</b><span>${t('ply.emptySub')}</span></div>`}else{n.innerHTML=page.map(p=>{
    const attrs=`data-player="${esc(p.name)}" data-uuid="${esc(p.uuid||'')}"`;
    const avatar=p.uuid?`https://mc-heads.net/avatar/${encodeURIComponent(p.uuid)}/36`:`https://mc-heads.net/avatar/MHF_Steve/36`;
    const meta=[p.online?`<span style="color:var(--success)">${t('ply.online')}</span>`:`<span>${t('ply.offline')}</span>`, p.hasData?t('ply.hasData'):t('ply.noData'), p.uuid?`UUID ${esc(p.uuid.slice(0,8))}…`:null].filter(Boolean).join(' • ');
    return `<div class="player-row ${p.online?'online':''}">
      <img class="player-avatar" src="${avatar}" alt="" onerror="this.src='https://mc-heads.net/avatar/MHF_Steve/36'">
      <div class="player-main">
        <div class="player-name"><i class="player-row-dot"></i><b>${esc(p.name)}</b>${badgeHtml(p)}</div>
        <div class="player-meta">${meta}</div>
      </div>
      <div class="player-row-actions">
        ${rowActionBtn('op',p.op?t('ply.removeOp'):t('ply.makeOp'),p.op,'',`${attrs} data-value="${p.op?'off':'on'}"`)}
        ${rowActionBtn('whitelist',p.whitelisted?t('ply.unwhitelist'):t('ply.whitelist'),p.whitelisted,'',`${attrs} data-value="${p.whitelisted?'off':'on'}"`)}
        ${rowActionBtn('ban',p.banned?t('ply.unban'):t('ply.ban'),p.banned,'danger',`${attrs} data-value="${p.banned?'off':'on'}"`)}
        <button class="row-action danger" data-row-action="kick" ${attrs} ${p.online?'':`disabled title="${t('ply.kickHint')}"`}>${t('ply.kick')}</button>
        <button class="row-action ${p.hasData?'':'muted'}" data-row-action="inspect" ${attrs} title="${p.hasData?t('ply.inspectHint'):t('ply.noDataHint')}">${t('ply.inspect')}</button>
      </div>
    </div>`;
  }).join('')}
}
async function togglePlayerOp(p,on){const bad=playerNameError(p.name);if(bad)return toast(bad);if(!p.uuid&&!state.running)return toast(t('toast.noUuid'));const r=await window.observer.playerOpToggle({uuid:p.uuid,name:p.name,op:on});if(!r.ok)return toast(r.error);state.files=r.files;refreshUI();toast(t(on?'toast.nowOp':'toast.noLongerOp',{n:p.name}))}
async function togglePlayerWhitelist(p,add){const bad=playerNameError(p.name);if(bad)return toast(bad);if(!p.uuid&&!state.running)return toast(t('toast.noUuid'));const r=await window.observer.playerWhitelistToggle({uuid:p.uuid,name:p.name,add});if(!r.ok)return toast(r.error);state.files=r.files;refreshUI();toast(t(add?'toast.addedWl':'toast.removedWl',{n:p.name}))}
async function togglePlayerBan(p,ban){const bad=playerNameError(p.name);if(bad)return toast(bad);if(!p.uuid&&!state.running)return toast(t('toast.noUuid'));const r=await window.observer.playerBanToggle({uuid:p.uuid,name:p.name,ban});if(!r.ok)return toast(r.error);state.files=r.files;refreshUI();toast(t(ban?'toast.banned':'toast.unbanned',{n:p.name}))}
function openPlayerInspectModal(){const m=$('#playerInspectModal'); m.classList.remove('closing'); m.hidden=false; void m.offsetWidth; }
// Fade-out is handled by the universal .modal-overlay [hidden] transition (08-motion.css) — just
// flip the attribute and drop the transient class after the fade finishes.
function closePlayerInspectModal(){const m=$('#playerInspectModal'); if(m.hidden) return; m.classList.add('closing'); m.hidden=true; setTimeout(()=>m.classList.remove('closing'),220);}
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
  const el=$('#pdReadout');if(!el)return;
  const gm=['Survival','Creative','Adventure','Spectator'][d.gameType??0]||'—';
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
  el.innerHTML=rows.map(([k,v,c])=>`<div class="pd-ro"><span>${esc(k)}</span><b class="${c}">${esc(String(v))}</b></div>`).join('');
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
}
$$('.inspect-tab').forEach(b=>b.onclick=()=>pdSetTab(b.dataset.pdTab));
$('#pdPanelLive')?.addEventListener('click',e=>{const b=e.target.closest('[data-live-cmd]');if(b&&!b.disabled)pdLiveAction(b.dataset.liveCmd)});

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
  if(saveBtn){saveBtn.disabled=state.running;saveBtn.title=state.running?t('ply.stopBeforeEdit'):''}
  if(offHint)offHint.textContent=state.running?t('pd.stopToEdit'):'';
  $('#playerDataForm').hidden=true;$('#playerDataEmpty').hidden=false;$('#playerDataError').textContent=t('ply.loadingData');
  if(!uuid){ const uuidEl=$('#inspectUuid'); if(uuidEl){ uuidEl.textContent=t('ply.uuidUnknown'); uuidEl.hidden=false; uuidEl.title=t('ply.uuidNone'); uuidEl.onclick=null; } $('#playerDataError').textContent=t('ply.noUuidLong',{n:name});return}
  let r;
  try{r=await window.observer.playerRead(uuid)}catch(e){$('#playerDataError').textContent=t('ply.readError',{m:e?.message||e});return}
  if(!r||!r.ok){$('#playerDataError').textContent=r?.error||t('ply.unknownReadError');return}
  const d=r.data;
  if(!d){$('#playerDataError').textContent=t('ply.corrupt');return}
  invSearchQuery='';ecSearchQuery='';invShowEmpty=false;ecShowEmpty=false;invSortBy='slot';ecSortBy='slot';
  const invS=$('#invSearch');if(invS)invS.value='';const ecS=$('#ecSearch');if(ecS)ecS.value='';
  const invCb=$('#invShowEmpty');if(invCb)invCb.checked=false;const ecCb=$('#ecShowEmpty');if(ecCb)ecCb.checked=false;
  const invSel=$('#invSort');if(invSel)invSel.value='slot';const ecSel=$('#ecSort');if(ecSel)ecSel.value='slot';
  $('#playerDataEmpty').hidden=true;$('#playerDataForm').hidden=false;
  $('#inspectAvatar').src=`https://mc-heads.net/avatar/${encodeURIComponent(uuid)}/44`;
  $('#inspectName').textContent=name;$('#inspectDim').textContent=d.dimension||t('ply.unknownDim');
  renderPdReadout(d,isOnline);
  const uuidEl=$('#inspectUuid'); if(uuidEl){ uuidEl.hidden=false; uuidEl.textContent=t('ply.uuidLabel',{v:uuid}); uuidEl.title=`${uuid} — ${t('ply.copyUuidHint')}`; uuidEl.onclick=async()=>{ try{ await navigator.clipboard.writeText(uuid); uuidEl.classList.add('copied'); const prev=uuidEl.textContent; uuidEl.textContent=t('toast.uuidCopied'); toast(t('toast.uuidCopied'),'success'); setTimeout(()=>{ uuidEl.textContent=t('ply.uuidLabel',{v:uuid}); uuidEl.classList.remove('copied'); }, 1200); }catch{ toast(uuid)} }; }
  $('#pdHealth').value=d.health??'';$('#pdFood').value=d.food??'';$('#pdSaturation').value=d.saturation??'';$('#pdXpLevel').value=d.xpLevel??0;$('#pdXpTotal').value=d.xpTotal??0;$('#pdGameType').value=d.gameType??0;$('#pdClearInventory').checked=false;
  lastInspectData={armor:d.armor,offhand:d.offhand,inventory:d.inventory,enderChest:d.enderChest};
  renderEquipment(d.armor,d.offhand);renderItemGrid('#inventoryList',d.inventory);renderItemGrid('#enderChestList',d.enderChest);
}
$('#playersList').addEventListener('click',async e=>{
  const btn=e.target.closest('[data-row-action]');if(!btn||btn.disabled)return;
  const action=btn.dataset.rowAction,name=btn.dataset.player,uuid=btn.dataset.uuid||null,p={uuid,name};
  if(action==='op')togglePlayerOp(p,btn.dataset.value==='on');
  else if(action==='whitelist')togglePlayerWhitelist(p,btn.dataset.value==='on');
  else if(action==='ban'){if(btn.dataset.value==='on'&&!await confirmDialog({title:t('ply.ban'),body:t('ply.confirmBan',{n:name}),ok:t('ply.ban'),danger:true}))return;togglePlayerBan(p,btn.dataset.value==='on')}
  else if(action==='kick'){const bad=playerNameError(name);if(bad)return toast(bad);if(await confirmDialog({title:t('ply.kick'),body:t('ply.confirmKick',{n:name}),ok:t('ply.kick'),danger:true}))command(`kick ${name}`)}
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
