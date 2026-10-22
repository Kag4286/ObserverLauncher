// js/06-properties.js — split from app.js (lines 926-998); classic script, load in numeric order.
// Properties tab: server.properties / velocity.toml editors.
function isProxyServer(){return /velocity/i.test(state.files?.jar||'')}
// v5.3.1: labels + hints are i18n keys now ('prop.<name>.l' / 'prop.<name>.h'), resolved through
// t() at render time. The keys are written as LITERALS here so tests/i18n.test.js (which scans the
// renderer for quoted key strings) still sees them and does not flag them as dead.
const PROPERTY_META={
  'motd':{l:'prop.motd.l',h:'prop.motd.h',g:'gameplay'},
  'max-players':{l:'prop.max-players.l',h:'prop.max-players.h',g:'gameplay'},
  'difficulty':{l:'prop.difficulty.l',h:'prop.difficulty.h',g:'gameplay'},
  'gamemode':{l:'prop.gamemode.l',h:'prop.gamemode.h',g:'gameplay'},
  'hardcore':{l:'prop.hardcore.l',h:'prop.hardcore.h',g:'gameplay'},
  'pvp':{l:'prop.pvp.l',h:'prop.pvp.h',g:'gameplay'},
  'force-gamemode':{l:'prop.force-gamemode.l',h:'prop.force-gamemode.h',g:'gameplay'},
  'allow-flight':{l:'prop.allow-flight.l',h:'prop.allow-flight.h',g:'gameplay'},
  'spawn-monsters':{l:'prop.spawn-monsters.l',h:'prop.spawn-monsters.h',g:'gameplay'},
  'spawn-animals':{l:'prop.spawn-animals.l',h:'prop.spawn-animals.h',g:'gameplay'},
  'spawn-npcs':{l:'prop.spawn-npcs.l',h:'prop.spawn-npcs.h',g:'gameplay'},
  'allow-nether':{l:'prop.allow-nether.l',h:'prop.allow-nether.h',g:'gameplay'},
  'player-idle-timeout':{l:'prop.player-idle-timeout.l',h:'prop.player-idle-timeout.h',g:'gameplay'},
  'level-name':{l:'prop.level-name.l',h:'prop.level-name.h',g:'world'},
  'level-seed':{l:'prop.level-seed.l',h:'prop.level-seed.h',g:'world'},
  'level-type':{l:'prop.level-type.l',h:'prop.level-type.h',g:'world'},
  'generate-structures':{l:'prop.generate-structures.l',h:'prop.generate-structures.h',g:'world'},
  'generator-settings':{l:'prop.generator-settings.l',h:'prop.generator-settings.h',g:'world'},
  'spawn-protection':{l:'prop.spawn-protection.l',h:'prop.spawn-protection.h',g:'world'},
  'max-world-size':{l:'prop.max-world-size.l',h:'prop.max-world-size.h',g:'world'},
  'view-distance':{l:'prop.view-distance.l',h:'prop.view-distance.h',g:'world'},
  'simulation-distance':{l:'prop.simulation-distance.l',h:'prop.simulation-distance.h',g:'world'},
  'entity-broadcast-range-percentage':{l:'prop.entity-broadcast-range-percentage.l',h:'prop.entity-broadcast-range-percentage.h',g:'world'},
  'max-tick-time':{l:'prop.max-tick-time.l',h:'prop.max-tick-time.h',g:'network'},
  'server-port':{l:'prop.server-port.l',h:'prop.server-port.h',g:'network'},
  'server-ip':{l:'prop.server-ip.l',h:'prop.server-ip.h',g:'network'},
  'network-compression-threshold':{l:'prop.network-compression-threshold.l',h:'prop.network-compression-threshold.h',g:'network'},
  'use-native-transport':{l:'prop.use-native-transport.l',h:'prop.use-native-transport.h',g:'network'},
  'prevent-proxy-connections':{l:'prop.prevent-proxy-connections.l',h:'prop.prevent-proxy-connections.h',g:'network'},
  'enable-jmx-monitoring':{l:'prop.enable-jmx-monitoring.l',h:'prop.enable-jmx-monitoring.h',g:'network'},
  'online-mode':{l:'prop.online-mode.l',h:'prop.online-mode.h',g:'security'},
  'white-list':{l:'prop.white-list.l',h:'prop.white-list.h',g:'security'},
  'enforce-whitelist':{l:'prop.enforce-whitelist.l',h:'prop.enforce-whitelist.h',g:'security'},
  'op-permission-level':{l:'prop.op-permission-level.l',h:'prop.op-permission-level.h',g:'security'},
  'function-permission-level':{l:'prop.function-permission-level.l',h:'prop.function-permission-level.h',g:'security'},
  'enable-command-block':{l:'prop.enable-command-block.l',h:'',g:'security'},
  'enable-rcon':{l:'prop.enable-rcon.l',h:'prop.enable-rcon.h',g:'security'},
  'rcon.port':{l:'prop.rcon.port.l',h:'',g:'security'},
  'rcon.password':{l:'prop.rcon.password.l',h:'',g:'security'},
  'broadcast-console-to-ops':{l:'prop.broadcast-console-to-ops.l',h:'',g:'security'},
  'broadcast-rcon-to-ops':{l:'prop.broadcast-rcon-to-ops.l',h:'',g:'security'},
  'enable-query':{l:'prop.enable-query.l',h:'prop.enable-query.h',g:'security'},
  'query.port':{l:'prop.query.port.l',h:'',g:'security'},
  'resource-pack':{l:'prop.resource-pack.l',h:'',g:'security'},
  'resource-pack-sha1':{l:'prop.resource-pack-sha1.l',h:'',g:'security'},
  'resource-pack-prompt':{l:'prop.resource-pack-prompt.l',h:'',g:'security'},
  'require-resource-pack':{l:'prop.require-resource-pack.l',h:'prop.require-resource-pack.h',g:'security'},
};
const PROPERTY_GROUPS=[{id:'gameplay',label:'Gameplay'},{id:'world',label:'World'},{id:'network',label:'Network & performance'},{id:'security',label:'Security & moderation'}];
// UX rework: booleans render as switches, known enums as selects, everything else as a compact
// text field. The hint lives in the row title (tooltip) instead of a visible line under every
// input — same information, half the noise. data-prop-search/.prop-label/.prop-key are kept so
// the live search keeps working unchanged.
const PROP_ENUMS={difficulty:['peaceful','easy','normal','hard'],gamemode:['survival','creative','adventure','spectator']};
function propRow(k,v){
  const meta=PROPERTY_META[k];const val=String(v??'');const isBool=val==='true'||val==='false';
  const label=meta?.l?t(meta.l):k, hint=meta?.h?t(meta.h):'';
  const search=esc(label+' '+k),title=esc(hint||k);
  let ctl;
  if(isBool)ctl=`<span class="prop-ctl"><label class="switch"><input type="checkbox" data-property="${esc(k)}" ${val==='true'?'checked':''}><span class="slider"></span></label></span>`;
  // ol-select: enhance into the app's animated dropdown (a native <select> popup is OS-drawn and
  // cannot animate — the same reason every other select in the app carries this class).
  else if(PROP_ENUMS[k])ctl=`<span class="prop-ctl"><select class="ol-select" data-property="${esc(k)}">${(PROP_ENUMS[k].includes(val)?PROP_ENUMS[k]:[...PROP_ENUMS[k],val]).map(o=>`<option ${o===val?'selected':''}>${esc(o)}</option>`).join('')}</select></span>`;
  else ctl=`<span class="prop-ctl"><input data-property="${esc(k)}" value="${esc(val)}" placeholder="${esc(hint)}" spellcheck="false"></span>`;
  // v6.0.0 G1: the motd field shows a live preview below it (colored/formatted like the in-game MOTD),
  // with quick color and formatting chips (v6.0.2).
  const preview=k==='motd'?`<div class="motd-palette" data-motd-palette><button type="button" class="motd-chip" data-motd-code="§0" title="Black (§0)" style="background:#000000"></button><button type="button" class="motd-chip" data-motd-code="§1" title="Dark Blue (§1)" style="background:#0000AA"></button><button type="button" class="motd-chip" data-motd-code="§2" title="Dark Green (§2)" style="background:#00AA00"></button><button type="button" class="motd-chip" data-motd-code="§3" title="Dark Aqua (§3)" style="background:#00AAAA"></button><button type="button" class="motd-chip" data-motd-code="§4" title="Dark Red (§4)" style="background:#AA0000"></button><button type="button" class="motd-chip" data-motd-code="§5" title="Dark Purple (§5)" style="background:#AA00AA"></button><button type="button" class="motd-chip" data-motd-code="§6" title="Gold (§6)" style="background:#FFAA00"></button><button type="button" class="motd-chip" data-motd-code="§7" title="Gray (§7)" style="background:#AAAAAA"></button><button type="button" class="motd-chip" data-motd-code="§8" title="Dark Gray (§8)" style="background:#555555"></button><button type="button" class="motd-chip" data-motd-code="§9" title="Blue (§9)" style="background:#5555FF"></button><button type="button" class="motd-chip" data-motd-code="§a" title="Green (§a)" style="background:#55FF55"></button><button type="button" class="motd-chip" data-motd-code="§b" title="Aqua (§b)" style="background:#55FFFF"></button><button type="button" class="motd-chip" data-motd-code="§c" title="Red (§c)" style="background:#FF5555"></button><button type="button" class="motd-chip" data-motd-code="§d" title="Light Purple (§d)" style="background:#FF55FF"></button><button type="button" class="motd-chip" data-motd-code="§e" title="Yellow (§e)" style="background:#FFFF55"></button><button type="button" class="motd-chip" data-motd-code="§f" title="White (§f)" style="background:#FFFFFF"></button><span class="motd-palette-sep"></span><button type="button" class="motd-chip fmt" data-motd-code="§l" title="Bold (§l)" style="font-weight:bold">B</button><button type="button" class="motd-chip fmt" data-motd-code="§o" title="Italic (§o)" style="font-style:italic">I</button><button type="button" class="motd-chip fmt" data-motd-code="§n" title="Underline (§n)" style="text-decoration:underline">U</button><button type="button" class="motd-chip fmt" data-motd-code="§r" title="Reset (§r)">✕</button></div><span class="prop-motd-preview" data-motd-preview>${renderMotdPreview(val)}</span>`:'';
  return `<label data-prop-row data-prop-search="${search}" title="${title}" class="prop-row${isBool?' is-bool':''}"><span class="prop-label">${esc(label)}<small class="prop-key">${esc(k)}</small></span>${ctl}${preview}</label>`;
}
// 5.4.0: unsaved-changes tracking. The form counts as dirty only while it DIFFERS from the last
// rendered/saved snapshot, so switching difficulty back to its original value clears the cue.
// A plain boolean latched on the first edit and stayed on forever (reported bug).
let _propsBaseline=null;
function snapshotPropsForm(){
  if(isProxyServer())return $('#propertiesRaw').value;
  const o={};
  $$('[data-property]').forEach(input=>{o[input.dataset.property]=input.type==='checkbox'?(input.checked?'true':'false'):input.value.trim()});
  return JSON.stringify(o);
}
function capturePropsBaseline(){try{_propsBaseline=snapshotPropsForm()}catch{_propsBaseline=null}}
function renderProperties(props){
  const keys=Object.keys(props);
  const byGroup={};PROPERTY_GROUPS.forEach(g=>byGroup[g.id]=[]);const advanced=[];
  keys.forEach(k=>{const meta=PROPERTY_META[k];if(meta)byGroup[meta.g].push(k);else advanced.push(k)});
  const group=(id,label,arr,advancedG)=>arr.length?`<details class="prop-group${advancedG?' prop-advanced':''}" data-group-id="${id}" ${advancedG?'':'open'}><summary>${esc(label)}<span class="prop-count">${arr.length}</span><i class="prop-chevron">▸</i></summary><div class="properties-grid">${arr.map(k=>propRow(k,props[k])).join('')}</div></details>`:'';
  $('#propertiesGrid').innerHTML=PROPERTY_GROUPS.map(g=>group(g.id,t('prop.group.'+g.id),byGroup[g.id])).join('')+group('advanced',t('prop.advanced'),advanced,true);
  // The grid was just rebuilt, so any <select class="ol-select"> inside it is brand new and not yet
  // enhanced (enhanceAll() only ran at load). Enhance them now so the enum fields (difficulty,
  // gamemode) get the animated dropdown instead of the OS popup.
  if(window.enhanceAllSelects)try{window.enhanceAllSelects($('#propertiesGrid'))}catch{}
  capturePropsBaseline();
  if(typeof updatePropsDirty==='function')updatePropsDirty();
}
async function refreshProxyProperties(){const r=await window.observer.readRawProperties();if(r.ok){$('#propertiesRaw').value=r.content;capturePropsBaseline();if(typeof updatePropsDirty==='function')updatePropsDirty()}}
