import {
	EpubDefaults,
	EpubNavigator,
	type EpubNavigatorListeners,
	EpubPreferences,
	type FXLFrameManager,
	type FrameManager,
	type IEpubDefaults,
	type IEpubPreferences,
} from "@readium/navigator";
import {
	type BasicTextSelection,
	type DecoratorRequest,
	Layout as DecorationLayout,
	Width as DecorationWidth,
} from "@readium/navigator-html-injectables";
import { Locator } from "@readium/shared";
import { type App, TFile } from "obsidian";
import { logger } from "../../utils/logger";
import {
	type ReadiumLoadedPublication,
	ReadiumVaultPublicationBridge,
} from "./ReadiumVaultPublicationBridge";
import { EpubCFI } from "./legacy-epub-cfi";
import type {
	EpubReaderEngine,
	HighlightClickInfo,
	NavigateAndHighlightOptions,
	ReaderAppearanceOptions,
	ReaderFrame,
	ReaderHighlight,
	ReaderHighlightInput,
	ReaderRenderOptions,
	ReaderSelectionChange,
} from "./reader-engine-types";
import {
	type ReadiumPaginatedFrameSnapshot,
	buildReadiumPaginatedFrameSnapshot,
} from "./readiumPaginationSupport";
import {
	READIUM_THEMEABLE_BACKGROUND_SELECTORS,
	READIUM_THEMEABLE_TEXT_SELECTORS,
	READIUM_THEME_DOCUMENT_ATTRIBUTE,
	markReadiumThemeDocument,
	normalizeReadiumThemeInlineStyles,
} from "./readiumThemeSupport";
import type {
	EpubBook,
	EpubFlowMode,
	EpubLayoutMode,
	EpubTheme,
	EpubWidthMode,
	PaginationInfo,
	ReadingPosition,
	TocItem,
} from "./types";

type ReadiumFrameContext = ReaderFrame & {
	frame: FrameManager | FXLFrameManager;
	frameSource: string;
	sectionIndex: number;
	sourceHref: string;
};

type LegacyStoredLocationPayload = {
	href?: string;
	locations?: {
		fragments?: string[];
		totalProgression?: number;
	};
	text?: {
		highlight?: string;
		before?: string;
		after?: string;
	};
};

export class ReadiumReaderService implements EpubReaderEngine {
	readonly engineType = "readium" as const;

	private static readonly HIGHLIGHT_GROUP = "weave-highlights";
	private static readonly HIGHLIGHT_TINT_MAP: Record<"light" | "dark", Record<string, string>> = {
		light: {
			yellow: "rgb(245, 181, 36)",
			green: "rgb(34, 197, 94)",
			blue: "rgb(59, 130, 246)",
			red: "rgb(239, 68, 68)",
			purple: "rgb(168, 85, 247)",
		},
		dark: {
			yellow: "rgb(255, 214, 102)",
			green: "rgb(74, 222, 128)",
			blue: "rgb(125, 211, 252)",
			red: "rgb(248, 113, 113)",
			purple: "rgb(216, 180, 254)",
		},
	};
	private static readonly DOCUMENT_THEME_STYLE_ATTRIBUTE = "data-weave-readium-theme-style";

	private readonly app: App;
	private bridge: ReadiumVaultPublicationBridge;
	private readonly selectionChangeCallbacks = new Set<(event: ReaderSelectionChange) => void>();
	private readonly highlightClickCallbacks = new Set<(info: HighlightClickInfo) => void>();

	private currentPublication: ReadiumLoadedPublication | null = null;
	private currentBook: EpubBook | null = null;
	private navigator: EpubNavigator | null = null;
	private renderContainer: HTMLElement | null = null;
	private currentLocator: Locator | null = null;
	private currentPosition: ReadingPosition = { chapterIndex: 0, cfi: "", percent: 0 };
	private currentPaginationInfo: PaginationInfo = { currentPage: 0, totalPages: 0 };
	private currentLayoutMode: EpubLayoutMode = "paginated";
	private currentFlowMode: EpubFlowMode = "paginated";
	private currentTheme: EpubTheme = "default";
	private currentWidthMode: EpubWidthMode = "full";
	private currentLineHeight = 1.9;
	private layoutChangeInFlight = false;
	private relocatedCallbacks = new Set<(position: ReadingPosition) => void>();
	private highlightDataMap = new Map<string, ReaderHighlight>();
	private highlightSectionIndexMap = new Map<string, number | null>();
	private savedHighlights: ReaderHighlight[] = [];
	private temporaryHighlightTimers = new Map<string, ReturnType<typeof setTimeout>>();
	private temporarilyRevealedConcealmentTimers = new Map<string, ReturnType<typeof setTimeout>>();
	private highlightRefreshTimer: ReturnType<typeof setTimeout> | null = null;
	private contentsSyncTimer: ReturnType<typeof setTimeout> | null = null;
	private pendingSelectionCleanup = false;
	private documentInteractionCleanups = new Map<Document, () => void>();
	private readonly documentThemeStyleElements = new WeakMap<Document, HTMLStyleElement>();
	private readonly normalizedThemeDocuments = new WeakSet<Document>();
	private knownHighlightGroups = new Set<string>([ReadiumReaderService.HIGHLIGHT_GROUP]);
	private concealmentContainers = new WeakMap<Document, HTMLDivElement>();

	constructor(app: App) {
		this.app = app;
		this.bridge = new ReadiumVaultPublicationBridge(app);
	}

	async loadEpub(filePath: string, existingBookId?: string): Promise<EpubBook> {
		await this.destroyNavigatorOnly();
		this.bridge.dispose();
		this.bridge = new ReadiumVaultPublicationBridge(this.app);
		this.resetHighlightState();

		const vaultFile = this.app.vault.getAbstractFileByPath(filePath);
		if (!(vaultFile instanceof TFile)) {
			throw new Error(`EPUB 文件不存在: ${filePath}`);
		}

		const loaded = await this.bridge.load(filePath);
		this.currentPublication = loaded;
		this.currentLocator = loaded.positions[0] ?? null;
		const initialCfi = this.bridge.serializeLocator(this.currentLocator) || "";

		this.currentBook = {
			id: existingBookId || `epub-${Date.now()}`,
			filePath,
			sourceMtime: vaultFile.stat.mtime,
			sourceSize: vaultFile.stat.size,
			metadata: {
				title: loaded.metadata.title,
				author: loaded.metadata.author,
				publisher: loaded.metadata.publisher,
				language: loaded.metadata.language,
				coverImage: loaded.coverImage || undefined,
				chapterCount: loaded.metadata.chapterCount,
			},
			currentPosition: {
				chapterIndex: 0,
				cfi: initialCfi,
				percent: 0,
			},
			readingStats: {
				totalReadTime: 0,
				lastReadTime: Date.now(),
				createdTime: Date.now(),
			},
		};

		this.currentPosition = { ...this.currentBook.currentPosition };
		this.currentPaginationInfo = {
			currentPage: loaded.positions.length > 0 ? 1 : 0,
			totalPages: loaded.positions.length,
		};
		return this.currentBook;
	}

	async renderTo(container: HTMLElement, options?: ReaderRenderOptions): Promise<void> {
		if (!this.currentPublication) {
			throw this.createNotReadyError("renderTo");
		}

		await this.destroyNavigatorOnly();
		this.renderContainer = container;
		this.currentFlowMode = options?.flow === "scrolled" ? "scrolled" : "paginated";
		this.currentLayoutMode = options?.spread === "always" ? "double" : "paginated";
		this.currentTheme = options?.theme || this.currentTheme;
		this.currentWidthMode = options?.widthMode || this.currentWidthMode;
		if (typeof options?.lineHeight === "number" && options.lineHeight > 0) {
			this.currentLineHeight = options.lineHeight;
		}

		container.replaceChildren();
		this.layoutChangeInFlight = true;
		try {
			this.requestSelectionCleanup();
			this.navigator = new EpubNavigator(
				container,
				this.currentPublication.publication,
				this.createNavigatorListeners(),
				this.currentPublication.positions,
				this.currentLocator || this.currentPublication.positions[0] || undefined,
				{
					preferences: this.buildPreferences(),
					defaults: this.buildDefaults(),
				}
			);
			await this.navigator.load();
			this.currentLocator = this.enrichLocator(this.navigator.currentLocator);
			this.updateReadingState(this.currentLocator);
			this.queueContentsSync(0);
			await this.refreshHighlights();
		} finally {
			this.layoutChangeInFlight = false;
		}
	}

	async goToLocation(cfi: string): Promise<void> {
		const canonical = await this.canonicalizeLocation(cfi);
		if (!canonical || !this.navigator) {
			return;
		}
		this.requestSelectionCleanup();
		const locator = this.bridge.deserializeLocatorString(canonical);
		if (!locator) {
			return;
		}
		await this.navigateWithNavigator(locator);
		this.currentLocator = this.enrichLocator(locator);
		this.updateReadingState(this.currentLocator);
		this.queueContentsSync(24);
		this.queueHighlightRefresh(32);
	}

	async canonicalizeLocation(cfi: string, textHint?: string): Promise<string | null> {
		const direct = await this.bridge.canonicalizeLocation(cfi, textHint);
		if (direct) {
			return direct;
		}

		const legacy = this.parseLegacyStoredLocation(cfi);
		if (!legacy?.href) {
			return null;
		}
		return this.bridge.canonicalizeLocation(
			this.buildLegacyHrefTarget(legacy),
			textHint || legacy.text?.highlight
		);
	}

	getReadingProgress(): number {
		return this.currentPosition.percent;
	}

	async getPaginationInfo(): Promise<PaginationInfo> {
		return this.currentPaginationInfo;
	}

	isLayoutChanging(): boolean {
		return this.layoutChangeInFlight;
	}

	resize(_width: number, _height: number): void {
		void this.navigator?.resizeHandler();
		this.queueContentsSync(24);
		this.queueHighlightRefresh(48);
	}

	async applyReaderAppearance(
		theme: EpubTheme,
		lineHeight: number,
		_redisplay?: boolean
	): Promise<void> {
		this.currentTheme = theme;
		if (lineHeight > 0) {
			this.currentLineHeight = lineHeight;
		}
		this.requestSelectionCleanup();
		await this.updateNavigatorPreferences();
	}

	onRelocated(callback: (position: ReadingPosition) => void): () => void {
		this.relocatedCallbacks.add(callback);
		return () => {
			this.relocatedCallbacks.delete(callback);
		};
	}

	async setLayoutMode(
		mode: EpubLayoutMode,
		flowMode: EpubFlowMode,
		appearance?: ReaderAppearanceOptions
	): Promise<void> {
		this.currentLayoutMode = mode;
		this.currentFlowMode = flowMode;
		if (appearance?.theme) {
			this.currentTheme = appearance.theme;
		}
		if (typeof appearance?.lineHeight === "number" && appearance.lineHeight > 0) {
			this.currentLineHeight = appearance.lineHeight;
		}
		if (appearance?.widthMode) {
			this.currentWidthMode = appearance.widthMode;
		} else if (mode === "double") {
			this.currentWidthMode = "full";
		}
		this.requestSelectionCleanup();
		await this.updateNavigatorPreferences();
	}

	async searchText(
		query: string
	): Promise<Array<{ cfi: string; excerpt: string; chapterTitle: string }>> {
		return this.bridge.search(query);
	}

	async getTableOfContents(): Promise<TocItem[]> {
		return this.currentPublication?.tocItems || this.bridge.getTocItems();
	}

	async navigateTo(options: { cfi?: string; href?: string; text?: string }): Promise<void> {
		await this.resolveNavigationRequest(options);
	}

	async navigateAndHighlight(options: NavigateAndHighlightOptions): Promise<void> {
		const { canonical } = await this.resolveNavigationRequest(options);
		if (canonical && options.flashStyle !== "none") {
			this.addTemporaryHighlight(
				{
					cfiRange: canonical,
					color: options.flashColor || "yellow",
					text: options.text,
				},
				2200
			);
		}
	}

	private async resolveNavigationRequest(options: {
		cfi?: string;
		href?: string;
		text?: string;
	}): Promise<{ rawTarget: string | null; canonical: string | null }> {
		const rawTarget = options.cfi || options.href || null;
		if (!rawTarget) {
			return { rawTarget: null, canonical: null };
		}

		const canonical = await this.canonicalizeLocation(rawTarget, options.text);
		await this.goToLocation(canonical || rawTarget);
		return { rawTarget, canonical };
	}

	getNavigationTargetRect(options: { cfi?: string; href?: string; text?: string }): DOMRect | null {
		const rawTarget = options.cfi || options.href;
		const contentsList = this.getFrameContexts();
		if (!rawTarget || contentsList.length === 0) {
			return this.renderContainer?.getBoundingClientRect() || null;
		}

		for (const contents of contentsList) {
			const range = this.resolveRangeInContents(contents, rawTarget, options.text);
			if (!range) {
				continue;
			}
			const rect = this.createViewportRect(contents, range);
			if (rect) {
				return new DOMRect(rect.left, rect.top, rect.width, rect.height);
			}
		}
		return this.renderContainer?.getBoundingClientRect() || null;
	}

	getCurrentPosition(): ReadingPosition {
		return this.currentPosition;
	}

	getCurrentChapterTitle(): string {
		const href = this.getCurrentChapterHref();
		return this.bridge.getSectionTitleByHref(href) || this.currentBook?.metadata.title || "";
	}

	getCurrentChapterIndex(): number {
		return this.currentPosition.chapterIndex;
	}

	getCurrentChapterHref(): string {
		return (
			this.currentLocator?.href ||
			this.bridge.getSectionHrefByIndex(this.currentPosition.chapterIndex) ||
			""
		);
	}

	getSectionHrefForCfi(cfi: string): string | null {
		const sectionIndex = this.getSectionIndexForLocationSync(cfi);
		return sectionIndex != null && sectionIndex >= 0
			? this.bridge.getSectionHrefByIndex(sectionIndex) || null
			: null;
	}

	getCurrentCFI(): string {
		return this.currentPosition.cfi || this.bridge.serializeLocator(this.currentLocator) || "";
	}

	async prevPage(): Promise<void> {
		if (!this.navigator) {
			return;
		}
		this.requestSelectionCleanup();
		const handled = await this.tryTurnPageWithinCurrentResource("backward");
		if (!handled) {
			await new Promise<void>((resolve) => {
				this.navigator?.goBackward(false, () => resolve());
			});
		}
		this.queueContentsSync(16);
		this.queueHighlightRefresh(32);
	}

	async nextPage(): Promise<void> {
		if (!this.navigator) {
			return;
		}
		this.requestSelectionCleanup();
		const handled = await this.tryTurnPageWithinCurrentResource("forward");
		if (!handled) {
			await new Promise<void>((resolve) => {
				this.navigator?.goForward(false, () => resolve());
			});
		}
		this.queueContentsSync(16);
		this.queueHighlightRefresh(32);
	}

	async getPageNumberFromCfi(cfi: string): Promise<number | undefined> {
		const canonical = await this.canonicalizeLocation(cfi);
		return canonical ? this.bridge.resolvePageNumber(canonical) : undefined;
	}

	getVisibleFrames(): ReaderFrame[] {
		return this.getFrameContexts();
	}

	onSelectionChange(callback: (event: ReaderSelectionChange) => void): () => void {
		this.selectionChangeCallbacks.add(callback);
		return () => {
			this.selectionChangeCallbacks.delete(callback);
		};
	}

	onHighlightClick(callback: (info: HighlightClickInfo) => void): () => void {
		this.highlightClickCallbacks.add(callback);
		return () => {
			this.highlightClickCallbacks.delete(callback);
		};
	}

	async applyHighlights(highlights: ReaderHighlight[]): Promise<void> {
		this.resetTemporaryHighlightTimers();
		this.highlightDataMap.clear();
		this.highlightSectionIndexMap.clear();

		const deduped = new Map<string, ReaderHighlight>();
		for (const highlight of this.dedupeHighlights(highlights)) {
			const canonical =
				(await this.canonicalizeLocation(highlight.cfiRange, highlight.text)) || highlight.cfiRange;
			const normalizedHighlight: ReaderHighlight = { ...highlight, cfiRange: canonical };
			const key = this.normalizeHighlightKey(normalizedHighlight.cfiRange);
			deduped.set(key, normalizedHighlight);
			this.highlightSectionIndexMap.set(key, this.getHighlightSectionIndex(normalizedHighlight));
		}

		this.savedHighlights = Array.from(deduped.values());
		for (const highlight of this.savedHighlights) {
			this.highlightDataMap.set(this.normalizeHighlightKey(highlight.cfiRange), highlight);
			if (!this.isConcealmentHighlight(highlight)) {
				this.knownHighlightGroups.add(this.getHighlightGroup(highlight.color));
			}
		}
		await this.refreshHighlights();
	}

	async refreshHighlights(): Promise<void> {
		await this.refreshVisibleHighlights();
	}

	addHighlight(highlight: ReaderHighlight): void {
		void this.addResolvedHighlight(highlight);
	}

	addTemporaryHighlight(highlight: ReaderHighlightInput, durationMs = 2000): void {
		void this.addResolvedHighlight({ ...highlight, temporary: true }, durationMs);
	}

	temporarilyRevealConcealedText(cfiRange: string, durationMs = 3000): void {
		const key = this.normalizeHighlightKey(cfiRange);
		const highlight = this.highlightDataMap.get(key);
		if (!highlight || !this.isConcealmentHighlight(highlight)) {
			return;
		}

		const existingTimer = this.temporarilyRevealedConcealmentTimers.get(key);
		if (existingTimer) {
			clearTimeout(existingTimer);
		}

		this.temporarilyRevealedConcealmentTimers.set(
			key,
			setTimeout(() => {
				this.temporarilyRevealedConcealmentTimers.delete(key);
				void this.refreshHighlights();
			}, Math.max(200, durationMs))
		);

		void this.refreshHighlights();
	}

	removeHighlight(cfiRange: string): void {
		const key = this.normalizeHighlightKey(cfiRange);
		this.highlightDataMap.delete(key);
		this.highlightSectionIndexMap.delete(key);
		this.savedHighlights = this.savedHighlights.filter(
			(item) => this.normalizeHighlightKey(item.cfiRange) !== key
		);

		const timer = this.temporaryHighlightTimers.get(key);
		if (timer) {
			clearTimeout(timer);
			this.temporaryHighlightTimers.delete(key);
		}
		const revealedTimer = this.temporarilyRevealedConcealmentTimers.get(key);
		if (revealedTimer) {
			clearTimeout(revealedTimer);
			this.temporarilyRevealedConcealmentTimers.delete(key);
		}
		void this.refreshHighlights();
	}

	destroy(): void {
		void this.destroyAll();
	}

	private createNavigatorListeners(): EpubNavigatorListeners {
		return {
			frameLoaded: () => {
				this.queueContentsSync(0);
				this.queueHighlightRefresh(16);
			},
			positionChanged: (locator) => {
				this.currentLocator = this.enrichLocator(locator);
				this.updateReadingState(this.currentLocator);
				this.queueContentsSync(0);
				this.queueHighlightRefresh(24);
			},
			textSelected: (selection) => this.handleTextSelected(selection),
			tap: () => true,
			click: () => true,
			zoom: () => {},
			miscPointer: () => {},
			scroll: () => {},
			customEvent: () => {},
			handleLocator: () => false,
			contentProtection: () => {},
			contextMenu: () => {},
			peripheral: () => {},
		};
	}

	private async updateNavigatorPreferences(): Promise<void> {
		if (!this.navigator) {
			return;
		}

		this.layoutChangeInFlight = true;
		try {
			await this.navigator.submitPreferences(new EpubPreferences(this.buildPreferences()));
			this.currentLocator = this.enrichLocator(this.navigator.currentLocator);
			this.updateReadingState(this.currentLocator);
			this.queueContentsSync(0);
			await this.refreshHighlights();
		} finally {
			this.layoutChangeInFlight = false;
		}
	}

	private buildPreferences(): IEpubPreferences {
		const backgroundColor = this.getObsidianCSSVar(
			this.currentTheme === "sepia" ? "--background-secondary" : "--background-primary",
			this.currentTheme === "sepia" ? "rgb(244, 236, 216)" : "rgb(255, 255, 255)"
		);
		const textColor =
			this.currentTheme === "sepia"
				? this.getObsidianCSSVar("--text-muted", "rgb(84, 70, 46)")
				: this.getObsidianCSSVar("--text-normal", "rgb(28, 29, 31)");
		const { optimalLineLength, minimalLineLength, maximalLineLength } = this.getLineLengthConfig();
		const scrollPadding = this.getScrollPaddingConfig();
		const fontSize = this.getObsidianFontScale();
		return {
			backgroundColor,
			textColor,
			linkColor: this.getObsidianCSSVar("--link-color", "rgb(80, 110, 214)"),
			selectionBackgroundColor: this.getObsidianCSSVar(
				"--text-selection",
				"rgba(120, 140, 255, 0.32)"
			),
			selectionTextColor: this.getObsidianCSSVar("--text-on-accent", textColor),
			fontFamily: this.getObsidianFontStack(),
			fontSize,
			fontSizeNormalize: true,
			lineHeight: this.currentLineHeight,
			scroll: this.currentFlowMode === "scrolled",
			columnCount:
				this.currentFlowMode === "scrolled" ? 1 : this.currentLayoutMode === "double" ? 2 : 1,
			pageGutter:
				this.currentFlowMode === "scrolled" ? 24 : this.currentLayoutMode === "double" ? 18 : 32,
			optimalLineLength,
			minimalLineLength,
			maximalLineLength,
			scrollPaddingTop: scrollPadding.top,
			scrollPaddingBottom: scrollPadding.bottom,
			scrollPaddingLeft: scrollPadding.left,
			scrollPaddingRight: scrollPadding.right,
		};
	}

	private buildDefaults(): IEpubDefaults {
		const { optimalLineLength, minimalLineLength, maximalLineLength } = this.getLineLengthConfig();
		const scrollPadding = this.getScrollPaddingConfig();
		const fontSize = this.getObsidianFontScale();
		return {
			fontFamily: this.getObsidianFontStack(),
			fontSize,
			fontSizeNormalize: true,
			lineHeight: this.currentLineHeight,
			scroll: this.currentFlowMode === "scrolled",
			columnCount:
				this.currentFlowMode === "scrolled" ? 1 : this.currentLayoutMode === "double" ? 2 : 1,
			pageGutter:
				this.currentFlowMode === "scrolled" ? 24 : this.currentLayoutMode === "double" ? 18 : 32,
			optimalLineLength,
			minimalLineLength,
			maximalLineLength,
			scrollPaddingTop: scrollPadding.top,
			scrollPaddingBottom: scrollPadding.bottom,
			scrollPaddingLeft: scrollPadding.left,
			scrollPaddingRight: scrollPadding.right,
		};
	}

	private getLineLengthConfig(): {
		optimalLineLength: number;
		minimalLineLength: number;
		maximalLineLength: number;
	} {
		if (this.currentFlowMode !== "scrolled" && this.currentLayoutMode === "double") {
			return { optimalLineLength: 36, minimalLineLength: 26, maximalLineLength: 44 };
		}
		if (this.currentWidthMode === "full") {
			return { optimalLineLength: 74, minimalLineLength: 58, maximalLineLength: 88 };
		}
		return { optimalLineLength: 64, minimalLineLength: 50, maximalLineLength: 74 };
	}

	private getScrollPaddingConfig(): {
		top: number | null;
		bottom: number | null;
		left: number | null;
		right: number | null;
	} {
		if (this.currentFlowMode !== "scrolled") {
			return { top: null, bottom: null, left: null, right: null };
		}

		const inlinePadding = this.currentWidthMode === "full" ? 28 : 24;
		return {
			top: 24,
			bottom: 32,
			left: inlinePadding,
			right: inlinePadding,
		};
	}

	private async tryTurnPageWithinCurrentResource(
		direction: "forward" | "backward"
	): Promise<boolean> {
		if (!this.navigator || this.currentFlowMode === "scrolled") {
			return false;
		}

		const frame = this.getPrimaryNavigatorFrame();
		if (!frame) {
			return false;
		}

		const initialSnapshot = this.readPaginatedFrameSnapshot(frame);
		if (!initialSnapshot) {
			return false;
		}

		if (initialSnapshot.axis !== "vertical") {
			const nativeCommand = direction === "forward" ? "go_next" : "go_prev";
			const nativeTurned = await this.sendFrameCommand(frame, nativeCommand);
			if (nativeTurned) {
				return true;
			}
		}

		await this.waitForFramePaint(frame.window);
		const fallbackSnapshot = this.readPaginatedFrameSnapshot(frame);
		if (!fallbackSnapshot) {
			return false;
		}

		const targetOffset =
			direction === "forward"
				? fallbackSnapshot.targetForwardOffset
				: fallbackSnapshot.targetBackwardOffset;
		const targetProgression =
			direction === "forward"
				? fallbackSnapshot.targetForwardProgression
				: fallbackSnapshot.targetBackwardProgression;

		if (targetOffset == null || targetProgression == null) {
			return false;
		}

		if (fallbackSnapshot.axis === "vertical") {
			const moved = await this.scrollFrameManually(frame.window, fallbackSnapshot, targetOffset);
			if (!moved) {
				return false;
			}
			await this.waitForFramePaint(frame.window);
			const updatedSnapshot = this.readPaginatedFrameSnapshot(frame);
			if (!updatedSnapshot) {
				return false;
			}
			this.navigator.eventListener("progress", {
				start: updatedSnapshot.startProgression,
				end: updatedSnapshot.endProgression,
			});
			logger.debug(
				"[ReadiumReaderService] Applied vertical paginated fallback to keep page turns inside the current resource.",
				{
					href: this.currentLocator?.href,
					direction,
					writingMode: this.getDocumentWritingMode(frame.window.document),
					startProgression: updatedSnapshot.startProgression,
					endProgression: updatedSnapshot.endProgression,
				}
			);
			return true;
		}

		const progressed = await this.sendFrameCommand(frame, "go_progression", targetProgression);
		if (progressed) {
			logger.debug(
				"[ReadiumReaderService] Prevented a premature chapter jump by advancing within the current resource.",
				{
					href: this.currentLocator?.href,
					direction,
					targetProgression,
				}
			);
		}
		return progressed;
	}

	private getPrimaryNavigatorFrame(): FrameManager | FXLFrameManager | null {
		if (!this.navigator) {
			return null;
		}

		return (
			this.navigator._cframes.find((frame): frame is FrameManager | FXLFrameManager =>
				Boolean(frame)
			) || null
		);
	}

	private readPaginatedFrameSnapshot(
		frame: FrameManager | FXLFrameManager
	): ReadiumPaginatedFrameSnapshot | null {
		try {
			const frameWindow = frame.window;
			const scrollingElement = frameWindow.document.scrollingElement as HTMLElement | null;
			if (!scrollingElement) {
				return null;
			}

			const scrollLeft =
				Math.abs(frameWindow.scrollX) > Math.abs(scrollingElement.scrollLeft)
					? frameWindow.scrollX
					: scrollingElement.scrollLeft;
			const scrollTop = Math.max(frameWindow.scrollY, scrollingElement.scrollTop);
			return buildReadiumPaginatedFrameSnapshot({
				writingMode: this.getDocumentWritingMode(frameWindow.document),
				direction: this.getDocumentDirection(frameWindow.document),
				scrollLeft,
				scrollTop,
				scrollWidth: scrollingElement.scrollWidth,
				scrollHeight: scrollingElement.scrollHeight,
				viewportWidth: frameWindow.innerWidth,
				viewportHeight: frameWindow.innerHeight,
			});
		} catch {
			return null;
		}
	}

	private async sendFrameCommand(
		frame: FrameManager | FXLFrameManager,
		command: "go_next" | "go_prev" | "go_progression",
		payload?: number
	): Promise<boolean> {
		const channel = frame.msg;
		if (!channel?.ready) {
			return false;
		}

		return new Promise<boolean>((resolve) => {
			try {
				channel.send(command, payload, (ok) => resolve(Boolean(ok)));
			} catch (error) {
				logger.warn("[ReadiumReaderService] Failed to send frame pagination command:", {
					href: this.currentLocator?.href,
					command,
					payload,
					error,
				});
				resolve(false);
			}
		});
	}

	private async scrollFrameManually(
		frameWindow: Window,
		snapshot: ReadiumPaginatedFrameSnapshot,
		targetOffset: number
	): Promise<boolean> {
		const scrollingElement = frameWindow.document.scrollingElement as HTMLElement | null;
		if (!scrollingElement) {
			return false;
		}

		try {
			if (snapshot.axis === "vertical") {
				scrollingElement.scrollTop = targetOffset;
				frameWindow.scrollTo({
					left: 0,
					top: targetOffset,
					behavior: "auto",
				});
			} else {
				scrollingElement.scrollLeft = targetOffset;
				frameWindow.scrollTo({
					left: targetOffset,
					top: 0,
					behavior: "auto",
				});
			}
			await this.waitForFramePaint(frameWindow);
			const updatedSnapshot = buildReadiumPaginatedFrameSnapshot({
				writingMode: this.getDocumentWritingMode(frameWindow.document),
				direction: this.getDocumentDirection(frameWindow.document),
				scrollLeft:
					Math.abs(frameWindow.scrollX) > Math.abs(scrollingElement.scrollLeft)
						? frameWindow.scrollX
						: scrollingElement.scrollLeft,
				scrollTop: Math.max(frameWindow.scrollY, scrollingElement.scrollTop),
				scrollWidth: scrollingElement.scrollWidth,
				scrollHeight: scrollingElement.scrollHeight,
				viewportWidth: frameWindow.innerWidth,
				viewportHeight: frameWindow.innerHeight,
			});
			return Math.abs(updatedSnapshot.currentOffset - snapshot.currentOffset) > 1;
		} catch (error) {
			logger.warn("[ReadiumReaderService] Failed to manually scroll the paginated frame:", {
				href: this.currentLocator?.href,
				targetOffset,
				error,
			});
			return false;
		}
	}

	private waitForFramePaint(frameWindow: Window): Promise<void> {
		return new Promise((resolve) => {
			if (typeof frameWindow.requestAnimationFrame === "function") {
				frameWindow.requestAnimationFrame(() => resolve());
				return;
			}
			window.setTimeout(() => resolve(), 16);
		});
	}

	private getDocumentWritingMode(doc: Document): string {
		try {
			const view = doc.defaultView;
			if (!view) {
				return "";
			}
			const bodyWritingMode = doc.body ? view.getComputedStyle(doc.body).writingMode : "";
			if (bodyWritingMode) {
				return bodyWritingMode;
			}
			return view.getComputedStyle(doc.documentElement).writingMode || "";
		} catch {
			return "";
		}
	}

	private getDocumentDirection(doc: Document): string {
		try {
			const view = doc.defaultView;
			if (!view) {
				return doc.body?.dir || doc.documentElement?.dir || "ltr";
			}
			const bodyDirection = doc.body ? view.getComputedStyle(doc.body).direction : "";
			if (bodyDirection) {
				return bodyDirection;
			}
			const rootDirection = view.getComputedStyle(doc.documentElement).direction;
			return rootDirection || doc.body?.dir || doc.documentElement?.dir || "ltr";
		} catch {
			return doc.body?.dir || doc.documentElement?.dir || "ltr";
		}
	}

	private async navigateWithNavigator(locator: Locator): Promise<boolean> {
		if (!this.navigator) {
			return false;
		}
		return new Promise<boolean>((resolve) => {
			try {
				this.navigator?.go(locator, false, (ok) => resolve(Boolean(ok)));
			} catch (error) {
				logger.warn("[ReadiumReaderService] Failed to navigate with Readium:", {
					href: locator.href,
					error,
				});
				resolve(false);
			}
		});
	}

	private handleTextSelected(selection: BasicTextSelection): void {
		const contents = this.findFrameContextBySource(selection.targetFrameSrc);
		if (!contents) {
			return;
		}
		const activeSelection = contents.window.getSelection();
		if (!activeSelection || activeSelection.isCollapsed || activeSelection.rangeCount === 0) {
			return;
		}
		const cfiRange = contents.cfiFromRange(activeSelection.getRangeAt(0));
		if (cfiRange) {
			this.notifySelectionChange(cfiRange, contents);
		}
	}

	private updateReadingState(locator: Locator | null): void {
		const effectiveLocator = this.enrichLocator(locator);
		if (effectiveLocator) {
			this.currentLocator = effectiveLocator;
		}
		const href =
			effectiveLocator?.href ||
			this.currentLocator?.href ||
			this.currentPublication?.positions[0]?.href ||
			"";
		const chapterIndex = href ? Math.max(this.bridge.getSectionIndexForHref(href), 0) : 0;
		const cfi = this.bridge.serializeLocator(effectiveLocator) || "";
		const totalPages = this.currentPublication?.positions.length || 0;
		const currentPage = cfi
			? this.bridge.resolvePageNumber(cfi) || (totalPages > 0 ? 1 : 0)
			: totalPages > 0
			? 1
			: 0;

		let percent = 0;
		if (totalPages > 1 && currentPage > 0) {
			percent = this.clamp(((currentPage - 1) / (totalPages - 1)) * 100, 0, 100);
		} else {
			const raw = effectiveLocator?.serialize() as
				| { locations?: { totalProgression?: number; progression?: number } }
				| undefined;
			const totalProgression = raw?.locations?.totalProgression;
			const progression = raw?.locations?.progression;
			if (typeof totalProgression === "number") {
				percent = this.clamp(totalProgression * 100, 0, 100);
			} else if (typeof progression === "number") {
				percent = this.clamp(progression * 100, 0, 100);
			}
		}

		this.currentPosition = {
			chapterIndex,
			cfi,
			percent,
		};
		this.currentPaginationInfo = {
			currentPage,
			totalPages,
		};
		if (this.currentBook) {
			this.currentBook.currentPosition = { ...this.currentPosition };
		}
		for (const callback of this.relocatedCallbacks) {
			callback(this.currentPosition);
		}
	}

	private enrichLocator(locator: Locator | null): Locator | null {
		if (!locator) {
			return null;
		}

		const raw = locator.serialize() as {
			href?: string;
			type?: string;
			title?: string;
			locations?: Record<string, unknown>;
		};
		const href =
			raw.href && raw.href !== "#"
				? raw.href
				: this.navigator?.viewport.readingOrder[0] ||
				  this.currentLocator?.href ||
				  this.currentPublication?.positions[0]?.href ||
				  "";
		if (!href) {
			return locator;
		}

		const progressionRange = this.navigator?.viewport.progressions.get(href);
		const position = raw.locations?.position ?? this.navigator?.viewport.positions?.[0];
		const totalProgression =
			typeof position === "number" && (this.currentPublication?.positions.length || 0) > 1
				? this.clamp(
						(position - 1) / Math.max((this.currentPublication?.positions.length || 1) - 1, 1),
						0,
						1
				  )
				: raw.locations?.totalProgression;

		return (
			Locator.deserialize({
				...raw,
				href,
				type: raw.type || this.bridge.getSectionMediaTypeByHref(href),
				title: raw.title || this.bridge.getSectionTitleByHref(href) || undefined,
				locations: {
					...(raw.locations || {}),
					progression:
						raw.locations?.progression ?? (progressionRange ? progressionRange.start : undefined),
					totalProgression,
					position: typeof position === "number" ? position : undefined,
				},
			}) || locator
		);
	}

	private getFrameContexts(): ReadiumFrameContext[] {
		if (!this.navigator) {
			return [];
		}

		const frames = this.navigator._cframes.filter(
			(frame): frame is FrameManager | FXLFrameManager => Boolean(frame)
		);
		const readingOrder = this.navigator.viewport.readingOrder || [];
		return frames
			.map((frame, index) => this.createFrameContext(frame, index, readingOrder))
			.filter((item): item is ReadiumFrameContext => item !== null);
	}

	private createFrameContext(
		frame: FrameManager | FXLFrameManager,
		index: number,
		readingOrder: string[]
	): ReadiumFrameContext | null {
		try {
			const frameWindow = frame.window;
			const doc = frameWindow.document;
			const sourceHref =
				readingOrder[index] ||
				this.currentLocator?.href ||
				this.currentPublication?.positions[0]?.href ||
				"";
			const sectionIndex = sourceHref ? this.bridge.getSectionIndexForHref(sourceHref) : index;
			if (!doc || !sourceHref) {
				return null;
			}

			return {
				frame,
				frameSource: frame.source,
				sectionIndex: sectionIndex >= 0 ? sectionIndex : index,
				document: doc,
				window: doc.defaultView || frameWindow,
				sourceHref,
				cfiFromRange: (range: Range) => this.bridge.createLocatorStringFromRange(sourceHref, range),
			};
		} catch (_error) {
			return null;
		}
	}

	private findFrameContextBySource(frameSource: string): ReadiumFrameContext | null {
		return this.getFrameContexts().find((contents) => contents.frameSource === frameSource) || null;
	}

	private queueContentsSync(delayMs = 0): void {
		if (this.contentsSyncTimer) {
			clearTimeout(this.contentsSyncTimer);
		}
		this.contentsSyncTimer = setTimeout(() => {
			this.contentsSyncTimer = null;
			this.syncCurrentContents();
		}, delayMs);
	}

	private syncCurrentContents(): void {
		for (const contents of this.getFrameContexts()) {
			try {
				this.applyDocumentThemeOverrides(contents.document);
			} catch (error) {
				logger.warn("[ReadiumReaderService] Failed to apply document theme overrides:", {
					href: contents.sourceHref,
					error,
				});
			}
			this.bindDocumentInteractions(contents);
		}
		this.flushPendingSelectionCleanup();
	}

	private bindDocumentInteractions(contents: ReadiumFrameContext): void {
		const doc = contents.document;
		if (this.documentInteractionCleanups.has(doc)) {
			return;
		}

		let selectionTimer: number | null = null;
		const emitSelection = () => {
			if (selectionTimer !== null) {
				window.clearTimeout(selectionTimer);
			}
			selectionTimer = window.setTimeout(() => {
				selectionTimer = null;
				const selection = contents.window.getSelection();
				if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
					return;
				}
				const cfiRange = contents.cfiFromRange(selection.getRangeAt(0));
				if (cfiRange) {
					this.notifySelectionChange(cfiRange, contents);
				}
			}, 0);
		};

		const handleClick = (event: MouseEvent) => {
			const hit = this.findHighlightHit(contents, event.clientX, event.clientY);
			if (!hit) {
				return;
			}
			event.preventDefault();
			event.stopImmediatePropagation();
			const key = this.normalizeHighlightKey(hit.cfiRange);
			const highlight = this.highlightDataMap.get(key) || hit.highlight;
			this.notifyHighlightClick({
				cfiRange: highlight.cfiRange,
				color: highlight.color,
				text: highlight.text || "",
				sourceFile: highlight.sourceFile || "",
				sourceRef: highlight.sourceRef,
				createdTime: highlight.createdTime,
				temporary: Boolean(highlight.temporary),
				presentation: highlight.presentation,
				rect: hit.rect,
			});
		};

		doc.addEventListener("mouseup", emitSelection);
		doc.addEventListener("touchend", emitSelection, { passive: true });
		doc.addEventListener("keyup", emitSelection);
		doc.addEventListener("selectionchange", emitSelection);
		doc.addEventListener("click", handleClick, true);

		this.documentInteractionCleanups.set(doc, () => {
			if (selectionTimer !== null) {
				window.clearTimeout(selectionTimer);
			}
			doc.removeEventListener("mouseup", emitSelection);
			doc.removeEventListener("touchend", emitSelection);
			doc.removeEventListener("keyup", emitSelection);
			doc.removeEventListener("selectionchange", emitSelection);
			doc.removeEventListener("click", handleClick, true);
		});
	}

	private applyDocumentThemeOverrides(doc: Document): void {
		markReadiumThemeDocument(doc);
		this.applyDocumentThemeStylesheet(doc);
		doc.documentElement?.style.setProperty(
			"--WEAVE__codeFontFamily",
			this.getObsidianMonospaceFontStack()
		);
		if (!this.normalizedThemeDocuments.has(doc)) {
			normalizeReadiumThemeInlineStyles(doc);
			this.normalizedThemeDocuments.add(doc);
		}
	}

	private applyDocumentThemeStylesheet(doc: Document): void {
		const parent = doc.head || doc.documentElement;
		if (!parent) {
			return;
		}

		let styleElement = this.documentThemeStyleElements.get(doc);
		if (!styleElement || !styleElement.isConnected) {
			styleElement = doc.createElement("style");
			styleElement.setAttribute(ReadiumReaderService.DOCUMENT_THEME_STYLE_ATTRIBUTE, "true");
			parent.appendChild(styleElement);
			this.documentThemeStyleElements.set(doc, styleElement);
		}
		styleElement.textContent = this.buildDocumentThemeStyles();
	}

	private buildDocumentThemeStyles(): string {
		const background = this.getObsidianCSSVar(
			this.currentTheme === "sepia" ? "--background-secondary" : "--background-primary",
			this.currentTheme === "sepia" ? "rgb(244, 236, 216)" : "rgb(255, 255, 255)"
		);
		const textColor =
			this.currentTheme === "sepia"
				? this.getObsidianCSSVar("--text-muted", "rgb(84, 70, 46)")
				: this.getObsidianCSSVar("--text-normal", "rgb(28, 29, 31)");
		const linkColor = this.getObsidianCSSVar("--link-color", "rgb(80, 110, 214)");
		const selectionBackground = this.getObsidianCSSVar(
			"--text-selection",
			"rgba(120, 140, 255, 0.32)"
		);
		const selectionTextColor = this.getObsidianCSSVar("--text-on-accent", textColor);
		const fontFamily = this.getObsidianFontStack();
		const monospaceFontFamily = this.getObsidianMonospaceFontStack();
		const concealment = this.getConcealmentPalette();
		const colorScheme = this.getCurrentColorScheme();
		const rootSelector = `html[${READIUM_THEME_DOCUMENT_ATTRIBUTE}][${READIUM_THEME_DOCUMENT_ATTRIBUTE}][${READIUM_THEME_DOCUMENT_ATTRIBUTE}]`;

		return `${rootSelector} {
	color-scheme: ${colorScheme};
	background: ${background} !important;
	color: ${textColor} !important;
	-webkit-text-size-adjust: 100%;
}
${rootSelector} body {
	background: transparent !important;
	color: ${textColor} !important;
	font-family: ${fontFamily} !important;
	line-height: ${this.currentLineHeight} !important;
	margin: 0 !important;
	text-rendering: optimizeLegibility;
	font-kerning: normal;
}
${rootSelector} body :is(${READIUM_THEMEABLE_TEXT_SELECTORS}) {
	color: inherit !important;
	font-family: inherit !important;
	line-height: inherit !important;
}
${rootSelector} body :is(${READIUM_THEMEABLE_BACKGROUND_SELECTORS}) {
	background-color: transparent !important;
}
${rootSelector} body :is(a, a:link, a:visited) {
	color: ${linkColor} !important;
}
${rootSelector} body :is(pre, code, kbd, samp) {
	font-family: var(--WEAVE__codeFontFamily, ${monospaceFontFamily}) !important;
	white-space: pre-wrap !important;
	word-break: break-word;
}
${rootSelector} body :is(img, svg, video, canvas) {
	max-width: 100% !important;
}
${rootSelector} body .weave-epub-concealment-layer {
	display: contents !important;
	pointer-events: none !important;
}
${rootSelector} body .weave-epub-concealment-line {
	position: absolute !important;
	pointer-events: none !important;
	box-sizing: border-box !important;
	border-radius: 4px !important;
	border: 1px solid ${concealment.border} !important;
	background-color: ${concealment.base} !important;
	background-image:
		linear-gradient(90deg,
			${concealment.base} 0%,
			${concealment.base} 18%,
			${concealment.stripe} 18%,
			${concealment.stripe} 36%,
			${concealment.base} 36%,
			${concealment.base} 54%,
			${concealment.stripe} 54%,
			${concealment.stripe} 72%,
			${concealment.base} 72%,
			${concealment.base} 100%) !important;
	background-size: 18px 100% !important;
	box-shadow:
		inset 0 1px 0 ${concealment.innerGlow},
		0 1px 2px ${concealment.outerShadow} !important;
	backdrop-filter: blur(1.5px) saturate(0.92) !important;
	-webkit-backdrop-filter: blur(1.5px) saturate(0.92) !important;
}
${rootSelector} body ::selection {
	background: ${selectionBackground};
	color: ${selectionTextColor};
}
`;
	}

	private findHighlightHit(
		contents: ReadiumFrameContext,
		x: number,
		y: number
	): { cfiRange: string; highlight: ReaderHighlight; rect: HighlightClickInfo["rect"] } | null {
		let best: { highlight: ReaderHighlight; range: Range; area: number } | null = null;

		for (const highlight of this.getVisibleHighlightsForContents(contents)) {
			const range = this.resolveRangeInContents(contents, highlight.cfiRange, highlight.text);
			if (!range) {
				continue;
			}

			const hit = Array.from(range.getClientRects()).some(
				(rect) =>
					x >= rect.left - 1 && x <= rect.right + 1 && y >= rect.top - 1 && y <= rect.bottom + 1
			);
			if (!hit) {
				continue;
			}

			const box = range.getBoundingClientRect();
			const area = Math.max(box.width * box.height, 1);
			if (!best || area < best.area) {
				best = { highlight, range, area };
			}
		}

		if (!best) {
			return null;
		}

		const rect = this.createViewportRect(contents, best.range);
		if (!rect) {
			return null;
		}

		return {
			cfiRange: best.highlight.cfiRange,
			highlight: best.highlight,
			rect,
		};
	}

	private resolveRangeInContents(
		contents: ReadiumFrameContext,
		target: string,
		textHint?: string
	): Range | null {
		const direct = this.bridge.resolveRangeInDocument(
			contents.document,
			target,
			contents.sourceHref,
			textHint
		);
		if (direct) {
			return direct;
		}

		const legacyPayload = this.parseLegacyStoredLocation(target);
		if (legacyPayload?.href) {
			const legacyRange = this.bridge.resolveRangeInDocument(
				contents.document,
				this.buildLegacyHrefTarget(legacyPayload),
				contents.sourceHref,
				textHint || legacyPayload.text?.highlight
			);
			if (legacyRange) {
				return legacyRange;
			}
		}

		const normalized = this.normalizeLocationString(target);
		if (!this.isLegacyCfiLike(normalized)) {
			return null;
		}

		const sectionIndex = this.getSectionIndexForLegacyCfi(normalized);
		if (sectionIndex == null || sectionIndex !== contents.sectionIndex) {
			return null;
		}

		try {
			return new EpubCFI(new EpubCFI(normalized).toString()).toRange(contents.document);
		} catch (_error) {
			return null;
		}
	}

	private async refreshVisibleHighlights(): Promise<void> {
		const contentsList = this.getFrameContexts();
		if (contentsList.length === 0) {
			return;
		}

		await Promise.all(
			contentsList.map(async (contents) => {
				await this.clearDecorations(contents);
				this.clearConcealmentOverlays(contents);
			})
		);
		for (const contents of contentsList) {
			for (const highlight of this.getVisibleHighlightsForContents(contents)) {
				await this.renderHighlightInContents(contents, highlight);
			}
		}
	}

	private getVisibleHighlightsForContents(contents: ReadiumFrameContext): ReaderHighlight[] {
		if (this.savedHighlights.length === 0) {
			return [];
		}

		return this.savedHighlights.filter((highlight) => {
			const key = this.normalizeHighlightKey(highlight.cfiRange);
			if (
				this.isConcealmentHighlight(highlight) &&
				this.temporarilyRevealedConcealmentTimers.has(key)
			) {
				return false;
			}
			const sectionIndex = this.highlightSectionIndexMap.get(key);
			return sectionIndex == null || sectionIndex === contents.sectionIndex;
		});
	}

	private async clearDecorations(contents: ReadiumFrameContext): Promise<void> {
		for (const group of this.knownHighlightGroups) {
			await this.sendDecorate(contents, {
				group,
				action: "clear",
				decoration: undefined,
			});
		}
	}

	private async renderHighlightInContents(
		contents: ReadiumFrameContext,
		highlight: ReaderHighlight
	): Promise<void> {
		if (this.isConcealmentHighlight(highlight)) {
			this.renderConcealmentInContents(contents, highlight);
			return;
		}

		const locator = this.bridge.deserializeLocatorString(highlight.cfiRange);
		if (!locator) {
			return;
		}
		if (this.bridge.getSectionIndexForHref(locator.href) !== contents.sectionIndex) {
			return;
		}

		const group = this.getHighlightGroup(highlight.color);
		this.knownHighlightGroups.add(group);
		await this.sendDecorate(contents, {
			group,
			action: "add",
			decoration: {
				id: this.normalizeHighlightKey(highlight.cfiRange),
				locator: locator.serialize() as never,
				style: {
					tint: this.resolveHighlightTint(highlight.color),
					layout: DecorationLayout.Boxes,
					width: DecorationWidth.Wrap,
				},
			},
		} as unknown as DecoratorRequest);
	}

	private renderConcealmentInContents(
		contents: ReadiumFrameContext,
		highlight: ReaderHighlight
	): void {
		const range = this.resolveRangeInContents(contents, highlight.cfiRange, highlight.text);
		if (!range) {
			return;
		}

		const container = this.getOrCreateConcealmentContainer(contents.document);
		const scrollingElement = contents.document.scrollingElement;
		const xOffset = scrollingElement?.scrollLeft || 0;
		const yOffset = scrollingElement?.scrollTop || 0;
		const concealment = this.getConcealmentPalette();
		const rects = Array.from(range.getClientRects())
			.filter((rect) => rect.width > 1 && rect.height > 1)
			.sort((left, right) => left.top - right.top || left.left - right.left);
		if (rects.length === 0) {
			const fallbackRect = range.getBoundingClientRect();
			if (fallbackRect.width > 1 && fallbackRect.height > 1) {
				rects.push(fallbackRect);
			}
		}

		for (const rect of rects) {
			const line = contents.document.createElement("div");
			line.className = "weave-epub-concealment-line";
			line.dataset.highlightId = this.normalizeHighlightKey(highlight.cfiRange);
			line.setCssProps({
				position: "absolute",
				"pointer-events": "none",
				"box-sizing": "border-box",
				"border-radius": "4px",
				border: `1px solid ${concealment.border}`,
				"background-color": concealment.base,
				"background-image": `linear-gradient(90deg, ${concealment.base} 0%, ${concealment.base} 18%, ${concealment.stripe} 18%, ${concealment.stripe} 36%, ${concealment.base} 36%, ${concealment.base} 54%, ${concealment.stripe} 54%, ${concealment.stripe} 72%, ${concealment.base} 72%, ${concealment.base} 100%)`,
				"background-size": "18px 100%",
				"box-shadow": `inset 0 1px 0 ${concealment.innerGlow}, 0 1px 2px ${concealment.outerShadow}`,
				left: `${rect.left + xOffset}px`,
				top: `${rect.top + yOffset}px`,
				width: `${rect.width}px`,
				height: `${rect.height}px`,
			});
			container.appendChild(line);
		}
	}

	private getOrCreateConcealmentContainer(doc: Document): HTMLDivElement {
		let container = this.concealmentContainers.get(doc);
		if (container?.isConnected) {
			return container;
		}

		container = doc.createElement("div");
		container.className = "weave-epub-concealment-layer";
		container.dataset.readium = "true";
		container.setCssProps({
			"pointer-events": "none",
			display: "contents",
		});
		(doc.body || doc.documentElement).appendChild(container);
		this.concealmentContainers.set(doc, container);
		return container;
	}

	private clearConcealmentOverlays(contents: ReadiumFrameContext): void {
		const container = this.concealmentContainers.get(contents.document);
		if (!container) {
			return;
		}
		container.remove();
		this.concealmentContainers.delete(contents.document);
	}

	private async sendDecorate(
		contents: ReadiumFrameContext,
		request: DecoratorRequest
	): Promise<boolean> {
		try {
			const msg = contents.frame.msg;
			if (!msg?.ready) {
				return false;
			}
			return await new Promise<boolean>((resolve) => {
				msg.send("decorate", request as unknown as Record<string, unknown>, (ack) =>
					resolve(Boolean(ack))
				);
			});
		} catch (error) {
			logger.warn("[ReadiumReaderService] Failed to send decorate request:", {
				href: contents.sourceHref,
				action: request.action,
				error,
			});
			return false;
		}
	}

	private async addResolvedHighlight(
		highlight: ReaderHighlight,
		durationMs?: number
	): Promise<void> {
		const canonical =
			(await this.canonicalizeLocation(highlight.cfiRange, highlight.text)) || highlight.cfiRange;
		const normalizedHighlight: ReaderHighlight = { ...highlight, cfiRange: canonical };
		const key = this.normalizeHighlightKey(normalizedHighlight.cfiRange);

		const existingTimer = this.temporaryHighlightTimers.get(key);
		if (existingTimer) {
			clearTimeout(existingTimer);
			this.temporaryHighlightTimers.delete(key);
		}

		this.highlightDataMap.set(key, normalizedHighlight);
		this.highlightSectionIndexMap.set(key, this.getHighlightSectionIndex(normalizedHighlight));
		if (!this.isConcealmentHighlight(normalizedHighlight)) {
			this.knownHighlightGroups.add(this.getHighlightGroup(normalizedHighlight.color));
		}

		const deduped = new Map<string, ReaderHighlight>();
		for (const item of this.savedHighlights) {
			deduped.set(this.normalizeHighlightKey(item.cfiRange), item);
		}
		deduped.set(key, normalizedHighlight);
		this.savedHighlights = Array.from(deduped.values());
		await this.refreshHighlights();

		if (normalizedHighlight.temporary && typeof durationMs === "number" && durationMs > 0) {
			const timer = setTimeout(() => {
				this.temporaryHighlightTimers.delete(key);
				this.removeHighlight(normalizedHighlight.cfiRange);
			}, durationMs);
			this.temporaryHighlightTimers.set(key, timer);
		}
	}

	private getHighlightSectionIndex(highlight: ReaderHighlight): number | null {
		return this.getSectionIndexForLocationSync(highlight.cfiRange);
	}

	private getSectionIndexForLocationSync(value: string): number | null {
		const locator = this.bridge.deserializeLocatorString(value);
		if (locator) {
			const sectionIndex = this.bridge.getSectionIndexForHref(locator.href);
			return sectionIndex >= 0 ? sectionIndex : null;
		}

		const legacyPayload = this.parseLegacyStoredLocation(value);
		if (legacyPayload?.href) {
			const sectionIndex = this.bridge.getSectionIndexForHref(
				this.buildLegacyHrefTarget(legacyPayload)
			);
			return sectionIndex >= 0 ? sectionIndex : null;
		}

		const normalized = this.normalizeLocationString(value);
		if (this.isDocumentHrefLike(normalized)) {
			const sectionIndex = this.bridge.getSectionIndexForHref(normalized);
			return sectionIndex >= 0 ? sectionIndex : null;
		}
		if (this.isLegacyCfiLike(normalized)) {
			return this.getSectionIndexForLegacyCfi(normalized);
		}
		return null;
	}

	private getSectionIndexForLegacyCfi(cfi: string): number | null {
		try {
			const wrapped = new EpubCFI(this.normalizeLocationString(cfi)).toString();
			const spinePos = new EpubCFI(wrapped).spinePos;
			return typeof spinePos === "number" && spinePos >= 0 ? spinePos : null;
		} catch (_error) {
			return null;
		}
	}

	private parseLegacyStoredLocation(value: string): LegacyStoredLocationPayload | null {
		const normalized = this.normalizeLocationString(value);
		if (!normalized.startsWith("readium:")) {
			return null;
		}
		try {
			return JSON.parse(
				decodeURIComponent(normalized.slice("readium:".length))
			) as LegacyStoredLocationPayload;
		} catch (_error) {
			return null;
		}
	}

	private buildLegacyHrefTarget(payload: LegacyStoredLocationPayload): string {
		const href = payload.href || "";
		const fragment = payload.locations?.fragments?.find(Boolean);
		if (fragment && href && !href.includes("#")) {
			return `${href}#${fragment}`;
		}
		return href;
	}

	private createViewportRect(
		contents: ReadiumFrameContext,
		range: Range
	): HighlightClickInfo["rect"] | null {
		const rangeRect = range.getBoundingClientRect?.();
		if (!rangeRect || (!rangeRect.width && !rangeRect.height)) {
			return null;
		}

		const iframe = contents.window.frameElement as HTMLElement | null;
		const host =
			(iframe?.closest(".epub-reader-viewport") as HTMLElement | null) ||
			(this.renderContainer?.closest(".epub-reader-viewport") as HTMLElement | null) ||
			this.renderContainer;
		if (!iframe || !host) {
			return {
				top: rangeRect.top,
				left: rangeRect.left,
				bottom: rangeRect.bottom,
				right: rangeRect.right,
				width: rangeRect.width,
				height: rangeRect.height,
			};
		}

		const iframeRect = iframe.getBoundingClientRect();
		const hostRect = host.getBoundingClientRect();
		return {
			top: rangeRect.top + iframeRect.top - hostRect.top,
			left: rangeRect.left + iframeRect.left - hostRect.left,
			bottom: rangeRect.bottom + iframeRect.top - hostRect.top,
			right: rangeRect.right + iframeRect.left - hostRect.left,
			width: rangeRect.width,
			height: rangeRect.height,
		};
	}

	private dedupeHighlights(highlights: ReaderHighlight[]): ReaderHighlight[] {
		const deduped = new Map<string, ReaderHighlight>();
		for (const highlight of highlights) {
			deduped.set(this.normalizeHighlightKey(highlight.cfiRange), highlight);
		}
		return Array.from(deduped.values());
	}

	private isConcealmentHighlight(highlight: ReaderHighlight): boolean {
		return highlight.presentation === "conceal";
	}

	private getHighlightGroup(color?: string): string {
		const normalizedColor = String(color || "yellow")
			.trim()
			.toLowerCase();
		const safeColor =
			normalizedColor.replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "yellow";
		return `${ReadiumReaderService.HIGHLIGHT_GROUP}-${safeColor}`;
	}

	private normalizeHighlightKey(cfiRange: string): string {
		return this.normalizeLocationString(cfiRange).toLowerCase();
	}

	private normalizeLocationString(value: string): string {
		let normalized = String(value || "")
			.replace(/%5B/gi, "[")
			.replace(/%5D/gi, "]")
			.replace(/%7C/gi, "|");
		if (normalized.includes("%")) {
			try {
				normalized = decodeURIComponent(normalized);
			} catch (_error) {
				// Keep original value when decoding fails.
			}
		}
		return normalized.trim();
	}

	private isLegacyCfiLike(value: string): boolean {
		const normalized = this.normalizeLocationString(value);
		return normalized.startsWith("epubcfi(") || /^\/\d+/.test(normalized);
	}

	private isDocumentHrefLike(value: string): boolean {
		const normalized = this.normalizeLocationString(value);
		return /^([^{}]|%[0-9a-f]{2})+\.(xhtml|html|htm|svg)([#?].*)?$/i.test(normalized);
	}

	private queueHighlightRefresh(delayMs = 24): void {
		if (this.highlightRefreshTimer) {
			clearTimeout(this.highlightRefreshTimer);
		}
		this.highlightRefreshTimer = setTimeout(() => {
			this.highlightRefreshTimer = null;
			void this.refreshVisibleHighlights();
		}, delayMs);
	}

	private requestSelectionCleanup(): void {
		this.pendingSelectionCleanup = true;
		this.clearVisibleSelections();
	}

	private flushPendingSelectionCleanup(): void {
		if (!this.pendingSelectionCleanup) {
			return;
		}
		this.pendingSelectionCleanup = false;
		this.clearVisibleSelections();
	}

	private clearVisibleSelections(): void {
		try {
			window.getSelection?.()?.removeAllRanges();
		} catch (_error) {
			// Ignore host-window selection cleanup failures.
		}

		for (const contents of this.getFrameContexts()) {
			try {
				contents.window.getSelection?.()?.removeAllRanges();
			} catch (_error) {
				// Ignore transient frame selection cleanup failures.
			}
		}
	}

	private notifySelectionChange(cfiRange: string, frame: ReadiumFrameContext): void {
		const event: ReaderSelectionChange = { cfiRange, frame };
		for (const listener of this.selectionChangeCallbacks) {
			try {
				listener(event);
			} catch (error) {
				logger.warn("[ReadiumReaderService] Selection listener failed:", { cfiRange, error });
			}
		}
	}

	private notifyHighlightClick(info: HighlightClickInfo): void {
		for (const listener of this.highlightClickCallbacks) {
			try {
				listener(info);
			} catch (error) {
				logger.warn("[ReadiumReaderService] Highlight click listener failed:", {
					cfiRange: info.cfiRange,
					error,
				});
			}
		}
	}

	private createNotReadyError(methodName: string): Error {
		return new Error(`ReadiumReaderService 未完成初始化，无法调用 ${methodName}`);
	}

	private async destroyNavigatorOnly(): Promise<void> {
		if (this.contentsSyncTimer) {
			clearTimeout(this.contentsSyncTimer);
			this.contentsSyncTimer = null;
		}
		for (const cleanup of this.documentInteractionCleanups.values()) {
			cleanup();
		}
		this.documentInteractionCleanups.clear();

		const currentNavigator = this.navigator;
		this.navigator = null;
		this.renderContainer = null;
		if (!currentNavigator) {
			return;
		}
		try {
			await currentNavigator.destroy();
		} catch (error) {
			logger.warn("[ReadiumReaderService] Failed to destroy Readium navigator cleanly:", error);
		}
	}

	private resetTemporaryHighlightTimers(): void {
		for (const timer of this.temporaryHighlightTimers.values()) {
			clearTimeout(timer);
		}
		this.temporaryHighlightTimers.clear();
	}

	private resetTemporarilyRevealedConcealments(): void {
		for (const timer of this.temporarilyRevealedConcealmentTimers.values()) {
			clearTimeout(timer);
		}
		this.temporarilyRevealedConcealmentTimers.clear();
	}

	private resetHighlightState(): void {
		this.resetTemporaryHighlightTimers();
		this.resetTemporarilyRevealedConcealments();
		if (this.highlightRefreshTimer) {
			clearTimeout(this.highlightRefreshTimer);
			this.highlightRefreshTimer = null;
		}
		this.highlightDataMap.clear();
		this.highlightSectionIndexMap.clear();
		this.savedHighlights = [];
		this.knownHighlightGroups = new Set<string>([ReadiumReaderService.HIGHLIGHT_GROUP]);
		this.concealmentContainers = new WeakMap<Document, HTMLDivElement>();
	}

	private async destroyAll(): Promise<void> {
		await this.destroyNavigatorOnly();
		this.resetHighlightState();
		this.bridge.dispose();
		this.currentPublication = null;
		this.currentBook = null;
		this.currentLocator = null;
		this.currentPosition = { chapterIndex: 0, cfi: "", percent: 0 };
		this.currentPaginationInfo = { currentPage: 0, totalPages: 0 };
		this.relocatedCallbacks.clear();
		this.selectionChangeCallbacks.clear();
		this.highlightClickCallbacks.clear();
	}

	private resolveHighlightTint(color?: string): string {
		const palette = ReadiumReaderService.HIGHLIGHT_TINT_MAP[this.getCurrentColorScheme()];
		if (!color) {
			return palette.yellow;
		}
		return palette[color] || color;
	}

	private getConcealmentPalette(): {
		base: string;
		stripe: string;
		border: string;
		innerGlow: string;
		outerShadow: string;
	} {
		if (this.currentTheme === "sepia") {
			return {
				base: "rgba(240, 231, 211, 0.96)",
				stripe: "rgba(225, 213, 190, 0.98)",
				border: "rgba(125, 103, 76, 0.18)",
				innerGlow: "rgba(255, 250, 236, 0.5)",
				outerShadow: "rgba(90, 72, 48, 0.14)",
			};
		}

		if (this.getCurrentColorScheme() === "dark") {
			return {
				base: "rgba(86, 92, 104, 0.96)",
				stripe: "rgba(112, 119, 132, 0.98)",
				border: "rgba(255, 255, 255, 0.12)",
				innerGlow: "rgba(255, 255, 255, 0.06)",
				outerShadow: "rgba(0, 0, 0, 0.32)",
			};
		}

		return {
			base: "rgba(247, 243, 239, 0.96)",
			stripe: "rgba(232, 225, 216, 0.98)",
			border: "rgba(89, 79, 69, 0.12)",
			innerGlow: "rgba(255, 255, 255, 0.54)",
			outerShadow: "rgba(73, 61, 49, 0.12)",
		};
	}

	private getObsidianStyleSource(): HTMLElement {
		return this.renderContainer || document.body || document.documentElement;
	}

	private getObsidianCSSVar(varName: string, fallback: string): string {
		try {
			const styleSource = this.getObsidianStyleSource();
			const primary = getComputedStyle(styleSource).getPropertyValue(varName).trim();
			if (primary) {
				return primary;
			}
			const bodyValue = getComputedStyle(document.body).getPropertyValue(varName).trim();
			if (bodyValue) {
				return bodyValue;
			}
			const rootValue = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
			return rootValue || fallback;
		} catch {
			return fallback;
		}
	}

	private getObsidianFontStack(): string {
		const fontText = this.getObsidianCSSVar("--font-text", "").trim();
		const fontInterface = this.getObsidianCSSVar("--font-interface", "").trim();
		const baseFont = fontText || fontInterface;
		if (!baseFont) {
			return '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';
		}
		return `${baseFont}, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif`;
	}

	private getObsidianMonospaceFontStack(): string {
		const monoFont = this.getObsidianCSSVar("--font-monospace", "").trim();
		if (!monoFont) {
			return 'ui-monospace, "SFMono-Regular", Consolas, "Liberation Mono", monospace';
		}
		return `${monoFont}, ui-monospace, "SFMono-Regular", Consolas, "Liberation Mono", monospace`;
	}

	private getObsidianFontScale(): number {
		const rawSize = this.getObsidianCSSVar(
			"--font-text-size",
			this.getObsidianCSSVar("--editor-font-size", "16px")
		)
			.trim()
			.toLowerCase();
		if (!rawSize) {
			return 1;
		}

		const numeric = Number.parseFloat(rawSize);
		if (!Number.isFinite(numeric) || numeric <= 0) {
			return 1;
		}

		if (rawSize.endsWith("px")) {
			return this.clamp(numeric / 16, 0.75, 2.5);
		}
		if (rawSize.endsWith("%")) {
			return this.clamp(numeric / 100, 0.75, 2.5);
		}
		return this.clamp(numeric, 0.75, 2.5);
	}

	private getCurrentColorScheme(): "light" | "dark" {
		if (
			document.body.classList.contains("theme-dark") ||
			document.documentElement.classList.contains("theme-dark")
		) {
			return "dark";
		}
		return "light";
	}

	private clamp(value: number, min: number, max: number): number {
		return Math.min(Math.max(value, min), max);
	}
}
