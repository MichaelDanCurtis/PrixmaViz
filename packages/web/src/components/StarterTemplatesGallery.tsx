import { useState } from "react";
import { useAppStore } from "../store";
import { api } from "../lib/api";
import { STARTER_TEMPLATES, type StarterTemplate } from "../templates";

interface Props {
  onDismiss: () => void;
}

/**
 * First-run gallery shown when a workspace has zero tiles. Clicking a card
 * creates a real diagram + tile from the template's inline DSL, then
 * dismisses the overlay.
 *
 * Dismiss is permanent for this workspace (stored in localStorage under
 * `prixmaviz_templates_skipped:<workspaceId>`) so users who choose "skip"
 * don't see the gallery again even if they later delete all their tiles.
 * (Once they create their first tile, the empty-state condition no longer
 * holds and the gallery wouldn't show anyway.)
 */
export function StarterTemplatesGallery({ onDismiss }: Props) {
  const workspaceId = useAppStore((s) => s.workspaceId);
  const setDiagram = useAppStore((s) => s.setDiagram);
  const setRender = useAppStore((s) => s.setRender);
  const setError = useAppStore((s) => s.setError);
  const [busy, setBusy] = useState<string | null>(null);

  async function pick(t: StarterTemplate) {
    if (busy) return;
    setBusy(t.slug);
    try {
      // 1) Render the inline DSL → server creates a passthrough diagram and
      //    returns the diagramId + first render.
      const result = await api.renderDsl({
        engine: t.engine,
        source: t.source,
        name: t.name,
      });
      // 2) Drop a tile at the camera center so the user immediately sees it.
      const camera = useAppStore.getState().camera;
      await api.createTile({
        diagramId: result.diagramId,
        diagramSlug: t.slug,
        x: camera.x + 60,
        y: camera.y + 60,
        w: 600, h: 400,
      });
      // 3) Mirror the legacy single-diagram surface so the Library row lights
      //    up and the inline editor (if open) reflects the new diagram.
      setDiagram({
        id: result.diagramId,
        name: t.name,
        engine: t.engine,
        kind: "passthrough",
        dsl: result.render.dsl,
        meta: { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), tags: [], sourcePaths: [] },
      });
      setRender(result.diagramId, result.render.svg, result.render.dsl);
      onDismiss();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  function skipForever() {
    try {
      if (workspaceId) {
        localStorage.setItem(`prixmaviz_templates_skipped:${workspaceId}`, "1");
      }
    } catch {
      // localStorage may be disabled; the user can always dismiss via the X.
    }
    onDismiss();
  }

  return (
    <div className="templates-overlay" data-testid="starter-templates-gallery">
      <div className="templates-panel" onClick={(e) => e.stopPropagation()}>
        <div className="templates-header">
          <div>
            <h2>Start from a template</h2>
            <p>
              Pick a starter to drop on your canvas — you can edit it (or ask
              your AI assistant to edit it) afterwards.
            </p>
          </div>
          <button
            className="templates-close"
            aria-label="Close starter templates"
            onClick={onDismiss}
            type="button"
          >
            ×
          </button>
        </div>
        <div className="templates-grid">
          {STARTER_TEMPLATES.map((t) => (
            <button
              type="button"
              key={t.slug}
              className="template-card"
              data-testid={`template-card-${t.slug}`}
              disabled={busy !== null}
              onClick={() => pick(t)}
            >
              <div className="template-card-title">{t.name}</div>
              <div className="template-card-engine">{t.engine}</div>
              <div className="template-card-desc">{t.description}</div>
              {busy === t.slug && <div className="template-card-busy">Creating…</div>}
            </button>
          ))}
        </div>
        <div className="templates-footer">
          <button
            type="button"
            className="templates-skip"
            onClick={skipForever}
          >
            Skip — start with an empty canvas
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Whether the starter gallery should be considered "permanently dismissed"
 * for the given workspace. Returns false if `workspaceId` is null so the
 * gallery doesn't show during bootstrap.
 */
export function hasSkippedTemplates(workspaceId: string | null): boolean {
  if (!workspaceId) return true;
  try {
    return localStorage.getItem(`prixmaviz_templates_skipped:${workspaceId}`) === "1";
  } catch {
    return false;
  }
}
