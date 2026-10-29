// Regression & unit tests for the Stats Tab GUI/UX rework (v6.1.7).
// Verifies formatTicks, formatDistance, friendlyStatName, getStatCategory, and fmtStat.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pass = 0, fail = 0;
const ck = (n, c) => c ? (pass++, console.log('PASS', n)) : (fail++, console.log('FAIL', n));

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'js', '03-players.js'), 'utf8');
const ctx = vm.createContext({
  console,
  Math,
  String,
  Number,
  Object,
  Array,
  window: { LOCALES: {}, addEventListener: () => {}, observer: { onIconsUpdate: () => {} } },
  $: () => ({ addEventListener: () => {}, classList: { toggle: () => {} } }),
  $$: () => [],
  state: {},
  document: { addEventListener: () => {} },
  navigator: { clipboard: { writeText: () => {} } },
  t: (k, params) => k + (params ? JSON.stringify(params) : ''),
  esc: s => s
});

vm.runInContext(src + '\n;globalThis.__stats = { formatTicks, formatDistance, friendlyStatName, getStatCategory, fmtStat, STAT_FRIENDLY_NAMES };', ctx);
const { formatTicks, formatDistance, friendlyStatName, getStatCategory, fmtStat, STAT_FRIENDLY_NAMES } = ctx.__stats;

// --- formatTicks ---
ck('formatTicks: 0 ticks -> 0s', formatTicks(0) === '0s');
ck('formatTicks: negative ticks -> 0s', formatTicks(-10) === '0s');
ck('formatTicks: null/undefined -> 0s', formatTicks(null) === '0s');
ck('formatTicks: 20 ticks -> 1s', formatTicks(20) === '1s');
ck('formatTicks: 278 ticks -> 13m or seconds', formatTicks(278) === '13s');
ck('formatTicks: 1200 ticks -> 1m 0s', formatTicks(1200) === '1m 0s');
ck('formatTicks: 23812 ticks (time since rest) -> 19m 50s', formatTicks(23812) === '19m 50s');
ck('formatTicks: 41376 ticks (time since death) -> 34m 28s', formatTicks(41376) === '34m 28s');
ck('formatTicks: 84000 ticks (playtime) -> 1h 10m', formatTicks(84000) === '1h 10m');
ck('formatTicks: 1728000 ticks -> 1d 0h', formatTicks(1728000) === '1d 0h');

// --- formatDistance ---
ck('formatDistance: 0 cm -> 0 m', formatDistance(0) === '0 m');
ck('formatDistance: 500 cm -> 5 m', formatDistance(500) === '5 m');
ck('formatDistance: 5300 cm -> 53 m', formatDistance(5300) === '53 m');
ck('formatDistance: 137000 cm -> 1.37 km', formatDistance(137000) === '1.37 km');
ck('formatDistance: 364700 cm -> 3.65 km', formatDistance(364700) === '3.65 km');
ck('formatDistance: 203700 cm -> 2.04 km', formatDistance(203700) === '2.04 km');

// --- friendlyStatName ---
ck('friendly: walk_one_cm -> Walking Distance', friendlyStatName('minecraft:walk_one_cm') === 'Walking Distance');
ck('friendly: damage_blocked_by_shield -> Damage Blocked (Shield)', friendlyStatName('minecraft:damage_blocked_by_shield') === 'Damage Blocked (Shield)');
ck('friendly: interact_with_crafting_table -> Crafting Table Used', friendlyStatName('minecraft:interact_with_crafting_table') === 'Crafting Table Used');
ck('friendly: time_since_death -> Time Since Death', friendlyStatName('minecraft:time_since_death') === 'Time Since Death');
ck('friendly: unknown mod stat fallback', friendlyStatName('custom_mod:magic_spell_cast') === 'Magic Spell Cast');

// --- getStatCategory ---
ck('category: play_time -> survival', getStatCategory('minecraft:play_time') === 'survival');
ck('category: deaths -> survival', getStatCategory('minecraft:deaths') === 'survival');
ck('category: time_since_rest -> survival', getStatCategory('minecraft:time_since_rest') === 'survival');
ck('category: mob_kills -> combat', getStatCategory('minecraft:mob_kills') === 'combat');
ck('category: damage_dealt -> combat', getStatCategory('minecraft:damage_dealt') === 'combat');
ck('category: damage_blocked_by_shield -> combat', getStatCategory('minecraft:damage_blocked_by_shield') === 'combat');
ck('category: walk_one_cm -> movement', getStatCategory('minecraft:walk_one_cm') === 'movement');
ck('category: sprint_one_cm -> movement', getStatCategory('minecraft:sprint_one_cm') === 'movement');
ck('category: jump -> movement', getStatCategory('minecraft:jump') === 'movement');
ck('category: sneak_time -> movement', getStatCategory('minecraft:sneak_time') === 'movement');
ck('category: open_chest -> interaction', getStatCategory('minecraft:open_chest') === 'interaction');
ck('category: interact_with_crafting_table -> interaction', getStatCategory('minecraft:interact_with_crafting_table') === 'interaction');

// --- fmtStat ---
ck('fmtStat: formats distance', fmtStat('minecraft:walk_one_cm', 137000) === '1.37 km');
ck('fmtStat: formats short distance', fmtStat('minecraft:crouch_one_cm', 500) === '5 m');
ck('fmtStat: formats ticks', fmtStat('minecraft:time_since_death', 41376) === '34m 28s');
ck('fmtStat: formats numbers with locale string', fmtStat('minecraft:mob_kills', 1700) === (1700).toLocaleString());

// --- Icon style & SVG design consistency ---
const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'css', '07-polish.css'), 'utf8');

ck('hero icons: index.html has no emoji in pdStatsHero', !/#pdStatsHero[\s\S]*?[⏱️⚔️🧭💥]/.test(html));
ck('hero icons: index.html has 4 vector SVGs in hero cards', (html.match(/class="pd-hero-icon"[\s\S]*?<svg viewBox="0 0 24 24"/g) || []).length === 4);
ck('damage indicator: 03-players.js uses pd-stat-heart SVG instead of raw emoji', src.includes('class="pd-stat-heart"') && !src.includes('pd-stat-extra">${(v / 2).toFixed(1)} ❤'));
ck('css styling: 07-polish.css styles .pd-hero-icon svg with 18px size', css.includes('.pd-hero-icon svg{width:18px;height:18px;stroke:currentColor;fill:none;flex-shrink:0;display:block}'));
ck('css styling: 07-polish.css styles .pd-stat-heart', css.includes('.pd-stat-heart{width:10px;height:10px;fill:var(--danger);flex-shrink:0;display:inline-block;vertical-align:-1px}'));

// --- End-to-end renderPdStats execution ---
const dom = {};
const getEl = id => {
  if (!dom[id]) dom[id] = { textContent: '', innerHTML: '', hidden: false, style: {}, addEventListener: () => {} };
  return dom[id];
};
const renderCtx = vm.createContext({
  console, Math, String, Number, Object, Array,
  window: { LOCALES: {}, addEventListener: () => {}, observer: { onIconsUpdate: () => {} } },
  $: id => getEl(id),
  $$: () => [],
  state: {},
  document: { addEventListener: () => {} },
  navigator: { clipboard: { writeText: () => {} } },
  t: (k, params) => k + (params ? JSON.stringify(params) : ''),
  esc: s => s
});

const mockStats = {
  stats: {
    'minecraft:custom': {
      'minecraft:mob_kills': 11,
      'minecraft:play_one_minute': 92645,
      'minecraft:damage_dealt': 3865,
      'minecraft:damage_taken': 1820,
      'minecraft:walk_one_cm': 141675,
      'minecraft:deaths': 5
    }
  }
};

let renderError = null;
try {
  vm.runInContext(src + '\n;renderPdStats(' + JSON.stringify(mockStats) + ');', renderCtx);
} catch (e) {
  renderError = e;
}

ck('renderPdStats executes without error (no ReferenceError on isDmg)', renderError === null);
ck('renderPdStats populates pdHeroPlaytime', dom['#pdHeroPlaytime']?.textContent === '1h 17m');
ck('renderPdStats populates pdHeroKd', dom['#pdHeroKd']?.textContent === 'K/D 2.2');
ck('renderPdStats populates pdHeroDamage', dom['#pdHeroDamage']?.textContent === (3865).toLocaleString());
ck('renderPdStats populates pdStatsGrid with rendered stat cards', typeof dom['#pdStatsGrid']?.innerHTML === 'string' && dom['#pdStatsGrid'].innerHTML.includes('pd-stat cat-combat'));
ck('renderPdStats renders pd-stat-heart for damage', dom['#pdStatsGrid']?.innerHTML.includes('pd-stat-heart'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
