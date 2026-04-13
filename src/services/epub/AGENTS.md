# EPUB SERVICES KNOWLEDGE BASE

## OVERVIEW
This subtree owns reader-engine behavior, Foliate integration, EPUB parsing, location migration, note/link wiring, screenshots, and persistent reader state.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Parser / archive / export | `FoliateVaultPublicationParser.ts` | Very large core parser hotspot |
| Reader runtime | `FoliateReaderService.ts` | Render/navigation/highlight coordination |
| Storage and migration | `EpubStorageService.ts`, `EpubLocationMigrationService.ts` | Persisted reader state and compatibility |
| Linking | `EpubLinkService.ts`, `EpubLinkPostProcessor.ts` | CFI links, legacy formats, post-processing |
| Canvas/screenshots | `EpubCanvasService.ts`, `EpubScreenshotService.ts` | Rich integrations |

## CONVENTIONS
- Foliate terminology is central here; do not rename concepts casually.
- Legacy and current link/location formats coexist; preserve migration behavior.
- Tests are unusually rich and specialized, including markdown-export and style-specific suites under `__tests__/`.

## ANTI-PATTERNS
- Do not assume a single current link format without checking legacy compatibility.
- Do not attach notes to unsupported canvas edge IDs or skip reader-location migration rules.
- Do not separate parser/export changes from the corresponding tests.
