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
 */
function authFetch(input: string, init?: RequestInit): Promise<Response> {
  const isApi = input.startsWith("/api/");
  const isPublic = input.startsWith("/api/public/");
  const isBootstrap = input === "/api/workspaces" && (init?.method === "POST" || !init?.method);
  if (!isApi || isPublic || isBootstrap) {
    return fetch(input, init);
  }
  const id = getWorkspaceId();
  const headers = new Headers(init?.headers);
  if (id) headers.set("Authorization", `Bearer ${id}`);
  return fetch(input, { ...init, headers });
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
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
};
