import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import postgres from "postgres";
import { join } from "node:path";
import { runMigrations } from "../../src/db/migrate";
import { getDb, closeDb } from "../../src/db/client";
import { createWorkspace } from "../../src/db/workspaces";
import {
  TOOLS,
  UnknownToolError,
  ValidationError,
  dispatchTool,
  validateArgs,
} from "../../src/mcp/tools";

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:55432/prixmaviz_test";

async function reset() {
  const sql = postgres(TEST_DB_URL);
  await sql`DROP TABLE IF EXISTS annotations CASCADE`;
  await sql`DROP TABLE IF EXISTS diagrams CASCADE`;
  await sql`DROP TABLE IF EXISTS workspaces CASCADE`;
  await sql`DROP TABLE IF EXISTS schema_migrations CASCADE`;
  await sql.end();
  await runMigrations(TEST_DB_URL, join(import.meta.dir, "../../migrations"));
}

beforeEach(reset);
afterEach(closeDb);

function ctx(sql: ReturnType<typeof postgres>, workspaceId: string) {
  return {
    sql,
    workspaceId,
    kroki: { renderSvg: async () => "<svg/>" } as never,
    hub: { broadcast: () => {} } as never,
  };
}

function tool(name: string) {
  const t = TOOLS.find((x) => x.name === name);
  if (!t) throw new Error(`fixture missing tool: ${name}`);
  return t;
}

// ───────────────────────────────────────────────────────────────────────────
// validateArgs — unit tests (no DB required, but kept in this file for
// colocation with the dispatcher tests).
// ───────────────────────────────────────────────────────────────────────────

describe("validateArgs — required fields", () => {
  it("throws missing_required_parameter when a required field is absent", () => {
    expect(() => validateArgs(tool("create_diagram"), { name: "x" })).toThrow(
      ValidationError,
    );
    try {
      validateArgs(tool("create_diagram"), { name: "x" });
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect((e as ValidationError).code).toBe("missing_required_parameter");
      expect((e as ValidationError).parameter).toBe("engine");
      expect((e as ValidationError).message).toMatch(/Missing required parameter: engine/);
    }
  });

  it("treats null and undefined the same — both count as missing", () => {
    expect(() =>
      validateArgs(tool("create_diagram"), { name: "x", engine: null }),
    ).toThrow(/Missing required parameter: engine/);
  });

  it("accepts an alias as a substitute for the canonical required field", () => {
    // load_diagram requires `slug` but legacyAliases declares name → slug
    expect(() =>
      validateArgs(tool("load_diagram"), { name: "my-flow" }),
    ).not.toThrow();
  });

  it("still throws when neither canonical nor alias is supplied", () => {
    // load_diagram now uses `oneOf` to allow either slug, diagramId, or the
    // legacy `name` alias. The error message lists all valid options.
    expect(() => validateArgs(tool("load_diagram"), {})).toThrow(
      /Exactly one of \[slug, diagramId\] is required/,
    );
  });
});

describe("validateArgs — unknown fields", () => {
  it("throws unknown_parameter for fields not in the schema (catches issue #14 'format' for 'engine')", () => {
    try {
      validateArgs(tool("render_dsl"), {
        engine: "graphviz",
        dsl: "digraph { a -> b }",
        format: "dot", // <- the issue-#14 offending key
      });
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect((e as ValidationError).code).toBe("unknown_parameter");
      expect((e as ValidationError).parameter).toBe("format");
      expect((e as ValidationError).message).toMatch(/Unknown parameter: format/);
      // The valid alternatives should be listed.
      expect((e as ValidationError).message).toMatch(/engine/);
      expect((e as ValidationError).message).toMatch(/dsl/);
    }
  });

  it("allows declared legacy aliases through (e.g. render_dsl.source)", () => {
    expect(() =>
      validateArgs(tool("render_dsl"), {
        engine: "graphviz",
        source: "digraph { a -> b }",
      }),
    ).not.toThrow();
  });
});

describe("validateArgs — types and enums", () => {
  it("throws invalid_parameter_type when a string field gets a number", () => {
    try {
      validateArgs(tool("create_diagram"), { name: 7 as unknown as string, engine: "mermaid" });
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect((e as ValidationError).code).toBe("invalid_parameter_type");
      expect((e as ValidationError).parameter).toBe("name");
    }
  });

  it("throws invalid_parameter_value when an enum field gets an out-of-set value", () => {
    try {
      validateArgs(tool("create_diagram"), { name: "x", engine: "powerpoint" });
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect((e as ValidationError).code).toBe("invalid_parameter_value");
      expect((e as ValidationError).parameter).toBe("engine");
      expect((e as ValidationError).message).toMatch(/Expected one of/);
    }
  });

  it("accepts valid enum members", () => {
    expect(() =>
      validateArgs(tool("create_diagram"), { name: "x", engine: "mermaid" }),
    ).not.toThrow();
  });

  it("rejects non-object args entirely", () => {
    expect(() => validateArgs(tool("create_diagram"), [] as never)).toThrow(
      /must be a JSON object/,
    );
  });
});

// ───────────────────────────────────────────────────────────────────────────
// dispatchTool — integration tests against the real validator + a tiny DB.
// ───────────────────────────────────────────────────────────────────────────

describe("dispatchTool — validation gate", () => {
  it("valid input dispatches and returns the impl's happy-path shape", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const result = (await dispatchTool(
      "render_dsl",
      { engine: "mermaid", dsl: "graph TD\n  A --> B", name: "happy" },
      ctx(sql, ws.id),
    )) as { diagramId: string; slug: string };
    // Happy path response shape must be unchanged.
    expect(result.diagramId).toMatch(/^d_/);
    expect(result.slug).toBe("happy");
  });

  it("invalid input throws ValidationError before the impl runs", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    // No `dsl` and no legacy `source`.
    await expect(
      dispatchTool("render_dsl", { engine: "mermaid" }, ctx(sql, ws.id)),
    ).rejects.toThrow(ValidationError);
  });

  it("unknown tool throws UnknownToolError (not generic Error)", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    await expect(
      dispatchTool("does_not_exist", {}, ctx(sql, ws.id)),
    ).rejects.toThrow(UnknownToolError);
  });

  it("unknown parameter on an otherwise-valid call is rejected before the impl can run", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    // All required fields present, but a stray `format` key sneaks in.
    await expect(
      dispatchTool(
        "render_dsl",
        { engine: "graphviz", dsl: "digraph { a -> b }", format: "dot" } as Record<string, unknown>,
        ctx(sql, ws.id),
      ),
    ).rejects.toThrow(/Unknown parameter: format/);
  });

  it("issue-#14 mismatched-keys case names both the missing canonical and the unknown supplied key", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    // The exact case from the issue body — caller used `format` instead of
    // `engine` and `dsl` (which they did get right). The required check
    // fires first because `engine` is missing.
    await expect(
      dispatchTool(
        "render_dsl",
        { format: "dot", dsl: "digraph G { a -> b }" } as Record<string, unknown>,
        ctx(sql, ws.id),
      ),
    ).rejects.toThrow(/Missing required parameter: engine.*Unknown keys supplied: format/);
  });
});
