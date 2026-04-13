# SERVICES KNOWLEDGE BASE

## OVERVIEW
`src/services/` is the main business-logic layer: feature domains, integrations, queues, migrations, caches, sync helpers, and startup orchestration.

## STRUCTURE
```text
services/
├── incremental-reading/   # IR scheduling, storage, reading-material flows
├── epub/                  # reader engine, parsing, links, annotations, storage
├── ankiconnect/           # external sync/integration
├── ai/                    # provider selection and AI actions
├── editor/                # editor lifecycle and integration
├── question-bank/         # test/exam domain
├── reference-deck/        # multi-deck card ownership and migration
├── data-migration/        # schema/layout upgrade logic
├── plugin-state/          # local plugin persistence
└── ServiceInitializer.ts  # startup sequencing
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Service startup order | `ServiceInitializer.ts` | Phased bootstrap, dependency boundaries |
| IR logic | `incremental-reading/` | One of the deepest service domains |
| EPUB logic | `epub/` | Reader engine + parser + storage + migration |
| Data repair / diagnostics | `data-management/` | Operational checks and fixes |
| Schema/layout migration | `data-migration/` | Upgrade logic and legacy path handling |
| Card/deck truth rules | `reference-deck/`, `deck/`, `CardMetadataService.ts` | Shared ownership and metadata |
| Local plugin state | `plugin-state/` | Local-only storage and recovery |

## CONVENTIONS
- Many top-level service files are shared singletons or coordination layers with broad blast radius.
- Domain folders usually own real business rules, not just adapters.
- Tests are colocated: `__tests__` directories for many domains, nearby `*.test.ts` in others.
- Property and integration test naming exists in `services/__tests__`.

## ANTI-PATTERNS
- Do not bypass source-of-truth ownership rules in YAML/card metadata flows.
- Do not add new migration behavior without checking legacy path compatibility and repair tooling.
- Do not mutate shared caches/state from UI code when a service already owns that transition.

## CHILD GUIDANCE
- Use local guidance for `epub/`, `incremental-reading/`, `editor/`, `reference-deck/`, `data-migration/`, and `plugin-state/`.
