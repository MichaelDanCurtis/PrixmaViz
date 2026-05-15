import { authFetch } from "./api";

export type ExportFormat = "svg" | "png" | "jpeg" | "vsdx";

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
