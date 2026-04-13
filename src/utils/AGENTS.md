# UTILS KNOWLEDGE BASE

## OVERVIEW
`utils/` is a large shared foundation layer. Many files here are domain rules or compatibility helpers, not trivial pure helpers.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| YAML/frontmatter rules | `yaml-utils.ts`, `yaml-frontmatter-utils.ts` | Card/content metadata handling |
| Path rewrite / provenance | `persisted-path-rewriter.ts`, `source-path-matcher.ts` | Migration and source lookup |
| Storage helpers | `directory-utils.ts`, `safe-json-io.ts`, `file-utils.ts` | Shared persistence tooling |
| Runtime coordination | `logger.ts`, `service-ready-check.ts`, `service-ready-event.ts` | Shared readiness/logging patterns |
| Error handling | `unified-error-handler.ts` | Large cross-cutting hotspot |

## CONVENTIONS
- Verify whether a util encodes domain semantics before reusing it as “generic”.
- Some utils still carry legacy compatibility behavior; check callers before cleanup.
- Tests are spread across root `__tests__`, nearby `*.test.ts`, and deeper topic-specific folders.

## ANTI-PATTERNS
- Do not hide business rules in new generic helpers if a feature service should own them.
- Do not change path or YAML helpers without auditing migration and metadata callers.
