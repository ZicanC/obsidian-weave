import { type App, SuggestModal, setIcon } from "obsidian";
import type { IRDeck } from "../types/ir-types";
import { ensureWeaveSuggestModalTheme, markLatestSuggestionContainer } from "./weaveSuggestModalTheme";

export class IRDeckSelectorModal extends SuggestModal<IRDeck> {
	private decks: IRDeck[];
	private onSelect: (deck: IRDeck) => void;

	constructor(app: App, decks: IRDeck[], onSelect: (deck: IRDeck) => void) {
		super(app);
		this.decks = decks;
		this.onSelect = onSelect;

		this.setPlaceholder("搜索增量阅读专题...");
		this.setInstructions([
			{ command: "↑↓", purpose: "导航" },
			{ command: "↵", purpose: "选择" },
			{ command: "esc", purpose: "关闭" },
		]);
	}

	getSuggestions(query: string): IRDeck[] {
		if (!query) return this.decks;
		const q = query.toLowerCase();
		return this.decks.filter(
			(d) => d.name.toLowerCase().includes(q) || d.id.toLowerCase().includes(q)
		);
	}

	onOpen(): void {
		void super.onOpen();
		ensureWeaveSuggestModalTheme();
		markLatestSuggestionContainer("weave-ir-deck-suggest-popover");
	}

	renderSuggestion(deck: IRDeck, el: HTMLElement): void {
		el.addClass("weave-ir-deck-suggestion");
		el.style.padding = "0";

		const row = el.createDiv({ cls: "weave-ir-deck-suggestion-row" });
		row.style.display = "flex";
		row.style.alignItems = "center";
		row.style.gap = "8px";
		row.style.width = "100%";
		row.style.minWidth = "0";
		row.style.flexWrap = "nowrap";

		const iconEl = row.createSpan({ cls: "weave-ir-deck-suggestion-icon" });
		iconEl.style.display = "inline-flex";
		iconEl.style.alignItems = "center";
		iconEl.style.justifyContent = "center";
		iconEl.style.flex = "0 0 auto";
		iconEl.style.width = "18px";
		iconEl.style.height = "18px";
		setIcon(iconEl, "folder");

		const nameEl = row.createSpan({ text: deck.name, cls: "weave-ir-deck-suggestion-name" });
		nameEl.style.display = "block";
		nameEl.style.flex = "1 1 auto";
		nameEl.style.minWidth = "0";
		nameEl.style.whiteSpace = "nowrap";
		nameEl.style.overflow = "hidden";
		nameEl.style.textOverflow = "ellipsis";
	}

	onChooseSuggestion(deck: IRDeck, _evt: MouseEvent | KeyboardEvent): void {
		this.onSelect(deck);
		this.close();
	}
}
