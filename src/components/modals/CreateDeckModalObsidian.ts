import { App, Modal } from "obsidian";
import { mount, unmount } from "svelte";
import type { WeaveDataStorage } from "../../data/storage";
import type { Deck } from "../../data/types";
import type WeavePlugin from "../../main";
import { t } from "../../utils/i18n";
import CreateDeckModal from "./CreateDeckModal.svelte";

export interface CreateDeckModalObsidianOptions {
	plugin: WeavePlugin;
	dataStorage: WeaveDataStorage;
	mode?: "create" | "edit";
	initialDeck?: Deck | null;
	onCreated?: (deck: Deck) => void;
	onUpdated?: (deck: Deck) => void;
	onClose?: () => void;
}

export class CreateDeckModalObsidian extends Modal {
	private component: any = null;
	private readonly options: CreateDeckModalObsidianOptions;

	constructor(app: App, options: CreateDeckModalObsidianOptions) {
		super(app);
		this.options = options;
	}

	onOpen() {
		const mode = this.options.mode ?? "create";
		this.setTitle(
			mode === "edit" ? t("modals.createDeck.titleEdit") : t("modals.createDeck.titleCreate")
		);
		this.modalEl.addClass("weave-create-deck-modal");
		this.modalEl.setCssProps({
			display: "flex",
			"flex-direction": "column",
			width: "88vw",
			"max-width": "640px",
			height: "auto",
			"max-height": "80vh",
		});

		this.contentEl.empty();
		this.contentEl.addClass("weave-create-deck-modal-content");
		this.contentEl.setCssProps({
			display: "flex",
			"flex-direction": "column",
			flex: "1",
			"min-height": "0",
			padding: "0",
			overflow: "auto",
		});

		this.component = mount(CreateDeckModal, {
			target: this.contentEl,
			props: {
				open: true,
				useObsidianModal: true,
				plugin: this.options.plugin,
				dataStorage: this.options.dataStorage,
				mode,
				initialDeck: this.options.initialDeck ?? null,
				onClose: () => this.close(),
				onCreated: (deck: Deck) => this.options.onCreated?.(deck),
				onUpdated: (deck: Deck) => this.options.onUpdated?.(deck),
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
