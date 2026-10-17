// js/02b-gamerules.js — v6.0.0 G4: world game-rule editor.
// Lazy-loaded when the user opens the Game rules disclosure in the World Map tab. Reads every rule
// from level.dat, renders a row per rule (booleans as a toggle-like select, numbers/strings as an
// input), and saves the changed ones in one batch. The server must be stopped.
let _grLoaded = false;
let _grDirty = false;

// A few rules are booleans; everything else is a number or free string.
const GR_BOOL = new Set(['doDaylightCycle','doWeatherCycle','doMobSpawning','doMobLoot','doTileDrops','keepInventory','mobGriefing','naturalRegeneration','doFireTick','doEntityDrops','doInsomnia','doImmediateRespawn','disableElytraMovementCheck','disableRaids','spectatorsGenerateChunks','doPatrolSpawning','doTraderSpawning','doWardenSpawning','doVinesSpread','announceAdvancements','commandBlockOutput','commandBlocksEnabled','logAdminCommands','sendCommandFeedback','showDeathMessages','reducedDebugInfo','spawnRadius','doLimitedCrafting','playersSleepingPercentage','randomTickSpeed','maxCommandChainLength','maxEntityCramming']);
function isGrBool(name, value) { return value === 'true' || value === 'false' || /^do[A-Z]|^keepInventory$|^mobGriefing$|^naturalRegeneration$/.test(name); }

async function loadGameRules() {
  const grid = $('#grGrid'); if (!grid) return;
  grid.innerHTML = `<p class="text-muted">${esc(t('gr.loading'))}</p>`;
  let r; try { r = await window.observer.gamerulesGet(); } catch (e) { r = { ok: false, error: e?.message }; }
  if (!r || !r.ok) { grid.innerHTML = `<p class="text-muted">${esc((r && r.error) || t('gr.none'))}</p>`; return; }
  const rules = r.rules || {};
  const names = Object.keys(rules).sort();
  if (!names.length) { grid.innerHTML = `<p class="text-muted">${esc(t('gr.none'))}</p>`; return; }
  grid.innerHTML = names.map(n => {
    const v = String(rules[n]);
    let ctl;
    if (isGrBool(n, v)) ctl = `<select class="ol-select" data-gr="${esc(n)}"><option value="true" ${v === 'true' ? 'selected' : ''}>${esc(t('gr.on'))}</option><option value="false" ${v === 'false' ? 'selected' : ''}>${esc(t('gr.off'))}</option></select>`;
    else ctl = `<input data-gr="${esc(n)}" value="${esc(v)}" spellcheck="false">`;
    return `<label class="gr-row" data-gr-row title="${esc(n)}"><span class="gr-name">${esc(n)}</span>${ctl}</label>`;
  }).join('');
  _grLoaded = true;
  _grDirty = false;
  updateGrSave();
  // New selects injected just now are not enhanced; do it so they animate like the rest.
  if (window.enhanceAllSelects) try { window.enhanceAllSelects(grid); } catch {}
}

function collectGameRules() {
  const out = {};
  $$('#grGrid [data-gr]').forEach(el => { out[el.dataset.gr] = el.tagName === 'SELECT' ? el.value : el.value.trim(); });
  return out;
}
function updateGrSave() { const b = $('#grSave'); if (b) b.disabled = !_grDirty; }

async function saveGameRules() {
  const b = $('#grSave'); if (b) b.disabled = true;
  // Only send rules that differ from what was loaded. Re-read is cheap and avoids sending all.
  let orig = {};
  try { const r = await window.observer.gamerulesGet(); if (r && r.ok) orig = r.rules || {}; } catch {}
  const cur = collectGameRules();
  const changes = {};
  for (const [k, v] of Object.entries(cur)) { if (String(orig[k]) !== String(v)) changes[k] = v; }
  if (!Object.keys(changes).length) { _grDirty = false; updateGrSave(); return toast(t('gr.saved'), 'success'); }
  let r; try { r = await window.observer.gamerulesSet(changes); } catch (e) { r = { ok: false, error: e?.message }; }
  if (!r || !r.ok) { updateGrSave(); return toast((r && r.error) || t('gr.fail'), 'error'); }
  _grDirty = false; updateGrSave();
  toast(t('gr.saved'), 'success');
  if (r.backup) toast(t('gr.backup', { p: r.backup }), 'success');
}

// Wire the disclosure: load once when opened; mark dirty on any edit.
$('#grBox')?.addEventListener('toggle', e => { const d = e.target; if (d.open && !_grLoaded) loadGameRules(); });
$('#grGrid')?.addEventListener('input', () => { if (!_grLoaded) return; _grDirty = true; updateGrSave(); });
$('#grGrid')?.addEventListener('change', () => { if (!_grLoaded) return; _grDirty = true; updateGrSave(); });
$('#grSave')?.addEventListener('click', () => withBusy($('#grSave'), saveGameRules));
