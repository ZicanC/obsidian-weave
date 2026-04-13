# STUDY COMPONENTS KNOWLEDGE BASE

## OVERVIEW
`study/` is a feature mini-framework around live study sessions, card actions, ratings, mobile variants, and session UI orchestration.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Main session shell | `StudyInterface.svelte` | Extremely large, central runtime surface |
| Wrapper / startup | `StudyViewWrapper.svelte` | Session mount and persistence bridge |
| Local UI state logic | `CardStateManager.ts` | Shared state helper inside study subtree |
| Mobile-specific UX | `Mobile*.svelte` | Separate affordance layer |
| AI actions during study | `AIActionManager.svelte` | Large side-flow; narrower than main shell |

## CONVENTIONS
- `StudyInterface.svelte` is the center of gravity; many smaller files exist to keep that surface survivable.
- Mobile variants are explicit files, not CSS-only branches.
- Study UI coordinates rating, source display, actions, timing, and stats with many services underneath.

## ANTI-PATTERNS
- Do not add more cross-domain orchestration to small leaf widgets if it belongs in the main shell or a service.
- Do not assume desktop and mobile behavior can share markup unchanged.
- Do not bypass study-session persistence/recovery handled through wrappers and services.
