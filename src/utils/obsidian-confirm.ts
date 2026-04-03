import { App, Modal } from "obsidian";

export interface ConfirmOptions {
	title?: string;
	confirmText?: string;
	cancelText?: string;
	confirmClass?: string;
}

export function showObsidianConfirm(
	app: App,
	message: string,
	options: ConfirmOptions = {}
): Promise<boolean> {
	const {
		title = "确认",
		confirmText = "确认",
		cancelText = "取消",
		confirmClass = "mod-warning",
	} = options;

	return new Promise((resolve) => {
		const modal = new Modal(app);
		modal.titleEl.setText(title);

		const messageEl = modal.contentEl.createDiv({ cls: "obsidian-confirm-message" });
		message.split("\n").forEach((line) => {
			if (line.trim()) {
				messageEl.createEl("p", { text: line });
			}
		});

		const buttonContainer = modal.contentEl.createDiv({ cls: "obsidian-confirm-buttons" });
		buttonContainer.setCssProps({
			display: "flex",
			"justify-content": "flex-end",
			gap: "10px",
			"margin-top": "16px",
		});

		let confirmed = false;

		const cancelButton = buttonContainer.createEl("button", { text: cancelText });
		cancelButton.onclick = () => modal.close();

		const confirmButton = buttonContainer.createEl("button", {
			text: confirmText,
			cls: confirmClass,
		});
		confirmButton.onclick = () => {
			confirmed = true;
			modal.close();
		};

		modal.onClose = () => resolve(confirmed);
		modal.open();
	});
}

export function showDeleteConfirm(
	app: App,
	itemName: string,
	customMessage?: string
): Promise<boolean> {
	const message = customMessage || `确定要删除 "${itemName}" 吗？`;
	return showObsidianConfirm(app, message, {
		title: "确认删除",
		confirmText: "删除",
		confirmClass: "mod-warning",
	});
}

export function showDangerConfirm(app: App, message: string, title = "警告"): Promise<boolean> {
	return showObsidianConfirm(app, message, {
		title,
		confirmText: "确认",
		confirmClass: "mod-warning",
	});
}

export interface ChoiceOption<T extends string> {
	value: T;
	text: string;
	description?: string;
	className?: string;
}

export interface ChoiceDialogOptions<T extends string> {
	title?: string;
	choices: ChoiceOption<T>[];
	cancelText?: string;
	layout?: "vertical" | "horizontal";
}

export interface InputOptions {
	title?: string;
	placeholder?: string;
	confirmText?: string;
	cancelText?: string;
}

export function showObsidianChoice<T extends string>(
	app: App,
	message: string,
	options: ChoiceDialogOptions<T>
): Promise<T | null> {
	const { title = "请选择", choices, cancelText = "取消", layout = "vertical" } = options;

	return new Promise((resolve) => {
		const modal = new Modal(app);
		modal.titleEl.setText(title);

		if (message) {
			const messageEl = modal.contentEl.createDiv({ cls: "obsidian-confirm-message" });
			message.split("\n").forEach((line) => {
				if (line.trim()) {
					messageEl.createEl("p", { text: line });
				}
			});
		}

		const choiceContainer = modal.contentEl.createDiv({ cls: "obsidian-choice-buttons" });
		choiceContainer.setCssProps({
			display: "flex",
			"flex-direction": layout === "horizontal" ? "row" : "column",
			"align-items": "stretch",
			gap: "12px",
			"margin-top": "16px",
		});

		let result: T | null = null;

		for (const choice of choices) {
			const optionEl = choiceContainer.createDiv({ cls: "obsidian-choice-option" });
			optionEl.setCssProps({
				display: "flex",
				"flex-direction": "column",
				gap: "4px",
				flex: layout === "horizontal" ? "1" : "unset",
			});

			const button = optionEl.createEl("button", {
				text: choice.text,
				cls: choice.className || "mod-cta",
			});
			button.style.textAlign = layout === "horizontal" ? "center" : "left";
			button.setCssProps({ width: "100%" });

			if (choice.description) {
				const desc = optionEl.createDiv({ text: choice.description });
				desc.addClass("setting-item-description");
			}

			button.onclick = () => {
				result = choice.value;
				modal.close();
			};
		}

		const buttonContainer = modal.contentEl.createDiv({ cls: "obsidian-confirm-buttons" });
		buttonContainer.setCssProps({
			display: "flex",
			"justify-content": "flex-end",
			gap: "10px",
			"margin-top": "16px",
		});

		const cancelButton = buttonContainer.createEl("button", { text: cancelText });
		cancelButton.onclick = () => modal.close();

		modal.onClose = () => resolve(result);
		modal.open();
	});
}

export function showObsidianInput(
	app: App,
	message: string,
	defaultValue = "",
	options: InputOptions = {}
): Promise<string | null> {
	const { title = "输入", placeholder = "", confirmText = "确认", cancelText = "取消" } = options;

	return new Promise((resolve) => {
		const modal = new Modal(app);
		modal.titleEl.setText(title);

		if (message) {
			modal.contentEl.createEl("p", { text: message });
		}

		const inputEl = modal.contentEl.createEl("input", {
			type: "text",
			value: defaultValue,
			placeholder,
		});
		inputEl.setCssProps({
			width: "100%",
			"margin-top": "8px",
			"margin-bottom": "16px",
		});

		const buttonContainer = modal.contentEl.createDiv({ cls: "obsidian-input-buttons" });
		buttonContainer.setCssProps({
			display: "flex",
			"justify-content": "flex-end",
			gap: "10px",
		});

		let result: string | null = null;

		const cancelButton = buttonContainer.createEl("button", { text: cancelText });
		cancelButton.onclick = () => modal.close();

		const confirmButton = buttonContainer.createEl("button", {
			text: confirmText,
			cls: "mod-cta",
		});
		confirmButton.onclick = () => {
			result = inputEl.value;
			modal.close();
		};

		inputEl.addEventListener("keydown", (event) => {
			if (event.key === "Enter") {
				result = inputEl.value;
				modal.close();
			}
		});

		modal.onClose = () => resolve(result);
		modal.open();
		inputEl.focus();
		inputEl.select();
	});
}
