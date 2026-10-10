// Regression guards for two UI fixes:
//  (1) server.properties enum fields (difficulty/gamemode) must use the app's ANIMATED dropdown
//      (class ol-select + enhanceAllSelects after render), not the OS <select> popup.
//  (2) Lite mode must actually disable the VISIBLE motion (tab slide, list stagger, modal rise),
//      which previously had no lite guard -> Lite looked the same as Full.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
let pass = 0, fail = 0;
const check = (n, c) => c ? (pass++, console.log('PASS', n)) : (fail++, console.log('FAIL', n));

const prop = fs.readFileSync(path.join(root, 'src', 'renderer', 'js', '06-properties.js'), 'utf8');
check('enum select carries ol-select', /<select class="ol-select" data-property=/.test(prop));
check('renderProperties enhances new selects', /enhanceAllSelects\(\$\('#propertiesGrid'\)\)/.test(prop));

const motion = fs.readFileSync(path.join(root, 'src', 'renderer', 'css', '08-motion.css'), 'utf8');
check('lite kills tab slide', /html\.motion-lite \.tab-enter-fwd,html\.motion-lite \.tab-enter-back\{animation:none\}/.test(motion));
check('lite kills list stagger', /html\.motion-lite \.tab\.active :is\([\s\S]*?worlds-list li\)\{animation:none\}/.test(motion));
check('lite kills modal rise', /html\.motion-lite \.modal-rise\{animation:none\}/.test(motion));
check('lite kills fade-swap', /html\.motion-lite \.fade-swap\{animation:none\}/.test(motion));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
