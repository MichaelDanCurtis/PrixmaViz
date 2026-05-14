---
name: annotation-followup
description: Use when the user references annotations or marks they've made on a diagram — phrases like "what did I tag?", "summarize my annotations", "explain the regions I marked", "what do my notes say?". Also triggers when the user asks an open-ended question about a diagram and there are unresolved annotations on the focused tile.
---

# Annotation Follow-up

When the user asks about marks they've made:

1. Call `get_focused_tile()` to identify the relevant tile.
2. Call `get_annotations(diagramId)` for that tile.
3. Summarize the annotations in plain English: kind (region/pin/tag), the user's `text` if present, and the resolved `targetNodes` (for graph engines) or `bboxData` (for charts).

Don't list the raw IDs (`ann_...`); the user doesn't care. Speak about what was marked: "You have a region on Auth and DB asking 'why dashed?', and a pin on the Webview lifeline saying 'this returns null sometimes'."

If `targetNodes` is empty for a region annotation, say so honestly: "I see a region you marked, but the hit-test didn't resolve any specific nodes — can you describe what's inside it?"
