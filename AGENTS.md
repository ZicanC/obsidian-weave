# PROJECT KNOWLEDGE BASE

**Generated:** 2026-04-13
**Commit:** 8a82b4a
**Branch:** main

## OVERVIEW
Weave is an Obsidian plugin for incremental reading, FSRS-based memory decks, and question-bank practice. Runtime is TypeScript + Svelte 5 + Vite, built as `main.js` plus plugin assets for Obsidian.

## STRUCTURE
```text
obsidian-weave/
├── src/                    # plugin source; hybrid feature + foundation layout
├── scripts/                # hot-reload, manifest sync, cache/process helpers
├── .github/workflows/      # CI, PR quality gate, test reporting
├── manifest.json           # Obsidian plugin metadata
├── package.json            # scripts, toolchain, runtime deps
├── vite.config.ts          # CJS plugin build + hot-reload sync
└── vitest.config.ts        # jsdom test runner + Obsidian mock alias
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Plugin bootstrap | `src/main.ts` | Huge orchestrator; registers views, commands, processors, lifecycle |
| Storage boundaries | `src/config/paths.ts` | SSOT for `weave/` vs `.obsidian/plugins/weave/` |
| Main UI shell | `src/components/WeaveApp.svelte` | Page switching + app shell |
| Obsidian views | `src/views/` | Thin ItemView wrappers around feature UI |
| Feature UI | `src/components/` | Study, settings, IR, EPUB, pages, shared UI |
| Domain/services | `src/services/` | Heavy feature logic, migrations, caches, integrations |
| Shared helpers | `src/utils/` | Not “just helpers”; many files encode product rules |
| Shared contracts | `src/types/` | Persistence and plugin/service interfaces |
| Test setup | `src/tests/`, `vitest.config.ts` | Global setup, Obsidian mock alias, shared browser mocks |
| Dev hot reload | `scripts/dev-watch.cjs`, `scripts/hot-reload-utils.cjs` | Uses `.desktop-hot-reload/` staging + atomic copy |

## CODE MAP
| Symbol | Type | Location | Refs | Role |
|--------|------|----------|------|------|
| `WeavePlugin` | class | `src/main.ts` | high | Main plugin entry and lifecycle owner |
| `onload` | method | `src/main.ts` | n/a | Startup sequencing, view registration, service wiring |
| `WEAVE_DATA` | const | `src/config/paths.ts` | high | Root synced data folder name |
| `DEFAULT_IR_IMPORT_FOLDER` | const | `src/config/paths.ts` | high | Default readable IR markdown output |
| `getPluginPaths` | function | `src/config/paths.ts` | high | Local plugin-state/cache path layout |

## CONVENTIONS
- Obsidian plugin packaging is fixed: `main.js`, `manifest.json`, `styles.css`, optional `sql-wasm.wasm` and `versions.json`.
- Dev is Vite build-watch, not `index.html` app serving.
- `OBSIDIAN_VAULT_PATH` enables direct sync into `plugins/weave/`; desktop dev stages via `.desktop-hot-reload/` first.
- Formatting/linting target `./src`; Biome is primary formatter/linter.
- TypeScript is strict, bundler-resolution, with checked JS enabled in `src`.
- Tests are colocated under `src` with centralized Vitest setup.

## ANTI-PATTERNS (THIS PROJECT)
- Do not introduce hidden data roots like `.weave/` or new `_data/` layers; `src/config/paths.ts` documents the current layout.
- Do not mix synced vault data with plugin-local cache/state.
- Do not use `stopPropagation` / `stopImmediatePropagation` in Svelte 5 flows; repo lint rules ban them.
- Do not treat cached deck/card fields as source of truth when YAML/frontmatter owns the value.
- Do not bypass migration safety gates for legacy cleanup or persisted-path rewrites.

## UNIQUE STYLES
- Hybrid architecture: `src` mixes feature folders with foundation folders (`application`, `domain`, `infrastructure`, `services`, `utils`, `types`).
- `src/main.ts` is intentionally monolithic; many “where is X registered?” answers live there.
- Component tree contains both feature mini-apps and a shared UI kit; `src/components/ui/cursor` is its own stylistic pocket.
- Services are domain-heavy and often own real business rules, not only adapters.

## COMMANDS
```bash
npm run dev
npm run build
npm run test
npm run test:watch
npm run check
npm run lint:check
npm run lint
npm run format
```

## NOTES
- README references `docs/RELEASE_GUIDE.md` and `docs/IMAGE_MASK_GUIDE.md`, but those docs are not present in this checkout.
- CI files: `.github/workflows/ci.yml`, `quality-gate.yml`, `test-report.yml`.
- Quality gate allows a TypeScript baseline ceiling instead of requiring zero current errors.
- `package.json` references some mobile/dev helper scripts not present in `scripts/`; treat those paths as stale until verified.
