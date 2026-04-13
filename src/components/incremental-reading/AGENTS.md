# INCREMENTAL READING COMPONENTS KNOWLEDGE BASE

## OVERVIEW
This subtree owns IR deck views, import flows, analytics, scheduling previews, and quick-resume surfaces.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Main IR deck view | `IRDeckView.svelte` | Primary feature surface |
| Material import flow | `MaterialImportModal.svelte` | Huge import wizard hotspot |
| Obsidian modal bridge | `MaterialImportModalObsidian.ts` | Mounts import modal into Obsidian API |
| Analytics / schedule overlays | `IRAnalyticsModal.svelte`, `IRScheduleImpactPreviewPanel.svelte` | Specialized side flows |

## CONVENTIONS
- IR UI is workflow-heavy: import, scheduling, reading, analytics, reminders, and resume all meet here.
- `*Obsidian.ts` wrappers are part of the standard modal pattern.
- This layer depends heavily on `src/services/incremental-reading/`; keep durable rules there.

## ANTI-PATTERNS
- Do not duplicate scheduler rules in Svelte.
- Do not treat import flow as isolated UI; it touches deck assignment, materials, schedule, and source transforms.
