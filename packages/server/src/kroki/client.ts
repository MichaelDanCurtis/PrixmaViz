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
}

export class KrokiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KrokiError";
  }
}
