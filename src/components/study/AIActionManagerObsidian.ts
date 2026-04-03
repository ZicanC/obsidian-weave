import { App, Modal } from "obsidian";
import { mount, unmount } from "svelte";
import type { Deck } from "../../data/types";
import type WeavePlugin from "../../main";
import AIActionManager from "./AIActionManager.svelte";

export interface AIActionManagerObsidianOptions {
	plugin: WeavePlugin;
	availableDecks: Deck[];
	onClose?: () => void;
}

export class AIActionManagerObsidian extends Modal {
	private component: any = null;
	private readonly options: AIActionManagerObsidianOptions;

	constructor(app: App, options: AIActionManagerObsidianOptions) {
		super(app);
		this.options = options;
	}

	onOpen() {
		this.modalEl.addClass("weave-ai-action-manager-host");
		this.modalEl.setCssProps({
			display: "flex",
			"flex-direction": "column",
			width: "92vw",
			"max-width": "1200px",
			height: "86vh",
			"max-height": "86vh",
		});

		const titleEl = this.modalEl.querySelector(".modal-title") as HTMLElement | null;
		if (titleEl) {
			titleEl.setCssProps({ display: "none" });
		}

		const closeButtonEl = this.modalEl.querySelector(".modal-close-button") as HTMLElement | null;
		if (closeButtonEl) {
			closeButtonEl.setCssProps({ display: "none" });
		}

		this.contentEl.empty();
		this.contentEl.addClass("weave-ai-action-manager-host-content");
		this.contentEl.setCssProps({
			display: "flex",
			"flex-direction": "column",
			flex: "1",
			"min-height": "0",
			padding: "0",
			overflow: "hidden",
		});

		this.component = mount(AIActionManager, {
			target: this.contentEl,
			props: {
				show: true,
				plugin: this.options.plugin,
				availableDecks: this.options.availableDecks,
				useObsidianModal: true,
				onClose: () => this.close(),
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
