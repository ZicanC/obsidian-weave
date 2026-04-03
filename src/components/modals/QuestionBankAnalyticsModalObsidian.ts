import { App, Modal } from "obsidian";
import { mount, unmount } from "svelte";
import type { Deck } from "../../data/types";
import type { WeavePlugin } from "../../main";
import QuestionBankAnalyticsModal from "./QuestionBankAnalyticsModal.svelte";

export interface QuestionBankAnalyticsModalObsidianOptions {
	plugin: WeavePlugin;
	questionBank: Deck;
	onClose?: () => void;
}

export class QuestionBankAnalyticsModalObsidian extends Modal {
	private component: any = null;
	private readonly options: QuestionBankAnalyticsModalObsidianOptions;

	constructor(app: App, options: QuestionBankAnalyticsModalObsidianOptions) {
		super(app);
		this.options = options;
	}

	onOpen() {
		this.setTitle(`${this.options.questionBank.name} - 题库分析`);
		this.modalEl.addClass("weave-question-bank-analytics-modal");
		this.modalEl.setCssProps({
			display: "flex",
			"flex-direction": "column",
			width: "88vw",
			"max-width": "1080px",
			height: "80vh",
			"max-height": "80vh",
		});

		this.contentEl.empty();
		this.contentEl.addClass("weave-question-bank-analytics-modal-content");
		this.contentEl.setCssProps({
			display: "flex",
			"flex-direction": "column",
			flex: "1",
			"min-height": "0",
			padding: "0",
			overflow: "hidden",
		});

		this.component = mount(QuestionBankAnalyticsModal, {
			target: this.contentEl,
			props: {
				plugin: this.options.plugin,
				questionBank: this.options.questionBank,
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
