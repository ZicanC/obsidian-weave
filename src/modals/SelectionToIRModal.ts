import { App, Menu, Modal, Setting, normalizePath } from "obsidian";

export type SelectionToIRSourceBacklinkPosition = "start" | "end";

export interface SelectionToIRSubmitPayload {
	title: string;
	body: string;
	folderPath: string;
	deleteSourceSelection: boolean;
	backlinkPosition: SelectionToIRSourceBacklinkPosition;
	sourceDocumentBacklinkPosition: SelectionToIRSourceBacklinkPosition;
}

interface SelectionToIRPreferenceUpdate {
	folderPath?: string;
	deleteSourceSelection?: boolean;
	backlinkPosition?: SelectionToIRSourceBacklinkPosition;
	sourceDocumentBacklinkPosition?: SelectionToIRSourceBacklinkPosition;
}

interface SelectionToIRModalOptions {
	sourceFileBasename: string;
	initialTitle: string;
	initialBody: string;
	initialFolder: string;
	titleDetected: boolean;
	folderOptions: string[];
	deleteSourceSelection: boolean;
	backlinkPosition: SelectionToIRSourceBacklinkPosition;
	sourceDocumentBacklinkPosition: SelectionToIRSourceBacklinkPosition;
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

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export class SelectionToIRModal extends Modal {
	private readonly options: SelectionToIRModalOptions;
	private readonly sourceBacklink: string;
	private draftTitle: string;
	private draftBody: string;
	private selectedFolder: string;
	private deleteSourceSelection: boolean;
	private backlinkPosition: SelectionToIRSourceBacklinkPosition;
	private sourceDocumentBacklinkPosition: SelectionToIRSourceBacklinkPosition;
	private sourceBacklinkManaged = true;
	private titleInputEl: HTMLInputElement | null = null;
	private bodyTextareaEl: HTMLTextAreaElement | null = null;
	private folderButtonEl: HTMLButtonElement | null = null;
	private createButtonEl: HTMLButtonElement | null = null;
	private creating = false;

	constructor(app: App, options: SelectionToIRModalOptions) {
		super(app);
		this.options = {
			...options,
			folderOptions: Array.from(
				new Set((options.folderOptions || []).map((folder) => normalizeFolderPath(folder)))
			),
		};
		this.sourceBacklink = `[[${options.sourceFileBasename}]]`;
		this.draftTitle = options.initialTitle;
		this.selectedFolder = normalizeFolderPath(options.initialFolder);
		this.deleteSourceSelection = Boolean(options.deleteSourceSelection);
		this.backlinkPosition = options.backlinkPosition;
		this.sourceDocumentBacklinkPosition = options.sourceDocumentBacklinkPosition;
		this.draftBody = this.applyManagedSourceBacklinkPosition(options.initialBody);
	}

	onOpen(): void {
		this.titleEl.setText("从选区创建增量阅读点");
		this.modalEl.setCssProps({ width: "min(720px, 92vw)" });

		const { contentEl } = this;
		contentEl.empty();

		const toolbarEl = contentEl.createDiv();
		toolbarEl.setCssProps({
			display: "flex",
			"align-items": "center",
			"justify-content": "space-between",
			gap: "12px",
			"margin-bottom": "12px",
		});

		const folderInfoEl = toolbarEl.createDiv();
		folderInfoEl.setCssProps({ flex: "1" });
		folderInfoEl.createDiv({
			text: "保存路径",
			cls: "setting-item-name",
		});
		folderInfoEl.createDiv({
			text: "使用 Obsidian 菜单选择保存位置。",
			cls: "setting-item-description",
		});

		this.folderButtonEl = toolbarEl.createEl("button", {
			text: this.getFolderButtonText(),
		});
		this.folderButtonEl.classList.add("mod-cta");
		this.folderButtonEl.setCssProps({
			"max-width": "320px",
			"white-space": "nowrap",
			overflow: "hidden",
			"text-overflow": "ellipsis",
		});
		this.folderButtonEl.addEventListener("click", (evt) => {
			this.showFolderMenu(evt as MouseEvent);
		});

		const sourceHintEl = contentEl.createDiv({ cls: "setting-item-description" });
		sourceHintEl.setText(`来源文档双链：${this.sourceBacklink}`);
		sourceHintEl.setCssProps({ "margin-bottom": "12px" });

		new Setting(contentEl)
			.setName("阅读点正文来源双链位置")
			.setDesc("切换后会同步更新下方正文中的来源文档双链位置。")
			.addDropdown((dropdown) => {
				dropdown
					.addOption("start", "放在开头")
					.addOption("end", "放在末尾")
					.setValue(this.backlinkPosition)
					.onChange((value) => {
						const nextPosition = value === "end" ? "end" : "start";
						this.backlinkPosition = nextPosition;

						const rawBody = this.bodyTextareaEl?.value ?? this.draftBody;
						if (this.sourceBacklinkManaged || !this.bodyContainsSourceBacklink(rawBody)) {
							this.draftBody = this.applyManagedSourceBacklinkPosition(rawBody);
							this.sourceBacklinkManaged = true;
							if (this.bodyTextareaEl) {
								this.bodyTextareaEl.value = this.draftBody;
							}
						} else {
							this.draftBody = rawBody;
						}

						void Promise.resolve(
							this.options.onPreferenceChange?.({ backlinkPosition: nextPosition })
						).catch(() => undefined);
					});
			});

		new Setting(contentEl)
			.setName("源文档回链位置")
			.setDesc("创建后会把新阅读点双链写回源文档，可放在 YAML 后开头或文末。")
			.addDropdown((dropdown) => {
				dropdown
					.addOption("start", "放在开头")
					.addOption("end", "放在末尾")
					.setValue(this.sourceDocumentBacklinkPosition)
					.onChange((value) => {
						const nextPosition = value === "end" ? "end" : "start";
						this.sourceDocumentBacklinkPosition = nextPosition;
						void Promise.resolve(
							this.options.onPreferenceChange?.({ sourceDocumentBacklinkPosition: nextPosition })
						).catch(() => undefined);
					});
			});

		const titleDesc = this.options.titleDetected
			? "已从选中文本中自动提取标题，你可以继续修改。"
			: "未检测到明确标题，已先用正文前缀生成标题。";

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
				});
			});

		const bodyWrapEl = contentEl.createDiv();
		bodyWrapEl.setCssProps({
			"margin-top": "12px",
			"margin-bottom": "12px",
		});

		bodyWrapEl.createDiv({
			text: "正文",
			cls: "setting-item-name",
		});
		bodyWrapEl.createDiv({
			text: "创建时会把标题放在 YAML 后的正文开头，正文内容默认已包含来源双链。",
			cls: "setting-item-description",
		});

		this.bodyTextareaEl = bodyWrapEl.createEl("textarea");
		this.bodyTextareaEl.value = this.draftBody;
		this.bodyTextareaEl.rows = 14;
		this.bodyTextareaEl.setCssProps({
			width: "100%",
			"min-height": "260px",
			"margin-top": "8px",
			resize: "vertical",
		});
		this.bodyTextareaEl.addEventListener("input", () => {
			this.draftBody = this.bodyTextareaEl?.value ?? "";
			this.sourceBacklinkManaged = this.hasManagedSourceBacklink(this.draftBody);
		});

		new Setting(contentEl)
			.setName("创建后删除源文档选中文本")
			.setDesc("会记住这次选择，方便下次继续使用。")
			.addToggle((toggle) => {
				toggle.setValue(this.deleteSourceSelection);
				toggle.onChange((value) => {
					this.deleteSourceSelection = value;
					void Promise.resolve(
						this.options.onPreferenceChange?.({ deleteSourceSelection: value })
					).catch(() => undefined);
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

	private getFolderDisplayName(folderPath: string): string {
		const normalized = normalizeFolderPath(folderPath);
		if (normalized === "/") {
			return "库根目录";
		}

		const exists = this.app.vault.getAbstractFileByPath(normalized);
		return exists ? normalized : `${normalized}（创建）`;
	}

	private showFolderMenu(evt: MouseEvent): void {
		const menu = new Menu();

		for (const folderPath of this.options.folderOptions) {
			const normalized = normalizeFolderPath(folderPath);
			menu.addItem((item) => {
				item
					.setTitle(this.getFolderDisplayName(normalized))
					.setChecked(normalized === this.selectedFolder)
					.onClick(() => {
						this.selectedFolder = normalized;
						if (this.folderButtonEl) {
							this.folderButtonEl.textContent = this.getFolderButtonText();
						}
						void Promise.resolve(
							this.options.onPreferenceChange?.({ folderPath: normalized })
						).catch(() => undefined);
					});
			});
		}

		menu.showAtMouseEvent(evt);
	}

	private async handleCreate(): Promise<void> {
		if (this.creating) {
			return;
		}

		this.draftTitle = this.titleInputEl?.value ?? this.draftTitle;
		const rawBody = this.bodyTextareaEl?.value ?? this.draftBody;
		this.draftBody = this.sourceBacklinkManaged
			? this.applyManagedSourceBacklinkPosition(rawBody)
			: rawBody;

		this.creating = true;
		if (this.createButtonEl) {
			this.createButtonEl.disabled = true;
			this.createButtonEl.textContent = "创建中...";
		}

		try {
			await this.options.onSubmit({
				title: this.draftTitle,
				body: this.draftBody,
				folderPath: this.selectedFolder,
				deleteSourceSelection: this.deleteSourceSelection,
				backlinkPosition: this.backlinkPosition,
				sourceDocumentBacklinkPosition: this.sourceDocumentBacklinkPosition,
			});
			this.close();
		} catch {
			// The caller is responsible for surfacing a user-facing error notice.
		} finally {
			this.creating = false;
			if (this.createButtonEl) {
				this.createButtonEl.disabled = false;
				this.createButtonEl.textContent = "创建阅读点";
			}
		}
	}

	private normalizeBodyText(body: string): string {
		return String(body || "")
			.replace(/\r\n?/g, "\n")
			.trim();
	}

	private bodyContainsSourceBacklink(body: string): boolean {
		return this.normalizeBodyText(body).includes(this.sourceBacklink);
	}

	private hasManagedSourceBacklink(body: string): boolean {
		const normalized = this.normalizeBodyText(body);
		if (!normalized) {
			return false;
		}

		const escapedBacklink = escapeRegExp(this.sourceBacklink);
		const startsWithManagedBacklink = new RegExp(`^${escapedBacklink}(?:\\n{2,}|\\n|$)`).test(
			normalized
		);
		const endsWithManagedBacklink = new RegExp(`(?:^|\\n|\\n{2,})${escapedBacklink}$`).test(
			normalized
		);
		return startsWithManagedBacklink || endsWithManagedBacklink;
	}

	private stripManagedSourceBacklink(body: string): string {
		const normalized = this.normalizeBodyText(body);
		if (!normalized) {
			return "";
		}

		const escapedBacklink = escapeRegExp(this.sourceBacklink);
		return normalized
			.replace(new RegExp(`^${escapedBacklink}(?:\\n{2,}|\\n)?`), "")
			.replace(new RegExp(`(?:\\n{2,}|\\n)?${escapedBacklink}$`), "")
			.trim();
	}

	private applyManagedSourceBacklinkPosition(body: string): string {
		const content = this.stripManagedSourceBacklink(body);
		if (!content) {
			return this.sourceBacklink;
		}

		return this.backlinkPosition === "end"
			? `${content}\n\n${this.sourceBacklink}`
			: `${this.sourceBacklink}\n\n${content}`;
	}
}
