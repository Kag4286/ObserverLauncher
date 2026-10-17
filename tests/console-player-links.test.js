// v6.0.0 H6: linkifyKnownPlayers is a pure renderer helper in 00-core.js (a classic script). This
// test runs the whole file in a VM with a minimal DOM stub, then exercises the helper: it must
// escape the line, link ONLY known player names, and never turn an ordinary word into a link.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0;
function ok(name, cond) { assert(cond, `FAIL: ${name}`); console.log(`PASS ${name}`); passed++; }

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'js', '00-core.js'), 'utf8');
const noop = () => {};
const sandbox = {
  document: { querySelector: () => null, querySelectorAll: () => [], addEventListener: noop },
  window: { addEventListener: noop, LOCALES: { en: {} } },
  navigator: { clipboard: { writeText: async () => {} } },
  requestAnimationFrame: () => 0,
  matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop, addListener: noop, removeListener: noop }),
  setTimeout, clearTimeout, console,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
const { linkifyKnownPlayers, isSafePlayerName } = sandbox;

ok('helper exported to the script scope', typeof linkifyKnownPlayers === 'function' && typeof isSafePlayerName === 'function');

// escapes HTML in the line
ok('escapes markup', linkifyKnownPlayers('<b>x</b>', []).includes('&lt;b&gt;'));

// no names -> plain escaped text, no links
ok('no names -> no links', !linkifyKnownPlayers('Steve joined the game', []).includes('log-player'));

// a known name becomes a link
{
  const html = linkifyKnownPlayers('Steve joined the game', ['Steve']);
  ok('known name linked', html.includes('class="log-player" data-player="Steve"'));
  ok('non-name word not linked', !html.includes('data-player="joined"'));
}

// a word that LOOKS like a name but is not in the list stays plain
ok('unknown word stays plain', !linkifyKnownPlayers('Alex joined', ['Steve']).includes('log-player'));

// name with regex-special chars is handled (but isSafePlayerName rejects them, so it is NOT linked)
ok('unsafe name rejected by filter', !linkifyKnownPlayers('a.b joined', ['a.b']).includes('log-player'));

// word-boundary: a name inside a larger word is not linked
ok('no link inside a larger word', !linkifyKnownPlayers('SteveO joined', ['Steve']).includes('log-player'));

// multiple names, each linked
{
  const html = linkifyKnownPlayers('Steve and Alex joined', ['Steve', 'Alex']);
  ok('two names linked', (html.match(/log-player/g) || []).length === 2);
}

// the log line text is escaped AND a name inside it is linked
{
  const html = linkifyKnownPlayers('<script>Steve</script>', ['Steve']);
  ok('escaping + link coexist', html.includes('&lt;script&gt;') && html.includes('data-player="Steve"'));
}

console.log(`\n${passed} passed, 0 failed`);
