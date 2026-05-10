---
name: diagram-review
description: Use when the user has saved diagrams in the project library and asks for review-style help — phrases like "look over my architecture", "any issues with this diagram?", "review what I have", "what would you change?". Triggers on review/critique intent against existing saved content.
---

# Diagram Review

When the user wants you to review a saved diagram:

1. Call `list_diagrams()` to see what's saved.
2. If a diagram is currently focused, prefer that one. Otherwise ask the user which to review.
3. Call `load_diagram(slug)` to read the IR/DSL.
4. Call `get_annotations(diagramId)` to see the user's existing marks.
5. Walk the structure and identify common issues:
   - **Orphan nodes** (nodes with no edges in/out of them — usually a mistake)
   - **Missing edges** (groups of nodes that obviously belong together but aren't connected)
   - **Ambiguous labels** (nodes named "Service" or "DB1" without disambiguation)
   - **Unbalanced detail** (one subgraph deeply detailed, others stubbed)
   - **Annotation conflicts** (user marked something as wrong but didn't say what should change)
6. Suggest 1-3 concrete patches that fix specific issues. Use `apply_patch` to apply on user confirmation.

Don't lecture. Diagrams are working tools, not artwork. Suggest changes that make the diagram more useful for the user's evident purpose.
