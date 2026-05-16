/**
 * Issue #8 / Wave 1A — share-link HTTP route tests.
 *
 * Mirrors the pattern in library-routes.test.ts (auth happy/sad,
 * per-workspace isolation, structured errors) with three additional
 * concerns:
 *
 *   - Expired tokens → HTTP 410 Gone (NOT 404). The link existed; it
 *     just isn't valid anymore. Distinct from "never existed" (404).
 *   - Referrer-Policy: no-referrer set on every /s/* response so the
 *     opaque token doesn't leak in outgoing Referer headers.
 *   - /embed and /og set the permissive iframe CSP + Referrer-Policy
 *     and gate on workspace-public-or-not.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import postgres from "postgres";
import { join } from "node:path";
import type { ServerToClient } from "@prixmaviz/shared";
import { runMigrations } from "../../src/db/migrate";
import { getDb, closeDb } from "../../src/db/client";
import { createWorkspace } from "../../src/db/workspaces";
import {
  createDiagram,
  setDiagramPublic,
  updateDiagram,
} from "../../src/db/diagrams";
import {
  dbCreateShareLink,
  dbGetShareByToken,
} from "../../src/db/share-links";
import { handleApi, type RouteDeps } from "../../src/http/routes";
import { KrokiClient } from "../../src/kroki/client";
import { WsHub, type WsMember } from "../../src/ws/broadcast";

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:55432/prixmaviz_test";

async function reset() {
  const sql = postgres(TEST_DB_URL);
  await sql`DROP TABLE IF EXISTS share_links CASCADE`;
  await sql`DROP TABLE IF EXISTS annotations CASCADE`;
  await sql`DROP TABLE IF EXISTS diagram_versions CASCADE`;
  await sql`DROP TABLE IF EXISTS diagrams CASCADE`;
  await sql`DROP TABLE IF EXISTS workspaces CASCADE`;
  await sql`DROP TABLE IF EXISTS schema_migrations CASCADE`;
  await sql.end();
  await runMigrations(TEST_DB_URL, join(import.meta.dir, "../../migrations"));
}

beforeEach(reset);
afterEach(closeDb);

function makeDeps(): RouteDeps & { broadcasts: { workspaceId: string | null; msg: ServerToClient }[] } {
  const broadcasts: { workspaceId: string | null; msg: ServerToClient }[] = [];
  const hub = new WsHub();
  const member: WsMember = { workspaceId: null, send() {} };
  hub.add(member);
  const originalBroadcast = hub.broadcast.bind(hub);
  hub.broadcast = (workspaceId, msg) => {
    broadcasts.push({ workspaceId, msg });
    originalBroadcast(workspaceId, msg);
  };
  return {
    sql: getDb(TEST_DB_URL),
    kroki: new KrokiClient(),
    hub,
    broadcasts,
  };
}

async function seed(deps: RouteDeps, workspaceId: string, slug = "alpha") {
  const d = await createDiagram(deps.sql, {
    workspaceId,
    slug,
    name: `Name ${slug}`,
    engine: "mermaid",
    kind: "passthrough",
    dsl: "graph TD\n  A --> B",
  });
  // Give the diagram an svg so /s/:token.svg has something to serve.
  await updateDiagram(deps.sql, workspaceId, d.id, {
    svg: '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>',
  });
  return d;
}

function auth(workspaceId: string): HeadersInit {
  return { Authorization: `Bearer ${workspaceId}`, "Content-Type": "application/json" };
}

// ───────────────────────────────────────────────────────────────────────────
// POST /api/diagrams/:id/shares
// ───────────────────────────────────────────────────────────────────────────

describe("POST /api/diagrams/:id/shares", () => {
  it("creates a view-only share and broadcasts library:share-created", async () => {
    const deps = makeDeps();
    const ws = await createWorkspace(deps.sql);
    const d = await seed(deps, ws.id);

    const req = new Request(`http://x/api/diagrams/${d.id}/shares`, {
      method: "POST",
      headers: auth(ws.id),
      body: JSON.stringify({ permission: "view" }),
    });
    const resp = await handleApi(req, new URL(req.url), deps);
    expect(resp?.status).toBe(200);
    const body = await resp!.json() as { token: string; url: string };
    expect(body.token).toMatch(/^s_[0-9a-f]{32}$/);
    expect(body.url).toMatch(/\/s\/s_[0-9a-f]{32}$/);

    // Persisted.
    const got = await dbGetShareByToken(deps.sql, body.token);
    expect(got?.permission).toBe("view");
    expect(got?.diagramId).toBe(d.id);
    expect(got?.expiresAt).toBeNull();

    // Broadcast.
    const created = deps.broadcasts.filter(
      (b) => (b.msg as { type?: string }).type === "library:share-created",
    );
    expect(created.length).toBe(1);
    const m = created[0]!.msg as { diagramId: string; token: string; permission: string };
    expect(m.diagramId).toBe(d.id);
    expect(m.permission).toBe("view");
    expect(m.token).toBe(body.token);
  });

  it("accepts an ISO-8601 expiresAt", async () => {
    const deps = makeDeps();
    const ws = await createWorkspace(deps.sql);
    const d = await seed(deps, ws.id);
    const future = new Date(Date.now() + 60_000).toISOString();

    const req = new Request(`http://x/api/diagrams/${d.id}/shares`, {
      method: "POST",
      headers: auth(ws.id),
      body: JSON.stringify({ permission: "comment", expiresAt: future }),
    });
    const resp = await handleApi(req, new URL(req.url), deps);
    expect(resp?.status).toBe(200);
    const body = await resp!.json() as { token: string };

    const got = await dbGetShareByToken(deps.sql, body.token);
    expect(got?.permission).toBe("comment");
    expect(got?.expiresAt).toBe(future);
  });

  it("rejects an invalid permission tier with 400", async () => {
    const deps = makeDeps();
    const ws = await createWorkspace(deps.sql);
    const d = await seed(deps, ws.id);

    const req = new Request(`http://x/api/diagrams/${d.id}/shares`, {
      method: "POST",
      headers: auth(ws.id),
      body: JSON.stringify({ permission: "admin" }),
    });
    const resp = await handleApi(req, new URL(req.url), deps);
    expect(resp?.status).toBe(400);
  });

  it("rejects a non-ISO expiresAt with 400", async () => {
    const deps = makeDeps();
    const ws = await createWorkspace(deps.sql);
    const d = await seed(deps, ws.id);

    const req = new Request(`http://x/api/diagrams/${d.id}/shares`, {
      method: "POST",
      headers: auth(ws.id),
      body: JSON.stringify({ permission: "view", expiresAt: "not a date" }),
    });
    const resp = await handleApi(req, new URL(req.url), deps);
    expect(resp?.status).toBe(400);
  });

  it("returns 404 for a foreign workspace's diagram (no leak)", async () => {
    const deps = makeDeps();
    const a = await createWorkspace(deps.sql);
    const b = await createWorkspace(deps.sql);
    const d = await seed(deps, a.id);

    const req = new Request(`http://x/api/diagrams/${d.id}/shares`, {
      method: "POST",
      headers: auth(b.id),
      body: JSON.stringify({ permission: "view" }),
    });
    const resp = await handleApi(req, new URL(req.url), deps);
    expect(resp?.status).toBe(404);
  });

  it("requires auth (401 without Authorization)", async () => {
    const deps = makeDeps();
    const ws = await createWorkspace(deps.sql);
    const d = await seed(deps, ws.id);
    const req = new Request(`http://x/api/diagrams/${d.id}/shares`, {
      method: "POST",
      body: JSON.stringify({ permission: "view" }),
    });
    const resp = await handleApi(req, new URL(req.url), deps);
    expect(resp?.status).toBe(401);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// GET /api/diagrams/:id/shares
// ───────────────────────────────────────────────────────────────────────────

describe("GET /api/diagrams/:id/shares", () => {
  it("lists the owner's links for the diagram", async () => {
    const deps = makeDeps();
    const ws = await createWorkspace(deps.sql);
    const d = await seed(deps, ws.id);
    await dbCreateShareLink(deps.sql, d.id, "view", null, ws.id);
    await dbCreateShareLink(deps.sql, d.id, "edit", null, ws.id);

    const req = new Request(`http://x/api/diagrams/${d.id}/shares`, { headers: auth(ws.id) });
    const resp = await handleApi(req, new URL(req.url), deps);
    expect(resp?.status).toBe(200);
    const body = await resp!.json() as {
      links: Array<{ token: string; permission: string; expiresAt: string | null; url: string }>;
    };
    expect(body.links).toHaveLength(2);
    expect(body.links.every((l) => l.token.startsWith("s_"))).toBe(true);
    expect(body.links.every((l) => l.url.endsWith(l.token))).toBe(true);
  });

  it("isolates by workspace — foreign workspace gets 404 on diagram lookup", async () => {
    const deps = makeDeps();
    const a = await createWorkspace(deps.sql);
    const b = await createWorkspace(deps.sql);
    const d = await seed(deps, a.id);
    await dbCreateShareLink(deps.sql, d.id, "view", null, a.id);

    const req = new Request(`http://x/api/diagrams/${d.id}/shares`, { headers: auth(b.id) });
    const resp = await handleApi(req, new URL(req.url), deps);
    expect(resp?.status).toBe(404);
  });

  it("returns empty links array when none exist", async () => {
    const deps = makeDeps();
    const ws = await createWorkspace(deps.sql);
    const d = await seed(deps, ws.id);
    const req = new Request(`http://x/api/diagrams/${d.id}/shares`, { headers: auth(ws.id) });
    const resp = await handleApi(req, new URL(req.url), deps);
    expect(resp?.status).toBe(200);
    const body = await resp!.json() as { links: unknown[] };
    expect(body.links).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// DELETE /api/shares/:token
// ───────────────────────────────────────────────────────────────────────────

describe("DELETE /api/shares/:token", () => {
  it("revokes the owner's link and broadcasts library:share-revoked", async () => {
    const deps = makeDeps();
    const ws = await createWorkspace(deps.sql);
    const d = await seed(deps, ws.id);
    const { token } = await dbCreateShareLink(deps.sql, d.id, "view", null, ws.id);

    const req = new Request(`http://x/api/shares/${token}`, {
      method: "DELETE",
      headers: auth(ws.id),
    });
    const resp = await handleApi(req, new URL(req.url), deps);
    expect(resp?.status).toBe(200);
    expect(await dbGetShareByToken(deps.sql, token)).toBeNull();

    const revoked = deps.broadcasts.filter(
      (b) => (b.msg as { type?: string }).type === "library:share-revoked",
    );
    expect(revoked.length).toBe(1);
    expect((revoked[0]!.msg as { token?: string }).token).toBe(token);
  });

  it("returns 404 for a missing token", async () => {
    const deps = makeDeps();
    const ws = await createWorkspace(deps.sql);
    const req = new Request("http://x/api/shares/s_doesnotexist", {
      method: "DELETE",
      headers: auth(ws.id),
    });
    const resp = await handleApi(req, new URL(req.url), deps);
    expect(resp?.status).toBe(404);
  });

  it("returns 404 when caller is not the owner (no leak)", async () => {
    const deps = makeDeps();
    const a = await createWorkspace(deps.sql);
    const b = await createWorkspace(deps.sql);
    const dA = await seed(deps, a.id);
    const { token } = await dbCreateShareLink(deps.sql, dA.id, "view", null, a.id);

    const req = new Request(`http://x/api/shares/${token}`, {
      method: "DELETE",
      headers: auth(b.id),
    });
    const resp = await handleApi(req, new URL(req.url), deps);
    expect(resp?.status).toBe(404);
    // Link still there.
    expect(await dbGetShareByToken(deps.sql, token)).not.toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// GET /s/:token.svg + /s/:token (public, no auth)
// ───────────────────────────────────────────────────────────────────────────

describe("GET /s/:token.svg (public)", () => {
  it("serves the SVG with iframe-permissive CSP + Referrer-Policy", async () => {
    const deps = makeDeps();
    const ws = await createWorkspace(deps.sql);
    const d = await seed(deps, ws.id);
    const { token } = await dbCreateShareLink(deps.sql, d.id, "view", null, ws.id);

    const req = new Request(`http://x/s/${token}.svg`);
    const resp = await handleApi(req, new URL(req.url), deps);
    expect(resp?.status).toBe(200);
    expect(resp!.headers.get("Content-Type")).toMatch(/image\/svg\+xml/);
    expect(resp!.headers.get("X-Frame-Options")).toBe("ALLOWALL");
    expect(resp!.headers.get("Content-Security-Policy")).toBe("frame-ancestors *");
    expect(resp!.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(await resp!.text()).toContain("<svg");
  });

  it("returns 404 for a missing token (with Referrer-Policy still set)", async () => {
    const deps = makeDeps();
    const req = new Request("http://x/s/s_doesnotexist.svg");
    const resp = await handleApi(req, new URL(req.url), deps);
    expect(resp?.status).toBe(404);
    expect(resp!.headers.get("Referrer-Policy")).toBe("no-referrer");
  });

  it("returns 410 Gone for an expired token (NOT 404)", async () => {
    const deps = makeDeps();
    const ws = await createWorkspace(deps.sql);
    const d = await seed(deps, ws.id);
    const past = new Date(Date.now() - 60_000).toISOString();
    const { token } = await dbCreateShareLink(deps.sql, d.id, "view", past, ws.id);

    const req = new Request(`http://x/s/${token}.svg`);
    const resp = await handleApi(req, new URL(req.url), deps);
    expect(resp?.status).toBe(410);
    expect(resp!.headers.get("Referrer-Policy")).toBe("no-referrer");
  });
});

describe("GET /s/:token (SPA shell)", () => {
  it("returns undefined to fall through to static for a valid token", async () => {
    const deps = makeDeps();
    const ws = await createWorkspace(deps.sql);
    const d = await seed(deps, ws.id);
    const { token } = await dbCreateShareLink(deps.sql, d.id, "view", null, ws.id);

    const req = new Request(`http://x/s/${token}`);
    const resp = await handleApi(req, new URL(req.url), deps);
    // Fall-through is signaled by `undefined`.
    expect(resp).toBeUndefined();
  });

  it("returns 410 for expired", async () => {
    const deps = makeDeps();
    const ws = await createWorkspace(deps.sql);
    const d = await seed(deps, ws.id);
    const past = new Date(Date.now() - 60_000).toISOString();
    const { token } = await dbCreateShareLink(deps.sql, d.id, "view", past, ws.id);

    const req = new Request(`http://x/s/${token}`);
    const resp = await handleApi(req, new URL(req.url), deps);
    expect(resp?.status).toBe(410);
    expect(resp!.headers.get("Referrer-Policy")).toBe("no-referrer");
  });

  it("returns 404 for missing", async () => {
    const deps = makeDeps();
    const req = new Request("http://x/s/s_doesnotexist");
    const resp = await handleApi(req, new URL(req.url), deps);
    expect(resp?.status).toBe(404);
  });
});

describe("GET /api/public/shares/:token", () => {
  it("returns diagram metadata + permission for a valid token", async () => {
    const deps = makeDeps();
    const ws = await createWorkspace(deps.sql);
    const d = await seed(deps, ws.id);
    const { token } = await dbCreateShareLink(deps.sql, d.id, "edit", null, ws.id);

    const req = new Request(`http://x/api/public/shares/${token}`);
    const resp = await handleApi(req, new URL(req.url), deps);
    expect(resp?.status).toBe(200);
    expect(resp!.headers.get("Referrer-Policy")).toBe("no-referrer");
    const body = await resp!.json() as {
      id: string; name: string; engine: string; svg: string; permission: string;
    };
    expect(body.id).toBe(d.id);
    expect(body.permission).toBe("edit");
    expect(body.svg).toContain("<svg");
  });

  it("returns 410 for expired", async () => {
    const deps = makeDeps();
    const ws = await createWorkspace(deps.sql);
    const d = await seed(deps, ws.id);
    const past = new Date(Date.now() - 60_000).toISOString();
    const { token } = await dbCreateShareLink(deps.sql, d.id, "view", past, ws.id);

    const req = new Request(`http://x/api/public/shares/${token}`);
    const resp = await handleApi(req, new URL(req.url), deps);
    expect(resp?.status).toBe(410);
    expect(resp!.headers.get("Referrer-Policy")).toBe("no-referrer");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// GET /embed/:slug.svg
// ───────────────────────────────────────────────────────────────────────────

describe("GET /embed/:slug.svg", () => {
  it("serves SVG with permissive CSP when the workspace has any share_link", async () => {
    const deps = makeDeps();
    const ws = await createWorkspace(deps.sql);
    const d = await seed(deps, ws.id, "embed-me");
    // Workspace becomes "embed-ready" by having any share_link.
    await dbCreateShareLink(deps.sql, d.id, "view", null, ws.id);

    const req = new Request(`http://x/embed/${d.slug}.svg`);
    const resp = await handleApi(req, new URL(req.url), deps);
    expect(resp?.status).toBe(200);
    expect(resp!.headers.get("X-Frame-Options")).toBe("ALLOWALL");
    expect(resp!.headers.get("Content-Security-Policy")).toBe("frame-ancestors *");
    expect(resp!.headers.get("Referrer-Policy")).toBe("no-referrer");
  });

  it("returns 404 when the workspace has NO share_links (not embed-ready)", async () => {
    const deps = makeDeps();
    const ws = await createWorkspace(deps.sql);
    const d = await seed(deps, ws.id, "private-slug");

    const req = new Request(`http://x/embed/${d.slug}.svg`);
    const resp = await handleApi(req, new URL(req.url), deps);
    expect(resp?.status).toBe(404);
  });

  it("returns 404 for a missing slug", async () => {
    const deps = makeDeps();
    const req = new Request("http://x/embed/no-such-slug.svg");
    const resp = await handleApi(req, new URL(req.url), deps);
    expect(resp?.status).toBe(404);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// GET /og/:idOrToken.png
// ───────────────────────────────────────────────────────────────────────────

describe("GET /og/:idOrToken.png", () => {
  it("returns 410 for an expired share token (does NOT fall through to render)", async () => {
    const deps = makeDeps();
    const ws = await createWorkspace(deps.sql);
    const d = await seed(deps, ws.id);
    const past = new Date(Date.now() - 60_000).toISOString();
    const { token } = await dbCreateShareLink(deps.sql, d.id, "view", past, ws.id);

    const req = new Request(`http://x/og/${token}.png`);
    const resp = await handleApi(req, new URL(req.url), deps);
    expect(resp?.status).toBe(410);
    expect(resp!.headers.get("Referrer-Policy")).toBe("no-referrer");
  });

  it("returns 404 for an unrecognized id/token", async () => {
    const deps = makeDeps();
    const req = new Request("http://x/og/s_doesnotexist.png");
    const resp = await handleApi(req, new URL(req.url), deps);
    expect(resp?.status).toBe(404);
  });

  it("falls back to public_view=TRUE diagram id", async () => {
    // Kroki is not available in tests for actual PNG rendering, so we
    // just assert that the resolve path lights up — the actual render
    // would fail with 502 (no kroki), but we want to confirm the lookup
    // sees the public diagram.
    const deps = makeDeps();
    const ws = await createWorkspace(deps.sql);
    const d = await seed(deps, ws.id);
    await setDiagramPublic(deps.sql, ws.id, d.id, true);

    const req = new Request(`http://x/og/${d.id}.png`);
    const resp = await handleApi(req, new URL(req.url), deps);
    // 502 means Kroki was reached for the PNG render — this confirms the
    // resolve path worked (404 would mean we never tried to render).
    // If Kroki IS running in tests, it may return 200.
    expect([200, 502].includes(resp?.status ?? -1)).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// OG pre-warm fire-and-forget
// ───────────────────────────────────────────────────────────────────────────

describe("POST /api/diagrams/:id/shares fire-and-forget warm-up", () => {
  it("does NOT block the response on the warm-up (returns in well under timeout)", async () => {
    const deps = makeDeps();
    const ws = await createWorkspace(deps.sql);
    const d = await seed(deps, ws.id);

    const start = Date.now();
    const resp = await handleApi(
      new Request(`http://x/api/diagrams/${d.id}/shares`, {
        method: "POST",
        headers: auth(ws.id),
        body: JSON.stringify({ permission: "view" }),
      }),
      new URL(`http://x/api/diagrams/${d.id}/shares`),
      deps,
    );
    const elapsed = Date.now() - start;
    expect(resp?.status).toBe(200);
    // Warm-up calls Kroki which may not be reachable. The route MUST
    // return before the upstream finishes. 2s is generous; in practice
    // it's <100ms because the response is built before the warm-up
    // promise is awaited.
    expect(elapsed).toBeLessThan(2000);
  });
});
