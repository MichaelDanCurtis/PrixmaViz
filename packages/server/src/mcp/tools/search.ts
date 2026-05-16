/**
 * Group B — Discoverability (Issue #5, Wave 2).
 *
 * `search_diagrams` closes the discoverability gap left by `list_diagrams`
 * (which only does substring-on-name and tag-equality filtering):
 *
 *   - `search_diagrams` : full-text search across diagram name, DSL, and
 *                         annotation bodies, with tag / engine / updatedSince
 *                         filters and PostgreSQL `ts_rank` relevance scoring.
 *
 * The FTS path leans on the `0004_diagrams_fts.sql` migration:
 *   - `diagrams.search_tsv` is a STORED generated tsvector over
 *     `name` (weight A) + `dsl` (weight B). A GIN index covers it.
 *   - `idx_diagrams_meta_tags` covers `meta->'tags' @> ...::jsonb` so the
 *     ALL-tags filter stays index-backed.
 *   - Annotation bodies live in a separate table (mutable independently of
 *     diagrams) so they're joined at search time via an EXISTS subquery.
 *
 * Spec: docs/superpowers/specs/2026-05-15-missing-mcp-tools-design.md §B
 */

import { ALL_ENGINES } from "@prixmaviz/shared";
import type postgres from "postgres";
import type { ToolCtx, ToolDef } from "../tools";

type Sql = ReturnType<typeof postgres>;

// ───────────────────────────────────────────────────────────────────────────
// B1. search_diagrams
// ───────────────────────────────────────────────────────────────────────────

/**
 * Result shape returned per matched diagram. Mirrors the spec output:
 * scalar identity fields + optional `snippet` (only when a query was
 * supplied) + optional `score` (only for `sort: "relevance"`).
 */
interface SearchHit {
  slug: string;
  name: string;
  engine: string;
  tags: string[];
  updatedAt: string;
  createdAt: string;
  snippet?: string;
  score?: number;
}

type SearchSort = "updated" | "created" | "name" | "relevance";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/**
 * Build & run the search query.
 *
 * We assemble the query via porsager/postgres' tagged-template composition
 * because it gives us safe parameterization with conditional fragments.
 * That's preferred over a string-concat builder which would lose the
 * parameter-binding safety net.
 *
 * Notable choices:
 *   - `websearch_to_tsquery` instead of `to_tsquery` so callers can pass
 *     free-form text like `"auth flow"` instead of needing to format the
 *     query as `auth & flow`. The websearch parser handles quoting,
 *     negation, and OR.
 *   - Annotation matches use an EXISTS subquery rather than a join so we
 *     don't multiply rows on diagrams with many annotations.
 *   - The relevance score is computed only against the diagram's own
 *     search_tsv (name + dsl). A diagram matched only through an annotation
 *     EXISTS still gets returned, but with score=0 (coalesced); recency
 *     breaks ties.
 */
async function searchDiagramsImpl(
  args: Record<string, unknown>,
  ctx: ToolCtx,
): Promise<{ results: SearchHit[] }> {
  const query = (args.query as string | undefined)?.trim() || undefined;
  const engines = args.engines as string[] | undefined;
  const tags = args.tags as string[] | undefined;
  const updatedSince = args.updatedSince as string | undefined;
  const sort = ((args.sort as SearchSort | undefined) ?? "relevance") as SearchSort;
  const rawLimit = args.limit as number | undefined;

  // Clamp the limit. Defensively coerce — the validator allows any number.
  const limit = Math.max(
    1,
    Math.min(MAX_LIMIT, Math.floor(Number(rawLimit ?? DEFAULT_LIMIT) || DEFAULT_LIMIT)),
  );

  // Shape validation that goes beyond the dispatcher's top-level type check:
  // arrays-of-strings, ISO-ish date, sort enum, engine enum.
  if (engines !== undefined) {
    if (!Array.isArray(engines) || engines.some((e) => typeof e !== "string")) {
      throw new Error("engines must be an array of strings");
    }
    const bad = engines.filter((e) => !(ALL_ENGINES as readonly string[]).includes(e));
    if (bad.length > 0) {
      throw new Error(`unknown engine(s): ${bad.join(", ")}`);
    }
  }
  if (tags !== undefined) {
    if (!Array.isArray(tags) || tags.some((t) => typeof t !== "string")) {
      throw new Error("tags must be an array of strings");
    }
  }
  if (updatedSince !== undefined) {
    if (typeof updatedSince !== "string" || Number.isNaN(Date.parse(updatedSince))) {
      throw new Error("updatedSince must be an ISO datetime string");
    }
  }
  const validSorts: SearchSort[] = ["updated", "created", "name", "relevance"];
  if (!validSorts.includes(sort)) {
    throw new Error(`sort must be one of: ${validSorts.join(", ")}`);
  }

  // Build the WHERE fragments. Each branch is conditional so a caller can
  // mix-and-match filters. The `sql` template guarantees parameter binding.
  const sql = ctx.sql as Sql;

  // The two main filters that always apply: workspace scope + any provided
  // filter. We use `sql.unsafe` only for the ORDER BY direction below; all
  // values flow through tagged templates.
  const where: ReturnType<Sql>[] = [];
  where.push(sql`d.workspace_id = ${ctx.workspaceId}`);

  // Full-text search. When a query is provided, match on either:
  //   (a) the diagram's own search_tsv (name + dsl), OR
  //   (b) at least one annotation body on the diagram.
  // The annotation tsquery is computed identically to the diagram-side one
  // so a single typed query reaches both.
  if (query) {
    where.push(sql`(
      d.search_tsv @@ websearch_to_tsquery('english', ${query})
      OR EXISTS (
        SELECT 1 FROM annotations a
        WHERE a.diagram_id = d.id
          AND to_tsvector('english', coalesce(a.text, '')) @@ websearch_to_tsquery('english', ${query})
      )
    )`);
  }

  if (engines && engines.length > 0) {
    where.push(sql`d.engine = ANY(${engines})`);
  }

  if (tags && tags.length > 0) {
    // ALL-of-tags semantics. `@>` returns true when the left jsonb contains
    // every element on the right — that's exactly the AND-across-tags
    // contract the spec calls for.
    where.push(sql`d.meta -> 'tags' @> ${sql.json(tags as unknown as Parameters<Sql["json"]>[0])}::jsonb`);
  }

  if (updatedSince) {
    where.push(sql`d.updated_at >= ${updatedSince}::timestamptz`);
  }

  // Combine WHERE fragments with AND. The runtime composes a single query.
  // We can't use `sql.join(...)` here because that's not a stable API on
  // older postgres versions; instead, we build one big AND chain manually.
  let whereClause = sql`${where[0]!}`;
  for (let i = 1; i < where.length; i++) {
    whereClause = sql`${whereClause} AND ${where[i]!}`;
  }

  // ORDER BY:
  //   - relevance (default): use ts_rank against the diagram's search_tsv.
  //     If no query was supplied, fall through to updated_at DESC.
  //   - updated / created / name: obvious mappings.
  // ts_rank returns NULL when the tsvector doesn't intersect the query;
  // that's only possible when the annotation-EXISTS path matched without
  // the diagram itself matching, so we coalesce to 0 to keep the ordering
  // stable.
  const orderBy = (() => {
    if (sort === "relevance" && query) {
      return sql`ORDER BY coalesce(ts_rank(d.search_tsv, websearch_to_tsquery('english', ${query})), 0) DESC, d.updated_at DESC`;
    }
    if (sort === "relevance") {
      // No query → no rank possible; fall back to recency.
      return sql`ORDER BY d.updated_at DESC`;
    }
    if (sort === "updated") return sql`ORDER BY d.updated_at DESC`;
    if (sort === "created") return sql`ORDER BY d.created_at DESC`;
    return sql`ORDER BY d.name ASC`;
  })();

  // SELECT fragment. The optional snippet column is only computed when a
  // query is present (otherwise we'd waste ts_headline cycles).
  const snippetCol = query
    ? sql`, ts_headline('english', coalesce(d.dsl, ''), websearch_to_tsquery('english', ${query}), 'MaxFragments=1, MaxWords=12, MinWords=4') AS snippet`
    : sql``;

  const scoreCol = query
    ? sql`, coalesce(ts_rank(d.search_tsv, websearch_to_tsquery('english', ${query})), 0) AS score`
    : sql``;

  const rows = (await sql`
    SELECT
      d.id, d.slug, d.name, d.engine, d.meta,
      d.updated_at, d.created_at
      ${snippetCol}
      ${scoreCol}
    FROM diagrams d
    WHERE ${whereClause}
    ${orderBy}
    LIMIT ${limit}
  `) as Array<Record<string, unknown>>;

  const results: SearchHit[] = rows.map((row) => {
    const meta = (row.meta as { tags?: unknown[] } | null) ?? {};
    const tagsOnRow = Array.isArray(meta.tags)
      ? (meta.tags as unknown[]).filter((t) => typeof t === "string") as string[]
      : [];
    const hit: SearchHit = {
      slug: row.slug as string,
      name: row.name as string,
      engine: row.engine as string,
      tags: tagsOnRow,
      updatedAt: (row.updated_at as Date).toISOString(),
      createdAt: (row.created_at as Date).toISOString(),
    };
    if (query && row.snippet !== undefined && row.snippet !== null) {
      hit.snippet = row.snippet as string;
    }
    if (query && row.score !== undefined && row.score !== null) {
      hit.score = Number(row.score);
    }
    return hit;
  });

  return { results };
}

// ───────────────────────────────────────────────────────────────────────────
// Tool definitions
// ───────────────────────────────────────────────────────────────────────────

export const searchTools: ToolDef[] = [
  {
    name: "search_diagrams",
    description:
      "Full-text search across diagrams in the current workspace. Searches `name`, `dsl`, and annotation bodies; filters by `engines`, `tags` (AND), and `updatedSince`. Sort by `relevance` (default), `updated`, `created`, or `name`. Returns up to `limit` (default 20, max 100) results with optional `snippet` and relevance `score` when a `query` is provided.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        engines: { type: "array", items: { type: "string" } },
        tags: { type: "array", items: { type: "string" } },
        updatedSince: { type: "string" },
        sort: { type: "string", enum: ["updated", "created", "name", "relevance"] },
        limit: { type: "integer" },
      },
      // All fields optional — empty input returns workspace diagrams sorted
      // by recency. This matches `list_diagrams` semantics; the extra power
      // is in the filters.
    },
    run: searchDiagramsImpl,
  },
];

export const searchImpls = {
  search_diagrams: searchDiagramsImpl,
};
