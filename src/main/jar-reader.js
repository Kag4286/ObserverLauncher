// jar-reader.js — minimal ZIP reader for Minecraft client jars (v6.0.0 Track B follow-up).
//
// WHY: the app must not bundle Mojang textures, but it MAY read the user's own client jar at
// runtime. A full zip library would add a dependency; the ZIP format we need is the stored/deflate
// subset that every Minecraft jar uses, so a ~70-line reader with zlib.inflateRawSync is enough.
//
// Reference: PKWARE APPNOTE 6.3.x, sections 4.3.6 (local header), 4.3.7 (central directory),
// 4.3.16 (end of central directory).

const fs = require('fs');
const zlib = require('zlib');

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;

// PURE: find the End of Central Directory record. The record is at the end of the file but can be
// followed by a variable-length comment, so scan backwards up to 64 KiB (the maximum comment size).
function findEocd(buf) {
  const minPos = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= minPos; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  return -1;
}

// PURE: list every entry name in a zip buffer. Returns an array of strings (no directory filter).
function listEntries(buf) {
  const eocd = findEocd(buf);
  if (eocd < 0) throw new Error('Not a ZIP file (no end-of-central-directory record).');
  const count = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  const names = [];
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== CEN_SIG) throw new Error('Corrupt central directory.');
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    names.push(buf.toString('utf8', p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}

// PURE: read one entry's bytes. Returns a Buffer. Throws when the entry is missing or unsupported.
function readEntry(buf, wantName) {
  const eocd = findEocd(buf);
  if (eocd < 0) throw new Error('Not a ZIP file.');
  const count = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== CEN_SIG) throw new Error('Corrupt central directory.');
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    if (name === wantName) {
      if (buf.readUInt32LE(localOffset) !== LOC_SIG) throw new Error('Corrupt local header.');
      const locNameLen = buf.readUInt16LE(localOffset + 26);
      const locExtraLen = buf.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + locNameLen + locExtraLen;
      const data = buf.subarray(dataStart, dataStart + compSize);
      if (method === 0) return Buffer.from(data);
      if (method === 8) return zlib.inflateRawSync(data);
      throw new Error(`Unsupported zip compression method ${method}.`);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`Entry not found: ${wantName}`);
}

// Convenience: open a zip file from disk and return a handle with list/read helpers.
function openJar(filePath) {
  const buf = fs.readFileSync(filePath);
  return {
    list: () => listEntries(buf),
    read: (name) => readEntry(buf, name),
  };
}

module.exports = { openJar, listEntries, readEntry };
