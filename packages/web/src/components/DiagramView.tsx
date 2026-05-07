import { motion, AnimatePresence } from "motion/react";
import { useEffect, useRef } from "react";
import { parseSvgNodes } from "../lib/svg-diff";

export function DiagramView({ svg, diagramId }: { svg: string; diagramId: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const prevIdsRef = useRef<string[]>([]);

  useEffect(() => {
    if (!ref.current) return;
    ref.current.innerHTML = svg;
    const root = ref.current.querySelector("svg");
    if (!root) return;

    const ids = parseSvgNodes(svg);
    const prev = new Set(prevIdsRef.current);

    for (const id of ids) {
      const g = root.querySelector(`[id="${id}"]`) as SVGGElement | null;
      if (!g) continue;
      if (!prev.has(id)) {
        g.style.transformOrigin = "center";
        g.animate(
          [
            { opacity: 0, transform: "scale(.85)" },
            { opacity: 1, transform: "scale(1)" },
          ],
          { duration: 280, easing: "cubic-bezier(.25,.46,.45,.94)" },
        );
      }
    }
    prevIdsRef.current = ids;
  }, [svg, diagramId]);

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={diagramId}
        ref={ref}
        className="diagram"
        initial={{ opacity: 0, y: 8, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, scale: 0.985 }}
        transition={{ type: "spring", stiffness: 240, damping: 26 }}
      />
    </AnimatePresence>
  );
}
