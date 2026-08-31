// mockup module — handles demo sidebar switching and live-ish metrics
export function initMockup() {
  const sideButtons = document.querySelectorAll('.demo-side [data-view]');
  const views = {
    overview: document.getElementById('view-overview'),
    console: document.getElementById('view-console'),
    players: document.getElementById('view-players'),
    perf: document.getElementById('view-perf'),
    market: document.getElementById('view-market')
  };

  function switchView(viewName) {
    sideButtons.forEach(btn => btn.classList.toggle('on', btn.getAttribute('data-view') === viewName));
    Object.entries(views).forEach(([name, el]) => {
      if (!el) return;
      const show = name === viewName;
      if (show) {
        el.hidden = false;
        el.classList.remove('dview-out');
        // animate SVG charts on view enter
        el.querySelectorAll('svg path').forEach(p => {
          const len = p.getTotalLength?.() || 0;
          if (len) {
            p.style.strokeDasharray = len;
            p.style.strokeDashoffset = len;
            requestAnimationFrame(() => {
              p.style.transition = 'stroke-dashoffset 1.1s cubic-bezier(.2,.75,.3,1)';
              p.style.strokeDashoffset = '0';
            });
          }
        });
      } else {
        el.classList.add('dview-out');
        setTimeout(() => { if (el.classList.contains('dview-out')) el.hidden = true; }, 180);
      }
    });
  }

  sideButtons.forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.getAttribute('data-view')));
  });

  // ensure initial state
  switchView('overview');

  // fake live metrics
  const dTps = document.getElementById('dTps');
  const dCpu = document.getElementById('dCpu');
  const dRam = document.getElementById('dRam');
  const dMspt = document.getElementById('dMspt');
  const orbCpu = document.querySelector('.orb-b b');
  const orbRam = document.querySelector('.orb-c b');

  function randomBetween(min, max, decimals = 1) {
    const val = min + Math.random() * (max - min);
    return Number(val.toFixed(decimals));
  }

  function updateMetrics() {
    const tps = randomBetween(19.7, 20.0, 2);
    const cpu = randomBetween(8, 18, 0);
    const ram = randomBetween(1.8, 2.6, 1);
    const mspt = randomBetween(8, 16, 1);
    if (dTps) dTps.textContent = tps.toFixed(2);
    if (dCpu) { dCpu.textContent = cpu + '%'; dCpu.className = cpu < 15 ? 'g' : ''; }
    if (dRam) dRam.textContent = ram.toFixed(1) + ' GB';
    if (dMspt) dMspt.textContent = mspt.toFixed(1);
    if (orbCpu) orbCpu.textContent = cpu + '%';
    if (orbRam) orbRam.textContent = ram.toFixed(1) + 'G';
  }

  updateMetrics();
  setInterval(updateMetrics, 2000);

  // fake install buttons in marketplace
  document.querySelectorAll('.inst').forEach(btn => {
    btn.addEventListener('click', () => {
      const lbl = btn.querySelector('.lbl');
      const bar = btn.querySelector('.bar');
      if (btn.classList.contains('done')) return;
      btn.classList.add('done');
      if (bar) {
        bar.style.transition = 'width .6s ease';
        bar.style.width = '100%';
      }
      if (lbl) lbl.textContent = '✓ installed';
    });
  });
}
