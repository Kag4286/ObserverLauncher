// server.properties is read by Java's java.util.Properties, which decodes a backslash escape
// before the game sees the value. The common one is \uXXXX, used for the section sign that
// carries the MOTD's colour codes: the file holds the six ASCII characters "\u00a7" and the
// server shows a coloured "§".
//
// The launcher read the file line by line, so the properties grid and the MOTD preview showed
// the raw escape text instead of the colours the player actually sees. These two helpers are
// the exact inverse of each other and follow Java's rules.
const { decodePropertiesValue, encodePropertiesValue, buildPropertiesContent } = require('../src/main/server-files.js');
const fs = require('fs');
const os = require('os');
const path = require('path');

let pass = 0, fail = 0;
const check = (name, cond, detail) => cond ? (pass++, console.log('PASS', name)) : (fail++, console.log('FAIL', name + (detail ? ' -> ' + detail : '')));
const eq = (name, got, want) => check(name + ' (' + JSON.stringify(got) + ')', JSON.stringify(got) === JSON.stringify(want), 'want ' + JSON.stringify(want));

// --- decode: the section sign the game will actually show ---
eq('decodes \\u00a7 to a section sign', decodePropertiesValue('\\u00a7lBold'), '§lBold');
eq('decodes a colour code', decodePropertiesValue('\\u00a7cRed\\u00a7r'), '§cRed§r');
eq('decodes a plain value unchanged', decodePropertiesValue('hello'), 'hello');
eq('decodes an empty value', decodePropertiesValue(''), '');

// Java's other escapes
eq('decodes \\n', decodePropertiesValue('a\\nb'), 'a\nb');
eq('decodes \\t', decodePropertiesValue('a\\tb'), 'a\tb');
eq('decodes \\\\', decodePropertiesValue('a\\\\b'), 'a\\b');
eq('drops the backslash of an unknown escape', decodePropertiesValue('a\\qb'), 'aqb');
eq('keeps a malformed \\u as a literal u', decodePropertiesValue('\\uZZZZ'), 'uZZZZ');
eq('keeps a short \\u as a literal u', decodePropertiesValue('\\u00'), 'u00');
eq('drops a trailing backslash', decodePropertiesValue('a\\'), 'a');
eq('decodes a high escape', decodePropertiesValue('\\u00e9'), 'é');

// --- encode: back to a form the server reads the same way ---
eq('encodes a section sign', encodePropertiesValue('§lBold'), '\\u00a7lBold');
eq('encodes a plain value unchanged', encodePropertiesValue('hello'), 'hello');
eq('encodes a backslash', encodePropertiesValue('a\\b'), 'a\\\\b');
eq('encodes a newline', encodePropertiesValue('a\nb'), 'a\\nb');
eq('encodes a tab', encodePropertiesValue('a\tb'), 'a\\tb');
eq('encodes a high character', encodePropertiesValue('é'), '\\u00e9');

// --- round trip ---
// Two different properties, because a raw value is not always its own decode:
//   1. byte identity for a value whose escapes Java reads back verbatim (the common case)
//   2. meaning identity for EVERY value: what the game reads must not change
// "C:\Users\Server" is the case that separates them. Java treats "\U" as an unknown escape and
// drops the backslash, so the game already reads "C:UsersServer". The launcher now shows that
// same truth and writes it back, so the file changes but the meaning does not.
for (const raw of [
  '\\u00a71Just click on the text to \\u00a79edit\\u00a7r it.',
  'motd-plain',
  'a\\nb',
  'a\\\\b',
  '\\u00e9\\u00e8',
]) {
  check('byte round trip: ' + JSON.stringify(raw), encodePropertiesValue(decodePropertiesValue(raw)) === raw,
    'got ' + JSON.stringify(encodePropertiesValue(decodePropertiesValue(raw))));
}
for (const raw of [
  'C:\\Users\\Server',
  'a\\qb',
  '\\uZZZZ',
  'ends with a backslash\\',
]) {
  const meaning = decodePropertiesValue(raw);
  check('meaning round trip: ' + JSON.stringify(raw), decodePropertiesValue(encodePropertiesValue(meaning)) === meaning,
    'got ' + JSON.stringify(decodePropertiesValue(encodePropertiesValue(meaning))));
}

// --- the file writer keeps the escaped form, so the server still reads it ---
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-props-'));
  const original = 'motd=\\u00a71Just click on the text to \\u00a79edit\\u00a7r it.\nlevel-name=world\n';
  fs.writeFileSync(path.join(root, 'server.properties'), original);
  // The grid holds the DECODED value, so the writer gets a real section sign here.
  const out = buildPropertiesContent(root, { motd: '§1Just click on the text to §9edit§r it.' });
  check('the written file keeps the \\u00a7 escape', out.includes('motd=\\u00a71Just'), JSON.stringify(out.split('\n')[0]));
  check('an untouched line is left alone', out.includes('level-name=world'), JSON.stringify(out));
  // A value the user never touched must not be rewritten at all.
  const out2 = buildPropertiesContent(root, { levelName: 'world' });
  check('an unrelated key does not change the motd line', out2.includes('motd=\\u00a71Just'), JSON.stringify(out2.split('\n')[0]));

  // The whole point: what the grid shows is what the server shows.
  const { serverFiles } = require('../src/main/server-files.js');
  const files = serverFiles(root);
  check('serverFiles hands the grid a DECODED motd', files.properties.motd === '§1Just click on the text to §9edit§r it.', JSON.stringify(files.properties.motd));
  check('serverFiles leaves a plain value alone', files.properties['level-name'] === 'world', JSON.stringify(files.properties['level-name']));
  fs.rmSync(root, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);