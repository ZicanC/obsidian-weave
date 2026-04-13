# PLUGIN STATE SERVICES KNOWLEDGE BASE

## OVERVIEW
`plugin-state/` owns local-only persisted plugin state under `.obsidian/plugins/weave/`.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Local persistence | `PluginLocalStateService.ts` | Central file IO, serialization, recovery |
| Tests | `__tests__/` | Validate corruption/migration behavior |

## CONVENTIONS
- This subtree is for local plugin state only, not synced vault data.
- Serialization and recovery behavior here affect many UX flows indirectly.

## ANTI-PATTERNS
- Do not store synced user content here.
- Do not bypass corruption recovery or write serialization rules.
