import { describe, expect, it } from "vitest";
import { buildStoreZip, crc32 } from "../../src/lib/zip";

// Issue #2 — STORE-method zip writer. We don't ship `jszip`, so verify the
// wire format ourselves: PK signatures, header counts, and the CRC32 against
// known values. A real unzip round-trip is covered by manual smoke testing
// (described in the PR body) — happy-dom doesn't ship a zip decoder.

function readU32LE(b: Uint8Array, offset: number): number {
  return (b[offset]! | (b[offset + 1]! << 8) | (b[offset + 2]! << 16) | (b[offset + 3]! << 24)) >>> 0;
}
function readU16LE(b: Uint8Array, offset: number): number {
  return (b[offset]! | (b[offset + 1]! << 8)) & 0xffff;
}

describe("crc32 (issue #2)", () => {
  it("matches the canonical reference for an empty input", () => {
    expect(crc32(new Uint8Array(0))).toBe(0);
  });

  it("matches the canonical reference for 'abc'", () => {
    // CRC32("abc") = 0x352441C2 per ISO 3309 / IEEE 802.3 polynomial.
    const bytes = new TextEncoder().encode("abc");
    expect(crc32(bytes)).toBe(0x352441c2);
  });

  it("matches the canonical reference for 'The quick brown fox jumps over the lazy dog'", () => {
    const bytes = new TextEncoder().encode("The quick brown fox jumps over the lazy dog");
    expect(crc32(bytes)).toBe(0x414fa339);
  });
});

describe("buildStoreZip (issue #2)", () => {
  it("produces a parseable archive with the right signatures and counts", () => {
    const helloBytes = new TextEncoder().encode("hello");
    const worldBytes = new TextEncoder().encode("world\n");
    const zip = buildStoreZip([
      { name: "a.txt", bytes: helloBytes },
      { name: "b.txt", bytes: worldBytes },
    ]);

    // ─── First local file header ───
    expect(readU32LE(zip, 0)).toBe(0x04034b50);
    // version needed = 20
    expect(readU16LE(zip, 4)).toBe(20);
    // general-purpose flag bit 11 set (UTF-8 filenames)
    expect(readU16LE(zip, 6) & 0x0800).toBe(0x0800);
    // compression method = 0 (store)
    expect(readU16LE(zip, 8)).toBe(0);
    // CRC-32 matches an independent crc32(...) computation
    expect(readU32LE(zip, 14)).toBe(crc32(helloBytes));
    // compressed size = uncompressed size = helloBytes.length
    expect(readU32LE(zip, 18)).toBe(helloBytes.length);
    expect(readU32LE(zip, 22)).toBe(helloBytes.length);
    expect(readU16LE(zip, 26)).toBe(5);   // filename length "a.txt"
    expect(readU16LE(zip, 28)).toBe(0);   // extra field length

    // Filename bytes
    expect(new TextDecoder().decode(zip.slice(30, 35))).toBe("a.txt");
    // File data
    expect(new TextDecoder().decode(zip.slice(35, 40))).toBe("hello");

    // ─── EOCD record signature ─── (at end - 22)
    const eocdOff = zip.length - 22;
    expect(readU32LE(zip, eocdOff)).toBe(0x06054b50);
    expect(readU16LE(zip, eocdOff + 8)).toBe(2);   // entries on this disk
    expect(readU16LE(zip, eocdOff + 10)).toBe(2);  // total entries
    // CD size + CD offset should sum to the eocd position.
    const cdSize = readU32LE(zip, eocdOff + 12);
    const cdOff = readU32LE(zip, eocdOff + 16);
    expect(cdOff + cdSize).toBe(eocdOff);
    // CD entry signature at the CD offset
    expect(readU32LE(zip, cdOff)).toBe(0x02014b50);
  });

  it("handles an empty archive (no entries)", () => {
    const zip = buildStoreZip([]);
    // EOCD only — 22 bytes total
    expect(zip.length).toBe(22);
    expect(readU32LE(zip, 0)).toBe(0x06054b50);
    expect(readU16LE(zip, 10)).toBe(0); // total entries
  });

  it("handles UTF-8 filenames", () => {
    const bytes = new TextEncoder().encode("hi");
    // Greek alpha + Russian д to exercise the UTF-8 flag path
    const name = "αρχείο-д.txt";
    const zip = buildStoreZip([{ name, bytes }]);
    const nameLen = readU16LE(zip, 26);
    const decoded = new TextDecoder().decode(zip.slice(30, 30 + nameLen));
    expect(decoded).toBe(name);
    expect(nameLen).toBe(new TextEncoder().encode(name).length);
  });

  it("local header offset in central directory points back at the file", () => {
    const a = new TextEncoder().encode("AAAA");
    const b = new TextEncoder().encode("BBBBBB");
    const zip = buildStoreZip([
      { name: "first", bytes: a },
      { name: "second", bytes: b },
    ]);
    // Find the EOCD, then the CD offset.
    const eocdOff = zip.length - 22;
    const cdOff = readU32LE(zip, eocdOff + 16);

    // First CD entry: relative offset of local header is at +42.
    const firstLocalOff = readU32LE(zip, cdOff + 42);
    expect(firstLocalOff).toBe(0);
    // Verify there's a local file header signature at that offset.
    expect(readU32LE(zip, firstLocalOff)).toBe(0x04034b50);

    // Second CD entry follows: 46 fixed bytes + filename length of first entry.
    const firstNameLen = readU16LE(zip, cdOff + 28);
    const secondCdOff = cdOff + 46 + firstNameLen;
    const secondLocalOff = readU32LE(zip, secondCdOff + 42);
    expect(readU32LE(zip, secondLocalOff)).toBe(0x04034b50);
  });
});
