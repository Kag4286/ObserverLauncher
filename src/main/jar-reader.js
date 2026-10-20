// jar-reader.js — minimal ZIP reader for Minecraft client and mod jars (v6.0.0, revised).
//
// WHY: the app must not bundle Mojang textures, but it MAY read the user's own jars at runtime. A
// full zip library would add a dependency; the format we need is the stored/deflate subset every
// Minecraft jar uses, so a small reader with zlib.inflateRawSync is enough.
//
// MEMORY (v6.0.0 fix): the first version read the WHOLE jar into a Buffer and kept it for the
// session, one Buffer per jar. A NeoForge pack with 30 jars easily tops 400 MB of resident memory
// the moment the player inspector opened once, and it was never released. This version reads only
// the End of Central Directory + central directory (a few KB), keeps that index in memory, and
// re-opens the file to read ONE entry on demand, then closes it. No resident jar body, no fd held.
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
// Kept for the buffer-based callers and tests; the file handle below does not use it.
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

// PURE: read one entry's bytes from a fully-loaded zip buffer. Throws when the entry is missing or
// unsupported. Kept for the buffer-based callers and tests; openJar() below uses the file path.
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

// Read an exact byte range from an open fd into a fresh Buffer.
function readAt(fd, position, length) {
  const buf = Buffer.alloc(length);
  if (length > 0) fs.readSync(fd, buf, 0, length, position);
  return buf;
}

// Parse the central directory buffer into a Map<entryName, {method, compSize, localOffset}>.
// The local header still has to be read at read() time because its name/extra lengths are not
// stored in the central directory.
function parseCentralDir(cd, count) {
  const entries = new Map();
  let p = 0;
  for (let i = 0; i < count; i++) {
    if (cd.readUInt32LE(p) !== CEN_SIG) throw new Error('Corrupt central directory.');
    const method = cd.readUInt16LE(p + 10);
    const compSize = cd.readUInt32LE(p + 20);
    const nameLen = cd.readUInt16LE(p + 28);
    const extraLen = cd.readUInt16LE(p + 30);
    const commentLen = cd.readUInt16LE(p + 32);
    const localOffset = cd.readUInt32LE(p + 42);
    const name = cd.toString('utf8', p + 46, p + 46 + nameLen);
    entries.set(name, { method, compSize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

// A lightweight handle that holds only the central directory. No fd, no jar body in memory; each
// read() opens the file, seeks to the one entry, and closes it again.
class JarHandle {
  constructor(filePath, entries) {
    this.filePath = filePath;
    this.entries = entries; // Map<name, {method, compSize, localOffset}>
  }
  list() { return [...this.entries.keys()]; }
  read(name) {
    const entry = this.entries.get(name);
    if (!entry) throw new Error(`Entry not found: ${name}`);
    const fd = fs.openSync(this.filePath, 'r');
    try {
      const locHeader = readAt(fd, entry.localOffset, 30);
      if (locHeader.readUInt32LE(0) !== LOC_SIG) throw new Error('Corrupt local header.');
      const locNameLen = locHeader.readUInt16LE(26);
      const locExtraLen = locHeader.readUInt16LE(28);
      const dataStart = entry.localOffset + 30 + locNameLen + locExtraLen;
      const data = readAt(fd, dataStart, entry.compSize);
      if (entry.method === 0) return data;
      if (entry.method === 8) return zlib.inflateRawSync(data);
      throw new Error(`Unsupported zip compression method ${entry.method}.`);
    } finally {
      try { fs.closeSync(fd); } catch {}
    }
  }
}

// Open a zip file from disk. Reads only the EOCD + central directory; the file body stays on disk.
function openJar(filePath) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const fileSize = fs.fstatSync(fd).size;
    const tailSize = Math.min(fileSize, 65557);
    const tail = readAt(fd, fileSize - tailSize, tailSize);
    const eocdInTail = findEocd(tail);
    if (eocdInTail < 0) throw new Error('Not a ZIP file (no end-of-central-directory record).');
    const count = tail.readUInt16LE(eocdInTail + 10);
    const cdSize = tail.readUInt32LE(eocdInTail + 12);
    const cdOffset = tail.readUInt32LE(eocdInTail + 16);
    const cd = readAt(fd, cdOffset, cdSize);
    return new JarHandle(filePath, parseCentralDir(cd, count));
  } finally {
    try { fs.closeSync(fd); } catch {}
  }
}

module.exports = { openJar, JarHandle, listEntries, readEntry };
