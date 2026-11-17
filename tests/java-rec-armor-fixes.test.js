// Regression tests for:
// 1. Java Runtime Picker alignment, Edit->Apply non-auto-save flow, and refreshUI->markSettingsSaved ordering
// 2. Marketplace Install Modal Recommended badge exclusion when no compatible MC build exists (e.g. 26.1 on 1.21.1 Fabric)
// 3. Player Inspector modded armor compatibility (/armour/, nested <mat>/layer_1.png, models/equipment/*.json, extended suffixes),
//    custom-geo/nonstandard-uv/unsupported status notices, and #pd3dScope caption
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const vm = require('vm');

const { ModsIndex } = require('../src/main/mods-index.js');
const { encodePng } = require('../src/main/custom-item-renders.js');
const textures = require('../src/main/textures.js');

let pass = 0, fail = 0;
function ck(name, cond) {
  if (cond) { pass++; console.log('PASS', name); }
  else { fail++; console.error('FAIL', name); }
}

function makeZip(files) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, data] of files) {
    const nameBuf = Buffer.from(name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const lp = Buffer.concat(locals), cp = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cp.length, 12);
  eocd.writeUInt32LE(lp.length, 16);
  return Buffer.concat([lp, cp, eocd]);
}

function solidPng(w, h, r = 64, g = 180, b = 120, a = 255) {
  const rgba = Buffer.alloc(w * h * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b; rgba[i + 3] = a;
  }
  return encodePng(w, h, rgba);
}

function makeEl(id, extra = {}) {
  const listeners = {};
  const cls = new Set();
  return {
    id,
    value: '',
    innerHTML: '',
    textContent: '',
    hidden: false,
    disabled: false,
    dataset: {},
    options: [],
    style: {},
    children: [],
    classList: {
      add: (...c) => c.forEach(x => cls.add(x)),
      remove: (...c) => c.forEach(x => cls.delete(x)),
      toggle: (c, force) => { if (force === undefined) { cls.has(c) ? cls.delete(c) : cls.add(c); } else if (force) cls.add(c); else cls.delete(c); },
      contains: c => cls.has(c),
    },
    addEventListener(ev, fn) { (listeners[ev] ||= []).push(fn); },
    dispatchEvent(ev) { (listeners[ev.type] || []).forEach(fn => fn(ev)); },
    setAttribute() {},
    getAttribute() { return null; },
    appendChild(c) { this.children.push(c); return c; },
    querySelectorAll() { return []; },
    querySelector() { return null; },
    closest() { return null; },
    ...extra,
  };
}

(async () => {
  // =========================================================================
  // 1. Java Runtime Picker + Edit -> Apply flow (07-overview.js & 08-shell.js)
  // =========================================================================
  {
    const overviewCode = fs.readFileSync(path.join(__dirname, '../src/renderer/js/07-overview.js'), 'utf8');
    const shellCode = fs.readFileSync(path.join(__dirname, '../src/renderer/js/08-shell.js'), 'utf8');

    let syncCalls = 0;
    let saveCalls = 0;
    const ddWrapper = { _olSync() { syncCalls++; } };

    const javaPickSelect = makeEl('javaPickSelect', {
      closest(sel) { return sel === '.ol-dd' ? ddWrapper : null; },
    });
    const els = {
      '#javaPickSelect': javaPickSelect,
      '#javaPathInput': makeEl('javaPathInput', { value: '' }),
      '#javaNotice': makeEl('javaNotice'),
      '#javaNoticeText': makeEl('javaNoticeText'),
      '#javaFixBtn': makeEl('javaFixBtn'),
      '#jvmPreview': makeEl('jvmPreview'),
      '#saveSettings': makeEl('saveSettings'),
      '#applyDirtyHint': makeEl('applyDirtyHint'),
      '#jvmArgsInput': makeEl('jvmArgsInput', { value: '' }),
      '#memoryMinInput': makeEl('memoryMinInput', { value: '2' }),
      '#memoryMaxInput': makeEl('memoryMaxInput', { value: '6' }),
    };

    const settingsSection = makeEl('settings', {
      closest: s => (s === '#settings' ? settingsSection : null),
    });
    els['#settings'] = settingsSection;

    const sandbox = {
      state: {
        settings: { javaPath: '', memoryMin: 2, memoryMax: 6 },
        files: { target: { mc: '1.21.1', software: 'fabric' }, jar: 'fabric-server-mc.1.21.1-loader.0.20.1.jar' },
        java: { ok: true, major: 25, version: '25.0.1', path: 'C:\\Program Files\\Java\\jdk-25\\bin\\java.exe' },
      },
      settingsDirty: false,
      _settingsBaseline: null,
      getSettings: () => ({ javaPath: els['#javaPathInput'].value, memoryMin: 2, memoryMax: 6 }),
      $: s => (els[s] ||= makeEl(s)),
      $$: () => [],
      t: (k, vars) => {
        if (!vars) return k;
        return k + ':' + JSON.stringify(vars);
      },
      esc: s => String(s || '').replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c])),
      toast() {},
      refreshUI() {},
      setHtml(el, html) { if (el) el.innerHTML = html; },
      parseMcVer: v => {
        const m = String(v || '').match(/(\d+)\.(\d+)(?:\.(\d+))?/);
        return m ? { major: +m[1], minor: +m[2], patch: +(m[3] || 0) } : null;
      },
      requiredJava: () => 21,
      requiredJavaOf: () => 21,
      javaMajorOf: v => {
        const m = String(v || '').match(/^(?:1\.(\d+)|(\d+))/);
        return m ? +(m[1] || m[2]) : null;
      },
      document: {
        createElement(tag) {
          return {
            tagName: tag.toUpperCase(),
            value: '',
            textContent: '',
            disabled: false,
            style: {},
            setAttribute() {},
          };
        },
        querySelectorAll: () => [],
        querySelector: () => null,
        addEventListener() {},
      },
      window: {
        observer: {
          async javaList() {
            return {
              ok: true,
              runtimes: [
                { major: 8, version: '1.8.0_504', path: 'C:\\Program Files\\Java\\jre1.8.0_504\\bin\\java.exe' },
                { major: 21, version: '21.0.5', path: 'C:\\Users\\PC\\.observer\\java\\jdk-21\\bin\\java.exe' },
                { major: 25, version: '25.0.1', path: 'C:\\Program Files\\Java\\jdk-25\\bin\\java.exe' },
              ],
            };
          },
          async saveSettings(next) { saveCalls++; return { ok: true, settings: next }; },
        },
        addEventListener() {},
      },
    };
    vm.createContext(sandbox);
    vm.runInContext(overviewCode, sandbox);

    sandbox.markSettingsSaved();
    await sandbox.populateJavaPicker(sandbox.state.java);

    const optValues = [...javaPickSelect.innerHTML.matchAll(/<option value="([^"]*)"/g)].map(m => m[1]);
    ck('populateJavaPicker includes Auto-detect option (empty value) first', optValues[0] === '');
    ck('populateJavaPicker selects Auto-detect instead of Java 8 when javaPath is empty', javaPickSelect.value === '');
    ck('populateJavaPicker calls _olSync on wrapper after async load', syncCalls >= 1);

    // Simulate user choosing Java 21 in the dropdown
    javaPickSelect.value = 'C:\\Users\\PC\\.observer\\java\\jdk-21\\bin\\java.exe';
    javaPickSelect.onchange();

    ck('dropdown selection copies Java 21 path into #javaPathInput', els['#javaPathInput'].value === 'C:\\Users\\PC\\.observer\\java\\jdk-21\\bin\\java.exe');
    ck('dropdown selection does NOT auto-call saveSettings without Apply', saveCalls === 0);
    ck('dropdown selection updates #javaNotice with selected Java 21 compatibility', els['#javaNotice'].textContent.includes('21'));
    ck('dropdown selection updates #jvmPreview live', els['#jvmPreview'].textContent.includes('jdk-21\\bin\\java.exe'));

    // Also verify typing an unknown custom path shows pending notice
    els['#javaPathInput'].value = 'D:\\Custom\\jdk-21\\bin\\java.exe';
    els['#javaPathInput'].dispatchEvent({ type: 'input' });
    ck('typing custom unknown path updates #javaNotice to pending custom path message', els['#javaNotice'].textContent.includes('set.javaPendingPath'));

    // Simulate Edit -> Apply dirty tracking on #settings
    settingsSection.dispatchEvent({ type: 'change', target: { closest: s => (s === '#settings' ? settingsSection : null) } });
    ck('selecting Java runtime marks settingsDirty true and highlights #saveSettings', els['#saveSettings'].classList.contains('dirty') === true);

    // Switching to custom/unmatched path in input shows custom option on repopulate
    sandbox.state.settings.javaPath = 'D:\\Custom\\jdk-21\\bin\\java.exe';
    await sandbox.populateJavaPicker(sandbox.state.java);
    ck('unmatched saved custom path adds custom option instead of falling back to Java 8', javaPickSelect.value === 'D:\\Custom\\jdk-21\\bin\\java.exe');

    // Contract checks on 08-shell.js saveSettings & javaAutoInstall ordering
    const saveIdx = shellCode.indexOf("$('#saveSettings').onclick");
    const saveBlock = shellCode.slice(saveIdx, saveIdx + 3600);
    ck('08-shell.js #saveSettings runs refreshUI() before markSettingsSaved()', /refreshUI\(\);\s*markSettingsSaved\(\)/.test(saveBlock));
    ck('08-shell.js #javaAutoInstall invalidates _javaRuntimes cache before refreshUI() and markSettingsSaved()',
      /_javaRuntimes\s*=\s*null[\s\S]{0,120}refreshUI\(\)[\s\S]{0,40}markSettingsSaved\(\)/.test(shellCode));
  }

  // =========================================================================
  // 2. Marketplace Install Modal Recommended badge exclusion (05-marketplace.js)
  // =========================================================================
  {
    const mktCode = fs.readFileSync(path.join(__dirname, '../src/renderer/js/05-marketplace.js'), 'utf8');
    const verCards = makeEl('imVersionCards');
    const verSel = makeEl('imVersion');
    const mEls = {
      '#imVersionCards': verCards,
      '#imVersion': verSel,
      '#marketVersion': makeEl('marketVersion', { value: '1.21.1' }),
    };
    const sb = {
      state: {
        files: { target: { mc: '1.21.1', software: 'fabric', loader: 'fabric' } },
      },
      $: s => (mEls[s] ||= makeEl(s)),
      $$: () => [],
      t: k => k,
      esc: s => String(s || ''),
      setHtml(el, html) { if (el) el.innerHTML = html; },
      debounce: fn => fn,
      fmtNum: n => String(n),
      fmtDate: d => String(d || ''),
      window: { observer: { onMarketProgress() {}, onContentRolledBack() {} }, addEventListener() {} },
      document: { addEventListener() {}, activeElement: null, querySelector: () => null },
    };
    vm.createContext(sb);
    vm.runInContext(mktCode, sb);

    // Case A: Only 26.1 Fabric builds on 1.21.1 Fabric server -> NO Recommended tag
    vm.runInContext(`installState = {
      item: { id: 'mod-future', source: 'modrinth', kind: 'mod', title: 'FutureMod' },
      detail: {
        ok: true,
        versions: [
          { id: 'v261', name: '2.0.0', version: '2.0.0', versionType: 'release', gameVersions: ['26.1'], loaders: ['fabric'], downloads: 5000, published: '2026-10-01T00:00:00Z' },
          { id: 'v261a', name: '2.0.1-beta', version: '2.0.1-beta', versionType: 'beta', gameVersions: ['26.1'], loaders: ['fabric'], downloads: 1200, published: '2026-10-05T00:00:00Z' },
        ],
      },
      selectedId: null,
      selectedModpackFile: null,
      loaderFilterOn: true,
    }; imRenderVersionPicker();`, sb);

    ck('1.21.1 Fabric server does NOT mark 26.1 Fabric build as Recommended', !verCards.innerHTML.includes('im-vcard-badge rec') && !verCards.innerHTML.includes('im.recBadge'));
    ck('1.21.1 Fabric server marks 26.1 build with MC version warning pill', verCards.innerHTML.includes('im-vcard-loader warn') && verCards.innerHTML.includes('MC 26.1'));

    // Case B: Both 26.1 and 1.21.1 Fabric builds exist -> 1.21.1 gets Recommended tag & is selected, NOT 26.1
    verSel.value = '';
    vm.runInContext(`installState.detail.versions.push({
      id: 'v1211', name: '1.4.2', version: '1.4.2', versionType: 'release',
      gameVersions: ['1.21.1'], loaders: ['fabric'], downloads: 800, published: '2025-02-01T00:00:00Z',
    });
    installState.versionId = null;
    imRenderVersionPicker();`, sb);

    ck('Compatible 1.21.1 Fabric build is selected as default over newer 26.1 build',
      /<option value="v1211"[^>]*selected>/.test(verSel.innerHTML) &&
      /<button[^>]*class="im-vcard selected"[^>]*data-vid="v1211"/.test(verCards.innerHTML));
    const recRowMatch = verCards.innerHTML.match(/data-vid="([^"]+)"[\s\S]{0,400}im-vcard-badge rec/);
    ck('Recommended badge attaches strictly to 1.21.1 build (v1211)', !!recRowMatch && recRowMatch[1] === 'v1211');
  }

  // =========================================================================
  // 3. Player Inspector Modded Armor compatibility + notices + 3D scope
  // =========================================================================
  {
    const tmpSrv = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-armor-fixes-'));
    const modsDir = path.join(tmpSrv, 'mods');
    fs.mkdirSync(modsDir, { recursive: true });
    const stdPng64x32 = solidPng(64, 32, 80, 140, 220);
    const nonStdPng128x128 = solidPng(128, 128, 220, 120, 60);

    // Mod A: British /armour/ folder
    fs.writeFileSync(path.join(modsDir, 'britmod.jar'), makeZip([
      ['assets/britmod/textures/models/armour/mythril_layer_1.png', stdPng64x32],
    ]));
    // Mod B: Nested subfolder <mat>/layer_1.png
    fs.writeFileSync(path.join(modsDir, 'nestmod.jar'), makeZip([
      ['assets/nestmod/textures/models/armor/titan/layer_1.png', stdPng64x32],
    ]));
    // Mod C: 1.21.2-1.21.3 models/equipment/<mat>.json + non-standard 128x128 UV PNG
    fs.writeFileSync(path.join(modsDir, 'eqmod.jar'), makeZip([
      ['assets/eqmod/models/equipment/runic.json', Buffer.from(JSON.stringify({ layers: { humanoid: [{ texture: 'eqmod:runic' }] } }))],
      ['assets/eqmod/textures/entity/equipment/humanoid/runic.png', nonStdPng128x128],
    ]));
    // Mod D: GeckoLib .geo.json + armor PNG (still resolves texture + flags custom-geo)
    fs.writeFileSync(path.join(modsDir, 'geomod.jar'), makeZip([
      ['assets/geomod/geo/dragon.geo.json', Buffer.from('{"format_version":"1.12.0"}')],
      ['assets/geomod/textures/armor/dragon_layer_1.png', stdPng64x32],
    ]));

    const idx = new ModsIndex();
    idx.setModsDir(modsDir);
    idx.refresh();

    const rBrit = idx.readArmorTextureInfo('britmod', 'mythril', 1);
    ck('ModsIndex resolves British /armour/ path cleanly without warnings', !!rBrit.buffer && !rBrit.isCustomGeo && !rBrit.nonStandardUv);

    const rNest = idx.readArmorTextureInfo('nestmod', 'titan', 1);
    ck('ModsIndex resolves nested /armor/<mat>/layer_1.png cleanly', !!rNest.buffer && !rNest.nonStandardUv);

    const rEq = idx.readArmorTextureInfo('eqmod', 'runic', 1);
    ck('ModsIndex resolves 1.21.2-1.21.3 models/equipment/<mat>.json and detects nonStandardUv on 128x128 PNG',
      !!rEq.buffer && rEq.nonStandardUv === true);

    const rGeo = idx.readArmorTextureInfo('geomod', 'dragon', 1);
    ck('ModsIndex detects isCustomGeo even when dragon_layer_1.png exists', !!rGeo.buffer && rGeo.isCustomGeo === true);

    textures.init({ serverNames: () => [], modsDir: () => modsDir });
    const respBrit = textures.handle({ url: 'tex://auto/armormod/britmod~mythril.png' });
    const respEq = textures.handle({ url: 'tex://auto/armormod/eqmod~runic.png' });
    const respGeo = textures.handle({ url: 'tex://auto/armormod/geomod~dragon.png' });
    textures.init({ serverNames: () => [], modsDir: () => null });

    ck('textures.handle omits warning header for standard 64x32 British armor', respBrit.status === 200 && !respBrit.headers.get('x-observer-armor-status'));
    ck('textures.handle sets x-observer-armor-status=nonstandard-uv for 128x128 armor PNG', respEq.status === 200 && respEq.headers.get('x-observer-armor-status') === 'nonstandard-uv');
    ck('textures.handle sets x-observer-armor-status=custom-geo for GeoLib mod with texture', respGeo.status === 200 && respGeo.headers.get('x-observer-armor-status') === 'custom-geo');

    // Extended suffix stripping + unsupported wearable detection in 03b-player-3d.js
    const p3dCode = fs.readFileSync(path.join(__dirname, '../src/renderer/js/03b-player-3d.js'), 'utf8');
    const p3dSb = { window: {} };
    vm.createContext(p3dSb);
    vm.runInContext(p3dCode, p3dSb);

    ck('getArmorMaterial strips extended modded suffixes (_helm, _visor, _hauberk, _chausses, _sabatons)',
      p3dSb.getArmorMaterial('mythrilmod:mythril_helm')?.mat === 'mythril' &&
      p3dSb.getArmorMaterial('techmod:cyber_visor')?.mat === 'cyber' &&
      p3dSb.getArmorMaterial('medieval:iron_hauberk')?.mat === 'iron' &&
      p3dSb.getArmorMaterial('knight:steel_chausses')?.mat === 'steel' &&
      p3dSb.getArmorMaterial('knight:steel_sabatons')?.mat === 'steel');

    ck('getArmorMaterial returns null for non-standard wearables like elytra so unsupported status fires',
      p3dSb.getArmorMaterial({ id: 'minecraft:elytra' }) === null);

    // HTML/CSS/i18n checks for Player Inspector 3D scope & multi-line notice
    const htmlCode = fs.readFileSync(path.join(__dirname, '../src/renderer/index.html'), 'utf8');
    const pCss = fs.readFileSync(path.join(__dirname, '../src/renderer/css/04-players.css'), 'utf8');
    const playersJs = fs.readFileSync(path.join(__dirname, '../src/renderer/js/03-players.js'), 'utf8');
    ck('index.html includes #pd3dScope caption under Player 3D preview', htmlCode.includes('id="pd3dScope"') && htmlCode.includes('data-i18n="pd.previewScope"'));
    ck('04-players.css wraps .pd-3d-notice across lines instead of ellipsis truncation', /\.pd-3d-notice\{[^}]*white-space:normal/.test(pCss) && /\.pd-3d-scope\{/.test(pCss));
    ck('03-players.js tracks slot-level armorIssues including unsupported status without gating on hasModArmor',
      playersJs.includes('armorIssues=new Map') && playersJs.includes("pd.armorUnsupportedSlots"));

    try { fs.rmSync(tmpSrv, { recursive: true, force: true }); } catch {}
  }

  console.log(`\njava-rec-armor-fixes: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
