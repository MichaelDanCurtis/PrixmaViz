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

export function svgCacheKey(engine: string, dsl: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(engine);
  hasher.update("\0");
  hasher.update(dsl);
  return hasher.digest("hex");
}
