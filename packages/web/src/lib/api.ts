import type {
  ApplyPatchResponse, CreateDiagramRequest, CreateDiagramResponse,
  DiagramEngine, DiagramId, LibraryEntry, PatchOp, RenderDslRequest, RenderDslResponse,
} from "@prixmaviz/shared";

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

export const api = {
  health: () => fetch("/api/health").then((r) => r.json()),

  library: () =>
    fetch("/api/library")
      .then((r) => jsonOrThrow<{ entries: LibraryEntry[] }>(r))
      .then((j) => j.entries),

  createDiagram: (req: CreateDiagramRequest) =>
    fetch("/api/diagrams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    }).then((r) => jsonOrThrow<CreateDiagramResponse>(r)),

  patch: (diagramId: DiagramId, ops: PatchOp[]) =>
    fetch(`/api/diagrams/${diagramId}/patch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ops }),
    }).then((r) => jsonOrThrow<ApplyPatchResponse>(r)),

  loadBySlug: (slug: string) =>
    fetch(`/api/diagrams/${encodeURIComponent(slug)}/load`, { method: "POST" })
      .then((r) => jsonOrThrow<ApplyPatchResponse & { dsl?: string }>(r)),

  save: (diagramId: DiagramId, body: { name?: string; tags?: string[] }) =>
    fetch(`/api/diagrams/${diagramId}/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => jsonOrThrow<{ path: string; slug: string }>(r)),

  renderDsl: (req: RenderDslRequest) =>
    fetch("/api/render-dsl", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    }).then((r) => jsonOrThrow<RenderDslResponse>(r)),

  listAnnotations: (diagramId: string) =>
    fetch(`/api/diagrams/${encodeURIComponent(diagramId)}/annotations`)
      .then((r) => jsonOrThrow<{ annotations: import("@prixmaviz/shared").Annotation[] }>(r))
      .then((j) => j.annotations),

  createAnnotation: (body: {
    diagramId: string;
    kind: "tag" | "region" | "pin";
    text?: string;
    bboxPixel?: { x: number; y: number; w: number; h: number };
    point?: { x: number; y: number };
  }) =>
    fetch("/api/annotations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => jsonOrThrow<{ annotation: import("@prixmaviz/shared").Annotation }>(r))
      .then((j) => j.annotation),

  updateAnnotationApi: (annotationId: string, body: { diagramId: string; patch: Partial<import("@prixmaviz/shared").Annotation> }) =>
    fetch(`/api/annotations/${encodeURIComponent(annotationId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => jsonOrThrow<{ annotation: import("@prixmaviz/shared").Annotation }>(r))
      .then((j) => j.annotation),

  deleteAnnotation: (annotationId: string, diagramId: string) =>
    fetch(`/api/annotations/${encodeURIComponent(annotationId)}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ diagramId }),
    }).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    }),

  getWorkspace: () =>
    fetch("/api/workspace")
      .then((r) => jsonOrThrow<import("@prixmaviz/shared").WorkspaceState>(r)),

  setCamera: (camera: import("@prixmaviz/shared").Camera) =>
    fetch("/api/workspace/camera", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(camera),
    }).then((r) => jsonOrThrow<import("@prixmaviz/shared").WorkspaceState>(r)),

  createTile: (body: { diagramId: string; diagramSlug: string; x?: number; y?: number; w?: number; h?: number }) =>
    fetch("/api/tiles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => jsonOrThrow<{ tile: import("@prixmaviz/shared").Tile }>(r)),

  patchTile: (tileId: string, body: Partial<{ x: number; y: number; w: number; h: number; z: number }>) =>
    fetch(`/api/tiles/${encodeURIComponent(tileId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => jsonOrThrow<{ tile: import("@prixmaviz/shared").Tile }>(r)),

  deleteTile: (tileId: string) =>
    fetch(`/api/tiles/${encodeURIComponent(tileId)}`, { method: "DELETE" })
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }),

  getSettings: () =>
    fetch("/api/settings").then((r) => jsonOrThrow<{ krokiUrl: string }>(r)),

  setSettings: (settings: { krokiUrl: string }) =>
    fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    }).then((r) => jsonOrThrow<{ krokiUrl: string }>(r)),

  testKrokiConnection: (url: string) =>
    fetch("/api/settings/test-kroki", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    }).then((r) => r.json() as Promise<{ ok: boolean; status?: unknown; error?: string }>),
};
