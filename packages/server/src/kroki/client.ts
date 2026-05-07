import type { DiagramEngine } from "@prixmaviz/shared";
import { KROKI_PATH } from "@prixmaviz/shared";
import { LruSvgCache, svgCacheKey } from "./cache";

const DEFAULT_BASE = "https://kroki.io";

export interface KrokiClientOptions {
  baseUrl?: string;
  cache?: LruSvgCache;
}

export class KrokiClient {
  private readonly baseUrl: string;
  private readonly cache: LruSvgCache;

  constructor(opts: KrokiClientOptions = {}) {
    this.baseUrl = opts.baseUrl ?? process.env.KROKI_URL ?? DEFAULT_BASE;
    this.cache = opts.cache ?? new LruSvgCache(64 * 1024 * 1024);
  }

  async renderSvg(engine: DiagramEngine, dsl: string): Promise<string> {
    const key = svgCacheKey(engine, dsl);
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;

    const path = KROKI_PATH[engine];
    const url = `${this.baseUrl}/${path}/svg`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: dsl,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new KrokiError(`kroki ${res.status}: ${text.slice(0, 500)}`);
    }
    const svg = await res.text();
    this.cache.set(key, svg);
    return svg;
  }
}

export class KrokiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KrokiError";
  }
}
