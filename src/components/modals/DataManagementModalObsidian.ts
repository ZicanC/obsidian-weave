import { App, Modal } from "obsidian";
import { mount, unmount } from "svelte";
import type { Card } from "../../data/types";
import type WeavePlugin from "../../main";
import DataManagementModal from "./DataManagementModal.svelte";

export interface DataManagementModalObsidianOptions {
	plugin: WeavePlugin;
	cards?: Card[];
	allCards?: Card[];
	initialTab?: "data";
	onClose?: () => void;
}

export class DataManagementModalObsidian extends Modal {
	private component: any = null;
	private readonly options: DataManagementModalObsidianOptions;

	constructor(app: App, options: DataManagementModalObsidianOptions) {
		super(app);
		this.options = options;
	}

	onOpen() {
		this.setTitle("数据管理");
		this.modalEl.addClass("weave-data-management-modal");
		this.modalEl.setCssProps({
			display: "flex",
			"flex-direction": "column",
			width: "88vw",
			"max-width": "960px",
			height: "78vh",
			"max-height": "78vh",
		});

		this.contentEl.empty();
		this.contentEl.addClass("weave-data-management-modal-content");
		this.contentEl.setCssProps({
			display: "flex",
			"flex-direction": "column",
			flex: "1",
			"min-height": "0",
			padding: "0",
			overflow: "hidden",
		});

		this.component = mount(DataManagementModal, {
			target: this.contentEl,
			props: {
				plugin: this.options.plugin,
				cards: this.options.cards ?? [],
				allCards: this.options.allCards ?? [],
				initialTab: "data",
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
