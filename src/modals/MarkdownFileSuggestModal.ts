import { App, FuzzySuggestModal, TFile } from "obsidian";

interface MarkdownFileSuggestModalOptions {
	placeholder?: string;
	excludePath?: string;
}

export class MarkdownFileSuggestModal extends FuzzySuggestModal<TFile> {
	private readonly items: TFile[];
	private resolver: ((file: TFile | null) => void) | null = null;
	private selectedFile: TFile | null = null;
	private settled = false;
	private closeTimer: number | null = null;

	constructor(app: App, options: MarkdownFileSuggestModalOptions = {}) {
		super(app);
		this.items = app.vault
			.getMarkdownFiles()
			.filter((file) => !options.excludePath || file.path !== options.excludePath);
		this.setPlaceholder(options.placeholder ?? "选择 Markdown 笔记...");
	}

	getItems(): TFile[] {
		return this.items;
	}

	getItemText(file: TFile): string {
		return file.path;
	}

	private settle(file: TFile | null): void {
		if (this.settled) {
			return;
		}

		this.settled = true;
		if (this.closeTimer !== null) {
			window.clearTimeout(this.closeTimer);
			this.closeTimer = null;
		}

		const resolver = this.resolver;
		this.resolver = null;
		resolver?.(file);
	}

	onChooseItem(file: TFile): void {
		this.selectedFile = file;
		this.settle(file);
	}

	onClose(): void {
		super.onClose();
		if (this.settled) {
			this.selectedFile = null;
			return;
		}

		if (this.closeTimer !== null) {
			window.clearTimeout(this.closeTimer);
		}

		// Obsidian 在鼠标点击建议项时，关闭与选择回调可能存在时序竞争。
		// 将“未选择 -> null”延后一拍，让真实选择优先落地。
		this.closeTimer = window.setTimeout(() => {
			this.closeTimer = null;
			const selectedFile = this.selectedFile;
			this.selectedFile = null;
			this.settle(selectedFile);
		}, 0);
	}

	openAndSelect(): Promise<TFile | null> {
		return new Promise((resolve) => {
			if (this.closeTimer !== null) {
				window.clearTimeout(this.closeTimer);
				this.closeTimer = null;
			}
			this.resolver = resolve;
			this.selectedFile = null;
			this.settled = false;
			this.open();
		});
	}
}
