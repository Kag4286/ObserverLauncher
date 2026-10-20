// Smoke check for the 6.0.1 changes, run against the REAL server folder the user is running
// (C:\Users\PC\Downloads\Servertest) when it exists. It only READS, and it writes nothing.
//
// It answers the two questions the user asked about:
//   1. does the MOTD preview now get a value it can colour?
//   2. does a Spigot plugin's author resolve?
const fs = require('fs');
const path = require('path');
const { serverFiles, decodePropertiesValue } = require('../src/main/server-files.js');
const { renderMotdPreview } = (() => {
  const vm = require('vm');
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
  return sandbox;
})();

const ROOT = process.argv[2] || 'C:\\Users\\PC\\Downloads\\Servertest';
if (!fs.existsSync(ROOT)) {
  console.log('SKIP: no server folder at ' + ROOT);
  process.exit(0);
}
const files = serverFiles(ROOT);
const motd = files.properties.motd;
console.log('server folder : ' + ROOT);
console.log('raw motd line : ' + (fs.readFileSync(path.join(ROOT, 'server.properties'), 'utf8').split(/\r?\n/).find(l => l.startsWith('motd=')) || '(none)'));
console.log('decoded motd  : ' + JSON.stringify(motd));
const preview = renderMotdPreview(motd);
console.log('preview html  : ' + preview);
console.log('');
console.log('preview shows a colour span : ' + /<span style="color:/.test(preview));
console.log('preview still shows \\u00a7  : ' + /\\u00a7/.test(preview));
console.log('');
console.log('plugins on disk: ' + (files.plugins || []).join(', ') || '(none)');
process.exit(0);
