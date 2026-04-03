vi.mock('obsidian', () => ({
	normalizePath: (value: string) => String(value || '').replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, ''),
}));

import { EpubBacklinkHighlightService } from '../EpubBacklinkHighlightService';

type MockFile = {
	path: string;
	name: string;
	extension: string;
};

type OpenMarkdownViewMock = {
	file: MockFile;
	editor: {
		getValue: () => string;
		setValue: (value: string) => void;
	};
	save: () => Promise<void>;
};

function createFile(path: string): MockFile {
	const normalized = path.replace(/\\/g, '/');
	return {
		path: normalized,
		name: normalized.split('/').pop() || normalized,
		extension: normalized.split('.').pop() || '',
	};
}

function createMockApp(initialFiles: Record<string, string>, options?: { openMarkdownPaths?: string[] }) {
	const files = new Map<string, string>(Object.entries(initialFiles));
	const openMarkdownViews: OpenMarkdownViewMock[] = (options?.openMarkdownPaths || []).map((path) => {
		const normalizedPath = path.replace(/\\/g, '/');
		let value = files.get(normalizedPath) || '';
		return {
			file: createFile(normalizedPath),
			editor: {
				getValue: () => value,
				setValue: (nextValue: string) => {
					value = nextValue;
					files.set(normalizedPath, nextValue);
				},
			},
			save: vi.fn(async () => undefined),
		};
	});

	const app: any = {
		vault: {
			adapter: {
				read: vi.fn(async (path: string) => {
					const value = files.get(path);
					if (value === undefined) {
						throw new Error(`Missing file: ${path}`);
					}
					return value;
				}),
			},
			cachedRead: vi.fn(async (file: MockFile) => files.get(file.path) || ''),
			modify: vi.fn(async (file: MockFile, updated: string) => {
				files.set(file.path, updated);
			}),
			getMarkdownFiles: vi.fn(() =>
				Array.from(files.keys())
					.filter((path) => path.endsWith('.md'))
					.map((path) => createFile(path))
			),
			getFiles: vi.fn(() =>
				Array.from(files.keys()).map((path) => createFile(path))
			),
			getAbstractFileByPath: vi.fn((path: string) => {
				const normalized = path.replace(/\\/g, '/');
				return files.has(normalized) ? createFile(normalized) : null;
			}),
			process: vi.fn(async (file: MockFile, mutator: (content: string) => string) => {
				const current = files.get(file.path);
				if (current === undefined) {
					throw new Error(`Missing file: ${file.path}`);
				}
				files.set(file.path, mutator(current));
			}),
		},
		workspace: {
			getLeavesOfType: vi.fn((type: string) => {
				if (type !== 'markdown') {
					return [];
				}
				return openMarkdownViews.map((view) => ({ view }));
			}),
		},
		metadataCache: {
			resolvedLinks: {
				'Notes/demo.md': {
					'Books/demo.epub': 1,
				},
			},
			getFileCache: vi.fn(() => null),
			getBacklinksForFile: vi.fn(() => null),
			on: vi.fn(),
			off: vi.fn(),
		},
		plugins: {
			getPlugin: vi.fn(() => ({
				settings: { weaveParentFolder: '' },
			})),
		},
	};

	return { app, files, openMarkdownViews };
}

describe('EpubBacklinkHighlightService', () => {
	it('collects current and legacy epub callouts while ignoring same-name books in other folders', async () => {
		const noteContent = [
			'> [!EPUB|green] [[Books/demo.epub#weave-cfi=readium%3Aalpha|Demo]] 2026-03-28 12:00',
			'> Current quote',
			'',
			'> [!EPUB|red] [[Archive/demo.epub#weave-cfi=readium%3Aother|Other]]',
			'> Wrong book',
			'',
			'> [!EPUB|blue] [Legacy](obsidian://weave-epub?vault=Vault&file=Books%2Fdemo.epub&cfi=epubcfi(/6/8)&text=Legacy)',
			'> Legacy quote',
			'',
		].join('\n');
		const { app } = createMockApp({
			'Notes/demo.md': noteContent,
		});
		const service = new EpubBacklinkHighlightService(app);

		const highlights = await service.collectHighlights('Books/demo.epub');

		expect(highlights).toEqual([
			{
				cfiRange: 'readium:alpha',
				color: 'green',
				text: 'Current quote',
				sourceFile: 'Notes/demo.md',
				sourceRef: undefined,
				createdTime: new Date('2026-03-28T12:00').getTime(),
			},
			{
				cfiRange: 'epubcfi(/6/8)',
				color: 'blue',
				text: 'Legacy quote',
				sourceFile: 'Notes/demo.md',
				sourceRef: undefined,
				createdTime: undefined,
			},
		]);
	});

	it('removes a legacy protocol epub callout from markdown sources', async () => {
		const notePath = 'Notes/demo.md';
		const noteContent = [
			'> [!EPUB|blue] [Legacy](obsidian://weave-epub?vault=Vault&file=Books%2Fdemo.epub&cfi=epubcfi(/6/8)&text=Legacy)',
			'> Legacy quote',
			'',
			'Plain tail',
		].join('\n');
		const { app, files } = createMockApp({
			[notePath]: noteContent,
		});
		const service = new EpubBacklinkHighlightService(app);

		const deleted = await service.deleteHighlight(notePath, 'epubcfi(/6/8)', 'Books/demo.epub');

		expect(deleted).toBe(true);
		expect(files.get(notePath)).toBe('Plain tail');
	});

	it('updates markdown highlight colors through an already-open note editor', async () => {
		const notePath = 'Notes/demo.md';
		const noteContent = [
			'> [!EPUB|green] [[Books/demo.epub#weave-cfi=readium%3Aalpha|Demo]]',
			'> Current quote',
			'',
		].join('\n');
		const { app, files, openMarkdownViews } = createMockApp(
			{ [notePath]: noteContent },
			{ openMarkdownPaths: [notePath] },
		);
		const service = new EpubBacklinkHighlightService(app);

		const changed = await service.changeHighlightColor(notePath, 'readium:alpha', 'Books/demo.epub', 'purple');

		expect(changed).toBe(true);
		expect(files.get(notePath)).toContain('> [!EPUB|purple] [[Books/demo.epub#weave-cfi=readium%3Aalpha|Demo]]');
		expect(openMarkdownViews[0]?.save).toHaveBeenCalledTimes(1);
		expect(app.vault.modify).not.toHaveBeenCalled();
		expect(app.vault.process).not.toHaveBeenCalled();
	});

	it('updates only the targeted canvas node highlight color when sourceRef is provided', async () => {
		const canvasPath = 'Canvas/demo.canvas';
		const canvasContent = JSON.stringify({
			nodes: [
				{
					id: 'node-1',
					type: 'text',
					text: '> [!EPUB|green] [[Books/demo.epub#weave-cfi=readium%3Aalpha|Demo]]\n> Quote A\n',
				},
				{
					id: 'node-2',
					type: 'text',
					text: '> [!EPUB|blue] [[Books/demo.epub#weave-cfi=readium%3Abeta|Demo]]\n> Quote B\n',
				},
			],
		});
		const { app, files } = createMockApp({
			[canvasPath]: canvasContent,
		});
		const service = new EpubBacklinkHighlightService(app);

		const changed = await service.changeHighlightColor(canvasPath, 'readium:beta', 'Books/demo.epub', 'red', 'canvas:node-2');

		expect(changed).toBe(true);
		const parsed = JSON.parse(files.get(canvasPath) || '{}');
		expect(parsed.nodes[0].text).toContain('> [!EPUB|green]');
		expect(parsed.nodes[1].text).toContain('> [!EPUB|red]');
	});

	it('updates only the targeted card shard entry highlight color when sourceRef is provided', async () => {
		const jsonPath = 'weave/memory/cards/cards-0.json';
		const jsonContent = JSON.stringify({
			cards: [
				{
					uuid: 'card-a',
					content: '> [!EPUB|green] [[Books/demo.epub#weave-cfi=readium%3Aalpha|Demo]]\n> Quote A\n',
				},
				{
					uuid: 'card-b',
					content: '> [!EPUB|blue] [[Books/demo.epub#weave-cfi=readium%3Abeta|Demo]]\n> Quote B\n',
				},
			],
		});
		const { app, files } = createMockApp({
			[jsonPath]: jsonContent,
		});
		const service = new EpubBacklinkHighlightService(app);

		const changed = await service.changeHighlightColor(jsonPath, 'readium:beta', 'Books/demo.epub', 'red', 'card:card-b');

		expect(changed).toBe(true);
		const parsed = JSON.parse(files.get(jsonPath) || '{}');
		expect(parsed.cards[0].content).toContain('> [!EPUB|green]');
		expect(parsed.cards[1].content).toContain('> [!EPUB|red]');
		expect(typeof parsed.cards[1].modified).toBe('string');
	});
});
