import { App, Menu, Modal, Setting, normalizePath } from "obsidian";
import { VaultFolderSuggestModal } from "./VaultFolderSuggestModal";

export interface SelectionToIRSubmitPayload {
	title: string;
	deckId: string;
	folderPath: string;
}

interface SelectionToIRPreferenceUpdate {
	folderPath?: string;
}

interface SelectionToIRModalOptions {
	deckOptions: Array<{ id: string; name: string }>;
	initialDeckId?: string;
	initialTitle: string;
	initialFolder: string;
	titleDetected: boolean;
	onSubmit: (payload: SelectionToIRSubmitPayload) => Promise<void>;
	onPreferenceChange?: (update: SelectionToIRPreferenceUpdate) => Promise<void> | void;
}

function normalizeFolderPath(folderPath: string): string {
	const raw = String(folderPath || "").trim();
	if (!raw || raw === "/" || raw === ".") {
		return "/";
	}

	return normalizePath(raw);
}

export class SelectionToIRModal extends Modal {
	private readonly options: SelectionToIRModalOptions;
	private draftTitle: string;
	private selectedDeckId: string;
	private selectedFolder: string;
	private titleInputEl: HTMLInputElement | null = null;
	private deckButtonEl: HTMLButtonElement | null = null;
	private folderButtonEl: HTMLButtonElement | null = null;
	private createButtonEl: HTMLButtonElement | null = null;
	private creating = false;

	constructor(app: App, options: SelectionToIRModalOptions) {
		super(app);
		this.options = options;
		this.draftTitle = options.initialTitle;
		this.selectedDeckId = String(options.initialDeckId || "").trim();
		this.selectedFolder = normalizeFolderPath(options.initialFolder);
	}

	onOpen(): void {
		this.titleEl.setText("从选区创建增量阅读点");
		this.modalEl.setCssProps({ width: "min(720px, 92vw)" });

		const { contentEl } = this;
		contentEl.empty();

		const headerPanelEl = contentEl.createDiv();
		headerPanelEl.setCssProps({
			display: "flex",
			"flex-direction": "column",
			gap: "12px",
			padding: "16px",
			"margin-bottom": "16px",
			"border-radius": "12px",
			border: "1px solid var(--background-modifier-border)",
			"background-color": "var(--background-secondary)",
		});

		const deckToolbarEl = headerPanelEl.createDiv();
		deckToolbarEl.setCssProps({
			display: "flex",
			"flex-direction": "column",
			"align-items": "stretch",
			gap: "8px",
		});

		const deckInfoEl = deckToolbarEl.createDiv();
		deckInfoEl.setCssProps({ flex: "1" });
		deckInfoEl.createDiv({
			text: "所属专题",
			cls: "setting-item-name",
		});
		deckInfoEl.createDiv({
			text: "点击下拉菜单选择增量阅读专题。",
			cls: "setting-item-description",
		});

		this.deckButtonEl = deckToolbarEl.createEl("button", {
			text: this.getDeckButtonText(),
		});
		this.applyPickerButtonStyle(this.deckButtonEl);
		this.deckButtonEl.addEventListener("click", (evt) => {
			this.showDeckMenu(evt as MouseEvent);
		});

		const folderToolbarEl = headerPanelEl.createDiv();
		folderToolbarEl.setCssProps({
			display: "flex",
			"flex-direction": "column",
			"align-items": "stretch",
			gap: "8px",
		});

		const folderInfoEl = folderToolbarEl.createDiv();
		folderInfoEl.setCssProps({ flex: "1" });
		folderInfoEl.createDiv({
			text: "保存路径",
			cls: "setting-item-name",
		});
		folderInfoEl.createDiv({
			text: "默认保存在 Obsidian 库根目录，也可以切换到其他文件夹。",
			cls: "setting-item-description",
		});

		this.folderButtonEl = folderToolbarEl.createEl("button", {
			text: this.getFolderButtonText(),
		});
		this.applyPickerButtonStyle(this.folderButtonEl);
		this.folderButtonEl.addEventListener("click", () => {
			void this.showFolderPicker();
		});

		const titleDesc = this.options.titleDetected
			? "已从选中文本中自动提取标题，你可以继续修改。"
			: "未检测到明确标题，已先用选中文本前缀生成标题。";

		new Setting(contentEl)
			.setName("标题")
			.setDesc(titleDesc)
			.addText((text) => {
				text.setValue(this.draftTitle);
				text.setPlaceholder("输入阅读点标题");
				text.inputEl.setCssProps({ width: "100%" });
				this.titleInputEl = text.inputEl;
				text.onChange((value) => {
					this.draftTitle = value;
					this.syncCreateButtonState();
				});
			});

		const footerEl = contentEl.createDiv();
		footerEl.setCssProps({
			display: "flex",
			"justify-content": "flex-end",
			gap: "8px",
			"margin-top": "16px",
		});

		const cancelButton = footerEl.createEl("button", { text: "取消" });
		cancelButton.addEventListener("click", () => this.close());

		this.createButtonEl = footerEl.createEl("button", { text: "创建阅读点" });
		this.createButtonEl.classList.add("mod-cta");
		this.createButtonEl.addEventListener("click", () => {
			void this.handleCreate();
		});
		this.syncCreateButtonState();

		this.scope.register([], "Enter", (evt: KeyboardEvent) => {
			if (evt.metaKey || evt.ctrlKey) {
				evt.preventDefault();
				void this.handleCreate();
			}
		});

		window.setTimeout(() => {
			this.titleInputEl?.focus();
			this.titleInputEl?.select();
		}, 0);
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private getFolderButtonText(): string {
		return `保存到：${this.getFolderDisplayName(this.selectedFolder)}`;
	}

	private getDeckButtonText(): string {
		const selectedDeck = this.options.deckOptions.find((deck) => deck.id === this.selectedDeckId);
		return selectedDeck ? `专题：${selectedDeck.name}` : "选择增量阅读专题";
	}

	private getFolderDisplayName(folderPath: string): string {
		const normalized = normalizeFolderPath(folderPath);
		if (normalized === "/") {
			return "库根目录";
		}

		const exists = this.app.vault.getAbstractFileByPath(normalized);
		return exists ? normalized : `${normalized}（创建）`;
	}

	private applyPickerButtonStyle(buttonEl: HTMLButtonElement): void {
		buttonEl.setCssProps({
			display: "inline-flex",
			"align-items": "center",
			"justify-content": "space-between",
			gap: "8px",
			width: "100%",
			padding: "8px 12px",
			"border-radius": "8px",
			border: "1px solid var(--background-modifier-border)",
			"background-color": "var(--background-primary)",
			"white-space": "nowrap",
			overflow: "hidden",
			"text-overflow": "ellipsis",
			"box-shadow": "none",
		});
	}

	private showDeckMenu(evt: MouseEvent): void {
		const menu = new Menu();

		for (const deck of this.options.deckOptions) {
			menu.addItem((item) => {
				item
					.setTitle(deck.name)
					.setChecked(deck.id === this.selectedDeckId)
					.onClick(() => {
						this.selectedDeckId = deck.id;
						if (this.deckButtonEl) {
							this.deckButtonEl.textContent = this.getDeckButtonText();
						}
						this.syncCreateButtonState();
					});
			});
		}

		menu.showAtMouseEvent(evt);
	}

	private async showFolderPicker(): Promise<void> {
		const picker = new VaultFolderSuggestModal(this.app, {
			placeholder: "选择阅读点保存路径...",
		});
		const folderPath = await picker.openAndSelect();
		if (!folderPath) {
			return;
		}

		this.selectedFolder = normalizeFolderPath(folderPath);
		if (this.folderButtonEl) {
			this.folderButtonEl.textContent = this.getFolderButtonText();
		}
		void Promise.resolve(
			this.options.onPreferenceChange?.({ folderPath: this.selectedFolder })
		).catch(() => undefined);
	}

	private async handleCreate(): Promise<void> {
		if (this.creating) {
			return;
		}

		if (!this.selectedDeckId) {
			return;
		}

		this.draftTitle = this.titleInputEl?.value ?? this.draftTitle;
		if (!this.draftTitle.trim()) {
			this.syncCreateButtonState();
			return;
		}

		this.creating = true;
		if (this.createButtonEl) {
			this.createButtonEl.disabled = true;
			this.createButtonEl.textContent = "创建中...";
		}

		try {
			await this.options.onSubmit({
				title: this.draftTitle,
				deckId: this.selectedDeckId,
				folderPath: this.selectedFolder,
			});
			this.close();
		} catch {
			// The caller is responsible for surfacing a user-facing error notice.
		} finally {
			this.creating = false;
			if (this.createButtonEl) {
				this.createButtonEl.textContent = "创建阅读点";
			}
			this.syncCreateButtonState();
		}
	}

	private syncCreateButtonState(): void {
		if (!this.createButtonEl) {
			return;
		}

		const title = (this.titleInputEl?.value ?? this.draftTitle).trim();
		this.createButtonEl.disabled = this.creating || !this.selectedDeckId || !title;
	}
}
