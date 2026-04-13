# EDITOR SERVICES KNOWLEDGE BASE

## OVERVIEW
`editor/` manages editor lifecycle, hidden-leaf reuse, modal/embedded editor behavior, and editor-linked AI flows.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Main lifecycle hotspot | `ModalEditorManager.ts` | Large pooled hidden-leaf manager |
| AI/editor bridge | `SelectedTextAICardPanelManager.ts` | Editor-triggered AI side flow |
| Keyboard handling | `keyboard-event-handler.ts` | Contains Svelte 5 event guidance |

## CONVENTIONS
- This subtree is integration-heavy with Obsidian editor APIs and reuse/pooling behavior.
- Editor lifecycle bugs often come from timing, focus, or DOM ownership, not only business logic.

## ANTI-PATTERNS
- Do not use forbidden Svelte 5 propagation patterns in editor events.
- Do not bypass manager-owned cleanup or hidden-leaf reuse.
