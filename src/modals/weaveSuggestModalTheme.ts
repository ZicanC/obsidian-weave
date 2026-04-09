const STYLE_ID = "weave-suggest-modal-theme";

const THEME_CSS = `
.suggestion-container.weave-batch-tag-suggest-popover,
.suggestion-container.weave-ir-deck-suggest-popover {
  padding: 6px;
  border-radius: 14px;
}

.suggestion-container.weave-batch-tag-suggest-popover .suggestion,
.suggestion-container.weave-ir-deck-suggest-popover .suggestion {
  padding: 0;
}

.suggestion-container.weave-batch-tag-suggest-popover .suggestion-item,
.suggestion-container.weave-ir-deck-suggest-popover .suggestion-item {
  padding: 8px 10px;
  margin: 2px 0;
  border-radius: 10px;
}

.suggestion-container.weave-batch-tag-suggest-popover .suggestion-item.is-selected,
.suggestion-container.weave-ir-deck-suggest-popover .suggestion-item.is-selected {
  background: var(--background-modifier-hover);
}

.suggestion-container .weave-batch-tag-suggestion,
.suggestion-container .weave-ir-deck-suggestion {
  display: flex;
  align-items: center;
  min-width: 0;
}

.suggestion-container .weave-batch-tag-suggestion__row,
.suggestion-container .weave-ir-deck-suggestion-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-width: 0;
  flex-wrap: nowrap;
}

.suggestion-container .weave-batch-tag-suggestion__icon,
.suggestion-container .weave-ir-deck-suggestion-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 18px;
  height: 18px;
  color: var(--text-muted);
}

.suggestion-container .weave-batch-tag-suggestion__title,
.suggestion-container .weave-ir-deck-suggestion-name {
  display: block;
  flex: 1 1 auto;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--text-normal);
  font-size: 0.92rem;
  font-weight: 600;
  line-height: 1.35;
}
`;

export function ensureWeaveSuggestModalTheme(): void {
	if (typeof document === "undefined") {
		return;
	}

	if (document.getElementById(STYLE_ID)) {
		return;
	}

	const styleEl = document.createElement("style");
	styleEl.id = STYLE_ID;
	styleEl.textContent = THEME_CSS;
	document.head.appendChild(styleEl);
}

export function markLatestSuggestionContainer(className: string): void {
	if (typeof document === "undefined") {
		return;
	}

	window.requestAnimationFrame(() => {
		const containers = Array.from(document.querySelectorAll(".suggestion-container")) as HTMLElement[];
		const latest = containers.at(-1);
		if (!latest) {
			return;
		}

		latest.classList.add(className);
	});
}
