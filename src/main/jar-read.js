// 2.3.0: read a single text entry out of a .jar (which is just a ZIP) WITHOUT extracting the
// whole archive. Modpack dependency checking needs META-INF/neoforge.mods.toml (NeoForge/Forge)
// and fabric.mod.json (Fabric/Quilt) to find REQUIRED dependencies that are NOT published on
// Modrinth (e.g. Kotlin for Forge), which the registry resolver can never see.
//
// Pure Node (zlib only) so it is unit-testable with a hand-built stored-method ZIP and has no
// third-party dependency. Reads the End-Of-Central-Directory, then the central directory entries
// (authoritative sizes/offsets), and inflates the one entry we want.
const fs = require('fs');
const zlib = require('zlib');

// Find the End Of Central Directory record (sig 0x06054b50) scanning back from the end. The
// comment field is variable (max 65535), so scan at most that far.
function findEocd(buf) {
  const min = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x05 && buf[i + 3] === 0x06) return i;
  }
  return -1;
}

// List { name, method, compSize, uncompSize, localOffset } for every entry in the ZIP buffer.
function listEntries(buf) {
  const eocd = findEocd(buf);
  if (eocd < 0) return null;
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16); // central directory offset
  const entries = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break; // central dir header sig
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const uncompSize = buf.readUInt32LE(off + 24);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOffset = buf.readUInt32LE(off + 42);
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen);
    entries.push({ name, method, compSize, uncompSize, localOffset });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

// Read and decompress ONE entry by exact name. Returns a utf8 string, or null when absent/
// unsupported. Safety: refuses an entry whose declared uncompressed size is absurd (>8 MB) so a
// crafted jar cannot make us allocate gigabytes.
const MAX_ENTRY_BYTES = 8 * 1024 * 1024;
function readEntry(buf, entry) {
  if (!entry) return null;
  if (entry.uncompSize > MAX_ENTRY_BYTES) return null;
  const lo = entry.localOffset;
  if (buf.readUInt32LE(lo) !== 0x04034b50) return null; // local file header sig
  const nameLen = buf.readUInt16LE(lo + 26);
  const extraLen = buf.readUInt16LE(lo + 28);
  const dataStart = lo + 30 + nameLen + extraLen;
  const data = buf.subarray(dataStart, dataStart + entry.compSize);
  try {
    if (entry.method === 0) return data.toString('utf8');        // stored
    if (entry.method === 8) return zlib.inflateRawSync(data).toString('utf8'); // deflate
  } catch { return null; }
  return null;
}

// Public: read a named text entry from a jar on disk. Returns { ok, content } or { ok:false, error }.
function readJarEntry(jarPath, entryName) {
  let buf;
  try { buf = fs.readFileSync(jarPath); } catch (e) { return { ok: false, error: e?.code || 'read-failed' }; }
  const entries = listEntries(buf);
  if (!entries) return { ok: false, error: 'not-a-zip' };
  const want = String(entryName).toLowerCase();
  const entry = entries.find(e => e.name.toLowerCase() === want);
  if (!entry) return { ok: false, error: 'entry-not-found' };
  const content = readEntry(buf, entry);
  return content == null ? { ok: false, error: 'entry-unreadable' } : { ok: true, content };
}

// Open a jar ONCE and return a read(name) function that reuses the in-memory buffer for every
// entry lookup. classifyJar() probes up to 4 entry names per jar; without this, each probe would
// re-read the whole file (a 20 MB jar x 4 x 50 mods = gigabytes of reads). Returns { read, error }.
function openJar(jarPath) {
  let buf;
  try { buf = fs.readFileSync(jarPath); } catch (e) { return { read: () => ({ ok: false, error: e?.code || 'read-failed' }), error: e?.code || 'read-failed' }; }
  const entries = listEntries(buf);
  const byName = new Map();
  for (const e of (entries || [])) byName.set(e.name.toLowerCase(), e);
  return {
    error: entries ? null : 'not-a-zip',
    read(name) {
      const entry = byName.get(String(name).toLowerCase());
      if (!entry) return { ok: false, error: 'entry-not-found' };
      const content = readEntry(buf, entry);
      return content == null ? { ok: false, error: 'entry-unreadable' } : { ok: true, content };
    },
  };
}

module.exports = { readJarEntry, openJar, listEntries, findEocd, MAX_ENTRY_BYTES };
