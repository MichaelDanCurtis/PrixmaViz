/**
 * Tiny dependency-free fuzzy filter for the command palette. The goal is
 * "find the user's intent in O(n) without shipping a library" — not
 * production-grade IR ranking.
 *
 * Strategy:
 *   1. Whitespace-tokenize the query.
 *   2. An item matches when *every* query token appears (case-insensitive)
 *      as a substring of the haystack.
 *   3. The score (lower = better) combines:
 *        - the earliest position any token appears (prefix bias),
 *        - the length of the haystack (shorter ties bubble to the top),
 *        - whether all tokens appear in order (small bonus).
 *
 * Empty query returns the full list unchanged.
 */

export interface FuzzyItem {
  /** The label the user sees. */
  name: string;
  /** Optional secondary text (description, tags, keywords) blended into the haystack. */
  keywords?: string;
}

export interface FuzzyResult<T> {
  item: T;
  score: number;
  /** 0-based indices of haystack chars that matched a query char, for highlighting. */
  matches: number[];
}

export function fuzzyFilter<T extends FuzzyItem>(items: T[], query: string): FuzzyResult<T>[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    return items.map((item) => ({ item, score: 0, matches: [] }));
  }
  const tokens = q.split(/\s+/).filter((t) => t.length > 0);
  if (tokens.length === 0) {
    return items.map((item) => ({ item, score: 0, matches: [] }));
  }

  const out: FuzzyResult<T>[] = [];
  for (const item of items) {
    const haystack = (item.name + " " + (item.keywords ?? "")).toLowerCase();
    let allFound = true;
    let earliest = Infinity;
    let lastIdx = -1;
    let inOrder = true;
    const matches: number[] = [];
    for (const tok of tokens) {
      const idx = haystack.indexOf(tok);
      if (idx === -1) { allFound = false; break; }
      if (idx < earliest) earliest = idx;
      if (idx < lastIdx) inOrder = false;
      lastIdx = idx;
      for (let i = 0; i < tok.length; i++) matches.push(idx + i);
    }
    if (!allFound) continue;
    // Score: earliest match position is the dominant factor; tie-break on
    // haystack length; tiny bonus for in-order tokens.
    const score = earliest * 1000 + haystack.length - (inOrder ? 1 : 0);
    out.push({ item, score, matches });
  }
  out.sort((a, b) => a.score - b.score);
  return out;
}
