import { App, Modal } from "obsidian";
import { mount, unmount } from "svelte";
import type { AnkiModelInfo } from "../../../types/ankiconnect-types";
import type { DeckSyncMapping } from "../types/settings-types";
import CardTypeMappingModalContent from "./CardTypeMappingModalContent.svelte";

export interface CardTypeMappingModalObsidianOptions {
	mappingId: string;
	mapping: DeckSyncMapping;
	ankiModels: AnkiModelInfo[];
	isConnected?: boolean;
	onUpdateMapping: (id: string, updates: Partial<DeckSyncMapping>) => void;
	onClose?: () => void;
}

export class CardTypeMappingModalObsidian extends Modal {
	private component: any = null;
	private readonly options: CardTypeMappingModalObsidianOptions;

	constructor(app: App, options: CardTypeMappingModalObsidianOptions) {
		super(app);
		this.options = options;
	}

	onOpen() {
		this.setTitle("题型字段映射");
		this.modalEl.addClass("weave-card-type-mapping-modal");
		this.modalEl.setCssProps({
			display: "flex",
			"flex-direction": "column",
			width: "96vw",
			"max-width": "1280px",
			height: "auto",
			"max-height": "88vh",
		});

		this.contentEl.empty();
		this.contentEl.addClass("weave-card-type-mapping-modal-content");
		this.contentEl.setCssProps({
			display: "flex",
			"flex-direction": "column",
			flex: "0 1 auto",
			"min-height": "auto",
			padding: "0 20px 18px 20px",
			overflow: "auto",
		});

		this.component = mount(CardTypeMappingModalContent, {
			target: this.contentEl,
			props: {
				mappingId: this.options.mappingId,
				mapping: this.options.mapping,
				ankiModels: this.options.ankiModels,
				isConnected: this.options.isConnected,
				onUpdateMapping: this.options.onUpdateMapping,
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
