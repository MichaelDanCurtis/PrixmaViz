export type ExportFormat = "svg" | "png" | "jpeg";

export async function svgToBlob(svgString: string, format: ExportFormat): Promise<Blob> {
  if (format === "svg") {
    return new Blob([svgString], { type: "image/svg+xml" });
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
  const ext = format === "jpeg" ? "jpg" : format;
  return `${slug}.${ext}`;
}
