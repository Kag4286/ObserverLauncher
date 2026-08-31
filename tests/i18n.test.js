global.window = {};
require('../src/renderer/locales.js');
const en = Object.keys(window.LOCALES.en);
let ok = true;
for (const c of Object.keys(window.LOCALES)) {
  const miss = en.filter(k => !(k in window.LOCALES[c]));
  if (miss.length) { ok = false; console.log(c, 'missing:', miss.join(',')); }
}
console.log(ok ? `i18n: ${Object.keys(window.LOCALES).length} locales x ${en.length} keys — COMPLETE` : 'INCOMPLETE');
const html = require('fs').readFileSync(require('path').join(__dirname,'../src/renderer/index.html'), 'utf8');
const used = [...new Set([...html.matchAll(/data-i18n(?:-html|-placeholder|-title)?="([\w.]+)"/g)].map(m => m[1]))];
const missing = used.filter(k => !(k in window.LOCALES.en));
console.log('data-i18n used in HTML:', used.length, '| missing keys:', missing.length ? missing.join(',') : 'none');
