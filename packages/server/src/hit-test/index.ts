import type { DiagramEngine } from "@prixmaviz/shared";
import { ENGINE_FAMILY } from "@prixmaviz/shared";
import { nullHitTester } from "./null";

export interface HitResult {
  nodes: string[];
  data?: unknown;
}

export interface RegionHitResult {
  nodes: string[];
  dataRange?: unknown;
}

export interface HitTester {
  byPoint(svg: string, x: number, y: number): HitResult;
  byRegion(svg: string, bbox: { x: number; y: number; w: number; h: number }): RegionHitResult;
}

const TESTERS: Partial<Record<string, HitTester>> = {};

export function registerHitTester(family: string, tester: HitTester): void {
  TESTERS[family] = tester;
}

export function getHitTester(engine: DiagramEngine): HitTester {
  const fam = ENGINE_FAMILY[engine];
  return TESTERS[fam] ?? nullHitTester;
}
