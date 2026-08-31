const fs = require('fs');
const path = require('path');
const dir = 'site/assets/i18n';
const en = JSON.parse(fs.readFileSync(path.join(dir, 'en.json'), 'utf8'));
const enKeys = Object.keys(en);
let ok = true;
for (const f of fs.readdirSync(dir)) {
  const data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const missing = enKeys.filter(k => !(k in data));
  if (missing.length) {
    ok = false;
    console.log(f + ' missing: ' + missing.join(', '));
  } else {
    console.log(f + ' OK - all keys present');
  }
}
if (ok) console.log('ALL I18N FILES COMPLETE');
