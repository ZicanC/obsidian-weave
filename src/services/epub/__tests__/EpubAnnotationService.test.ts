import { EpubAnnotationService } from '../EpubAnnotationService';

describe('EpubAnnotationService', () => {
	it('clears legacy stored highlights at most once per book and keeps backlink highlights as the live source', async () => {
		let storedHighlights = [
			{
				id: 'legacy-1',
				text: 'Legacy highlight',
				color: 'yellow',
				chapterIndex: 1,
				cfiRange: 'epubcfi(/6/2[chapter-1]!/4/2)',
				createdTime: 1,
			},
		];
		let concealedTexts: any[] = [];

		const storageService = {
			loadHighlights: vi.fn(async () => storedHighlights),
			saveHighlights: vi.fn(async (_bookId: string, highlights: typeof storedHighlights) => {
				storedHighlights = highlights;
			}),
			loadConcealedTexts: vi.fn(async () => concealedTexts),
			saveConcealedTexts: vi.fn(async (_bookId: string, nextConcealedTexts: typeof concealedTexts) => {
				concealedTexts = nextConcealedTexts;
			}),
			getCanvasBinding: vi.fn(async () => null),
		} as any;

		const backlinkHighlights = [
			{
				cfiRange: 'epubcfi(/6/2[chapter-1]!/4/2)',
				color: 'green',
				text: 'Live highlight',
				sourceFile: 'Notes/demo.md',
				sourceRef: 'block-ref',
				createdTime: 2,
				presentation: 'highlight',
			},
		];
		const backlinkService = {
			collectHighlights: vi.fn(async () => backlinkHighlights),
		} as any;

		const service = new EpubAnnotationService(storageService);

		await expect(service.collectAllHighlights('book-1', 'Books/demo.epub', backlinkService)).resolves.toEqual(backlinkHighlights);
		expect(storageService.saveHighlights).toHaveBeenCalledTimes(1);

		storedHighlights = [
			{
				id: 'legacy-2',
				text: 'Legacy highlight again',
				color: 'yellow',
				chapterIndex: 1,
				cfiRange: 'epubcfi(/6/2[chapter-1]!/4/4)',
				createdTime: 3,
			},
		];

		await expect(service.collectAllHighlights('book-1', 'Books/demo.epub', backlinkService)).resolves.toEqual(backlinkHighlights);
		expect(storageService.saveHighlights).toHaveBeenCalledTimes(1);
		expect(backlinkService.collectHighlights).toHaveBeenCalledTimes(2);
	});
});
