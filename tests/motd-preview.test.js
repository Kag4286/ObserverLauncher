// v6.0.0 G1: renderMotdPreview is a pure renderer helper in 00-core.js. Runs the file in a VM with
// a DOM stub, then checks colour/format codes, reset, unknown-code literalness, and XSS safety.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0;
function ok(name, cond) { assert(cond, `FAIL: ${name}`); console.log(`PASS ${name}`); passed++; }

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'js', '00-core.js'), 'utf8');
const noop = () => {};
const sandbox = {
  document: { querySelector: () => null, querySelectorAll: () => [], addEventListener: noop },
  window: { addEventListener: noop, LOCALES: { en: {} } },
  navigator: { clipboard: { writeText: async () => {} } },
  requestAnimationFrame: () => 0,
  matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop, addListener: noop, removeListener: noop }),
  setTimeout, clearTimeout, console,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
const { renderMotdPreview } = sandbox;

ok('helper exists', typeof renderMotdPreview === 'function');
ok('empty -> empty', renderMotdPreview('') === '');
ok('plain text -> same', renderMotdPreview('Hello') === 'Hello');
ok('color code wraps in a span', /<span style="color:#55FF55">A<\/span>/.test(renderMotdPreview('\u00a7aA')));
ok('bold code', /font-weight:700/.test(renderMotdPreview('\u00a7lB')));
ok('italic code', /font-style:italic/.test(renderMotdPreview('\u00a7oI')));
ok('reset clears color', (() => { const h = renderMotdPreview('\u00a7aA\u00a7rB'); return /<span style="color:#55FF55">A<\/span>B/.test(h); })());
ok('new color replaces old', (() => { const h = renderMotdPreview('\u00a7aA\u00a7cC'); return h.includes('#55FF55') && h.includes('#FF5555') && !/<span[^>]*>A<\/span>C<\/span>/.test(h); })());
ok('obfuscated code dropped, text kept', renderMotdPreview('\u00a7kHi').includes('Hi'));
ok('unknown code shown literally (escaped)', renderMotdPreview('\u00a7zZ').includes('\u00a7z'));
// XSS safety: a script tag in the motd is escaped, never executed as markup
ok('escapes script tag', renderMotdPreview('<script>alert(1)</script>').includes('&lt;script&gt;') && !renderMotdPreview('<b>x</b>').includes('<b>'));
ok('color span still works with escaped text', /&lt;b&gt;/.test(renderMotdPreview('\u00a7a<b>')));

console.log(`\n${passed} passed, 0 failed`);
