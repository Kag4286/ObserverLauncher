// ui module — scroll effects, mobile nav, reveal, copy, back-to-top
export function initUI() {
  // sticky nav state + scroll progress
  const nav = document.getElementById('mainNav');
  const progress = document.getElementById('progress');
  const sections = document.querySelectorAll('section[id]');
  const navLinks = document.querySelectorAll('.nav-links a');

  function onScroll() {
    const y = window.scrollY;
    if (nav) nav.classList.toggle('scrolled', y > 10);
    const doc = document.documentElement;
    const max = doc.scrollHeight - doc.clientHeight;
    if (progress) progress.style.width = (max > 0 ? (y / max) * 100 : 0) + '%';
    // active nav link
    let currentId = '';
    sections.forEach(sec => {
      if (y >= sec.offsetTop - 100) currentId = sec.id;
    });
    navLinks.forEach(link => {
      const href = link.getAttribute('href');
      link.classList.toggle('on', href === '#' + currentId);
    });
    // back-to-top visibility
    const toTop = document.getElementById('toTop');
    if (toTop) toTop.classList.toggle('show', y > 600);
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // hamburger
  const hamburger = document.getElementById('hamburger');
  const navLinksContainer = document.getElementById('navLinks');
  if (hamburger && navLinksContainer) {
    hamburger.addEventListener('click', () => {
      const open = navLinksContainer.classList.toggle('open');
      hamburger.setAttribute('aria-expanded', String(open));
    });
    navLinksContainer.addEventListener('click', e => {
      if (e.target.tagName === 'A') {
        navLinksContainer.classList.remove('open');
        hamburger.setAttribute('aria-expanded', 'false');
      }
    });
  }

  // reveal on scroll
  const revealEls = document.querySelectorAll('[data-reveal]');
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('in');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12 });
    revealEls.forEach(el => observer.observe(el));
  } else {
    revealEls.forEach(el => el.classList.add('in'));
  }

  // copy source code button
  const copyBtn = document.getElementById('copyBtn');
  const srcCode = document.getElementById('srcCode');
  if (copyBtn && srcCode) {
    copyBtn.addEventListener('click', async () => {
      const text = srcCode.innerText;
      try {
        await navigator.clipboard.writeText(text);
        copyBtn.classList.add('ok');
        copyBtn.textContent = 'copied ✓';
        setTimeout(() => {
          copyBtn.classList.remove('ok');
          copyBtn.textContent = 'copy';
        }, 1600);
      } catch {
        // fallback
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        copyBtn.classList.add('ok');
        copyBtn.textContent = 'copied ✓';
        setTimeout(() => {
          copyBtn.classList.remove('ok');
          copyBtn.textContent = 'copy';
        }, 1600);
      }
    });
  }

  // back-to-top
  const toTop = document.getElementById('toTop');
  if (toTop) {
    toTop.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
  }

  // GitHub links
  const ghLink = document.getElementById('ghLink');
  const ghHero = document.getElementById('ghHero');
  const ghFoot = document.getElementById('ghFoot');
  const ghIssues = document.getElementById('ghIssues');
  const ghUrl = 'https://github.com/ObserverLauncher/ObserverLauncher';
  [ghLink, ghHero, ghFoot].forEach(el => {
    if (el) el.href = ghUrl;
  });
  if (ghIssues) ghIssues.href = ghUrl + '/issues';

  // FAQ accordion — native <details>, no extra JS needed; just close others on open
  document.querySelectorAll('.faq details').forEach(details => {
    details.addEventListener('toggle', () => {
      if (details.open) {
        document.querySelectorAll('.faq details[open]').forEach(d => {
          if (d !== details) d.open = false;
        });
      }
    });
  });

  // cube stage click scan effect
  const cubeStage = document.getElementById('cubeStage');
  if (cubeStage) {
    cubeStage.addEventListener('click', () => {
      cubeStage.classList.add('zap');
      setTimeout(() => cubeStage.classList.remove('zap'), 400);
    });
  }
}
