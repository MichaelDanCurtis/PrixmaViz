import type { DiagramEngine } from "@prixmaviz/shared";
import { KrokiClient, type KrokiFormat } from "../../src/kroki/client";

/** Minimal valid SVG returned by the fake so render paths get a real document. */
const CANNED_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16"/></svg>';

/**
 * Network-free KrokiClient for tests. Overrides the only two methods that hit
 * the network (`renderBinary` / `validate`) with deterministic canned
 * responses; `renderSvg` inherits and decodes the canned bytes.
 *
 * Use this in any test that exercises a render path so the suite never depends
 * on a live Kroki — in particular the public `https://kroki.io`, which is
 * flaky and which the production guard in KrokiClient refuses during tests.
 * Inject via the route deps, e.g. `{ sql, kroki: fakeKroki(), hub }`.
 */
class FakeKrokiClient extends KrokiClient {
  override async renderBinary(
    _engine: DiagramEngine,
    _dsl: string,
    _format: KrokiFormat,
  ): Promise<Uint8Array> {
    return new TextEncoder().encode(CANNED_SVG);
  }

  override async validate(
    _engine: DiagramEngine,
    _dsl: string,
  ): Promise<{ ok: true; status: number } | { ok: false; status: number; body: string }> {
    return { ok: true, status: 200 };
  }
}

export function fakeKroki(): KrokiClient {
  return new FakeKrokiClient();
}
