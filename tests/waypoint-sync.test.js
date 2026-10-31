const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  parseXaero,
  serializeXaero,
  parseJourneyMap,
  serializeJourneyMap,
  mergeWaypoints,
  importWaypoints,
  exportWaypoints,
} = require('../src/main/waypoint-sync.js');

let pass = 0, fail = 0;
function check(name, cond) {
  cond ? (pass++, console.log('PASS', name)) : (fail++, console.log('FAIL', name));
}

// 1. parseXaero
const sampleXaero = `
#
#waypoint:name:initials:x:y:z:color:disabled:type:setrotation:rotate_on_tp:tp_yaw:visibility_type
#
waypoint:Base:B:100:64:-250:9:false:0:0:false:0:0
waypoint:Nether_Portal:N:20:70:80:4:false:0:0:false:0:0
`;
const parsedX = parseXaero(sampleXaero, 'overworld');
check('parseXaero returns 2 items', parsedX.length === 2);
check('item 1 name is Base', parsedX[0].name === 'Base');
check('item 1 x is 100', parsedX[0].x === 100);
check('item 1 z is -250', parsedX[0].z === -250);
check('item 1 color is light blue (#5555FF)', parsedX[0].color === '#5555FF');

// 2. serializeXaero
const serializedX = serializeXaero(parsedX);
check('serializedX contains waypoint:Base', serializedX.includes('waypoint:Base:B:100:64:-250:9:false:0:0:false:0:0'));

// 3. parseJourneyMap
const sampleJm = [
  {
    id: 'village',
    name: 'Village',
    x: 500,
    y: 72,
    z: -300,
    r: 255,
    g: 85,
    b: 85,
    dimensions: ['minecraft:overworld'],
  },
  {
    id: 'fortress',
    name: 'Nether Fortress',
    x: -120,
    y: 55,
    z: 340,
    r: 170,
    g: 0,
    b: 0,
    dimensions: ['minecraft:the_nether'],
  },
];
const parsedJm = parseJourneyMap(sampleJm);
check('parseJourneyMap returns 2 items', parsedJm.length === 2);
check('item 1 dim is overworld', parsedJm[0].dim === 'overworld');
check('item 2 dim is nether', parsedJm[1].dim === 'nether');
check('item 1 color parsed as hex', parsedJm[0].color === '#ff5555');

// 4. serializeJourneyMap
const serializedJm = serializeJourneyMap(parsedJm);
check('serializedJm is valid JSON', Array.isArray(JSON.parse(serializedJm)));

// 5. mergeWaypoints
const existing = [
  { id: '1', name: 'Base', x: 100, y: 64, z: -250, dim: 'overworld' },
];
const incoming = [
  { id: '2', name: 'Base', x: 100, y: 64, z: -250, dim: 'overworld' }, // duplicate
  { id: '3', name: 'Mineshaft', x: 450, y: 20, z: -80, dim: 'overworld' }, // new
];
const mergeRes = mergeWaypoints(existing, incoming);
check('mergeWaypoints addedCount 1', mergeRes.addedCount === 1);
check('mergeWaypoints total length 2', mergeRes.merged.length === 2);

// 6. import & export on disk
const tmp = path.join(os.tmpdir(), 'ob-wp-test-' + Date.now());
fs.mkdirSync(tmp, { recursive: true });
async function testDisk() {
  try {
    const impRes = await importWaypoints(tmp, { format: 'xaero', data: sampleXaero, dim: 'overworld' });
    check('importWaypoints ok', impRes.ok && impRes.added === 2);

    const expRes = await exportWaypoints(tmp, { format: 'journeymap', dim: 'overworld' });
    check('exportWaypoints ok', expRes.ok && expRes.count === 2);
    check('exported data parses as JSON', Array.isArray(JSON.parse(expRes.data)));
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

testDisk();

