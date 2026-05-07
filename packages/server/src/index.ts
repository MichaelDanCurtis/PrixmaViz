import { join, resolve, normalize } from "node:path";
import { existsSync } from "node:fs";
import type { ClientToServer, ServerToClient } from "@prixmaviz/shared";
import { renderViaKroki } from "./kroki";
import { addAnnotation, clearAnnotations, getAnnotations } from "./state";
import { EMBEDDED } from "./embedded";

const PORT = Number(process.env.PORT ?? 5180);
const WEB_DIST = resolve(
  process.env.PRIXMAVIZ_WEB_DIST ?? join(import.meta.dir, "../../web/dist"),
);

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

function mimeFor(path: string): string {
  const dot = path.lastIndexOf(".");
  const ext = dot >= 0 ? path.slice(dot).toLowerCase() : "";
  return MIME[ext] ?? "application/octet-stream";
}

async function serveStatic(pathname: string): Promise<Response> {
  const safe = "/" + normalize(pathname).replace(/^\/+/, "");

  const embeddedPath = EMBEDDED[safe];
  if (embeddedPath) {
    return new Response(Bun.file(embeddedPath), { headers: { "Content-Type": mimeFor(safe) } });
  }
  const embeddedIndex = EMBEDDED["/index.html"];
  if (embeddedIndex && safe !== "/index.html") {
    return new Response(Bun.file(embeddedIndex), {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  const rel = safe.replace(/^\/+/, "");
  const full = resolve(WEB_DIST, rel);
  if (!full.startsWith(WEB_DIST)) return new Response("forbidden", { status: 403 });
  const file = Bun.file(full);
  if (await file.exists()) {
    return new Response(file, { headers: { "Content-Type": mimeFor(full) } });
  }
  const indexFile = Bun.file(join(WEB_DIST, "index.html"));
  if (await indexFile.exists()) {
    return new Response(indexFile, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }
  return new Response(MISSING_BUNDLE_HTML, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

const MISSING_BUNDLE_HTML = `<!doctype html>
<meta charset="utf-8">
<title>PrixmaViz</title>
<style>body{font:14px/1.5 system-ui;padding:2rem;max-width:42rem;margin:0 auto;color:#222}code{background:#f1f1f1;padding:.1em .35em;border-radius:4px}</style>
<h1>PrixmaViz server up</h1>
<p>Web bundle not found at <code>${WEB_DIST}</code>.</p>
<p>Run <code>bun --filter @prixmaviz/web build</code> or start the web dev server.</p>
<p>API: <code>POST /api/render</code> · WS: <code>/ws</code></p>
`;

type WSData = { id: string };

const sockets = new Set<Bun.ServerWebSocket<WSData>>();

function broadcast(msg: ServerToClient) {
  const data = JSON.stringify(msg);
  for (const s of sockets) s.send(data);
}

const server = Bun.serve<WSData, undefined>({
  port: PORT,
  async fetch(req, srv) {
    const url = new URL(req.url);

    if (url.pathname === "/ws") {
      const ok = srv.upgrade(req, { data: { id: crypto.randomUUID() } });
      return ok ? undefined : new Response("upgrade failed", { status: 400 });
    }

    if (url.pathname === "/api/health") {
      return Response.json({ ok: true, kroki: process.env.KROKI_URL ?? "https://kroki.io" });
    }

    if (url.pathname === "/api/render" && req.method === "POST") {
      const body = (await req.json()) as { id?: string; engine: string; source: string; format?: string };
      const id = body.id ?? crypto.randomUUID();
      const res = await renderViaKroki({
        id,
        engine: body.engine as never,
        source: body.source,
        format: (body.format as never) ?? "svg",
      });
      broadcast({ type: "render", res });
      return Response.json(res);
    }

    if (url.pathname.startsWith("/api/annotations/") && req.method === "GET") {
      const diagramId = url.pathname.slice("/api/annotations/".length);
      return Response.json(getAnnotations(diagramId));
    }

    if (req.method === "GET") {
      return serveStatic(url.pathname === "/" ? "/index.html" : url.pathname);
    }

    return new Response("not found", { status: 404 });
  },
  websocket: {
    open(ws) {
      sockets.add(ws);
    },
    close(ws) {
      sockets.delete(ws);
    },
    async message(ws, raw) {
      let msg: ClientToServer;
      try {
        msg = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
      } catch {
        return;
      }
      if (msg.type === "render") {
        const res = await renderViaKroki(msg.req);
        broadcast({ type: "render", res });
      } else if (msg.type === "annotate") {
        const list = addAnnotation(msg.annotation);
        broadcast({ type: "annotations", diagramId: msg.annotation.diagramId, annotations: list });
      } else if (msg.type === "clear") {
        clearAnnotations(msg.diagramId);
        broadcast({ type: "annotations", diagramId: msg.diagramId, annotations: [] });
      }
    },
  },
});

const bundleStatus = existsSync(WEB_DIST) ? "found" : "missing";
console.log(`prixmaviz server :${server.port}  web=${WEB_DIST} (${bundleStatus})`);
