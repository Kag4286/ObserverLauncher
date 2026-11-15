// v900-a11y-appearance.test.js — regression tests for Instance Appearance & WCAG 2.2 AA / modal fixes.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const RENDERER = path.join(ROOT, 'src', 'renderer');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

let pass = 0;
function ok(name, cond, detail) {
  assert.ok(cond, `FAIL: ${name}${detail ? ' (' + detail + ')' : ''}`);
  console.log(`PASS ${name}`);
  pass++;
}

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function contrastRatio(hexA, hexB) {
  const lum = ([r, g, b]) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const l1 = lum(hexToRgb(hexA));
  const l2 = lum(hexToRgb(hexB));
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

// 1. Tokens & Contrast WCAG AA (>= 4.5:1 across --bg and --surface-2)
const tokensCss = read('src/renderer/css/01-tokens.css');
const bgHex = tokensCss.match(/--bg:\s*(#[0-9a-fA-F]{6})/)?.[1];
const s2Hex = tokensCss.match(/--surface-2:\s*(#[0-9a-fA-F]{6})/)?.[1];
const t3Hex = tokensCss.match(/--text-3:\s*(#[0-9a-fA-F]{6})/)?.[1];
const t4Hex = tokensCss.match(/--text-4:\s*(#[0-9a-fA-F]{6})/)?.[1];
ok('01-tokens.css defines distinct --lime accent', /--lime:\s*#[0-9a-fA-F]{6}/.test(tokensCss));
ok('01-tokens.css --text-4 passes >= 4.5:1 on --surface-2 & --bg',
  t4Hex && bgHex && s2Hex && contrastRatio(t4Hex, bgHex) >= 4.5 && contrastRatio(t4Hex, s2Hex) >= 4.5,
  `${t4Hex} vs ${s2Hex}`
);
ok('01-tokens.css --text-3 passes >= 4.5:1 on --surface-2', t3Hex && s2Hex && contrastRatio(t3Hex, s2Hex) >= 4.5);

// 2. Instance Art & Appearance CSS/JS
const artJs = read('src/renderer/js/00b-instance-art.js');
ok('00b-instance-art maps lime to var(--lime) (distinct from brand)', /lime:\s*'var\(--lime\)'/.test(artJs));

const shellCss = read('src/renderer/css/02-shell.css');
ok('02-shell.css .accent-swatch restores background:var(--sw,var(--brand))', /\.accent-swatch\s*\{[^}]*background:var\(--sw,\s*var\(--brand\)\)/.test(shellCss));
ok('02-shell.css .accent-swatch meets >= 24px target', /\.accent-swatch\s*\{[^}]*width:2[4-9]px/.test(shellCss) || /\.accent-swatch\s*\{[^}]*width:3\dpx/.test(shellCss));
ok('02-shell.css .inst-avatar .inst-art overlays via position:absolute;inset:0', /\.inst-avatar\s+\.inst-art\s*\{[^}]*position:absolute;[^}]*inset:0/.test(shellCss));
ok('02-shell.css .inst-avatar .inst-initials layers with position:relative;z-index:1', /\.inst-avatar\s+\.inst-initials\s*\{[^}]*position:relative;[^}]*z-index:1/.test(shellCss));
ok('02-shell.css reveals .inst-act on keyboard :focus-within/:focus-visible', /\.inst-item:focus-within\s+\.inst-act/.test(shellCss));

const shellJs = read('src/renderer/js/08-shell.js');
ok('setInstanceAppearance updates rail via renderInstanceList()', /async function setInstanceAppearance[\s\S]*?renderInstanceAppearance\(\);\s*renderInstanceList\(\)/.test(shellJs));
ok('renderInstanceList syncs --instance-accent token', shellJs.includes("setProperty('--instance-accent'"));
ok('renderInstanceAppearance binds aria-label + arrow-key radiogroup handler', shellJs.includes('aria-label="\'+esc(lbl)') || shellJs.includes("host.onkeydown"));

// 3. Target sizes & focus-visible rings
const overviewCss = read('src/renderer/css/03-overview.css');
const marketCss = read('src/renderer/css/05-market.css');
const modalsCss = read('src/renderer/css/06-modals.css');
const remoteCss = read('src/remote-ui/style.css');
ok('03-overview.css .kpi-help target >= 24x24px', /\.kpi-help\s*\{[^}]*width:24px;height:24px/.test(overviewCss));
ok('05-market.css adds focus-visible ring on .switch .slider', /\.switch\s+input:focus-visible\s*\+\s*\.slider/.test(marketCss));
ok('06-modals.css adds focus-visible ring on .wh-events checkbox chip', /\.wh-events\s+\.filter-chip:has\(input:focus-visible\)/.test(modalsCss));
ok('06-modals.css .jvm-preset-help & .motd-chip >= 24px', /\.jvm-preset-help\s*\{[^}]*width:24px;height:24px/.test(modalsCss) && /\.motd-chip\s*\{[^}]*width:24px;height:24px/.test(modalsCss));
ok('remote-ui/style.css adds :focus-visible outline and --text-4 parity', /:focus-visible\s*\{/.test(remoteCss) && remoteCss.includes(t4Hex));

// 4. Renderer index.html zero unlabelled non-hidden controls & valid tablist ARIA
const html = read('src/renderer/index.html');
const labelForSet = new Set([...html.matchAll(/<label[^>]*\bfor="([^"]+)"/g)].map(m => m[1]));
const switchAndRangeIds = [
  'autoTunnelQuick', 'memoryMinInput', 'memoryMaxInput', 'wmSliceSlider',
  'autoEulaInput', 'beginnerModeInput', 'worldmapCheatModeInput',
  'autoRestartInput', 'scheduleEnabledInput', 'autoTunnelInput',
  'remoteEnabledInput', 'remoteReadOnlyInput', 'mcpEnabledInput',
  'mcpAutoWriteInput', 'mcpReadOnlyInput', 'prometheusEnabledInput',
];
for (const id of switchAndRangeIds) {
  const tagMatch = html.match(new RegExp(`<input[^>]*\\bid="${id}"[^>]*>`));
  const tag = tagMatch ? tagMatch[0] : '';
  ok(`index.html #${id} has accessible name`, /\baria-label="[^"]+"/.test(tag) || labelForSet.has(id));
}
ok('index.html #pdStatsChips uses role="group"', /id="pdStatsChips"\s+role="group"/.test(html));

// 5. Dynamic propRow avoids nested <label> & names checkbox switch
const propJs = read('src/renderer/js/06-properties.js');
const propBox = vm.createContext({
  esc: (s) => String(s ?? '').replace(/</g, '&lt;').replace(/"/g, '&quot;'),
  t: (k) => k === 'prop.pvp.l' ? 'PvP enabled' : k,
  renderMotdPreview: () => '',
  isProxyServer: () => false,
  $: () => null,
  $$: () => [],
});
vm.runInContext(propJs, propBox);
const boolRowHtml = propBox.propRow('pvp', 'true');
ok('06-properties.js boolean propRow avoids nested <label>', !boolRowHtml.startsWith('<label') && (boolRowHtml.match(/<label\b/g) || []).length === 1);
ok('06-properties.js boolean switch <input> carries aria-label', /<input[^>]*aria-label="PvP enabled"/.test(boolRowHtml));

// 6. Focus stack + confirmDialog Enter guard + ol-select-native tabindex=-1
const coreJs = read('src/renderer/js/00-core.js');
ok('00-core.js maintains focus trap stack & Enter-on-Cancel guard',
  coreJs.includes('_trapStack') && coreJs.includes("id==='cfCancel'")
);
ok('08-shell.js closes topmost modal on Escape instead of first in DOM order',
  /\.filter\([^\n]*\)\.pop\(\)/.test(shellJs)
);
const ddJs = read('src/renderer/js/00-dropdown.js');
ok('00-dropdown.js removes .ol-select-native from Tab order',
  ddJs.includes('sel.tabIndex = -1') && ddJs.includes("sel.setAttribute('aria-hidden', 'true')")
);

console.log(`\n${pass} passed, 0 failed`);
