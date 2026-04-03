import { App, Modal } from "obsidian";
import { mount, unmount } from "svelte";
import { i18n } from "../../utils/i18n";
import IRReviewReminderModal from "./IRReviewReminderModal.svelte";

export interface IRReviewReminderModalObsidianOptions {
	initialDate: string;
	initialTime: string;
	onConfirm: (date: string, time: string) => void;
	onClose?: () => void;
}

export class IRReviewReminderModalObsidian extends Modal {
	private component: Parameters<typeof unmount>[0] | null = null;
	private readonly options: IRReviewReminderModalObsidianOptions;

	constructor(app: App, options: IRReviewReminderModalObsidianOptions) {
		super(app);
		this.options = options;
	}

	onOpen() {
		this.setTitle(i18n.getCurrentLanguage() === "zh-CN" ? "设置复习提醒" : "Set Review Reminder");
		this.modalEl.addClass("weave-ir-review-reminder-modal");
		this.modalEl.setCssProps({
			display: "flex",
			"flex-direction": "column",
			width: "90vw",
			"max-width": "520px",
		});

		this.contentEl.empty();
		this.contentEl.addClass("weave-ir-review-reminder-modal-content");
		this.contentEl.setCssProps({
			display: "flex",
			"flex-direction": "column",
			flex: "1",
			"min-height": "0",
			padding: "0",
			overflow: "hidden",
		});

		this.component = mount(IRReviewReminderModal, {
			target: this.contentEl,
			props: {
				initialDate: this.options.initialDate,
				initialTime: this.options.initialTime,
				useObsidianModal: true,
				onCancel: () => this.close(),
				onConfirm: (date: string, time: string) => this.options.onConfirm(date, time),
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
