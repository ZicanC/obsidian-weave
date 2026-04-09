<script lang="ts">
  import EnhancedIcon from "../../../ui/EnhancedIcon.svelte";
  import type { TagsCellProps } from "../../types/table-types";

  interface SuggestionNode {
    name: string;
    fullPath: string;
    originalTag: string;
    children: SuggestionNode[];
  }

  interface SuggestionRow {
    key: string;
    name: string;
    fullPath: string;
    originalTag: string;
    depth: number;
    hasChildren: boolean;
    expanded: boolean;
  }

  let { card, onTagsUpdate, availableTags = [] }: TagsCellProps = $props();
  const labels = {
    editTags: '\u7f16\u8f91\u6807\u7b7e',
    removeTag: '\u5220\u9664\u6807\u7b7e',
    addTagPlaceholder: '\u70b9\u51fb\u6dfb\u52a0\u6807\u7b7e',
    inputPlaceholder: '\u8f93\u5165\u6807\u7b7e...',
    inputPlaceholderFirst: '\u8f93\u5165\u6807\u7b7e\u540e\u6309 Enter',
    createHintPrefix: '\u6309 Enter \u65b0\u5efa\u6807\u7b7e',
    noSuggestions: '\u6682\u65e0\u53ef\u590d\u7528\u6807\u7b7e'
  };

  const colorPalette = [
    'var(--color-cyan, var(--interactive-accent))',
    'var(--color-green, var(--interactive-accent))',
    'var(--color-purple, var(--interactive-accent))',
    'var(--color-orange, var(--interactive-accent))',
    'var(--color-pink, var(--interactive-accent))',
    'var(--color-blue, var(--interactive-accent))',
    'var(--color-red, var(--interactive-accent))',
    'var(--color-yellow, var(--interactive-accent))'
  ];

  let isEditing = $state(false);
  let draftTags = $state<string[]>([]);
  let inputValue = $state('');
  let highlightedSuggestionIndex = $state(0);
  let expandedSuggestionState = $state(new Map<string, boolean>());
  let containerEl: HTMLDivElement | null = $state(null);
  let inputEl: HTMLInputElement | null = $state(null);

  let displayTags = $derived(card.tags || []);
  let activeTags = $derived(isEditing ? draftTags : displayTags);
  let visibleDisplayTags = $derived(displayTags.slice(0, 3));
  let hiddenDisplayTagCount = $derived(Math.max(0, displayTags.length - visibleDisplayTags.length));

  function normalizeTagName(tag: string): string {
    return tag.trim().replace(/^#/, '');
  }

  let normalizedAvailableTags = $derived.by(() => {
    const seen = new Set<string>();
    const uniqueTags: string[] = [];

    for (const rawTag of availableTags || []) {
      const trimmed = rawTag.trim();
      const normalized = normalizeTagName(trimmed);
      const dedupeKey = normalized.toLowerCase();
      if (!normalized || seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      uniqueTags.push(trimmed);
    }

    return uniqueTags;
  });

  function sortSuggestionNodes(nodes: SuggestionNode[]) {
    nodes.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    for (const node of nodes) {
      if (node.children.length > 0) {
        sortSuggestionNodes(node.children);
      }
    }
    return nodes;
  }

  function buildSuggestionTree(tags: string[]): SuggestionNode[] {
    const roots: SuggestionNode[] = [];
    const nodeMap = new Map<string, SuggestionNode>();

    for (const tag of tags) {
      const normalized = normalizeTagName(tag);
      if (!normalized) continue;

      const segments = normalized.split('/').map((segment) => segment.trim()).filter(Boolean);
      if (segments.length === 0) continue;

      let currentPath = '';
      let parentNode: SuggestionNode | null = null;

      segments.forEach((segment, index) => {
        currentPath = currentPath ? `${currentPath}/${segment}` : segment;
        let node = nodeMap.get(currentPath);

        if (!node) {
          node = {
            name: segment,
            fullPath: currentPath,
            originalTag: currentPath,
            children: []
          };
          nodeMap.set(currentPath, node);

          if (parentNode) {
            parentNode.children.push(node);
          } else {
            roots.push(node);
          }
        }

        if (index === segments.length - 1) {
          node.originalTag = tag;
        }

        parentNode = node;
      });
    }

    return sortSuggestionNodes(roots);
  }

  function isSuggestionExpanded(path: string): boolean {
    return expandedSuggestionState.get(path) ?? true;
  }

  function toggleSuggestionExpanded(path: string) {
    const nextState = new Map(expandedSuggestionState);
    nextState.set(path, !isSuggestionExpanded(path));
    expandedSuggestionState = nextState;
  }

  let suggestionTree = $derived(buildSuggestionTree(normalizedAvailableTags));

  let visibleSuggestionRows = $derived.by(() => {
    const keyword = inputValue.trim().toLowerCase();
    const rows: SuggestionRow[] = [];

    const matchesKeyword = (node: SuggestionNode): boolean => {
      const selfMatches = !keyword
        || node.fullPath.toLowerCase().includes(keyword)
        || node.name.toLowerCase().includes(keyword);

      if (selfMatches) return true;
      return node.children.some((child) => matchesKeyword(child));
    };

    const walk = (node: SuggestionNode, depth: number) => {
      if (!matchesKeyword(node)) {
        return;
      }

      const expanded = keyword ? true : isSuggestionExpanded(node.fullPath);

      rows.push({
        key: node.fullPath,
        name: node.name,
        fullPath: node.fullPath,
        originalTag: node.originalTag,
        depth,
        hasChildren: node.children.length > 0,
        expanded
      });

      if (!expanded && !keyword) {
        return;
      }

      for (const child of node.children) {
        walk(child, depth + 1);
      }
    };

    for (const node of suggestionTree) {
      walk(node, 0);
    }

    return rows;
  });

  $effect(() => {
    inputValue;
    visibleSuggestionRows.length;
    highlightedSuggestionIndex = 0;
  });

  $effect(() => {
    if (highlightedSuggestionIndex >= visibleSuggestionRows.length) {
      highlightedSuggestionIndex = Math.max(visibleSuggestionRows.length - 1, 0);
    }
  });

  function getTagColorIndex(tag: string): number {
    let hash = 0;
    for (let i = 0; i < tag.length; i += 1) {
      hash = ((hash << 5) - hash) + tag.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash) % colorPalette.length;
  }

  function getTagStyle(tag: string): string {
    const tone = colorPalette[getTagColorIndex(tag)];
    const background = `color-mix(in srgb, ${tone} 18%, var(--weave-table-page-bg, var(--background-primary)))`;
    const color = `color-mix(in srgb, ${tone} 72%, var(--text-normal))`;
    const border = `color-mix(in srgb, ${tone} 36%, var(--background-modifier-border))`;
    return `background:${background};color:${color};border-color:${border};`;
  }

  function focusInput() {
    requestAnimationFrame(() => {
      inputEl?.focus();
    });
  }

  function isolateCellInteraction(event?: MouseEvent | KeyboardEvent) {
    if (!event) return;
    event.cancelBubble = true;
  }

  function beginEditing(event?: MouseEvent | KeyboardEvent) {
    isolateCellInteraction(event);
    if (!onTagsUpdate) return;

    draftTags = [...displayTags];
    inputValue = '';
    isEditing = true;
    focusInput();
  }

  function finishEditing() {
    isEditing = false;
    inputValue = '';
    highlightedSuggestionIndex = 0;
  }

  function syncTags(newTags: string[]) {
    draftTags = newTags;
    onTagsUpdate?.(card.uuid, newTags);
  }

  function addTag(tag: string) {
    const trimmed = tag.trim();
    if (!trimmed) return;

    const exists = draftTags.some((item) => item.toLowerCase() === trimmed.toLowerCase());
    if (exists) {
      inputValue = '';
      return;
    }

    syncTags([...draftTags, trimmed]);
    inputValue = '';
    focusInput();
  }

  function removeTag(tag: string) {
    syncTags(draftTags.filter((item) => item !== tag));
    focusInput();
  }

  function handleKeydown(event: KeyboardEvent) {
    const highlightedSuggestion = visibleSuggestionRows[highlightedSuggestionIndex];

    if (event.key === 'Enter') {
      event.preventDefault();

      if (inputValue.trim()) {
        addTag(inputValue);
      } else if (highlightedSuggestion) {
        addTag(highlightedSuggestion.originalTag);
      } else {
        finishEditing();
      }
      return;
    }

    if (event.key === 'Tab' && highlightedSuggestion) {
      event.preventDefault();
      addTag(highlightedSuggestion.originalTag);
      return;
    }

    if (event.key === 'ArrowDown' && visibleSuggestionRows.length > 0) {
      event.preventDefault();
      highlightedSuggestionIndex = (highlightedSuggestionIndex + 1) % visibleSuggestionRows.length;
      return;
    }

    if (event.key === 'ArrowUp' && visibleSuggestionRows.length > 0) {
      event.preventDefault();
      highlightedSuggestionIndex =
        (highlightedSuggestionIndex - 1 + visibleSuggestionRows.length) % visibleSuggestionRows.length;
      return;
    }

    if (event.key === 'ArrowRight' && highlightedSuggestion?.hasChildren && !highlightedSuggestion.expanded) {
      event.preventDefault();
      toggleSuggestionExpanded(highlightedSuggestion.fullPath);
      return;
    }

    if (event.key === 'ArrowLeft' && highlightedSuggestion?.hasChildren && highlightedSuggestion.expanded) {
      event.preventDefault();
      toggleSuggestionExpanded(highlightedSuggestion.fullPath);
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      finishEditing();
      return;
    }

    if (event.key === 'Backspace' && !inputValue && draftTags.length > 0) {
      event.preventDefault();
      syncTags(draftTags.slice(0, -1));
      return;
    }

    if (event.key === ',') {
      event.preventDefault();
      addTag(inputValue);
    }
  }

  $effect(() => {
    if (!isEditing || !containerEl) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (containerEl && !containerEl.contains(event.target as Node)) {
        finishEditing();
      }
    };

    setTimeout(() => {
      document.addEventListener('mousedown', handlePointerDown);
    }, 0);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
    };
  });
</script>

<td class="weave-tags-column">
  <div
    class="weave-tags-cell"
    class:is-editing={isEditing}
    bind:this={containerEl}
    onclick={(event) => {
      isolateCellInteraction(event);
      if (!isEditing) beginEditing(event);
    }}
    onkeydown={(event) => {
      if ((event.key === 'Enter' || event.key === ' ') && !isEditing) {
        event.preventDefault();
        beginEditing(event);
      }
    }}
    role="button"
    tabindex="0"
    aria-label={labels.editTags}
  >
    <div class="weave-tags-flow">
      {#if displayTags.length > 0}
        {#each isEditing ? activeTags : visibleDisplayTags as tag (tag)}
          <span class="weave-tag-pill" style={getTagStyle(tag)}>
            <span class="weave-tag-label" title={tag}>{tag}</span>
            {#if isEditing}
              <button
                type="button"
                class="weave-tag-remove"
                aria-label={`${labels.removeTag} ${tag}`}
                onclick={(event) => {
                  isolateCellInteraction(event);
                  removeTag(tag);
                }}
              >
                <EnhancedIcon name="x" size={10} />
              </button>
            {/if}
          </span>
        {/each}
        {#if !isEditing && hiddenDisplayTagCount > 0}
          <span class="weave-tag-summary">+{hiddenDisplayTagCount}</span>
        {/if}
      {/if}

      {#if isEditing}
        <input
          bind:this={inputEl}
          class="weave-tag-input"
          bind:value={inputValue}
          placeholder={activeTags.length > 0 ? labels.inputPlaceholder : labels.inputPlaceholderFirst}
          onkeydown={handleKeydown}
          onclick={(event) => isolateCellInteraction(event)}
          autocomplete="off"
          spellcheck="false"
        />
      {:else if displayTags.length === 0}
        <span class="weave-tags-placeholder">{labels.addTagPlaceholder}</span>
      {/if}
    </div>

    {#if !isEditing}
      <div class="weave-tags-edit-hint">
        <EnhancedIcon name="plus" size={12} />
      </div>
    {/if}

    {#if isEditing}
      <div class="suggestion-container mod-suggestion weave-tags-suggestions" role="listbox">
        {#if visibleSuggestionRows.length > 0}
          {#each visibleSuggestionRows as suggestion, index (suggestion.key)}
            <div
              class="suggestion-item weave-suggestion-row"
              class:is-selected={index === highlightedSuggestionIndex}
              style={`--weave-tag-depth:${suggestion.depth};`}
              role="option"
              tabindex="-1"
              aria-selected={index === highlightedSuggestionIndex}
              onclick={(event) => {
                isolateCellInteraction(event);
                addTag(suggestion.originalTag);
              }}
              onkeydown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  isolateCellInteraction(event);
                  addTag(suggestion.originalTag);
                }
              }}
            >
              <div class="weave-suggestion-content">
                <span class="weave-suggestion-indent" aria-hidden="true"></span>
                {#if suggestion.hasChildren}
                  <button
                    type="button"
                    class="weave-suggestion-toggle"
                    aria-label={suggestion.expanded ? '收起子标签' : '展开子标签'}
                    onclick={(event) => {
                      isolateCellInteraction(event);
                      event.preventDefault();
                      toggleSuggestionExpanded(suggestion.fullPath);
                    }}
                  >
                    <EnhancedIcon name={suggestion.expanded ? "chevronDown" : "chevronRight"} size={12} />
                  </button>
                {:else}
                  <span class="weave-suggestion-toggle-placeholder" aria-hidden="true"></span>
                {/if}
                <span class="weave-suggestion-icon" aria-hidden="true">
                  <EnhancedIcon name="tag" size={13} />
                </span>
                <span class="weave-suggestion-text" title={suggestion.originalTag}>
                  {suggestion.name}
                </span>
              </div>
            </div>
          {/each}
        {:else if inputValue.trim()}
          <div class="suggestion-item weave-suggestion-empty">
            {labels.createHintPrefix} “{inputValue.trim()}”
          </div>
        {:else if normalizedAvailableTags.length === 0}
          <div class="suggestion-item weave-suggestion-empty">{labels.noSuggestions}</div>
        {/if}
      </div>
    {/if}
  </div>
</td>

<style>
  .weave-tags-column {
    position: relative;
    min-width: 180px;
    max-width: 260px;
    overflow: visible;
    padding: var(--weave-table-cell-padding-y, 6px) var(--weave-table-cell-padding-x, 16px);
    border-right: 1px solid var(--weave-table-grid-border-color, var(--background-modifier-border));
    border-bottom: 1px solid var(--weave-table-grid-border-color, var(--background-modifier-border));
    vertical-align: middle;
    box-sizing: border-box;
  }

  .weave-tags-cell {
    position: relative;
    display: flex;
    align-items: flex-start;
    min-height: 22px;
    width: 100%;
    padding: 1px 4px;
    border: 1px solid transparent;
    border-radius: 8px;
    background: transparent;
    cursor: text;
    transition: background-color 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease;
    outline: none;
  }

  .weave-tags-cell:hover {
    background: color-mix(in srgb, var(--background-modifier-hover) 75%, transparent);
  }

  .weave-tags-cell:focus-visible,
  .weave-tags-cell.is-editing {
    background: var(--weave-table-page-bg, var(--background-primary));
    border-color: color-mix(in srgb, var(--interactive-accent) 42%, var(--background-modifier-border));
    box-shadow: var(--shadow-s, 0 6px 18px color-mix(in srgb, var(--background-modifier-border) 46%, transparent));
  }

  .weave-tags-flow {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 4px;
    width: 100%;
    min-height: 16px;
    padding-right: 18px;
  }

  .weave-tag-pill {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    max-width: 100%;
    min-height: var(--weave-table-pill-height, 22px);
    padding: 0 var(--weave-table-pill-padding-x, 8px);
    border: 1px solid transparent;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 600;
    line-height: 1;
    transition: transform 0.15s ease, box-shadow 0.15s ease;
  }

  .weave-tags-cell:not(.is-editing) .weave-tag-pill:hover {
    transform: translateY(-1px);
    box-shadow: var(--shadow-xs, 0 2px 8px color-mix(in srgb, var(--background-modifier-border) 44%, transparent));
  }

  .weave-tag-summary {
    display: inline-flex;
    align-items: center;
    min-height: var(--weave-table-pill-height, 22px);
    padding: 0 var(--weave-table-pill-padding-x, 8px);
    border-radius: 999px;
    background: color-mix(in srgb, var(--weave-table-surface-bg, var(--background-secondary)) 78%, var(--weave-table-page-bg, var(--background-primary)) 22%);
    border: 1px solid color-mix(in srgb, var(--background-modifier-border) 72%, transparent);
    color: var(--text-muted);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.01em;
  }

  .weave-tag-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 92px;
  }

  @media (max-width: 768px) {
    .weave-tags-column {
      min-width: 164px;
      max-width: 196px;
    }

    .weave-tag-label {
      max-width: 80px;
    }
  }

  .weave-tag-remove {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: currentColor;
    cursor: pointer;
    opacity: 0;
    transform: scale(0.85);
    transition: opacity 0.14s ease, transform 0.14s ease, background-color 0.14s ease;
  }

  .weave-tag-pill:hover .weave-tag-remove,
  .weave-tag-remove:focus-visible {
    opacity: 1;
    transform: scale(1);
  }

  .weave-tag-remove:hover {
    background: color-mix(in srgb, currentColor 18%, transparent);
  }

  .weave-tag-input {
    min-width: 86px;
    flex: 1 1 90px;
    height: 18px;
    padding: 0 2px;
    border: none;
    background: transparent;
    color: var(--text-normal);
    font-size: 12px;
    outline: none;
  }

  .weave-tag-input::placeholder {
    color: var(--text-faint);
  }

  .weave-tags-placeholder {
    display: inline-flex;
    align-items: center;
    min-height: 16px;
    color: var(--text-faint);
    font-size: 11px;
  }

  .weave-tags-edit-hint {
    position: absolute;
    top: 50%;
    right: 6px;
    transform: translateY(-50%);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-faint);
    opacity: 0;
    transition: opacity 0.16s ease;
    pointer-events: none;
  }

  .weave-tags-cell:hover .weave-tags-edit-hint {
    opacity: 1;
  }

  .weave-tags-suggestions {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    min-width: max(100%, 280px);
    max-width: min(420px, calc(100vw - 32px));
    max-height: 360px;
    overflow-y: auto;
    padding: 6px 0;
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 8px;
    box-shadow: var(--shadow-s, 0 8px 18px color-mix(in srgb, var(--background-modifier-border) 46%, transparent));
    z-index: 30;
  }

  .weave-suggestion-row {
    display: block;
    width: 100%;
    min-height: 30px;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--text-normal);
    text-align: left;
    cursor: pointer;
    border-radius: 0;
  }

  .weave-suggestion-row:hover,
  .weave-suggestion-row.is-selected {
    background: var(--background-modifier-hover);
  }

  .weave-suggestion-content {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 30px;
    width: 100%;
    padding: 0 12px;
    padding-left: calc(12px + (var(--weave-tag-depth, 0) * 18px));
    white-space: nowrap;
  }

  .weave-suggestion-indent {
    width: 0;
    flex-shrink: 0;
  }

  .weave-suggestion-toggle,
  .weave-suggestion-toggle-placeholder {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    flex-shrink: 0;
  }

  .weave-suggestion-toggle {
    padding: 0;
    border: none;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
  }

  .weave-suggestion-toggle:hover {
    color: var(--text-normal);
  }

  .weave-suggestion-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    flex-shrink: 0;
    color: var(--text-muted);
  }

  .weave-suggestion-text {
    display: block;
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 14px;
    line-height: 1.35;
  }

  .weave-suggestion-empty {
    display: flex;
    align-items: center;
    min-height: 30px;
    color: var(--text-muted);
    padding: 0 12px;
    font-size: 13px;
  }
</style>
