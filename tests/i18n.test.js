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

// --- SOURCE-LEVEL duplicate-key detection (runtime objects silently dedupe, so the checks
// above can't see a repeated key in the file). Parse each locale file's raw text for 'key':
// occurrences and flag any key that appears twice. This is the class of bug that shipped
// 3 times (eyebrow.perf x4, im.preparing x2, the pd.* block x2).
const localeDir = path.join(__dirname, '../src/renderer/locales');
let dupFail = 0, dupWarn = 0;
for (const lang of ['en', 'vi', 'es', 'pt-BR', 'de', 'ru', 'zh-CN']) {
  const src = fs.readFileSync(path.join(localeDir, `${lang}.js`), 'utf8');
  const first = new Map();          // key -> first value
  const conflicting = new Set();    // same key, DIFFERENT value (a real bug)
  const redundant = new Set();      // same key, SAME value (harmless junk)
  for (const m of src.matchAll(/'([\w.]+)'\s*:\s*'((?:[^'\\]|\\.)*)'/g)) {
    const k = m[1], v = m[2];
    if (!first.has(k)) first.set(k, v);
    else if (first.get(k) !== v) conflicting.add(k);
    else redundant.add(k);
  }
  if (conflicting.size) { dupFail++; console.log(lang, 'CONFLICTING duplicate keys (different value):', [...conflicting].join(',')); }
  if (redundant.size) { dupWarn++; console.log(lang, 'redundant duplicate keys (same value, harmless):', redundant.size); }
}
console.log(dupFail ? `CONFLICTING duplicates in ${dupFail} locale file(s)` : (dupWarn ? `no conflicting duplicates (${dupWarn} locale file(s) have harmless same-value repeats)` : 'no duplicate keys in any locale'));

// --- EXTRA keys: a locale key that en does not define (dead/typo'd translation) ---
let extraFail = 0;
for (const c of Object.keys(window.LOCALES)) {
  if (c === 'en') continue;
  const extra = Object.keys(window.LOCALES[c]).filter(k => !(k in window.LOCALES.en));
  if (extra.length) { extraFail++; console.log(c, 'extra keys (not in en):', extra.join(',')); }
}
console.log(extraFail ? `extra keys in ${extraFail} locale(s)` : 'no extra keys in any locale');

// The missing-lists + duplicate/extra checks are the assertions.
const fail = missing.length + jsMissing.length + dupFail + extraFail;
process.exit(fail ? 1 : 0);
