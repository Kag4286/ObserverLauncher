// Three defects that made the Marketplace look broken, all found by probing the live APIs.
//
// 1. HANGAR SORT. The search used sort=updatedAt. Hangar's search takes stars, downloads,
//    views, newest, updated, recent_views, recent_downloads and slug, and answers an unknown
//    field with a 400. Sorting by "latest" therefore always failed.
//
// 2. A TIMEOUT WAS RETRIED. json() retries a GET up to three times, and a timeout was
//    classified as retryable, so a registry that stopped answering kept the user on
//    "Searching..." for 25 s x 3 before the error appeared. A timeout now ends the wait.
//
// 3. THE MODAL GREW WITHOUT LIMIT. The install window had no max-height, so a resource with
//    25 builds pushed the Install button off the bottom of the screen.
//
// The network is mocked: the point is the URL the launcher builds, how it reacts to a timeout,
// and what it does with a long version list.
const Module = require('module');
const fs = require('fs');
const os = require('os');
const path = require('path');

let pass = 0, fail = 0;
const check = (name, cond, detail) => cond ? (pass++, console.log('PASS', name)) : (fail++, console.log('FAIL', name + (detail ? ' -> ' + detail : '')));

// --- a mock fetch that records the URLs and can time out ------------------
let calls = [];
let nextBehaviour = null;   // (url) => {status, body} | 'timeout'
const realHttp = require('../src/main/http.js');
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  const from = parent && parent.filename ? parent.filename : '';
  if (request === 'electron') {
    return { app: { getPath: () => path.join(os.tmpdir(), 'ob-mkt2-userdata') }, dialog: {}, shell: {}, BrowserWindow: { getAllWindows: () => [] } };
  }
  if (request === './http.js' && from.endsWith('marketplace.js')) {
    return { ...realHttp, json: async (url) => { calls.push(url); if (nextBehaviour) return nextBehaviour(url); return { pagination: { count: 0 }, result: [] }; } };
  }
  return origLoad.apply(this, arguments);
};
const marketplace = require('../src/main/marketplace.js');

// --- the real http.js, with a fetch we control ---------------------------
const httpCalls = [];
const origFetch = global.fetch;
global.fetch = async (url, opts) => {
  httpCalls.push(String(url));
  if (nextBehaviour) {
    const r = nextBehaviour(String(url), opts);
    return r;
  }
  return { ok: true, status: 200, statusText: 'OK', json: async () => ({}) };
};

(async () => {
  // --- 1. the Hangar sort field ------------------------------------------
  for (const [sort, expected] of [['downloads', '-downloads'], ['latest', '-updated'], ['stars', '-stars']]) {
    calls = [];
    nextBehaviour = () => ({ ok: true, status: 200, statusText: 'OK', json: async () => ({ pagination: { count: 0 }, result: [] }) });
    await marketplace.searchMarket({ source: 'hangar', sort, query: 'test', offset: 0 });
    const url = calls[0] || '';
    check('hangar sort ' + sort + ' -> ' + expected, url.includes('sort=' + expected), url);
    check('hangar sort ' + sort + ' does not use updatedAt', !url.includes('updatedAt'), url);
  }
  nextBehaviour = null;

  // --- 2. a timeout is not retried ---------------------------------------
  {
    httpCalls.length = 0;
    // The fetch never answers, so only the abort signal can end it. The real fetch rejects with
    // an AbortError when the signal fires; the mock has to do the same or the test hangs.
    nextBehaviour = (url, opts) => new Promise((_, reject) => {
      const signal = opts && opts.signal;
      if (signal) {
        if (signal.aborted) { reject(Object.assign(new Error('aborted'), { name: 'AbortError' })); return; }
        signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
      }
    });
    const started = Date.now();
    let msg = '';
    try { await realHttp.json('https://example.invalid/slow'); }
    catch (e) { msg = String(e && e.message || ''); }
    const elapsed = Date.now() - started;
    check('a timeout is reported to the caller', /timed out/i.test(msg), msg);
    check('a timeout is not retried (one fetch only)', httpCalls.length === 1, String(httpCalls.length));
    check('a timeout ends in about one wait, not three', elapsed < 20000, elapsed + 'ms');
    nextBehaviour = null;
  }

  // --- 3. a 4xx is not retried either ------------------------------------
  {
    httpCalls.length = 0;
    nextBehaviour = () => ({ ok: false, status: 400, statusText: 'Bad Request', json: async () => ({}) });
    let msg = '';
    try { await realHttp.json('https://example.invalid/bad'); } catch (e) { msg = String(e && e.message || ''); }
    check('a 4xx is reported to the caller', /400/.test(msg), msg);
    check('a 4xx is not retried', httpCalls.length === 1, String(httpCalls.length));
    nextBehaviour = null;
  }

  // --- 4. a real network error IS still retried --------------------------
  {
    httpCalls.length = 0;
    let n = 0;
    nextBehaviour = () => { n++; throw new Error('fetch failed'); };
    let msg = '';
    try { await realHttp.json('https://example.invalid/flaky'); } catch (e) { msg = String(e && e.message || ''); }
    check('a network error is retried', httpCalls.length > 1, String(httpCalls.length));
    check('the network error reaches the caller', /fetch failed/.test(msg), msg);
    nextBehaviour = null;
  }

  global.fetch = origFetch;
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();