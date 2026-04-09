import { App, Modal } from "obsidian";
import { mount, unmount } from "svelte";
import type { Deck } from "../../data/types";
import type WeavePlugin from "../../main";
import { showObsidianConfirm } from "../../utils/obsidian-confirm";
import AIActionManager from "./AIActionManager.svelte";

export interface AIActionManagerObsidianOptions {
	plugin: WeavePlugin;
	availableDecks: Deck[];
	onClose?: () => void;
}

export class AIActionManagerObsidian extends Modal {
	private component: any = null;
	private readonly options: AIActionManagerObsidianOptions;
	private hasUnsavedChanges = false;
	private isForceClosing = false;

	constructor(app: App, options: AIActionManagerObsidianOptions) {
		super(app);
		this.options = options;
	}

	onOpen() {
		this.setTitle("AI功能配置");
		this.modalEl.addClass("weave-ai-action-manager-host");
		this.modalEl.setCssProps({
			display: "flex",
			"flex-direction": "column",
			width: "92vw",
			"max-width": "1200px",
			height: "86vh",
			"max-height": "86vh",
		});

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
				onClose: () => this.forceClose(),
				onUnsavedChangesChange: (dirty: boolean) => {
					this.hasUnsavedChanges = dirty;
				},
			},
		});
	}

	close() {
		if (this.isForceClosing) {
			super.close();
			return;
		}

		void this.requestClose();
	}

	private async requestClose() {
		if (this.hasUnsavedChanges) {
			const confirmed = await showObsidianConfirm(
				this.app,
				"当前有未保存的AI功能配置更改，关闭后这些更改会丢失。确定仍要关闭吗？",
				{ title: "放弃未保存更改", confirmText: "仍然关闭" }
			);

			if (!confirmed) {
				return;
			}
		}

		this.forceClose();
	}

	private forceClose() {
		this.isForceClosing = true;
		super.close();
	}

	onClose() {
		if (this.component) {
			void unmount(this.component);
			this.component = null;
		}

		this.hasUnsavedChanges = false;
		this.isForceClosing = false;
		this.contentEl.empty();
		this.options.onClose?.();
	}
}
