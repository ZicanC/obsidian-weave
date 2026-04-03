import JSZip from 'jszip';
import { TFile } from 'obsidian';
import { ReadiumReaderService } from '../ReadiumReaderService';
import { ReadiumVaultPublicationBridge } from '../ReadiumVaultPublicationBridge';

async function createSampleEpubBuffer(options: { includeCover?: boolean } = {}): Promise<ArrayBuffer> {
	const includeCover = options.includeCover ?? true;
	const zip = new JSZip();
	zip.file('mimetype', 'application/epub+zip');
	zip.file(
		'META-INF/container.xml',
		`<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
	<rootfiles>
		<rootfile full-path="OPS/content.opf" media-type="application/oebps-package+xml" />
	</rootfiles>
</container>`,
	);
	zip.file(
		'OPS/content.opf',
		`<?xml version="1.0" encoding="UTF-8"?>
<package version="3.0" unique-identifier="BookId" xmlns="http://www.idpf.org/2007/opf">
	<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
		<dc:title>Readium Sample</dc:title>
		<dc:creator>Author R</dc:creator>
		<dc:publisher>Weave Press</dc:publisher>
		<dc:language>zh-CN</dc:language>
	</metadata>
	<manifest>
		<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav" />
		${includeCover ? '<item id="cover" href="images/cover.png" media-type="image/png" properties="cover-image" />' : ''}
		<item id="chapter-1" href="text/chapter1.xhtml" media-type="application/xhtml+xml" />
	</manifest>
	<spine>
		<itemref idref="chapter-1" />
	</spine>
</package>`,
	);
	zip.file(
		'OPS/nav.xhtml',
		`<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
	<body>
		<nav epub:type="toc">
			<ol>
				<li>
					<a href="text/chapter1.xhtml">Chapter 1</a>
					<ol>
						<li><a href="text/chapter1.xhtml#sec-1">Section 1</a></li>
					</ol>
				</li>
			</ol>
		</nav>
	</body>
</html>`,
	);
	zip.file(
		'OPS/text/chapter1.xhtml',
		`<html xmlns="http://www.w3.org/1999/xhtml">
	<head><title>Chapter 1</title></head>
	<body>
		<h1 id="sec-1">Chapter 1</h1>
		<p id="para-1">Selection text for testing.</p>
	</body>
</html>`,
	);
	if (includeCover) {
		zip.file('OPS/images/cover.png', new Uint8Array([137, 80, 78, 71]));
	}
	return zip.generateAsync({ type: 'arraybuffer' });
}

async function createRootNcxEpubBuffer(): Promise<ArrayBuffer> {
	const zip = new JSZip();
	zip.file('mimetype', 'application/epub+zip');
	zip.file(
		'META-INF/container.xml',
		`<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
	<rootfiles>
		<rootfile full-path="OPS/content.opf" media-type="application/oebps-package+xml" />
	</rootfiles>
</container>`,
	);
	zip.file(
		'OPS/content.opf',
		`<?xml version="1.0" encoding="UTF-8"?>
<package version="2.0" unique-identifier="BookId" xmlns="http://www.idpf.org/2007/opf">
	<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
		<dc:title>NCX Root Sample</dc:title>
		<dc:creator>Author Root</dc:creator>
	</metadata>
	<manifest>
		<item id="ncx" href="/toc.ncx" media-type="application/x-dtbncx+xml" />
		<item id="chapter-1" href="text/chapter1.xhtml" media-type="application/xhtml+xml" />
	</manifest>
	<spine toc="ncx">
		<itemref idref="chapter-1" />
	</spine>
</package>`,
	);
	zip.file(
		'toc.ncx',
		`<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
	<navMap>
		<navPoint id="chapter-1" playOrder="1">
			<navLabel><text>Root NCX Chapter</text></navLabel>
			<content src="OPS/text/chapter1.xhtml" />
		</navPoint>
	</navMap>
</ncx>`,
	);
	zip.file(
		'OPS/text/chapter1.xhtml',
		`<html xmlns="http://www.w3.org/1999/xhtml">
	<head><title>Root NCX Chapter</title></head>
	<body>
		<h1 id="sec-1">Root NCX Chapter</h1>
		<p id="para-1">Selection text for testing.</p>
	</body>
</html>`,
	);
	return zip.generateAsync({ type: 'arraybuffer' });
}

async function createCaseInsensitiveMalformedEpubBuffer(): Promise<ArrayBuffer> {
	const zip = new JSZip();
	zip.file('mimetype', 'application/epub+zip');
	zip.file(
		'META-INF/container.xml',
		`<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
	<rootfiles>
		<rootfile full-path="OPS/content.opf" media-type="application/oebps-package+xml" />
	</rootfiles>
</container>`,
	);
	zip.file(
		'OPS/CONTENT.OPF',
		`<?xml version="1.0" encoding="UTF-8"?>
<package version="3.0" unique-identifier="BookId" xmlns="http://www.idpf.org/2007/opf">
	<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
		<dc:title>Broken Case Sample</dc:title>
		<dc:creator>Author C</dc:creator>
	</metadata>
	<manifest>
		<item id="nav" href="NAV.XHTML" media-type="application/xhtml+xml" properties="nav" />
		<item id="chapter-1" href="Text/Chapter1.xhtml" media-type="application/xhtml+xml" />
	</manifest>
	<spine>
		<itemref idref="chapter-1" />
	</spine>
</package>`,
	);
	zip.file(
		'OPS/nav.xhtml',
		`<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
	<body>
		<nav epub:type="toc">
			<ol>
				<li><a href="Text/Chapter1.xhtml">Broken Chapter</a></li>
			</ol>
		</nav>
	</body>
</html>`,
	);
	zip.file(
		'OPS/text/CHAPTER1.XHTML',
		`<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
	<body>
		<p id="para-1"><span style="font-size: 30px; color: #f00">Selection text for testing.`,
	);
	return zip.generateAsync({ type: 'arraybuffer' });
}

function getBinarySize(binary: unknown): number {
	if (binary instanceof ArrayBuffer) {
		return binary.byteLength;
	}
	if (ArrayBuffer.isView(binary)) {
		return binary.byteLength;
	}
	if (Array.isArray(binary)) {
		return binary.length;
	}
	if (binary && typeof binary === 'object' && 'byteLength' in binary) {
		const byteLength = Number((binary as { byteLength?: unknown }).byteLength);
		return Number.isFinite(byteLength) && byteLength >= 0 ? byteLength : 0;
	}
	return 0;
}

function createMockApp(binary: unknown) {
	const createVaultFile = (path: string) => {
		const normalizedPath = path.replace(/\\/g, '/');
		const fileName = normalizedPath.split('/').pop() || 'sample.epub';
		const folderPath = normalizedPath.includes('/') ? normalizedPath.slice(0, normalizedPath.lastIndexOf('/')) : '';
		return Object.assign(Object.create(TFile.prototype), {
			path: normalizedPath,
			name: fileName,
			basename: fileName.replace(/\.[^.]+$/, ''),
			extension: 'epub',
			parent: folderPath ? { path: folderPath } : null,
			stat: {
				size: getBinarySize(binary),
				mtime: Date.now(),
				ctime: Date.now(),
			},
		});
	};

	return {
		vault: {
			getAbstractFileByPath: vi.fn((path: string) => createVaultFile(path)),
			readBinary: vi.fn(async () => binary),
		},
	};
}

afterEach(() => {
	vi.restoreAllMocks();
	document.body.innerHTML = '';
	document.body.className = '';
	document.documentElement.className = '';
});

describe('ReadiumReaderService', () => {
	it('uses Readium as the only EPUB engine', () => {
		const engine = new ReadiumReaderService({} as any);
		expect(engine).toBeInstanceOf(ReadiumReaderService);
		expect(engine.engineType).toBe('readium');
	});

	it('removes relocated listeners when callers unsubscribe to avoid duplicate progress callbacks across remounts', () => {
		const service = new ReadiumReaderService(createMockApp(new ArrayBuffer(0)) as any);
		const callback = vi.fn();
		const unsubscribe = service.onRelocated(callback);

		expect((service as any).relocatedCallbacks.size).toBe(1);

		unsubscribe();

		expect((service as any).relocatedCallbacks.size).toBe(0);
		service.destroy();
	});

	it('loads a sample EPUB and resolves toc, search and locator metadata', async () => {
		const service = new ReadiumReaderService(createMockApp(await createSampleEpubBuffer()) as any);
		try {
			const book = await service.loadEpub('Books/readium-sample.epub', 'readium-book');
			expect(book.metadata.title).toBe('Readium Sample');
			expect(book.metadata.author).toBe('Author R');
			expect(book.metadata.chapterCount).toBe(1);

			const toc = await service.getTableOfContents();
			expect(toc).toHaveLength(1);
			expect(toc[0]?.label).toBe('Chapter 1');
			expect(toc[0]?.subitems?.[0]?.label).toBe('Section 1');

			const sectionHref = toc[0]?.subitems?.[0]?.href || toc[0]?.href;
			expect(sectionHref).toBeTruthy();

			const canonical = await service.canonicalizeLocation(sectionHref as string);
			expect(canonical?.startsWith('readium:loc~')).toBe(true);
			expect(service.getSectionHrefForCfi(canonical as string)).toBeTruthy();
			expect(await service.getPageNumberFromCfi(canonical as string)).toBe(1);

			const results = await service.searchText('Selection text for testing');
			expect(results).toHaveLength(1);
			expect(results[0]?.chapterTitle).toBe('Chapter 1');
			expect(results[0]?.excerpt).toContain('Selection text for testing');
			expect(results[0]?.cfi.startsWith('readium:loc~')).toBe(true);
		} finally {
			service.destroy();
		}
	});

	it('loads EPUBs whose NCX is addressed from the archive root with a leading slash', async () => {
		const service = new ReadiumReaderService(createMockApp(await createRootNcxEpubBuffer()) as any);
		try {
			const book = await service.loadEpub('Books/root-ncx.epub', 'root-ncx-book');
			expect(book.metadata.title).toBe('NCX Root Sample');

			const toc = await service.getTableOfContents();
			expect(toc).toHaveLength(1);
			expect(toc[0]?.label).toBe('Root NCX Chapter');
			expect(toc[0]?.href).toBe('OPS/text/chapter1.xhtml');
		} finally {
			service.destroy();
		}
	});

	it('loads case-mismatched EPUB resources and repairs malformed XHTML chapters', async () => {
		const service = new ReadiumReaderService(createMockApp(await createCaseInsensitiveMalformedEpubBuffer()) as any);
		try {
			const book = await service.loadEpub('Books/broken-case.epub', 'broken-case-book');
			expect(book.metadata.title).toBe('Broken Case Sample');

			const toc = await service.getTableOfContents();
			expect(toc).toHaveLength(1);
			expect(toc[0]?.label).toBe('Broken Chapter');

			const bridge = (service as any).bridge as {
				getRawDocumentByHref: (href: string) => Promise<Document | null>;
				getRewrittenHtml: (href: string) => Promise<string>;
			};
			const chapterDoc = await bridge.getRawDocumentByHref('OPS/Text/Chapter1.xhtml');
			expect(chapterDoc?.querySelector('#para-1')?.textContent).toContain('Selection text for testing.');

			const rewrittenHtml = await bridge.getRewrittenHtml('OPS/Text/Chapter1.xhtml');
			expect(rewrittenHtml).toContain('Selection text for testing.');
		} finally {
			service.destroy();
		}
	});

	it('skips temporary highlights for plain navigation requests', async () => {
		const service = new ReadiumReaderService(createMockApp(new ArrayBuffer(0)) as any);
		try {
			vi.spyOn(service as any, 'canonicalizeLocation').mockResolvedValue('readium:plain-nav');
			const goToLocation = vi.spyOn(service, 'goToLocation').mockResolvedValue();
			const addTemporaryHighlight = vi.spyOn(service as any, 'addTemporaryHighlight').mockImplementation(() => {});

			await service.navigateAndHighlight({
				href: 'OPS/text/chapter1.xhtml',
				flashStyle: 'none',
			});

			expect(goToLocation).toHaveBeenCalledWith('readium:plain-nav');
			expect(addTemporaryHighlight).not.toHaveBeenCalled();
		} finally {
			service.destroy();
		}
	});

	it('navigates without creating a temporary highlight when callers use the plain navigation API', async () => {
		const service = new ReadiumReaderService(createMockApp(new ArrayBuffer(0)) as any);
		try {
			vi.spyOn(service as any, 'canonicalizeLocation').mockResolvedValue('readium:toc-nav');
			const goToLocation = vi.spyOn(service, 'goToLocation').mockResolvedValue();
			const addTemporaryHighlight = vi.spyOn(service as any, 'addTemporaryHighlight').mockImplementation(() => {});

			await service.navigateTo({
				href: 'OPS/text/chapter1.xhtml',
			});

			expect(goToLocation).toHaveBeenCalledWith('readium:toc-nav');
			expect(addTemporaryHighlight).not.toHaveBeenCalled();
		} finally {
			service.destroy();
		}
	});

	it('exposes explicit frame selection events for the current selection toolbar UI', async () => {
		const service = new ReadiumReaderService(createMockApp(await createSampleEpubBuffer()) as any);
		try {
			await service.loadEpub('Books/readium-sample.epub', 'readium-book');
			document.body.innerHTML = '<div class="epub-reader-viewport"><p id="para-1">Selection text for testing.</p></div>';

			const contents = {
				frame: {},
				frameSource: 'frame://compat-selection',
				sectionIndex: 0,
				document,
				window,
				sourceHref: 'OPS/text/chapter1.xhtml',
				cfiFromRange: vi.fn().mockReturnValue('readium:compat-selection'),
			};

			(service as any).navigator = {
				_cframes: [{}],
				viewport: {
					readingOrder: ['OPS/text/chapter1.xhtml'],
				},
			};

			vi.spyOn(service as any, 'createFrameContext').mockReturnValue(contents);

			const selected = vi.fn();
			service.onSelectionChange(selected);

			(service as any).syncCurrentContents();

			expect(service.getVisibleFrames()).toEqual([contents]);

			const paragraph = document.getElementById('para-1');
			const textNode = paragraph?.firstChild;
			expect(textNode).toBeTruthy();

			const range = document.createRange();
			range.setStart(textNode!, 0);
			range.setEnd(textNode!, 'Selection text for testing.'.length);

			const selection = window.getSelection();
			selection?.removeAllRanges();
			selection?.addRange(range);
			(service as any).handleTextSelected({
				targetFrameSrc: 'frame://compat-selection',
			});

			expect(contents.cfiFromRange).toHaveBeenCalled();
			expect(selected).toHaveBeenCalledWith({
				cfiRange: 'readium:compat-selection',
				frame: contents,
			});
		} finally {
			service.destroy();
		}
	});

	it('notifies every highlight click listener so reader UI layers can react independently', async () => {
		const service = new ReadiumReaderService(createMockApp(await createSampleEpubBuffer()) as any);
		try {
			await service.loadEpub('Books/readium-sample.epub', 'readium-book');
			document.body.innerHTML = '<div class="epub-reader-viewport"><p id="para-1">Selection text for testing.</p></div>';

			const contents = {
				frame: {},
				frameSource: 'frame://compat-highlight',
				sectionIndex: 0,
				document,
				window,
				sourceHref: 'OPS/text/chapter1.xhtml',
				cfiFromRange: vi.fn().mockReturnValue('readium:compat-highlight'),
			};

			(service as any).navigator = {
				_cframes: [{}],
				viewport: {
					readingOrder: ['OPS/text/chapter1.xhtml'],
				},
			};

			vi.spyOn(service as any, 'createFrameContext').mockReturnValue(contents);

			const highlight = {
				cfiRange: 'readium:highlight-click',
				color: 'blue',
				text: 'Selection text for testing.',
				sourceFile: 'Notes/sample.md',
				sourceRef: 'block-ref',
				createdTime: 123456789,
			};
			const highlightRect = {
				top: 10,
				left: 20,
				bottom: 40,
				right: 120,
				width: 100,
				height: 30,
			};

			vi.spyOn(service as any, 'findHighlightHit').mockReturnValue({
				cfiRange: highlight.cfiRange,
				highlight,
				rect: highlightRect,
			});

			const hideSelectionToolbar = vi.fn();
			const openHighlightToolbar = vi.fn();
			service.onHighlightClick(hideSelectionToolbar);
			service.onHighlightClick(openHighlightToolbar);

			(service as any).syncCurrentContents();
			document.dispatchEvent(new MouseEvent('click', {
				bubbles: true,
				clientX: 22,
				clientY: 18,
			}));

			expect(hideSelectionToolbar).toHaveBeenCalledWith(expect.objectContaining({
				cfiRange: highlight.cfiRange,
				color: 'blue',
				text: 'Selection text for testing.',
				sourceFile: 'Notes/sample.md',
				sourceRef: 'block-ref',
				createdTime: 123456789,
				rect: highlightRect,
			}));
			expect(openHighlightToolbar).toHaveBeenCalledWith(expect.objectContaining({
				cfiRange: highlight.cfiRange,
				color: 'blue',
				text: 'Selection text for testing.',
				sourceFile: 'Notes/sample.md',
				sourceRef: 'block-ref',
				createdTime: 123456789,
				rect: highlightRect,
			}));
		} finally {
			service.destroy();
		}
	});

	it('marks body clicks and taps as handled so Readium does not turn pages from content-edge clicks', () => {
		const service = new ReadiumReaderService(createMockApp(new ArrayBuffer(0)) as any);
		try {
			const listeners = (service as any).createNavigatorListeners();

			expect(listeners.click({} as any)).toBe(true);
			expect(listeners.tap({} as any)).toBe(true);
		} finally {
			service.destroy();
		}
	});

	it('clears pending host and frame selections after controlled navigation sync', async () => {
		const service = new ReadiumReaderService(createMockApp(await createSampleEpubBuffer()) as any);
		try {
			await service.loadEpub('Books/readium-sample.epub', 'readium-book');
			document.body.innerHTML = '<div class="epub-reader-viewport"><p id="para-1">Selection text for testing.</p></div>';

			const paragraph = document.getElementById('para-1');
			const textNode = paragraph?.firstChild;
			expect(textNode).toBeTruthy();

			const range = document.createRange();
			range.setStart(textNode!, 0);
			range.setEnd(textNode!, 'Selection text for testing.'.length);

			const hostSelection = window.getSelection();
			hostSelection?.removeAllRanges();
			hostSelection?.addRange(range);
			expect(hostSelection?.rangeCount).toBe(1);

			const frameRemoveAllRanges = vi.fn();
			const contents = {
				frame: {},
				frameSource: 'frame://selection-cleanup',
				sectionIndex: 0,
				document,
				window: {
					getSelection: () => ({
						removeAllRanges: frameRemoveAllRanges,
					}),
				},
				sourceHref: 'OPS/text/chapter1.xhtml',
				cfiFromRange: vi.fn(),
			};

			(service as any).navigator = {
				_cframes: [{}],
				viewport: {
					readingOrder: ['OPS/text/chapter1.xhtml'],
				},
			};

			vi.spyOn(service as any, 'createFrameContext').mockReturnValue(contents);

			(service as any).requestSelectionCleanup();
			(service as any).syncCurrentContents();

			expect(hostSelection?.rangeCount).toBe(0);
			expect(frameRemoveAllRanges).toHaveBeenCalled();
			expect((service as any).pendingSelectionCleanup).toBe(false);
		} finally {
			service.destroy();
		}
	});

	it('uses separate decoration groups per highlight color so later EPUB excerpts do not recolor earlier ones', async () => {
		const service = new ReadiumReaderService(createMockApp(new ArrayBuffer(0)) as any);
		try {
			const sendDecorate = vi.spyOn(service as any, 'sendDecorate').mockResolvedValue(true);
			vi.spyOn(service as any, 'canonicalizeLocation').mockImplementation(
				async (...args: unknown[]) => String(args[0] ?? ''),
			);
			vi.spyOn(service as any, 'getFrameContexts').mockReturnValue([{ sectionIndex: 0 }]);

			(service as any).bridge = {
				deserializeLocatorString: vi.fn((cfi: string) => ({
					href: 'OPS/text/chapter1.xhtml',
					serialize: () => ({ href: 'OPS/text/chapter1.xhtml', cfi }),
				})),
				getSectionIndexForHref: vi.fn().mockReturnValue(0),
				dispose: vi.fn(),
			};

			await service.applyHighlights([
				{ cfiRange: 'readium:red', color: 'red', text: 'Red excerpt' },
				{ cfiRange: 'readium:blue', color: 'blue', text: 'Blue excerpt' },
			]);

			const addRequests = sendDecorate.mock.calls
				.map((call) => call[1] as { action: string; group: string })
				.filter((request) => request.action === 'add');

			expect(addRequests).toHaveLength(2);
			expect(addRequests.map((request) => request.group)).toEqual(
				expect.arrayContaining(['weave-highlights-red', 'weave-highlights-blue']),
			);
			expect(new Set(addRequests.map((request) => request.group)).size).toBe(2);
		} finally {
			service.destroy();
		}
	});

	it('clears stale color groups when highlight colors change or disappear from the EPUB reader', async () => {
		const service = new ReadiumReaderService(createMockApp(new ArrayBuffer(0)) as any);
		try {
			const sendDecorate = vi.spyOn(service as any, 'sendDecorate').mockResolvedValue(true);
			vi.spyOn(service as any, 'canonicalizeLocation').mockImplementation(
				async (...args: unknown[]) => String(args[0] ?? ''),
			);
			vi.spyOn(service as any, 'getFrameContexts').mockReturnValue([{ sectionIndex: 0 }]);

			(service as any).bridge = {
				deserializeLocatorString: vi.fn((cfi: string) => ({
					href: 'OPS/text/chapter1.xhtml',
					serialize: () => ({ href: 'OPS/text/chapter1.xhtml', cfi }),
				})),
				getSectionIndexForHref: vi.fn().mockReturnValue(0),
				dispose: vi.fn(),
			};

			await service.applyHighlights([
				{ cfiRange: 'readium:red', color: 'red', text: 'Red excerpt' },
				{ cfiRange: 'readium:blue', color: 'blue', text: 'Blue excerpt' },
			]);

			sendDecorate.mockClear();

			await service.applyHighlights([
				{ cfiRange: 'readium:red', color: 'red', text: 'Red excerpt' },
			]);

			const clearRequests = sendDecorate.mock.calls
				.map((call) => call[1] as { action: string; group: string })
				.filter((request) => request.action === 'clear');

			expect(clearRequests.map((request) => request.group)).toEqual(
				expect.arrayContaining([
					'weave-highlights',
					'weave-highlights-red',
					'weave-highlights-blue',
				]),
			);
		} finally {
			service.destroy();
		}
	});
});

describe('ReadiumVaultPublicationBridge', () => {
	it('extracts cover data urls for bookshelf usage from Readium parsing', async () => {
		const bridge = new ReadiumVaultPublicationBridge(createMockApp(await createSampleEpubBuffer()) as any);
		try {
			const coverUrl = await bridge.extractCoverDataUrlFromFile('Books/demo.epub');
			expect(coverUrl).toBe('data:image/png;base64,iVBORw==');
		} finally {
			bridge.dispose();
		}
	});

	it('extracts cover data urls when vault readBinary returns a plain byte array', async () => {
		const binary = await createSampleEpubBuffer();
		const bridge = new ReadiumVaultPublicationBridge(createMockApp(Array.from(new Uint8Array(binary))) as any);
		try {
			const coverUrl = await bridge.extractCoverDataUrlFromFile('Books/demo.epub');
			expect(coverUrl).toBe('data:image/png;base64,iVBORw==');
		} finally {
			bridge.dispose();
		}
	});

	it('returns null when the EPUB package has no declared cover', async () => {
		const bridge = new ReadiumVaultPublicationBridge(createMockApp(await createSampleEpubBuffer({ includeCover: false })) as any);
		try {
			const coverUrl = await bridge.extractCoverDataUrlFromFile('Books/no-cover.epub');
			expect(coverUrl).toBeNull();
		} finally {
			bridge.dispose();
		}
	});
});
