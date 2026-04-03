import { App, Modal } from "obsidian";
import { mount, unmount } from "svelte";
import type WeavePlugin from "../../main";
import type { BatchImportResult } from "../../services/incremental-reading/ReadingMaterialManager";
import MaterialImportModal from "./MaterialImportModal.svelte";

export interface MaterialImportModalObsidianOptions {
	plugin: WeavePlugin;
	onImportComplete?: (result: BatchImportResult) => void;
	onClose?: () => void;
}

export class MaterialImportModalObsidian extends Modal {
	private component: Parameters<typeof unmount>[0] | null = null;
	private readonly options: MaterialImportModalObsidianOptions;

	constructor(app: App, options: MaterialImportModalObsidianOptions) {
		super(app);
		this.options = options;
	}

	onOpen() {
		this.setTitle("导入阅读材料");
		this.modalEl.addClass("weave-material-import-modal");
		this.modalEl.setCssProps({
			display: "flex",
			"flex-direction": "column",
			width: "92vw",
			"max-width": "1120px",
			height: "84vh",
			"max-height": "84vh",
			"min-height": "0",
			overflow: "hidden",
		});

		this.contentEl.empty();
		this.contentEl.addClass("weave-material-import-modal-content");
		this.contentEl.setCssProps({
			display: "flex",
			"flex-direction": "column",
			flex: "1",
			"min-height": "0",
			padding: "0",
			overflow: "hidden",
		});

		this.component = mount(MaterialImportModal, {
			target: this.contentEl,
			props: {
				plugin: this.options.plugin,
				open: true,
				useObsidianModal: true,
				onClose: () => this.close(),
				onImportComplete: (result: BatchImportResult) => {
					this.options.onImportComplete?.(result);
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
