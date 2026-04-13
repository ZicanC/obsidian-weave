# TESTS KNOWLEDGE BASE

## OVERVIEW
`src/tests/` is the shared Vitest support layer plus a small set of cross-cutting tests.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Global browser shims | `setup.ts` | DOM/timer/API mocks |
| Shared jest-dom / global setup | `vitest-setup.ts` | Global test helpers |
| Obsidian mock | `mocks/obsidian.ts` | Aliased by `vitest.config.ts` |

## CONVENTIONS
- Test environment is centralized; most feature suites do not define local Vitest configs.
- Service and component tests usually live near their code under `__tests__` or `*.test.ts` files.
- `services/__tests__/` includes property-based and integration naming conventions.

## ANTI-PATTERNS
- Do not add per-folder setup when centralized setup already solves it unless the local domain truly needs isolation.
- Do not mock `obsidian` ad hoc if the shared alias covers the case.
