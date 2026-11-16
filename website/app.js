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

  // Workbench manual-vs-observer comparisons (en & vi detailed, others cleanly fall back or localize labels)
  const WORKBENCH = {
    cgnat: {
      en: {
        count: '5 separate tools',
        manual: ['Find and install matching Java 8/17/21/25 manually', 'Download Paper.jar, write run.bat, run once to flip eula.txt', 'Configure Playit agent or Radmin VPN outside the console', 'Install Dynmap/BlueMap + open web ports just to view biomes', 'Run separate backup zip scripts'],
        outcome: '1 window, 0 port forwarding',
        summary: 'Pick a folder and Paper version, click Start (OpenJDK downloads if missing), toggle Playit.gg in Overview, and open the built-in .mca World Map without installing Dynmap.',
        modules: 'wizard.js + java.js + tunnel.js + worldmap-worker.js',
      },
      vi: {
        count: '5 công cụ rời rạc',
        manual: ['Tự tìm tải đúng bản Java 8/17/21/25 cho từng bản MC', 'Tải Paper.jar, tạo run.bat, chạy lỗi lần đầu để sửa eula.txt', 'Cài thêm Playit CLI hoặc Radmin VPN ở cửa sổ ngoài', 'Cài plugin Dynmap/BlueMap nặng máy để xem bản đồ', 'Tự nén thư mục world thủ công nếu sợ hỏng save'],
        outcome: '1 cửa sổ, khỏi mở port modem',
        summary: 'Chọn thư mục và phiên bản Paper, bấm Start (thiếu Java tự kéo OpenJDK), bật công tắc Playit.gg ngay trong Overview, và mở thẳng World Map .mca không cần plugin.',
        modules: 'wizard.js + java.js + tunnel.js + worldmap-worker.js',
      },
    },
    modpack: {
      en: {
        count: 'Slow folder hunting',
        manual: ['Scroll endless 200-mod folders in Windows Explorer', 'Discover duplicate mod IDs or Forge/Fabric mismatch only on crash', 'Hunt missing libraries manually in latest.log', 'Compare server.properties text diffs by eye', 'Lose world files if an updated mod breaks startup'],
        outcome: 'Paginated + pre-flight checked',
        summary: 'Paginates mods cleanly at 25 items per page, scans duplicate modIds and loader mismatches before boot, tracks server.properties snapshots, and supports one-click update rollback.',
        modules: '01-content.js (25/pg) + content-conflicts.js + rollback',
      },
      vi: {
        count: 'Quản lý file thủ công',
        manual: ['Kéo danh sách 200+ file mod dài lê thê trong Explorer', 'Chỉ phát hiện trùng modId hoặc nhầm Forge/Fabric lúc server văng crash', 'Lội log dài để tìm thư viện phụ thuộc bị thiếu', 'Sửa file config/properties không có lịch sử hoàn tác', 'Hỏng save khi lỡ tay cập nhật một mod lỗi'],
        outcome: '25 mục/trang + quét lỗi trước khi chạy',
        summary: 'Chia trang 25 mod mỗi trang gọn gàng, quét trùng lặp và sai loader trước khi khởi động, kèm cây sửa file config và nút rollback nếu cập nhật lỗi.',
        modules: '01-content.js (25/trang) + content-conflicts.js + rollback',
      },
    },
    crossplay: {
      en: {
        count: 'Fragile crossplay YAML',
        manual: ['Download Geyser and Floodgate separately and match versions', 'Run a TCP tunnel without UDP support (Bedrock phones time out)', 'Edit config.yml clone-remote-port and auth-type by trial and error', 'Strip YAML comments when GUI editors rewrite configs'],
        outcome: 'UDP Pinggy + line-level repair',
        summary: 'Runs Pinggy UDP alongside Playit TCP for Bedrock crossplay, inspects Geyser config.yml for the 4 common failures, backs up first, and patches line by line keeping your comments.',
        modules: 'geyser.js + pinggy-tunnel.js + tunnel-manager.js',
      },
      vi: {
        count: 'Dễ sai cấu hình YAML',
        manual: ['Tải rời Geyser và Floodgate rồi tự ghép bản tương thích', 'Dùng tunnel chỉ có TCP nên điện thoại (Bedrock) không vào được', 'Loay hoay sửa clone-remote-port, auth-type trong config.yml', 'Mất sạch comment ghi chú khi tool bên ngoài ghi đè file'],
        outcome: 'Pinggy UDP + tự sửa từng dòng có backup',
        summary: 'Chạy song song Pinggy UDP cho Bedrock và Playit TCP cho Java, tự kiểm tra 4 lỗi hay gặp trong Geyser config.yml, sao lưu trước rồi sửa đúng dòng lỗi mà giữ nguyên comment.',
        modules: 'geyser.js + pinggy-tunnel.js + tunnel-manager.js',
      },
    },
    rust: {
      en: {
        count: 'CLI flags & TOML juggling',
        manual: ['Track upstream Rust binary releases for Pumpkin or Horizon by hand', 'Verify SHA-256 asset hashes manually in PowerShell/bash', 'Monitor non-JVM process memory without playerdata .dat support', 'Fail JVM startup scripts looking for server.jar or eula.txt'],
        outcome: '~120 MB idle RAM, zero Java',
        summary: 'Pulls verified Pumpkin (0.2.2) and Horizon releases via cached GitHub checksums, syncs pumpkin.toml / server.toml, and inspects live players even before .dat saves exist.',
        modules: 'pumpkin.js + horizon.js + github-releases.js + 03-players.js',
      },
      vi: {
        count: 'Chỉnh tay binary & TOML',
        manual: ['Tự canh bản release mới của Pumpkin hoặc Horizon trên GitHub', 'Tự kiểm tra mã SHA-256 bằng PowerShell/Terminal', 'Script cũ báo lỗi vì tìm Java, eula.txt và server.jar', 'Không soi được người chơi vì server Rust chưa tạo file .dat'],
        outcome: '~120 MB RAM chờ, không cần Java',
        summary: 'Tự tải Pumpkin (0.2.2) và Horizon kèm kiểm tra SHA-256, đồng bộ file TOML và xem trước người chơi trực tiếp ngay cả khi thế giới chưa lưu file .dat.',
        modules: 'pumpkin.js + horizon.js + github-releases.js + 03-players.js',
      },
    },
  };

  const RUNTIME_PROFILES = {
    all: { boot: 'Java 8 to 25 & Rust', ram: '~120 MB to 4 GB', javaKey: 'spec.javaAll', net: 'Playit, Pinggy, SSE, MCP' },
    java: { boot: '3 to 18 s', ram: '1.2 to 4.0 GB', javaKey: 'spec.javaAuto', net: 'Playit TCP, Modrinth, CurseForge' },
    rust: { boot: '< 0.4 s', ram: '~100 to 250 MB', javaKey: 'spec.javaNone', net: 'Playit, server.toml, pumpkin.toml' },
    crossplay: { boot: '4 to 14 s', ram: '1.5 to 3.5 GB', javaKey: 'spec.javaAuto', netKey: 'spec.netCross' },
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

  let heroShotIdx = 0;
  let lbShotIdx = 0;
  let plyShotIdx = 6;
  let activeScenario = 'cgnat';
  let activeMode = 'all';
  let calcDir = 'o2n';
  let currentLang = detectInitialLang();
  let lbLastTrigger = null;
  let releaseState = 'loading'; // 'loading' | 'live' | 'fallback'
  let latestReleaseTag = '';

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
    selectHeroDeck(heroShotIdx, 0);
    renderWorkbench(activeScenario, false);
    updateCalculator(false);
    selectPlayerSpot(plyShotIdx, false);
    applyRuntimeMode(activeMode);
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

  function renderWorkbench(key, animate = true) {
    activeScenario = WORKBENCH[key] ? key : 'cgnat';
    document.querySelectorAll('#wbScenarioTabs .wb-btn').forEach((btn) => {
      const match = btn.getAttribute('data-scenario') === activeScenario;
      btn.classList.toggle('active', match);
      btn.setAttribute('aria-selected', match ? 'true' : 'false');
    });
    const pack = WORKBENCH[activeScenario];
    const data = pack[currentLang] || pack.en;
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
    if (mEl) mEl.textContent = data.modules;

    const panel = document.getElementById('wbDiffPanel');
    if (panel && animate && !prefersReducedMotion()) {
      panel.classList.remove('diff-animate');
      void panel.offsetWidth;
      panel.classList.add('diff-animate');
    }
    requestAnimationFrame(glideWbTabs);
  }

  // Live 1:8 Overworld / Nether Coordinate Bridge (exact worldmap.js math)
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
    if (formula) formula.textContent = calcDir === 'o2n' ? 'floor(X / 8), floor(Z / 8)' : 'X * 8, Z * 8';

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

  // Scroll Reveal + Scroll Meter + Sticky Mobile Dock
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
    }, { threshold: 0.1, rootMargin: '0px 0px -20px 0px' });
    items.forEach((el) => io.observe(el));
  }

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
    if (e.key === 'Escape') closeLightbox();
    else if (e.key === 'ArrowLeft') stepLightbox(-1);
    else if (e.key === 'ArrowRight') stepLightbox(1);
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

  attachSwipe(document.getElementById('heroDeckStage'), () => selectHeroDeck((heroShotIdx + 3) % 4, -1), () => selectHeroDeck((heroShotIdx + 1) % 4, 1));
  attachSwipe(document.getElementById('shotLightbox'), () => stepLightbox(-1), () => stepLightbox(1));
  window.addEventListener('resize', () => requestAnimationFrame(() => { glideHeroDeck(); glideWbTabs(); }), { passive: true });
  document.fonts?.ready?.then(() => requestAnimationFrame(() => { glideHeroDeck(); glideWbTabs(); }));
  window.addEventListener('load', () => {
    SHOTS.forEach((s, i) => setTimeout(() => { const img = new Image(); img.src = assetUrl(s.file); }, i * 80));
  });

  // Boot
  highlightVisitorOs();
  applyLocale(currentLang);
  setupScrollReveals();
  updateScrollState();
  hydrateLatestRelease();
})();
