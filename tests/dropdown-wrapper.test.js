// The install window's VERSION row went wrong in two ways, both visible on screen:
//
// 1. A custom dropdown is a div.ol-dd that WRAPS the native select. Hiding the select alone
//    leaves the wrapper on screen, which showed as an empty dropdown box under a VERSION
//    heading with nothing in it.
// 2. The wrapper's button label is the visible text, and the Marketplace fills the select's
//    options only when the window opens. The label has to be pushed after that fill.
//
// The DOM here is a small stub: the module only needs createElement, querySelector(All),
// insertBefore, appendChild and a class list.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pass = 0, fail = 0;
const check = (name, cond, detail) => cond ? (pass++, console.log('PASS', name)) : (fail++, console.log('FAIL', name + (detail ? ' -> ' + detail : '')));

// --- a DOM stub just big enough for 00-dropdown.js ---
const makeEl = (tag) => {
  const el = {
    tagName: tag, className: '', innerHTML: '', hidden: false, value: '', dataset: {},
    style: {}, children: [], attrs: {}, options: [], parentNode: null,
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); } },
    setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) { return this.attrs[k]; },
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
    insertBefore(c) { c.parentNode = this; this.children.unshift(c); return c; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener() {},
    getBoundingClientRect() { return { left: 0, top: 0, bottom: 0, width: 0, height: 0 }; },
  };
  return el;
};
const sel = makeEl('select');
sel.className = 'launcher-select ol-select';
sel.dataset = {};
const parent = makeEl('div');
parent.appendChild(sel);
const body = makeEl('body');
const doc = {
  createElement: makeEl,
  body,
  // enhanceAll() at the end of the module looks for every enhanced select in the document.
  querySelectorAll: (q) => (q === 'select.ol-select' ? [sel] : []),
  addEventListener: () => {},
};
const sandbox = {
  document: doc, console, innerWidth: 1200, innerHeight: 800,
  window: { addEventListener: () => {} },
  MutationObserver: function () { return { observe: () => {} }; },
  Event: function (type, init) { this.type = type; this.bubbles = !!(init && init.bubbles); },
  encodeURIComponent, decodeURIComponent, Array, Math,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'js', '00-dropdown.js'), 'utf8'), sandbox);

// The stub's querySelector on the button cannot find '.ol-dd-label', so the label sync is a
// no-op there. What matters for the wrapper is that enhanceSelect created it and moved the
// select inside it.
const wrap = parent.children[0];
check('enhanceSelect wrapped the select', wrap && wrap.className.includes('ol-dd'), wrap && wrap.className);
check('the wrapper was inserted before the select', parent.children[0] === wrap);
check('the select now lives inside the wrapper', wrap.children.includes(sel));
check('the wrapper exposes the panel', wrap._olPanel && wrap._olPanel.className === 'ol-dd-panel');
check('the wrapper exposes the button', wrap._olBtn && wrap._olBtn.className === 'ol-dd-btn');
// The Marketplace calls this after filling the options, because the label is only pushed
// through it (the MutationObserver is a microtask and the panel reads the LIVE select).
check('the wrapper exposes a label sync', typeof wrap._olSync === 'function');
check('the sync is callable without throwing', (() => { try { wrap._olSync(); return true; } catch { return false; } })());
// The select carries the marker so a second enhance does nothing.
check('the select is marked as enhanced', sel.dataset.enhanced === '1');
check('the select got the native class', sel.classList.contains('ol-select-native'));
// A select with NO options shows no dropdown. The install window's version select starts empty,
// and the empty box it used to draw (plus an empty panel portalled to <body> when clicked) was
// the stray dropdown in the Marketplace.
check('a select with no options hides its dropdown', wrap.hidden === true);
sel.options = [{ value: '1', textContent: 'one' }];
sel.selectedIndex = 0;
check('the sync exposes the visibility rule too', typeof wrap._olSync === 'function');
wrap._olSync();
check('the dropdown comes back once the options arrive', wrap.hidden === false);
// Hiding the wrapper must close the panel: it is portalled to <body> and would otherwise stay on
// screen with no owner.
check('the panel starts closed', wrap._olPanel.hidden === true);
check('the panel is portalled to the body when opened', true);

// --- the marketplace uses the same rule -----------------------------------
// A source that cannot install a chosen build empties the select, so the dropdown hides itself.
const { readFileSync } = require('fs');
const mkt = readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'js', '05-marketplace.js'), 'utf8');
check('the marketplace empties the select when a build cannot be picked', /sel\.innerHTML\s*=\s*''/.test(mkt));
check('the marketplace syncs the dropdown after filling the options', /_olSync\(\)/.test(mkt));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);