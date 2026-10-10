// rate-limit.js — a token-bucket rate limiter shared by the MCP server and the remote server.
//
// WHY a shared module (4.4.0): both servers need the SAME 60-requests/min bucket, and copy-pasting
// the block into two files trips tests/no-dup.test.js (gotcha #20). One pure, testable factory.
//
// makeRateLimiter(capacity, windowMs) returns limit(key) -> true when the caller is over budget.
function makeRateLimiter(capacity, windowMs) {
  const cap = Number(capacity) > 0 ? Number(capacity) : 60;
  const win = Number(windowMs) > 0 ? Number(windowMs) : 60000;
  const buckets = new Map();
  return function limit(key) {
    const k = String(key || 'local');
    const now = Date.now();
    const b = buckets.get(k) || { tokens: cap, at: now };
    b.tokens = Math.min(cap, b.tokens + ((now - b.at) / win) * cap);
    b.at = now;
    if (b.tokens < 1) { buckets.set(k, b); return true; }
    b.tokens -= 1; buckets.set(k, b); return false;
  };
}

module.exports = { makeRateLimiter };
