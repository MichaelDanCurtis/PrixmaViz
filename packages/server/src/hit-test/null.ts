import type { HitTester } from "./index";

export const nullHitTester: HitTester = {
  byPoint: () => ({ nodes: [] }),
  byRegion: () => ({ nodes: [] }),
};
