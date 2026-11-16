// website/app.js — Dynamic asset path resolution, 7-locale i18n, GitHub Releases download links & 11-screen switcher
(() => {
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

  // When opened directly inside website/ locally, parent repo holds docs/, build/, and src/renderer/assets/
  const isLocalWebsiteSubdir = /\/website(\/|$)/.test(location.pathname);
  function assetUrl(rel) {
    if (!isLocalWebsiteSubdir) return rel;
    if (rel.startsWith('fonts/') || rel.startsWith('software/')) return '../src/renderer/assets/' + rel;
    return '../' + rel;
  }

  // Rewrite static asset paths on load so both GitHub Pages root and local preview work cleanly
  const fontsLink = document.getElementById('fontsStylesheet');
  if (fontsLink) fontsLink.href = assetUrl('fonts/fonts.css');
  const fav = document.getElementById('faviconLink');
  if (fav) fav.href = assetUrl('build/icon.png');
  document.querySelectorAll('[data-asset]').forEach((el) => {
    const rel = el.getAttribute('data-asset');
    if (rel) el.setAttribute('src', assetUrl(rel));
  });

  let activeShot = 0;
  let currentLang = detectInitialLang();

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
    if (SUPPORTED_LANGS.includes(base)) return base;
    return 'en';
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
    renderShowcaseRail();
    renderActiveShot();
  }

  function renderShowcaseRail() {
    const rail = document.getElementById('showcaseRail');
    if (!rail) return;
    rail.innerHTML = '';
    SHOTS.forEach((s, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sc-tab' + (idx === activeShot ? ' active' : '');
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-selected', idx === activeShot ? 'true' : 'false');
      const num = String(idx + 1).padStart(2, '0');
      btn.innerHTML = `<span>${t(s.tabKey, s.fbTab)}</span><span class="sc-tab-num">${num}</span>`;
      btn.addEventListener('click', () => { activeShot = idx; renderShowcaseRail(); renderActiveShot(); });
      rail.appendChild(btn);
    });
  }

  function renderActiveShot() {
    const s = SHOTS[activeShot];
    const img = document.getElementById('scImg');
    const title = document.getElementById('scTitle');
    const desc = document.getElementById('scDesc');
    if (img) {
      img.src = assetUrl(s.file);
      img.alt = t(s.titleKey, s.fbTitle);
    }
    if (title) title.textContent = t(s.titleKey, s.fbTitle);
    if (desc) desc.textContent = t(s.descKey, s.fbDesc);
  }

  // Highlight visitor's OS primary CTA while keeping both downloadable
  function highlightVisitorOs() {
    const ua = (navigator.userAgent || '').toLowerCase();
    const isLinux = ua.includes('linux') && !ua.includes('android');
    const winBtn = document.getElementById('dlWin');
    const linuxBtn = document.getElementById('dlLinux');
    if (isLinux && winBtn && linuxBtn) {
      winBtn.classList.remove('primary');
      linuxBtn.classList.add('primary');
    }
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

  document.getElementById('langSelect')?.addEventListener('change', (e) => applyLocale(e.target.value));
  document.getElementById('scPrev')?.addEventListener('click', () => {
    activeShot = (activeShot - 1 + SHOTS.length) % SHOTS.length;
    renderShowcaseRail();
    renderActiveShot();
  });
  document.getElementById('scNext')?.addEventListener('click', () => {
    activeShot = (activeShot + 1) % SHOTS.length;
    renderShowcaseRail();
    renderActiveShot();
  });
  document.getElementById('showcaseRail')?.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      e.preventDefault();
      activeShot = (activeShot + 1) % SHOTS.length;
      renderShowcaseRail();
      renderActiveShot();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      e.preventDefault();
      activeShot = (activeShot - 1 + SHOTS.length) % SHOTS.length;
      renderShowcaseRail();
      renderActiveShot();
    }
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

  highlightVisitorOs();
  applyLocale(currentLang);
  hydrateLatestRelease();
})();
