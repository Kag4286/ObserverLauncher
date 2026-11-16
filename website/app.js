// website/app.js — Motion 2.0 gliding tabs, lightbox, touch swipe, runtime switcher, 7-locale i18n & GitHub Releases hydration
(() => {
  document.documentElement.classList.add('has-motion-js');

  const SUPPORTED_LANGS = ['en', 'vi', 'es', 'pt-BR', 'de', 'ru', 'zh-CN'];
  const SHOTS = [
    { file: 'docs/screenshot-overview.png', tabKey: 'sc.0.tab', titleKey: 'sc.0.title', descKey: 'sc.0.desc', fbTab: 'Overview', fbTitle: 'Overview Control Deck', fbDesc: 'Multi-instance sidebar, live server status, LAN/Tunnel quick sharing, and Geyser status.' },
    { file: 'docs/screenshot-wizard.png', tabKey: 'sc.1.tab', titleKey: 'sc.1.title', descKey: 'sc.1.desc', fbTab: 'Create Wizard', fbTitle: 'Multi-Engine Creation Wizard', fbDesc: 'Pick Vanilla, Paper, Fabric, Forge, NeoForge, Pumpkin (Rust), or Horizon (Rust) up to MC 26.3.' },
    { file: 'docs/screenshot-console.png', tabKey: 'sc.2.tab', titleKey: 'sc.2.title', descKey: 'sc.2.desc', fbTab: 'Console', fbTitle: 'Live Filtered Console', fbDesc: 'Filter INF/WRN/ERR/CMD lines, search logs, click player names, and send commands.' },
    { file: 'docs/screenshot-performance.png', tabKey: 'sc.3.tab', titleKey: 'sc.3.title', descKey: 'sc.3.desc', fbTab: 'Performance', fbTitle: 'TPS, MSPT, CPU & RAM Telemetry', fbDesc: 'Track live and historical tick health from 15 minutes up to 30 days.' },
    { file: 'docs/screenshot-content.png', tabKey: 'sc.4.tab', titleKey: 'sc.4.title', descKey: 'sc.4.desc', fbTab: 'Content (25/pg)', fbTitle: 'Paginated Content Manager', fbDesc: 'Browse large mod/plugin folders at 25 items per page with quick toggles and config editor.' },
    { file: 'docs/screenshot-marketplace.png', tabKey: 'sc.5.tab', titleKey: 'sc.5.title', descKey: 'sc.5.desc', fbTab: 'Marketplace', fbTitle: 'Modrinth & CurseForge Browser', fbDesc: 'Install plugins, mods, datapacks, and .mrpack bundles matching your server loader.' },
    { file: 'docs/screenshot-player-inspector.png', tabKey: 'sc.6.tab', titleKey: 'sc.6.title', descKey: 'sc.6.desc', fbTab: '3D Inspector', fbTitle: '3D Player Inspector', fbDesc: 'Interactive WebGL skin + armor preview supporting 1.21.5+ & 26.x equipment.' },
    { file: 'docs/screenshot-inventory.png', tabKey: 'sc.7.tab', titleKey: 'sc.7.title', descKey: 'sc.7.desc', fbTab: 'Inventory', fbTitle: '9x4 Inventory & Ender Chest', fbDesc: 'Search items, inspect enchantments with tooltips, and edit saved stats with backup.' },
    { file: 'docs/screenshot-worldmap.png', tabKey: 'sc.8.tab', titleKey: 'sc.8.title', descKey: 'sc.8.desc', fbTab: 'World Map', fbTitle: 'Offline .mca World Map', fbDesc: 'Explore biomes, terrain relief, structures, 1:8 portals, and Xaero/JourneyMap waypoints.' },
    { file: 'docs/screenshot-MCP.png', tabKey: 'sc.9.tab', titleKey: 'sc.9.title', descKey: 'sc.9.desc', fbTab: 'MCP 80 Tools', fbTitle: 'Local MCP Server (80 Tools)', fbDesc: 'Connect Claude Desktop or Cursor over stdio MCP with confirmation tiers and secret redaction.' },
    { file: 'docs/screenshot-remote-ui.png', tabKey: 'sc.10.tab', titleKey: 'sc.10.title', descKey: 'sc.10.desc', fbTab: 'Remote Web UI', fbTitle: 'Remote Web Dashboard (SSE)', fbDesc: 'Manage status, console logs, players, and backups from browser behind Bearer auth.' },
  ];

  const RUNTIME_PROFILES = {
    all: { boot: 'Java 8–25 & Rust', ram: '~120 MB – 4 GB', javaKey: 'spec.javaAll', net: 'Playit · Pinggy · SSE · MCP' },
    java: { boot: '3 – 18 s', ram: '1.2 – 4.0 GB', javaKey: 'spec.javaAuto', net: 'Playit TCP · Modrinth · CurseForge' },
    rust: { boot: '< 0.4 s', ram: '~100 – 250 MB', javaKey: 'spec.javaNone', net: 'Playit · server.toml / pumpkin.toml' },
    crossplay: { boot: '4 – 14 s', ram: '1.5 – 3.5 GB', javaKey: 'spec.javaAuto', netKey: 'spec.netCross' },
    automation: { boot: 'Headless Node 22+', ram: '~45 MB Controller', javaKey: 'spec.javaAll', netKey: 'spec.netCli' },
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

  let activeShot = 0;
  let lastShot = 0;
  let activeMode = 'all';
  let currentLang = detectInitialLang();
  let lbLastTrigger = null;

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
    const dict = (window.WEB_LOCALES && window.WEB_LOCALES[currentLang]) || {};
    const en = (window.WEB_LOCALES && window.WEB_LOCALES.en) || {};
    return dict[key] ?? en[key] ?? fallback;
  }

  function applyLocale(lang) {
    currentLang = SUPPORTED_LANGS.includes(lang) ? lang : 'en';
    document.documentElement.lang = currentLang;
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
    renderShowcaseRail(false);
    renderActiveShot(0);
    applyRuntimeMode(activeMode);
    syncDockWithVisitorOs();
    syncLightboxContent();
  }

  // Showcase Tabs + GPU Gliding Indicator (#scGlide)
  function glideToActiveTab() {
    const rail = document.getElementById('showcaseRail');
    const glide = document.getElementById('scGlide');
    const btn = rail?.querySelector('.sc-tab.active');
    if (!rail || !glide || !btn) return;
    const isHorizontal = window.innerWidth <= 960;
    if (isHorizontal) {
      glide.style.setProperty('--sc-gx', `${btn.offsetLeft}px`);
      glide.style.setProperty('--sc-gsx', `${Math.max(0.2, btn.offsetWidth / 48)}`);
    } else {
      glide.style.setProperty('--sc-gy', `${btn.offsetTop + 4}px`);
      glide.style.setProperty('--sc-gsy', `${Math.max(0.2, (btn.offsetHeight - 8) / 36)}`);
    }
  }

  function preloadShot(idx) {
    if (idx < 0 || idx >= SHOTS.length) return;
    const img = new Image();
    img.src = assetUrl(SHOTS[idx].file);
  }

  function renderShowcaseRail(centerActive = false) {
    const rail = document.getElementById('showcaseRail');
    const glide = document.getElementById('scGlide');
    if (!rail) return;
    rail.querySelectorAll('.sc-tab').forEach((n) => n.remove());
    SHOTS.forEach((s, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sc-tab' + (idx === activeShot ? ' active' : '');
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-selected', idx === activeShot ? 'true' : 'false');
      const num = String(idx + 1).padStart(2, '0');
      btn.innerHTML = `<span>${t(s.tabKey, s.fbTab)}</span><span class="sc-tab-num">${num}</span>`;
      btn.addEventListener('click', () => selectShot(idx, true));
      rail.appendChild(btn);
    });
    if (glide && glide.parentElement !== rail) rail.prepend(glide);
    requestAnimationFrame(() => {
      glideToActiveTab();
      if (centerActive && window.innerWidth <= 960) {
        const activeBtn = rail.querySelector('.sc-tab.active');
        if (activeBtn && activeBtn.scrollIntoView) {
          activeBtn.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', inline: 'center', block: 'nearest' });
        }
      }
    });
  }

  function renderActiveShot(dir = 0) {
    const s = SHOTS[activeShot];
    const img = document.getElementById('scImg');
    const title = document.getElementById('scTitle');
    const desc = document.getElementById('scDesc');
    const counter = document.getElementById('scCounter');
    if (counter) counter.textContent = `${String(activeShot + 1).padStart(2, '0')} / ${SHOTS.length}`;
    if (img) {
      if (dir !== 0 && !prefersReducedMotion()) {
        img.classList.remove('stage-enter-fwd', 'stage-enter-back');
        void img.offsetWidth;
        img.classList.add(dir > 0 ? 'stage-enter-fwd' : 'stage-enter-back');
      }
      img.src = assetUrl(s.file);
      img.alt = t(s.titleKey, s.fbTitle);
    }
    if (title) title.textContent = t(s.titleKey, s.fbTitle);
    if (desc) desc.textContent = t(s.descKey, s.fbDesc);
    preloadShot((activeShot + 1) % SHOTS.length);
    preloadShot((activeShot - 1 + SHOTS.length) % SHOTS.length);
  }

  function selectShot(idx, centerTab = false) {
    const next = (idx + SHOTS.length) % SHOTS.length;
    const dir = next === activeShot ? 0 : (next > activeShot ? 1 : -1);
    lastShot = activeShot;
    activeShot = next;
    renderShowcaseRail(centerTab);
    renderActiveShot(dir);
    syncLightboxContent();
  }

  // Lightbox Modal Controller
  function syncLightboxContent() {
    const lb = document.getElementById('shotLightbox');
    if (!lb || lb.hidden) return;
    const s = SHOTS[activeShot];
    const img = document.getElementById('lbImg');
    const title = document.getElementById('lbTitle');
    const desc = document.getElementById('lbDesc');
    const counter = document.getElementById('lbCounter');
    if (counter) counter.textContent = `${String(activeShot + 1).padStart(2, '0')} / ${SHOTS.length}`;
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
    activeShot = (idx + SHOTS.length) % SHOTS.length;
    lb.hidden = false;
    document.body.style.overflow = 'hidden';
    document.getElementById('mobileDock')?.classList.remove('visible');
    syncLightboxContent();
    renderShowcaseRail(false);
    renderActiveShot(0);
    document.getElementById('lbClose')?.focus();
  }

  function closeLightbox() {
    const lb = document.getElementById('shotLightbox');
    if (!lb || lb.hidden) return;
    lb.hidden = true;
    document.body.style.overflow = '';
    updateScrollState();
    if (lbLastTrigger && lbLastTrigger.focus) lbLastTrigger.focus();
  }

  // Touch Swipe Helper (horizontal >=42px with limited vertical drift)
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

  // Runtime Mode Switcher (#engines)
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
    if (elBoot) elBoot.textContent = prof.boot;
    if (elRam) elRam.textContent = prof.ram;
    if (elJava) elJava.textContent = t(prof.javaKey, 'Auto OpenJDK / None on Rust');
    if (elNet) elNet.textContent = prof.netKey ? t(prof.netKey, prof.net || '') : prof.net;

    document.querySelectorAll('#engineStrip .engine-item').forEach((card) => {
      const modes = (card.getAttribute('data-modes') || '').split(/\s+/);
      const isMatch = activeMode === 'all' || modes.includes(activeMode);
      card.classList.toggle('is-dimmed', !isMatch);
      card.classList.toggle('is-match', activeMode !== 'all' && isMatch);
    });
  }

  // Count-up Tween + Scroll Reveal Choreography
  function tweenProofNumbers() {
    const nodes = document.querySelectorAll('.proof-num[data-count]');
    if (prefersReducedMotion()) {
      nodes.forEach((n) => {
        const target = Number(n.getAttribute('data-count')) || 0;
        const pre = n.getAttribute('data-prefix') || '';
        const suf = n.getAttribute('data-suffix') || '';
        n.textContent = `${pre}${target}${suf}`;
      });
      return;
    }
    const start = performance.now();
    const dur = 680;
    function step(now) {
      const p = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      nodes.forEach((n) => {
        const target = Number(n.getAttribute('data-count')) || 0;
        const pre = n.getAttribute('data-prefix') || '';
        const suf = n.getAttribute('data-suffix') || '';
        n.textContent = `${pre}${Math.round(target * eased)}${suf}`;
      });
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function setupScrollReveals() {
    const items = document.querySelectorAll('.reveal-item');
    if (!('IntersectionObserver' in window) || prefersReducedMotion()) {
      items.forEach((el) => el.classList.add('is-revealed'));
      return;
    }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-revealed');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -24px 0px' });
    items.forEach((el) => io.observe(el));
  }

  // Desktop-only subtle cursor border/wash coordinates
  function setupCursorSpotlight() {
    if (!window.matchMedia || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    document.querySelectorAll('#pillarGrid .pillar-cell, #engineStrip .engine-item').forEach((cell) => {
      cell.addEventListener('pointermove', (e) => {
        const r = cell.getBoundingClientRect();
        cell.style.setProperty('--mx', `${e.clientX - r.left}px`);
        cell.style.setProperty('--my', `${e.clientY - r.top}px`);
      }, { passive: true });
    });
  }

  // Scroll Meter + Sticky Mobile Download Dock
  let heroPast = false;
  function updateScrollState() {
    const maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    const p = Math.min(1, Math.max(0, window.scrollY / maxScroll));
    const meter = document.getElementById('scrollMeter');
    if (meter) meter.style.setProperty('--scroll-p', p.toFixed(4));

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
      heroPast = !entries[0].isIntersecting && window.scrollY > 120;
      updateScrollState();
    }, { threshold: 0 }).observe(heroActions);
  }

  // OS Detection & GitHub Releases Assets
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
    const frameLabel = document.getElementById('heroFrameLabel');
    if (verEl) verEl.textContent = tag;
    if (frameLabel) frameLabel.textContent = `ObserverLauncher ${tag} — Control Deck`;

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
      if (!res.ok) return;
      const data = await res.json();
      applyReleaseAssets(data);
      try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), data })); } catch {}
    } catch {}
  }

  // Event Wiring
  document.getElementById('langSelect')?.addEventListener('change', (e) => applyLocale(e.target.value));
  document.getElementById('scPrev')?.addEventListener('click', () => selectShot(activeShot - 1, true));
  document.getElementById('scNext')?.addEventListener('click', () => selectShot(activeShot + 1, true));
  document.getElementById('scZoomBtn')?.addEventListener('click', (e) => openLightbox(activeShot, e.currentTarget));
  document.getElementById('scImgTrigger')?.addEventListener('click', (e) => openLightbox(activeShot, e.currentTarget));
  document.getElementById('heroZoomBtn')?.addEventListener('click', (e) => openLightbox(0, e.currentTarget));
  document.getElementById('heroShotTrigger')?.addEventListener('click', (e) => openLightbox(0, e.currentTarget));

  document.getElementById('lbPrev')?.addEventListener('click', () => selectShot(activeShot - 1, false));
  document.getElementById('lbNext')?.addEventListener('click', () => selectShot(activeShot + 1, false));
  document.getElementById('lbClose')?.addEventListener('click', closeLightbox);
  document.getElementById('shotLightbox')?.addEventListener('click', (e) => {
    if (e.target.id === 'shotLightbox') closeLightbox();
  });

  document.getElementById('showcaseRail')?.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      e.preventDefault();
      selectShot(activeShot + 1, true);
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      e.preventDefault();
      selectShot(activeShot - 1, true);
    }
  });

  window.addEventListener('keydown', (e) => {
    const lb = document.getElementById('shotLightbox');
    if (!lb || lb.hidden) return;
    if (e.key === 'Escape') closeLightbox();
    else if (e.key === 'ArrowLeft') selectShot(activeShot - 1, false);
    else if (e.key === 'ArrowRight') selectShot(activeShot + 1, false);
  });

  document.querySelectorAll('#modeBar .mode-pill').forEach((btn) => {
    btn.addEventListener('click', () => applyRuntimeMode(btn.getAttribute('data-mode')));
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

  attachSwipe(document.getElementById('showcaseStage'), () => selectShot(activeShot + 1, true), () => selectShot(activeShot - 1, true));
  attachSwipe(document.getElementById('shotLightbox'), () => selectShot(activeShot + 1, false), () => selectShot(activeShot - 1, false));
  window.addEventListener('resize', () => requestAnimationFrame(glideToActiveTab), { passive: true });
  window.addEventListener('load', () => {
    SHOTS.forEach((_, i) => setTimeout(() => preloadShot(i), i * 80));
  });

  // Boot
  highlightVisitorOs();
  applyLocale(currentLang);
  setupScrollReveals();
  setupCursorSpotlight();
  tweenProofNumbers();
  updateScrollState();
  hydrateLatestRelease();
})();
