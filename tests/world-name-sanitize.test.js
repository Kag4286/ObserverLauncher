// v8.0.1: Verify sanitizeWorldName against Windows-reserved device names, trailing dots/spaces, and path traversal.
const { sanitizeWorldName } = require('../src/main/world-ops.js');

let pass = 0, fail = 0;
function check(label, cond) {
  if (cond) pass++;
  else { fail++; console.error('FAIL:', label); }
}

check('accepts standard world name', sanitizeWorldName('world') === 'world');
check('accepts spaces and hyphens inside name', sanitizeWorldName('My Survival - 2026_1') === 'My Survival - 2026_1');
check('trims leading and trailing spaces', sanitizeWorldName('  world_2  ') === 'world_2');
check('rejects empty or whitespace-only name', sanitizeWorldName('   ') === null);
check('rejects path traversal ..', sanitizeWorldName('../world') === null);
check('rejects slashes', sanitizeWorldName('sub/world') === null && sanitizeWorldName('sub\\world') === null);
check('rejects trailing dot', sanitizeWorldName('world.') === null);
check('rejects Windows reserved names CON/PRN/AUX/NUL',
  sanitizeWorldName('CON') === null &&
  sanitizeWorldName('con') === null &&
  sanitizeWorldName('PRN') === null &&
  sanitizeWorldName('AUX') === null &&
  sanitizeWorldName('NUL') === null
);
check('rejects Windows reserved COM1-9 and LPT1-9',
  sanitizeWorldName('COM1') === null &&
  sanitizeWorldName('com9') === null &&
  sanitizeWorldName('LPT1') === null &&
  sanitizeWorldName('lpt4') === null
);
check('rejects names longer than 64 characters', sanitizeWorldName('a'.repeat(65)) === null);

console.log(`world-name-sanitize: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

