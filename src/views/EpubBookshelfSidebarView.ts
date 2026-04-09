import { type EventRef, ItemView, WorkspaceLeaf } from "obsidian";
import type { WeavePlugin } from "../main";
import { logger } from "../utils/logger";
import { getViewSurfaceTokens } from "../utils/view-location-utils";

export const VIEW_TYPE_EPUB_BOOKSHELF_SIDEBAR = "weave-epub-bookshelf-sidebar";

export class EpubBookshelfSidebarView extends ItemView {
	private component: object | null = null;
	private plugin: WeavePlugin;
	private layoutChangeRef: EventRef | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: WeavePlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_EPUB_BOOKSHELF_SIDEBAR;
	}

	getDisplayText(): string {
		return "EPUB 书架";
	}

	getIcon(): string {
		return "book-open";
	}

	async onOpen(): Promise<void> {
		this.contentEl.empty();
		this.contentEl.addClass("weave-epub-sidebar-view");
		this.applySurfaceContext();
		this.layoutChangeRef = this.app.workspace.on("layout-change", () => {
			this.applySurfaceContext();
		});

		try {
			const { mount } = await import("svelte");
			const { default: BookshelfView } = await import("../components/epub/BookshelfView.svelte");

			this.component = mount(BookshelfView, {
				target: this.contentEl,
				props: {
					app: this.app,
					onClose: () => {},
					onSwitchBook: async (filePath: string) => {
						await this.plugin.openEpubReader(filePath);
					},
				},
			});

			logger.debug("[EpubBookshelfSidebarView] Bookshelf component mounted");
		} catch (error) {
			logger.error("[EpubBookshelfSidebarView] Failed to mount bookshelf:", error);
			this.contentEl.empty();
			this.contentEl.createDiv({
				cls: "epub-error",
				text: "书架加载失败",
			});
		}
	}

	private applySurfaceContext(): void {
		const surfaceTokens = getViewSurfaceTokens(this.leaf);
		const targets = [this.contentEl, this.contentEl.parentElement].filter(Boolean) as HTMLElement[];

		for (const target of targets) {
			target.dataset.weaveSurfaceContext = surfaceTokens.context;
			target.style.setProperty("--weave-surface-background", surfaceTokens.surfaceBackground);
			target.style.setProperty("--weave-elevated-background", surfaceTokens.elevatedBackground);
		}
	}

	async onClose(): Promise<void> {
		if (this.layoutChangeRef) {
			this.app.workspace.offref(this.layoutChangeRef);
			this.layoutChangeRef = null;
		}

		if (this.component) {
			const { unmount } = await import("svelte");
			try {
				void unmount(this.component);
			} catch (_error) {
				// ignore
			}
			this.component = null;
		}
	}
}
