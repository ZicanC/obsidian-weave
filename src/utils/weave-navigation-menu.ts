import type { Menu } from "obsidian";

export type WeavePageId = "deck-study" | "weave-card-management" | "ai-assistant";

export function addWeaveNavigationItems(
	menu: Menu,
	currentPage: string,
	onNavigate: (pageId: WeavePageId) => void
): void {
	menu.addItem((item) => {
		item
			.setTitle("牌组学习")
			.setIcon("graduation-cap")
			.setChecked(currentPage === "deck-study")
			.onClick(() => onNavigate("deck-study"));
	});

	menu.addItem((item) => {
		item
			.setTitle("卡片管理")
			.setIcon("list")
			.setChecked(currentPage === "weave-card-management")
			.onClick(() => onNavigate("weave-card-management"));
	});

	menu.addItem((item) => {
		item
			.setTitle("AI助手")
			.setIcon("bot")
			.setChecked(currentPage === "ai-assistant")
			.onClick(() => onNavigate("ai-assistant"));
	});
}
