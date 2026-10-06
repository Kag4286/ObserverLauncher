// (verified 2026-10-06: icon.url is root-relative, author is {id}) kept as a manual probe helper.
const q = process.argv[2] || 'GSit';
const url = `https://api.spiget.org/v2/search/resources/${encodeURIComponent(q)}?size=2&sort=-downloads`;
fetch(url, { headers: { 'User-Agent': 'ObserverLauncher-probe' } })
  .then(r => r.json())
  .then(d => {
    if (!Array.isArray(d)) { console.log('NOT-ARRAY:', JSON.stringify(d).slice(0, 300)); return; }
    console.log('count:', d.length);
    const o = d[0] || {};
    console.log('keys:', Object.keys(o).join(','));
    console.log('id:', o.id, ' name:', o.name);
    console.log('icon:', JSON.stringify(o.icon && { url: o.icon.url, hasData: !!o.icon.data }));
    console.log('author:', JSON.stringify(o.author));
    const id = o.id;
    if (!id) return;
    fetch(`https://api.spiget.org/v2/resources/${id}`, { headers: { 'User-Agent': 'probe' } })
      .then(r => r.json())
      .then(d => {
        console.log('detail.icon.url:', d.icon && d.icon.url);
        console.log('detail.author:', JSON.stringify(d.author));
        const aid = d.author && d.author.id;
        if (!aid) return;
        return fetch(`https://api.spiget.org/v2/authors/${aid}`, { headers: { 'User-Agent': 'probe' } })
          .then(ar => ar.json())
          .then(a => console.log('author.name:', a && a.name));
      })
      .catch(e => console.log('detail ERR', e.message));
  })
  .catch(e => console.log('ERR', e.message));
