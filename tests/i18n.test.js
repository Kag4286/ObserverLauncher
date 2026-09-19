global.window = {};
// locales/ split: meta first (init + LOCALES_META), then every language file.
require('../src/renderer/locales/meta.js');
for (const lang of ['en', 'vi', 'es', 'pt-BR', 'de', 'ru', 'zh-CN']) {
  require(`../src/renderer/locales/${lang}.js`);
}
const fs = require('fs');
const path = require('path');

const en = Object.keys(window.LOCALES.en);
let ok = true;
for (const c of Object.keys(window.LOCALES)) {
  const miss = en.filter(k => !(k in window.LOCALES[c]));
  if (miss.length) { ok = false; console.log(c, 'missing:', miss.join(',')); }
}
console.log(ok ? `i18n: ${Object.keys(window.LOCALES).length} locales x ${en.length} keys — COMPLETE` : 'INCOMPLETE');

// --- keys referenced from HTML (data-i18n*) ---
const html = fs.readFileSync(path.join(__dirname, '../src/renderer/index.html'), 'utf8');
const used = [...new Set([...html.matchAll(/data-i18n(?:-html|-placeholder|-title)?="([\w.]+)"/g)].map(m => m[1]))];
const missing = used.filter(k => !(k in window.LOCALES.en));
console.log('data-i18n used in HTML:', used.length, '| missing keys:', missing.length ? missing.join(',') : 'none');

// --- keys referenced from renderer JS: t('literal') / tf('literal') ---
// Only static string literals are checked. Dynamic keys (t('a.'+x), t(`...${}`)) are skipped,
// since we can't resolve them statically — they would be false positives.
const jsDir = path.join(__dirname, '../src/renderer/js');
const jsFiles = fs.readdirSync(jsDir).filter(f => f.endsWith('.js'));
const jsKeys = new Set();
for (const file of jsFiles) {
  const src = fs.readFileSync(path.join(jsDir, file), 'utf8');
  // Lookahead (?=[,)]) rejects concatenated/prefix keys like t('mkt.' + kind + 'Type').
  for (const m of src.matchAll(/\btf?\(\s*(['"])([\w.]+)\1\s*(?=[,)])/g)) jsKeys.add(m[2]);
}
const jsMissing = [...jsKeys].filter(k => !(k in window.LOCALES.en));
console.log('t() keys used in JS:', jsKeys.size, '| missing keys:', jsMissing.length ? jsMissing.join(',') : 'none');

// The two missing-lists are the assertions: fail the test if anything is absent.
const fail = missing.length + jsMissing.length;
process.exit(fail ? 1 : 0);
