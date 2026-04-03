import type { App } from "obsidian";
import { logger } from "../../utils/logger";

export interface EpubLinkParams {
	filePath: string;
	cfi: string;
	text: string;
	chapter?: number;
}

export class EpubLinkService {
	private static readonly COMPACT_READIUM_PREFIX = "readium:loc~";
	private app: App;

	constructor(app: App) {
		this.app = app;
	}

	static encodeCfiForWikilink(cfi: string): string {
		return cfi.replace(/\[/g, "%5B").replace(/\]/g, "%5D").replace(/\|/g, "%7C");
	}

	static encodeTextForWikilink(text: string): string {
		return encodeURIComponent(text);
	}

	static decodeCfiFromWikilink(encoded: string): string {
		return encoded.replace(/%5B/gi, "[").replace(/%5D/gi, "]").replace(/%7C/gi, "|");
	}

	static normalizeCfi(cfi: string): string {
		let normalized = cfi.replace(/%5B/gi, "[").replace(/%5D/gi, "]").replace(/%7C/gi, "|");
		if (normalized.includes("%")) {
			try {
				normalized = decodeURIComponent(normalized);
			} catch {
				/* use as-is */
			}
		}
		return normalized;
	}

	private static decodeCompactLocatorField(value?: string): string | undefined {
		if (!value) {
			return undefined;
		}
		try {
			const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
			const paddingLength = (4 - (normalized.length % 4)) % 4;
			const binary = atob(`${normalized}${"=".repeat(paddingLength)}`);
			const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
			return new TextDecoder().decode(bytes);
		} catch {
			return undefined;
		}
	}

	static extractEmbeddedTextFromReadiumLocator(cfi: string): string | undefined {
		const normalized = EpubLinkService.normalizeCfi(cfi);
		if (!normalized.startsWith(EpubLinkService.COMPACT_READIUM_PREFIX)) {
			return undefined;
		}
		const parts = normalized.slice("readium:".length).split("~");
		if (parts[0] !== "loc") {
			return undefined;
		}
		return EpubLinkService.decodeCompactLocatorField(parts[5]);
	}

	static hasSupportedEpubSubpath(subpath: string): boolean {
		return (
			subpath.includes("weave-cfi=") ||
			subpath.includes("tuanki-cfi=") ||
			subpath.includes("tuanki-cfi-")
		);
	}

	static extractFirstEpubLinkMarkup(content: string): string | undefined {
		if (!content) return undefined;
		const normalized = content.replace(/\r\n/g, "\n");
		const wikilinkMatch = normalized.match(
			/(\[\[(?:(?!\]\]).)+\.epub(?:(?!\]\]).)*(?:#weave-cfi=|#tuanki-cfi=|#tuanki-cfi-)(?:(?!\]\]).)*\]\])/i
		);
		if (wikilinkMatch?.[1]) {
			return wikilinkMatch[1];
		}
		return EpubLinkService.extractLegacyProtocolLinkMarkup(normalized);
	}

	static extractFilePathFromEpubLinkMarkup(markup: string): string | null {
		if (!markup) return null;

		if (markup.startsWith("[[") && markup.endsWith("]]")) {
			const inner = markup.slice(2, -2);
			const hashIndex = inner.indexOf("#");
			const pipeIndex = inner.indexOf("|");
			const boundaryIndexCandidates = [hashIndex, pipeIndex].filter((index) => index >= 0);
			const boundaryIndex =
				boundaryIndexCandidates.length > 0 ? Math.min(...boundaryIndexCandidates) : inner.length;
			return inner.slice(0, boundaryIndex) || null;
		}

		const href = markup.startsWith("obsidian://weave-epub?")
			? markup
			: EpubLinkService.extractProtocolHrefFromMarkdownLink(markup) || "";
		if (!href) return null;

		return EpubLinkService.parseProtocolHref(href)?.filePath || null;
	}

	private static extractLegacyProtocolLinkMarkup(content: string): string | undefined {
		const startMatch = content.match(/\[[^\]]*]\(obsidian:\/\/weave-epub\?/i);
		const startIndex = startMatch?.index;
		if (startIndex === undefined) {
			return undefined;
		}

		const openParenIndex = content.indexOf("(", startIndex);
		if (openParenIndex < 0) {
			return undefined;
		}

		let depth = 0;
		for (let i = openParenIndex; i < content.length; i++) {
			const char = content[i];
			if (char === "(") {
				depth++;
			} else if (char === ")") {
				depth--;
				if (depth === 0) {
					return content.slice(startIndex, i + 1);
				}
			}
		}

		return undefined;
	}

	private static extractProtocolHrefFromMarkdownLink(markup: string): string | null {
		const openParenIndex = markup.indexOf("(obsidian://weave-epub?");
		const closeParenIndex = markup.lastIndexOf(")");
		if (openParenIndex < 0 || closeParenIndex <= openParenIndex) {
			return null;
		}

		return markup.slice(openParenIndex + 1, closeParenIndex);
	}

	private static decodeQueryValue(value: string): string {
		try {
			return decodeURIComponent(value);
		} catch {
			return value;
		}
	}

	private static extractProtocolQueryParams(href: string): Record<string, string> {
		const params: Record<string, string> = {};
		for (const key of ["file", "cfi", "text", "chapter"]) {
			const match = href.match(new RegExp(`[?&]${key}=([^&)]*)`, "i"));
			if (match?.[1]) {
				params[key] = EpubLinkService.decodeQueryValue(match[1]);
			}
		}
		return params;
	}

	private static parseProtocolHref(href: string): EpubLinkParams | null {
		try {
			const url = new URL(href);
			return EpubLinkService.parseProtocolParams(Object.fromEntries(url.searchParams.entries()));
		} catch {
			return EpubLinkService.parseProtocolParams(EpubLinkService.extractProtocolQueryParams(href));
		}
	}

	static extractShortBookName(filePath: string): string {
		const fullName =
			filePath
				.split("/")
				.pop()
				?.replace(/\.epub$/i, "") || "EPUB";
		const mainTitle = fullName.split(/[([{]/)[0].trim();
		if (mainTitle.length > 25) {
			return `${mainTitle.slice(0, 25)}...`;
		}
		return mainTitle || fullName.slice(0, 25);
	}

	private static sanitizeWikilinkAlias(alias: string): string {
		return alias
			.replace(/\r?\n+/g, " ")
			.replace(/\|/g, " / ")
			.replace(/\]\]/g, "] ]")
			.replace(/\s+/g, " ")
			.trim();
	}

	buildEpubLink(
		filePath: string,
		cfi: string,
		text: string,
		chapterIndex?: number,
		chapterTitle?: string
	): string {
		const bookName = EpubLinkService.extractShortBookName(filePath);
		let displayText: string;
		if (chapterTitle) {
			displayText = `${bookName} > ${chapterTitle}`;
		} else {
			displayText = bookName;
		}
		const safeCfi = EpubLinkService.encodeCfiForWikilink(cfi);
		let subpath = `weave-cfi=${safeCfi}`;
		if (chapterIndex !== undefined) {
			subpath += `&chapter=${chapterIndex}`;
		}
		const trimmedText = text.trim();
		if (trimmedText && !EpubLinkService.extractEmbeddedTextFromReadiumLocator(cfi)) {
			subpath += `&text=${EpubLinkService.encodeTextForWikilink(trimmedText)}`;
		}
		return `[[${filePath}#${subpath}|${EpubLinkService.sanitizeWikilinkAlias(displayText)}]]`;
	}

	buildQuoteBlock(
		filePath: string,
		cfi: string,
		text: string,
		chapterIndex?: number,
		color?: string,
		chapterTitle?: string,
		timestamp?: string
	): string {
		const link = this.buildEpubLink(filePath, cfi, text, chapterIndex, chapterTitle);
		const calloutMeta = color ? `|${color}` : "";
		const timeSuffix = timestamp ? ` ${timestamp}` : "";
		const quotedLines = text
			.split("\n")
			.map((_line) => `> ${_line}`)
			.join("\n");
		return `> [!EPUB${calloutMeta}] ${link}${timeSuffix}\n${quotedLines}\n`;
	}

	static parseLinkMarkup(markup: string): EpubLinkParams | null {
		if (!markup) return null;

		if (markup.startsWith("[[") && markup.endsWith("]]")) {
			const inner = markup.slice(2, -2);
			const hashIdx = inner.indexOf("#");
			if (hashIdx === -1) {
				return null;
			}
			const parsed = EpubLinkService.parseEpubLink(inner.slice(hashIdx));
			if (!parsed) {
				return null;
			}
			const filePath = EpubLinkService.extractFilePathFromEpubLinkMarkup(markup);
			return filePath ? { ...parsed, filePath } : null;
		}

		const href = markup.startsWith("obsidian://weave-epub?")
			? markup
			: EpubLinkService.extractProtocolHrefFromMarkdownLink(markup) || "";
		if (!href) {
			return null;
		}

		return EpubLinkService.parseProtocolHref(href);
	}

	static parseEpubLink(subpath: string): EpubLinkParams | null {
		if (!subpath || !EpubLinkService.hasSupportedEpubSubpath(subpath)) {
			return null;
		}

		try {
			const hashContent = subpath.startsWith("#") ? subpath.slice(1) : subpath;

			// support both weave-cfi= (current) and tuanki-cfi- (legacy) formats
			const cfiMatch =
				hashContent.match(/weave-cfi=(epubcfi\([^)]*\))/) ||
				hashContent.match(/weave-cfi=([^&|\]]*)/) ||
				hashContent.match(/tuanki-cfi=(epubcfi\([^)]*\))/) ||
				hashContent.match(/tuanki-cfi=([^&|\]]*)/) ||
				hashContent.match(/tuanki-cfi-(epubcfi\([^)]*\))/) ||
				hashContent.match(/tuanki-cfi-([^&|\]]*)/);
			const chapterMatch = hashContent.match(/[&?]chapter=(\d+)/);
			const textMatch = hashContent.match(/[&?]text=([^&|\]]*)/);

			if (!cfiMatch) {
				return null;
			}

			let cfi = cfiMatch[1];
			cfi = EpubLinkService.decodeCfiFromWikilink(cfi);
			if (cfi.includes("%")) {
				try {
					cfi = decodeURIComponent(cfi);
				} catch {
					/* use as-is */
				}
			}

			return {
				filePath: "",
				cfi,
				text: textMatch?.[1]
					? decodeURIComponent(textMatch[1])
					: EpubLinkService.extractEmbeddedTextFromReadiumLocator(cfi) || "",
				chapter: chapterMatch ? parseInt(chapterMatch[1], 10) : undefined,
			};
		} catch (e) {
			logger.warn("[EpubLinkService] Failed to parse epub link:", subpath, e);
			return null;
		}
	}

	static parseProtocolParams(params: Record<string, string>): EpubLinkParams | null {
		const file = params.file;
		const cfi = params.cfi;
		const text = params.text || "";
		const chapter = params.chapter;

		if (!file || !cfi) return null;

		return {
			filePath: file,
			cfi,
			text,
			chapter: chapter ? parseInt(chapter, 10) : undefined,
		};
	}

	async navigateToEpubLocation(filePath: string, cfi: string, text: string): Promise<void> {
		try {
			const [{ VIEW_TYPE_EPUB }, { getPreferredEpubLeaf }] = await Promise.all([
				import("../../views/EpubView"),
				import("../../utils/epub-leaf-utils"),
			]);
			const targetLeaf = getPreferredEpubLeaf(this.app, filePath);
			if (!targetLeaf) return;

			this.app.workspace.setActiveLeaf(targetLeaf, { focus: true });
			await targetLeaf.setViewState({
				type: VIEW_TYPE_EPUB,
				active: true,
				state: { filePath, pendingCfi: cfi, pendingText: text },
			});
			void this.app.workspace.revealLeaf(targetLeaf);

			logger.debug("[EpubLinkService] Navigated to:", filePath, cfi);
		} catch (error) {
			logger.error("[EpubLinkService] Navigation failed:", error);
		}
	}
}
