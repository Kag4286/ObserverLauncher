// rate-limit.js — a token-bucket rate limiter shared by the MCP server and the remote server.
//
// WHY a shared module (4.4.0): both servers need the SAME 60-requests/min bucket, and copy-pasting
// the block into two files trips tests/no-dup.test.js (gotcha #20). One pure, testable factory.
//
// makeRateLimiter(capacity, windowMs) returns limit(key) -> true when the caller is over budget.
// Also exposes .isLimited(key) (peek without consuming) and .reset(key) for auth brute-force guards.
function makeRateLimiter(capacity, windowMs) {
  const cap = Number(capacity) > 0 ? Number(capacity) : 60;
  const win = Number(windowMs) > 0 ? Number(windowMs) : 60000;
  const buckets = new Map();
  function refill(key, now) {
    const k = String(key || 'local');
    const b = buckets.get(k) || { tokens: cap, at: now };
    b.tokens = Math.min(cap, b.tokens + ((now - b.at) / win) * cap);
    b.at = now;
    return [k, b];
  }
  function prune(now) {
    if (buckets.size <= 4096) return;
    for (const [k, b] of buckets) {
      if (now - b.at >= win) buckets.delete(k);
    }
    if (buckets.size > 4096) buckets.clear();
  }
  function limit(key) {
    const now = Date.now();
    prune(now);
    const [k, b] = refill(key, now);
    if (b.tokens < 1) { buckets.set(k, b); return true; }
    b.tokens -= 1; buckets.set(k, b); return false;
  }
  limit.isLimited = function isLimited(key) {
    const [k, b] = refill(key, Date.now());
    if (buckets.has(k)) buckets.set(k, b);
    return b.tokens < 1;
  };
  limit.reset = function reset(key) { buckets.delete(String(key || 'local')); };
  return limit;
}

module.exports = { makeRateLimiter };
