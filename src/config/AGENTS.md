# CONFIG KNOWLEDGE BASE

## OVERVIEW
`config/` is small but high-leverage. `paths.ts` is the SSOT for data layout, plugin-local storage, and legacy path compatibility.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Synced data root | `paths.ts` | `weave/` conventions |
| Local plugin-state root | `paths.ts` | `.obsidian/plugins/weave/` conventions |
| Schema/version constants | `paths.ts` | Includes `SCHEMA_VERSION` |
| Legacy compatibility | `paths.ts` | Old `.tuanki`, `_data`, IR path rewrites |

## CONVENTIONS
- `weave/` is for synced vault data.
- `.obsidian/plugins/weave/` is for local plugin state, cache, backups, and migration metadata.
- Current layout explicitly rejects hidden data folders and intermediary `_data/` layers.

## ANTI-PATTERNS
- Do not invent new roots outside this file.
- Do not mix vault-visible data with plugin-local cache/state.
- Do not remove legacy constants if startup migration or path rewrite logic still depends on them.
