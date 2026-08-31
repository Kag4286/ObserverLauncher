// particles.js — subtle pixel-dust canvas behind the hero.
// GPU-friendly, respects prefers-reduced-motion.

export function initParticles() {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const canvas = document.getElementById('fxCanvas');
  if (!canvas || reduced) {
    if (canvas) canvas.remove();
    return;
  }

  const ctx = canvas.getContext('2d');
  let w = 0, h = 0, raf = null;
  const P = [];
  const COUNT = 70;

  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = canvas.clientWidth;
    h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  const seed = () => {
    P.length = 0;
    for (let i = 0; i < COUNT; i++) {
      P.push({
        x: Math.random() * w,
        y: Math.random() * h,
        size: Math.random() * 1.8 + 0.5,
        vx: (Math.random() - 0.5) * 0.12,
        vy: (Math.random() - 0.5) * 0.08,
        alpha: Math.random() * 0.35 + 0.08,
        twinkle: Math.random() * Math.PI * 2
      });
    }
  };

  const draw = () => {
    ctx.clearRect(0, 0, w, h);
    const acc = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#00D4F5';
    for (const p of P) {
      p.x += p.vx;
      p.y += p.vy;
      p.twinkle += 0.02;
      if (p.x < -10) p.x = w + 10; else if (p.x > w + 10) p.x = -10;
      if (p.y < -10) p.y = h + 10; else if (p.y > h + 10) p.y = -10;
      const a = p.alpha * (0.6 + 0.4 * Math.sin(p.twinkle));
      ctx.globalAlpha = a;
      ctx.fillStyle = acc;
      ctx.fillRect(p.x, p.y, p.size, p.size);
    }
    ctx.globalAlpha = 1;
    raf = requestAnimationFrame(draw);
  };

  resize();
  seed();
  draw();

  window.addEventListener('resize', () => {
    cancelAnimationFrame(raf);
    resize();
    seed();
    raf = requestAnimationFrame(draw);
  }, { passive: true });

  document.addEventListener('visibilitychange', () => {
    cancelAnimationFrame(raf);
    if (!document.hidden) raf = requestAnimationFrame(draw);
  });
}
