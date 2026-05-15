import { LruSvgCache } from "../kroki/cache";

export interface VsdxRendererOptions {
  baseUrl?: string;
  timeoutMs?: number;
  cache?: LruSvgCache;
  fetchImpl?: typeof fetch;
}

export class VsdxRenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VsdxRenderError";
  }
}

export class VsdxRenderer {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly cache: LruSvgCache;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: VsdxRendererOptions = {}) {
    this.baseUrl = opts.baseUrl
      ?? process.env.VSDX_RENDERER_URL
      ?? "http://prixmaviz-vsdx:2003";
    this.timeoutMs = opts.timeoutMs
      ?? Number(process.env.VSDX_RENDERER_TIMEOUT_MS ?? "10000");
    this.cache = opts.cache ?? new LruSvgCache(32 * 1024 * 1024);
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async render(bytes: Uint8Array): Promise<string> {
    const key = await this.hash(bytes);
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/convert/svg`, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: bytes,
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => res.statusText);
        throw new VsdxRenderError(`vsdx renderer ${res.status}: ${text.slice(0, 300)}`);
      }
      const svg = await res.text();
      this.cache.set(key, svg);
      return svg;
    } finally {
      clearTimeout(timer);
    }
  }

  private async hash(bytes: Uint8Array): Promise<string> {
    const hasher = new Bun.CryptoHasher("sha256");
    hasher.update(bytes);
    return hasher.digest("hex");
  }
}

// Convenience export so render.ts can use a process-singleton.
let _defaultRenderer: VsdxRenderer | undefined;
export function renderVsdxBytes(bytes: Uint8Array): Promise<string> {
  if (!_defaultRenderer) _defaultRenderer = new VsdxRenderer();
  return _defaultRenderer.render(bytes);
}

export function setVsdxRendererForTests(r: VsdxRenderer | undefined): void {
  _defaultRenderer = r;
}
