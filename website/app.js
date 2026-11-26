// website/app.js — Zero-Leak, Zero-Reflow Architectural Instrument Controller (v9.0.3)
// Features: WAAPI choreography (WeakMap cancel, 0 forced reflows), AbortController lifecycle,
// lazy per-locale loader, Hero Callout Pins, Scrollspy Glider, Discord RPC/Webhook Simulator,
// v9.0.3 Security Redaction & MCP Trust Inspector, 1:8 Portal Radar, and Motion Full/Lite toggle.
(() => {
  document.documentElement.classList.add('has-motion-js');

  const SUPPORTED_LANGS = ['en', 'vi', 'es', 'pt-BR', 'de', 'ru', 'zh-CN'];
  const SHOTS = [
    { webp: 'assets/shots/screenshot-overview.webp', webpSmall: 'assets/shots/screenshot-overview-680.webp', tabKey: 'sc.0.tab', titleKey: 'sc.0.title', descKey: 'sc.0.desc', fbTab: 'Overview', fbTitle: 'Overview Control Deck', fbDesc: 'Multi-instance sidebar, live status, LAN sharing, Playit/Pinggy tunnels, and Geyser status.' },
    { webp: 'assets/shots/screenshot-wizard.webp', tabKey: 'sc.1.tab', titleKey: 'sc.1.title', descKey: 'sc.1.desc', fbTab: 'Create Wizard', fbTitle: 'Multi-Engine Creation Wizard', fbDesc: 'Pick Vanilla, Paper, Fabric, Forge, NeoForge, Pumpkin (Rust), or Horizon (Rust) up to MC 26.3.' },
    { webp: 'assets/shots/screenshot-console.webp', tabKey: 'sc.2.tab', titleKey: 'sc.2.title', descKey: 'sc.2.desc', fbTab: 'Console', fbTitle: 'Live Filtered Console', fbDesc: 'Filter INF/WRN/ERR/CMD lines, search logs, click player names, and send commands.' },
    { webp: 'assets/shots/screenshot-performance.webp', tabKey: 'sc.3.tab', titleKey: 'sc.3.title', descKey: 'sc.3.desc', fbTab: 'Performance', fbTitle: 'TPS, MSPT, CPU & RAM Telemetry', fbDesc: 'Track live and historical tick health from 15 minutes up to 30 days.' },
    { webp: 'assets/shots/screenshot-content.webp', tabKey: 'sc.4.tab', titleKey: 'sc.4.title', descKey: 'sc.4.desc', fbTab: 'Content (25/pg)', fbTitle: 'Paginated Content Manager', fbDesc: 'Browse large mod/plugin folders at 25 items per page with quick toggles and config editor.' },
    { webp: 'assets/shots/screenshot-marketplace.webp', tabKey: 'sc.5.tab', titleKey: 'sc.5.title', descKey: 'sc.5.desc', fbTab: 'Marketplace', fbTitle: 'Modrinth & CurseForge Browser', fbDesc: 'Install plugins, mods, datapacks, and .mrpack bundles matching your server loader.' },
    { webp: 'assets/shots/screenshot-player-inspector.webp', tabKey: 'sc.6.tab', titleKey: 'sc.6.title', descKey: 'sc.6.desc', fbTab: '3D Inspector', fbTitle: '3D Player Inspector', fbDesc: 'Interactive WebGL skin + armor preview supporting 1.21.5+ and 26.x equipment.' },
    { webp: 'assets/shots/screenshot-inventory.webp', tabKey: 'sc.7.tab', titleKey: 'sc.7.title', descKey: 'sc.7.desc', fbTab: 'Inventory', fbTitle: '9x4 Inventory & Ender Chest', fbDesc: 'Search items, inspect enchantments with tooltips, and edit saved stats with backup.' },
    { webp: 'assets/shots/screenshot-worldmap.webp', tabKey: 'sc.8.tab', titleKey: 'sc.8.title', descKey: 'sc.8.desc', fbTab: 'World Map', fbTitle: 'Offline .mca World Map', fbDesc: 'Explore biomes, terrain relief, structures, 1:8 portals, and Xaero/JourneyMap waypoints.' },
    { webp: 'assets/shots/screenshot-MCP.webp', tabKey: 'sc.9.tab', titleKey: 'sc.9.title', descKey: 'sc.9.desc', fbTab: 'MCP 80 Tools', fbTitle: 'Local MCP Server (80 Tools)', fbDesc: 'Connect Claude Desktop or Cursor over stdio MCP with confirmation tiers and secret redaction.' },
    { webp: 'assets/shots/screenshot-remote-ui.webp', tabKey: 'sc.10.tab', titleKey: 'sc.10.title', descKey: 'sc.10.desc', fbTab: 'Remote Web UI', fbTitle: 'Remote Web Dashboard (SSE)', fbDesc: 'Manage status, console logs, players, and backups from browser behind Bearer auth.' },
  ];

  // Real UI zone coordinates (% on 1360x860 screenshots) for Hero Architectural Callout Pins
  const HERO_PINS = {
    0: [
      { x: 10, y: 24, tKey: 'pin.0.0.t', dKey: 'pin.0.0.d' },
      { x: 56, y: 26, tKey: 'pin.0.1.t', dKey: 'pin.0.1.d' },
      { x: 64, y: 58, tKey: 'pin.0.2.t', dKey: 'pin.0.2.d' },
    ],
    1: [
      { x: 46, y: 36, tKey: 'pin.1.0.t', dKey: 'pin.1.0.d' },
      { x: 68, y: 66, tKey: 'pin.1.1.t', dKey: 'pin.1.1.d' },
    ],
    2: [
      { x: 38, y: 20, tKey: 'pin.2.0.t', dKey: 'pin.2.0.d' },
      { x: 56, y: 86, tKey: 'pin.2.1.t', dKey: 'pin.2.1.d' },
    ],
    3: [
      { x: 56, y: 46, tKey: 'pin.3.0.t', dKey: 'pin.3.0.d' },
      { x: 82, y: 20, tKey: 'pin.3.1.t', dKey: 'pin.3.1.d' },
    ],
  };

  const RUNTIME_PROFILES = {
    all: { bootKey: 'prof.all.boot', ramKey: 'prof.all.ram', javaKey: 'spec.javaAll', netKey: 'prof.all.net', bootMeter: 0.72, ramMeter: 0.78 },
    java: { bootKey: 'prof.java.boot', ramKey: 'prof.java.ram', javaKey: 'spec.javaAuto', netKey: 'prof.java.net', bootMeter: 0.85, ramMeter: 0.88 },
    rust: { bootKey: 'prof.rust.boot', ramKey: 'prof.rust.ram', javaKey: 'spec.javaNone', netKey: 'prof.rust.net', bootMeter: 0.08, ramMeter: 0.14 },
    crossplay: { bootKey: 'prof.cross.boot', ramKey: 'prof.cross.ram', javaKey: 'spec.javaAuto', netKey: 'spec.netCross', bootMeter: 0.68, ramMeter: 0.82 },
    automation: { bootKey: 'prof.auto.boot', ramKey: 'prof.auto.ram', javaKey: 'spec.javaAll', netKey: 'spec.netCli', bootMeter: 0.18, ramMeter: 0.10 },
  };

  // Lifecycle & Memory-Leak Hygiene Registry
  const appAbort = new AbortController();
  const { signal } = appAbort;
  const activeObservers = [];
  const activeAnims = new WeakMap();
  const copyTimers = new WeakMap();
  const prefetchedUrls = new Set();
  const localePromises = new Map();

  const isLocalWebsiteSubdir = /\/website(\/|$)/.test(location.pathname);
  function assetUrl(rel) {
    if (!isLocalWebsiteSubdir) return rel;
    if (rel.startsWith('fonts/') || rel.startsWith('software/')) return '../src/renderer/assets/' + rel;
    if (rel.startsWith('docs/') || rel.startsWith('build/')) return '../' + rel;
    return rel;
  }

  // Only rewrite local dev paths for fonts & software icons (assets/* already live inside website/)
  const fontsLink = document.getElementById('fontsStylesheet');
  if (fontsLink && isLocalWebsiteSubdir) fontsLink.href = assetUrl('fonts/fonts.css');
  const fontPreload = document.getElementById('fontPreload');
  if (fontPreload && isLocalWebsiteSubdir) fontPreload.href = assetUrl('fonts/manrope-latin-wght-normal.woff2');
  if (isLocalWebsiteSubdir) {
    document.querySelectorAll('[data-asset]').forEach((el) => {
      const rel = el.getAttribute('data-asset');
      if (rel) el.setAttribute('src', assetUrl(rel));
    });
  }

  // Motion Preference (OS prefers-reduced-motion OR manual Motion Lite toggle)
  let motionLite = (() => {
    try { return localStorage.getItem('observer_web_motion') === 'lite'; } catch { return false; }
  })();
  const isReducedMotion = () => motionLite || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  function syncMotionUi() {
    document.documentElement.classList.toggle('motion-lite', motionLite);
    const btn = document.getElementById('motionToggle');
    if (btn) {
      btn.setAttribute('aria-pressed', motionLite ? 'true' : 'false');
      btn.textContent = t(motionLite ? 'motion.lite' : 'motion.full', motionLite ? 'Motion: Lite' : 'Motion: Full');
    }
  }

  // Zero-Reflow Web Animations API helper (cancels prior animation on same element cleanly)
  function runMotion(el, keyframes, opts) {
    if (!el || isReducedMotion() || typeof el.animate !== 'function') return null;
    const prev = activeAnims.get(el);
    if (prev) { try { prev.cancel(); } catch {} }
    try {
      const anim = el.animate(keyframes, opts);
      activeAnims.set(el, anim);
      return anim;
    } catch { return null; }
  }

  // Polite Screen Reader Announcer
  function announce(msg) {
    const el = document.getElementById('srStatus');
    if (!el || !msg) return;
    el.textContent = '';
    requestAnimationFrame(() => { el.textContent = msg; });
  }

  // State
  let heroShotIdx = 0;
  let activePinIdx = -1;
  let pinsEnabled = false;
  let lbShotIdx = 0;
  let plyShotIdx = 6;
  let activeScenario = 'cgnat';
  let activeMode = 'all';
  let activeOps = 'cli';
  let activeRpcView = 'presence';
  let activeRpcState = 'running';
  let activeSecMode = 'safe';
  let activeSecTier = 'read';
  let calcDir = 'o2n';
  let currentLang = detectInitialLang();
  let currentTone = detectInitialTone();
  let lbLastTrigger = null;
  let releaseState = 'loading';
  let latestReleaseTag = '';
  let activeNavSection = '';

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

  // Lazy Locale Bundle Loader (keeps initial JS to ~30 KB English)
  function getBundle(lang) {
    return (window.WEB_LOCALE_BUNDLES && window.WEB_LOCALE_BUNDLES[lang]) || null;
  }

  function loadLocaleBundle(lang) {
    if (!SUPPORTED_LANGS.includes(lang)) return Promise.resolve(false);
    if (getBundle(lang)) return Promise.resolve(true);
    if (localePromises.has(lang)) return localePromises.get(lang);
    const p = new Promise((resolve) => {
      const sc = document.createElement('script');
      sc.src = `locales/${lang}.js`;
      sc.async = true;
      sc.onload = () => resolve(!!getBundle(lang));
      sc.onerror = () => {
        localePromises.delete(lang);
        resolve(false);
      };
      document.head.appendChild(sc);
    });
    localePromises.set(lang, p);
    return p;
  }

  function t(key, fallback = '') {
    const cur = getBundle(currentLang);
    const en = getBundle('en');
    if (currentTone === 'simple') {
      if (cur?.simple?.[key] != null) return cur.simple[key];
      if (cur?.tech?.[key] != null && currentLang !== 'en') return cur.tech[key];
      if (en?.simple?.[key] != null) return en.simple[key];
    }
    return cur?.tech?.[key] ?? en?.tech?.[key] ?? fallback;
  }

  // Safe rich-text builder (only <strong> and <code>, zero innerHTML)
  function renderRichText(el, htmlStr) {
    el.textContent = '';
    const tokens = String(htmlStr || '').split(/(<strong>.*?<\/strong>|<code>.*?<\/code>|`[^`]+`)/g);
    tokens.forEach((tok) => {
      if (!tok) return;
      if (tok.startsWith('<strong>') && tok.endsWith('</strong>')) {
        const s = document.createElement('strong');
        s.textContent = tok.slice(8, -9);
        el.appendChild(s);
      } else if (tok.startsWith('<code>') && tok.endsWith('</code>')) {
        const c = document.createElement('code');
        c.textContent = tok.slice(6, -7);
        el.appendChild(c);
      } else if (tok.startsWith('`') && tok.endsWith('`') && tok.length >= 2) {
        const c = document.createElement('code');
        c.textContent = tok.slice(1, -1);
        el.appendChild(c);
      } else {
        el.appendChild(document.createTextNode(tok));
      }
    });
  }

  // Intent-based bounded prefetch (max 4 shots, respects Save-Data)
  function prefetchShot(idx) {
    if (navigator.connection && navigator.connection.saveData) return;
    const s = SHOTS[idx];
    if (!s || prefetchedUrls.has(s.webp) || prefetchedUrls.size >= 6) return;
    prefetchedUrls.add(s.webp);
    const link = document.createElement('link');
    link.rel = 'prefetch';
    link.as = 'image';
    link.href = s.webp;
    document.head.appendChild(link);
  }

  // Gliding Indicators
  function glideToneSwitch() {
    document.querySelectorAll('.tone-switch').forEach((wrap) => {
      const thumb = wrap.querySelector('.tone-thumb');
      const active = wrap.querySelector('.tone-btn.active');
      if (!thumb || !active || !active.offsetWidth) return;
      thumb.style.setProperty('--tx', `${active.offsetLeft - 3}px`);
      thumb.style.setProperty('--tsx', `${Math.max(0.2, active.offsetWidth / 64)}`);
    });
  }

  function glideNav(sectionId) {
    const glide = document.getElementById('navGlide');
    const nav = document.getElementById('desktopNav');
    if (!glide || !nav) return;
    const link = sectionId ? nav.querySelector(`a[data-section="${sectionId}"]`) : null;
    nav.querySelectorAll('a[data-section]').forEach((a) => a.classList.toggle('is-active', a === link));
    document.querySelectorAll('.mobile-subnav-links a[data-section]').forEach((a) => {
      a.classList.toggle('is-active', a.getAttribute('data-section') === sectionId);
    });
    if (!link || !link.offsetWidth) {
      glide.classList.remove('is-visible');
      return;
    }
    glide.classList.add('is-visible');
    glide.style.setProperty('--ngx', `${link.offsetLeft}px`);
    glide.style.setProperty('--ngsx', `${Math.max(0.2, link.offsetWidth / 64)}`);
  }

  function glideHeroDeck() {
    const glide = document.getElementById('deckGlide');
    const active = document.querySelector('#heroDeckTabs .deck-tab.active');
    if (!glide || !active || !active.offsetWidth) return;
    glide.style.setProperty('--dgx', `${active.offsetLeft}px`);
    glide.style.setProperty('--dgsx', `${Math.max(0.2, active.offsetWidth / 64)}`);
  }

  function glideWbTabs() {
    const glide = document.getElementById('wbGlide');
    const active = document.querySelector('#wbScenarioTabs .wb-btn.active');
    if (!glide || !active) return;
    glide.style.setProperty('--wgy', `${active.offsetTop}px`);
    glide.style.setProperty('--wgsy', `${Math.max(0.2, active.offsetHeight / 44)}`);
  }

  function glideRpcTabs() {
    const glide = document.getElementById('rpcGlide');
    const active = document.querySelector('#rpcModeTabs .rpc-tab.active');
    if (!glide || !active || !active.offsetWidth) return;
    glide.style.setProperty('--rgx', `${active.offsetLeft - 3}px`);
    glide.style.setProperty('--rgsx', `${Math.max(0.2, active.offsetWidth / 64)}`);
  }

  function glideOpsTabs() {
    const glide = document.getElementById('opsGlide');
    const active = document.querySelector('#opsTabs .ops-tab.active');
    if (!glide || !active || !active.offsetWidth) return;
    glide.style.setProperty('--ogx', `${active.offsetLeft - 3}px`);
    glide.style.setProperty('--ogsx', `${Math.max(0.2, active.offsetWidth / 64)}`);
  }

  function syncAllGlides() {
    glideToneSwitch();
    glideHeroDeck();
    glideWbTabs();
    glideRpcTabs();
    glideOpsTabs();
    if (activeNavSection) glideNav(activeNavSection);
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
    renderCurrentLocale();
    if (animate && !isReducedMotion()) {
      document.querySelectorAll('.hero-copy h1, .hero-copy .lead, .workbench-intro h2, .section-head-split h2, .calc-head h3').forEach((el) => {
        runMotion(el, [
          { clipPath: 'inset(0 14% 0 0)', opacity: 0.6 },
          { clipPath: 'inset(0 0 0 0)', opacity: 1 },
        ], { duration: 180, easing: 'cubic-bezier(.22,1,.36,1)' });
      });
    }
  }

  function renderCurrentLocale() {
    document.documentElement.lang = currentLang;
    document.documentElement.dataset.tone = currentTone;
    const sel = document.getElementById('langSelect');
    if (sel) sel.value = currentLang;

    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const v = t(el.getAttribute('data-i18n'));
      if (v) el.textContent = v;
    });
    document.querySelectorAll('[data-i18n-rich]').forEach((el) => {
      const v = t(el.getAttribute('data-i18n-rich'));
      if (v) renderRichText(el, v);
    });

    syncMotionUi();
    syncToneUi();
    selectHeroDeck(heroShotIdx, 0, false);
    renderWorkbench(activeScenario, false);
    updateCalculator(false);
    selectPlayerSpot(plyShotIdx, false);
    renderDiscordSim(false);
    renderSecurityLab(false);
    renderSecTier(activeSecTier, false);
    applyRuntimeMode(activeMode, false);
    renderOps(activeOps, false);
    syncDockWithVisitorOs();
    syncLightboxContent();
    syncReleaseStatusText();
    requestAnimationFrame(syncAllGlides);
  }

  async function applyLocale(lang) {
    const target = SUPPORTED_LANGS.includes(lang) ? lang : 'en';
    const ok = await loadLocaleBundle(target);
    if (!ok) {
      announce(t('sr.localeErr', 'Could not load language pack.'));
      const sel = document.getElementById('langSelect');
      if (sel) sel.value = currentLang;
      return;
    }
    currentLang = target;
    try { localStorage.setItem('observer_web_lang', currentLang); } catch {}
    renderCurrentLocale();
  }

  function syncReleaseStatusText() {
    const stEl = document.getElementById('releaseStatus');
    if (!stEl) return;
    if (releaseState === 'live' && latestReleaseTag) stEl.textContent = `${t('rel.live')} ${latestReleaseTag}`;
    else if (releaseState === 'fallback') stEl.textContent = t('rel.fallback');
  }

  // Hero Deck + Architectural Callout Pins
  function closeCalloutPopover(restoreFocus = false) {
    const pop = document.getElementById('calloutPopover');
    const prevIdx = activePinIdx;
    activePinIdx = -1;
    if (pop) pop.hidden = true;
    document.querySelectorAll('#heroCalloutLayer .callout-pin').forEach((p) => {
      p.classList.remove('is-active');
      p.setAttribute('aria-expanded', 'false');
    });
    if (restoreFocus && prevIdx >= 0) {
      document.querySelector(`#heroCalloutLayer .callout-pin[data-pin="${prevIdx}"]`)?.focus();
    }
  }

  function syncHeroPins() {
    const pins = HERO_PINS[heroShotIdx] || [];
    const layer = document.getElementById('heroCalloutLayer');
    if (!layer) return;
    layer.classList.toggle('is-hidden', !pinsEnabled);
    layer.querySelectorAll('.callout-pin').forEach((btn, i) => {
      const cfg = pins[i];
      if (!cfg) {
        btn.hidden = true;
        return;
      }
      btn.hidden = false;
      btn.style.setProperty('--px', `${cfg.x}%`);
      btn.style.setProperty('--py', `${cfg.y}%`);
      btn.setAttribute('aria-label', `${i + 1}. ${t(cfg.tKey)}`);
      btn.classList.toggle('is-active', i === activePinIdx);
      btn.setAttribute('aria-expanded', i === activePinIdx ? 'true' : 'false');
    });
    if (activePinIdx >= 0 && pins[activePinIdx] && pinsEnabled) {
      const cfg = pins[activePinIdx];
      const pop = document.getElementById('calloutPopover');
      const titleEl = document.getElementById('calloutTitle');
      const descEl = document.getElementById('calloutDesc');
      if (titleEl) titleEl.textContent = t(cfg.tKey);
      if (descEl) descEl.textContent = t(cfg.dKey);
      if (pop) pop.hidden = false;
    } else {
      closeCalloutPopover(false);
    }
  }

  function openCalloutPin(pinIdx) {
    const pins = HERO_PINS[heroShotIdx] || [];
    if (!pins[pinIdx]) return;
    if (activePinIdx === pinIdx) {
      closeCalloutPopover(false);
      return;
    }
    activePinIdx = pinIdx;
    syncHeroPins();
    const pop = document.getElementById('calloutPopover');
    runMotion(pop, [
      { opacity: 0, transform: 'translate3d(0, 8px, 0)' },
      { opacity: 1, transform: 'none' },
    ], { duration: 180, easing: 'cubic-bezier(.16,1,.3,1)' });
  }

  function selectHeroDeck(idx, dir = 1, shouldAnnounce = true) {
    const next = Math.max(0, Math.min(3, Number(idx) || 0));
    const computedDir = dir === 0 ? 0 : (next > heroShotIdx ? 1 : -1);
    heroShotIdx = next;
    activePinIdx = -1;

    document.querySelectorAll('#heroDeckTabs .deck-tab').forEach((btn) => {
      const match = Number(btn.getAttribute('data-shot')) === heroShotIdx;
      btn.classList.toggle('active', match);
      btn.setAttribute('aria-selected', match ? 'true' : 'false');
      btn.tabIndex = match ? 0 : -1;
    });
    const panel = document.getElementById('heroDeckPanel');
    if (panel) panel.setAttribute('aria-labelledby', `heroTab${heroShotIdx}`);

    const s = SHOTS[heroShotIdx];
    const img = document.getElementById('heroDeckImg');
    const webpSrc = document.getElementById('heroDeckWebp');
    const title = document.getElementById('heroDeckTitle');
    const desc = document.getElementById('heroDeckDesc');
    const counter = document.getElementById('heroDeckCounter');
    if (counter) counter.textContent = `0${heroShotIdx + 1} / 04`;
    if (webpSrc) {
      webpSrc.srcset = s.webpSmall ? `${s.webpSmall} 680w, ${s.webp} 1360w` : s.webp;
    }
    if (img) {
      img.src = s.webp;
      img.alt = t(s.titleKey, s.fbTitle);
      if (computedDir !== 0) {
        runMotion(img, [
          { opacity: 0.35, transform: `translate3d(${computedDir > 0 ? 12 : -12}px, 0, 0) scale(0.994)` },
          { opacity: 1, transform: 'none' },
        ], { duration: 210, easing: 'cubic-bezier(.16,1,.3,1)' });
      }
    }
    const titleText = t(s.titleKey, s.fbTitle);
    if (title) title.textContent = titleText;
    if (desc) desc.textContent = t(s.descKey, s.fbDesc);
    syncHeroPins();
    prefetchShot((heroShotIdx + 1) % 4);
    if (shouldAnnounce && computedDir !== 0) announce(`${t('sr.screen', 'Showing screen:')} ${titleText}`);
    requestAnimationFrame(glideHeroDeck);
  }

  // Band 2: Workbench Diff Renderer (Fixed 5-node <li> pool — zero DOM churn)
  function fireWbBus() {
    const pulse = document.getElementById('wbBusPulse');
    if (!pulse) return;
    runMotion(pulse, [
      { strokeDashoffset: 100, opacity: 0.35 },
      { strokeDashoffset: -10, opacity: 1, offset: 0.55 },
      { strokeDashoffset: -104, opacity: 0.2 },
    ], { duration: 540, easing: 'cubic-bezier(.2,0,0,1)' });
  }

  function renderWorkbench(key, animate = true) {
    const bundle = getBundle(currentLang) || getBundle('en');
    const wbMap = bundle?.workbench || {};
    activeScenario = wbMap[key] ? key : 'cgnat';

    document.querySelectorAll('#wbScenarioTabs .wb-btn').forEach((btn) => {
      const match = btn.getAttribute('data-scenario') === activeScenario;
      btn.classList.toggle('active', match);
      btn.setAttribute('aria-selected', match ? 'true' : 'false');
      btn.tabIndex = match ? 0 : -1;
    });
    const panel = document.getElementById('wbDiffPanel');
    if (panel) panel.setAttribute('aria-labelledby', `wbTab-${activeScenario}`);

    const entry = wbMap[activeScenario];
    const data = currentTone === 'simple' ? (entry?.simple || entry?.tech) : entry?.tech;
    if (!data) return;

    const items = document.querySelectorAll('#wbManualList > li');
    items.forEach((li, idx) => {
      const line = data.manual[idx];
      if (line) {
        li.hidden = false;
        li.textContent = line;
        if (animate) {
          runMotion(li, [
            { clipPath: 'inset(0 100% 0 0)', opacity: 0.55 },
            { clipPath: 'inset(0 0 0 0)', opacity: 1 },
          ], { duration: 170, delay: idx * 24, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'backwards' });
        }
      } else {
        li.hidden = true;
        li.textContent = '';
      }
    });

    const cEl = document.getElementById('wbManualCount');
    const oEl = document.getElementById('wbObsOutcome');
    const sEl = document.getElementById('wbObsSummary');
    const mEl = document.getElementById('wbObsModules');
    if (cEl) cEl.textContent = data.count;
    if (oEl) oEl.textContent = data.outcome;
    if (sEl) sEl.textContent = data.summary;
    if (mEl && entry?.tech) mEl.textContent = entry.tech.modules;

    if (animate) {
      fireWbBus();
      announce(`${t('sr.scenario', 'Comparing scenario:')} ${t(`wb.sc.${activeScenario}`)}`);
    }
    requestAnimationFrame(glideWbTabs);
  }

  // Band 3: Live 1:8 Overworld / Nether Calculator + Event-Driven Portal Radar (Zero Infinite Loop)
  function fireRadarPacket() {
    const line = document.getElementById('radarBridgeLine');
    if (!line) return;
    const fromOff = calcDir === 'o2n' ? 100 : -100;
    const toOff = calcDir === 'o2n' ? -100 : 100;
    runMotion(line, [
      { strokeDashoffset: fromOff, opacity: 0.9 },
      { strokeDashoffset: toOff, opacity: 0.15 },
    ], { duration: 400, easing: 'cubic-bezier(.16,1,.3,1)' });
  }

  function syncPortalRadar(owX, owZ, neX, neZ) {
    const owDot = document.getElementById('radarOwDot');
    const neDot = document.getElementById('radarNeDot');
    const chunkTag = document.getElementById('radarChunkTag');
    const ratioLbl = document.getElementById('radarRatioLbl');
    if (!owDot || !neDot) return;

    const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
    const owPx = clamp(71 + (owX / 2048) * 56, 14, 128);
    const owPy = clamp(48 + (owZ / 2048) * 34, 14, 82);
    const nePx = clamp(249 + (neX / 2048) * 56, 192, 306);
    const nePy = clamp(48 + (neZ / 2048) * 34, 14, 82);
    owDot.setAttribute('transform', `translate(${owPx.toFixed(1)} ${owPy.toFixed(1)})`);
    neDot.setAttribute('transform', `translate(${nePx.toFixed(1)} ${nePy.toFixed(1)})`);

    if (ratioLbl) ratioLbl.textContent = calcDir === 'o2n' ? '1:8 ->' : '<- x8';
    if (chunkTag) {
      if (currentTone === 'tech') {
        const cx = Math.floor(owX / 16);
        const cz = Math.floor(owZ / 16);
        chunkTag.textContent = `Chunk [${cx}, ${cz}] · r.${Math.floor(cx / 32)}.${Math.floor(cz / 32)}.mca`;
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
      const match = b.getAttribute('data-dir') === calcDir;
      b.classList.toggle('active', match);
      b.setAttribute('aria-pressed', match ? 'true' : 'false');
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

    if (animate) {
      fireRadarPacket();
      runMotion(outCoords, [
        { opacity: 0.45, transform: 'translate3d(0, 4px, 0)' },
        { opacity: 1, transform: 'none' },
      ], { duration: 160, easing: 'cubic-bezier(.22,1,.36,1)' });
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
      b.tabIndex = match ? 0 : -1;
    });
    const panel = document.getElementById('plyPanel');
    if (panel) panel.setAttribute('aria-labelledby', `plyTab${plyShotIdx}`);
    const img = document.getElementById('plySpotImg');
    const trigger = document.getElementById('plySpotTrigger');
    const s = SHOTS[plyShotIdx];
    if (img) {
      img.src = s.webp;
      img.alt = t(s.titleKey, s.fbTitle);
      if (animate && dir !== 0) {
        runMotion(img, [
          { opacity: 0.35, transform: `translate3d(${dir > 0 ? 10 : -10}px, 0, 0)` },
          { opacity: 1, transform: 'none' },
        ], { duration: 190, easing: 'cubic-bezier(.16,1,.3,1)' });
      }
    }
    if (trigger) trigger.setAttribute('data-lightbox-idx', String(plyShotIdx));
  }

  // Band 4 (Left): Live Discord Rich Presence & Webhook 2.0 Simulator
  function renderDiscordSim(animate = true) {
    document.querySelectorAll('#rpcModeTabs .rpc-tab').forEach((btn) => {
      const match = btn.getAttribute('data-rpc-view') === activeRpcView;
      btn.classList.toggle('active', match);
      btn.setAttribute('aria-selected', match ? 'true' : 'false');
      btn.tabIndex = match ? 0 : -1;
    });
    document.querySelectorAll('.rpc-state-btn').forEach((btn) => {
      const match = btn.getAttribute('data-rpc-state') === activeRpcState;
      btn.classList.toggle('active', match);
      btn.setAttribute('aria-pressed', match ? 'true' : 'false');
    });

    const showName = !!document.getElementById('rpcOptName')?.checked;
    const showPlayers = !!document.getElementById('rpcOptPlayers')?.checked;
    const isPresence = activeRpcView === 'presence';

    const privRow = document.getElementById('rpcPrivacyRow');
    if (privRow) privRow.classList.toggle('is-muted', !isPresence);
    const panel = document.getElementById('rpcSimPanel');
    if (panel) panel.setAttribute('aria-labelledby', isPresence ? 'rpcTabPresence' : 'rpcTabWebhook');

    const pCard = document.getElementById('rpcPresenceCard');
    const wCard = document.getElementById('rpcWebhookCard');
    if (pCard) pCard.hidden = !isPresence;
    if (wCard) wCard.hidden = isPresence;

    // Presence card content (mirrors src/main/discord-rpc.js buildPresenceActivity)
    const dot = document.getElementById('dcStatusDot');
    const detail = document.getElementById('dcDetail');
    const state = document.getElementById('dcState');
    const elapsed = document.getElementById('dcElapsed');
    if (dot) dot.className = `dc-dot is-${activeRpcState}`;
    if (activeRpcState === 'running') {
      if (detail) detail.textContent = showName ? t('rpc.runningDetails') : t('rpc.runningGeneric');
      if (state) state.textContent = showPlayers ? t('rpc.stateLinePlayers') : t('rpc.stateLineHidden');
      if (elapsed) elapsed.hidden = false;
    } else if (activeRpcState === 'starting') {
      if (detail) detail.textContent = t('rpc.startingDetails');
      if (state) state.textContent = t('rpc.startingState');
      if (elapsed) elapsed.hidden = true;
    } else {
      if (detail) detail.textContent = t('rpc.idleDetails');
      if (state) state.textContent = t('rpc.idleState');
      if (elapsed) elapsed.hidden = true;
    }

    // Webhook 2.0 embed content (mirrors src/main/webhook.js buildEmbed)
    const embed = document.getElementById('whEmbedBox');
    const whTitle = document.getElementById('whTitle');
    const whDesc = document.getElementById('whDesc');
    const whPlayers = document.getElementById('whPlayersVal');
    if (embed && whTitle && whDesc) {
      if (activeRpcState === 'running') {
        embed.className = 'wh-embed is-running';
        whTitle.textContent = t('rpc.whTitleRun');
        whDesc.textContent = t('rpc.whDescRun');
        if (whPlayers) whPlayers.textContent = '4 / 20';
      } else if (activeRpcState === 'starting') {
        embed.className = 'wh-embed is-crash';
        whTitle.textContent = t('rpc.whTitleStart');
        whDesc.textContent = t('rpc.whDescStart');
        if (whPlayers) whPlayers.textContent = '0 / 20';
      } else {
        embed.className = 'wh-embed is-backup';
        whTitle.textContent = t('rpc.whTitleIdle');
        whDesc.textContent = t('rpc.whDescIdle');
        if (whPlayers) whPlayers.textContent = '2 / 20';
      }
    }

    if (animate) {
      const targetCard = isPresence ? pCard : wCard;
      runMotion(targetCard, [
        { opacity: 0.45, transform: 'translate3d(0, 5px, 0)' },
        { opacity: 1, transform: 'none' },
      ], { duration: 180, easing: 'cubic-bezier(.16,1,.3,1)' });
    }
    requestAnimationFrame(glideRpcTabs);
  }

  // Band 4 (Right): v9.0.3 Security Redaction & MCP Trust Inspector
  function renderSecurityLab(animate = true) {
    const isSafe = activeSecMode === 'safe';
    document.querySelectorAll('.sec-view-btn').forEach((btn) => {
      const match = btn.getAttribute('data-sec-mode') === activeSecMode;
      btn.classList.toggle('active', match);
      btn.setAttribute('aria-pressed', match ? 'true' : 'false');
    });

    const tag = document.getElementById('secStateTag');
    if (tag) {
      tag.textContent = t(isSafe ? 'sec.badgeSafe' : 'sec.badgeRaw');
      tag.classList.toggle('is-raw', !isSafe);
    }

    const code = document.getElementById('redactCode');
    if (code) {
      code.textContent = '';
      const lines = isSafe
        ? [
            { text: 'motd=Survival SMP (Fabric 1.21.1)', cls: 'rc-line' },
            { text: 'server-port=25565', cls: 'rc-line' },
            { text: '# rcon.password  -> [stripped on .mrpack export]', cls: 'rc-line rc-redacted' },
            { text: '# server-ip      -> [stripped on .mrpack export]', cls: 'rc-line rc-redacted' },
            { text: 'forwarding-secret = "[redacted]"  # MCP maskSecrets()', cls: 'rc-line rc-redacted' },
          ]
        : [
            { text: 'motd=Survival SMP (Fabric 1.21.1)', cls: 'rc-line' },
            { text: 'server-port=25565', cls: 'rc-line' },
            { text: 'rcon.password=K9x_demo_local_only_7vR4', cls: 'rc-line rc-secret' },
            { text: 'server-ip=192.168.1.44', cls: 'rc-line rc-secret' },
            { text: 'forwarding-secret = "demo_velocity_token_9f2a"', cls: 'rc-line rc-secret' },
          ];
      const frag = document.createDocumentFragment();
      lines.forEach((l) => {
        const span = document.createElement('span');
        span.className = l.cls;
        span.textContent = l.text;
        frag.appendChild(span);
      });
      code.appendChild(frag);
    }

    if (animate) {
      const beam = document.getElementById('redactBeam');
      const well = document.getElementById('redactWell');
      if (beam && well) {
        const w = well.clientWidth || 420;
        runMotion(beam, [
          { transform: 'translate3d(0, 0, 0)', opacity: 0.9 },
          { transform: `translate3d(${w}px, 0, 0)`, opacity: 0 },
        ], { duration: 420, easing: 'cubic-bezier(.16,1,.3,1)' });
      }
    }
  }

  function renderSecTier(tier, animate = true) {
    activeSecTier = ['read', 'write', 'destroy'].includes(tier) ? tier : 'read';
    document.querySelectorAll('#secTierTabs .tier-tab').forEach((btn) => {
      const match = btn.getAttribute('data-tier') === activeSecTier;
      btn.classList.toggle('active', match);
      btn.setAttribute('aria-selected', match ? 'true' : 'false');
      btn.tabIndex = match ? 0 : -1;
    });
    const desc = document.getElementById('secTierPanel');
    const keyMap = { read: 'sec.tierReadDesc', write: 'sec.tierWriteDesc', destroy: 'sec.tierDestroyDesc' };
    const idMap = { read: 'tierTabRead', write: 'tierTabWrite', destroy: 'tierTabDestroy' };
    if (desc) {
      desc.setAttribute('aria-labelledby', idMap[activeSecTier]);
      desc.textContent = t(keyMap[activeSecTier]);
      if (animate) {
        runMotion(desc, [{ opacity: 0.45 }, { opacity: 1 }], { duration: 150, easing: 'cubic-bezier(.22,1,.36,1)' });
      }
    }
  }

  // Lightbox Modal Controller with inert background isolation
  function setBackgroundInert(flag) {
    ['siteHeader', 'top', 'siteFooter', 'mobileDock'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.inert = !!flag;
    });
  }

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
      img.src = s.webp;
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
    setBackgroundInert(true);
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
    setBackgroundInert(false);
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
    }, { passive: true, signal });
    el.addEventListener('touchend', (e) => {
      if (!e.changedTouches.length) return;
      const dx = e.changedTouches[0].clientX - sx;
      const dy = e.changedTouches[0].clientY - sy;
      if (Math.abs(dx) >= 42 && Math.abs(dy) < 55) {
        if (dx < 0) onNext();
        else onPrev();
      }
    }, { passive: true, signal });
  }

  // Band 5: Runtime Profile Switcher
  function applyRuntimeMode(mode, shouldAnnounce = true) {
    activeMode = RUNTIME_PROFILES[mode] ? mode : 'all';
    const prof = RUNTIME_PROFILES[activeMode];
    document.querySelectorAll('#modeBar .mode-pill').forEach((b) => {
      const match = b.getAttribute('data-mode') === activeMode;
      b.classList.toggle('active', match);
      b.setAttribute('aria-selected', match ? 'true' : 'false');
      b.tabIndex = match ? 0 : -1;
    });
    const panel = document.getElementById('modeSpecsPanel');
    if (panel) panel.setAttribute('aria-labelledby', `modeTab-${activeMode}`);

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
    if (shouldAnnounce) announce(`${t('sr.mode', 'Filtered engines:')} ${t(`mode.${activeMode}`)}`);
  }

  // Band 5: Headless Ops Switcher
  function renderOps(key, animate = true) {
    const bundle = getBundle(currentLang) || getBundle('en');
    const opsMap = bundle?.ops || {};
    activeOps = opsMap[key] ? key : 'cli';
    document.querySelectorAll('#opsTabs .ops-tab').forEach((btn) => {
      const match = btn.getAttribute('data-ops') === activeOps;
      btn.classList.toggle('active', match);
      btn.setAttribute('aria-selected', match ? 'true' : 'false');
      btn.tabIndex = match ? 0 : -1;
    });
    const panel = document.getElementById('opsBodyPanel');
    if (panel) panel.setAttribute('aria-labelledby', `opsTab-${activeOps}`);

    const entry = opsMap[activeOps];
    if (!entry) return;
    const cmdEl = document.getElementById('opsCmdText');
    const descEl = document.getElementById('opsDescText');
    if (cmdEl) cmdEl.textContent = entry.cmd;
    if (descEl) {
      renderRichText(descEl, currentTone === 'simple' ? (entry.simple || entry.tech) : entry.tech);
      if (animate) {
        runMotion(descEl, [{ opacity: 0.45 }, { opacity: 1 }], { duration: 150, easing: 'cubic-bezier(.22,1,.36,1)' });
      }
    }
    requestAnimationFrame(glideOpsTabs);
  }

  // Band Hairline Trace + Dock / Resize Observers (Scrollspy uses deterministic geometry in updateScrollState)
  function setupObservers() {
    const bands = document.querySelectorAll('.rule-band');
    if (!('IntersectionObserver' in window) || isReducedMotion()) {
      bands.forEach((el) => el.classList.add('is-banded'));
    } else {
      const bandIo = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-banded');
            if (entry.target.id === 'workbench') fireWbBus();
            bandIo.unobserve(entry.target);
          }
        });
      }, { threshold: 0.08 });
      bands.forEach((el) => bandIo.observe(el));
      activeObservers.push(bandIo);
    }

    if ('IntersectionObserver' in window) {
      const heroActions = document.getElementById('heroActions');
      if (heroActions) {
        const dockIo = new IntersectionObserver((entries) => {
          heroPast = !entries[0].isIntersecting && window.scrollY > 140;
          updateScrollState();
        }, { threshold: 0 });
        dockIo.observe(heroActions);
        activeObservers.push(dockIo);
      }
    }

    if ('ResizeObserver' in window) {
      let roScheduled = false;
      const ro = new ResizeObserver(() => {
        if (roScheduled) return;
        roScheduled = true;
        requestAnimationFrame(() => { roScheduled = false; syncAllGlides(); });
      });
      const header = document.getElementById('siteHeader');
      if (header) ro.observe(header);
      activeObservers.push(ro);
    }
  }

  // Deterministic Geometric Scrollspy (never skips tall #spotlight or short #preflight sections)
  const spySections = [...document.querySelectorAll('[data-spy-section]')];
  function syncNavScrollspy() {
    if (!spySections.length) return;
    const headerH = document.getElementById('siteHeader')?.offsetHeight || 64;
    const triggerY = headerH + Math.min(280, Math.round(window.innerHeight * 0.32));
    const atBottom = (window.innerHeight + window.scrollY) >= (document.documentElement.scrollHeight - 24);
    let nextSection = '';
    if (atBottom) {
      nextSection = spySections[spySections.length - 1].getAttribute('data-spy-section') || '';
    } else {
      for (const sec of spySections) {
        if (sec.getBoundingClientRect().top <= triggerY) {
          nextSection = sec.getAttribute('data-spy-section') || '';
        }
      }
    }
    if (nextSection !== activeNavSection) {
      activeNavSection = nextSection;
      glideNav(activeNavSection);
    }
  }

  // Scroll State (fallback meter when CSS animation-timeline unsupported + Hero depth + Scrollspy + Mobile Dock)
  const supportsScrollTimeline = typeof CSS !== 'undefined' && CSS.supports && CSS.supports('animation-timeline: scroll()');
  let heroPast = false;
  function updateScrollState() {
    if (!supportsScrollTimeline) {
      const maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      const p = Math.min(1, Math.max(0, window.scrollY / maxScroll));
      const meter = document.getElementById('scrollMeter');
      if (meter) meter.style.setProperty('--scroll-p', p.toFixed(4));
    }

    syncNavScrollspy();

    const heroDeck = document.getElementById('heroDeck');
    if (heroDeck && !isReducedMotion()) {
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
  }, { passive: true, signal });

  // OS Detection & GitHub Releases Hydration
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
    } else if (winMeta) winMeta.textContent = tag;

    const linuxBtn = document.getElementById('dlLinux');
    const linuxMeta = document.getElementById('dlLinuxMeta');
    if (linuxBtn && appImg?.browser_download_url) {
      linuxBtn.href = appImg.browser_download_url;
      if (linuxMeta) linuxMeta.textContent = `${tag}${appImg.size ? ' · ' + formatSize(appImg.size) : ''}`;
    } else if (linuxMeta) linuxMeta.textContent = tag;

    releaseState = 'live';
    latestReleaseTag = tag;
    syncReleaseStatusText();
    syncDockWithVisitorOs();
  }

  async function hydrateLatestRelease() {
    const CACHE_KEY = 'observer_latest_release_v2';
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
        signal,
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

  async function copyWithFeedback(btn, text) {
    try {
      await navigator.clipboard.writeText(text);
      announce(t('sr.copied', 'Command copied to clipboard.'));
      if (btn) {
        clearTimeout(copyTimers.get(btn));
        btn.textContent = t('hero.copied', 'Copied');
        copyTimers.set(btn, setTimeout(() => { btn.textContent = t('hero.copy', 'Copy'); }, 1500));
      }
    } catch {}
  }

  // Delegated Click Wiring (Minimal listener footprint, all bound to AbortController signal)
  document.addEventListener('click', (e) => {
    const el = e.target.closest('button, a');
    if (!el) {
      if (e.target.id === 'shotLightbox') closeLightbox();
      return;
    }

    if (el.matches('.tone-switch .tone-btn')) { setTone(el.getAttribute('data-tone')); return; }
    if (el.matches('#heroDeckTabs .deck-tab')) { selectHeroDeck(Number(el.getAttribute('data-shot'))); return; }
    if (el.id === 'heroPinsToggle') {
      pinsEnabled = !pinsEnabled;
      el.setAttribute('aria-pressed', pinsEnabled ? 'true' : 'false');
      if (!pinsEnabled) closeCalloutPopover(false);
      syncHeroPins();
      if (pinsEnabled) openCalloutPin(0);
      return;
    }
    if (el.matches('#heroCalloutLayer .callout-pin')) { openCalloutPin(Number(el.getAttribute('data-pin'))); return; }
    if (el.id === 'calloutClose') { closeCalloutPopover(true); return; }
    if (el.id === 'heroZoomBtn' || el.id === 'heroShotTrigger') { openLightbox(heroShotIdx, el); return; }
    if (el.matches('#wbScenarioTabs .wb-btn')) { renderWorkbench(el.getAttribute('data-scenario')); return; }
    if (el.matches('.calc-dir-btn')) { calcDir = el.getAttribute('data-dir') === 'n2o' ? 'n2o' : 'o2n'; updateCalculator(); return; }
    if (el.id === 'calcResetBtn') {
      const cx = document.getElementById('coordX');
      const cz = document.getElementById('coordZ');
      calcDir = 'o2n';
      if (cx) cx.value = '800';
      if (cz) cz.value = '-1600';
      updateCalculator();
      return;
    }
    if (el.matches('#plySwitch .ply-tab')) { selectPlayerSpot(Number(el.getAttribute('data-shot'))); return; }
    if (el.matches('#rpcModeTabs .rpc-tab')) { activeRpcView = el.getAttribute('data-rpc-view'); renderDiscordSim(); return; }
    if (el.matches('.rpc-state-btn')) { activeRpcState = el.getAttribute('data-rpc-state'); renderDiscordSim(); return; }
    if (el.matches('.sec-view-btn')) { activeSecMode = el.getAttribute('data-sec-mode'); renderSecurityLab(); return; }
    if (el.matches('#secTierTabs .tier-tab')) { renderSecTier(el.getAttribute('data-tier')); return; }
    if (el.matches('#modeBar .mode-pill')) { applyRuntimeMode(el.getAttribute('data-mode')); return; }
    if (el.matches('#opsTabs .ops-tab')) { renderOps(el.getAttribute('data-ops')); return; }
    if (el.hasAttribute('data-lightbox-idx')) { openLightbox(Number(el.getAttribute('data-lightbox-idx')), el); return; }
    if (el.id === 'lbPrev') { stepLightbox(-1); return; }
    if (el.id === 'lbNext') { stepLightbox(1); return; }
    if (el.id === 'lbClose') { closeLightbox(); return; }
    if (el.id === 'copyCliBtn') {
      copyWithFeedback(el, 'git clone https://github.com/Kag4286/ObserverLauncher.git && npm install && npm start');
      return;
    }
    if (el.id === 'copyOpsBtn') {
      copyWithFeedback(el, document.getElementById('opsCmdText')?.textContent || '');
      return;
    }
    if (el.id === 'motionToggle') {
      motionLite = !motionLite;
      try { localStorage.setItem('observer_web_motion', motionLite ? 'lite' : 'full'); } catch {}
      syncMotionUi();
      return;
    }
  }, { signal });

  // Intent-based hover prefetch on Hero Deck tabs
  document.getElementById('heroDeckTabs')?.addEventListener('pointerenter', (e) => {
    const tab = e.target.closest?.('.deck-tab');
    if (tab) prefetchShot(Number(tab.getAttribute('data-shot')));
  }, { capture: true, passive: true, signal });

  document.getElementById('langSelect')?.addEventListener('change', (e) => applyLocale(e.target.value), { signal });
  document.getElementById('coordX')?.addEventListener('input', () => updateCalculator(true), { signal });
  document.getElementById('coordZ')?.addEventListener('input', () => updateCalculator(true), { signal });
  document.getElementById('rpcOptName')?.addEventListener('change', () => renderDiscordSim(true), { signal });
  document.getElementById('rpcOptPlayers')?.addEventListener('change', () => renderDiscordSim(true), { signal });

  // Keyboard Navigation (Lightbox focus trap + Escape for callout + WAI-ARIA Tablists with Home/End)
  document.addEventListener('keydown', (e) => {
    const lb = document.getElementById('shotLightbox');
    if (lb && !lb.hidden) {
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
      return;
    }

    if (e.key === 'Escape' && activePinIdx >= 0) {
      closeCalloutPopover(true);
      return;
    }

    const tablist = document.activeElement?.closest?.('[role="tablist"]');
    if (tablist && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) {
      const tabs = [...tablist.querySelectorAll('[role="tab"]')];
      const idx = tabs.indexOf(document.activeElement);
      if (idx === -1) return;
      e.preventDefault();
      let nextIdx = idx;
      if (e.key === 'Home') nextIdx = 0;
      else if (e.key === 'End') nextIdx = tabs.length - 1;
      else nextIdx = (idx + ((e.key === 'ArrowRight' || e.key === 'ArrowDown') ? 1 : -1) + tabs.length) % tabs.length;
      const next = tabs[nextIdx];
      if (next) { next.focus(); next.click(); }
    }
  }, { signal });

  attachSwipe(document.getElementById('heroDeckStage'), () => selectHeroDeck((heroShotIdx + 3) % 4, -1), () => selectHeroDeck((heroShotIdx + 1) % 4, 1));
  attachSwipe(document.getElementById('shotLightbox'), () => stepLightbox(-1), () => stepLightbox(1));

  // Interactive .mca Portal Radar Drag/Click + Keyboard Arrows
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
    }, { signal });
    radarPad.addEventListener('pointermove', (e) => {
      if (!radarDragging) return;
      applyRadarPointer(e.clientX, e.clientY);
    }, { signal });
    const endRadarDrag = () => {
      if (!radarDragging) return;
      radarDragging = false;
      radarWrap?.classList.remove('is-dragging');
      fireRadarPacket();
    };
    radarPad.addEventListener('pointerup', endRadarDrag, { signal });
    radarPad.addEventListener('pointercancel', endRadarDrag, { signal });
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
    }, { signal });
  }

  // Horizontal Filmstrip Scrub Rail + Element-Scoped Pointer Capture Drag (Zero Window Listeners)
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
    filmstrip.addEventListener('scroll', syncFilmRail, { passive: true, signal });
    let draggingStrip = false, dragStartX = 0, dragStartScroll = 0, movedStrip = false;
    filmstrip.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse' || filmstrip.scrollWidth <= filmstrip.clientWidth) return;
      draggingStrip = true;
      movedStrip = false;
      dragStartX = e.clientX;
      dragStartScroll = filmstrip.scrollLeft;
      filmstrip.classList.add('is-grabbing');
      if (filmstrip.setPointerCapture) filmstrip.setPointerCapture(e.pointerId);
    }, { signal });
    filmstrip.addEventListener('pointermove', (e) => {
      if (!draggingStrip) return;
      const dx = e.clientX - dragStartX;
      if (Math.abs(dx) > 4) movedStrip = true;
      filmstrip.scrollLeft = dragStartScroll - dx;
    }, { passive: true, signal });
    const endStripDrag = () => {
      if (!draggingStrip) return;
      draggingStrip = false;
      filmstrip.classList.remove('is-grabbing');
    };
    filmstrip.addEventListener('pointerup', endStripDrag, { signal });
    filmstrip.addEventListener('pointercancel', endStripDrag, { signal });
    filmstrip.addEventListener('click', (ev) => {
      if (movedStrip) {
        movedStrip = false;
        ev.stopPropagation();
        ev.preventDefault();
      }
    }, { capture: true, signal });
    syncFilmRail();
  }

  document.fonts?.ready?.then(() => requestAnimationFrame(syncAllGlides));

  // Expose deterministic teardown hook for leak verification
  window.__observerWebsiteCleanup = () => {
    appAbort.abort();
    activeObservers.forEach((o) => { try { o.disconnect(); } catch {} });
    activeObservers.length = 0;
  };

  // Boot
  highlightVisitorOs();
  renderCurrentLocale();
  if (currentLang !== 'en') applyLocale(currentLang);
  setupObservers();
  updateScrollState();
  hydrateLatestRelease();
})();
