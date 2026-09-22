// curseforge.test.js — pure decision logic for the CurseForge integration.
const cf = require('../src/main/curseforge.js');
let pass = 0, fail = 0;
const ck = (n, c) => c ? (pass++, console.log('PASS', n)) : (fail++, console.log('FAIL', n));

// classIdForKind
ck('plugin -> 5', cf.classIdForKind('plugin') === 5);
ck('mod -> 6', cf.classIdForKind('mod') === 6);
ck('forge -> 6', cf.classIdForKind('forge') === 6);
ck('modpack -> 4471', cf.classIdForKind('modpack') === 4471);
ck('datapack -> 6945', cf.classIdForKind('datapack') === 6945);
ck('unknown -> mod (6)', cf.classIdForKind('nope') === 6);

// loaderIdFor
ck('forge -> 1', cf.loaderIdFor('forge') === 1);
ck('fabric -> 4', cf.loaderIdFor('fabric') === 4);
ck('quilt -> 5', cf.loaderIdFor('quilt') === 5);
ck('neoforge -> 6', cf.loaderIdFor('neoforge') === 6);
ck('unknown -> any (0)', cf.loaderIdFor('') === 0);

// cfFileInstallable: the distribution gate
ck('file with url -> ok', cf.cfFileInstallable({ downloadUrl: 'https://edge.forgecdn.net/files/1/2/x.jar' }).ok);
ck('null downloadUrl -> blocked', cf.cfFileInstallable({ downloadUrl: null }).reason === 'blocked');
ck('missing downloadUrl -> blocked', cf.cfFileInstallable({}).reason === 'blocked');
ck('isAvailable:false -> blocked', cf.cfFileInstallable({ downloadUrl: 'https://x/y.jar', isAvailable: false }).reason === 'blocked');
ck('null file -> missing', cf.cfFileInstallable(null).reason === 'missing');
ck('ok returns the url', cf.cfFileInstallable({ downloadUrl: 'https://edge.forgecdn.net/files/1/2/x.jar' }).url === 'https://edge.forgecdn.net/files/1/2/x.jar');

// mapCfItem: shape matches the other sources
const item = cf.mapCfItem({ id: 42, name: 'Cool Mod', summary: 'does things', downloadCount: 123, authors: [{ name: 'Dev' }], logo: { thumbnailUrl: 'https://x/i.png' }, latestFiles: [{ downloadUrl: 'https://edge.forgecdn.net/files/1/2/x.jar' }], links: { websiteUrl: 'https://www.curseforge.com/minecraft/mc-mods/cool' } });
ck('mapCfItem source', item.source === 'curseforge');
ck('mapCfItem id is string', item.id === '42');
ck('mapCfItem title', item.title === 'Cool Mod');
ck('mapCfItem author', item.author === 'Dev');
ck('mapCfItem blocked=false when url present', item.blocked === false);
ck('mapCfItem projectUrl from links', item.projectUrl === 'https://www.curseforge.com/minecraft/mc-mods/cool');
const blockedItem = cf.mapCfItem({ id: 7, name: 'Blocked', latestFiles: [{ downloadUrl: null }] });
ck('mapCfItem blocked=true when no url', blockedItem.blocked === true);
ck('mapCfItem fallback projectUrl', cf.mapCfItem({ id: 7, name: 'B', slug: 'b' }).projectUrl.includes('curseforge.com'));

// pickCfFile: newest matching gameVersion
const files = [
  { fileDate: '2024-01-01T00:00:00Z', fileName: 'old.jar', gameVersions: ['1.19.2'] },
  { fileDate: '2024-06-01T00:00:00Z', fileName: 'new.jar', gameVersions: ['1.20.1'] },
  { fileDate: '2024-03-01T00:00:00Z', fileName: 'mid.jar', gameVersions: ['1.20.1'] },
];
ck('pickCfFile matches gameVersion newest', cf.pickCfFile(files, '1.20.1', 0).fileName === 'new.jar');
ck('pickCfFile falls back when no version match', cf.pickCfFile(files, '1.99', 0).fileName === 'new.jar');
ck('pickCfFile empty -> null', cf.pickCfFile([], '1.20.1', 0) === null);
ck('pickCfFile respects modLoader', cf.pickCfFile([{ fileDate: '2024-01-01', fileName: 'f.jar', gameVersions: ['1.20.1'], modLoader: 4 }], '1.20.1', 1) === null || cf.pickCfFile([{ fileDate: '2024-01-01', fileName: 'f.jar', gameVersions: ['1.20.1'], modLoader: 4 }], '1.20.1', 1).fileName === 'f.jar');

// parseCfManifest
ck('manifest: valid parses', cf.parseCfManifest({ manifestType: 'minecraftModpack', name: 'Pack', version: '1.0', minecraft: { version: '1.20.1', modLoaders: [{ id: 'forge-47.2.0', primary: true }] }, files: [{ projectID: 1, fileID: 2 }] }).ok);
ck('manifest: rejects non-object', cf.parseCfManifest(null).ok === false);
ck('manifest: rejects wrong type', cf.parseCfManifest({ manifestType: 'other' }).reason === 'notModpack');
ck('manifest: name default', cf.parseCfManifest({ manifestType: 'minecraftModpack' }).name === 'CurseForge modpack');
ck('manifest: maps files', (() => { const m = cf.parseCfManifest({ manifestType: 'minecraftModpack', files: [{ projectID: 10, fileID: 20, required: false }] }); return m.files[0].projectID === 10 && m.files[0].fileID === 20 && m.files[0].required === false; })());
ck('manifest: overrides default', cf.parseCfManifest({ manifestType: 'minecraftModpack' }).overrides === 'overrides');

// cfLoaderFromManifest
ck('loader: forge', cf.cfLoaderFromManifest([{ id: 'forge-47.2.0', primary: true }]).loader === 'forge');
ck('loader: neoforge', cf.cfLoaderFromManifest([{ id: 'neoforge-20.4.1' }]).loader === 'neoforge');
ck('loader: fabric', cf.cfLoaderFromManifest([{ id: 'fabric-0.15.0' }]).loader === 'fabric');
ck('loader: quilt', cf.cfLoaderFromManifest([{ id: 'quilt-0.20.0' }]).loader === 'quilt');
ck('loader: unknown', cf.cfLoaderFromManifest([{ id: 'weird-1.0' }]).loader === 'unknown');
ck('loader: empty -> unknown', cf.cfLoaderFromManifest([]).loader === 'unknown');
ck('loader: version parsed', cf.cfLoaderFromManifest([{ id: 'forge-47.2.0' }]).version === '47.2.0');
ck('loader: prefers primary', cf.cfLoaderFromManifest([{ id: 'fabric-1' }, { id: 'forge-2', primary: true }]).loader === 'forge');

// partitionCfFiles
const part = cf.partitionCfFiles([
  { id: 1, modId: 10, fileName: 'a.jar', downloadUrl: 'https://edge.forgecdn.net/files/1/2/a.jar', hashes: [{ algo: 1, value: 'abc' }] },
  { id: 2, modId: 11, fileName: 'b.jar', downloadUrl: null },
  { id: 3, modId: 12, fileName: 'c.jar', downloadUrl: 'https://edge.forgecdn.net/files/1/2/c.jar', isAvailable: false },
]);
ck('partition: installable count', part.installable.length === 1);
ck('partition: blocked count', part.blocked.length === 2);
ck('partition: installable url kept', part.installable[0].url.includes('forgecdn'));
ck('partition: sha1 extracted', part.installable[0].hashes.sha1 === 'abc');
ck('partition: blocked has projectID', part.blocked[0].projectID === 11);

// verifyBlockedFiles
const fs = require('fs'), os = require('os'), path = require('path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-cf-vb-'));
fs.mkdirSync(path.join(tmp, 'mods'), { recursive: true });
fs.writeFileSync(path.join(tmp, 'mods', 'x.jar'), 'hello');
const realSha = require('../src/main/fs-utils.js').fileHashes(path.join(tmp, 'mods', 'x.jar')).sha1;
const v1 = cf.verifyBlockedFiles(tmp, [{ fileID: 1, fileName: 'x.jar', hashes: { sha1: realSha } }], 'mods');
ck('verify: hash match -> verified', v1.verified.length === 1 && v1.missing.length === 0);
const v2 = cf.verifyBlockedFiles(tmp, [{ fileID: 2, fileName: 'nope.jar', hashes: { sha1: 'deadbeef' } }], 'mods');
ck('verify: no match -> missing', v2.missing.length === 1);
const v3 = cf.verifyBlockedFiles(tmp, [{ fileID: 3, fileName: 'x.jar', hashes: {} }], 'mods');
ck('verify: filename fallback when no hash', v3.verified.length === 1);
fs.rmSync(tmp, { recursive: true, force: true });

// cfDependencies: best-effort relationType mapping (3=required, 2=optional, 5=incompatible)
const deps = cf.cfDependencies({ dependencies: [{ modId: 100, relationType: 3 }, { modId: 200, relationType: 2 }, { modId: 300, relationType: 5 }, { modId: 400, relationType: 99 }] });
ck('cfDependencies count', deps.length === 4);
ck('cfDependencies required', deps[0].type === 'required' && deps[0].uncertain === false);
ck('cfDependencies optional', deps[1].type === 'optional');
ck('cfDependencies incompatible', deps[2].type === 'incompatible');
ck('cfDependencies unknown marked uncertain', deps[3].type === 'unknown' && deps[3].uncertain === true);
ck('cfDependencies projectId string', deps[0].projectId === '100');
ck('cfDependencies empty safe', cf.cfDependencies({}).length === 0 && cf.cfDependencies(null).length === 0);
ck('cfDependencies drops no-modId', cf.cfDependencies({ dependencies: [{ relationType: 3 }] }).length === 0);

// mapCfFileToVersion: CF file -> the renderer's version-picker shape
const fv = cf.mapCfFileToVersion({ id: 55, displayName: 'Build 55', fileDate: '2024-06-01T00:00:00Z', gameVersions: ['1.20.1'], fileLength: 2048, hashes: [{ algo: 1, value: 'sha1abc' }], downloadUrl: 'https://edge.forgecdn.net/files/1/2/x.jar' });
ck('mapCfFileToVersion id string', fv.id === '55');
ck('mapCfFileToVersion number', fv.number === 'Build 55');
ck('mapCfFileToVersion gameVersions', fv.gameVersions[0] === '1.20.1');
ck('mapCfFileToVersion size', fv.size === 2048);
ck('mapCfFileToVersion sha1', fv.sha1 === 'sha1abc');
ck('mapCfFileToVersion not blocked when url present', fv.blocked === false);
ck('mapCfFileToVersion blocked when no url', cf.mapCfFileToVersion({ id: 1, fileName: 'b.jar', downloadUrl: null }).blocked === true);
ck('mapCfFileToVersion null safe', cf.mapCfFileToVersion(null) === null);
ck('mapCfFileToVersion name fallback', cf.mapCfFileToVersion({ id: 9, fileName: 'z.jar', downloadUrl: 'https://x/y.jar' }).number === 'z.jar');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
