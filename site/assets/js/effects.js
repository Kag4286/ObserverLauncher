// effects.js — ObserverLauncher signature interactions
// Eye-tracking, 3D tilt, scroll reveals, scan ring, progress bar.

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function initProgressBar() {
  const bar = document.getElementById('progress');
  if (!bar) return;
  let ticking = false;
  const update = () => {
    const h = document.documentElement;
    const scrolled = h.scrollTop / (h.scrollHeight - h.clientHeight || 1);
    bar.style.width = `${Math.min(100, scrolled * 100)}%`;
    ticking = false;
  };
  window.addEventListener('scroll', () => {
    if (!ticking) { requestAnimationFrame(update); ticking = true; }
  }, { passive: true });
  update();
}

function initEyeTracking() {
  const stage = document.getElementById('cubeStage');
  const eyes = stage?.querySelectorAll('.eye');
  if (!stage || !eyes || prefersReducedMotion) return;

  const rect = stage.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;

  const onMove = e => {
    const dx = e.clientX - cx;
    const dy = e.clientY - cy;
    const angle = Math.atan2(dy, dx);
    const dist = Math.min(1, Math.hypot(dx, dy) / Math.max(rect.width, 200));
    const px = Math.cos(angle) * 3.2 * dist;
    const py = Math.sin(angle) * 1.8 * dist;
    eyes.forEach(eye => {
      eye.style.setProperty('--ex', px.toFixed(2) + 'px');
      eye.style.setProperty('--ey', py.toFixed(2) + 'px');
    });
  };

  window.addEventListener('mousemove', onMove, { passive: true });
  window.addEventListener('mouseleave', () => {
    eyes.forEach(eye => { eye.style.setProperty('--ex', '0px'); eye.style.setProperty('--ey', '0px'); });
  });
}

function init3DTilt() {
  if (prefersReducedMotion) return;
  const targets = document.querySelectorAll('[data-tilt]');
  targets.forEach(el => {
    let raf = null;
    const onMove = e => {
      const r = el.getBoundingClientRect();
      const dx = (e.clientX - r.left) / r.width - 0.5;
      const dy = (e.clientY - r.top) / r.height - 0.5;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        el.style.setProperty('--tilt-x', (dy * -5).toFixed(2) + 'deg');
        el.style.setProperty('--tilt-y', (dx * 8).toFixed(2) + 'deg');
        el.classList.add('tilt-active');
        raf = null;
      });
    };
    const onLeave = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = null;
      el.style.setProperty('--tilt-x', '0deg');
      el.style.setProperty('--tilt-y', '0deg');
      el.classList.remove('tilt-active');
    };
    el.addEventListener('mousemove', onMove, { passive: true });
    el.addEventListener('mouseleave', onLeave);
  });
}

function initScrollReveal() {
  const els = document.querySelectorAll('.reveal');
  if (!els.length) return;
  if (prefersReducedMotion || !('IntersectionObserver' in window)) {
    els.forEach(el => el.classList.add('in'));
    return;
  }
  const io = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('in');
        io.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
  els.forEach(el => io.observe(el));
}

function initScanRing() {
  const stage = document.getElementById('cubeStage');
  if (!stage) return;
  stage.addEventListener('click', () => {
    stage.classList.remove('zap');
    void stage.offsetWidth;
    stage.classList.add('zap');
  });
}

function initOrbPulse() {
  const orbs = document.querySelectorAll('.orb');
  orbs.forEach((orb, i) => {
    orb.style.setProperty('--orb-delay', `${i * -2.1}s`);
  });
}

function initPreloader() {
  const pre = document.getElementById('preloader');
  if (!pre) return;
  const hide = () => {
    if (pre.classList.contains('done')) return;
    pre.classList.add('done');
    document.documentElement.classList.add('preloaded');
  };
  // Hide after site:ready or after 1.6s fallback (whichever comes first)
  document.addEventListener('site:ready', hide, { once: true });
  setTimeout(hide, 1600);
}

export function initEffects() {
  initPreloader();
  initProgressBar();
  initEyeTracking();
  init3DTilt();
  initScrollReveal();
  initScanRing();
  initOrbPulse();
}
