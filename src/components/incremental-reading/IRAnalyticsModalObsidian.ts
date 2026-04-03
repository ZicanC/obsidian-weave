import { App, Modal } from "obsidian";
import { mount, unmount } from "svelte";
import type AnkiObsidianPlugin from "../../main";
import { i18n } from "../../utils/i18n";
import IRAnalyticsModal from "./IRAnalyticsModal.svelte";

export interface IRAnalyticsModalObsidianOptions {
	plugin: AnkiObsidianPlugin;
	onClose?: () => void;
}

export class IRAnalyticsModalObsidian extends Modal {
	private component: Parameters<typeof unmount>[0] | null = null;
	private readonly options: IRAnalyticsModalObsidianOptions;

	constructor(app: App, options: IRAnalyticsModalObsidianOptions) {
		super(app);
		this.options = options;
	}

	onOpen() {
		this.setTitle(
			i18n.getCurrentLanguage() === "zh-CN" ? "增量阅读分析图表" : "Incremental Reading Analytics"
		);
		this.modalEl.addClass("weave-ir-analytics-modal");
		this.modalEl.setCssProps({
			display: "flex",
			"flex-direction": "column",
			width: "94vw",
			"max-width": "1260px",
			height: "84vh",
			"max-height": "84vh",
		});

		this.contentEl.empty();
		this.contentEl.addClass("weave-ir-analytics-modal-content");
		this.contentEl.setCssProps({
			display: "flex",
			"flex-direction": "column",
			flex: "1",
			"min-height": "0",
			padding: "0",
			overflow: "hidden",
		});

		this.component = mount(IRAnalyticsModal, {
			target: this.contentEl,
			props: {
				plugin: this.options.plugin,
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
