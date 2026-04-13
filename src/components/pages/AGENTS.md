# COMPONENT PAGES KNOWLEDGE BASE

## OVERVIEW
`pages/` holds page-level assembly surfaces: broad workflows, large state shells, and page routing endpoints.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Card management page | `WeaveCardManagementPage.svelte` | Biggest UI hotspot in repo |
| Deck study landing | `DeckStudyPage.svelte` | Deck overview, study launch, stats, premium gating |
| AI assistant page | `AIAssistantPage.svelte` | Page-level AI workspace entry |

## CONVENTIONS
- Files here are orchestration-heavy and frequently stitch together components, stores, services, and permissions.
- `WeaveCardManagementPage.svelte` and `DeckStudyPage.svelte` own cross-feature coordination, not just layout.

## ANTI-PATTERNS
- Do not move feature-specific rules here if they belong in `services/` or lower-level feature components.
- Do not add duplicate filtering, pagination, or permission logic that already exists in shared components/services.
