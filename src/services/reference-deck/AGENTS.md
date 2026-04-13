# REFERENCE DECK SERVICES KNOWLEDGE BASE

## OVERVIEW
This subtree owns reference-deck composition, deck-card truth syncing, compatibility fields, and migration/consistency rules.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Core ownership logic | `ReferenceDeckService.ts` | Main rule owner |
| Consistency / repair | `DataConsistencyService.ts` | YAML vs cache/compat repair behavior |
| Card file persistence | `CardFileService.ts` | Derived/deprecated field handling |

## CONVENTIONS
- YAML `we_decks` is the authoritative deck-membership source.
- Several persisted fields exist only for cache/compat; preserve reads without restoring them as truth.

## ANTI-PATTERNS
- Do not overwrite YAML truth from deprecated cache fields.
- Do not persist derived fields as if they were primary state.
