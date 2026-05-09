import { useEffect, useRef, useState } from "react";
import type { Annotation, DiagramId } from "@prixmaviz/shared";
import { api } from "../lib/api";
import { useAppStore } from "../store";

interface Props {
  diagramId: DiagramId;
  annotation: Annotation;
  anchor: { x: number; y: number };
  onClose: () => void;
}

export function CommentPopup({ diagramId, annotation, anchor, onClose }: Props) {
  const [text, setText] = useState(annotation.text ?? "");
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  async function save() {
    try {
      const updated = await api.updateAnnotationApi(annotation.id, { diagramId, patch: { text } });
      useAppStore.getState().updateAnnotation(diagramId, updated);
      onClose();
    } catch (e) {
      useAppStore.getState().setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function resolve() {
    try {
      const updated = await api.updateAnnotationApi(annotation.id, {
        diagramId,
        patch: { resolvedAt: new Date().toISOString() },
      });
      useAppStore.getState().updateAnnotation(diagramId, updated);
      onClose();
    } catch (e) {
      useAppStore.getState().setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function del() {
    try {
      await api.deleteAnnotation(annotation.id, diagramId);
      useAppStore.getState().deleteAnnotation(diagramId, annotation.id);
      onClose();
    } catch (e) {
      useAppStore.getState().setError(e instanceof Error ? e.message : String(e));
    }
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "Escape") { e.preventDefault(); onClose(); }
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); save(); }
  }

  return (
    <div
      className="comment-popup"
      style={{ left: anchor.x + 12, top: anchor.y + 12 }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <textarea
        ref={ref}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
        rows={3}
        placeholder="Comment…"
      />
      <div className="comment-actions">
        <button className="primary" onClick={save}>Save</button>
        <button onClick={resolve}>Resolve</button>
        <button onClick={del}>Delete</button>
      </div>
    </div>
  );
}
