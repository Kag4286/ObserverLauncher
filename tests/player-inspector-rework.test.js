// Unit & integration tests for Player Inspector Master-Detail (Split-View) rework.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pass = 0, fail = 0;
const ck = (n, c) => c ? (pass++, console.log('PASS', n)) : (fail++, console.log('FAIL', n));

const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'css', '04-players.css'), 'utf8');
const js = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'js', '03-players.js'), 'utf8');

// --- HTML DOM Structure ---
ck('html: players-split-layout container present', html.includes('class="players-split-layout"'));
ck('html: players-roster-pane present', html.includes('class="players-roster-pane"'));
ck('html: players-detail-pane present', html.includes('class="players-detail-pane"'));
const playersSectionStart = html.indexOf('id="players"');
const playersSectionEnd = html.indexOf('</section>', playersSectionStart);
const detailPanePos = html.indexOf('class="players-detail-pane"', playersSectionStart);
const inspectorPos = html.indexOf('id="playerInspector"', playersSectionStart);
ck('html: playerInspector is inside detail-pane', detailPanePos > playersSectionStart && inspectorPos > detailPanePos && inspectorPos < playersSectionEnd);
ck('html: empty inspect state has ply.emptyInspectTitle', html.includes('data-i18n="ply.emptyInspectTitle"'));
ck('html: empty inspect state has ply.emptyInspectSub', html.includes('data-i18n="ply.emptyInspectSub"'));
ck('html: header quick action buttons present', html.includes('id="inspectHeaderOpBtn"') && html.includes('id="inspectHeaderWlBtn"') && html.includes('id="inspectHeaderTpBtn"') && html.includes('id="inspectHeaderKickBtn"'));
ck('html: playerInspectClose has ply.closeInspect', html.includes('data-i18n-title="ply.closeInspect"'));
ck('html: playerInspectModal stub exists', html.includes('id="playerInspectModal"'));

// --- CSS Styles ---
ck('css: .players-split-layout defines grid layout', css.includes('.players-split-layout{display:grid'));
ck('css: .players-roster-pane scrollable', css.includes('.players-roster-pane .players-table{max-height:calc(100vh - 270px)'));
ck('css: .players-detail-pane styled', css.includes('.players-detail-pane{min-width:0;background:var(--panel)'));
ck('css: .player-row.is-selected has brand border/glow', css.includes('.player-row.is-selected{background:var(--surface-3);border-color:var(--brand)'));
ck('css: responsive collapse for narrow screens', css.includes('@media (max-width: 960px){.players-split-layout{grid-template-columns:1fr}}'));

// --- JS Controller Logic ---
ck('js: deselectPlayer defined', js.includes('function deselectPlayer()'));
ck('js: closePlayerInspectModal calls deselectPlayer', js.includes('function closePlayerInspectModal(){ deselectPlayer(); }') || js.includes('function closePlayerInspectModal(){deselectPlayer();}'));
ck('js: openPlayerInspector highlights .is-selected', js.includes("r.classList.toggle('is-selected', isThis);") || js.includes("r.classList.toggle('is-selected', hit);"));
ck('js: renderPlayers includes is-selected class', js.includes("isSelected?'is-selected':''"));
ck('js: playersList click delegates to openPlayerInspector for row', js.includes("const row=e.target.closest('.player-row')") && js.includes('openPlayerInspector(uuid,name)'));
ck('js: onIconsUpdate checks selectedPlayer and playerDataForm', js.includes("if(!selectedPlayer||$('#playerDataForm')?.hidden||!lastInspectData)return;"));

console.log(`\nPlayer Inspector rework verification: ${pass} passed, ${fail} failed.`);
if (fail > 0) process.exit(1);
