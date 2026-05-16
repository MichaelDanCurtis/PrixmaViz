// Issue #8 Wave 1B — bundle reader rejects future major versions and
// other manifest shape issues with a structured `BundleParseError`.

import { describe, expect, it } from "bun:test";
import JSZip from "jszip";
import { BundleParseError, parseBundle } from "../../src/bundle/pviz-reader";

async function makeBundle(manifest: unknown, extras: Record<string, string> = {}): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("manifest.json", JSON.stringify(manifest));
  zip.file("tiles.json", JSON.stringify({ tiles: [], camera: { x: 0, y: 0, zoom: 1 } }));
  for (const [name, body] of Object.entries(extras)) zip.file(name, body);
  return await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

describe("pviz-reader version + shape checks", () => {
  it("rejects a manifest with major version > supported (2.0)", async () => {
    const buf = await makeBundle({
      version: "2.0",
      workspaceId: "w_future",
      workspaceName: "Future",
      createdAt: new Date().toISOString(),
      settings: {},
      diagramCount: 0,
    });
    let err: unknown;
    try {
      await parseBundle(buf);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(BundleParseError);
    expect((err as BundleParseError).code).toBe("unsupported_version");
    expect((err as BundleParseError).message).toContain("2.0");
  });

  it("rejects a manifest with major version < supported (0.x)", async () => {
    const buf = await makeBundle({
      version: "0.9",
      workspaceId: "w_old",
      workspaceName: "Old",
      createdAt: new Date().toISOString(),
      settings: {},
      diagramCount: 0,
    });
    let err: unknown;
    try { await parseBundle(buf); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(BundleParseError);
    expect((err as BundleParseError).code).toBe("unsupported_version");
  });

  it("accepts minor-version bumps within the supported major (1.5)", async () => {
    const buf = await makeBundle({
      version: "1.5",
      workspaceId: "w_minor",
      workspaceName: "Minor",
      createdAt: new Date().toISOString(),
      settings: {},
      diagramCount: 0,
    });
    const parsed = await parseBundle(buf);
    expect(parsed.manifest.version).toBe("1.5");
  });

  it("rejects a bundle with missing manifest.json", async () => {
    const zip = new JSZip();
    zip.file("tiles.json", JSON.stringify({ tiles: [], camera: { x: 0, y: 0, zoom: 1 } }));
    const buf = await zip.generateAsync({ type: "uint8array" });
    let err: unknown;
    try { await parseBundle(buf); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(BundleParseError);
    expect((err as BundleParseError).code).toBe("missing_manifest");
  });

  it("rejects a manifest with malformed JSON", async () => {
    const zip = new JSZip();
    zip.file("manifest.json", "{ not valid json");
    const buf = await zip.generateAsync({ type: "uint8array" });
    let err: unknown;
    try { await parseBundle(buf); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(BundleParseError);
    expect((err as BundleParseError).code).toBe("malformed_manifest");
  });

  it("rejects a manifest missing required fields", async () => {
    const buf = await makeBundle({ version: "1.0" });
    let err: unknown;
    try { await parseBundle(buf); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(BundleParseError);
    expect((err as BundleParseError).code).toBe("malformed_manifest");
  });

  it("rejects raw garbage as not-a-zip", async () => {
    const buf = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05]);
    let err: unknown;
    try { await parseBundle(buf); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(BundleParseError);
    expect((err as BundleParseError).code).toBe("invalid_zip");
  });

  it("rejects a malformed diagram file", async () => {
    const buf = await makeBundle(
      {
        version: "1.0",
        workspaceId: "w",
        workspaceName: null,
        createdAt: new Date().toISOString(),
        settings: {},
        diagramCount: 1,
      },
      { "diagrams/bogus.json": JSON.stringify({ id: 123 }) },
    );
    let err: unknown;
    try { await parseBundle(buf); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(BundleParseError);
    expect((err as BundleParseError).code).toBe("malformed_diagram");
  });
});
