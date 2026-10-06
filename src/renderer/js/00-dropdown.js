// js/00-dropdown.js (v4.0.0) — custom animated dropdown that REPLACES the OS <select> popup.
//
// WHY: a native <select> popup is drawn by the OS and cannot be animated with CSS/JS. To get a real
// open/close animation we render our own listbox — but we KEEP the real <select> in the DOM (hidden)
// and proxy every choice back to it (set value + dispatch a bubbling 'change'), so all existing code
// that reads select.value / listens to onchange keeps working with ZERO changes.
//
// Usage: add class="ol-select" to a <select>, or call window.enhanceSelect(sel). Options are read
// from the LIVE select each time the panel opens, so dynamically-populated selects (market version,
// java runtimes, install versions) always show the current list.
(function () {
  function labelOf(sel) {
    const opt = sel.options[sel.selectedIndex];
    return opt ? (opt.textContent || '').trim() : '';
  }
  function enhanceSelect(sel) {
    if (!sel || sel.dataset.enhanced === '1') return;
    sel.dataset.enhanced = '1';
    sel.classList.add('ol-select-native'); // hidden via CSS

    const wrap = document.createElement('div');
    wrap.className = 'ol-dd' + (sel.classList.contains('launcher-select') ? ' ol-dd-wide' : '');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ol-dd-btn';
    btn.setAttribute('aria-haspopup', 'listbox');
    btn.setAttribute('aria-expanded', 'false');
    if (sel.getAttribute('aria-label')) btn.setAttribute('aria-label', sel.getAttribute('aria-label'));
    btn.innerHTML = '<span class="ol-dd-label"></span><span class="ol-dd-caret" aria-hidden="true">▾</span>';
    const panel = document.createElement('div');
    panel.className = 'ol-dd-panel';
    panel.setAttribute('role', 'listbox');
    panel.hidden = true;

    sel.parentNode.insertBefore(wrap, sel);
    wrap.appendChild(btn);
    wrap.appendChild(panel);
    wrap.appendChild(sel); // move the real select inside (kept hidden, still holds state)
    // Cache refs: the panel is PORTALED to <body> on open, so it is no longer a child of wrap — a
    // later querySelector('.ol-dd-panel') inside wrap would return null (close/reflow would break).
    wrap._olPanel = panel; wrap._olBtn = btn;

    const syncLabel = () => { const l = btn.querySelector('.ol-dd-label'); if (l) l.textContent = labelOf(sel); };
    syncLabel();

    function buildPanel() {
      panel.innerHTML = Array.from(sel.options).map(o => {
        const on = o.value === sel.value;
        return `<button type="button" class="ol-dd-opt${on ? ' active' : ''}" role="option" aria-selected="${on}" data-v="${encodeURIComponent(o.value)}"${o.disabled ? ' disabled' : ''}>${(o.textContent || '').replace(/</g, '&lt;')}</button>`;
      }).join('');
      panel.querySelectorAll('.ol-dd-opt').forEach(b => {
        b.onclick = () => {
          sel.value = decodeURIComponent(b.dataset.v);
          syncLabel();
          close();
          sel.dispatchEvent(new Event('change', { bubbles: true }));
        };
      });
    }
    function position() {
      const r = btn.getBoundingClientRect();
      const w = panel.offsetWidth || 180, h = panel.offsetHeight || 200;
      panel.style.left = Math.max(8, Math.min(r.left, innerWidth - w - 8)) + 'px';
      panel.style.top = (r.bottom + 6 + h > innerHeight ? r.top - h - 6 : r.bottom + 6) + 'px';
    }
    function open() {
      closeAll(wrap);
      buildPanel();
      document.body.appendChild(panel); // PORTAL: escape any ancestor stacking/clipping context
      panel.hidden = false;
      position();
      btn.setAttribute('aria-expanded', 'true');
      wrap.classList.add('open');
      const on = panel.querySelector('.ol-dd-opt.active');
      if (on) on.scrollIntoView({ block: 'nearest' });
    }
    function close() {
      panel.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
      wrap.classList.remove('open');
    }
    function toggle() { panel.hidden ? open() : close(); }

    btn.onclick = e => { e.stopPropagation(); toggle(); };
    btn.onkeydown = e => { if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } };
    // Keep the label in sync when the value/options change elsewhere (JS sets .value, or options are
    // rebuilt) — cheap: only re-reads the selected option's text.
    try { new MutationObserver(syncLabel).observe(sel, { childList: true, subtree: true }); } catch {}
    sel.addEventListener('change', syncLabel);
    wrap._olSync = syncLabel;
  }

  function closeAll(except) {
    document.querySelectorAll('.ol-dd.open').forEach(w => { if (w !== except) { w.classList.remove('open'); if (w._olPanel) w._olPanel.hidden = true; if (w._olBtn) w._olBtn.setAttribute('aria-expanded', 'false'); } });
  }
  // The panel is portaled to <body>, so exclude it too or an option click closes before firing.
  document.addEventListener('pointerdown', e => { if (!e.target.closest('.ol-dd') && !e.target.closest('.ol-dd-panel')) closeAll(null); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeAll(null); });
  // Reposition any open panel on scroll/resize (fixed coords go stale otherwise).
  const reflow = () => document.querySelectorAll('.ol-dd.open').forEach(w => { const p = w._olPanel, b = w._olBtn; if (p && b) { const r = b.getBoundingClientRect(); const pw = p.offsetWidth || 180, ph = p.offsetHeight || 200; p.style.left = Math.max(8, Math.min(r.left, innerWidth - pw - 8)) + 'px'; p.style.top = (r.bottom + 6 + ph > innerHeight ? r.top - ph - 6 : r.bottom + 6) + 'px'; } });
  window.addEventListener('resize', reflow);
  window.addEventListener('scroll', reflow, true);

  window.enhanceSelect = enhanceSelect;
  function enhanceAll(root) { (root || document).querySelectorAll('select.ol-select').forEach(enhanceSelect); }
  window.enhanceAllSelects = enhanceAll;
  enhanceAll();
  // New selects injected later (modals built on demand) are enhanced lazily when their container
  // gets .ol-select added; call window.enhanceAllSelects() after dynamic HTML if needed.
})();
