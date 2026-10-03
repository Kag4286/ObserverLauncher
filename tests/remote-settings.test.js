// R1 (v3.3.0): remote-management foundation - token + allowlist matching + snapshot. Pure, no network.
const S = require('../src/main/secrets.js');
const R = require('../src/main/remote.js');
const { defaultGlobal } = require('../src/main/settings.js');

let pass = 0, fail = 0;
const ck = (n, c) => c ? (pass++, console.log('PASS', n)) : (fail++, console.log('FAIL', n));

// token
const t = R.newRemoteToken();
ck('token is 48 hex chars', /^[0-9a-f]{48}$/.test(t));
ck('two tokens differ', R.newRemoteToken() !== R.newRemoteToken());

// secrets: remoteToken is a wrapped global secret
ck('remoteToken is a global secret key', S.GLOBAL_SECRET_KEYS.includes('remoteToken'));
const fake = { isEncryptionAvailable: () => true, encryptString: s => Buffer.from(String(s)), decryptString: b => b.toString() };
const enc = S.wrapStore({ remoteToken: 'abc' }, fake);
ck('remoteToken gets wrapped', String(enc.remoteToken).startsWith('safe:'));
ck('remoteToken round-trips', S.unwrapStore(enc, fake).remoteToken === 'abc');

// settings defaults
const g = defaultGlobal();
ck('remoteEnabled default false', g.remoteEnabled === false);
ck('remoteReadOnly default true', g.remoteReadOnly === true);
ck('remoteAllow default empty', g.remoteAllow === '');

// allowlist parsing
ck('parse empty -> []', R.parseAllowList('').length === 0);
ck('parse comma', R.parseAllowList('a,b').length === 2);
ck('parse space+comma mix', R.parseAllowList('a, b  c').join('|') === 'a|b|c');

// isIpAllowed
ck('empty allow -> any', R.isIpAllowed('1.2.3.4', '') === true);
ck('exact match', R.isIpAllowed('1.2.3.4', '1.2.3.4') === true);
ck('exact miss', R.isIpAllowed('1.2.3.5', '1.2.3.4') === false);
ck('wildcard match', R.isIpAllowed('192.168.1.7', '192.168.1.*') === true);
ck('wildcard miss', R.isIpAllowed('192.168.2.7', '192.168.1.*') === false);
ck('CIDR /24 match', R.isIpAllowed('10.0.0.55', '10.0.0.0/24') === true);
ck('CIDR /24 miss', R.isIpAllowed('10.0.1.1', '10.0.0.0/24') === false);
ck('CIDR /32 exact', R.isIpAllowed('10.0.0.1', '10.0.0.1/32') === true);
ck('ipv6 localhost exact', R.isIpAllowed('::1', '::1') === true);
ck('ipv4-mapped normalised', R.isIpAllowed('::ffff:10.0.0.1', '10.0.0.1') === true);
ck('allow-any still needs an ip', R.isIpAllowed('', '1.2.3.4') === false);

// snapshot
const snap = R.remoteSnapshot({ remoteEnabled: true, remoteReadOnly: false, remoteAllow: '10.0.0.1', remotePort: 8777, remoteToken: 'x' });
ck('snapshot enabled', snap.enabled === true);
ck('snapshot readOnly false', snap.readOnly === false);
ck('snapshot allow list', snap.allow.join() === '10.0.0.1');
ck('snapshot port', snap.port === 8777);
ck('snapshot tokenSet true', snap.tokenSet === true);
ck('snapshot does not leak token', !('remoteToken' in snap));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
