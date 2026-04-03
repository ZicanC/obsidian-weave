import { App, Modal } from "obsidian";
import { mount, unmount } from "svelte";
import type { IRBlock } from "../../types/ir-types";
import { i18n } from "../../utils/i18n";
import IRBlockInfoModal from "./IRBlockInfoModal.svelte";

export interface IRBlockInfoModalObsidianOptions {
	block: IRBlock;
	onClose?: () => void;
}

export class IRBlockInfoModalObsidian extends Modal {
	private component: Parameters<typeof unmount>[0] | null = null;
	private readonly options: IRBlockInfoModalObsidianOptions;

	constructor(app: App, options: IRBlockInfoModalObsidianOptions) {
		super(app);
		this.options = options;
	}

	onOpen() {
		this.setTitle(
			i18n.getCurrentLanguage() === "zh-CN" ? "内容块信息与来源" : "Block Info & Source"
		);
		this.modalEl.addClass("weave-ir-block-info-modal");
		this.modalEl.setCssProps({
			display: "flex",
			"flex-direction": "column",
			width: "92vw",
			"max-width": "760px",
			height: "84vh",
			"max-height": "84vh",
		});

		this.contentEl.empty();
		this.contentEl.addClass("weave-ir-block-info-modal-content");
		this.contentEl.setCssProps({
			display: "flex",
			"flex-direction": "column",
			flex: "1",
			"min-height": "0",
			padding: "0",
			overflow: "hidden",
		});

		this.component = mount(IRBlockInfoModal, {
			target: this.contentEl,
			props: {
				block: this.options.block,
				app: this.app,
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
