import type { App } from "obsidian";
import { MarkdownPostProcessorContext, setIcon } from "obsidian";
import { EpubLinkService } from "./EpubLinkService";

type BoundEpubLinkElement = HTMLAnchorElement & {
	__weaveEpubClickHandler?: (event: MouseEvent) => void;
	__weaveEpubBoundHref?: string;
};

function clearBoundEpubHandler(linkEl: BoundEpubLinkElement): void {
	if (linkEl.__weaveEpubClickHandler) {
		linkEl.removeEventListener("click", linkEl.__weaveEpubClickHandler);
		linkEl.__weaveEpubClickHandler = undefined;
	}
	linkEl.__weaveEpubBoundHref = undefined;
}

export function createEpubLinkPostProcessor(app: App) {
	return (el: HTMLElement, _ctx: MarkdownPostProcessorContext) => {
		const links = el.querySelectorAll("a");

		links.forEach((linkEl) => {
			const href = linkEl.getAttribute("href") || linkEl.getAttribute("data-href") || "";
			const boundLinkEl = linkEl as BoundEpubLinkElement;

			// EPUB wikilink format: [[book.epub#weave-cfi=...]] or legacy [[book.epub#tuanki-cfi-...]]
			if (
				href.match(/\.epub#(?:weave-cfi=|tuanki-cfi=|tuanki-cfi-)/) ||
				(linkEl.classList.contains("internal-link") && href.match(/\.epub/))
			) {
				const hashIdx = href.indexOf("#");
				if (hashIdx === -1) {
					clearBoundEpubHandler(boundLinkEl);
					return;
				}

				const filePath = href.substring(0, hashIdx);
				const subpath = href.substring(hashIdx);
				if (!EpubLinkService.hasSupportedEpubSubpath(subpath)) {
					clearBoundEpubHandler(boundLinkEl);
					return;
				}
				const parsed = EpubLinkService.parseEpubLink(subpath);
				if (!parsed) {
					clearBoundEpubHandler(boundLinkEl);
					return;
				}
				if (boundLinkEl.__weaveEpubBoundHref === href) return;

				clearBoundEpubHandler(boundLinkEl);

				styleEpubLink(
					linkEl,
					linkEl.textContent ||
						filePath
							.split("/")
							.pop()
							?.replace(/\.epub$/i, "") ||
						"EPUB"
				);

				boundLinkEl.__weaveEpubBoundHref = href;
				boundLinkEl.__weaveEpubClickHandler = async (e: MouseEvent) => {
					e.preventDefault();
					e.stopImmediatePropagation();
					const linkService = new EpubLinkService(app);
					await linkService.navigateToEpubLocation(filePath, parsed.cfi, parsed.text);
				};
				linkEl.addEventListener("click", boundLinkEl.__weaveEpubClickHandler);
				return;
			}

			clearBoundEpubHandler(boundLinkEl);

			// Legacy protocol format: obsidian://weave-epub?...
			if (!href.includes("weave-epub")) return;

			try {
				const url = new URL(href.startsWith("obsidian://") ? href : `obsidian://${href}`);
				const params = Object.fromEntries(url.searchParams.entries());
				if (!params.file || !params.cfi) return;

				const displayText = params.text
					? decodeURIComponent(params.text)
					: linkEl.textContent ||
					  decodeURIComponent(params.file)
							.split("/")
							.pop()
							?.replace(/\.epub$/i, "") ||
					  "EPUB";
				styleEpubLink(linkEl, displayText);
			} catch (_e) {
				// skip malformed links
			}
		});
	};
}

function styleEpubLink(linkEl: Element, displayText: string): void {
	linkEl.addClass("weave-epub-link");
	linkEl.removeClass("external-link");
	linkEl.empty();

	const inEpubCalloutTitle = Boolean(
		(linkEl as HTMLElement).closest('.callout[data-callout="epub"] .callout-title')
	);
	if (!inEpubCalloutTitle) {
		const iconSpan = (linkEl as HTMLElement).createSpan({
			cls: "weave-epub-link-icon",
		});
		setIcon(iconSpan, "book-open");
	}

	(linkEl as HTMLElement).createSpan({
		cls: "weave-epub-link-text",
		text: displayText,
	});
}
