import type { EpubReaderEngine } from '../reader-engine-types';
import { EpubLocationMigrationService } from '../EpubLocationMigrationService';

const getTasksByEpubMock = vi.fn();
const setResumePointMock = vi.fn();

vi.mock('../../incremental-reading/IREpubBookmarkTaskService', () => ({
	IREpubBookmarkTaskService: class MockIREpubBookmarkTaskService {
		getTasksByEpub(filePath: string) {
			return getTasksByEpubMock(filePath);
		}

		setResumePoint(taskId: string, cfi: string) {
			return setResumePointMock(taskId, cfi);
		}
	},
}));

function createStorageServiceMock() {
	return {
		loadProgress: vi.fn(),
		saveProgress: vi.fn(),
		flushPendingProgress: vi.fn(),
		loadBookmarks: vi.fn(),
		saveBookmarks: vi.fn(),
		loadNotes: vi.fn(),
		saveNotes: vi.fn(),
	} as any;
}

describe('EpubLocationMigrationService', () => {
	beforeEach(() => {
		getTasksByEpubMock.mockReset();
		setResumePointMock.mockReset();
	});

	it('migrates legacy progress, bookmarks, notes, and IR resume points into readium locators', async () => {
		const storageService = createStorageServiceMock();
		storageService.loadProgress.mockResolvedValue({
			chapterIndex: 1,
			cfi: '/6/4',
			percent: 42,
		});
		storageService.loadBookmarks.mockResolvedValue([
			{
				id: 'bookmark-1',
				title: 'Chapter 1',
				chapterIndex: 0,
				cfi: 'epubcfi(/6/2[chapter-1]!/4/4,/1:0,/1:9)',
				preview: 'Selection',
				createdTime: 1,
			},
		]);
		storageService.loadNotes.mockResolvedValue([
			{
				id: 'note-1',
				content: 'Note body',
				quotedText: 'Selection',
				chapterIndex: 0,
				cfi: '/6/2[chapter-1]!/4/4,/1:0,/1:9',
				createdTime: 1,
				modifiedTime: 1,
			},
		]);

		const canonicalizeLocation = vi.fn(async (cfi: string, textHint?: string) => {
			if (cfi === '/6/4') {
				return 'readium:progress';
			}
			if (cfi === 'epubcfi(/6/2[chapter-1]!/4/4,/1:0,/1:9)') {
				return 'readium:bookmark';
			}
			if (cfi === '/6/2[chapter-1]!/4/4,/1:0,/1:9' && textHint === 'Selection') {
				return 'readium:note';
			}
			if (cfi === 'epubcfi(/6/6!/4/2/6:3)') {
				return 'readium:resume';
			}
			return null;
		});
		const readerService = {
			canonicalizeLocation,
		} as Partial<EpubReaderEngine> as EpubReaderEngine;

		getTasksByEpubMock.mockResolvedValue([
			{
				id: 'task-1',
				resumeCfi: 'epubcfi(/6/6!/4/2/6:3)',
			},
		]);

		const service = new EpubLocationMigrationService({} as any, storageService, readerService);
		const summary = await service.migrateBookData('book-1', 'Books/demo.epub');

		expect(summary).toEqual({
			progressMigrated: true,
			bookmarksMigrated: 1,
			notesMigrated: 1,
			resumePointsMigrated: 1,
		});
		expect(storageService.saveProgress).toHaveBeenCalledWith('book-1', {
			chapterIndex: 1,
			cfi: 'readium:progress',
			percent: 42,
		});
		expect(storageService.flushPendingProgress).toHaveBeenCalledTimes(1);
		expect(storageService.saveBookmarks).toHaveBeenCalledWith('book-1', [
			expect.objectContaining({ cfi: 'readium:bookmark' }),
		]);
		expect(storageService.saveNotes).toHaveBeenCalledWith('book-1', [
			expect.objectContaining({ cfi: 'readium:note' }),
		]);
		expect(canonicalizeLocation).toHaveBeenCalledWith('/6/2[chapter-1]!/4/4,/1:0,/1:9', 'Selection');
		expect(getTasksByEpubMock).toHaveBeenCalledWith('Books/demo.epub');
		expect(setResumePointMock).toHaveBeenCalledWith('task-1', 'readium:resume');
	});

	it('skips migration when the reader engine does not expose a canonicalize hook', async () => {
		const storageService = createStorageServiceMock();
		const readerService = {} as EpubReaderEngine;
		const service = new EpubLocationMigrationService({} as any, storageService, readerService);

		const summary = await service.migrateBookData('book-1', 'Books/demo.epub');

		expect(summary).toEqual({
			progressMigrated: false,
			bookmarksMigrated: 0,
			notesMigrated: 0,
			resumePointsMigrated: 0,
		});
		expect(storageService.loadProgress).not.toHaveBeenCalled();
		expect(getTasksByEpubMock).not.toHaveBeenCalled();
	});
});
