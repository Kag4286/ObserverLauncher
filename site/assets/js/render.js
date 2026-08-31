// render module — builds feature manifest and comparison table dynamically
const FEATURES = [
  { code: 'F1', ico: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M13 2L4 14h6l-1 8 9-12h-6z"/></svg>', key: 'ft.f1', descKey: 'ft.f1d' },
  { code: 'F2', ico: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 15l4-6"/><path d="M3.5 15a9 9 0 1 1 17 0"/></svg>', key: 'ft.f2', descKey: 'ft.f2d' },
  { code: 'F3', ico: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 4h18l-7 8v6l-4 2v-8z"/></svg>', key: 'ft.f3', descKey: 'ft.f3d' },
  { code: 'F4', ico: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 4l16 16M20 4L4 20"/></svg>', key: 'ft.f4', descKey: 'ft.f4d' }
];

const COMPARE = [
  ['Runs on', 'Your PC', 'Their cloud', 'Mojang cloud', 'Your PC'],
  ['Cost', 'Free', 'Free — queues & limits', 'Paid subscription', 'Free'],
  ['Mods & plugins', 'Every loader', 'Curated subset', 'Almost none', 'Every loader'],
  ['File access', 'Full', 'Limited', 'No', 'Full'],
  ['Online 24/7', 'No — PC must stay on', 'Yes', 'Yes', 'If you host it'],
  ['Remote friends', 'Port forwarding needed', 'Included', 'Included', 'Port forwarding needed'],
  ['Telemetry', 'None', 'Yes', 'Yes', 'None']
];

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[m]);
}

function renderFeatures() {
  const container = document.getElementById('featManifest');
  if (!container) return;
  container.innerHTML = '';
  FEATURES.forEach((feat, idx) => {
    const row = document.createElement('div');
    row.className = 'spec-row';
    row.tabIndex = 0;
    row.setAttribute('role', 'button');
    row.setAttribute('aria-expanded', 'false');
    row.innerHTML = `
      <span class="spec-code">${escapeHtml(feat.code)}</span>
      <span class="spec-ico">${feat.ico}</span>
      <span class="spec-main">
        <b data-i18n="${feat.key}"></b>
        <span class="spec-body"><span><p data-i18n="${feat.descKey}"></p></span></span>
      </span>
      <span class="spec-x">+</span>`;
    row.addEventListener('click', () => {
      const open = row.classList.toggle('open');
      row.setAttribute('aria-expanded', String(open));
    });
    row.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        row.click();
      }
    });
    container.appendChild(row);
  });
}

function renderCompare() {
  const container = document.getElementById('cmpTable');
  if (!container) return;
  const table = document.createElement('table');
  table.className = 'tbl';
  const thead = document.createElement('thead');
  thead.innerHTML = `<tr><th></th><th>ObserverLauncher</th><th>Aternos</th><th>Realms</th><th>Manual jar</th></tr>`;
  table.appendChild(thead);
  const tbody = document.createElement('tbody');
  COMPARE.forEach((row, ri) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<th>${escapeHtml(row[0])}</th>` +
      row.slice(1).map((cell, ci) => `<td class="${ci === 0 ? 'hi' : ''}">${escapeHtml(cell)}</td>`).join('');
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  container.innerHTML = '';
  container.appendChild(table);
}

export function initRender() {
  renderFeatures();
  // Compare table is static in index.html to avoid blank section if JS fails.
}
