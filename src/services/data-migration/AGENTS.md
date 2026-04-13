# DATA MIGRATION SERVICES KNOWLEDGE BASE

## OVERVIEW
This subtree owns schema/layout upgrades, legacy-path detection, and repo data migration planning.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Unified migration entry | `UnifiedDataMigrationService.ts` | Primary coordinator |
| Legacy folder rewrite | `LegacyWeaveFolderMigration.ts` | Old data roots / layout changes |
| Schema upgrades | `SchemaV2MigrationService.ts` | Version-specific migrations |
| Plugin-meta layout | `PluginMetaLayoutMigrationService.ts` | Local plugin-state path migration |

## CONVENTIONS
- Migration code must account for old hidden roots, `_data` layers, and layout rewrites documented in `config/paths.ts`.
- Tests here are essential because behavior is about compatibility, not only new-state correctness.

## ANTI-PATTERNS
- Do not delete legacy support paths until startup migration no longer depends on them.
- Do not add one-off rewrites outside the migration layer when a canonical migration service should own them.
