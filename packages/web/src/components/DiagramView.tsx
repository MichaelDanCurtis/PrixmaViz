import { motion, AnimatePresence } from "motion/react";
import { useMemo } from "react";

export function DiagramView({ svg, diagramId }: { svg: string; diagramId: string }) {
  const html = useMemo(() => svg, [svg]);
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={`${diagramId}-${html.length}`}
        className="diagram"
        initial={{ opacity: 0, y: 8, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, scale: 0.985 }}
        transition={{ type: "spring", stiffness: 240, damping: 26 }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </AnimatePresence>
  );
}
