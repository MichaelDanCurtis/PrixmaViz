---
name: diagram-evolve
description: Use when the user has just added annotations to a diagram and is implicitly or explicitly asking for the diagram to be changed based on those marks — phrases like "fix this", "apply my notes", "make those changes", "address what I marked". Triggers on evolve/apply intent against an annotated tile.
---

# Diagram Evolution

When the user has annotations on the focused tile and wants you to apply them:

1. Call `get_focused_tile()` for the diagramId.
2. Call `get_annotations(diagramId, includeResolved=false)` for unresolved annotations only.
3. Read each annotation's `text` field and its `targetNodes`/`bboxData`/`point`. Infer the user's intent:
   - "rename to X" → IR `update_node` patch on the target with new label
   - "remove this" → IR `remove_node` or `remove_edge` patch
   - "this should connect to Y" → IR `add_edge` patch
   - "add a retry path" → engine-specific structural change
   - "use a different shape" → IR `update_node` with new `shape`
4. Suggest 1-3 patches: "I'll rename Auth to AuthService, add a retry path from Auth to DB, and remove the orphan Logger node — apply?"
5. On user confirmation, call `apply_patch` with all the ops in one call (atomic).
6. After patches land, call `annotations.update(annotationId, {resolvedAt: now})` for each annotation that was addressed — so they fade visually and don't show up as unresolved next time.

If you can't infer the user's intent from an annotation's text, ASK rather than guessing. Wrong patches are harder to undo than no patches.
