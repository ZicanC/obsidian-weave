# EPUB COMPONENTS KNOWLEDGE BASE

## OVERVIEW
`epub/` is a cohesive reader mini-app with its own shell, sidebars, toolbars, notes, bookmarks, and bookshelf surfaces.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Main reader app | `EpubReaderApp.svelte` | Central UI hotspot |
| Reader view shell | `EpubReaderView.svelte` | Rendered reading surface |
| Notes/bookmarks/toc | `NotesPanel.svelte`, `BookmarkPanel.svelte`, `TableOfContents.svelte` | Reader side tooling |
| Global sidebars | `EpubGlobalSidebar.svelte`, `BookshelfView.svelte` | Navigation / bookshelf context |

## CONVENTIONS
- EPUB UI is tightly coupled to `src/services/epub/` and Foliate-based reading behavior.
- Reader actions often touch highlights, screenshots, note links, location migration, and bookshelf state.
- This subtree acts more like an embedded product than a set of isolated widgets.

## ANTI-PATTERNS
- Do not make reader-state assumptions without checking service-layer migration and storage behavior.
- Do not split reader interactions from their sidebar/tooling side effects.
