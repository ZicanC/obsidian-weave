# SRC KNOWLEDGE BASE

## OVERVIEW
`src/` is the real product surface: Obsidian bootstrap, feature UI, domain services, shared storage rules, tests, and contracts.

## STRUCTURE
```text
src/
├── main.ts              # plugin bootstrap / command / view registration hub
├── components/          # Svelte UI and feature mini-apps
├── services/            # feature logic, scheduling, migrations, integrations
├── utils/               # shared helpers with product rules
├── config/              # canonical path/storage policy
├── views/               # Obsidian ItemView wrappers
├── tests/               # shared Vitest setup and cross-cutting tests
└── types/               # shared interfaces and persisted shapes
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Command/view registration | `main.ts` | Search here first before assuming dynamic wiring |
| New Svelte page or flow | `components/` | Feature-first organization |
| Business logic / persistence | `services/` | Often richer than the UI layer suggests |
| Shared parsing/path logic | `utils/` | Many cross-feature dependencies |
| Data root changes | `config/paths.ts` | Update here before anywhere else |
| Obsidian-specific view shell | `views/` | Thin wrappers around components/services |
| Shared test harness | `tests/` | Global mocks and browser shims |

## CONVENTIONS
- `main.ts` is a central orchestrator, not a thin entry file.
- Views in `views/` are registration surfaces; feature behavior usually lives in `components/` + `services/`.
- Tests prefer colocation under `src/**/__tests__` or nearby `*.test.ts` files.
- Many “utility” and “service” files carry domain semantics; avoid moving logic blindly across those boundaries.

## ANTI-PATTERNS
- Do not add new storage locations without updating `config/paths.ts`.
- Do not duplicate feature rules in UI if a service or util already owns them.
- Do not assume parent folder names imply a clean layered architecture; verify callers and data flow.

## CHILD GUIDANCE
- Use `components/AGENTS.md` for UI work.
- Use `services/AGENTS.md` for business logic, persistence, migrations, and integrations.
- Use `utils/AGENTS.md` for shared helpers or cross-feature rules.
- Use `config/AGENTS.md` for storage/path changes.
