# SETTINGS COMPONENTS KNOWLEDGE BASE

## OVERVIEW
`settings/` is a mini app mounted into an Obsidian setting tab, with multiple internal domains and support utilities.

## STRUCTURE
```text
settings/
├── SettingsPanel.svelte
├── SettingsTab.ts
├── ai-config/
├── ankiconnect/
├── batch-parsing/
├── card-parsing/
├── data-management/
├── sections/
└── utils/ types/ constants/ components/
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Obsidian settings mount | `SettingsTab.ts` | Entry surface into plugin settings |
| Main settings shell | `SettingsPanel.svelte` | Tabbed/root layout |
| Anki settings | `ankiconnect/` | Includes deck mapping subdomain |
| Data repair/migration UX | `data-management/` | Operational controls |
| Parsing config UX | `batch-parsing/`, `card-parsing/` | Import and parsing behavior |

## CONVENTIONS
- Settings are domainized; keep related controls in their local subtree.
- `SettingsTab.ts` is integration glue; most UI belongs in Svelte files.
- This subtree carries operational settings, not just preferences, so changes can have migration/data consequences.

## ANTI-PATTERNS
- Do not add cross-domain operational logic directly into the shell when a feature subsection already owns it.
- Do not mix display-only settings with mutation-heavy repair flows without clear boundaries.
