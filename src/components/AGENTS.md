# COMPONENTS KNOWLEDGE BASE

## OVERVIEW
`src/components/` is a mix of app shell, feature mini-apps, shared widgets, modal wrappers, and page-level orchestration.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| App shell / page routing | `WeaveApp.svelte`, `pages/` | Main page transitions and entry surfaces |
| Study UX | `study/` | Biggest interactive learning surface |
| Settings UX | `settings/` | Mini app with many internal subdomains |
| Incremental reading UX | `incremental-reading/` | IR deck, analytics, import modals |
| EPUB UX | `epub/` | Self-contained reader mini-app |
| Shared widgets | `ui/` | Practical shared primitives; check `ui/cursor` split |
| Modal integration | `modals/` | Cross-cutting Svelte modal + Obsidian wrapper pattern |

## CONVENTIONS
- Page and feature shells are often large orchestration components.
- `*Obsidian.ts` files wrap Svelte components into Obsidian modal/tab/view APIs.
- `ui/` is shared infrastructure, but `ui/cursor/` has a more specialized style pocket.
- Feature components usually rely on services for persistence and core rules; do not reimplement service logic in Svelte.

## ANTI-PATTERNS
- Do not bury feature state mutations inside leaf UI widgets when a service already coordinates them.
- Do not add new modal wrapper styles if an existing `*Obsidian.ts` pattern already fits.
- Do not treat `ui/` as a dumping ground for feature-specific components.

## CHILD GUIDANCE
- `study/`, `settings/`, `incremental-reading/`, `epub/`, and `pages/` each have local guidance.
- `modals/` stays under this parent unless its wrapper conventions become more complex.
