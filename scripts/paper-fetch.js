// paper-fetch.js — resolve a Paper jar with retries so a TRANSIENT PaperMC outage does not turn
// CI red. Shared by linux-full-boot.js + modpack-boot-smoke.js.
//
// WHY: the boot-smoke jobs boot a REAL Paper server, which means they depend on fill.papermc.io.
// That API intermittently returns 503; the generic json() retry (3 attempts, ~1.6s total) is too
// short to ride out a real outage, so a third-party blip used to fail the job. Here we retry longer
// and, if it is STILL down, let the caller SKIP instead of FAIL (an external outage is not our bug).

// A transient service/network failure we should retry or skip on - NOT a real answer like 404.
const TRANSIENT = /\b(5\d\d|fetch failed|timed out|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|socket hang up)\b/i;

function isServiceOutage(err) {
  return TRANSIENT.test(String((err && err.message) || err || ''));
}

// Resolve a Paper build, retrying transient failures with backoff. Throws the last error when all
// attempts fail (the caller decides SKIP vs FAIL via isServiceOutage).
async function resolvePaperWithRetry(downloadFillProject, version, attempts = 4) {
  const backoff = [2000, 5000, 10000];
  let last;
  for (let i = 0; i < attempts; i++) {
    try { return await downloadFillProject('paper', version); }
    catch (e) {
      last = e;
      if (!isServiceOutage(e) || i === attempts - 1) throw e;
      await new Promise(r => setTimeout(r, backoff[i] || 10000));
    }
  }
  throw last;
}

module.exports = { resolvePaperWithRetry, isServiceOutage };
