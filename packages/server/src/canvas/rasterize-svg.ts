/**
 * Server-side SVG → raster conversion via the `rsvg-convert` CLI.
 *
 * Extracted from packages/server/src/renderers/vsdx-writer-fallback.ts so
 * the workspace-snapshot path (Group D / Issue #5) can reuse the same
 * rasterization plumbing without taking a dependency on the vsdx
 * fallback writer.
 *
 * rsvg-convert is shipped in the production Docker image (Dockerfile:
 * `apk add --no-cache librsvg`) and is available in local dev when
 * librsvg2 is installed. It supports png/pdf/svg as output formats but
 * NOT jpeg — callers that want jpeg should rasterize to png and convert
 * downstream, or surface a warning that png is being returned in jpeg's
 * place.
 */

// Hard cap on how long rsvg-convert may run before we kill it. A
// pathological SVG (deeply nested groups, huge filter chains) can hang
// indefinitely otherwise. Same default + env override as the vsdx
// fallback writer so operators only tune one knob.
const RSVG_TIMEOUT_MS = Number(process.env.PRIXMAVIZ_RSVG_TIMEOUT_MS) || 15_000;

export type RasterFormat = "png" | "pdf" | "svg";

/**
 * Pipe the supplied SVG through `rsvg-convert -f <format>` and return
 * the resulting bytes. Throws on timeout / non-zero exit; the caller
 * decides whether to surface the failure as a tool error or fall back
 * to returning the SVG unchanged.
 *
 * The conversion is synchronous from the caller's POV (one process per
 * call). Parallel callers spawn parallel processes — there's no shared
 * lock — but the hard timeout keeps any single conversion bounded.
 */
export async function rasterizeSvg(
  svg: string,
  format: RasterFormat = "png",
): Promise<Uint8Array> {
  const signal = AbortSignal.timeout(RSVG_TIMEOUT_MS);
  const proc = Bun.spawn(["rsvg-convert", "-f", format], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    signal,
  });
  let stdout: ArrayBuffer;
  let stderr: string;
  let exit: number;
  try {
    proc.stdin.write(svg);
    await proc.stdin.end();
    [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).arrayBuffer(),
      new Response(proc.stderr).text(),
    ]);
    exit = await proc.exited;
  } catch (e) {
    if (signal.aborted) {
      throw new Error(`rsvg-convert timed out after ${RSVG_TIMEOUT_MS}ms`);
    }
    if (
      e instanceof Error &&
      (e.name === "AbortError" || /aborted|timed out/i.test(e.message))
    ) {
      throw new Error(`rsvg-convert timed out after ${RSVG_TIMEOUT_MS}ms`);
    }
    throw e;
  }
  if (signal.aborted) {
    throw new Error(`rsvg-convert timed out after ${RSVG_TIMEOUT_MS}ms`);
  }
  if (exit !== 0) {
    throw new Error(`rsvg-convert failed: ${stderr.slice(0, 200)}`);
  }
  return new Uint8Array(stdout);
}
