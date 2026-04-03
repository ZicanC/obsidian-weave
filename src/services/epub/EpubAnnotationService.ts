import { t } from "../../utils/i18n";
import { generateCardUUID } from "../identifier/WeaveIDGenerator";
import type { EpubBacklinkHighlightService } from "./EpubBacklinkHighlightService";
import { EpubLinkService } from "./EpubLinkService";
import type { EpubStorageService } from "./EpubStorageService";
import type { ReaderHighlight } from "./reader-engine-types";
import type { Bookmark, ConcealedText, Highlight, HighlightColor, Note } from "./types";

export class EpubAnnotationService {
	private storageService: EpubStorageService;
	private clearedLegacyHighlightBooks = new Set<string>();

	constructor(storageService: EpubStorageService) {
		this.storageService = storageService;
	}

	async createBookmark(
		bookId: string,
		title: string,
		chapterIndex: number,
		cfi: string,
		preview: string,
		pageNumber?: number
	): Promise<Bookmark> {
		const bookmark: Bookmark = {
			id: generateCardUUID(),
			title,
			chapterIndex,
			cfi,
			preview,
			pageNumber,
			createdTime: Date.now(),
		};

		await this.storageService.addBookmark(bookId, bookmark);
		return bookmark;
	}

	async deleteBookmark(bookId: string, bookmarkId: string): Promise<void> {
		await this.storageService.deleteBookmark(bookId, bookmarkId);
	}

	async getBookmarks(bookId: string): Promise<Bookmark[]> {
		return await this.storageService.loadBookmarks(bookId);
	}

	async createHighlight(
		bookId: string,
		text: string,
		color: HighlightColor,
		chapterIndex: number,
		cfiRange: string
	): Promise<Highlight> {
		const highlight: Highlight = {
			id: generateCardUUID(),
			text,
			color,
			chapterIndex,
			cfiRange,
			createdTime: Date.now(),
		};

		await this.storageService.addHighlight(bookId, highlight);
		return highlight;
	}

	async deleteHighlight(bookId: string, highlightId: string): Promise<void> {
		await this.storageService.deleteHighlight(bookId, highlightId);
	}

	async getHighlights(bookId: string): Promise<Highlight[]> {
		return await this.storageService.loadHighlights(bookId);
	}

	async createNote(
		bookId: string,
		content: string,
		chapterIndex: number,
		quotedText?: string,
		cfi?: string
	): Promise<Note> {
		const note: Note = {
			id: generateCardUUID(),
			content,
			quotedText,
			chapterIndex,
			cfi,
			createdTime: Date.now(),
			modifiedTime: Date.now(),
		};

		await this.storageService.addNote(bookId, note);
		return note;
	}

	async updateNote(bookId: string, noteId: string, content: string): Promise<void> {
		await this.storageService.updateNote(bookId, noteId, content);
	}

	async deleteNote(bookId: string, noteId: string): Promise<void> {
		await this.storageService.deleteNote(bookId, noteId);
	}

	async getNotes(bookId: string): Promise<Note[]> {
		return await this.storageService.loadNotes(bookId);
	}

	async createConcealedText(
		bookId: string,
		text: string,
		chapterIndex: number,
		cfiRange: string,
		mode: ConcealedText["mode"] = "mask"
	): Promise<ConcealedText> {
		const concealedText: ConcealedText = {
			id: generateCardUUID(),
			text,
			mode,
			chapterIndex,
			cfiRange,
			createdTime: Date.now(),
		};

		await this.storageService.addConcealedText(bookId, concealedText);
		return concealedText;
	}

	async deleteConcealedTextByCfi(bookId: string, cfiRange: string): Promise<void> {
		const normalizedTarget = EpubLinkService.normalizeCfi(cfiRange);
		const concealedTexts = await this.storageService.loadConcealedTexts(bookId);
		const filtered = concealedTexts.filter(
			(item) => EpubLinkService.normalizeCfi(item.cfiRange) !== normalizedTarget
		);
		await this.storageService.saveConcealedTexts(bookId, filtered);
	}

	async getConcealedTexts(bookId: string): Promise<ConcealedText[]> {
		return await this.storageService.loadConcealedTexts(bookId);
	}

	async exportToMarkdown(bookId: string): Promise<string> {
		const book = await this.storageService.getBook(bookId);
		if (!book) {
			throw new Error("Book not found");
		}

		const bookmarks = await this.getBookmarks(bookId);
		const highlights = await this.getHighlights(bookId);
		const notes = await this.getNotes(bookId);

		let markdown = `# ${book.metadata.title} - ${t("epub.export.readingNotes")}\n\n`;
		markdown += `## ${t("epub.export.bookInfo")}\n\n`;
		markdown += `- **${t("epub.export.author")}**: ${book.metadata.author}\n`;
		if (book.metadata.publisher) {
			markdown += `- **${t("epub.export.publisher")}**: ${book.metadata.publisher}\n`;
		}
		if (book.metadata.isbn) {
			markdown += `- **ISBN**: ${book.metadata.isbn}\n`;
		}
		markdown += `- **${t("epub.export.readingProgress")}**: ${book.currentPosition.percent}%\n`;
		markdown += "\n";

		if (bookmarks.length > 0) {
			markdown += `## ${t("epub.export.bookmarks")}\n\n`;
			for (const bookmark of bookmarks) {
				markdown += `- **${bookmark.title}**\n`;
				markdown += `  > ${bookmark.preview}\n\n`;
			}
		}

		if (highlights.length > 0) {
			markdown += `## ${t("epub.export.highlights")}\n\n`;
			const groupedByColor = highlights.reduce((acc, h) => {
				if (!acc[h.color]) acc[h.color] = [];
				acc[h.color].push(h);
				return acc;
			}, {} as Record<HighlightColor, Highlight[]>);

			for (const [color, items] of Object.entries(groupedByColor)) {
				markdown += `### ${this.getColorName(color as HighlightColor)}\n\n`;
				for (const highlight of items) {
					markdown += `> ${highlight.text}\n\n`;
				}
			}
		}

		if (notes.length > 0) {
			markdown += `## ${t("epub.export.notes")}\n\n`;
			for (const note of notes) {
				markdown += `### ${new Date(note.createdTime).toLocaleDateString()}\n\n`;
				markdown += `${note.content}\n\n`;
				if (note.quotedText) {
					markdown += `> ${note.quotedText}\n\n`;
				}
			}
		}

		return markdown;
	}

	private getColorName(color: HighlightColor): string {
		const keyMap: Record<HighlightColor, string> = {
			yellow: "epub.export.colorYellow",
			green: "epub.export.colorGreen",
			blue: "epub.export.colorBlue",
			red: "epub.export.colorRed",
			purple: "epub.export.colorPurple",
		};
		return t(keyMap[color]);
	}

	async collectAllHighlights(
		bookId: string,
		filePath: string,
		backlinkService: EpubBacklinkHighlightService
	): Promise<ReaderHighlight[]> {
		const allHighlights: ReaderHighlight[] = [];
		const storedHighlights = await this.getHighlights(bookId);
		if (storedHighlights.length > 0 && !this.clearedLegacyHighlightBooks.has(bookId)) {
			// 历史版本会把 EPUB 高亮重复写入本地 highlights.json，导致源摘录删除后界面仍残留。
			// 现在统一以 md/canvas/卡片中的真实摘录为准，因此这里清掉遗留缓存。
			await this.storageService.saveHighlights(bookId, []);
			this.clearedLegacyHighlightBooks.add(bookId);
		}

		const boundCanvasPath = await this.storageService.getCanvasBinding(bookId);
		const backlinkHighlights = await backlinkService.collectHighlights(filePath, boundCanvasPath);
		for (const bh of backlinkHighlights) {
			const bhNorm = EpubLinkService.normalizeCfi(bh.cfiRange);
			const existing = allHighlights.find(
				(h) => EpubLinkService.normalizeCfi(h.cfiRange) === bhNorm
			);
			if (existing) {
				if (!existing.sourceFile) existing.sourceFile = bh.sourceFile;
				if (!existing.sourceRef) existing.sourceRef = bh.sourceRef;
			} else {
				allHighlights.push({
					cfiRange: bh.cfiRange,
					color: bh.color,
					text: bh.text,
					sourceFile: bh.sourceFile,
					sourceRef: bh.sourceRef,
					createdTime: bh.createdTime,
					presentation: "highlight",
				});
			}
		}

		const concealedTexts = await this.getConcealedTexts(bookId);
		for (const concealedText of concealedTexts) {
			allHighlights.push({
				cfiRange: concealedText.cfiRange,
				color: "mask",
				text: concealedText.text,
				createdTime: concealedText.createdTime,
				presentation: "conceal",
			});
		}

		return allHighlights;
	}
}
