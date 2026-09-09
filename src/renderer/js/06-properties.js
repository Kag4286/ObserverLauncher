// js/06-properties.js — split from app.js (lines 926-998); classic script, load in numeric order.
// Properties tab: server.properties / velocity.toml editors.
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
