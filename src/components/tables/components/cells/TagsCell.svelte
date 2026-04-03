<script lang="ts">
  import { onMount } from "svelte";
  import EnhancedIcon from "../../../ui/EnhancedIcon.svelte";
  import type { TagsCellProps } from "../../types/table-types";
  import { createThemeListener } from "../../../../utils/theme-detection";

  let { card, onTagsUpdate, availableTags = [] }: TagsCellProps = $props();
  const labels = {
    editTags: '\u7f16\u8f91\u6807\u7b7e',
    removeTag: '\u5220\u9664\u6807\u7b7e',
    addTagPlaceholder: '\u70b9\u51fb\u6dfb\u52a0\u6807\u7b7e',
    inputPlaceholder: '\u8f93\u5165\u6807\u7b7e...',
    inputPlaceholderFirst: '\u8f93\u5165\u6807\u7b7e\u540e\u6309 Enter',
    createHintPrefix: '\u6309 Enter \u65b0\u5efa\u6807\u7b7e',
    noSuggestions: '\u6682\u65e0\u53ef\u590d\u7528\u6807\u7b7e',
    suggestionsTitle: '\u5df2\u6709\u6807\u7b7e',
    shortcutsHint: 'Enter \u6dfb\u52a0  Tab \u9009\u4e2d  Esc \u6536\u8d77'
  };

  const colorPalette = [
    {
      lightBg: 'rgba(211, 229, 239, 0.92)',
      lightText: 'rgba(24, 51, 71, 0.96)',
      darkBg: 'rgba(24, 51, 71, 0.88)',
      darkText: 'rgba(211, 229, 239, 0.96)'
    },
    {
      lightBg: 'rgba(219, 237, 219, 0.92)',
      lightText: 'rgba(28, 56, 41, 0.96)',
      darkBg: 'rgba(28, 56, 41, 0.88)',
      darkText: 'rgba(219, 237, 219, 0.96)'
    },
    {
      lightBg: 'rgba(232, 222, 238, 0.92)',
      lightText: 'rgba(65, 36, 84, 0.96)',
      darkBg: 'rgba(65, 36, 84, 0.88)',
      darkText: 'rgba(232, 222, 238, 0.96)'
    },
    {
      lightBg: 'rgba(251, 236, 221, 0.92)',
      lightText: 'rgba(73, 41, 14, 0.96)',
      darkBg: 'rgba(73, 41, 14, 0.88)',
      darkText: 'rgba(251, 236, 221, 0.96)'
    },
    {
      lightBg: 'rgba(245, 224, 233, 0.92)',
      lightText: 'rgba(76, 35, 55, 0.96)',
      darkBg: 'rgba(76, 35, 55, 0.88)',
      darkText: 'rgba(245, 224, 233, 0.96)'
    },
    {
      lightBg: 'rgba(223, 235, 247, 0.92)',
      lightText: 'rgba(19, 56, 89, 0.96)',
      darkBg: 'rgba(19, 56, 89, 0.88)',
      darkText: 'rgba(223, 235, 247, 0.96)'
    },
    {
      lightBg: 'rgba(255, 226, 221, 0.92)',
      lightText: 'rgba(93, 23, 21, 0.96)',
      darkBg: 'rgba(93, 23, 21, 0.88)',
      darkText: 'rgba(255, 226, 221, 0.96)'
    },
    {
      lightBg: 'rgba(251, 243, 219, 0.92)',
      lightText: 'rgba(64, 44, 27, 0.96)',
      darkBg: 'rgba(64, 44, 27, 0.88)',
      darkText: 'rgba(251, 243, 219, 0.96)'
    }
  ];

  let isEditing = $state(false);
  let isDarkMode = $state(
    typeof document !== 'undefined'
      ? document.documentElement.classList.contains('theme-dark') || document.body.classList.contains('theme-dark')
      : false
  );
  let draftTags = $state<string[]>([]);
  let inputValue = $state('');
  let highlightedSuggestionIndex = $state(0);
  let containerEl: HTMLDivElement | null = $state(null);
  let inputEl: HTMLInputElement | null = $state(null);

  let displayTags = $derived(card.tags || []);
  let activeTags = $derived(isEditing ? draftTags : displayTags);
  let visibleDisplayTags = $derived(displayTags.slice(0, 3));
  let hiddenDisplayTagCount = $derived(Math.max(0, displayTags.length - visibleDisplayTags.length));

  let normalizedAvailableTags = $derived(
    Array.from(new Set((availableTags || []).map((tag) => tag.trim()).filter(Boolean)))
  );

  let filteredSuggestions = $derived.by(() => {
    const selected = new Set(draftTags.map((tag) => tag.toLowerCase()));
    const keyword = inputValue.trim().toLowerCase();

    const suggestions = normalizedAvailableTags.filter((tag) => {
      if (selected.has(tag.toLowerCase())) return false;
      if (!keyword) return true;
      return tag.toLowerCase().includes(keyword);
    });

    suggestions.sort((a, b) => {
      if (!keyword) return a.localeCompare(b, 'zh-CN');

      const aStarts = a.toLowerCase().startsWith(keyword) ? 0 : 1;
      const bStarts = b.toLowerCase().startsWith(keyword) ? 0 : 1;
      if (aStarts !== bStarts) return aStarts - bStarts;

      return a.localeCompare(b, 'zh-CN');
    });

    return suggestions.slice(0, 8);
  });

  $effect(() => {
    highlightedSuggestionIndex = 0;
  });

  onMount(() => createThemeListener((isDark) => {
    isDarkMode = isDark;
  }));

  function getTagColorIndex(tag: string): number {
    let hash = 0;
    for (let i = 0; i < tag.length; i += 1) {
      hash = ((hash << 5) - hash) + tag.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash) % colorPalette.length;
  }

  function getTagStyle(tag: string): string {
    const palette = colorPalette[getTagColorIndex(tag)];
    const background = isDarkMode ? palette.darkBg : palette.lightBg;
    const color = isDarkMode ? palette.darkText : palette.lightText;
    const border = `color-mix(in srgb, ${color} 18%, transparent)`;
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
    if (event.key === 'Enter') {
      event.preventDefault();

      if (inputValue.trim()) {
        addTag(inputValue);
      } else if (filteredSuggestions.length > 0) {
        addTag(filteredSuggestions[highlightedSuggestionIndex] ?? filteredSuggestions[0]);
      } else {
        finishEditing();
      }
      return;
    }

    if (event.key === 'Tab' && filteredSuggestions.length > 0) {
      event.preventDefault();
      addTag(filteredSuggestions[highlightedSuggestionIndex] ?? filteredSuggestions[0]);
      return;
    }

    if (event.key === 'ArrowDown' && filteredSuggestions.length > 0) {
      event.preventDefault();
      highlightedSuggestionIndex = (highlightedSuggestionIndex + 1) % filteredSuggestions.length;
      return;
    }

    if (event.key === 'ArrowUp' && filteredSuggestions.length > 0) {
      event.preventDefault();
      highlightedSuggestionIndex =
        (highlightedSuggestionIndex - 1 + filteredSuggestions.length) % filteredSuggestions.length;
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
      <div class="weave-tags-suggestions">
        <div class="weave-suggestions-header">
          <span class="weave-suggestions-title">{labels.suggestionsTitle}</span>
          <span class="weave-suggestions-shortcuts">{labels.shortcutsHint}</span>
        </div>
        {#if filteredSuggestions.length > 0}
          {#each filteredSuggestions as suggestion, index (suggestion)}
            <button
              type="button"
              class="weave-suggestion-chip"
              class:is-highlighted={index === highlightedSuggestionIndex}
              onclick={(event) => {
                isolateCellInteraction(event);
                addTag(suggestion);
              }}
            >
              <span class="weave-suggestion-dot" style={getTagStyle(suggestion)}></span>
              <span class="weave-suggestion-text">{suggestion}</span>
            </button>
          {/each}
        {:else if inputValue.trim()}
          <div class="weave-suggestion-empty">
            {labels.createHintPrefix} “{inputValue.trim()}”
          </div>
        {:else if normalizedAvailableTags.length === 0}
          <div class="weave-suggestion-empty">{labels.noSuggestions}</div>
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
  }

  .weave-tags-cell {
    position: relative;
    display: flex;
    align-items: flex-start;
    min-height: 34px;
    width: 100%;
    padding: 5px 8px;
    border: 1px solid transparent;
    border-radius: 10px;
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
    box-shadow: 0 6px 18px rgba(15, 23, 42, 0.10);
  }

  .weave-tags-flow {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
    width: 100%;
    min-height: 22px;
    padding-right: 20px;
  }

  .weave-tag-pill {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    max-width: 100%;
    min-height: 22px;
    padding: 0 8px;
    border: 1px solid transparent;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 600;
    line-height: 1;
    transition: transform 0.15s ease, box-shadow 0.15s ease;
  }

  .weave-tags-cell:not(.is-editing) .weave-tag-pill:hover {
    transform: translateY(-1px);
    box-shadow: 0 2px 8px rgba(15, 23, 42, 0.08);
  }

  .weave-tag-summary {
    display: inline-flex;
    align-items: center;
    min-height: 22px;
    padding: 0 8px;
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
    max-width: 96px;
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
    background: rgba(255, 255, 255, 0.28);
  }

  .weave-tag-input {
    min-width: 86px;
    flex: 1 1 90px;
    height: 24px;
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
    min-height: 22px;
    color: var(--text-faint);
    font-size: 12px;
  }

  .weave-tags-edit-hint {
    position: absolute;
    top: 50%;
    right: 8px;
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
    right: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding: 8px;
    background: color-mix(in srgb, var(--weave-table-page-bg, var(--background-primary)) 94%, transparent);
    border: 1px solid var(--background-modifier-border);
    border-radius: 12px;
    box-shadow: 0 12px 24px rgba(15, 23, 42, 0.12);
    backdrop-filter: blur(12px);
    z-index: 30;
  }

  .weave-suggestions-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    width: 100%;
    margin-bottom: 2px;
    padding: 0 2px;
  }

  .weave-suggestions-title {
    font-size: 11px;
    font-weight: 700;
    color: var(--text-normal);
    letter-spacing: 0.01em;
  }

  .weave-suggestions-shortcuts {
    font-size: 10px;
    color: var(--text-muted);
    white-space: nowrap;
  }

  .weave-suggestion-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 26px;
    max-width: 100%;
    padding: 0 10px;
    border: 1px solid var(--background-modifier-border);
    border-radius: 999px;
    background: var(--weave-table-surface-bg, var(--background-secondary));
    color: var(--text-normal);
    cursor: pointer;
    transition: border-color 0.16s ease, background-color 0.16s ease, transform 0.16s ease;
  }

  .weave-suggestion-chip:hover,
  .weave-suggestion-chip.is-highlighted {
    border-color: color-mix(in srgb, var(--interactive-accent) 45%, var(--background-modifier-border));
    background: color-mix(in srgb, var(--interactive-accent) 10%, var(--weave-table-surface-bg, var(--background-secondary)));
    transform: translateY(-1px);
  }

  .weave-suggestion-dot {
    width: 10px;
    height: 10px;
    border: 1px solid transparent;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .weave-suggestion-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
    font-weight: 500;
  }

  .weave-suggestion-empty {
    display: flex;
    align-items: center;
    min-height: 26px;
    color: var(--text-muted);
    font-size: 12px;
    padding: 0 2px;
  }
</style>
