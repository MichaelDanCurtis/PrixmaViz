import type {
  ApplyPatchResponse, CreateDiagramRequest, CreateDiagramResponse,
  DiagramEngine, DiagramId, LibraryEntry, PatchOp, RenderDslRequest, RenderDslResponse,
} from "@prixmaviz/shared";

const WORKSPACE_KEY = "prixmaviz_workspace";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(s: string | null | undefined): s is string {
  return !!s && UUID_RE.test(s);
}

/**
 * Returns the active workspace UUID, or null if not bootstrapped yet.
 * Reads from localStorage; does NOT bootstrap a new workspace.
 */
export function getWorkspaceId(): string | null {
  try {
    const v = localStorage.getItem(WORKSPACE_KEY);
    return isUuid(v) ? v.toLowerCase() : null;
  } catch {
    return null;
  }
}

export function setWorkspaceId(id: string): void {
  try { localStorage.setItem(WORKSPACE_KEY, id.toLowerCase()); } catch {}
}

export function clearWorkspaceId(): void {
  try { localStorage.removeItem(WORKSPACE_KEY); } catch {}
}

/**
 * Returns the workspace UUID, bootstrapping one if necessary.
 * Also honors URL deeplinks of the form `/w/<uuid>` — if the URL contains a
 * workspace UUID, that is preferred over (and overrides) localStorage.
 */
export async function ensureWorkspaceId(): Promise<string> {
  // 1. URL deeplink (highest precedence)
  const m = /^\/w\/([0-9a-f-]{36})(?:\/|$)/i.exec(window.location.pathname);
  if (m && isUuid(m[1])) {
    const id = m[1]!.toLowerCase();
    setWorkspaceId(id);
    return id;
  }
  // 2. localStorage
  const existing = getWorkspaceId();
  if (existing) return existing;
  // 3. Bootstrap a new workspace on the server
  const res = await fetch("/api/workspaces", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    throw new Error(`bootstrap workspace failed: HTTP ${res.status}`);
  }
  const json = await res.json() as { id: string };
  if (!isUuid(json.id)) throw new Error("server returned malformed workspace id");
  setWorkspaceId(json.id);
  return json.id.toLowerCase();
}

/**
 * Wraps fetch() to inject `Authorization: Bearer <workspaceId>` on every
 * `/api/*` call (except the bootstrap POST /api/workspaces itself).
 *
 * Public `/api/public/*` and the bootstrap route are exempt.
 *
 * On 401, the cached workspace UUID is treated as stale (server may have
 * reaped it). The function clears it, bootstraps a fresh workspace, and
 * retries the original request ONCE with the new token. Non-401 errors are
 * returned as-is; a second 401 also returns as-is.
 *
 * Limitation: the retry re-sends `init.body` verbatim. For string/Blob/
 * ArrayBuffer bodies this is fine. A `ReadableStream` body is single-shot
 * and the retry would fail — Cycle 4 only sends JSON-string bodies, so
 * this is not a current concern.
 */
export async function authFetch(input: string, init?: RequestInit): Promise<Response> {
  const isApi = input.startsWith("/api/");
  const isPublic = input.startsWith("/api/public/");
  const isBootstrap = input === "/api/workspaces" && (init?.method === "POST" || !init?.method);
  if (!isApi || isPublic || isBootstrap) {
    return fetch(input, init);
  }
  const id = getWorkspaceId();
  const headers = new Headers(init?.headers);
  if (id) headers.set("Authorization", `Bearer ${id}`);
  const res = await fetch(input, { ...init, headers });
  if (res.status !== 401) return res;
  // Stale workspace UUID — drop it, bootstrap a fresh one, retry exactly once.
  clearWorkspaceId();
  let freshId: string;
  try {
    freshId = await ensureWorkspaceId();
  } catch {
    return res;
  }
  const retryHeaders = new Headers(init?.headers);
  retryHeaders.set("Authorization", `Bearer ${freshId}`);
  return fetch(input, { ...init, headers: retryHeaders });
}

export async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

export const api = {
  health: () => authFetch("/api/health").then((r) => r.json()),

  library: () =>
    authFetch("/api/library")
      .then((r) => jsonOrThrow<{ entries: LibraryEntry[] }>(r))
      .then((j) => j.entries),

  createDiagram: (req: CreateDiagramRequest) =>
    authFetch("/api/diagrams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    }).then((r) => jsonOrThrow<CreateDiagramResponse>(r)),

  patch: (diagramId: DiagramId, ops: PatchOp[]) =>
    authFetch(`/api/diagrams/${diagramId}/patch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ops }),
    }).then((r) => jsonOrThrow<ApplyPatchResponse>(r)),

  loadBySlug: (slug: string) =>
    authFetch(`/api/diagrams/${encodeURIComponent(slug)}/load`, { method: "POST" })
      .then((r) => jsonOrThrow<ApplyPatchResponse & { dsl?: string }>(r)),

  save: (diagramId: DiagramId, body: { name?: string; tags?: string[] }) =>
    authFetch(`/api/diagrams/${diagramId}/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => jsonOrThrow<{ path: string; slug: string }>(r)),

  renderDsl: (req: RenderDslRequest) =>
    authFetch("/api/render-dsl", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    }).then((r) => jsonOrThrow<RenderDslResponse>(r)),

  listAnnotations: (diagramId: string) =>
    authFetch(`/api/diagrams/${encodeURIComponent(diagramId)}/annotations`)
      .then((r) => jsonOrThrow<{ annotations: import("@prixmaviz/shared").Annotation[] }>(r))
      .then((j) => j.annotations),

  createAnnotation: (body: {
    diagramId: string;
    kind: "tag" | "region" | "pin";
    text?: string;
    bboxPixel?: { x: number; y: number; w: number; h: number };
    point?: { x: number; y: number };
  }) =>
    authFetch("/api/annotations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => jsonOrThrow<{ annotation: import("@prixmaviz/shared").Annotation }>(r))
      .then((j) => j.annotation),

  updateAnnotationApi: (annotationId: string, body: { diagramId: string; patch: Partial<import("@prixmaviz/shared").Annotation> }) =>
    authFetch(`/api/annotations/${encodeURIComponent(annotationId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => jsonOrThrow<{ annotation: import("@prixmaviz/shared").Annotation }>(r))
      .then((j) => j.annotation),

  deleteAnnotation: (annotationId: string, diagramId: string) =>
    authFetch(`/api/annotations/${encodeURIComponent(annotationId)}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ diagramId }),
    }).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    }),

  getWorkspace: () =>
    authFetch("/api/workspace")
      .then((r) => jsonOrThrow<import("@prixmaviz/shared").Workspace>(r)),

  setCamera: (camera: import("@prixmaviz/shared").Camera) =>
    authFetch("/api/workspace/camera", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(camera),
    }).then((r) => jsonOrThrow<import("@prixmaviz/shared").Workspace>(r)),

  createTile: (body: { diagramId: string; diagramSlug: string; x?: number; y?: number; w?: number; h?: number }) =>
    authFetch("/api/tiles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => jsonOrThrow<{ tile: import("@prixmaviz/shared").Tile }>(r)),

  patchTile: (tileId: string, body: Partial<{ x: number; y: number; w: number; h: number; z: number }>) =>
    authFetch(`/api/tiles/${encodeURIComponent(tileId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => jsonOrThrow<{ tile: import("@prixmaviz/shared").Tile }>(r)),

  deleteTile: (tileId: string) =>
    authFetch(`/api/tiles/${encodeURIComponent(tileId)}`, { method: "DELETE" })
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }),

  getSettings: () =>
    authFetch("/api/settings").then((r) => jsonOrThrow<{ krokiUrl: string }>(r)),

  setSettings: (settings: { krokiUrl: string }) =>
    authFetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    }).then((r) => jsonOrThrow<{ krokiUrl: string }>(r)),

  testKrokiConnection: (url: string) =>
    authFetch("/api/settings/test-kroki", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    }).then((r) => r.json() as Promise<{ ok: boolean; status?: unknown; error?: string }>),

  setDiagramVisibility: (id: string, isPublic: boolean) =>
    authFetch(`/api/diagrams/${encodeURIComponent(id)}/visibility`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ public: isPublic }),
    }).then((r) => jsonOrThrow<{ public: boolean; publicUrl?: string }>(r)),

  // Issue #7 Wave 2: toggle the pinned flag on a diagram. The server's
  // dbSetPinned helper writes the value verbatim (it's a SET, not a toggle),
  // so the caller passes the desired final state. Returns the new pinned
  // value so the optimistic UI can confirm the server agrees.
  setPinned: (id: string, pinned: boolean) =>
    authFetch(`/api/diagrams/${encodeURIComponent(id)}/pin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pinned }),
    }).then((r) => jsonOrThrow<{ pinned: boolean }>(r)),

  // Issue #6: inline editor + version history.
  // getSource is GET-side (no render); updateSource and restoreVersion both
  // re-render. updateSource returns 502 with `{ error, source }` when the
  // user's text fails to parse/render — the editor preserves the text and
  // shows the error inline (the prior good SVG/DSL is untouched).
  getSource: (id: string) =>
    authFetch(`/api/diagrams/${encodeURIComponent(id)}/source`)
      .then((r) => jsonOrThrow<{
        id: string; engine: string; kind: string; source: string;
      }>(r)),

  updateSource: async (id: string, source: string): Promise<
    | { ok: true; source: string; svg: string; warnings: string[] }
    | { ok: false; error: string; source: string }
  > => {
    const res = await authFetch(`/api/diagrams/${encodeURIComponent(id)}/source`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source }),
    });
    if (res.ok) {
      const body = await res.json() as {
        diagramId: string; source: string;
        render: { svg: string; dsl: string };
        warnings?: string[];
      };
      return { ok: true, source: body.source, svg: body.render.svg, warnings: body.warnings ?? [] };
    }
    const body = await res.json().catch(() => ({})) as { error?: string; source?: string };
    return { ok: false, error: body.error ?? `HTTP ${res.status}`, source: body.source ?? source };
  },

  listVersions: (id: string) =>
    authFetch(`/api/diagrams/${encodeURIComponent(id)}/versions`)
      .then((r) => jsonOrThrow<{
        versions: Array<{
          id: string; engine: string; kind: string;
          source: string | null; createdAt: string;
        }>;
      }>(r))
      .then((j) => j.versions),

  restoreVersion: (diagramId: string, versionId: string) =>
    authFetch(
      `/api/diagrams/${encodeURIComponent(diagramId)}/versions/${encodeURIComponent(versionId)}/restore`,
      { method: "POST" },
    ).then((r) => jsonOrThrow<{
      diagramId: string; source: string; render: { svg: string; dsl: string };
    }>(r)),

  // ─── Issue #7 — folders / move / pin / meta ──────────────────────────
  moveDiagram: (id: string, parentPath: string) =>
    authFetch(`/api/diagrams/${encodeURIComponent(id)}/move`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parentPath }),
    }).then((r) => jsonOrThrow<{ ok: true; parentPath: string }>(r)),

  emptyFolder: (path: string, action: "add" | "remove") =>
    authFetch("/api/folders/empty", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, action }),
    }).then((r) => jsonOrThrow<{ emptyFolders: string[] }>(r)),

  renameFolder: (from: string, to: string) =>
    authFetch("/api/folders/rename", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from, to }),
    }).then((r) => jsonOrThrow<{ affected: number }>(r)),

  deleteFolder: (path: string, cascade: boolean) =>
    authFetch("/api/folders/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, cascade }),
    }).then((r) => jsonOrThrow<{ deleted: number }>(r)),

  // ─── Issue #7 Wave 2 — search / tags / metadata ─────────────────────
  searchDiagrams: (params: {
    q?: string;
    parentPath?: string;
    tags?: string[];
    engines?: string[];
    sort?: "relevance" | "updated" | "created" | "name";
    limit?: number;
  }) => {
    const sp = new URLSearchParams();
    if (params.q) sp.set("q", params.q);
    if (params.parentPath !== undefined) sp.set("parent_path", params.parentPath);
    if (params.tags && params.tags.length) sp.set("tags", params.tags.join(","));
    if (params.engines && params.engines.length) sp.set("engines", params.engines.join(","));
    if (params.sort) sp.set("sort", params.sort);
    if (params.limit !== undefined) sp.set("limit", String(params.limit));
    const qs = sp.toString();
    return authFetch(`/api/diagrams/search${qs ? `?${qs}` : ""}`).then((r) =>
      jsonOrThrow<{
        results: Array<{
          slug: string;
          name: string;
          engine: string;
          tags: string[];
          updatedAt: string;
          createdAt: string;
          snippet?: string;
          score?: number;
        }>;
      }>(r),
    );
  },

  listTags: () =>
    authFetch("/api/diagrams/tags").then((r) =>
      jsonOrThrow<{ tags: string[] }>(r),
    ).then((j) => j.tags),

  updateDiagramMeta: (
    diagramId: string,
    patch: { description?: string; author?: string; notes?: string },
  ) =>
    authFetch(`/api/diagrams/${encodeURIComponent(diagramId)}/meta`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).then((r) => jsonOrThrow<{ meta: import("@prixmaviz/shared").DiagramMeta }>(r)),

  // ─── Issue #8 Wave 1A — share-link management ───────────────────────
  // Create / list / revoke endpoints registered by the server in Wave 1.
  // The token is opaque ("s_" + 32 hex). `url` is the absolute public URL
  // assembled server-side from PRIXMAVIZ_PUBLIC_URL — the UI should display
  // it verbatim. expiresAt is an ISO-8601 string (or null for no expiry).
  createShareLink: (
    diagramId: string,
    body: { permission: "view" | "comment" | "edit"; expiresAt?: string | null },
  ) =>
    authFetch(`/api/diagrams/${encodeURIComponent(diagramId)}/shares`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => jsonOrThrow<{ token: string; url: string }>(r)),

  listShareLinks: (diagramId: string) =>
    authFetch(`/api/diagrams/${encodeURIComponent(diagramId)}/shares`).then((r) =>
      jsonOrThrow<{
        links: Array<{
          id: string;
          token: string;
          permission: "view" | "comment" | "edit";
          expiresAt: string | null;
          createdAt: string;
          url: string;
        }>;
      }>(r),
    ),

  revokeShareLink: (token: string) =>
    authFetch(`/api/shares/${encodeURIComponent(token)}`, { method: "DELETE" }).then((r) =>
      jsonOrThrow<{ ok: true }>(r),
    ),
};
