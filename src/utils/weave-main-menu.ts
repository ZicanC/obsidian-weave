import { Menu, type WorkspaceLeaf } from "obsidian";
import { get } from "svelte/store";
import { PREMIUM_FEATURES, PremiumFeatureGuard } from "../services/premium/PremiumFeatureGuard";
import { isInSidebar } from "./view-location-utils";
import { addWeaveNavigationItems, type WeavePageId } from "./weave-navigation-menu";

export type WeaveCardDataSource = "memory" | "questionBank" | "incremental-reading";
export type WeaveCardViewType = "table" | "grid" | "kanban";
export type WeaveTableViewMode = "basic" | "review" | "questionBank" | "irContent";
export type WeaveGridLayoutMode = "fixed" | "masonry" | "timeline";
export type WeaveKanbanLayoutMode = "compact" | "comfortable" | "spacious";
export type WeaveIRTypeFilter = "all" | "md" | "pdf";

type NavigationVisibility = {
	apkgImport?: boolean;
	csvImport?: boolean;
	clipboardImport?: boolean;
	settingsEntry?: boolean;
};

export interface WeaveMainMenuOptions {
	currentPage: string;
	leaf?: WorkspaceLeaf;
	isInSidebarMode?: boolean;
	navigationVisibility?: NavigationVisibility;
	cardDataSource?: WeaveCardDataSource;
	currentView?: WeaveCardViewType;
	tableViewMode?: WeaveTableViewMode;
	gridLayoutMode?: WeaveGridLayoutMode;
	kanbanLayoutMode?: WeaveKanbanLayoutMode;
	irTypeFilter?: WeaveIRTypeFilter;
	documentFilterMode?: "all" | "current";
	currentActiveDocument?: string | null;
	enableCardLocationJump?: boolean;
	event?: MouseEvent;
	anchorEl?: HTMLElement | null;
	onNavigate: (pageId: WeavePageId) => void;
	onCardDataSourceChange?: (source: WeaveCardDataSource) => void;
	onViewChange?: (view: WeaveCardViewType) => void;
}

function dispatchWindowEvent<T>(eventName: string, detail: T): void {
	window.dispatchEvent(new CustomEvent(eventName, { detail }));
}

function dispatchDocumentEvent<T>(eventName: string, detail?: T): void {
	if (typeof detail === "undefined") {
		document.dispatchEvent(new CustomEvent(eventName));
		return;
	}

	document.dispatchEvent(new CustomEvent(eventName, { detail }));
}

function getAnchorPosition(anchorEl?: HTMLElement | null): { x: number; y: number } | null {
	if (!(anchorEl instanceof HTMLElement)) {
		return null;
	}

	const rect = anchorEl.getBoundingClientRect();
	return {
		x: Math.round(rect.left + rect.width / 2),
		y: Math.round(rect.bottom + 8),
	};
}

function createAnchoredMouseEvent(anchorEl?: HTMLElement | null): MouseEvent | null {
	const pos = getAnchorPosition(anchorEl);
	if (!pos) {
		return null;
	}

	return new MouseEvent("click", {
		bubbles: true,
		cancelable: true,
		clientX: pos.x,
		clientY: pos.y,
		screenX: pos.x,
		screenY: pos.y,
	});
}

function createViewportMouseEvent(): MouseEvent {
	const x = Math.round(window.innerWidth / 2);
	const y = Math.max(96, Math.round(window.innerHeight / 2));

	return new MouseEvent("click", {
		bubbles: true,
		cancelable: true,
		clientX: x,
		clientY: y,
		screenX: x,
		screenY: y,
	});
}

function showMenu(menu: Menu, event?: MouseEvent, anchorEl?: HTMLElement | null): void {
	if (event) {
		menu.showAtMouseEvent(event);
		return;
	}

	const pos = getAnchorPosition(anchorEl);
	if (pos) {
		menu.showAtPosition(pos);
		return;
	}

	menu.showAtPosition({
		x: Math.round(window.innerWidth / 2),
		y: Math.max(96, Math.round(window.innerHeight / 2)),
	});
}

function getPremiumState(guard: ReturnType<typeof PremiumFeatureGuard.getInstance>): {
	isPremium: boolean;
	showPremiumPreview: boolean;
} {
	return {
		isPremium: Boolean(get(guard.isPremiumActive)),
		showPremiumPreview: Boolean(get(guard.premiumFeaturesPreviewEnabled)),
	};
}

function shouldShowPremiumEntry(
	guard: ReturnType<typeof PremiumFeatureGuard.getInstance>,
	premiumState: ReturnType<typeof getPremiumState>,
	featureId: string
): boolean {
	return guard.shouldShowFeatureEntry(featureId, premiumState);
}

function getPremiumEntryTitle(
	guard: ReturnType<typeof PremiumFeatureGuard.getInstance>,
	baseTitle: string,
	featureId: string
): string {
	return guard.canUseFeature(featureId) ? baseTitle : `${baseTitle} (\u9ad8\u7ea7)`;
}

function emitCardManagementToolbarAction(action: string, anchor?: HTMLElement | null): void {
	dispatchWindowEvent("Weave:card-management-toolbar-action", {
		action,
		anchor: anchor ?? null,
	});
}

export function populateWeaveMainMenu(menu: Menu, options: WeaveMainMenuOptions): void {
	const premiumGuard = PremiumFeatureGuard.getInstance();
	const premiumState = getPremiumState(premiumGuard);
	const actionEvent =
		options.event ?? createAnchoredMouseEvent(options.anchorEl) ?? createViewportMouseEvent();
	const navigationVisibility = options.navigationVisibility ?? {};
	const currentView = options.currentView ?? "table";
	const cardDataSource = options.cardDataSource ?? "memory";
	const gridLayoutMode = options.gridLayoutMode ?? "fixed";
	const documentFilterMode = options.documentFilterMode ?? "all";
	const enableCardLocationJump = Boolean(options.enableCardLocationJump);
	const inSidebar = typeof options.isInSidebarMode === "boolean"
		? options.isInSidebarMode
		: options.leaf
			? isInSidebar(options.leaf)
			: false;

	addWeaveNavigationItems(menu, options.currentPage, options.onNavigate);

	menu.addSeparator();

	if (options.currentPage === "ai-assistant") {
		menu.addItem((item) => {
			item
				.setTitle("历史记录")
				.setIcon("history")
				.onClick(() => {
					dispatchWindowEvent("Weave:ai-toolbar-action", {
						action: "history",
					});
				});
		});

		menu.addItem((item) => {
			item
				.setTitle("选择模型")
				.setIcon("cpu")
				.onClick(() => {
					dispatchWindowEvent("Weave:ai-toolbar-action", {
						action: "provider",
					});
				});
		});

		menu.addItem((item) => {
			item
				.setTitle("AI制卡配置")
				.setIcon("settings")
				.onClick(() => {
					dispatchWindowEvent("Weave:ai-toolbar-action", {
						action: "config",
					});
				});
		});
	}

	if (options.currentPage === "deck-study") {
		menu.addItem((item) => {
			item
				.setTitle("\u5207\u6362\u89c6\u56fe")
				.setIcon("layout-grid")
				.onClick(() => {
					dispatchWindowEvent("show-view-menu", {
						event: actionEvent,
					});
				});
		});

		menu.addItem((item) => {
			item
				.setTitle("\u65b0\u5efa\u724c\u7ec4")
				.setIcon("folder-plus")
					.onClick(() => {
						dispatchDocumentEvent("create-deck", {
							event: actionEvent,
						});
					});
		});
	}

	if (options.currentPage === "weave-card-management") {
		menu.addItem((item) => {
			item.setTitle("\u6570\u636e\u6e90\u5207\u6362").setIcon("database");
			const submenu = (item as any).setSubmenu() as Menu;

			submenu.addItem((subItem: any) => {
				subItem
					.setTitle("\u8bb0\u5fc6\u724c\u7ec4")
					.setIcon("brain")
					.setChecked(cardDataSource === "memory")
					.onClick(() => {
						options.onCardDataSourceChange?.("memory");
						dispatchWindowEvent("Weave:card-data-source-change", "memory");
					});
			});

			if (shouldShowPremiumEntry(premiumGuard, premiumState, PREMIUM_FEATURES.INCREMENTAL_READING)) {
				submenu.addItem((subItem: any) => {
					const title = premiumGuard.canUseFeature(PREMIUM_FEATURES.INCREMENTAL_READING)
						? "\u589e\u91cf\u9605\u8bfb"
						: "\u589e\u91cf\u9605\u8bfb (\u9ad8\u7ea7)";

					subItem
						.setTitle(title)
						.setIcon("book-open")
						.setChecked(cardDataSource === "incremental-reading")
						.onClick(() => {
							options.onCardDataSourceChange?.("incremental-reading");
							dispatchWindowEvent("Weave:card-data-source-change", "incremental-reading");
						});
				});
			}

			if (shouldShowPremiumEntry(premiumGuard, premiumState, PREMIUM_FEATURES.QUESTION_BANK)) {
				submenu.addItem((subItem: any) => {
					const title = premiumGuard.canUseFeature(PREMIUM_FEATURES.QUESTION_BANK)
						? "\u8003\u8bd5\u9898\u7ec4"
						: "\u8003\u8bd5\u9898\u7ec4 (\u9ad8\u7ea7)";

					subItem
						.setTitle(title)
						.setIcon("edit-3")
						.setChecked(cardDataSource === "questionBank")
						.onClick(() => {
							options.onCardDataSourceChange?.("questionBank");
							dispatchWindowEvent("Weave:card-data-source-change", "questionBank");
						});
				});
			}
		});

		if (shouldShowPremiumEntry(premiumGuard, premiumState, PREMIUM_FEATURES.TIMELINE_VIEW) || currentView === "grid") {
			const gridLocked = !premiumGuard.canUseFeature(PREMIUM_FEATURES.GRID_VIEW);
			menu.addItem((item) => {
				item
					.setTitle(
						getPremiumEntryTitle(
							premiumGuard,
							"\u65f6\u95f4\u7ebf\u89c6\u56fe",
							PREMIUM_FEATURES.TIMELINE_VIEW
						)
					)
					.setIcon("history")
					.setChecked(currentView === "grid" && gridLayoutMode === "timeline")
					.onClick(() => {
						if (currentView !== "grid") {
							options.onViewChange?.("grid");
							if (gridLocked) {
								return;
							}
						}

						emitCardManagementToolbarAction("grid-layout-timeline");
					});
			});
		}

		if (inSidebar) {
			menu.addItem((item) => {
				item
					.setTitle("\u5173\u8054\u5f53\u524d\u6d3b\u52a8\u6587\u6863")
					.setIcon(documentFilterMode === "current" ? "file-text" : "file")
					.setChecked(documentFilterMode === "current")
					.setDisabled(!options.currentActiveDocument)
					.onClick(() => {
						if (options.currentActiveDocument) {
							emitCardManagementToolbarAction("toggle-document-filter");
						}
					});
			});

			menu.addItem((item) => {
				item
					.setTitle("\u5b9a\u4f4d\u8df3\u8f6c\u6a21\u5f0f")
					.setIcon("navigation")
					.setChecked(enableCardLocationJump)
					.onClick(() => {
						emitCardManagementToolbarAction("toggle-card-location-jump");
					});
			});
		}

		menu.addSeparator();
	}

	if (options.currentPage === "deck-study") {
		if (navigationVisibility.apkgImport !== false) {
			menu.addItem((item) => {
				item
					.setTitle("\u65e7\u7248APKG\u683c\u5f0f\u5bfc\u5165")
					.setIcon("package")
					.onClick(() => {
						dispatchDocumentEvent("apkg-import", {
							event: actionEvent,
						});
					});
			});
		}

		if (
			navigationVisibility.csvImport !== false &&
			shouldShowPremiumEntry(premiumGuard, premiumState, PREMIUM_FEATURES.CSV_IMPORT)
		) {
			menu.addItem((item) => {
				item
					.setTitle(
						getPremiumEntryTitle(
							premiumGuard,
							"\u5bfc\u5165CSV\u6587\u4ef6",
							PREMIUM_FEATURES.CSV_IMPORT
						)
					)
					.setIcon("file-text")
					.onClick(() => {
						dispatchDocumentEvent("csv-import", {
							event: actionEvent,
						});
					});
			});
		}

		if (
			navigationVisibility.clipboardImport !== false &&
			shouldShowPremiumEntry(premiumGuard, premiumState, PREMIUM_FEATURES.CLIPBOARD_IMPORT)
		) {
			menu.addItem((item) => {
				item
					.setTitle(
						getPremiumEntryTitle(
							premiumGuard,
							"\u7c98\u8d34\u5361\u7247\u6279\u91cf\u5bfc\u5165",
							PREMIUM_FEATURES.CLIPBOARD_IMPORT
						)
					)
					.setIcon("clipboard-paste")
					.onClick(() => {
						dispatchDocumentEvent("clipboard-import", {
							event: actionEvent,
						});
					});
			});
		}

		menu.addSeparator();

		menu.addItem((item) => {
			item.setTitle("\u64cd\u4f5c\u7ba1\u7406").setIcon("more-horizontal");
			const operationSubmenu = (item as any).setSubmenu() as Menu;

			operationSubmenu.addItem((subItem: any) => {
				subItem
					.setTitle("\u6062\u590d\u5b98\u65b9\u6559\u7a0b\u724c\u7ec4")
					.setIcon("book-open")
					.onClick(() => {
						dispatchDocumentEvent("Weave:restore-guide-deck");
					});
			});
		});

		if (navigationVisibility.settingsEntry !== false) {
			menu.addItem((item) => {
				item
					.setTitle("\u8bbe\u7f6e")
					.setIcon("settings")
					.onClick(() => {
						dispatchDocumentEvent("Weave:open-settings");
					});
			});
		}
	}
}

export function openWeaveMainMenu(options: WeaveMainMenuOptions): Menu {
	const menu = new Menu();
	populateWeaveMainMenu(menu, options);
	showMenu(menu, options.event, options.anchorEl);
	return menu;
}
