import {
	buildReadiumBootstrapThemeStyles,
	ensureReadiumBootstrapThemeStyle,
	markReadiumThemeDocument,
	normalizeReadiumThemeInlineStyles,
	READIUM_BOOTSTRAP_THEME_STYLE_ATTRIBUTE,
	READIUM_THEME_DOCUMENT_ATTRIBUTE,
} from '../readiumThemeSupport';

describe('readiumThemeSupport', () => {
	it('marks documents so the bootstrap theme can match before first paint', () => {
		const doc = document.implementation.createHTMLDocument('theme');
		markReadiumThemeDocument(doc);

		expect(doc.documentElement.getAttribute(READIUM_THEME_DOCUMENT_ATTRIBUTE)).toBe('true');
	});

	it('neutralizes intrusive inline font and background styling before rendering', () => {
		const doc = document.implementation.createHTMLDocument('theme');
		doc.body.innerHTML = `
			<p id="copy" style="font-family: Papyrus; color: rgb(1, 2, 3); line-height: 3; background: red;">Hello</p>
			<font id="legacy" face="Courier" size="7" color="#ff0000">Legacy</font>
			<h1 id="heading" style="font-size: 48px;">Heading</h1>
		`;

		normalizeReadiumThemeInlineStyles(doc);

		const copy = doc.getElementById('copy') as HTMLElement;
		const legacy = doc.getElementById('legacy') as HTMLElement;
		const heading = doc.getElementById('heading') as HTMLElement;

		expect(copy.style.getPropertyValue('font-family')).toBe('inherit');
		expect(copy.style.getPropertyPriority('font-family')).toBe('important');
		expect(copy.style.getPropertyValue('color')).toBe('inherit');
		expect(copy.style.getPropertyValue('line-height')).toBe('inherit');
		expect(copy.style.getPropertyValue('background-color')).toBe('transparent');

		expect(legacy.hasAttribute('face')).toBe(false);
		expect(legacy.hasAttribute('size')).toBe(false);
		expect(legacy.hasAttribute('color')).toBe(false);

		expect(heading.style.getPropertyValue('font-size')).toBe('48px');
	});

	it('builds a bootstrap stylesheet that tracks Readium user preference variables', () => {
		const css = buildReadiumBootstrapThemeStyles();

		expect(css).toContain(`html[${READIUM_THEME_DOCUMENT_ATTRIBUTE}][${READIUM_THEME_DOCUMENT_ATTRIBUTE}][${READIUM_THEME_DOCUMENT_ATTRIBUTE}]`);
		expect(css).toContain('var(--USER__fontFamily');
		expect(css).toContain('var(--USER__lineHeight');
		expect(css).toContain('var(--USER__backgroundColor');
	});

	it('injects the bootstrap stylesheet inline so the first paint already uses reader theme rules', () => {
		const doc = document.implementation.createHTMLDocument('theme');
		ensureReadiumBootstrapThemeStyle(doc);

		const styleElement = doc.head.querySelector(`style[${READIUM_BOOTSTRAP_THEME_STYLE_ATTRIBUTE}]`) as HTMLStyleElement | null;
		expect(styleElement).not.toBeNull();
		expect(styleElement?.textContent).toContain('var(--USER__fontFamily');
	});
});
