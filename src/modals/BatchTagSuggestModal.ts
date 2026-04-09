import { App, SuggestModal, setIcon } from "obsidian";
import { ensureWeaveSuggestModalTheme, markLatestSuggestionContainer } from "./weaveSuggestModalTheme";

interface AnchorRect {
	left: number;
	right: number;
	top: number;
	bottom: number;
	width: number;
	height: number;
}

export interface BatchTagSuggestItem {
	tag: string;
	label: string;
	icon?: string;
	keywords?: string[];
}

export class BatchTagSuggestModal extends SuggestModal<BatchTagSuggestItem> {
	private readonly items: BatchTagSuggestItem[];
	private readonly onSelect: (item: BatchTagSuggestItem) => void;
	private readonly anchorRect?: AnchorRect;

	constructor(
		app: App,
		items: BatchTagSuggestItem[],
		onSelect: (item: BatchTagSuggestItem) => void,
		options?: {
			placeholder?: string;
			anchorRect?: AnchorRect;
		}
	) {
		super(app);
		this.items = items;
		this.onSelect = onSelect;
		this.anchorRect = options?.anchorRect;

		this.setPlaceholder(options?.placeholder ?? "搜索标签...");
		this.setInstructions([
			{ command: "↑↓", purpose: "选择标签" },
			{ command: "Enter", purpose: "确认" },
			{ command: "Esc", purpose: "关闭" },
		]);
	}

	getSuggestions(query: string): BatchTagSuggestItem[] {
		const normalizedQuery = query.trim().toLowerCase();
		if (!normalizedQuery) {
			return this.items;
		}

		return this.items.filter((item) => {
			const haystacks = [
				item.label,
				item.tag,
				...(item.keywords ?? []),
			];
			return haystacks.some((value) => value.toLowerCase().includes(normalizedQuery));
		});
	}

	onOpen(): void {
		super.onOpen();
		ensureWeaveSuggestModalTheme();
		markLatestSuggestionContainer("weave-batch-tag-suggest-popover");
		this.positionNearAnchor();
	}

	renderSuggestion(item: BatchTagSuggestItem, el: HTMLElement): void {
		el.addClass("weave-batch-tag-suggestion");
		el.style.padding = "0";

		const row = el.createDiv({ cls: "weave-batch-tag-suggestion__row" });
		row.style.display = "flex";
		row.style.alignItems = "center";
		row.style.gap = "8px";
		row.style.width = "100%";
		row.style.minWidth = "0";
		row.style.flexWrap = "nowrap";

		const iconEl = row.createSpan({ cls: "weave-batch-tag-suggestion__icon" });
		iconEl.style.display = "inline-flex";
		iconEl.style.alignItems = "center";
		iconEl.style.justifyContent = "center";
		iconEl.style.flex = "0 0 auto";
		iconEl.style.width = "18px";
		iconEl.style.height = "18px";
		setIcon(iconEl, item.icon ?? "tag");

		const titleEl = row.createSpan({
			text: item.label,
			cls: "weave-batch-tag-suggestion__title",
		});
		titleEl.style.display = "block";
		titleEl.style.flex = "1 1 auto";
		titleEl.style.minWidth = "0";
		titleEl.style.whiteSpace = "nowrap";
		titleEl.style.overflow = "hidden";
		titleEl.style.textOverflow = "ellipsis";
	}

	onChooseSuggestion(item: BatchTagSuggestItem, _evt: MouseEvent | KeyboardEvent): void {
		this.onSelect(item);
	}

	private positionNearAnchor(): void {
		if (!this.anchorRect || typeof window === "undefined") {
			return;
		}
		const anchorRect = this.anchorRect;

		const place = () => {
			const modalEl = this.modalEl;
			const containerEl = this.containerEl;
			if (!modalEl || !containerEl) {
				return;
			}

			const viewportWidth = window.innerWidth;
			const viewportHeight = window.innerHeight;
			const spacing = 12;
			const preferredWidth = Math.min(320, viewportWidth - 24);

			modalEl.style.position = "fixed";
			modalEl.style.width = `${preferredWidth}px`;
			modalEl.style.maxWidth = `${preferredWidth}px`;
			modalEl.style.margin = "0";
			modalEl.style.transform = "none";

			const modalRect = modalEl.getBoundingClientRect();
			let left = anchorRect.right + spacing;
			if (left + modalRect.width > viewportWidth - 12) {
				left = anchorRect.left - modalRect.width - spacing;
			}
			left = Math.max(12, Math.min(left, viewportWidth - modalRect.width - 12));

			let top = anchorRect.top + anchorRect.height / 2 - modalRect.height / 2;
			if (top + modalRect.height > viewportHeight - 12) {
				top = viewportHeight - modalRect.height - 12;
			}
			top = Math.max(12, top);

			containerEl.style.alignItems = "flex-start";
			containerEl.style.justifyContent = "flex-start";
			modalEl.style.left = `${Math.round(left)}px`;
			modalEl.style.top = `${Math.round(top)}px`;
		};

		window.requestAnimationFrame(place);
	}
}
