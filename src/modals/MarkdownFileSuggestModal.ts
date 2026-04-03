import { App, FuzzySuggestModal, TFile } from "obsidian";

interface MarkdownFileSuggestModalOptions {
	placeholder?: string;
	excludePath?: string;
}

export class MarkdownFileSuggestModal extends FuzzySuggestModal<TFile> {
	private readonly items: TFile[];
	private resolver: ((file: TFile | null) => void) | null = null;

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

	onChooseItem(file: TFile): void {
		if (this.resolver) {
			this.resolver(file);
			this.resolver = null;
		}
	}

	onClose(): void {
		super.onClose();
		if (this.resolver) {
			this.resolver(null);
			this.resolver = null;
		}
	}

	openAndSelect(): Promise<TFile | null> {
		return new Promise((resolve) => {
			this.resolver = resolve;
			this.open();
		});
	}
}
