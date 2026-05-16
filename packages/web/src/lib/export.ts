import { authFetch, api } from "./api";
import { buildStoreZip } from "./zip";

export type ExportFormat = "svg" | "png" | "jpeg" | "vsdx";
export type BulkPackaging = "individual" | "zip";

export async function svgToBlob(svgString: string, format: ExportFormat): Promise<Blob> {
  if (format === "svg") {
    return new Blob([svgString], { type: "image/svg+xml" });
  }
  if (format === "vsdx") {
    throw new Error("svgToBlob does not support vsdx; use downloadDiagramAs instead");
  }
  const blob = new Blob([svgString], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImage(url);
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth || 800;
    canvas.height = img.naturalHeight || 600;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("could not get 2d context");
    if (format === "jpeg") {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(img, 0, 0);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("toBlob returned null"))),
        format === "png" ? "image/png" : "image/jpeg",
        format === "jpeg" ? 0.92 : undefined
      );
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image load failed"));
    img.src = src;
  });
}

export function getExportFilename(slug: string, format: ExportFormat): string {
  if (format === "vsdx") return `${slug}.vsdx`;
  const ext = format === "jpeg" ? "jpg" : format;
  return `${slug}.${ext}`;
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Download a diagram in the requested format. For svg/png/jpeg, converts in
 * the browser from the rendered SVG. For vsdx, fetches the server endpoint
 * which assembles the .vsdx file from the diagram's IR/bytes/SVG depending
 * on the engine kind.
 */
export async function downloadDiagramAs(
  diagramId: string,
  slug: string,
  format: ExportFormat,
  svgString: string,
): Promise<void> {
  let blob: Blob;
  if (format === "vsdx") {
    const res = await authFetch(`/api/diagrams/${diagramId}/export.vsdx`);
    if (!res.ok) throw new Error("vsdx export failed");
    blob = await res.blob();
  } else {
    blob = await svgToBlob(svgString, format);
  }
  triggerDownload(blob, getExportFilename(slug, format));
}

/**
 * Issue #2: fetch a single diagram in the requested format and return the
 * blob + suggested filename. Mirrors `downloadDiagramAs` but doesn't trigger
 * a download — used to assemble the bytes for either individual downloads or
 * a single zipped bundle.
 *
 * SVG/PNG/JPEG: same pipeline as the single-tile export — fetch the cached
 * SVG via `/api/library/<slug>/thumb` (server-side rendered, no Kroki from the
 * browser), then convert in-browser for raster formats. For VSDX we need a
 * diagramId, which `LibraryEntry` doesn't carry — caller resolves via
 * `api.loadBySlug(slug)`.
 */
export async function fetchDiagramExport(
  slug: string,
  format: ExportFormat,
): Promise<{ blob: Blob; filename: string }> {
  let blob: Blob;
  if (format === "vsdx") {
    // Resolve diagramId for the slug. `loadBySlug` is idempotent and cheap
    // (returns the cached IR+SVG without re-rendering when nothing changed).
    const loaded = await api.loadBySlug(slug);
    const res = await authFetch(`/api/diagrams/${loaded.diagramId}/export.vsdx`);
    if (!res.ok) throw new Error(`vsdx export failed for ${slug}: HTTP ${res.status}`);
    blob = await res.blob();
  } else {
    const res = await authFetch(`/api/library/${encodeURIComponent(slug)}/thumb`);
    if (!res.ok) throw new Error(`fetch svg failed for ${slug}: HTTP ${res.status}`);
    const svgString = await res.text();
    blob = await svgToBlob(svgString, format);
  }
  return { blob, filename: getExportFilename(slug, format) };
}

/**
 * Disambiguate filename collisions inside a bundle (e.g. two `untitled`
 * diagrams with different slugs would both resolve to `untitled.png`).
 * Slugs are presumed unique at the server level, but stay defensive.
 */
function uniqueFilename(seen: Set<string>, candidate: string): string {
  if (!seen.has(candidate)) {
    seen.add(candidate);
    return candidate;
  }
  const dot = candidate.lastIndexOf(".");
  const stem = dot === -1 ? candidate : candidate.slice(0, dot);
  const ext = dot === -1 ? "" : candidate.slice(dot);
  for (let n = 2; n < 10000; n++) {
    const next = `${stem}-${n}${ext}`;
    if (!seen.has(next)) {
      seen.add(next);
      return next;
    }
  }
  // Astronomically unlikely. Fall back to timestamp suffix.
  const fallback = `${stem}-${Date.now()}${ext}`;
  seen.add(fallback);
  return fallback;
}

function zipBundleName(): string {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  const ts = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return `prixmaviz-export-${ts}.zip`;
}

export interface BulkExportProgress {
  /** 1-based index of the item just completed (or that just errored). */
  completed: number;
  /** Total items being exported. */
  total: number;
  /** Slug of the item just processed. */
  slug: string;
  /** Error message if the item failed; undefined on success. */
  error?: string;
}

export interface BulkExportResult {
  successCount: number;
  failureCount: number;
  errors: { slug: string; message: string }[];
}

/**
 * Issue #2: export N diagrams in one gesture, either as N individual downloads
 * or as a single .zip bundle.
 *
 * The "individual" path debounces between `<a download>` clicks because
 * Chromium throttles back-to-back download triggers (after the first few it
 * pops up a "Allow site to download multiple files?" prompt regardless). A
 * small delay between clicks keeps the UI from feeling locked.
 *
 * Failures on a single diagram do NOT abort the batch. The result aggregates
 * per-slug errors so the caller can surface a toast like "exported 18/20 —
 * 2 failed".
 */
export async function exportBulk(
  slugs: string[],
  format: ExportFormat,
  packaging: BulkPackaging,
  onProgress?: (p: BulkExportProgress) => void,
): Promise<BulkExportResult> {
  const errors: { slug: string; message: string }[] = [];
  let successCount = 0;

  if (packaging === "zip") {
    const files: { name: string; bytes: Uint8Array }[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < slugs.length; i++) {
      const slug = slugs[i]!;
      try {
        const { blob, filename } = await fetchDiagramExport(slug, format);
        const bytes = new Uint8Array(await blob.arrayBuffer());
        files.push({ name: uniqueFilename(seen, filename), bytes });
        successCount++;
        onProgress?.({ completed: i + 1, total: slugs.length, slug });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        errors.push({ slug, message });
        onProgress?.({ completed: i + 1, total: slugs.length, slug, error: message });
      }
    }
    if (files.length > 0) {
      const zipBytes = buildStoreZip(files);
      // Cast to BlobPart — newer TS lib.dom narrows `BlobPart` to
      // ArrayBuffer (not ArrayBufferLike), so a Uint8Array fails strict
      // checks even though Blob accepts it at runtime.
      const zipBlob = new Blob([zipBytes as unknown as BlobPart], { type: "application/zip" });
      triggerDownload(zipBlob, zipBundleName());
    }
  } else {
    // Individual mode — sequential with a short delay between downloads.
    for (let i = 0; i < slugs.length; i++) {
      const slug = slugs[i]!;
      try {
        const { blob, filename } = await fetchDiagramExport(slug, format);
        triggerDownload(blob, filename);
        successCount++;
        onProgress?.({ completed: i + 1, total: slugs.length, slug });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        errors.push({ slug, message });
        onProgress?.({ completed: i + 1, total: slugs.length, slug, error: message });
      }
      // Small pause between downloads so Chromium doesn't drop later anchors.
      // Skipped after the final item — no point delaying the resolution.
      if (i < slugs.length - 1) await new Promise((r) => setTimeout(r, 120));
    }
  }

  return { successCount, failureCount: errors.length, errors };
}
