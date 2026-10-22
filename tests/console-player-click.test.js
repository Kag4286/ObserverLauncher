// Tests for console player link click UUID resolution (v6.0.2).
// Verifies case-insensitive matching and scanning knownPlayers, whitelist, ops, banned.
const assert = require('assert');

let pass = 0;
function ok(name, cond) { assert(cond, `FAIL: ${name}`); console.log(`PASS ${name}`); pass++; }

function resolvePlayerUuid(name, stateFiles) {
  let uuid = null;
  try {
    const f = stateFiles || {};
    const lower = String(name).toLowerCase();
    for (const k of ['knownPlayers', 'whitelist', 'ops', 'banned']) {
      const hit = (f[k] || []).find(p => {
        const pn = typeof p === 'string' ? p : (p && p.name);
        return pn && String(pn).toLowerCase() === lower;
      });
      if (hit && typeof hit === 'object' && hit.uuid) { uuid = hit.uuid; break; }
    }
  } catch {}
  return uuid;
}

// 1. exact match in knownPlayers
{
  const files = { knownPlayers: [{ name: 'Steve', uuid: 'uuid-steve-123' }] };
  ok('exact match in knownPlayers', resolvePlayerUuid('Steve', files) === 'uuid-steve-123');
}

// 2. case-insensitive match (steve vs Steve)
{
  const files = { knownPlayers: [{ name: 'Steve', uuid: 'uuid-steve-123' }] };
  ok('case-insensitive match in knownPlayers', resolvePlayerUuid('steve', files) === 'uuid-steve-123');
  ok('case-insensitive match uppercase', resolvePlayerUuid('STEVE', files) === 'uuid-steve-123');
}

// 3. resolved from whitelist when not in knownPlayers
{
  const files = { knownPlayers: [], whitelist: [{ name: 'Alex', uuid: 'uuid-alex-456' }] };
  ok('resolved from whitelist', resolvePlayerUuid('alex', files) === 'uuid-alex-456');
}

// 4. resolved from ops when not in knownPlayers
{
  const files = { knownPlayers: [], ops: [{ name: 'Admin', uuid: 'uuid-admin-789' }] };
  ok('resolved from ops', resolvePlayerUuid('admin', files) === 'uuid-admin-789');
}

// 5. resolved from banned when not in knownPlayers
{
  const files = { knownPlayers: [], banned: [{ name: 'Griefer', uuid: 'uuid-griefer-999' }] };
  ok('resolved from banned', resolvePlayerUuid('griefer', files) === 'uuid-griefer-999');
}

// 6. returns null when player has no stored uuid
{
  const files = { knownPlayers: ['PlainName'] };
  ok('returns null for string-only player', resolvePlayerUuid('PlainName', files) === null);
  ok('returns null for unknown player', resolvePlayerUuid('Ghost', files) === null);
}

console.log(`\n${pass} passed, 0 failed`);
