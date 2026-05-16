import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import postgres from "postgres";
import { join } from "node:path";
import { runMigrations } from "../../src/db/migrate";
import { getDb, closeDb } from "../../src/db/client";
import { createWorkspace } from "../../src/db/workspaces";
import { handleApi, type RouteDeps } from "../../src/http/routes";
import { KrokiClient } from "../../src/kroki/client";
import { WsHub } from "../../src/ws/broadcast";

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

function makeDeps(): RouteDeps {
  return {
    sql: getDb(TEST_DB_URL),
    kroki: new KrokiClient(),
    hub: new WsHub(),
  };
}

beforeEach(reset);
afterEach(closeDb);

async function postMcp(
  toolName: string,
  args: Record<string, unknown>,
  deps: RouteDeps,
  bearer: string,
): Promise<Response> {
  const req = new Request(`http://x/api/mcp/${toolName}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${bearer}` },
    body: JSON.stringify(args),
  });
  const resp = await handleApi(req, new URL(req.url), deps);
  if (!resp) throw new Error("expected a response from handleApi");
  return resp;
}

describe("MCP error envelope (issue #14)", () => {
  it("happy path returns the tool's body unchanged with status 200", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const deps = makeDeps();
    const resp = await postMcp(
      "render_dsl",
      { engine: "mermaid", dsl: "graph TD\n A --> B", name: "envelope-happy" },
      deps,
      ws.id,
    );
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { diagramId: string; slug: string };
    // No `error` envelope on happy path, no `ok` flag — pure tool output.
    expect(body.diagramId).toMatch(/^d_/);
    expect(body.slug).toBe("envelope-happy");
    expect((body as unknown as { error?: unknown }).error).toBeUndefined();
  });

  it("missing required parameter → 400 with code=missing_required_parameter", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const deps = makeDeps();
    const resp = await postMcp("render_dsl", { engine: "mermaid" }, deps, ws.id);
    expect(resp.status).toBe(400);
    const body = (await resp.json()) as {
      ok: false;
      error: { code: string; message: string; parameter?: string; tool?: string };
    };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("missing_required_parameter");
    expect(body.error.parameter).toBe("dsl");
    expect(body.error.tool).toBe("render_dsl");
    expect(body.error.message).toMatch(/Missing required parameter: dsl/);
  });

  it("the issue-#14 'format' for 'engine' case → 400 names both the missing canonical and the unknown supplied key", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const deps = makeDeps();
    const resp = await postMcp(
      "render_dsl",
      { format: "dot", dsl: "digraph { a -> b }" },
      deps,
      ws.id,
    );
    expect(resp.status).toBe(400);
    const body = (await resp.json()) as {
      error: { code: string; message: string; parameter?: string };
    };
    // Required check fires first because `engine` is missing. The message
    // includes both the canonical name AND the unknown key the caller
    // supplied, so the caller can self-correct without a second round-trip.
    expect(body.error.code).toBe("missing_required_parameter");
    expect(body.error.parameter).toBe("engine");
    expect(body.error.message).toMatch(/Missing required parameter: engine/);
    expect(body.error.message).toMatch(/Unknown keys supplied: format/);
  });

  it("unknown parameter alone (all required satisfied) → 400 with code=unknown_parameter", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const deps = makeDeps();
    // All required fields present → only the trailing 'format' is unknown.
    const resp = await postMcp(
      "render_dsl",
      { engine: "graphviz", dsl: "digraph { a -> b }", format: "dot" },
      deps,
      ws.id,
    );
    expect(resp.status).toBe(400);
    const body = (await resp.json()) as {
      error: { code: string; message: string; parameter?: string };
    };
    expect(body.error.code).toBe("unknown_parameter");
    expect(body.error.parameter).toBe("format");
    expect(body.error.message).toMatch(/Unknown parameter: format/);
    expect(body.error.message).toMatch(/engine/);
    expect(body.error.message).toMatch(/dsl/);
  });

  it("invalid enum value → 400 with code=invalid_parameter_value and the enum list", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const deps = makeDeps();
    const resp = await postMcp(
      "create_diagram",
      { name: "x", engine: "powerpoint" },
      deps,
      ws.id,
    );
    expect(resp.status).toBe(400);
    const body = (await resp.json()) as { error: { code: string; expected?: unknown[] } };
    expect(body.error.code).toBe("invalid_parameter_value");
    expect(Array.isArray(body.error.expected)).toBe(true);
  });

  it("unknown tool → 404 with code=unknown_tool", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const deps = makeDeps();
    const resp = await postMcp("does_not_exist", {}, deps, ws.id);
    expect(resp.status).toBe(404);
    const body = (await resp.json()) as { error: { code: string; tool?: string } };
    expect(body.error.code).toBe("unknown_tool");
    expect(body.error.tool).toBe("does_not_exist");
  });

  it("plain Error from a tool impl (e.g. 'diagram not found') → 400 with code=tool_error, message preserved", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const deps = makeDeps();
    // load_diagram with a valid-shape slug but no row by that slug.
    const resp = await postMcp(
      "load_diagram",
      { slug: "definitely-not-here" },
      deps,
      ws.id,
    );
    expect(resp.status).toBe(400);
    const body = (await resp.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("tool_error");
    expect(body.error.message).toMatch(/diagram not found/);
  });

  it("JS-runtime TypeError from a tool impl → 500 with code=internal_error, NO stack details leaked", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const deps = makeDeps();

    // Monkey-patch a tool's run to throw a TypeError, simulating the legacy
    // s.toLowerCase / name.endsWith leak that issue #14 calls out. Restore
    // it after the test so the rest of the suite stays unaffected.
    const tools = await import("../../src/mcp/tools");
    const target = tools.TOOLS.find((t) => t.name === "list_diagrams")!;
    const original = target.run;
    target.run = async () => {
      // Simulate the legacy "undefined.toLowerCase()" leak.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (undefined as any).toLowerCase();
    };
    try {
      const resp = await postMcp("list_diagrams", {}, deps, ws.id);
      expect(resp.status).toBe(500);
      const body = (await resp.json()) as {
        error: { code: string; message: string; correlationId?: string };
      };
      expect(body.error.code).toBe("internal_error");
      // Must NOT leak the raw runtime message.
      expect(body.error.message).not.toMatch(/toLowerCase/);
      expect(body.error.message).not.toMatch(/undefined is not/);
      // Should include a correlation id so operators can find the log line.
      expect(typeof body.error.correlationId).toBe("string");
    } finally {
      target.run = original;
    }
  });

  it("response body, when sliced to 500 chars, remains human-readable (shim backwards-compat)", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const deps = makeDeps();
    const resp = await postMcp("render_dsl", { engine: "mermaid" }, deps, ws.id);
    const text = await resp.text();
    // The shim does `body.slice(0, 500)` — verify the truncated head is
    // still informative (names the parameter, identifies the error class).
    const head = text.slice(0, 500);
    expect(head).toMatch(/missing_required_parameter/);
    expect(head).toMatch(/dsl/);
  });

  it("POST /api/mcp/call honors the same envelope on validation errors", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const deps = makeDeps();
    const req = new Request("http://x/api/mcp/call", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${ws.id}` },
      body: JSON.stringify({ tool: "render_dsl", args: { engine: "mermaid" } }),
    });
    const resp = (await handleApi(req, new URL(req.url), deps))!;
    expect(resp.status).toBe(400);
    const body = (await resp.json()) as { error: { code: string; tool?: string } };
    expect(body.error.code).toBe("missing_required_parameter");
    expect(body.error.tool).toBe("render_dsl");
  });

  it("POST /api/mcp/call with missing `tool` field → 400 with code=missing_required_parameter", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const deps = makeDeps();
    const req = new Request("http://x/api/mcp/call", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${ws.id}` },
      body: JSON.stringify({ args: {} }),
    });
    const resp = (await handleApi(req, new URL(req.url), deps))!;
    expect(resp.status).toBe(400);
    const body = (await resp.json()) as { error: { code: string; parameter?: string } };
    expect(body.error.code).toBe("missing_required_parameter");
    expect(body.error.parameter).toBe("tool");
  });
});
