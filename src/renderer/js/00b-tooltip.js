// js/00b-tooltip.js (v6.0.0) — custom in-app tooltip that REPLACES the OS `title=` bubble.
//
// WHY: a native title tooltip is drawn by the operating system. It ignores the design tokens, has
// a fixed font and a delay the app cannot change, and it is invisible to the CSP/Style system. It
// was the last place in the Player Inspector that looked like a system dialog, so every element
// with a long label switched from `title="..."` to `data-tip="..."`.
//
// Usage: add data-tip="text" (use data-tip-html for rich content). No JS call needed; the
// delegated listeners attach once at load. Text is escaped unless data-tip-html is set.
(function () {
  const DELAY = 350;
  let timer = 0;
  let bubble = null;
  let active = null;

  function ensure() {
    if (bubble) return bubble;
    bubble = document.createElement('div');
    bubble.className = 'ol-tip';
    bubble.setAttribute('role', 'tooltip');
    bubble.hidden = true;
    document.body.appendChild(bubble);
    return bubble;
  }

  function place(anchor) {
    const b = ensure();
    const r = anchor.getBoundingClientRect();
    // Measure first, then decide above/below so a tip near the bottom of the window does not
    // overflow off-screen. 8px is the gap from the anchored element.
    b.style.left = '-9999px';
    b.style.top = '-9999px';
    b.hidden = false;
    const br = b.getBoundingClientRect();
    let top = r.bottom + 8;
    if (top + br.height > window.innerHeight - 8) top = r.top - br.height - 8;
    if (top < 8) top = 8;
    let left = r.left + r.width / 2 - br.width / 2;
    if (left < 8) left = 8;
    if (left + br.width > window.innerWidth - 8) left = window.innerWidth - br.width - 8;
    b.style.left = Math.round(left) + 'px';
    b.style.top = Math.round(top) + 'px';
  }

  function show(anchor) {
    const text = anchor.getAttribute('data-tip');
    const html = anchor.getAttribute('data-tip-html');
    if (!text && !html) return;
    const b = ensure();
    if (html) b.innerHTML = html;
    else { b.textContent = ''; b.textContent = text; }
    active = anchor;
    place(anchor);
  }

  function hide() {
    clearTimeout(timer);
    timer = 0;
    if (bubble) bubble.hidden = true;
    active = null;
  }

  function schedule(anchor) {
    if (active === anchor) return;
    hide();
    timer = setTimeout(() => show(anchor), DELAY);
  }

  document.addEventListener('mouseover', (e) => {
    const a = e.target.closest('[data-tip],[data-tip-html]');
    if (a) schedule(a);
    else if (active) hide();
  }, true);

  document.addEventListener('mouseout', (e) => {
    const a = e.target.closest('[data-tip],[data-tip-html]');
    if (!a) return;
    const to = e.relatedTarget && e.relatedTarget.closest ? e.relatedTarget.closest('[data-tip],[data-tip-html]') : null;
    if (to !== a) hide();
  }, true);

  // Any click, scroll, or focus change dismisses the tip; the bubble must never trap interaction.
  document.addEventListener('click', hide, true);
  document.addEventListener('wheel', hide, { capture: true, passive: true });
  window.addEventListener('blur', hide);
  window.addEventListener('resize', hide);
})();
