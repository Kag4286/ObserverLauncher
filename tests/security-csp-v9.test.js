// security-csp-v9.test.js — regression tests for Workstream C XSS, CSP & v9.0.0 DOM invariants.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const RENDERER_DIR = path.join(ROOT, 'src', 'renderer');
let pass = 0;
function ok(name, cond) {
  assert(cond, `FAIL: ${name}`);
  console.log(`PASS ${name}`);
  pass++;
}

// 1. Zero inline DOM event attributes (onclick=, onerror=, etc.) in renderer HTML & JS templates
const html = fs.readFileSync(path.join(RENDERER_DIR, 'index.html'), 'utf8');
const INLINE_HANDLER_RE = /<[a-z][^>]*\son(?:click|error|load|change|input|submit|mouseover|mouseout|keydown|keyup|focus|blur)\s*=/i;
ok('index.html has zero inline event handler attributes', !INLINE_HANDLER_RE.test(html));

const jsFiles = fs.readdirSync(path.join(RENDERER_DIR, 'js')).filter(f => f.endsWith('.js')).sort();
const inlineJsHits = [];
for (const f of jsFiles) {
  const src = fs.readFileSync(path.join(RENDERER_DIR, 'js', f), 'utf8');
  if (INLINE_HANDLER_RE.test(src)) inlineJsHits.push(f);
}
ok('renderer JS templates have zero inline event handler attributes', inlineJsHits.length === 0);

// 2. Tooltip module: zero innerHTML, zero HTML-entity unescaping, safe textContent DOM construction
const tipSrc = fs.readFileSync(path.join(RENDERER_DIR, 'js', '00b-tooltip.js'), 'utf8');
ok('00b-tooltip.js has no innerHTML assignments', !/\.innerHTML\s*=/.test(tipSrc));
ok('00b-tooltip.js removes entity unescape chain', !tipSrc.includes('.replace(/&lt;/g'));

{
  function makeEl(tag) {
    const el = {
      tagName: String(tag).toUpperCase(),
      className: '',
      _text: '',
      children: [],
      attrs: {},
      style: {},
      classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); } },
      appendChild(c) { this.children.push(c); return c; },
      setAttribute(k, v) { this.attrs[k] = String(v); },
      getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
      getBoundingClientRect() { return { left: 10, right: 50, top: 10, bottom: 50, width: 40, height: 40 }; },
      closest(sel) {
        const parts = sel.split(',');
        for (const p of parts) {
          const m = p.match(/^\[([a-z0-9-]+)\]$/i);
          if (m && this.getAttribute(m[1]) !== null) return this;
        }
        return null;
      },
      get textContent() { return this._text; },
      set textContent(v) { this._text = String(v); if (this._text === '') this.children = []; },
    };
    Object.defineProperty(el, 'innerHTML', {
      set() { throw new Error('innerHTML must never be written by tooltip'); },
    });
    return el;
  }

  let createdTip = null;
  let listeners = {};
  const ctx = vm.createContext({
    setTimeout,
    clearTimeout,
    document: {
      createElement(t) {
        const el = makeEl(t);
        if (t === 'div' && !createdTip) createdTip = el;
        return el;
      },
      body: { appendChild(el) { createdTip = el; } },
      addEventListener(ev, fn) { listeners[ev] = fn; },
    },
    window: { innerWidth: 1280, innerHeight: 800, addEventListener() {} },
  });
  vm.runInContext(tipSrc, ctx);

  // Simulate immediate timeout or inspect rendered nodes by triggering mouseover with 0ms? No, override setTimeout to run immediately in a second context:
  listeners = {};
  createdTip = null;
  const syncCtx = vm.createContext({
    setTimeout(fn) { fn(); return 1; },
    clearTimeout() {},
    document: {
      createElement(t) { return makeEl(t); },
      body: { appendChild(el) { createdTip = el; } },
      addEventListener(ev, fn) { listeners[ev] = fn; },
    },
    window: { innerWidth: 1280, innerHeight: 800, addEventListener() {} },
  });
  vm.runInContext(tipSrc, syncCtx);

  const anchor = makeEl('div');
  const payload = {
    title: '<img src=https://evil.example/leak onerror=alert(1)>',
    sub: 'Diamond Sword',
    enchs: ['✨ Sharpness V'],
    dur: { remaining: 100, max: 1561, pct: 6, col: 'var(--success)' },
    count: 1,
    id: 'minecraft:diamond_sword',
  };
  anchor.setAttribute('data-tip-spec', JSON.stringify(payload));
  listeners.mouseover({ target: anchor });

  ok('tooltip renders structured children without innerHTML', createdTip && createdTip.children.length === 5);
  ok('tooltip keeps malicious title as literal textContent', createdTip.children[0].textContent === payload.title);
  ok('tooltip whitelists durability CSS color safely', createdTip.children[3].style.color === 'var(--success)');

  // Rejected unsafe CSS color injection
  const badAnchor = makeEl('div');
  badAnchor.setAttribute('data-tip-spec', JSON.stringify({ title: 'x', dur: { remaining: 1, max: 2, pct: 50, col: 'red;background:url(https://evil)' } }));
  listeners.mouseover({ target: badAnchor });
  ok('tooltip rejects non-token/hex durability color', !createdTip.children[1].style.color);

  // Legacy data-tip-html fallback is rendered strictly via textContent
  const htmlAnchor = makeEl('div');
  htmlAnchor.setAttribute('data-tip-html', '<script>alert(1)</script>');
  listeners.mouseover({ target: htmlAnchor });
  ok('legacy data-tip-html renders as plain textContent', createdTip.children.length === 0 && createdTip.textContent === '<script>alert(1)</script>');
}

// 3. v9.0.0 GUI & Selector regressions fixed
const playersSrc = fs.readFileSync(path.join(RENDERER_DIR, 'js', '03-players.js'), 'utf8');
ok('03-players.js no longer emits data-tip-html', !playersSrc.includes('data-tip-html'));
ok('03-players.js targets .pd-stage-overview instead of missing #pdStageOverview', !playersSrc.includes('#pdStageOverview') && playersSrc.includes('.pd-stage-overview'));
ok('03-players.js escapes SVG initial in playerInitialsAvatar', playersSrc.includes('${esc(initial)}'));

const contentSrc = fs.readFileSync(path.join(RENDERER_DIR, 'js', '01-content.js'), 'utf8');
ok('01-content.js targets #fbSearch instead of missing #fbFilter', !contentSrc.includes('#fbFilter') && contentSrc.includes('#fbSearch'));

const shellSrc = fs.readFileSync(path.join(RENDERER_DIR, 'js', '08-shell.js'), 'utf8');
ok('08-shell.js never overwrites #metricStatus class with TPS class', !shellSrc.includes("$('#metricStatus')") && !shellSrc.includes('heroTps'));
ok('08-shell.js no longer depends on removed #heroUptime', !shellSrc.includes('heroUptime'));
ok('08-shell.js updater does not assign innerHTML', !/onUpdate(?:Available|Downloaded)\([^\n]*\.innerHTML/.test(shellSrc));

const motionCss = fs.readFileSync(path.join(RENDERER_DIR, 'css', '08-motion.css'), 'utf8');
ok('08-motion.css includes @starting-style for details[open]::details-content', /@starting-style\s*\{\s*details\[open\]::details-content/.test(motionCss));

console.log(`\n${pass} passed, 0 failed`);
