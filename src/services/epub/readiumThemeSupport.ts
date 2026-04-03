export const READIUM_THEME_DOCUMENT_ATTRIBUTE = "data-weave-readium-theme-overrides";
export const READIUM_BOOTSTRAP_THEME_STYLE_ATTRIBUTE = "data-weave-readium-bootstrap-theme";

export const READIUM_THEMEABLE_TEXT_SELECTORS = [
	"p",
	"div",
	"span",
	"li",
	"a",
	"blockquote",
	"dd",
	"dt",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"section",
	"article",
	"aside",
	"nav",
	"main",
	"header",
	"footer",
	"strong",
	"em",
	"b",
	"i",
	"small",
	"sub",
	"sup",
	"ruby",
	"rt",
	"rp",
	"ul",
	"ol",
	"dl",
	"table",
	"thead",
	"tbody",
	"tfoot",
	"tr",
	"td",
	"th",
	"caption",
	"font",
].join(", ");

export const READIUM_THEMEABLE_BACKGROUND_SELECTORS = [
	"p",
	"div",
	"span",
	"li",
	"blockquote",
	"dd",
	"dt",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"section",
	"article",
	"aside",
	"nav",
	"main",
	"header",
	"footer",
	"ul",
	"ol",
	"dl",
	"table",
	"thead",
	"tbody",
	"tfoot",
	"tr",
	"td",
	"th",
	"caption",
	"font",
].join(", ");

const PRESERVE_INLINE_BACKGROUND_TAGS = new Set([
	"IMG",
	"SVG",
	"VIDEO",
	"AUDIO",
	"CANVAS",
	"PICTURE",
	"SOURCE",
]);

const PRESERVE_INLINE_FONT_SIZE_TAGS = new Set([
	"H1",
	"H2",
	"H3",
	"H4",
	"H5",
	"H6",
	"SMALL",
	"SUB",
	"SUP",
]);

export function markReadiumThemeDocument(doc: Document): void {
	doc.documentElement?.setAttribute(READIUM_THEME_DOCUMENT_ATTRIBUTE, "true");
}

export function buildReadiumBootstrapThemeStyles(): string {
	const rootSelector = `html[${READIUM_THEME_DOCUMENT_ATTRIBUTE}][${READIUM_THEME_DOCUMENT_ATTRIBUTE}][${READIUM_THEME_DOCUMENT_ATTRIBUTE}]`;
	return `${rootSelector} {
	color-scheme: light dark;
	background: var(--USER__backgroundColor, var(--RS__backgroundColor, Canvas)) !important;
	color: var(--USER__textColor, var(--RS__textColor, CanvasText)) !important;
	-webkit-text-size-adjust: 100%;
}
${rootSelector} body {
	background: transparent !important;
	color: inherit !important;
	font-family: var(--USER__fontFamily, var(--RS__baseFontFamily, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif)) !important;
	line-height: var(--USER__lineHeight, var(--RS__baseLineHeight, 1.72)) !important;
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
	background: transparent !important;
	background-color: transparent !important;
}
${rootSelector} body :is(a, a:link, a:visited) {
	color: var(--USER__linkColor, var(--RS__linkColor, rgb(80, 110, 214))) !important;
}
${rootSelector} body :is(pre, code, kbd, samp) {
	font-family: var(--WEAVE__codeFontFamily, ui-monospace, "SFMono-Regular", Consolas, "Liberation Mono", monospace) !important;
	white-space: pre-wrap !important;
	word-break: break-word;
}
${rootSelector} body :is(img, svg, video, canvas) {
	max-width: 100% !important;
}
${rootSelector} body ::selection {
	background: var(--USER__selectionBackgroundColor, var(--RS__selectionBackgroundColor, rgba(120, 140, 255, 0.32)));
	color: var(--USER__selectionTextColor, var(--RS__selectionTextColor, currentColor));
}
`;
}

export function ensureReadiumBootstrapThemeStyle(doc: Document): void {
	const parent = doc.head || doc.documentElement;
	if (!parent) {
		return;
	}

	let styleElement = parent.querySelector(
		`style[${READIUM_BOOTSTRAP_THEME_STYLE_ATTRIBUTE}]`
	) as HTMLStyleElement | null;
	if (!styleElement) {
		styleElement = doc.createElement("style");
		styleElement.setAttribute(READIUM_BOOTSTRAP_THEME_STYLE_ATTRIBUTE, "true");
		parent.appendChild(styleElement);
	}
	styleElement.textContent = buildReadiumBootstrapThemeStyles();
}

export function normalizeReadiumThemeInlineStyles(doc: Document): void {
	const styledElements = Array.from(
		doc.querySelectorAll("[style], [color], [bgcolor], font[face], font[size]")
	);
	for (const node of styledElements) {
		if (!("style" in node)) {
			continue;
		}

		const element = node as HTMLElement;
		const tagName = String(element.tagName || "").toUpperCase();

		if (element.style.color || element.hasAttribute("color")) {
			setImportantStyle(element, "color", "inherit");
			if (element.hasAttribute("color")) {
				element.removeAttribute("color");
			}
		}

		if (element.style.fontFamily || element.hasAttribute("face")) {
			setImportantStyle(element, "font-family", "inherit");
			if (element.hasAttribute("face")) {
				element.removeAttribute("face");
			}
		}

		if (
			!PRESERVE_INLINE_FONT_SIZE_TAGS.has(tagName) &&
			(element.style.fontSize || element.hasAttribute("size"))
		) {
			setImportantStyle(element, "font-size", "inherit");
			if (element.hasAttribute("size")) {
				element.removeAttribute("size");
			}
		}

		if (element.style.lineHeight) {
			setImportantStyle(element, "line-height", "inherit");
		}

		if (
			!PRESERVE_INLINE_BACKGROUND_TAGS.has(tagName) &&
			(element.style.background || element.style.backgroundColor || element.hasAttribute("bgcolor"))
		) {
			setImportantStyle(element, "background", "transparent");
			setImportantStyle(element, "background-color", "transparent");
			if (element.hasAttribute("bgcolor")) {
				element.removeAttribute("bgcolor");
			}
		}
	}
}

function setImportantStyle(element: HTMLElement, propertyName: string, value: string): void {
	element.style.setProperty(propertyName, value, "important");
}
