import { useEffect, useMemo, useRef, useState } from "react";
import { useAppStore } from "../store";
import { tilesBounds, viewportRect } from "../lib/canvas-math";
import { api } from "../lib/api";

/**
 * Issue #10 — minimap. Renders a small SVG overview in the bottom-right
 * corner. Each tile is a rect; the camera viewport is overlaid as a
 * wireframe. Clicking inside the minimap centers the camera on that point.
 *
 * Constraints from the task:
 *  - < 200×150 px.
 *  - No external deps; everything is plain <svg>.
 *  - Bottom-right placement, non-intrusive.
 *  - Live updates via zustand subscription (free from the React render path).
 */

const MAP_W = 200;
const MAP_H = 140;
const PADDING = 24;

export function Minimap() {
  const tiles = useAppStore((s) => s.tiles);
  const camera = useAppStore((s) => s.camera);
  const setCamera = useAppStore((s) => s.setCamera);
  const visible = useAppStore((s) => s.minimapVisible);
  const setVisible = useAppStore((s) => s.setMinimapVisible);
  const svgRef = useRef<SVGSVGElement>(null);
  const [vw, setVw] = useState<number>(typeof window !== "undefined" ? window.innerWidth : 1024);
  const [vh, setVh] = useState<number>(typeof window !== "undefined" ? window.innerHeight : 768);
  const draggingRef = useRef(false);

  useEffect(() => {
    function onResize() {
      setVw(window.innerWidth);
      setVh(window.innerHeight);
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Compute the world rect to display: union of tiles + current viewport.
  // Padding avoids the "minimap collapses to a single tile" look when there's
  // only one item on the canvas.
  const world = useMemo(() => {
    const tb = tilesBounds(tiles);
    const vp = viewportRect(camera, vw, vh);
    let x0 = vp.x, y0 = vp.y, x1 = vp.x + vp.w, y1 = vp.y + vp.h;
    if (tb) {
      if (tb.x < x0) x0 = tb.x;
      if (tb.y < y0) y0 = tb.y;
      if (tb.x + tb.w > x1) x1 = tb.x + tb.w;
      if (tb.y + tb.h > y1) y1 = tb.y + tb.h;
    }
    return { x: x0 - PADDING, y: y0 - PADDING, w: x1 - x0 + 2 * PADDING, h: y1 - y0 + 2 * PADDING };
  }, [tiles, camera, vw, vh]);

  // Map world coords to minimap pixel coords. Maintain aspect ratio so tiles
  // aren't stretched into wonky shapes.
  const { scale, offX, offY } = useMemo(() => {
    if (world.w <= 0 || world.h <= 0) {
      return { scale: 1, offX: 0, offY: 0 };
    }
    const sx = MAP_W / world.w;
    const sy = MAP_H / world.h;
    const s = Math.min(sx, sy);
    const offX = (MAP_W - world.w * s) / 2;
    const offY = (MAP_H - world.h * s) / 2;
    return { scale: s, offX, offY };
  }, [world]);

  function w2m(x: number, y: number): { x: number; y: number } {
    return { x: (x - world.x) * scale + offX, y: (y - world.y) * scale + offY };
  }

  // Clicking jumps the camera so the viewport is *centered* on the clicked
  // world point. Without the centering offset, the viewport's top-left ends
  // up at the click — which feels off because the cursor target falls
  // outside the visible area.
  function clickToPan(clientX: number, clientY: number) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = clientX - rect.left;
    const my = clientY - rect.top;
    // invert w2m
    const wx = (mx - offX) / scale + world.x;
    const wy = (my - offY) / scale + world.y;
    const cam = {
      x: wx - (vw / camera.zoom) / 2,
      y: wy - (vh / camera.zoom) / 2,
      zoom: camera.zoom,
    };
    setCamera(cam);
    // Persist the camera move so it survives reload.
    void api.setCamera(cam).catch(() => {});
  }

  function onMouseDown(e: React.MouseEvent) {
    e.stopPropagation();
    draggingRef.current = true;
    clickToPan(e.clientX, e.clientY);
    function onMove(ev: MouseEvent) {
      if (!draggingRef.current) return;
      clickToPan(ev.clientX, ev.clientY);
    }
    function onUp() {
      draggingRef.current = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  if (!visible) {
    return (
      <button
        className="minimap-show"
        onClick={() => setVisible(true)}
        title="Show minimap (M)"
        aria-label="Show minimap"
      >
        ▢
      </button>
    );
  }

  const vp = viewportRect(camera, vw, vh);
  const vpA = w2m(vp.x, vp.y);
  const vpW = vp.w * scale;
  const vpH = vp.h * scale;

  return (
    <div className="minimap" role="region" aria-label="Canvas minimap">
      <div className="minimap-header">
        <span>Minimap</span>
        <button
          className="minimap-close"
          onClick={() => setVisible(false)}
          title="Hide minimap (M)"
          aria-label="Hide minimap"
        >
          ×
        </button>
      </div>
      <svg
        ref={svgRef}
        width={MAP_W}
        height={MAP_H}
        className="minimap-svg"
        onMouseDown={onMouseDown}
      >
        <rect x={0} y={0} width={MAP_W} height={MAP_H} className="minimap-bg" />
        {tiles.map((t) => {
          const a = w2m(t.x, t.y);
          return (
            <rect
              key={t.id}
              x={a.x}
              y={a.y}
              width={Math.max(2, t.w * scale)}
              height={Math.max(2, t.h * scale)}
              className="minimap-tile"
            />
          );
        })}
        <rect
          x={vpA.x}
          y={vpA.y}
          width={Math.max(2, vpW)}
          height={Math.max(2, vpH)}
          className="minimap-viewport"
        />
      </svg>
    </div>
  );
}
