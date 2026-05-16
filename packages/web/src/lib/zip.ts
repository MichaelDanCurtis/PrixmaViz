/**
 * Minimal STORE-method (no compression) ZIP writer.
 *
 * Issue #2 needs in-browser bundling for bulk diagram exports. We deliberately
 * avoid pulling in `jszip` / `fflate` / `client-zip` — the project currently
 * has zero zip deps (see `packages/web/package.json`), and our payloads are
 * either SVG text (small) or already-compressed PNG/JPEG/VSDX bytes. STORE
 * adds negligible overhead (~30 bytes per file) vs. deflate's compile-size
 * and worker-setup cost.
 *
 * Wire format (PKZIP appnote.txt §4):
 *   For each file:
 *     [Local File Header][filename][raw bytes]
 *   After all files:
 *     [Central Directory entry per file][End of Central Directory Record]
 *
 * No ZIP64 — single files capped at 4 GiB, total bundle capped at 4 GiB.
 * Bulk diagram exports won't approach that; we throw if a caller tries.
 *
 * No DEFLATE; compression method is `0` (stored). CRC32 is the standard
 * ISO 3309 polynomial with a precomputed table — fast enough for tens of
 * megabytes in a single tick.
 *
 * Filenames are UTF-8 encoded with the "language encoding" flag (bit 11 of
 * the general-purpose bit flag) set, so non-ASCII slugs unpack correctly in
 * any modern unzipper.
 */

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC32_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  /** Filename inside the archive (relative path, forward slashes). */
  name: string;
  bytes: Uint8Array;
}

/**
 * Assemble a STORE-method ZIP archive from the given files. Returns the raw
 * byte array; the caller wraps in a Blob and triggers the download.
 *
 * Throws if the total archive size or any individual file would exceed
 * 4 GiB — we'd need ZIP64 extensions and that's overkill for diagram bundles.
 */
export function buildStoreZip(entries: ZipEntry[]): Uint8Array {
  const FOUR_GIB = 0xffffffff;
  const encoder = new TextEncoder();

  // First pass: encode names, compute CRCs, accumulate sizes.
  type Prepared = {
    nameBytes: Uint8Array;
    bytes: Uint8Array;
    crc: number;
    localHeaderOffset: number;
  };
  const prepared: Prepared[] = [];
  let cursor = 0;
  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    if (entry.bytes.length > FOUR_GIB) {
      throw new Error(`zip entry "${entry.name}" exceeds 4 GiB (STORE-only writer)`);
    }
    const crc = crc32(entry.bytes);
    prepared.push({ nameBytes, bytes: entry.bytes, crc, localHeaderOffset: cursor });
    // Local file header is 30 bytes fixed + filename + (no extra field) + data.
    cursor += 30 + nameBytes.length + entry.bytes.length;
    if (cursor > FOUR_GIB) {
      throw new Error("zip archive exceeds 4 GiB (STORE-only writer)");
    }
  }
  const localSectionSize = cursor;

  // Second pass: size the central directory.
  let cdSize = 0;
  for (const p of prepared) {
    cdSize += 46 + p.nameBytes.length;
  }
  const eocdSize = 22;
  const total = localSectionSize + cdSize + eocdSize;
  if (total > FOUR_GIB) {
    throw new Error("zip archive exceeds 4 GiB (STORE-only writer)");
  }

  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  let pos = 0;

  // Standard MS-DOS time/date = 0 (1980-01-01 00:00:00). Most extractors
  // accept this and we don't promise per-file timestamps in the bundle.
  const dosTime = 0;
  const dosDate = 0;
  // Bit 11 of the general-purpose flag = filename is UTF-8.
  const gpFlag = 0x0800;

  for (const p of prepared) {
    // ─── Local File Header (signature 0x04034b50) ───
    view.setUint32(pos, 0x04034b50, true); pos += 4;
    view.setUint16(pos, 20, true); pos += 2;          // version needed (2.0)
    view.setUint16(pos, gpFlag, true); pos += 2;      // general purpose bit flag
    view.setUint16(pos, 0, true); pos += 2;           // compression method (0 = store)
    view.setUint16(pos, dosTime, true); pos += 2;
    view.setUint16(pos, dosDate, true); pos += 2;
    view.setUint32(pos, p.crc, true); pos += 4;
    view.setUint32(pos, p.bytes.length, true); pos += 4;  // compressed size
    view.setUint32(pos, p.bytes.length, true); pos += 4;  // uncompressed size
    view.setUint16(pos, p.nameBytes.length, true); pos += 2;
    view.setUint16(pos, 0, true); pos += 2;           // extra field length
    out.set(p.nameBytes, pos); pos += p.nameBytes.length;
    out.set(p.bytes, pos); pos += p.bytes.length;
  }

  // ─── Central Directory ───
  const cdOffset = pos;
  for (const p of prepared) {
    view.setUint32(pos, 0x02014b50, true); pos += 4;  // CD entry signature
    view.setUint16(pos, 20, true); pos += 2;          // version made by
    view.setUint16(pos, 20, true); pos += 2;          // version needed
    view.setUint16(pos, gpFlag, true); pos += 2;
    view.setUint16(pos, 0, true); pos += 2;           // compression method
    view.setUint16(pos, dosTime, true); pos += 2;
    view.setUint16(pos, dosDate, true); pos += 2;
    view.setUint32(pos, p.crc, true); pos += 4;
    view.setUint32(pos, p.bytes.length, true); pos += 4;
    view.setUint32(pos, p.bytes.length, true); pos += 4;
    view.setUint16(pos, p.nameBytes.length, true); pos += 2;
    view.setUint16(pos, 0, true); pos += 2;           // extra field length
    view.setUint16(pos, 0, true); pos += 2;           // file comment length
    view.setUint16(pos, 0, true); pos += 2;           // disk number start
    view.setUint16(pos, 0, true); pos += 2;           // internal file attributes
    view.setUint32(pos, 0, true); pos += 4;           // external file attributes
    view.setUint32(pos, p.localHeaderOffset, true); pos += 4;
    out.set(p.nameBytes, pos); pos += p.nameBytes.length;
  }

  // ─── End of Central Directory Record ───
  view.setUint32(pos, 0x06054b50, true); pos += 4;    // EOCD signature
  view.setUint16(pos, 0, true); pos += 2;             // disk number
  view.setUint16(pos, 0, true); pos += 2;             // start disk of CD
  view.setUint16(pos, prepared.length, true); pos += 2;  // entries on this disk
  view.setUint16(pos, prepared.length, true); pos += 2;  // total entries
  view.setUint32(pos, cdSize, true); pos += 4;        // CD size
  view.setUint32(pos, cdOffset, true); pos += 4;      // CD offset
  view.setUint16(pos, 0, true); pos += 2;             // comment length

  return out;
}
