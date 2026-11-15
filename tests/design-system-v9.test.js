// design-system-v9.test.js — enforces v9.0.0 Architectural Design System & Motion 2.0 invariants.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CSS_DIR = path.join(ROOT, 'src', 'renderer', 'css');
const REMOTE_CSS = path.join(ROOT, 'src', 'remote-ui', 'style.css');
const INDEX_HTML = path.join(ROOT, 'src', 'renderer', 'index.html');
const DESIGN_MD = path.join(ROOT, 'DESIGN.md');

const stripComments = s => s.replace(/\/\*[\s\S]*?\*\//g, '');
const cssFiles = fs.readdirSync(CSS_DIR).filter(f => f.endsWith('.css')).sort();

// 1. Consolidated stylesheets deleted & unlinked
assert.ok(!fs.existsSync(path.join(CSS_DIR, '07-polish.css')), '07-polish.css must be deleted');
assert.ok(!fs.existsSync(path.join(CSS_DIR, '09-pulse.css')), '09-pulse.css must be deleted');

const html = fs.readFileSync(INDEX_HTML, 'utf8');
assert.ok(!html.includes('07-polish.css'), 'index.html must not link 07-polish.css');
assert.ok(!html.includes('09-pulse.css'), 'index.html must not link 09-pulse.css');
assert.ok(!html.includes('id="signalField"'), 'index.html must remove ambient #signalField canvas');
assert.ok(html.includes('id="railGlide"'), 'index.html must include #railGlide indicator in #nav');
assert.ok(!/<section[^>]+id="welcomeCard"[^>]+class="[^"]*\bglass\b/.test(html), '#welcomeCard must not use .glass card styling');

// 2. Zero legacy CSS token references or declarations across desktop & remote CSS
const LEGACY_RE = /--(?:panel(?:-raised|-hover)?|bg-2|field-border|border-hover|accent(?:-dim|-ink|-weak)?|text-(?:muted|dim)|s[1-5]|fs-[a-z0-9-]+)(?![a-z0-9-])/g;
const legacyHits = [];
for (const f of cssFiles) {
  const clean = stripComments(fs.readFileSync(path.join(CSS_DIR, f), 'utf8'));
  const m = clean.match(LEGACY_RE);
  if (m) legacyHits.push(`${f}: ${[...new Set(m)].join(', ')}`);
}
const remoteClean = stripComments(fs.readFileSync(REMOTE_CSS, 'utf8'));
const remoteLegacy = remoteClean.match(LEGACY_RE);
if (remoteLegacy) legacyHits.push(`remote-ui/style.css: ${[...new Set(remoteLegacy)].join(', ')}`);
assert.strictEqual(legacyHits.length, 0, `Legacy tokens remain:\n${legacyHits.join('\n')}`);

// 3. Zero overshoot bounce cubic-bezier curves (y1 > 1 or y2 > 1)
const BEZIER_RE = /cubic-bezier\(\s*([-.\d]+)\s*,\s*([-.\d]+)\s*,\s*([-.\d]+)\s*,\s*([-.\d]+)\s*\)/g;
const bounceHits = [];
for (const [label, src] of [
  ...cssFiles.map(f => [f, stripComments(fs.readFileSync(path.join(CSS_DIR, f), 'utf8'))]),
  ['remote-ui/style.css', remoteClean]
]) {
  let match;
  while ((match = BEZIER_RE.exec(src)) !== null) {
    const y1 = parseFloat(match[2]);
    const y2 = parseFloat(match[4]);
    if (y1 > 1 || y2 > 1 || y1 < 0 || y2 < 0) {
      bounceHits.push(`${label}: ${match[0]}`);
    }
  }
}
assert.strictEqual(bounceHits.length, 0, `Overshoot/bounce curves forbidden:\n${bounceHits.join('\n')}`);

// 4. Motion 2.0 primitives present in 08-motion.css
const motionCss = stripComments(fs.readFileSync(path.join(CSS_DIR, '08-motion.css'), 'utf8'));
for (const needle of [
  '.rail-glide', '@starting-style', 'grid-template-rows:0fr', 'grid-template-rows:1fr',
  '.field-trace', '.tab-enter-fwd', 'clip-path:inset(',
  '@keyframes valPop', '@keyframes logSweep', '@keyframes enchPulse', '@keyframes chipIn', '@keyframes dirtyBeacon'
]) {
  assert.ok(motionCss.includes(needle), `08-motion.css missing Motion 2.0 primitive: ${needle}`);
}
assert.ok(/\.rail-glide\{[^}]*height:1px/.test(motionCss), '.rail-glide must keep height:1px for JS scaleY(h) sizing');

// 5. Critical selector regressions prevented
const ovCss = stripComments(fs.readFileSync(path.join(CSS_DIR, '03-overview.css'), 'utf8'));
assert.ok(!/(?:^|[},\s])#players\s*[{,]/.test(ovCss), '03-overview.css must not style #players directly (overrides .tab{display:none})');
assert.ok(ovCss.includes('#playerCount'), '03-overview.css must target #playerCount for KPI numeric alignment');
const ddCss = stripComments(fs.readFileSync(path.join(CSS_DIR, '10-dropdown.css'), 'utf8'));
for (const sel of ['.ol-dd-panel', '.ol-dd.ol-dd-wide', '.ol-dd-opt.active']) {
  assert.ok(ddCss.includes(sel), `10-dropdown.css missing required 00-dropdown.js selector: ${sel}`);
}

// 5. DESIGN.md documents v9.0.0 Architectural system
const designMd = fs.readFileSync(DESIGN_MD, 'utf8');
assert.ok(designMd.includes('#0C0D0F'), 'DESIGN.md must specify #0C0D0F background');
assert.ok(designMd.includes('#22C55E'), 'DESIGN.md must preserve #22C55E brand green');
assert.ok(designMd.includes('cubic-bezier'), 'DESIGN.md must document Motion 2.0 cubic-bezier curves');

console.log('PASS design-system-v9: zero legacy tokens, zero bounce curves, consolidated CSS & Motion 2.0 verified');
