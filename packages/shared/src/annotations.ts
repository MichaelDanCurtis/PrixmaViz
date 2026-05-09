export type AnnotationKind = "tag" | "region" | "pin";

export interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Annotation {
  id: string;                       // ann_<ulid26>
  kind: AnnotationKind;
  text?: string;
  color?: string;
  createdAt: string;                // ISO 8601
  resolvedAt?: string;
  // tag-specific:
  targetNodes?: string[];
  // region-specific:
  bboxPixel?: BBox;
  bboxData?: unknown;
  // pin-specific:
  point?: Point;
  nearestNode?: string;
}

export function newAnnotationId(): string {
  // 26-char Crockford-base32 ULID-ish (timestamp + 80 random bits)
  const t = Date.now();
  const rand = crypto.getRandomValues(new Uint8Array(10));
  let s = "ann_";
  // encode 48-bit timestamp as 10 base32 chars
  const ALPH = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  for (let i = 9; i >= 0; i--) s += ALPH[(t >>> (i * 5)) & 31]!;
  for (const b of rand) s += ALPH[b & 31]! + ALPH[(b >>> 3) & 31]!;
  return s.slice(0, 30);
}
