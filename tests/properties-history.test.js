// v6.0.0 G2: properties-history - snapshot record/list/get, no-op dedupe, line diff, and cap.
const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(os.tmpdir(), 'ob-ph-' + Date.now());
fs.mkdirSync(dataDir, { recursive: true });
process.env.OBSERVER_DATA_DIR = dataDir;
const H = require('../src/main/properties-history.js');

let passed = 0;
function ok(name, cond) { assert(cond, `FAIL: ${name}`); console.log(`PASS ${name}`); passed++; }

// record + list + get
H.recordSnapshot('A', 'motd=Hello\nmax-players=20');
const list1 = H.listSnapshots('A');
ok('one snapshot recorded', list1.length === 1);
ok('snapshot has a size', list1[0].size > 0);
const got = H.getSnapshot('A', list1[0].t);
ok('getSnapshot returns the content', got.ok && got.content.includes('motd=Hello'));

// dedupe: recording identical content is a no-op
const r = H.recordSnapshot('A', 'motd=Hello\nmax-players=20');
ok('identical snapshot skipped', r.skipped === true && H.listSnapshots('A').length === 1);

// a real change records a new snapshot, newest first
H.recordSnapshot('A', 'motd=Changed\nmax-players=20');
const list2 = H.listSnapshots('A');
ok('two snapshots after a change', list2.length === 2);
ok('list is newest first', list2[0].t >= list2[1].t);

// getSnapshot unknown timestamp
ok('unknown snapshot fails cleanly', H.getSnapshot('A', 1).ok === false);

// diffLines: a changed line shows as - / +
{
  const d = H.diffLines('a=1\nb=2\nc=3', 'a=1\nb=99\nc=3');
  const removed = d.lines.filter(l => l.type === '-').map(l => l.text);
  const added = d.lines.filter(l => l.type === '+').map(l => l.text);
  ok('diff removed b=2', removed.includes('b=2'));
  ok('diff added b=99', added.includes('b=99'));
  ok('diff kept unchanged a=1', d.lines.some(l => l.type === ' ' && l.text === 'a=1'));
  ok('diff counts', d.removed === 1 && d.added === 1);
}
// identical texts -> no changes
{
  const d = H.diffLines('x=1\ny=2', 'x=1\ny=2');
  ok('identical diff has no +/-', d.added === 0 && d.removed === 0);
}
// pure addition
{
  const d = H.diffLines('x=1', 'x=1\ny=2');
  ok('pure addition', d.added === 1 && d.removed === 0);
}

// cap: recording MAX+5 distinct snapshots keeps only MAX
for (let i = 0; i < H.MAX_SNAPSHOTS + 5; i++) H.recordSnapshot('B', 'v=' + i);
ok('history capped at MAX_SNAPSHOTS', H.listSnapshots('B').length === H.MAX_SNAPSHOTS);

// deleteHistory drops the file
H.deleteHistory('A');
ok('deleteHistory empties the list', H.listSnapshots('A').length === 0);

fs.rmSync(dataDir, { recursive: true, force: true });
console.log(`\n${passed} passed, 0 failed`);
