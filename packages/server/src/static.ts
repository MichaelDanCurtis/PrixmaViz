import { join, normalize, resolve } from "node:path";
import { EMBEDDED } from "./embedded";

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

export interface StaticDeps {
  webDist: string;
  fallbackHtml: string;
}

export async function serveStatic(pathname: string, deps: StaticDeps): Promise<Response> {
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
  const full = resolve(deps.webDist, rel);
  if (!full.startsWith(deps.webDist)) return new Response("forbidden", { status: 403 });
  const file = Bun.file(full);
  if (await file.exists()) {
    return new Response(file, { headers: { "Content-Type": mimeFor(full) } });
  }
  const indexFile = Bun.file(join(deps.webDist, "index.html"));
  if (await indexFile.exists()) {
    return new Response(indexFile, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  return new Response(deps.fallbackHtml, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
