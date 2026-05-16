import type { DiagramEngine } from "@prixmaviz/shared";
import { KROKI_PATH } from "@prixmaviz/shared";
import { LruBinaryCache, LruSvgCache, binaryCacheKey } from "./cache";

const DEFAULT_BASE = "https://kroki.io";

export type KrokiFormat = "svg" | "png" | "jpeg";

export interface KrokiClientOptions {
  baseUrl?: string;
  /** Legacy text cache. Reserved for downstream callers that swap in their own SVG cache. */
  cache?: LruSvgCache;
  /** Byte cache used by `renderBinary` for SVG/PNG/JPEG responses. */
  binaryCache?: LruBinaryCache;
}

export class KrokiClient {
  private readonly baseUrl: string;
  private readonly binaryCache: LruBinaryCache;

  constructor(opts: KrokiClientOptions = {}) {
    this.baseUrl = opts.baseUrl ?? process.env.KROKI_URL ?? DEFAULT_BASE;
    // 64 MiB byte budget mirrors the previous text-cache budget. Binary
    // payloads are larger than SVG on average; tune via env if needed.
    this.binaryCache = opts.binaryCache ?? new LruBinaryCache(64 * 1024 * 1024);
    // `opts.cache` accepted for backward compatibility with callers that
    // construct a client with `{ cache: new LruSvgCache(...) }`. The SVG cache
    // is no longer used directly — `renderSvg` now decodes from the byte
    // cache, which is format-aware and dedupes across SVG/PNG/JPEG.
    void opts.cache;
  }

  /**
   * Render a diagram and return raw bytes for the requested format. Format
   * is part of the cache key, so SVG/PNG/JPEG renders of the same DSL do
   * not collide.
   */
  async renderBinary(engine: DiagramEngine, dsl: string, format: KrokiFormat): Promise<Uint8Array> {
    const key = binaryCacheKey(engine, format, dsl);
    const cached = this.binaryCache.get(key);
    if (cached !== undefined) return cached;

    const path = KROKI_PATH[engine];
    const url = `${this.baseUrl}/${path}/${format}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: dsl,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new KrokiError(`kroki ${res.status}: ${text.slice(0, 500)}`);
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    this.binaryCache.set(key, bytes);
    return bytes;
  }

  /** Backward-compatible SVG entry point — thin wrapper over `renderBinary`. */
  async renderSvg(engine: DiagramEngine, dsl: string): Promise<string> {
    const bytes = await this.renderBinary(engine, dsl, "svg");
    return new TextDecoder().decode(bytes);
  }

  /**
   * Validate a DSL by asking Kroki to render it, then discarding the SVG.
   *
   * Distinct from `renderBinary` in two deliberate ways:
   *   1. Cache is BYPASSED on both read and write — `validate_dsl` is a
   *      hot-path check that agents call repeatedly with throwaway inputs;
   *      polluting the byte cache with junk DSL would crowd out real
   *      renders. The caller's MCP tool also returns no SVG to the wire.
   *   2. Errors are returned (not thrown) so the caller can map the raw
   *      Kroki body through `parseEngineError` without unwrapping a
   *      `KrokiError`.
   *
   * On success: `{ ok: true, status }`. On Kroki 4xx/5xx: `{ ok: false,
   * status, body }` where `body` is the raw response text — typically the
   * upstream engine's stderr, which `parseEngineError` knows how to
   * destructure into `{ line?, column?, message }[]`.
   */
  async validate(
    engine: DiagramEngine,
    dsl: string,
  ): Promise<{ ok: true; status: number } | { ok: false; status: number; body: string }> {
    const path = KROKI_PATH[engine];
    const url = `${this.baseUrl}/${path}/svg`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: dsl,
    });
    if (res.ok) {
      // Consume the body so the connection can be freed; we don't keep it.
      // Using `arrayBuffer` rather than `text` avoids a UTF-8 decode for a
      // value we're throwing away.
      await res.arrayBuffer();
      return { ok: true, status: res.status };
    }
    const body = await res.text().catch(() => res.statusText);
    return { ok: false, status: res.status, body };
  }
}

export class KrokiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KrokiError";
  }
}
