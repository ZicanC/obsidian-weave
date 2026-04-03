import { EpubLinkService } from '../EpubLinkService';

const encodeCompactField = (value: string): string => Buffer.from(value, 'utf8').toString('base64url');

const buildCompactReadiumLocator = (href: string, progression: string, highlight?: string): string => {
	const fields = ['loc', encodeCompactField(href), progression, '', '', highlight ? encodeCompactField(highlight) : ''];
	while (fields.length > 1 && fields[fields.length - 1] === '') {
		fields.pop();
	}
	return `readium:${fields.join('~')}`;
};

describe('EpubLinkService legacy link compatibility', () => {
	it('extracts the first EPUB wikilink for both current and legacy hash formats', () => {
		const current = '前文 [[Books/demo.epub#weave-cfi=readium%3Aabc|Demo]] 后文';
		const legacyDash = '前文 [[Books/demo.epub#tuanki-cfi-epubcfi(/6/2[chapter-1]!/4/4)|Demo]] 后文';
		const legacyEquals = '前文 [[Books/demo.epub#tuanki-cfi=epubcfi(/6/2[chapter-1]!/4/4)|Demo]] 后文';

		expect(EpubLinkService.extractFirstEpubLinkMarkup(current)).toBe('[[Books/demo.epub#weave-cfi=readium%3Aabc|Demo]]');
		expect(EpubLinkService.extractFirstEpubLinkMarkup(legacyDash)).toBe('[[Books/demo.epub#tuanki-cfi-epubcfi(/6/2[chapter-1]!/4/4)|Demo]]');
		expect(EpubLinkService.extractFirstEpubLinkMarkup(legacyEquals)).toBe('[[Books/demo.epub#tuanki-cfi=epubcfi(/6/2[chapter-1]!/4/4)|Demo]]');
	});

	it('extracts legacy protocol EPUB links and resolves their file paths', () => {
		const protocolLink = '[EPUB来源](obsidian://weave-epub?vault=Vault&file=Books%2Fdemo.epub&cfi=epubcfi(/6/2)&text=Hello)';

		expect(EpubLinkService.extractFirstEpubLinkMarkup(protocolLink)).toBe(protocolLink);
		expect(EpubLinkService.extractFilePathFromEpubLinkMarkup(protocolLink)).toBe('Books/demo.epub');
	});

	it('parses both legacy tuanki subpaths and readium subpaths', () => {
		expect(EpubLinkService.parseEpubLink('#tuanki-cfi-epubcfi(/6/2[chapter-1]!/4/4)')).toEqual({
			filePath: '',
			cfi: 'epubcfi(/6/2[chapter-1]!/4/4)',
			text: '',
			chapter: undefined,
		});

		expect(EpubLinkService.parseEpubLink('#tuanki-cfi=epubcfi(/6/2[chapter-1]!/4/4)')).toEqual({
			filePath: '',
			cfi: 'epubcfi(/6/2[chapter-1]!/4/4)',
			text: '',
			chapter: undefined,
		});

		expect(EpubLinkService.parseEpubLink('#weave-cfi=readium%3Aabc&chapter=3&text=Hello%20world')).toEqual({
			filePath: '',
			cfi: 'readium:abc',
			text: 'Hello world',
			chapter: 3,
		});
	});

	it('parses complete EPUB link markup for both current wikilinks and legacy protocol links', () => {
		expect(EpubLinkService.parseLinkMarkup('[[Books/demo.epub#weave-cfi=readium%3Aabc&chapter=3&text=Hello%20world|Demo]]')).toEqual({
			filePath: 'Books/demo.epub',
			cfi: 'readium:abc',
			text: 'Hello world',
			chapter: 3,
		});

		expect(EpubLinkService.parseLinkMarkup('[EPUB来源](obsidian://weave-epub?vault=Vault&file=Books%2Fdemo.epub&cfi=epubcfi(/6/2)&text=Hello)')).toEqual({
			filePath: 'Books/demo.epub',
			cfi: 'epubcfi(/6/2)',
			text: 'Hello',
			chapter: undefined,
		});
	});

	it('builds current wikilinks with text fallback payload and safe aliases', () => {
		const service = new EpubLinkService({} as any);

		expect(service.buildEpubLink(
			'Books/demo.epub',
			'readium:abc',
			'Hello world',
			3,
			'Part 1 | Intro ]]'
		)).toBe('[[Books/demo.epub#weave-cfi=readium:abc&chapter=3&text=Hello%20world|demo > Part 1 / Intro ] ]]]');
	});

	it('reuses embedded compact locator text instead of duplicating the text query payload', () => {
		const service = new EpubLinkService({} as any);
		const compactLocator = buildCompactReadiumLocator('OPS/text/chapter1.xhtml', '0.125', 'Hello world');

		expect(EpubLinkService.extractEmbeddedTextFromReadiumLocator(compactLocator)).toBe('Hello world');
		expect(EpubLinkService.parseEpubLink(`#weave-cfi=${compactLocator}&chapter=3`)).toEqual({
			filePath: '',
			cfi: compactLocator,
			text: 'Hello world',
			chapter: 3,
		});
		expect(service.buildEpubLink(
			'Books/demo.epub',
			compactLocator,
			'Hello world',
			3,
			'Part 1',
		)).toBe(`[[Books/demo.epub#weave-cfi=${compactLocator}&chapter=3|demo > Part 1]]`);
	});
});
