// mcp-pii.test.js — v4.2.0: MCP output hygiene. Covers the helpers that keep PII + config secrets
// from leaving the machine via an AI client: maskSecrets (velocity.toml / properties), the crash
// summary scrub, and propertyValueError (set_property sanity).
const doctor = require('../src/mcp/doctor.js');
let pass = 0, fail = 0;
const ck = (n, c) => c ? (pass++, console.log('PASS', n)) : (fail++, console.log('FAIL', n));

// ---- maskSecrets: velocity.toml forwarding-secret + generic secret keys ----
const toml = [
  'bind = "0.0.0.0:25577"',
  'motd = "A Velocity Server"',
  'forwarding-secret = "s3cr3t-value-here"',
  'online-mode = true',
].join('\n');
const masked = doctor.maskSecrets(toml);
ck('maskSecrets redacts forwarding-secret', masked.includes('forwarding-secret = [redacted]'));
ck('maskSecrets keeps the secret value out', !masked.includes('s3cr3t-value-here'));
ck('maskSecrets keeps non-secret lines', masked.includes('motd = "A Velocity Server"') && masked.includes('online-mode = true'));
// other key shapes
ck('maskSecrets redacts rcon.password', doctor.maskSecrets('rcon.password=abc123').includes('[redacted]') && !doctor.maskSecrets('rcon.password=abc123').includes('abc123'));
ck('maskSecrets redacts api_key (colon form)', doctor.maskSecrets('api_key: 12345').includes('[redacted]') && !doctor.maskSecrets('api_key: 12345').includes('12345'));
ck('maskSecrets redacts a token key', doctor.maskSecrets('session-token = zzz').includes('[redacted]'));
ck('maskSecrets ignores a normal key', doctor.maskSecrets('max-players = 20') === 'max-players = 20');
ck('maskSecrets null-safe', doctor.maskSecrets(null) === '');
// SECRET_KEY_RE is exported and matches the intended key names, not e.g. 'compassion'
ck('SECRET_KEY_RE matches secret', doctor.SECRET_KEY_RE.test('forwarding-secret'));
ck('SECRET_KEY_RE matches password', doctor.SECRET_KEY_RE.test('rcon.password'));
ck('SECRET_KEY_RE not fooled by a false positive', !doctor.SECRET_KEY_RE.test('max-players'));

// ---- scrubCrashSummary: PII stripped from description + cause[] ----
const summary = doctor.scrubCrashSummary({
  description: 'Ticking entity at 203.0.113.7',
  version: '1.21.4',
  mods: null,
  cause: ['Caused by: java.io.IOException from host 10.0.0.5', 'at net.Foo(Foo.java:1)'],
  size: 42,
});
ck('scrubCrashSummary scrubs description IP', !summary.description.includes('203.0.113.7') && summary.description.includes('[ip]'));
ck('scrubCrashSummary scrubs cause IP', summary.cause.every(c => !c.includes('10.0.0.5')));
ck('scrubCrashSummary keeps version', summary.version === '1.21.4');
ck('scrubCrashSummary keeps cause length', summary.cause.length === 2);
ck('scrubCrashSummary null-safe', doctor.scrubCrashSummary(null).description === undefined);
// crash cause chain from a real-ish report that carries an email
const realish = doctor.scrubCrashSummary(doctor.summarizeCrashText([
  'Description: Ticking entity',
  'Minecraft Version: 1.21.4',
  'java.lang.RuntimeException: contact admin@example.com',
  'Caused by: java.lang.NullPointerException',
].join('\n')));
ck('scrubCrashSummary email scrubbed from cause', realish.cause.every(c => !c.includes('@example.com')));

// ---- propertyValueError: numeric range + enum ----
ck('propertyValueError accepts a good port', doctor.propertyValueError('server-port', '25565') === null);
ck('propertyValueError rejects a bad port', typeof doctor.propertyValueError('server-port', 'abc') === 'string');
ck('propertyValueError rejects an out-of-range port', typeof doctor.propertyValueError('server-port', '99999') === 'string');
ck('propertyValueError rejects a huge view-distance', typeof doctor.propertyValueError('view-distance', '99') === 'string');
ck('propertyValueError accepts a sane view-distance', doctor.propertyValueError('view-distance', '10') === null);
ck('propertyValueError rejects a bad gamemode', typeof doctor.propertyValueError('gamemode', 'flying') === 'string');
ck('propertyValueError accepts a good gamemode', doctor.propertyValueError('gamemode', 'creative') === null);
ck('propertyValueError passes an unknown key through', doctor.propertyValueError('motd', 'hi') === null);
ck('propertyValueError rejects a bad max-players', typeof doctor.propertyValueError('max-players', '0') === 'string');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
