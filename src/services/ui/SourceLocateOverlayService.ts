import { setIcon } from "obsidian";

interface LocateOverlayOptions {
	label?: string;
	icon?: string;
	durationMs?: number;
}

const DEFAULT_DURATION = 2600;
const EPUB_LOCATE_LINK_PREFIX = "__weave_epub_link__=";
const EPUB_LOCATE_CFI_PREFIX = "__weave_epub_cfi__=";
const EPUB_LOCATE_TIME_PREFIX = "__weave_epub_time__=";

interface MarkdownLocateRequest {
	searchCandidates: string[];
	textCandidates: string[];
	epubLinkCandidates: string[];
	epubCfiCandidates: string[];
	createdTime?: number;
	hasEpubTarget: boolean;
}

export class SourceLocateOverlayService {
	private overlayEl: HTMLElement | null = null;
	private timer: number | null = null;

	showAtRect(rect: DOMRect, options: LocateOverlayOptions = {}): void {
		if (!rect || (rect.width === 0 && rect.height === 0)) return;
		this.clear();

		const label = options.label || "定位到溯源位置";
		const icon = options.icon || "map-pinned";
		const overlay = document.body.createDiv({ cls: "weave-source-locate-overlay" });
		const iconWrap = overlay.createDiv({ cls: "weave-source-locate-overlay__icon" });
		setIcon(iconWrap, icon);
		overlay.createSpan({ cls: "weave-source-locate-overlay__label", text: label });

		const top = Math.min(
			window.scrollY + window.innerHeight - 56,
			Math.max(
				window.scrollY + 12,
				rect.top + window.scrollY + Math.min(12, Math.max(4, rect.height * 0.18))
			)
		);
		const left = Math.min(
			window.scrollX + window.innerWidth - 220,
			Math.max(
				window.scrollX + 12,
				rect.left + window.scrollX + Math.min(18, Math.max(6, rect.width * 0.12))
			)
		);

		overlay.style.top = `${top}px`;
		overlay.style.left = `${left}px`;
		this.overlayEl = overlay;
		this.timer = window.setTimeout(() => this.clear(), options.durationMs ?? DEFAULT_DURATION);
	}

	showTopCenter(anchor: HTMLElement, options: LocateOverlayOptions = {}): void {
		const rect = anchor.getBoundingClientRect();
		const virtualRect = new DOMRect(rect.left + rect.width / 2 - 70, rect.top + 24, 140, 24);
		this.showAtRect(virtualRect, options);
	}

	findMarkdownTarget(container: HTMLElement, candidates: string[]): HTMLElement | null {
		const request = this.parseMarkdownLocateRequest(candidates);
		const cleanCandidates = request.searchCandidates;
		if (request.hasEpubTarget) {
			const epubCalloutTarget = this.findPreviewTargetByEpubCallout(container, request);
			if (epubCalloutTarget) return epubCalloutTarget;
		}
		if (cleanCandidates.length === 0) return null;

		if (request.hasEpubTarget) {
			const directTarget = this.findPreviewTargetByAttributes(container, cleanCandidates);
			if (directTarget) return directTarget;

			const previewBlock = this.findPreviewTargetByText(
				container,
				request.textCandidates.length > 0 ? request.textCandidates : cleanCandidates
			);
			if (previewBlock) return previewBlock;
		} else {
			const previewBlockByText = this.findPreviewTargetByText(container, request.textCandidates);
			if (previewBlockByText) return previewBlockByText;

			const directTarget = this.findPreviewTargetByAttributes(container, cleanCandidates);
			if (directTarget) return directTarget;

			const previewBlock = this.findPreviewTargetByText(container, cleanCandidates);
			if (previewBlock) return previewBlock;
		}

		const previewLinks = Array.from(
			container.querySelectorAll(
				".markdown-preview-view a.internal-link, .markdown-preview-view a[href]"
			)
		) as HTMLElement[];
		const previewLink = previewLinks.find((link) => {
			const href = `${link.getAttribute("href") || ""} ${link.getAttribute("data-href") || ""}`;
			return cleanCandidates.some((candidate) => this.matchesCandidate(href, candidate));
		});

		if (previewLink) {
			const target = previewLink.closest(".callout, blockquote, p, li, div") as HTMLElement | null;
			return target || previewLink;
		}

		if (request.hasEpubTarget) {
			return null;
		}

		const sourceLines = Array.from(container.querySelectorAll(".cm-line")) as HTMLElement[];
		const sourceLine = sourceLines.find((line) =>
			cleanCandidates.some((candidate) => this.matchesCandidate(line.textContent || "", candidate))
		);
		if (sourceLine) return sourceLine;

		const activeLine = container.querySelector(".cm-active, .cm-line") as HTMLElement | null;
		if (activeLine) return activeLine;

		return null;
	}

	showForMarkdownTarget(
		container: HTMLElement,
		candidates: string[],
		options: LocateOverlayOptions = {}
	): boolean {
		const target = this.findMarkdownTarget(container, candidates);
		if (!target) return false;
		this.showAtRect(target.getBoundingClientRect(), options);
		return true;
	}

	private parseMarkdownLocateRequest(candidates: string[]): MarkdownLocateRequest {
		const rawSearchCandidates: string[] = [];
		const textCandidates: string[] = [];
		const epubLinkCandidates: string[] = [];
		const epubCfiCandidates: string[] = [];
		let createdTime: number | undefined;

		for (const candidate of candidates) {
			if (typeof candidate !== "string") continue;
			const value = candidate.trim();
			if (!value) continue;

			if (value.startsWith(EPUB_LOCATE_LINK_PREFIX)) {
				const linkValue = value.slice(EPUB_LOCATE_LINK_PREFIX.length).trim();
				if (linkValue) {
					epubLinkCandidates.push(linkValue);
					rawSearchCandidates.push(linkValue);
				}
				continue;
			}

			if (value.startsWith(EPUB_LOCATE_CFI_PREFIX)) {
				const cfiValue = value.slice(EPUB_LOCATE_CFI_PREFIX.length).trim();
				if (cfiValue) {
					epubCfiCandidates.push(cfiValue);
					rawSearchCandidates.push(cfiValue);
				}
				continue;
			}

			if (value.startsWith(EPUB_LOCATE_TIME_PREFIX)) {
				const numericValue = Number(value.slice(EPUB_LOCATE_TIME_PREFIX.length).trim());
				if (Number.isFinite(numericValue) && numericValue > 0) {
					createdTime = numericValue;
				}
				continue;
			}

			rawSearchCandidates.push(value);
			textCandidates.push(value);
		}

		return {
			searchCandidates: Array.from(
				new Set(rawSearchCandidates.flatMap((candidate) => this.buildCandidateVariants(candidate)))
			),
			textCandidates: Array.from(
				new Set(textCandidates.filter((candidate) => this.isDescriptiveTextCandidate(candidate)))
			),
			epubLinkCandidates: Array.from(
				new Set(epubLinkCandidates.flatMap((candidate) => this.buildCandidateVariants(candidate)))
			),
			epubCfiCandidates: Array.from(
				new Set(epubCfiCandidates.flatMap((candidate) => this.buildCandidateVariants(candidate)))
			),
			createdTime,
			hasEpubTarget: epubLinkCandidates.length > 0 || epubCfiCandidates.length > 0,
		};
	}

	clear(): void {
		if (this.timer !== null) {
			window.clearTimeout(this.timer);
			this.timer = null;
		}
		this.overlayEl?.remove();
		this.overlayEl = null;
	}

	private buildCandidateVariants(candidate: string): string[] {
		const value = candidate.trim();
		if (!value) return [];

		const variants = new Set<string>([value]);
		if (value.startsWith("^")) variants.add(value.slice(1));
		else variants.add(`^${value}`);

		if (value.startsWith("#^")) {
			variants.add(value.slice(2));
			variants.add(value.slice(1));
		}

		if (value.includes("#^")) {
			const [, suffix] = value.split("#^");
			if (suffix) {
				variants.add(suffix);
				variants.add(`^${suffix}`);
			}
		}

		return Array.from(variants).filter(Boolean);
	}

	private findPreviewTargetByAttributes(
		container: HTMLElement,
		candidates: string[]
	): HTMLElement | null {
		if (candidates.length === 0) return null;
		const previewTargets = Array.from(
			container.querySelectorAll(
				".markdown-preview-view [id], .markdown-preview-view [data-heading], .markdown-preview-view [data-block-id], .markdown-preview-view [data-blockid], .markdown-preview-view [href], .markdown-preview-view [data-href]"
			)
		) as HTMLElement[];

		let bestElement: HTMLElement | null = null;
		let bestScore = 0;

		for (const element of previewTargets) {
			const values = [
				element.id,
				element.getAttribute("data-heading") || "",
				element.getAttribute("data-block-id") || "",
				element.getAttribute("data-blockid") || "",
				element.getAttribute("href") || "",
				element.getAttribute("data-href") || "",
			].join(" ");
			const score = this.scoreBestCandidateMatch(values, candidates);
			if (score > bestScore) {
				bestScore = score;
				bestElement = element;
			}
		}

		return bestScore > 0 ? bestElement : null;
	}

	private findPreviewTargetByText(
		container: HTMLElement,
		candidates: string[]
	): HTMLElement | null {
		if (candidates.length === 0) return null;
		const previewBlocks = Array.from(
			container.querySelectorAll(
				".markdown-preview-view .callout, .markdown-preview-view blockquote, .markdown-preview-view li, .markdown-preview-view p, .markdown-preview-view pre, .markdown-preview-view h1, .markdown-preview-view h2, .markdown-preview-view h3, .markdown-preview-view h4, .markdown-preview-view h5, .markdown-preview-view h6"
			)
		) as HTMLElement[];

		let bestElement: HTMLElement | null = null;
		let bestScore = 0;

		for (const element of previewBlocks) {
			const text = element.textContent || "";
			if (!text.trim()) continue;
			const score = this.scoreBestCandidateMatch(text, candidates);
			if (score > bestScore) {
				bestScore = score;
				bestElement = element;
			}
		}

		return bestScore > 0 ? bestElement : null;
	}

	private findPreviewTargetByEpubCallout(
		container: HTMLElement,
		request: MarkdownLocateRequest
	): HTMLElement | null {
		const blockSet = new Set<HTMLElement>();
		for (const selector of [
			".markdown-preview-view .callout",
			".markdown-preview-view blockquote",
			".markdown-rendered .callout",
			".markdown-rendered blockquote",
		]) {
			for (const block of Array.from(container.querySelectorAll(selector)) as HTMLElement[]) {
				blockSet.add(block);
			}
		}

		let bestElement: HTMLElement | null = null;
		let bestScore = 0;

		for (const block of blockSet) {
			const score = this.scoreEpubCalloutBlock(block, request);
			if (score > bestScore) {
				bestScore = score;
				bestElement = block;
			}
		}

		return bestScore > 0 ? bestElement : null;
	}

	private scoreEpubCalloutBlock(block: HTMLElement, request: MarkdownLocateRequest): number {
		const linkCandidates = [...request.epubLinkCandidates, ...request.epubCfiCandidates];
		if (linkCandidates.length === 0) return 0;

		const links = Array.from(
			block.querySelectorAll("a.internal-link, a[href], [data-href], [href]")
		) as HTMLElement[];
		let bestLinkScore = 0;

		for (const link of links) {
			const values = [
				link.getAttribute("href") || "",
				link.getAttribute("data-href") || "",
				link.getAttribute("aria-label") || "",
				link.getAttribute("title") || "",
				link.textContent || "",
			].join(" ");
			bestLinkScore = Math.max(bestLinkScore, this.scoreBestCandidateMatch(values, linkCandidates));
		}

		if (bestLinkScore === 0) {
			bestLinkScore = this.scoreBestCandidateMatch(this.serializeElement(block), linkCandidates);
		}
		if (bestLinkScore === 0) return 0;

		let totalScore = 5000 + bestLinkScore * 100;
		if (request.createdTime) {
			totalScore +=
				this.scoreBestCandidateMatch(
					block.textContent || "",
					this.buildTimestampCandidates(request.createdTime)
				) * 10;
		}
		return totalScore;
	}

	private matchesCandidate(haystack: string, candidate: string): boolean {
		const normalizedHaystack = this.normalizeForMatch(haystack);
		const normalizedCandidate = this.normalizeForMatch(candidate);
		if (!normalizedHaystack || !normalizedCandidate) return false;
		return normalizedHaystack.includes(normalizedCandidate);
	}

	private scoreBestCandidateMatch(haystack: string, candidates: string[]): number {
		let bestScore = 0;
		for (const candidate of candidates) {
			const score = this.scoreCandidateMatch(haystack, candidate);
			if (score > bestScore) {
				bestScore = score;
			}
		}
		return bestScore;
	}

	private serializeElement(element: Element): string {
		return new XMLSerializer().serializeToString(element);
	}

	private scoreCandidateMatch(haystack: string, candidate: string): number {
		const normalizedHaystack = this.normalizeForMatch(haystack);
		const normalizedCandidate = this.normalizeForMatch(candidate);
		if (
			!normalizedHaystack ||
			!normalizedCandidate ||
			!normalizedHaystack.includes(normalizedCandidate)
		) {
			return 0;
		}

		const candidateLength = normalizedCandidate.length;
		const descriptiveBoost = this.isDescriptiveTextCandidate(candidate) ? 1000 : 0;
		return descriptiveBoost + Math.min(candidateLength, 400);
	}

	private isDescriptiveTextCandidate(candidate: string): boolean {
		const normalized = this.normalizeForMatch(candidate);
		if (!normalized || normalized.length < 10) return false;
		if (
			normalized.includes("weave-cfi=") ||
			normalized.includes("tuanki-cfi-") ||
			normalized.includes("weave-epub")
		)
			return false;
		if (normalized.startsWith("^") || normalized.startsWith("#^")) return false;
		if (
			normalized.endsWith(".md") ||
			normalized.endsWith(".epub") ||
			normalized.includes(".md#") ||
			normalized.includes(".epub#")
		) {
			return false;
		}
		return /[\u4e00-\u9fff]/.test(normalized) || /\s/.test(candidate);
	}

	private normalizeForMatch(value: string): string {
		return this.tryDecodeURIComponent(value)
			.replace(/\s+/g, " ")
			.replace(/[“”]/g, '"')
			.replace(/[‘’]/g, "'")
			.trim()
			.toLowerCase();
	}

	private buildTimestampCandidates(createdTime: number): string[] {
		const date = new Date(createdTime);
		if (!Number.isFinite(date.getTime())) return [];

		const y = date.getFullYear();
		const mo = String(date.getMonth() + 1).padStart(2, "0");
		const d = String(date.getDate()).padStart(2, "0");
		const h = String(date.getHours()).padStart(2, "0");
		const mi = String(date.getMinutes()).padStart(2, "0");
		const s = String(date.getSeconds()).padStart(2, "0");

		return [`${y}-${mo}-${d} ${h}:${mi}`, `${y}-${mo}-${d} ${h}:${mi}:${s}`, `${y}-${mo}-${d}`];
	}

	private tryDecodeURIComponent(value: string): string {
		let decoded = value;
		for (let i = 0; i < 2; i++) {
			try {
				const next = decodeURIComponent(decoded);
				if (next === decoded) break;
				decoded = next;
			} catch (_e) {
				break;
			}
		}
		return decoded;
	}
}

let sourceLocateOverlayService: SourceLocateOverlayService | null = null;

export function getSourceLocateOverlayService(): SourceLocateOverlayService {
	if (!sourceLocateOverlayService) {
		sourceLocateOverlayService = new SourceLocateOverlayService();
	}
	return sourceLocateOverlayService;
}
