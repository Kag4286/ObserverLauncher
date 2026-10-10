// 5.2.0 Beginner mode: source-level guards (the feature is mostly CSS/HTML wiring + a settings
// flag, so we assert the wiring exists and the defaults are safe).
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
let pass = 0, fail = 0;
const check = (n, c) => c ? (pass++, console.log('PASS', n)) : (fail++, console.log('FAIL', n));

// settings default
const settings = fs.readFileSync(path.join(root, 'src', 'main', 'settings.js'), 'utf8');
check('settings has beginnerMode default false', /beginnerMode:\s*false/.test(settings));

// getSettings carries it (so it persists on save)
const ov = fs.readFileSync(path.join(root, 'src', 'renderer', 'js', '07-overview.js'), 'utf8');
check('getSettings includes beginnerMode', /beginnerMode:\$\('#beginnerModeInput'\)/.test(ov));
check('refreshUI syncs the toggle', /beginnerModeInput'\)\)\$\('#beginnerModeInput'\)\.checked/.test(ov));

// shell wiring
const sh = fs.readFileSync(path.join(root, 'src', 'renderer', 'js', '08-shell.js'), 'utf8');
check('applyBeginnerMode defined', /function applyBeginnerMode\(/.test(sh));
check('BEGINNER_TABS has 5 tabs (incl. properties)', /BEGINNER_TABS=new Set\(\['overview','console','players','properties','settings'\]\)/.test(sh));
// 5.2.0: the onboarding now has an explicit mode picker; obFinish() persists the chosen mode.
check('onboarding mode picker exists', /obModeBeginner/.test(sh) && /obModeAdvanced/.test(sh));
check('obFinish persists the picked mode', /saveBeginnerMode\(obMode==='beginner'\)/.test(sh));
check('create-new calls obFinish', /obCreateNew'\).onclick=async\(\)=>\{[\s\S]*?obFinish\(\)/.test(sh));
check('onboarding has language select', /obLangSelect/.test(sh));
check('show-all button wired', /railShowAll'\).onclick=\(\)=>saveBeginnerMode\(false\)/.test(sh));

// CSS hides the advanced tabs under body.beginner-mode
const css = fs.readFileSync(path.join(root, 'src', 'renderer', 'css', '02-shell.css'), 'utf8');
['performance', 'content', 'marketplace', 'worlds', 'worldmap'].forEach(tab => {
  check('CSS hides tab ' + tab, new RegExp('body\\.beginner-mode \\.nav-item\\[data-tab="' + tab + '"\\]').test(css));
});
// Server properties must STAY visible in beginner mode (configuring the server is core, not advanced).
check('CSS does NOT hide properties tab', !/body\.beginner-mode \.nav-item\[data-tab="properties"\]/.test(css));
check('CSS hides ov-adv', /body\.beginner-mode \.ov-adv\{display:none\}/.test(css));
check('CSS hides content group', /body\.beginner-mode \.nav-group\[data-grp="content"\]/.test(css));

// HTML wiring
const html = fs.readFileSync(path.join(root, 'src', 'renderer', 'index.html'), 'utf8');
check('HTML has beginnerModeInput', /id="beginnerModeInput"/.test(html));
check('HTML has railShowAll', /id="railShowAll"/.test(html));
check('HTML has beginnerShare', /id="beginnerShare"/.test(html));
check('HTML has beginnerShareAddr', /id="beginnerShareAddr"/.test(html));
check('content group has data-grp', /data-grp="content"/.test(html));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
