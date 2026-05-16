export class LruSvgCache {
  private map = new Map<string, string>();
  private currentSize = 0;

  constructor(private readonly maxBytes: number) {}

  get(key: string): string | undefined {
    const v = this.map.get(key);
    if (v === undefined) return undefined;
    this.map.delete(key);
    this.map.set(key, v);
    return v;
  }

  set(key: string, value: string): void {
    if (this.map.has(key)) {
      this.currentSize -= this.map.get(key)!.length;
      this.map.delete(key);
    }
    this.map.set(key, value);
    this.currentSize += value.length;
    while (this.currentSize > this.maxBytes && this.map.size > 0) {
      const oldest = this.map.keys().next().value as string;
      this.currentSize -= this.map.get(oldest)!.length;
      this.map.delete(oldest);
    }
  }

  size(): number {
    return this.currentSize;
  }
}

/**
 * Byte-oriented LRU cache for binary Kroki responses (PNG/JPEG). Mirrors
 * `LruSvgCache` semantics but tracks `Uint8Array.byteLength` for budget
 * accounting and stores immutable copies of each value.
 */
export class LruBinaryCache {
  private map = new Map<string, Uint8Array>();
  private currentSize = 0;

  constructor(private readonly maxBytes: number) {}

  get(key: string): Uint8Array | undefined {
    const v = this.map.get(key);
    if (v === undefined) return undefined;
    this.map.delete(key);
    this.map.set(key, v);
    return v;
  }

  set(key: string, value: Uint8Array): void {
    if (this.map.has(key)) {
      this.currentSize -= this.map.get(key)!.byteLength;
      this.map.delete(key);
    }
    this.map.set(key, value);
    this.currentSize += value.byteLength;
    while (this.currentSize > this.maxBytes && this.map.size > 0) {
      const oldest = this.map.keys().next().value as string;
      this.currentSize -= this.map.get(oldest)!.byteLength;
      this.map.delete(oldest);
    }
  }

  size(): number {
    return this.currentSize;
  }
}

/**
 * SHA-256 cache key for an (engine, dsl) pair. SVG-only — preserved for
 * backward compat with `LruSvgCache` call sites.
 */
export function svgCacheKey(engine: string, dsl: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(engine);
  hasher.update("\0");
  hasher.update(dsl);
  return hasher.digest("hex");
}

/**
 * Format-aware cache key for binary Kroki responses. Including `format` in
 * the digest prevents PNG and SVG renders of the same DSL from colliding
 * when both are cached.
 */
export function binaryCacheKey(engine: string, format: string, dsl: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(engine);
  hasher.update("\0");
  hasher.update(format);
  hasher.update("\0");
  hasher.update(dsl);
  return hasher.digest("hex");
}
