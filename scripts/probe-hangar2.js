// Deeper Hangar probe: measures search sorts, then hits the detail, versions and
// download endpoints the install window uses, so a 502/404/timeout can be pinned
// to the exact URL. Read-only, writes nothing to disk.
// Usage: node scripts/probe-hangar2.js [owner/slug ...]
const DEFAULT_PROJECTS = ['ViaVersion/ViaVersion', 'Neky/heroic-map', 'ViaVersion/ViaBackwards'];
const projects = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_PROJECTS;
const UA = { 'User-Agent': 'ObserverLauncher/0.2 (local Minecraft server launcher)', 'Accept': 'application/json' };

async function get(url, opts = {}) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const r = await fetch(url, { signal: controller.signal, headers: UA, ...opts });
    let body = '';
    try { body = await r.text(); } catch { body = '(no body)'; }
    return { status: r.status, ms: Date.now() - started, body, ok: r.ok };
  } catch (error) {
    return { status: 'ERR', ms: Date.now() - started, body: String(error && error.message || error), ok: false };
  } finally { clearTimeout(timer); }
}

function show(label, r, extra) {
  console.log(`\n[${label}] status=${r.status} ${r.ms}ms${extra ? ' ' + extra : ''}`);
  const s = r.body.slice(0, 200).replace(/\s+/g, ' ');
  console.log(`  ${s}`);
}

(async () => {
  // 1. Search latency comparison (already known from probe-hangar.js, re-check with a query)
  for (const sort of ['-downloads', '-updated', '-stars']) {
    const url = `https://hangar.papermc.io/api/v1/projects?query=viaversion&limit=20&offset=0&sort=${encodeURIComponent(sort)}`;
    const r = await get(url);
    show(`search sort=${sort}`, r);
  }

  // 2. Per-project: detail, versions, then the first downloadUrl
  for (const proj of projects) {
    const [owner, slug] = proj.split('/');
    if (!owner || !slug) { console.log(`\n[skip] bad project id ${JSON.stringify(proj)}`); continue; }

    const detailUrl = `https://hangar.papermc.io/api/v1/projects/${encodeURIComponent(owner)}/${encodeURIComponent(slug)}`;
    const d = await get(detailUrl);
    show(`detail ${proj}`, d);

    const vUrl = `https://hangar.papermc.io/api/v1/projects/${encodeURIComponent(owner)}/${encodeURIComponent(slug)}/versions?limit=25`;
    const v = await get(vUrl);
    let downloadUrl = null;
    if (v.ok) {
      try {
        const data = JSON.parse(v.body);
        const rows = data.result || [];
        const withPaper = rows.find(x => x.downloads && x.downloads.PAPER && x.downloads.PAPER.downloadUrl);
        downloadUrl = withPaper && withPaper.downloads.PAPER.downloadUrl;
        show(`versions ${proj}`, v, `rows=${rows.length} withPaper=${withPaper ? 'yes' : 'no'}`);
      } catch { show(`versions ${proj}`, v, '(json parse failed)'); }
    } else {
      show(`versions ${proj}`, v);
    }

    if (downloadUrl) {
      const dl = await get(downloadUrl, { method: 'HEAD' });
      show(`download HEAD ${downloadUrl.slice(-60)}`, dl);
    } else {
      console.log(`\n[download ${proj}] skipped: no PAPER.downloadUrl`);
    }
  }
})();
