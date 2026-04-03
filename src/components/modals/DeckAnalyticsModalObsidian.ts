import { App, Modal } from "obsidian";
import { mount, unmount } from "svelte";
import type { Card } from "../../data/types";
import type WeavePlugin from "../../main";
import DeckAnalyticsModal from "./DeckAnalyticsModal.svelte";

export interface DeckAnalyticsModalObsidianOptions {
	plugin: WeavePlugin;
	deckId?: string;
	cards?: Card[];
	initialTab?: "retention" | "quantity" | "timing" | "difficulty" | "loadForecast";
	onClose?: () => void;
}

export class DeckAnalyticsModalObsidian extends Modal {
	private component: any = null;
	private readonly options: DeckAnalyticsModalObsidianOptions;

	constructor(app: App, options: DeckAnalyticsModalObsidianOptions) {
		super(app);
		this.options = options;
	}

	onOpen() {
		this.setTitle("牌组分析");
		this.modalEl.addClass("weave-deck-analytics-modal");
		this.modalEl.setCssProps({
			display: "flex",
			"flex-direction": "column",
			width: "92vw",
			"max-width": "1180px",
			height: "82vh",
			"max-height": "82vh",
		});

		this.contentEl.empty();
		this.contentEl.addClass("weave-deck-analytics-modal-content");
		this.contentEl.setCssProps({
			display: "flex",
			"flex-direction": "column",
			flex: "1",
			"min-height": "0",
			padding: "0",
			overflow: "hidden",
		});

		this.component = mount(DeckAnalyticsModal, {
			target: this.contentEl,
			props: {
				plugin: this.options.plugin,
				deckId: this.options.deckId,
				cards: this.options.cards ?? [],
				initialTab: this.options.initialTab ?? "retention",
			},
		});
	}

	onClose() {
		if (this.component) {
			void unmount(this.component);
			this.component = null;
		}

		this.contentEl.empty();
		this.options.onClose?.();
	}
}
