// v8.0.2 Security, Modpack, World Clone & Offline Player Ops Regression Suite
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { isSafeArchiveEntry, isSafeDownloadUrl } = require('../src/main/validate');
const { offlineUUID } = require('../src/main/server-files');
const { cloneWorld } = require('../src/main/world-ops');

let passed = 0;
function ok(name, cond) {
  assert(cond, `FAIL: ${name}`);
  console.log(`PASS ${name}`);
  passed++;
}

(async () => {
  // 1. Hardened isSafeArchiveEntry — Windows drive-relative and control characters
  ok('isSafeArchiveEntry rejects Windows drive-relative C:evil.jar', isSafeArchiveEntry('C:evil.jar') === false);
  ok('isSafeArchiveEntry rejects Windows drive-relative d:mods/evil.jar', isSafeArchiveEntry('d:mods/evil.jar') === false);
  ok('isSafeArchiveEntry rejects NUL control char', isSafeArchiveEntry('mods/foo\x00.jar') === false);
  ok('isSafeArchiveEntry rejects newline control char', isSafeArchiveEntry('mods/foo\n.jar') === false);
  ok('isSafeArchiveEntry accepts normal relative path', isSafeArchiveEntry('mods/sodium-fabric.jar') === true);
  ok('isSafeArchiveEntry accepts server-overrides path', isSafeArchiveEntry('server-overrides/config/sodium.json') === true);

  // 2. offlineUUID deterministic generation & format
  const notchUuid = offlineUUID('Notch');
  ok('offlineUUID returns valid RFC-style UUID', /^[0-9a-f]{8}-[0-9a-f]{4}-3[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(notchUuid));
  ok('offlineUUID is deterministic', offlineUUID('Notch') === notchUuid);
  ok('offlineUUID differs per player', offlineUUID('Notch') !== offlineUUID('jeb_'));

  // 3. Offline player ops with null UUID (whitelistToggle / banToggle / opToggle)
  const tmpSrv = fs.mkdtempSync(path.join(os.tmpdir(), 'ol-v802-players-'));
  try {
    fs.writeFileSync(path.join(tmpSrv, 'server.properties'), 'level-name=world\n');
    const ctx = {
      currentServerPath: tmpSrv,
      serverStatus: 'stopped',
      serverProcess: null,
      send: () => {},
    };
    const players = require('../src/main/players');

    // Whitelist add with uuid: null
    let r = await players.whitelistToggle(ctx, { name: 'Steve_01', uuid: null, add: true });
    ok('offline whitelist add with null uuid succeeds', r.ok === true);
    let wl = JSON.parse(fs.readFileSync(path.join(tmpSrv, 'whitelist.json'), 'utf8'));
    ok('whitelist entry has valid offline UUID', wl.length === 1 && wl[0].name === 'Steve_01' && wl[0].uuid === offlineUUID('Steve_01'));

    // Whitelist remove with uuid: null (case-insensitive name match)
    r = await players.whitelistToggle(ctx, { name: 'steve_01', uuid: null, add: false });
    ok('offline whitelist remove with null uuid succeeds', r.ok === true);
    wl = JSON.parse(fs.readFileSync(path.join(tmpSrv, 'whitelist.json'), 'utf8'));
    ok('whitelist entry removed cleanly', wl.length === 0);

    // Ban add & remove with uuid: null
    r = await players.banToggle(ctx, { name: 'Griefer99', uuid: null, ban: true, reason: 'Test ban' });
    ok('offline ban with null uuid succeeds', r.ok === true);
    let bans = JSON.parse(fs.readFileSync(path.join(tmpSrv, 'banned-players.json'), 'utf8'));
    ok('banned-players entry has valid offline UUID', bans.length === 1 && bans[0].uuid === offlineUUID('Griefer99'));

    r = await players.banToggle(ctx, { name: 'griefer99', uuid: null, ban: false });
    ok('offline unban with null uuid succeeds', r.ok === true);
    bans = JSON.parse(fs.readFileSync(path.join(tmpSrv, 'banned-players.json'), 'utf8'));
    ok('banned-players entry removed cleanly', bans.length === 0);

    // OP add & remove with uuid: null
    r = await players.opToggle(ctx, { name: 'AdminUser', uuid: null, op: true });
    ok('offline op with null uuid succeeds', r.ok === true);
    let ops = JSON.parse(fs.readFileSync(path.join(tmpSrv, 'ops.json'), 'utf8'));
    ok('ops entry has valid offline UUID', ops.length === 1 && ops[0].uuid === offlineUUID('AdminUser'));

    r = await players.opToggle(ctx, { name: 'adminuser', uuid: null, op: false });
    ok('offline deop with null uuid succeeds', r.ok === true);
    ops = JSON.parse(fs.readFileSync(path.join(tmpSrv, 'ops.json'), 'utf8'));
    ok('ops entry removed cleanly', ops.length === 0);

    // readPlayer when currentServerPath is null should return clean error, not throw TypeError
    ctx.currentServerPath = null;
    const rp = await players.readPlayer(ctx, notchUuid, 'Notch');
    ok('readPlayer with null currentServerPath returns clean error', rp.ok === false && typeof rp.error === 'string');
  } finally {
    fs.rmSync(tmpSrv, { recursive: true, force: true });
  }

  // 4. cloneWorld — same-server cloning and cross-folder path traversal guard
  const tmpWorldSrv = fs.mkdtempSync(path.join(os.tmpdir(), 'ol-v802-worlds-'));
  const tmpOutside = fs.mkdtempSync(path.join(os.tmpdir(), 'ol-v802-outside-'));
  try {
    const srcWorld = path.join(tmpWorldSrv, 'world');
    fs.mkdirSync(srcWorld, { recursive: true });
    fs.writeFileSync(path.join(srcWorld, 'level.dat'), 'dummy-level-dat');
    fs.writeFileSync(path.join(srcWorld, 'session.lock'), 'locked');

    // Same-server clone (targetRoot omitted)
    const cw1 = await cloneWorld(tmpWorldSrv, 'world', undefined, 'world_copy');
    ok('cloneWorld same-server succeeds', cw1.ok === true && Array.isArray(cw1.files?.worlds));
    ok('cloned world has level.dat', fs.existsSync(path.join(tmpWorldSrv, 'world_copy', 'level.dat')));
    ok('cloned world excludes session.lock', !fs.existsSync(path.join(tmpWorldSrv, 'world_copy', 'session.lock')));

    // Cross-server clone to arbitrary unregistered directory must be rejected when requireRegisteredTarget is true
    const cw2 = await cloneWorld(tmpWorldSrv, 'world', tmpOutside, 'stolen_world', { requireRegisteredTarget: true });
    ok('cloneWorld rejects unregistered targetServerPath', cw2.ok === false && /Target server folder/i.test(cw2.error));
    ok('unregistered target folder was not written', !fs.existsSync(path.join(tmpOutside, 'stolen_world')));
  } finally {
    fs.rmSync(tmpWorldSrv, { recursive: true, force: true });
    fs.rmSync(tmpOutside, { recursive: true, force: true });
  }

  // 5. Redirect SSRF guard in http.js + Modpack & UI wiring checks
  const httpSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'http.js'), 'utf8');
  ok('http.js tracks enforcePublicRedirect across redirect hops', httpSrc.includes('enforcePublicRedirect') && httpSrc.includes('Refused: download redirected to a non-public or unsafe host.'));

  const marketUiSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'js', '05-marketplace.js'), 'utf8');
  ok('05-marketplace.js preserves modpack kind in openInstallModal', marketUiSrc.includes("if(item.kind==='modpack')"));
  ok('05-marketplace.js passes source to installMarketModpack', marketUiSrc.includes('source:item.source'));

  const marketSearchUiSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'js', '11-market.js'), 'utf8');
  ok('11-market.js preserves modpack and datapack kind during search card render', marketSearchUiSrc.includes("kind!=='modpack'&&kind!=='datapack'"));

  const modpacksSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'modpacks.js'), 'utf8');
  ok('modpacks.js supports server-overrides in .mrpack', modpacksSrc.includes("'server-overrides'"));
  ok('modpacks.js rolls back transaction when override confirmation is cancelled', modpacksSrc.includes('if (ovr && ovr.cancelled)') && modpacksSrc.includes('tx.rollback()'));
  ok('modpacks.js skips symlinks in copyOverridesWithConfirm', modpacksSrc.includes('e.isSymbolicLink()'));
  ok('modpacks.js supports CurseForge modpack in modpack:install-from-market', modpacksSrc.includes("source === 'curseforge'"));

  // 6. Accessibility (a11y) regression checks on index.html & 03-overview.css
  const htmlSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8');
  ok('a11y: #blockedModal has aria-labelledby="blockedModalTitle"', htmlSrc.includes('id="blockedModal"') && htmlSrc.includes('aria-labelledby="blockedModalTitle"') && htmlSrc.includes('id="blockedModalTitle"'));
  ok('a11y: Console tab heading is h2 (no h1->h3 skip)', htmlSrc.includes('<h2 data-i18n="con.title">Server console</h2>'));
  for (const id of [
    'connectLocal', 'pinggyAddr', 'ecShowEmpty', 'liveGameType', 'pdGameType',
    'edText', 'marketKind', 'marketVersion', 'marketSort', 'proxyServerName',
    'proxyServerAddr', 'javaPickSelect', 'languageSelect', 'motionLevelSelect',
    'autoBackupMinutesInput', 'backupRetentionInput', 'webhookFormatSelect',
    'updatePolicySelect', 'nswMemorySlider', 'pmInput',
    'ccbToggle', 'imToggleLoaderFilter', 'imInstallDeps',
  ]) {
    const re = new RegExp(`id="${id}"[^>]*aria-label=|aria-label="[^"]+"[^>]*id="${id}"`);
    ok(`a11y: #${id} has aria-label`, re.test(htmlSrc));
  }
  const ovCss = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'css', '03-overview.css'), 'utf8');
  ok('a11y: .step-chip enforces min-height >= 28px for WCAG 2.2 AA tap target', ovCss.includes('.step-chip{') && ovCss.includes('min-height:28px'));

  console.log(`\n${passed} passed, 0 failed`);
})();
