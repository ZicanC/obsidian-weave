import { App, Modal } from "obsidian";
import { mount, unmount } from "svelte";
import type { WeaveDataStorage } from "../../data/storage";
import type WeavePlugin from "../../main";
import ClipboardImportModal from "./ClipboardImportModal.svelte";

export interface ClipboardImportModalObsidianOptions {
	plugin: WeavePlugin;
	dataStorage: WeaveDataStorage;
	onImportComplete?: (deckId: string, cardCount: number) => void;
	onClose?: () => void;
}

export class ClipboardImportModalObsidian extends Modal {
	private component: any = null;
	private readonly options: ClipboardImportModalObsidianOptions;

	constructor(app: App, options: ClipboardImportModalObsidianOptions) {
		super(app);
		this.options = options;
	}

	onOpen() {
		this.setTitle("粘贴卡片批量导入");
		this.modalEl.addClass("weave-clipboard-import-modal");
		this.modalEl.setCssProps({
			display: "flex",
			"flex-direction": "column",
			width: "92vw",
			"max-width": "1040px",
			height: "82vh",
			"max-height": "82vh",
		});

		this.contentEl.empty();
		this.contentEl.addClass("weave-clipboard-import-modal-content");
		this.contentEl.setCssProps({
			display: "flex",
			"flex-direction": "column",
			flex: "1",
			"min-height": "0",
			padding: "0 18px 18px 18px",
			overflow: "hidden",
		});

		this.component = mount(ClipboardImportModal, {
			target: this.contentEl,
			props: {
				open: true,
				useObsidianModal: true,
				plugin: this.options.plugin,
				dataStorage: this.options.dataStorage,
				onClose: () => this.close(),
				onImportComplete: (deckId: string, cardCount: number) => {
					this.options.onImportComplete?.(deckId, cardCount);
				},
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
