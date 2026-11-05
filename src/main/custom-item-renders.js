// custom-item-renders.js — Procedural 3D/sprite rendering for mod items lacking 2D icons.
//
// Mods like Sophisticated Backpacks and Waystones use custom Java/Blockbench model loaders
// with multi-part UV atlas sheets rather than standard item sprites. This module procedurally
// generates crisp 32x32 item icons matching Minecraft's native aesthetic.
//
// 100% headless: uses Node core zlib (no DOM or Electron dependency).

const zlib = require('zlib');

const CRC_TABLE = new Int32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  CRC_TABLE[i] = c;
}

function calcCrc32(buf) {
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.concat([t, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(calcCrc32(crcBuf), 0);
  return Buffer.concat([len, t, data, crc]);
}

function encodePng(width, height, rgba) {
  const lineSize = width * 4;
  const raw = Buffer.alloc(height * (lineSize + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (lineSize + 1)] = 0;
    rgba.copy(raw, y * (lineSize + 1) + 1, y * lineSize, (y + 1) * lineSize);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

class FastCanvas {
  constructor(w = 32, h = 32) {
    this.w = w;
    this.h = h;
    this.buf = Buffer.alloc(w * h * 4, 0);
  }
  set(x, y, color) {
    const rx = Math.round(x), ry = Math.round(y);
    if (rx < 0 || rx >= this.w || ry < 0 || ry >= this.h) return;
    const idx = (ry * this.w + rx) * 4;
    const [r, g, b, a = 255] = color;
    if (a >= 255) {
      this.buf[idx] = r; this.buf[idx + 1] = g; this.buf[idx + 2] = b; this.buf[idx + 3] = 255;
    } else {
      const sa = a / 255, da = this.buf[idx + 3] / 255;
      const oa = sa + da * (1 - sa);
      if (oa > 0) {
        this.buf[idx] = Math.round((r * sa + this.buf[idx] * da * (1 - sa)) / oa);
        this.buf[idx + 1] = Math.round((g * sa + this.buf[idx + 1] * da * (1 - sa)) / oa);
        this.buf[idx + 2] = Math.round((b * sa + this.buf[idx + 2] * da * (1 - sa)) / oa);
        this.buf[idx + 3] = Math.round(oa * 255);
      }
    }
  }
  rect(x, y, w, h, color) {
    for (let j = y; j < y + h; j++) {
      for (let i = x; i < x + w; i++) this.set(i, j, color);
    }
  }
  toPng() {
    return encodePng(this.w, this.h, this.buf);
  }
}

function hexToRgba(hex, a = 255) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, a];
}

const BACKPACK_TIERS = {
  leather:   { main: [194, 140, 70], dark: [120, 79, 24], light: [224, 170, 98] },
  copper:    { main: [212, 108, 72], dark: [153, 70, 40], light: [232, 146, 113] },
  iron:      { main: [220, 220, 220], dark: [158, 158, 158], light: [255, 255, 255] },
  gold:      { main: [255, 215, 0], dark: [184, 134, 11], light: [255, 242, 133] },
  diamond:   { main: [78, 237, 213], dark: [28, 155, 136], light: [156, 255, 241] },
  netherite: { main: [76, 65, 70], dark: [44, 36, 40], light: [107, 92, 98] },
};

function renderBackpack(name) {
  const cv = new FastCanvas(32, 32);
  const s = String(name || '').toLowerCase();
  let tier = 'leather';
  if (s.includes('netherite')) tier = 'netherite';
  else if (s.includes('diamond')) tier = 'diamond';
  else if (s.includes('gold')) tier = 'gold';
  else if (s.includes('iron')) tier = 'iron';
  else if (s.includes('copper')) tier = 'copper';

  const clip = BACKPACK_TIERS[tier] || BACKPACK_TIERS.iron;
  const lDark = [78, 41, 18], lMid = [121, 70, 36], lLight = [154, 92, 48], lHi = [181, 113, 62];

  // Handle on top
  cv.rect(13, 3, 6, 2, lDark);
  cv.rect(14, 2, 4, 1, lMid);

  // Bag body & dark outline
  cv.rect(6, 6, 20, 21, lMid);
  cv.rect(6, 6, 1, 21, lDark);
  cv.rect(25, 6, 1, 21, lDark);
  cv.rect(7, 26, 18, 1, lDark);

  // Top flap
  cv.rect(7, 5, 18, 8, lLight);
  cv.rect(7, 13, 18, 2, lMid);
  cv.rect(6, 5, 1, 9, lDark);
  cv.rect(25, 5, 1, 9, lDark);
  cv.rect(8, 14, 16, 1, lDark);
  cv.rect(8, 6, 16, 1, lHi);

  // Front pouch
  cv.rect(9, 17, 14, 8, lMid);
  cv.rect(9, 17, 14, 1, lHi);
  cv.rect(9, 18, 1, 7, lDark);
  cv.rect(22, 18, 1, 7, lDark);
  cv.rect(10, 24, 12, 1, [46, 22, 8, 180]);

  // Straps
  cv.rect(10, 5, 2, 21, lDark);
  cv.rect(20, 5, 2, 21, lDark);

  // Tier clips
  cv.rect(10, 12, 2, 3, clip.dark);
  cv.rect(20, 12, 2, 3, clip.dark);
  cv.rect(14, 18, 4, 3, clip.dark);
  cv.rect(10, 12, 2, 1, clip.light);
  cv.rect(20, 12, 2, 1, clip.light);
  cv.rect(14, 18, 4, 1, clip.light);
  cv.rect(10, 13, 2, 1, clip.main);
  cv.rect(20, 13, 2, 1, clip.main);
  cv.rect(15, 19, 2, 1, clip.main);

  // Side pockets
  cv.rect(4, 13, 2, 11, lDark);
  cv.rect(5, 13, 1, 10, lMid);
  cv.rect(26, 13, 2, 11, lDark);
  cv.rect(26, 13, 1, 10, lMid);

  return cv.toPng();
}

function drawIsoPillar(cv, cx, cy, rx, ry, h, cTop, cLeft, cRight) {
  for (let dy = -ry; dy <= ry; dy++) {
    const span = Math.round(rx * (1 - Math.abs(dy) / ry));
    for (let dx = -span; dx <= span; dx++) cv.set(cx + dx, cy + dy, cTop);
  }
  for (let y = cy; y < cy + h; y++) {
    for (let x = -rx; x <= 0; x++) {
      const topY = cy + Math.round((x / rx + 1) * ry);
      if (y >= topY) cv.set(cx + x, y, cLeft);
    }
    for (let x = 0; x <= rx; x++) {
      const topY = cy + Math.round((1 - x / rx) * ry);
      if (y >= topY) cv.set(cx + x, y, cRight);
    }
  }
}

function renderWaystone(name) {
  const cv = new FastCanvas(32, 32);
  const s = String(name || '').toLowerCase();
  const isMossy = s.includes('mossy');
  const isSandy = s.includes('sandy') || s.includes('sandstone');

  let c1 = hexToRgba('#6b7175'), c2 = hexToRgba('#4f5458'), c3 = hexToRgba('#383c3e');
  let p1 = hexToRgba('#8a9196'), p2 = hexToRgba('#6b7175'), p3 = hexToRgba('#4f5458');
  let top1 = hexToRgba('#9aa2a8'), top2 = hexToRgba('#aab2b8');

  if (isMossy) {
    c1 = hexToRgba('#587258'); p1 = hexToRgba('#6d8a6d');
  } else if (isSandy) {
    c1 = hexToRgba('#c2b280'); c2 = hexToRgba('#a89a6c'); c3 = hexToRgba('#8e8055');
    p1 = hexToRgba('#d4c698'); p2 = hexToRgba('#b8a87a'); p3 = hexToRgba('#9c8c60');
    top1 = hexToRgba('#ded2aa'); top2 = hexToRgba('#eae0be');
  }

  // Base bottom & middle
  drawIsoPillar(cv, 16, 23, 11, 5, 4, c1, c2, c3);
  drawIsoPillar(cv, 16, 20, 9, 4, 3, c1, c2, c3);

  // Pillar
  drawIsoPillar(cv, 16, 9, 6, 3, 11, p1, p2, p3);

  // Capstone & tip
  drawIsoPillar(cv, 16, 6, 7, 3, 3, top1, p2, p3);
  drawIsoPillar(cv, 16, 4, 4, 2, 2, top2, p1, p2);

  // Runic warp crystal (purple/cyan)
  const gem1 = s.includes('sharestone') ? [78, 237, 213] : [181, 94, 255];
  const gem2 = s.includes('sharestone') ? [156, 255, 241] : [216, 158, 255];
  const gemDark = s.includes('sharestone') ? [28, 155, 136] : [121, 34, 212];
  cv.set(14, 13, gem1);
  cv.set(15, 13, gem2);
  cv.set(14, 14, gemDark);
  cv.set(15, 14, gem1);
  cv.set(16, 14, gemDark);
  cv.set(17, 14, gem1);
  cv.set(16, 15, gem2);
  cv.set(17, 15, gemDark);

  return cv.toPng();
}

function renderCustomModItem(namespace, name) {
  const ns = String(namespace || '').toLowerCase();
  const n = String(name || '').toLowerCase();

  if (ns === 'sophisticatedbackpacks') {
    if (n.includes('backpack') || n.includes('pouch')) {
      return renderBackpack(n);
    }
  }

  if (ns === 'waystones') {
    if (n.includes('waystone') || n.includes('sharestone') || n.includes('portstone')) {
      return renderWaystone(n);
    }
  }

  return null;
}

const TNT_3D_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAE3klEQVR4AexSXUxbZRh++0NnacspXWm7BqcxRIyJW5hRNOoyNYvR' +
  'GY0XLlmIDJi6C4iQZpuMtTop4NRsAcd2MWV1AyKCF0y8MOFCMxd1izFxiMqPQxDa9bD2AAUKXQHP87mDtKeMQrLsZk3f8/29' +
  '7/c83/O8SrrNvzsE1qyA7ylbRu/mDW4E5mt1ctUE+nJsGR2W7EqVhvivd+93IjAHEZytlkjSBFptWRmjz9oqORPxuQ+NuwCk' +
  '8rgJgbnRvODEGf+M1b0aIisSmNhmN+N1OdZp/ofLnKtk/VZC/HiZo8PDBhbZv2jYHtvvMjppXsmDSDLWLEvA+7DdfC4j2z2j' +
  'mh+FzIeyn6THN41Tdc8Fyvv2V2p+ejO5XGV4PPVsiSzuF0TDhNymF992JmONjECH/X4z2Lfk7RsVAZ1AgMxP/NGJKT06pCaA' +
  'dHb+RG53LduDAgAV8xkZ6Qz7sKbjtQNMkUTWyAhwdwsfXvydS8XNn/OzBKlfUGppl2Ud4cLDmSEcxcT27Y+xtZSPxaWNUfpM' +
  'rSXsYX2hR284c0VZj/nSUC5dYB4UFC8b7gk6NNV1nqxgxjHsdezexzzGhSADQMwxImAJrLn3qoWpI9VgfCSSWmf0vNfarQiU' +
  '/qkbfx57S0NGAIehMQX9YxIKdZlBR4op6FGdqjkGCyAxpEYO5thDoB9A8q+De5kFUEl1uqpuWMe3NnmjpSOCYqdvfB3KZJGQ' +
  'gJQFInNEheTXO3JS1Z6L3WmMCEBhDWxBQAH0CeL73/S1/JC27Xo0Wtod0OwMpIWk6xKOMgIbW76RJXrNQRofE4lwgkPlTVu0' +
  'pmnHAUKgIDeSWmug+baBdL6sXz/2anhSdjVtq/gAqTEhzxKPlR810NajTeIs9n+F18msgdQB29W2s95omSh1QmDlmw4ylb4R' +
  'e9mNVUICvr8HqbyinvYEM2m6Uta4FBJ7pI/XFQ7PRQoCwlwRgBNJDdBLKQ/Sp6e/Iq1GQ9f8/huw/w8JCRisFpZxvL6c9Fot' +
  'ban6hKAK20zis2lvOc0WlDDQ14teImFsjAIiuNlqlVXLCPx8/jyF/Dz5/aMMHBVV7gaaDIcp68zHCa1BDgKgkDsciWBJGBFs' +
  'IX56u7rEb+xfRsBysoam3j1KNa4i8olWIP1ITQlJJGBNRUoOI4MzBIAhdX19CwOF3M1N/zXztCBQUd5zNNLuIW+HvK9kBHDh' +
  'fZYp6jt+iBEBCYTTtQdHJI1QZNcX35HlYDWTWhBl3u/IZ3O8+pUduQRwAKefa6b1EwZWH/9JSEBKAhHriUpGBrYgcAZ7MB8Z' +
  'HGSNBcB0o5G9Hl4DeObsl4RA/s1CRmDIm/bAEK8/GV+0lAjskRoVjQXJpRcDFK/ewM3GXJGmUDeaUhayYzbFhYzAW5P9o8XC' +
  'QLFyYd4ST8R+zcTUQI9AAZ+oABoLrwYopI4H1qsUjeEgZz8yMZJ/anDaJ2LG/GUEpNP3+ycZkYERzqJWUIwisAYk+k68QzPN' +
  '7QRgqU4apyZ0jca5u+wNQ1P5NdODMmApTylNlhuhSHXvRDEjQooYIqixcTMYFgPAnJrYi28GLBWsSEBKBJHlrEHOSlIjJ1Ek' +
  'TUCAqlqxRXFdbNApqiYT07fB4Jaml+vhx1QSkC6AIrEFzJSO1VBc/rplA/EVrXd8hcMsVWMmafwEAAP//YUNOvQAAAAZJREFU' +
  'wAKNHNfBXugFgAAAABJRU5ErkJggg==',
  'base64'
);

function renderCustomVanillaItem(name) {
  const nm = String(name || '').toLowerCase();
  if (nm === 'tnt') return TNT_3D_PNG;
  return null;
}

module.exports = { renderCustomModItem, renderCustomVanillaItem, renderBackpack, renderWaystone, encodePng };

