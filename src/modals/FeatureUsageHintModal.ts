import { App, Modal, Setting } from "obsidian";

interface FeatureUsageHintModalOptions {
	title: string;
	intro: string;
	listItems: string[];
	note: string;
	onConfirm: (dismissPermanently: boolean) => void | Promise<void>;
}

export class FeatureUsageHintModal extends Modal {
	private dismissPermanently = false;
	private readonly options: FeatureUsageHintModalOptions;

	constructor(app: App, options: FeatureUsageHintModalOptions) {
		super(app);
		this.options = options;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("weave-feature-usage-hint-modal");
		this.setTitle(this.options.title);

		const intro = contentEl.createEl("p", { text: this.options.intro });
		intro.addClass("weave-feature-usage-hint-intro");

		const list = contentEl.createEl("ul", { cls: "weave-feature-usage-hint-list" });
		for (const itemText of this.options.listItems) {
			list.createEl("li", { text: itemText });
		}

		const note = contentEl.createEl("p", { text: this.options.note });
		note.addClass("weave-feature-usage-hint-note");

		new Setting(contentEl)
			.setName("永久不再显示")
			.setDesc("勾选后，后续点击该功能键时不再弹出此提示")
			.addToggle((toggle) =>
				toggle.setValue(false).onChange((value) => {
					this.dismissPermanently = value;
				})
			);

		const actions = contentEl.createDiv({ cls: "weave-feature-usage-hint-actions" });
		const confirmBtn = actions.createEl("button", {
			text: "知道了",
			cls: "mod-cta",
		});
		confirmBtn.addEventListener("click", () => {
			void this.handleConfirm();
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private async handleConfirm(): Promise<void> {
		await this.options.onConfirm(this.dismissPermanently);
		this.close();
	}
}
