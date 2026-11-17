// website/app.js — Asymmetric Hero Deck, Manual-vs-Observer Workbench, Live 1:8 Nether Calculator, Filmstrip Lightbox, 7-locale i18n
(() => {
  document.documentElement.classList.add('has-motion-js');

  const SUPPORTED_LANGS = ['en', 'vi', 'es', 'pt-BR', 'de', 'ru', 'zh-CN'];
  const SHOTS = [
    { file: 'docs/screenshot-overview.png', tabKey: 'sc.0.tab', titleKey: 'sc.0.title', descKey: 'sc.0.desc', fbTab: 'Overview', fbTitle: 'Overview Control Deck', fbDesc: 'Multi-instance sidebar, live status, LAN sharing, Playit/Pinggy tunnels, and Geyser status.' },
    { file: 'docs/screenshot-wizard.png', tabKey: 'sc.1.tab', titleKey: 'sc.1.title', descKey: 'sc.1.desc', fbTab: 'Create Wizard', fbTitle: 'Multi-Engine Creation Wizard', fbDesc: 'Pick Vanilla, Paper, Fabric, Forge, NeoForge, Pumpkin (Rust), or Horizon (Rust) up to MC 26.3.' },
    { file: 'docs/screenshot-console.png', tabKey: 'sc.2.tab', titleKey: 'sc.2.title', descKey: 'sc.2.desc', fbTab: 'Console', fbTitle: 'Live Filtered Console', fbDesc: 'Filter INF/WRN/ERR/CMD lines, search logs, click player names, and send commands.' },
    { file: 'docs/screenshot-performance.png', tabKey: 'sc.3.tab', titleKey: 'sc.3.title', descKey: 'sc.3.desc', fbTab: 'Performance', fbTitle: 'TPS, MSPT, CPU & RAM Telemetry', fbDesc: 'Track live and historical tick health from 15 minutes up to 30 days.' },
    { file: 'docs/screenshot-content.png', tabKey: 'sc.4.tab', titleKey: 'sc.4.title', descKey: 'sc.4.desc', fbTab: 'Content (25/pg)', fbTitle: 'Paginated Content Manager', fbDesc: 'Browse large mod/plugin folders at 25 items per page with quick toggles and config editor.' },
    { file: 'docs/screenshot-marketplace.png', tabKey: 'sc.5.tab', titleKey: 'sc.5.title', descKey: 'sc.5.desc', fbTab: 'Marketplace', fbTitle: 'Modrinth & CurseForge Browser', fbDesc: 'Install plugins, mods, datapacks, and .mrpack bundles matching your server loader.' },
    { file: 'docs/screenshot-player-inspector.png', tabKey: 'sc.6.tab', titleKey: 'sc.6.title', descKey: 'sc.6.desc', fbTab: '3D Inspector', fbTitle: '3D Player Inspector', fbDesc: 'Interactive WebGL skin + armor preview supporting 1.21.5+ and 26.x equipment.' },
    { file: 'docs/screenshot-inventory.png', tabKey: 'sc.7.tab', titleKey: 'sc.7.title', descKey: 'sc.7.desc', fbTab: 'Inventory', fbTitle: '9x4 Inventory & Ender Chest', fbDesc: 'Search items, inspect enchantments with tooltips, and edit saved stats with backup.' },
    { file: 'docs/screenshot-worldmap.png', tabKey: 'sc.8.tab', titleKey: 'sc.8.title', descKey: 'sc.8.desc', fbTab: 'World Map', fbTitle: 'Offline .mca World Map', fbDesc: 'Explore biomes, terrain relief, structures, 1:8 portals, and Xaero/JourneyMap waypoints.' },
    { file: 'docs/screenshot-MCP.png', tabKey: 'sc.9.tab', titleKey: 'sc.9.title', descKey: 'sc.9.desc', fbTab: 'MCP 80 Tools', fbTitle: 'Local MCP Server (80 Tools)', fbDesc: 'Connect Claude Desktop or Cursor over stdio MCP with confirmation tiers and secret redaction.' },
    { file: 'docs/screenshot-remote-ui.png', tabKey: 'sc.10.tab', titleKey: 'sc.10.title', descKey: 'sc.10.desc', fbTab: 'Remote Web UI', fbTitle: 'Remote Web Dashboard (SSE)', fbDesc: 'Manage status, console logs, players, and backups from browser behind Bearer auth.' },
  ];

  const RUNTIME_PROFILES = {
    all: { bootKey: 'prof.all.boot', ramKey: 'prof.all.ram', javaKey: 'spec.javaAll', netKey: 'prof.all.net', bootMeter: 0.72, ramMeter: 0.78 },
    java: { bootKey: 'prof.java.boot', ramKey: 'prof.java.ram', javaKey: 'spec.javaAuto', netKey: 'prof.java.net', bootMeter: 0.85, ramMeter: 0.88 },
    rust: { bootKey: 'prof.rust.boot', ramKey: 'prof.rust.ram', javaKey: 'spec.javaNone', netKey: 'prof.rust.net', bootMeter: 0.08, ramMeter: 0.14 },
    crossplay: { bootKey: 'prof.cross.boot', ramKey: 'prof.cross.ram', javaKey: 'spec.javaAuto', netKey: 'spec.netCross', bootMeter: 0.68, ramMeter: 0.82 },
    automation: { bootKey: 'prof.auto.boot', ramKey: 'prof.auto.ram', javaKey: 'spec.javaAll', netKey: 'spec.netCli', bootMeter: 0.18, ramMeter: 0.10 },
  };

  const isLocalWebsiteSubdir = /\/website(\/|$)/.test(location.pathname);
  function assetUrl(rel) {
    if (!isLocalWebsiteSubdir) return rel;
    if (rel.startsWith('fonts/') || rel.startsWith('software/')) return '../src/renderer/assets/' + rel;
    return '../' + rel;
  }

  const fontsLink = document.getElementById('fontsStylesheet');
  if (fontsLink) fontsLink.href = assetUrl('fonts/fonts.css');
  const fav = document.getElementById('faviconLink');
  if (fav) fav.href = assetUrl('build/icon.png');
  document.querySelectorAll('[data-asset]').forEach((el) => {
    const rel = el.getAttribute('data-asset');
    if (rel) el.setAttribute('src', assetUrl(rel));
  });

  const prefersReducedMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let heroShotIdx = 0;
  let lbShotIdx = 0;
  let plyShotIdx = 6;
  let activeScenario = 'cgnat';
  let activeMode = 'all';
  let activeOps = 'cli';
  let calcDir = 'o2n';
  let currentLang = detectInitialLang();
  let currentTone = detectInitialTone();
  let lbLastTrigger = null;
  let releaseState = 'loading'; // 'loading' | 'live' | 'fallback'
  let latestReleaseTag = '';

  function detectInitialTone() {
    try {
      const urlTone = new URLSearchParams(location.search).get('tone');
      if (urlTone === 'simple' || urlTone === 'tech') return urlTone;
      const saved = localStorage.getItem('observer_web_tone');
      if (saved === 'simple' || saved === 'tech') return saved;
    } catch {}
    return 'simple';
  }

  function detectInitialLang() {
    try {
      const saved = localStorage.getItem('observer_web_lang');
      if (saved && SUPPORTED_LANGS.includes(saved)) return saved;
    } catch {}
    const nav = (navigator.language || 'en').trim();
    if (SUPPORTED_LANGS.includes(nav)) return nav;
    const low = nav.toLowerCase();
    if (low.startsWith('pt')) return 'pt-BR';
    if (low.startsWith('zh')) return 'zh-CN';
    const base = low.split('-')[0];
    return SUPPORTED_LANGS.includes(base) ? base : 'en';
  }

  function t(key, fallback = '') {
    const simpleLang = (window.WEB_SIMPLE_OVERRIDES && window.WEB_SIMPLE_OVERRIDES[currentLang]) || {};
    const simpleEn = (window.WEB_SIMPLE_OVERRIDES && window.WEB_SIMPLE_OVERRIDES.en) || {};
    const dict = (window.WEB_LOCALES && window.WEB_LOCALES[currentLang]) || {};
    const en = (window.WEB_LOCALES && window.WEB_LOCALES.en) || {};
    if (currentTone === 'simple') {
      if (simpleLang[key] != null) return simpleLang[key];
      if (dict[key] != null && currentLang !== 'en') return dict[key];
      if (simpleEn[key] != null) return simpleEn[key];
    }
    return dict[key] ?? en[key] ?? fallback;
  }

  function glideToneSwitch() {
    document.querySelectorAll('.tone-switch').forEach((wrap) => {
      const thumb = wrap.querySelector('.tone-thumb');
      const active = wrap.querySelector('.tone-btn.active');
      if (!thumb || !active || !active.offsetWidth) return;
      thumb.style.setProperty('--tx', `${active.offsetLeft - 3}px`);
      thumb.style.setProperty('--tsx', `${Math.max(0.2, active.offsetWidth / 64)}`);
    });
  }

  function syncToneUi() {
    document.documentElement.dataset.tone = currentTone;
    document.querySelectorAll('.tone-switch .tone-btn').forEach((btn) => {
      const match = btn.getAttribute('data-tone') === currentTone;
      btn.classList.toggle('active', match);
      btn.setAttribute('aria-checked', match ? 'true' : 'false');
    });
    requestAnimationFrame(glideToneSwitch);
  }

  function setTone(nextTone, animate = true) {
    currentTone = nextTone === 'tech' ? 'tech' : 'simple';
    try { localStorage.setItem('observer_web_tone', currentTone); } catch {}
    syncToneUi();
    applyLocale(currentLang);
    if (animate && !prefersReducedMotion()) {
      document.querySelectorAll('.hero-copy h1, .hero-copy .lead, .workbench-intro h2, .section-head-split h2, .calc-head h3').forEach((el) => {
        el.classList.remove('tone-morph');
        void el.offsetWidth;
        el.classList.add('tone-morph');
      });
    }
  }

  function applyLocale(lang) {
    currentLang = SUPPORTED_LANGS.includes(lang) ? lang : 'en';
    document.documentElement.lang = currentLang;
    document.documentElement.dataset.tone = currentTone;
    try { localStorage.setItem('observer_web_lang', currentLang); } catch {}
    const sel = document.getElementById('langSelect');
    if (sel) sel.value = currentLang;

    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const v = t(el.getAttribute('data-i18n'));
      if (v) el.textContent = v;
    });
    document.querySelectorAll('[data-i18n-html]').forEach((el) => {
      const v = t(el.getAttribute('data-i18n-html'));
      if (v) el.innerHTML = v;
    });
    syncToneUi();
    selectHeroDeck(heroShotIdx, 0);
    renderWorkbench(activeScenario, false);
    updateCalculator(false);
    selectPlayerSpot(plyShotIdx, false);
    applyRuntimeMode(activeMode);
    renderOps(activeOps, false);
    syncDockWithVisitorOs();
    syncLightboxContent();
    syncReleaseStatusText();
  }

  function syncReleaseStatusText() {
    const stEl = document.getElementById('releaseStatus');
    if (!stEl) return;
    if (releaseState === 'live' && latestReleaseTag) stEl.textContent = `${t('rel.live')} ${latestReleaseTag}`;
    else if (releaseState === 'fallback') stEl.textContent = t('rel.fallback');
  }

  // Hero Deck Switcher + GPU Glide Bar
  function glideHeroDeck() {
    const glide = document.getElementById('deckGlide');
    const active = document.querySelector('#heroDeckTabs .deck-tab.active');
    if (!glide || !active) return;
    glide.style.setProperty('--dgx', `${active.offsetLeft}px`);
    glide.style.setProperty('--dgsx', `${Math.max(0.2, active.offsetWidth / 64)}`);
  }

  function selectHeroDeck(idx, dir = 1) {
    const next = Math.max(0, Math.min(3, Number(idx) || 0));
    const computedDir = dir === 0 ? 0 : (next > heroShotIdx ? 1 : -1);
    heroShotIdx = next;
    document.querySelectorAll('#heroDeckTabs .deck-tab').forEach((btn) => {
      const match = Number(btn.getAttribute('data-shot')) === heroShotIdx;
      btn.classList.toggle('active', match);
      btn.setAttribute('aria-selected', match ? 'true' : 'false');
    });
    const s = SHOTS[heroShotIdx];
    const img = document.getElementById('heroDeckImg');
    const title = document.getElementById('heroDeckTitle');
    const desc = document.getElementById('heroDeckDesc');
    const counter = document.getElementById('heroDeckCounter');
    if (counter) counter.textContent = `0${heroShotIdx + 1} / 04`;
    if (img) {
      if (computedDir !== 0 && !prefersReducedMotion()) {
        img.classList.remove('stage-enter-fwd', 'stage-enter-back');
        void img.offsetWidth;
        img.classList.add(computedDir > 0 ? 'stage-enter-fwd' : 'stage-enter-back');
      }
      img.src = assetUrl(s.file);
      img.alt = t(s.titleKey, s.fbTitle);
    }
    if (title) title.textContent = t(s.titleKey, s.fbTitle);
    if (desc) desc.textContent = t(s.descKey, s.fbDesc);
    requestAnimationFrame(glideHeroDeck);
  }

  // Workbench Diff Renderer + Vertical Tab Glide
  function glideWbTabs() {
    const glide = document.getElementById('wbGlide');
    const active = document.querySelector('#wbScenarioTabs .wb-btn.active');
    if (!glide || !active) return;
    glide.style.setProperty('--wgy', `${active.offsetTop}px`);
    glide.style.setProperty('--wgsy', `${Math.max(0.2, active.offsetHeight / 44)}`);
  }

  function fireWbBus() {
    const panel = document.getElementById('wbDiffPanel');
    if (!panel || prefersReducedMotion()) return;
    panel.classList.remove('bus-firing');
    void panel.offsetWidth;
    panel.classList.add('bus-firing');
  }

  function renderWorkbench(key, animate = true) {
    const wbMap = window.WEB_WORKBENCH || {};
    activeScenario = wbMap[key] ? key : 'cgnat';
    document.querySelectorAll('#wbScenarioTabs .wb-btn').forEach((btn) => {
      const match = btn.getAttribute('data-scenario') === activeScenario;
      btn.classList.toggle('active', match);
      btn.setAttribute('aria-selected', match ? 'true' : 'false');
    });
    const toneBucket = wbMap[activeScenario]?.[currentTone === 'simple' ? 'simple' : 'tech'] || wbMap[activeScenario]?.tech || {};
    const data = toneBucket[currentLang] || toneBucket.en;
    if (!data) return;
    const listEl = document.getElementById('wbManualList');
    if (listEl) {
      listEl.innerHTML = '';
      data.manual.forEach((line, idx) => {
        const li = document.createElement('li');
        li.style.setProperty('--di', String(idx));
        li.textContent = line;
        listEl.appendChild(li);
      });
    }
    const cEl = document.getElementById('wbManualCount');
    const oEl = document.getElementById('wbObsOutcome');
    const sEl = document.getElementById('wbObsSummary');
    const mEl = document.getElementById('wbObsModules');
    if (cEl) cEl.textContent = data.count;
    if (oEl) oEl.textContent = data.outcome;
    if (sEl) sEl.textContent = data.summary;
    const techBucket = wbMap[activeScenario]?.tech || {};
    const techData = techBucket[currentLang] || techBucket.en;
    if (mEl && techData) mEl.textContent = techData.modules;

    if (animate) fireWbBus();
    requestAnimationFrame(glideWbTabs);
  }

  // Live 1:8 Overworld / Nether Coordinate Bridge + Interactive Chunk Radar
  function syncPortalRadar(owX, owZ, neX, neZ) {
    const owDot = document.getElementById('radarOwDot');
    const neDot = document.getElementById('radarNeDot');
    const radar = document.getElementById('portalRadar');
    const chunkTag = document.getElementById('radarChunkTag');
    const ratioLbl = document.getElementById('radarRatioLbl');
    if (!owDot || !neDot) return;

    const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
    // Map world [-2048..2048] cleanly across the 130x84 pad (center 71,48 for OW; 249,48 for Nether)
    const owPx = clamp(71 + (owX / 2048) * 56, 14, 128);
    const owPy = clamp(48 + (owZ / 2048) * 34, 14, 82);
    const nePx = clamp(249 + (neX / 2048) * 56, 192, 306);
    const nePy = clamp(48 + (neZ / 2048) * 34, 14, 82);
    owDot.setAttribute('transform', `translate(${owPx.toFixed(1)} ${owPy.toFixed(1)})`);
    neDot.setAttribute('transform', `translate(${nePx.toFixed(1)} ${nePy.toFixed(1)})`);

    if (radar) radar.classList.toggle('is-n2o', calcDir === 'n2o');
    if (ratioLbl) ratioLbl.textContent = calcDir === 'o2n' ? '1:8 ->' : '<- x8';
    if (chunkTag) {
      if (currentTone === 'tech') {
        const cx = Math.floor(owX / 16);
        const cz = Math.floor(owZ / 16);
        const rxMca = Math.floor(cx / 32);
        const rzMca = Math.floor(cz / 32);
        chunkTag.textContent = `Chunk [${cx}, ${cz}] · r.${rxMca}.${rzMca}.mca`;
      } else {
        chunkTag.textContent = `${t('radar.ow', 'OVERWORLD')} (${owX}, ${owZ}) -> ${t('radar.nether', 'NETHER')} (${neX}, ${neZ})`;
      }
    }
  }

  function updateCalculator(animate = true) {
    const xRaw = document.getElementById('coordX')?.value ?? '';
    const zRaw = document.getElementById('coordZ')?.value ?? '';
    const outBox = document.getElementById('calcOutput');
    const outDim = document.getElementById('calcOutDim');
    const outCoords = document.getElementById('calcOutCoords');
    const formula = document.getElementById('calcFormula');
    if (!outBox || !outDim || !outCoords) return;

    document.querySelectorAll('.calc-dir-btn').forEach((b) => {
      b.classList.toggle('active', b.getAttribute('data-dir') === calcDir);
    });
    outDim.textContent = t(calcDir === 'o2n' ? 'calc.outNether' : 'calc.outOver');
    if (formula) {
      const fKey = currentTone === 'tech'
        ? (calcDir === 'o2n' ? 'calc.formulaTechO2N' : 'calc.formulaTechN2O')
        : (calcDir === 'o2n' ? 'calc.formulaSimpleO2N' : 'calc.formulaSimpleN2O');
      formula.textContent = t(fKey, 'floor(X / 8), floor(Z / 8)');
    }

    const xStr = String(xRaw).trim();
    const zStr = String(zRaw).trim();
    const x = Number(xStr);
    const z = Number(zStr);
    if (!xStr || !zStr || !Number.isFinite(x) || !Number.isFinite(z)) {
      outBox.classList.add('is-error');
      outCoords.textContent = t('calc.errEmpty', 'Enter integer X and Z coordinates');
      return;
    }
    outBox.classList.remove('is-error');
    const rx = calcDir === 'o2n' ? Math.floor(x / 8) : Math.trunc(x * 8);
    const rz = calcDir === 'o2n' ? Math.floor(z / 8) : Math.trunc(z * 8);
    outCoords.textContent = `X: ${rx} · Z: ${rz}`;
    if (calcDir === 'o2n') syncPortalRadar(x, z, rx, rz);
    else syncPortalRadar(rx, rz, x, z);

    if (animate && !prefersReducedMotion()) {
      outCoords.classList.remove('calc-snap');
      void outCoords.offsetWidth;
      outCoords.classList.add('calc-snap');
    }
  }

  // Player 3D / Inventory Spotlight Switch
  function selectPlayerSpot(idx, animate = true) {
    const prev = plyShotIdx;
    plyShotIdx = idx === 7 ? 7 : 6;
    const dir = plyShotIdx === prev ? 0 : (plyShotIdx > prev ? 1 : -1);
    document.querySelectorAll('#plySwitch .ply-tab').forEach((b) => {
      const match = Number(b.getAttribute('data-shot')) === plyShotIdx;
      b.classList.toggle('active', match);
      b.setAttribute('aria-selected', match ? 'true' : 'false');
    });
    const img = document.getElementById('plySpotImg');
    const trigger = document.getElementById('plySpotTrigger');
    const s = SHOTS[plyShotIdx];
    if (img) {
      if (animate && dir !== 0 && !prefersReducedMotion()) {
        img.classList.remove('stage-enter-fwd', 'stage-enter-back');
        void img.offsetWidth;
        img.classList.add(dir > 0 ? 'stage-enter-fwd' : 'stage-enter-back');
      }
      img.src = assetUrl(s.file);
      img.alt = t(s.titleKey, s.fbTitle);
    }
    if (trigger) trigger.setAttribute('data-lightbox-idx', String(plyShotIdx));
  }

  // Lightbox Modal Controller
  function syncLightboxContent() {
    const lb = document.getElementById('shotLightbox');
    if (!lb || lb.hidden) return;
    const s = SHOTS[lbShotIdx];
    const img = document.getElementById('lbImg');
    const title = document.getElementById('lbTitle');
    const desc = document.getElementById('lbDesc');
    const counter = document.getElementById('lbCounter');
    if (counter) counter.textContent = `${String(lbShotIdx + 1).padStart(2, '0')} / ${SHOTS.length}`;
    if (title) title.textContent = t(s.titleKey, s.fbTitle);
    if (desc) desc.textContent = t(s.descKey, s.fbDesc);
    if (img) {
      img.src = assetUrl(s.file);
      img.alt = t(s.titleKey, s.fbTitle);
    }
  }

  function openLightbox(idx, triggerEl) {
    const lb = document.getElementById('shotLightbox');
    if (!lb) return;
    lbLastTrigger = triggerEl || document.activeElement;
    lbShotIdx = (idx + SHOTS.length) % SHOTS.length;
    lb.hidden = false;
    document.body.style.overflow = 'hidden';
    document.getElementById('mobileDock')?.classList.remove('visible');
    syncLightboxContent();
    document.getElementById('lbClose')?.focus();
  }

  function stepLightbox(delta) {
    lbShotIdx = (lbShotIdx + delta + SHOTS.length) % SHOTS.length;
    syncLightboxContent();
  }

  function closeLightbox() {
    const lb = document.getElementById('shotLightbox');
    if (!lb || lb.hidden) return;
    lb.hidden = true;
    document.body.style.overflow = '';
    updateScrollState();
    if (lbLastTrigger && lbLastTrigger.focus) lbLastTrigger.focus();
  }

  function attachSwipe(el, onPrev, onNext) {
    if (!el) return;
    let sx = 0, sy = 0;
    el.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      sx = e.touches[0].clientX;
      sy = e.touches[0].clientY;
    }, { passive: true });
    el.addEventListener('touchend', (e) => {
      if (!e.changedTouches.length) return;
      const dx = e.changedTouches[0].clientX - sx;
      const dy = e.changedTouches[0].clientY - sy;
      if (Math.abs(dx) >= 42 && Math.abs(dy) < 55) {
        if (dx < 0) onNext();
        else onPrev();
      }
    }, { passive: true });
  }

  // Runtime Profile Switcher (#ecosystem)
  function applyRuntimeMode(mode) {
    activeMode = RUNTIME_PROFILES[mode] ? mode : 'all';
    const prof = RUNTIME_PROFILES[activeMode];
    document.querySelectorAll('#modeBar .mode-pill').forEach((b) => {
      const match = b.getAttribute('data-mode') === activeMode;
      b.classList.toggle('active', match);
      b.setAttribute('aria-selected', match ? 'true' : 'false');
    });
    const elBoot = document.getElementById('specBoot');
    const elRam = document.getElementById('specRam');
    const elJava = document.getElementById('specJava');
    const elNet = document.getElementById('specNet');
    const meterBoot = document.getElementById('meterBoot');
    const meterRam = document.getElementById('meterRam');
    if (elBoot) elBoot.textContent = t(prof.bootKey);
    if (elRam) elRam.textContent = t(prof.ramKey);
    if (elJava) elJava.textContent = t(prof.javaKey, 'Auto OpenJDK / None on Rust');
    if (elNet) elNet.textContent = t(prof.netKey);
    if (meterBoot) meterBoot.style.setProperty('--meter', String(prof.bootMeter || 0.5));
    if (meterRam) meterRam.style.setProperty('--meter', String(prof.ramMeter || 0.5));

    document.querySelectorAll('#engineStrip .engine-item').forEach((card) => {
      const modes = (card.getAttribute('data-modes') || '').split(/\s+/);
      const isMatch = activeMode === 'all' || modes.includes(activeMode);
      card.classList.toggle('is-dimmed', !isMatch);
      card.classList.toggle('is-match', activeMode !== 'all' && isMatch);
    });
  }

  // Automation & Self-Host Stack Switcher (CLI, Docker, Headless, MCP)
  function renderInlineCode(el, text) {
    el.textContent = '';
    const parts = String(text || '').split(/(`[^`]+`)/g);
    parts.forEach((part) => {
      if (part.startsWith('`') && part.endsWith('`') && part.length >= 2) {
        const c = document.createElement('code');
        c.textContent = part.slice(1, -1);
        el.appendChild(c);
      } else if (part) {
        el.appendChild(document.createTextNode(part));
      }
    });
  }

  function glideOpsTabs() {
    const glide = document.getElementById('opsGlide');
    const active = document.querySelector('#opsTabs .ops-tab.active');
    if (!glide || !active || !active.offsetWidth) return;
    glide.style.setProperty('--ogx', `${active.offsetLeft - 3}px`);
    glide.style.setProperty('--ogsx', `${Math.max(0.2, active.offsetWidth / 64)}`);
  }

  function renderOps(key, animate = true) {
    const opsMap = window.WEB_OPS || {};
    activeOps = opsMap[key] ? key : 'cli';
    document.querySelectorAll('#opsTabs .ops-tab').forEach((btn) => {
      const match = btn.getAttribute('data-ops') === activeOps;
      btn.classList.toggle('active', match);
      btn.setAttribute('aria-selected', match ? 'true' : 'false');
    });
    const entry = opsMap[activeOps];
    if (!entry) return;
    const cmdEl = document.getElementById('opsCmdText');
    const descEl = document.getElementById('opsDescText');
    if (cmdEl) cmdEl.textContent = entry.cmd;
    if (descEl) {
      const toneBucket = entry[currentTone === 'simple' ? 'simple' : 'tech'] || entry.tech || {};
      renderInlineCode(descEl, toneBucket[currentLang] || toneBucket.en || '');
      if (animate && !prefersReducedMotion()) {
        descEl.classList.remove('tone-morph');
        void descEl.offsetWidth;
        descEl.classList.add('tone-morph');
      }
    }
    requestAnimationFrame(glideOpsTabs);
  }

  // Band Boundary Rule Trace + Workbench Initial Pulse + Scroll-Linked Hero Pitch
  function setupBandRules() {
    const bands = document.querySelectorAll('.rule-band');
    if (!('IntersectionObserver' in window) || prefersReducedMotion()) {
      bands.forEach((el) => el.classList.add('is-banded'));
      return;
    }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-banded');
          if (entry.target.id === 'workbench') fireWbBus();
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.14 });
    bands.forEach((el) => io.observe(el));
  }

  let heroPast = false;
  function updateScrollState() {
    const maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    const p = Math.min(1, Math.max(0, window.scrollY / maxScroll));
    const meter = document.getElementById('scrollMeter');
    if (meter) meter.style.setProperty('--scroll-p', p.toFixed(4));

    const heroDeck = document.getElementById('heroDeck');
    if (heroDeck && !prefersReducedMotion()) {
      const heroP = Math.min(1, Math.max(0, window.scrollY / 560));
      heroDeck.style.setProperty('--hero-p', heroP.toFixed(3));
    }

    const dock = document.getElementById('mobileDock');
    const lbOpen = !document.getElementById('shotLightbox')?.hidden;
    if (dock) dock.classList.toggle('visible', heroPast && !lbOpen);
  }

  let scrollScheduled = false;
  window.addEventListener('scroll', () => {
    if (scrollScheduled) return;
    scrollScheduled = true;
    requestAnimationFrame(() => { scrollScheduled = false; updateScrollState(); });
  }, { passive: true });

  const heroActions = document.getElementById('heroActions');
  if (heroActions && 'IntersectionObserver' in window) {
    new IntersectionObserver((entries) => {
      heroPast = !entries[0].isIntersecting && window.scrollY > 140;
      updateScrollState();
    }, { threshold: 0 }).observe(heroActions);
  }

  // OS Detection & GitHub Releases Hydration (with explicit loading / live / fallback state)
  const isVisitorLinux = () => {
    const ua = (navigator.userAgent || '').toLowerCase();
    return ua.includes('linux') && !ua.includes('android');
  };

  function syncDockWithVisitorOs() {
    const isLinux = isVisitorLinux();
    const srcBtn = document.getElementById(isLinux ? 'dlLinux' : 'dlWin');
    const srcMeta = document.getElementById(isLinux ? 'dlLinuxMeta' : 'dlWinMeta');
    const dockBtn = document.getElementById('dockDl');
    const dockLabel = document.getElementById('dockDlLabel');
    const dockMeta = document.getElementById('dockDlMeta');
    if (dockBtn && srcBtn) dockBtn.href = srcBtn.href;
    if (dockLabel) dockLabel.textContent = t(isLinux ? 'hero.dlLinux' : 'hero.dlWin');
    if (dockMeta && srcMeta) dockMeta.textContent = srcMeta.textContent;
  }

  function highlightVisitorOs() {
    const winBtn = document.getElementById('dlWin');
    const linuxBtn = document.getElementById('dlLinux');
    if (isVisitorLinux() && winBtn && linuxBtn) {
      winBtn.classList.remove('primary');
      linuxBtn.classList.add('primary');
    }
    syncDockWithVisitorOs();
  }

  function formatSize(bytes) {
    if (!bytes || bytes <= 0) return '';
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function applyReleaseAssets(release) {
    if (!release || !release.tag_name) return;
    const tag = release.tag_name;
    const verEl = document.getElementById('headerVersion');
    if (verEl) verEl.textContent = tag;

    const assets = Array.isArray(release.assets) ? release.assets : [];
    const exe = assets.find((a) => /\.exe$/i.test(a.name) && !/blockmap/i.test(a.name));
    const appImg = assets.find((a) => /\.AppImage$/i.test(a.name)) || assets.find((a) => /\.deb$/i.test(a.name));

    const winBtn = document.getElementById('dlWin');
    const winMeta = document.getElementById('dlWinMeta');
    if (winBtn && exe?.browser_download_url) {
      winBtn.href = exe.browser_download_url;
      if (winMeta) winMeta.textContent = `${tag}${exe.size ? ' · ' + formatSize(exe.size) : ''}`;
    } else if (winMeta) {
      winMeta.textContent = tag;
    }

    const linuxBtn = document.getElementById('dlLinux');
    const linuxMeta = document.getElementById('dlLinuxMeta');
    if (linuxBtn && appImg?.browser_download_url) {
      linuxBtn.href = appImg.browser_download_url;
      if (linuxMeta) linuxMeta.textContent = `${tag}${appImg.size ? ' · ' + formatSize(appImg.size) : ''}`;
    } else if (linuxMeta) {
      linuxMeta.textContent = tag;
    }

    releaseState = 'live';
    latestReleaseTag = tag;
    syncReleaseStatusText();
    syncDockWithVisitorOs();
  }

  async function hydrateLatestRelease() {
    const CACHE_KEY = 'observer_latest_release_v1';
    try {
      const cached = sessionStorage.getItem(CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed && (Date.now() - parsed.at) < 15 * 60 * 1000 && parsed.data) {
          applyReleaseAssets(parsed.data);
          return;
        }
      }
    } catch {}
    try {
      const res = await fetch('https://api.github.com/repos/Kag4286/ObserverLauncher/releases/latest', {
        headers: { Accept: 'application/vnd.github+json' },
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      applyReleaseAssets(data);
      try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), data })); } catch {}
    } catch {
      releaseState = 'fallback';
      syncReleaseStatusText();
    }
  }

  // Event Wiring
  document.getElementById('langSelect')?.addEventListener('change', (e) => applyLocale(e.target.value));

  document.querySelectorAll('#heroDeckTabs .deck-tab').forEach((btn) => {
    btn.addEventListener('click', () => selectHeroDeck(Number(btn.getAttribute('data-shot'))));
  });
  document.getElementById('heroZoomBtn')?.addEventListener('click', (e) => openLightbox(heroShotIdx, e.currentTarget));
  document.getElementById('heroShotTrigger')?.addEventListener('click', (e) => openLightbox(heroShotIdx, e.currentTarget));

  document.querySelectorAll('#wbScenarioTabs .wb-btn').forEach((btn) => {
    btn.addEventListener('click', () => renderWorkbench(btn.getAttribute('data-scenario')));
  });

  document.getElementById('coordX')?.addEventListener('input', updateCalculator);
  document.getElementById('coordZ')?.addEventListener('input', updateCalculator);
  document.querySelectorAll('.calc-dir-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      calcDir = btn.getAttribute('data-dir') === 'n2o' ? 'n2o' : 'o2n';
      updateCalculator();
    });
  });
  document.getElementById('calcResetBtn')?.addEventListener('click', () => {
    const cx = document.getElementById('coordX');
    const cz = document.getElementById('coordZ');
    calcDir = 'o2n';
    if (cx) cx.value = '800';
    if (cz) cz.value = '-1600';
    updateCalculator();
  });

  document.querySelectorAll('#plySwitch .ply-tab').forEach((btn) => {
    btn.addEventListener('click', () => selectPlayerSpot(Number(btn.getAttribute('data-shot'))));
  });

  document.querySelectorAll('[data-lightbox-idx]').forEach((btn) => {
    btn.addEventListener('click', (e) => openLightbox(Number(btn.getAttribute('data-lightbox-idx')), e.currentTarget));
  });

  document.getElementById('lbPrev')?.addEventListener('click', () => stepLightbox(-1));
  document.getElementById('lbNext')?.addEventListener('click', () => stepLightbox(1));
  document.getElementById('lbClose')?.addEventListener('click', closeLightbox);
  document.getElementById('shotLightbox')?.addEventListener('click', (e) => {
    if (e.target.id === 'shotLightbox') closeLightbox();
  });

  window.addEventListener('keydown', (e) => {
    const lb = document.getElementById('shotLightbox');
    if (!lb || lb.hidden) return;
    if (e.key === 'Escape') { closeLightbox(); return; }
    if (e.key === 'ArrowLeft') { stepLightbox(-1); return; }
    if (e.key === 'ArrowRight') { stepLightbox(1); return; }
    if (e.key === 'Tab') {
      const focusables = [...lb.querySelectorAll('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')].filter((el) => el.offsetParent !== null);
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  // Keyboard Arrow Navigation for ARIA Tablists (a11y)
  document.querySelectorAll('[role="tablist"]').forEach((list) => {
    list.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      const tabs = [...list.querySelectorAll('[role="tab"]')];
      const idx = tabs.indexOf(document.activeElement);
      if (idx === -1) return;
      e.preventDefault();
      const delta = (e.key === 'ArrowRight' || e.key === 'ArrowDown') ? 1 : -1;
      const next = tabs[(idx + delta + tabs.length) % tabs.length];
      if (next) { next.focus(); next.click(); }
    });
  });

  document.querySelectorAll('#modeBar .mode-pill').forEach((btn) => {
    btn.addEventListener('click', () => applyRuntimeMode(btn.getAttribute('data-mode')));
  });

  document.querySelectorAll('#opsTabs .ops-tab').forEach((btn) => {
    btn.addEventListener('click', () => renderOps(btn.getAttribute('data-ops')));
  });

  document.getElementById('copyOpsBtn')?.addEventListener('click', async () => {
    const btn = document.getElementById('copyOpsBtn');
    const cmd = document.getElementById('opsCmdText')?.textContent || '';
    try {
      await navigator.clipboard.writeText(cmd);
      if (btn) {
        btn.textContent = t('hero.copied', 'Copied');
        setTimeout(() => { btn.textContent = t('hero.copy', 'Copy'); }, 1500);
      }
    } catch {}
  });

  document.getElementById('copyCliBtn')?.addEventListener('click', async () => {
    const btn = document.getElementById('copyCliBtn');
    try {
      await navigator.clipboard.writeText('git clone https://github.com/Kag4286/ObserverLauncher.git && npm install && npm start');
      if (btn) {
        btn.textContent = t('hero.copied', 'Copied');
        setTimeout(() => { btn.textContent = t('hero.copy', 'Copy'); }, 1500);
      }
    } catch {}
  });

  attachSwipe(document.getElementById('heroDeckStage'), () => selectHeroDeck((heroShotIdx + 3) % 4, -1), () => selectHeroDeck((heroShotIdx + 1) % 4, 1));
  attachSwipe(document.getElementById('shotLightbox'), () => stepLightbox(-1), () => stepLightbox(1));

  // Register Switcher (Player / End-User vs Technical / Power-User)
  document.querySelectorAll('.tone-switch .tone-btn').forEach((btn) => {
    btn.addEventListener('click', () => setTone(btn.getAttribute('data-tone')));
  });

  // Hero Viewport Crosshair HUD (Mouse/Pointer only)
  const heroStage = document.getElementById('heroDeckStage');
  const hudLineX = document.getElementById('hudLineX');
  const hudLineY = document.getElementById('hudLineY');
  const hudCoords = document.getElementById('hudCoords');
  if (heroStage && hudLineX && hudLineY && hudCoords) {
    let hudRaf = false;
    heroStage.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse' || prefersReducedMotion() || hudRaf) return;
      hudRaf = true;
      requestAnimationFrame(() => {
        hudRaf = false;
        const rect = heroStage.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
        const y = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
        hudLineX.style.setProperty('--hx', `${x.toFixed(1)}px`);
        hudLineY.style.setProperty('--hy', `${y.toFixed(1)}px`);
        const px = Math.round((x / rect.width) * 1360);
        const py = Math.round((y / rect.height) * 860);
        hudCoords.textContent = `PX: ${px}, ${py} · 1360x860`;
      });
    }, { passive: true });
  }

  // Interactive .mca Portal Radar Drag/Click
  const radarPad = document.getElementById('radarSourcePad');
  const radarWrap = document.getElementById('portalRadar');
  const radarSvg = document.getElementById('radarSvg');
  if (radarPad && radarSvg) {
    let radarDragging = false;
    const applyRadarPointer = (clientX, clientY) => {
      const rect = radarSvg.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const svgX = ((clientX - rect.left) / rect.width) * 320;
      const svgY = ((clientY - rect.top) / rect.height) * 96;
      const normX = Math.max(-1, Math.min(1, (svgX - 71) / 56));
      const normZ = Math.max(-1, Math.min(1, (svgY - 48) / 34));
      const snapBlock = (v) => Math.round((v * 2048) / 16) * 16;
      const owX = snapBlock(normX);
      const owZ = snapBlock(normZ);
      const cxEl = document.getElementById('coordX');
      const czEl = document.getElementById('coordZ');
      if (cxEl && czEl) {
        cxEl.value = String(calcDir === 'o2n' ? owX : Math.floor(owX / 8));
        czEl.value = String(calcDir === 'o2n' ? owZ : Math.floor(owZ / 8));
      }
      updateCalculator(!radarDragging);
    };
    radarPad.addEventListener('pointerdown', (e) => {
      radarDragging = true;
      radarWrap?.classList.add('is-dragging');
      if (radarPad.setPointerCapture) radarPad.setPointerCapture(e.pointerId);
      applyRadarPointer(e.clientX, e.clientY);
    });
    radarPad.addEventListener('pointermove', (e) => {
      if (!radarDragging) return;
      applyRadarPointer(e.clientX, e.clientY);
    });
    const endRadarDrag = () => {
      if (!radarDragging) return;
      radarDragging = false;
      radarWrap?.classList.remove('is-dragging');
    };
    radarPad.addEventListener('pointerup', endRadarDrag);
    radarPad.addEventListener('pointercancel', endRadarDrag);
    radarPad.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 128 : 16;
      const cxEl = document.getElementById('coordX');
      const czEl = document.getElementById('coordZ');
      if (!cxEl || !czEl) return;
      let dx = 0, dz = 0;
      if (e.key === 'ArrowLeft') dx = -step;
      else if (e.key === 'ArrowRight') dx = step;
      else if (e.key === 'ArrowUp') dz = -step;
      else if (e.key === 'ArrowDown') dz = step;
      else return;
      e.preventDefault();
      cxEl.value = String((Number(cxEl.value) || 0) + dx);
      czEl.value = String((Number(czEl.value) || 0) + dz);
      updateCalculator(true);
    });
  }

  // Horizontal Filmstrip Scrub Rail + Desktop Pointer Drag
  const filmstrip = document.getElementById('filmstrip');
  const railBar = document.getElementById('filmRailBar');
  if (filmstrip) {
    const syncFilmRail = () => {
      if (!railBar) return;
      const maxScroll = Math.max(1, filmstrip.scrollWidth - filmstrip.clientWidth);
      const ratio = filmstrip.clientWidth / Math.max(1, filmstrip.scrollWidth);
      const prog = Math.min(1, Math.max(ratio, ratio + (1 - ratio) * (filmstrip.scrollLeft / maxScroll)));
      railBar.style.setProperty('--rail-p', prog.toFixed(3));
    };
    filmstrip.addEventListener('scroll', syncFilmRail, { passive: true });
    let draggingStrip = false, dragStartX = 0, dragStartScroll = 0, movedStrip = false;
    filmstrip.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse' || filmstrip.scrollWidth <= filmstrip.clientWidth) return;
      draggingStrip = true;
      movedStrip = false;
      dragStartX = e.clientX;
      dragStartScroll = filmstrip.scrollLeft;
      filmstrip.classList.add('is-grabbing');
    });
    window.addEventListener('pointermove', (e) => {
      if (!draggingStrip) return;
      const dx = e.clientX - dragStartX;
      if (Math.abs(dx) > 4) movedStrip = true;
      filmstrip.scrollLeft = dragStartScroll - dx;
    }, { passive: true });
    window.addEventListener('pointerup', () => {
      if (!draggingStrip) return;
      draggingStrip = false;
      filmstrip.classList.remove('is-grabbing');
      if (movedStrip) {
        const stopClick = (ev) => ev.stopPropagation();
        filmstrip.addEventListener('click', stopClick, { capture: true, once: true });
        setTimeout(() => filmstrip.removeEventListener('click', stopClick, { capture: true }), 80);
      }
    });
    syncFilmRail();
  }

  window.addEventListener('resize', () => requestAnimationFrame(() => { glideHeroDeck(); glideWbTabs(); glideToneSwitch(); glideOpsTabs(); }), { passive: true });
  document.fonts?.ready?.then(() => requestAnimationFrame(() => { glideHeroDeck(); glideWbTabs(); glideToneSwitch(); glideOpsTabs(); }));
  window.addEventListener('load', () => {
    SHOTS.forEach((s, i) => setTimeout(() => { const img = new Image(); img.src = assetUrl(s.file); }, i * 80));
  });

  // Boot
  highlightVisitorOs();
  applyLocale(currentLang);
  setupBandRules();
  updateScrollState();
  hydrateLatestRelease();
})();
