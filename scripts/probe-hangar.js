// Read-only probe for the Hangar search endpoint used by marketplace.js.
// Prints status, elapsed time and a body snippet for each sort variant, so a slow
// server (timeout / 5xx) can be told apart from a rejected parameter (fast 400).
// Usage: node scripts/probe-hangar.js [query]
const query = process.argv[2] || '';
const sorts = ['-updated', '-stars', '-downloads', 'updated', 'newest'];

async function once(sort) {
  const url = `https://hangar.papermc.io/api/v1/projects?query=${encodeURIComponent(query)}&limit=20&offset=0&sort=${encodeURIComponent(sort)}`;
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const r = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'ObserverLauncher/0.2 (local Minecraft server launcher)',
        'Accept': 'application/json',
      },
    });
    const body = await r.text();
    return { sort, status: r.status, ms: Date.now() - started, body };
  } catch (error) {
    return { sort, status: 'ERR', ms: Date.now() - started, body: String(error && error.message || error) };
  } finally { clearTimeout(timer); }
}

(async () => {
  console.log(`query=${JSON.stringify(query)}`);
  for (const sort of sorts) {
    const r = await once(sort);
    const snippet = r.body.slice(0, 300).replace(/\s+/g, ' ');
    console.log(`\n[sort=${r.sort}] status=${r.status} ${r.ms}ms`);
    console.log(`  ${snippet}`);
    if (r.status === 200) {
      try {
        const data = JSON.parse(r.body);
        const rows = data.result || data.projects || [];
        console.log(`  parsed OK: rows=${rows.length} total=${data.pagination && data.pagination.count}`);
        if (rows[0]) console.log(`  first=${rows[0].namespace && rows[0].namespace.owner}/${rows[0].name}`);
      } catch (e) { console.log(`  JSON parse failed: ${e.message}`); }
    }
  }
})();
