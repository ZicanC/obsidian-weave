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

export type EpubReaderEngineType = "readium";

export type FlashStyle = "pulse" | "highlight" | "none";
export type ReaderHighlightPresentation = "highlight" | "conceal";

export interface NavigateAndHighlightOptions {
	cfi?: string;
	href?: string;
	text?: string;
	flashStyle?: FlashStyle;
	flashColor?: string;
	dismiss?: "click" | "auto";
}

export interface ReaderNavigateOptions {
	cfi?: string;
	href?: string;
	text?: string;
}

export interface HighlightClickInfo {
	cfiRange: string;
	color: string;
	text: string;
	sourceFile: string;
	sourceRef?: string;
	createdTime?: number;
	temporary?: boolean;
	presentation?: ReaderHighlightPresentation;
	rect: { top: number; left: number; bottom: number; right: number; width: number; height: number };
}

export interface ReaderHighlightInput {
	cfiRange: string;
	color: string;
	text?: string;
	sourceFile?: string;
	sourceRef?: string;
	createdTime?: number;
	presentation?: ReaderHighlightPresentation;
}

export interface ReaderHighlight extends ReaderHighlightInput {
	temporary?: boolean;
}

export interface ReaderRenderOptions {
	width?: number;
	height?: number;
	flow?: string;
	spread?: string;
	manager?: "default" | "continuous";
	minSpreadWidth?: number;
	theme?: EpubTheme;
	lineHeight?: number;
	widthMode?: EpubWidthMode;
}

export interface ReaderAppearanceOptions {
	theme?: EpubTheme;
	lineHeight?: number;
	widthMode?: EpubWidthMode;
}

export interface ReaderFrame {
	document: Document;
	window: Window;
	cfiFromRange: (range: Range) => string | null;
}

export interface ReaderSelectionChange {
	cfiRange: string;
	frame: ReaderFrame;
}

export interface EpubReaderEngine {
	readonly engineType: EpubReaderEngineType;
	loadEpub(filePath: string, existingBookId?: string): Promise<EpubBook>;
	renderTo(container: HTMLElement, options?: ReaderRenderOptions): Promise<void>;
	goToLocation(cfi: string): Promise<void>;
	canonicalizeLocation?(cfi: string, textHint?: string): Promise<string | null>;
	getReadingProgress(): number;
	getPaginationInfo(): Promise<PaginationInfo>;
	isLayoutChanging(): boolean;
	resize(width: number, height: number): void;
	applyReaderAppearance(theme: EpubTheme, lineHeight: number, redisplay?: boolean): Promise<void>;
	onRelocated(callback: (position: ReadingPosition) => void): () => void;
	setLayoutMode(
		mode: EpubLayoutMode,
		flowMode: EpubFlowMode,
		appearance?: ReaderAppearanceOptions
	): Promise<void>;
	searchText(query: string): Promise<Array<{ cfi: string; excerpt: string; chapterTitle: string }>>;
	getTableOfContents(): Promise<TocItem[]>;
	navigateTo(options: ReaderNavigateOptions): Promise<void>;
	navigateAndHighlight(options: NavigateAndHighlightOptions): Promise<void>;
	getNavigationTargetRect(options: { cfi?: string; href?: string; text?: string }): DOMRect | null;
	getCurrentPosition(): ReadingPosition;
	getCurrentChapterTitle(): string;
	getCurrentChapterIndex(): number;
	getCurrentChapterHref?(): string;
	getSectionHrefForCfi?(cfi: string): string | null;
	getCurrentCFI(): string;
	prevPage(): Promise<void>;
	nextPage(): Promise<void>;
	getPageNumberFromCfi(cfi: string): Promise<number | undefined>;
	getVisibleFrames(): ReaderFrame[];
	onSelectionChange(callback: (event: ReaderSelectionChange) => void): () => void;
	onHighlightClick(callback: (info: HighlightClickInfo) => void): () => void;
	applyHighlights(highlights: ReaderHighlight[]): Promise<void>;
	refreshHighlights?(): Promise<void>;
	addHighlight(highlight: ReaderHighlight): void;
	addTemporaryHighlight(highlight: ReaderHighlightInput, durationMs?: number): void;
	temporarilyRevealConcealedText?(cfiRange: string, durationMs?: number): void;
	removeHighlight(cfiRange: string): void;
	destroy(): void;
}
