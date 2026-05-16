// Tiny LCS-based line diff. Returns the per-line ops needed to transform
// `a` into `b`. Used by Issue #6's version-history diff view.
//
// Output kinds:
//   "same"  — line unchanged
//   "added" — present in `b` but not at the corresponding position in `a`
//   "removed" — present in `a` but not in `b`
//
// Time/space: O(|a| * |b|). For DSL files this is fine (hundreds of lines
// at most; the worst real case I've seen is a few thousand). Pulling in
// the npm `diff` package would be more compact for huge inputs but adds a
// dep + bundle weight we don't need.

export type DiffLine =
  | { kind: "same"; a: number; b: number; text: string }
  | { kind: "added"; b: number; text: string }
  | { kind: "removed"; a: number; text: string };

export function diffLines(a: string, b: string): DiffLine[] {
  // Normalize: empty strings yield no lines (split("") returns [""])
  // — explicitly treat that as no lines.
  const aLines = a === "" ? [] : a.split("\n");
  const bLines = b === "" ? [] : b.split("\n");
  const m = aLines.length;
  const n = bLines.length;

  // Standard LCS DP table. lcs[i][j] = LCS length of aLines[i..] and bLines[j..].
  const lcs: number[][] = Array.from({ length: m + 1 }, () =>
    new Array(n + 1).fill(0) as number[],
  );
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      lcs[i]![j] = aLines[i] === bLines[j]
        ? lcs[i + 1]![j + 1]! + 1
        : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }

  const out: DiffLine[] = [];
  let i = 0, j = 0;
  while (i < m && j < n) {
    if (aLines[i] === bLines[j]) {
      out.push({ kind: "same", a: i + 1, b: j + 1, text: aLines[i]! });
      i++; j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      out.push({ kind: "removed", a: i + 1, text: aLines[i]! });
      i++;
    } else {
      out.push({ kind: "added", b: j + 1, text: bLines[j]! });
      j++;
    }
  }
  while (i < m) {
    out.push({ kind: "removed", a: i + 1, text: aLines[i]! });
    i++;
  }
  while (j < n) {
    out.push({ kind: "added", b: j + 1, text: bLines[j]! });
    j++;
  }
  return out;
}

export interface DiffStats {
  added: number;
  removed: number;
  same: number;
}

export function diffStats(diff: DiffLine[]): DiffStats {
  let added = 0, removed = 0, same = 0;
  for (const d of diff) {
    if (d.kind === "added") added++;
    else if (d.kind === "removed") removed++;
    else same++;
  }
  return { added, removed, same };
}
