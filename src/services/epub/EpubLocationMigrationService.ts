import type { App } from "obsidian";
import { logger } from "../../utils/logger";
import { IREpubBookmarkTaskService } from "../incremental-reading/IREpubBookmarkTaskService";
import type { EpubStorageService } from "./EpubStorageService";
import type { EpubReaderEngine } from "./reader-engine-types";
import type { Bookmark, Note } from "./types";

export interface EpubLocationMigrationSummary {
	progressMigrated: boolean;
	bookmarksMigrated: number;
	notesMigrated: number;
	resumePointsMigrated: number;
}

const EMPTY_SUMMARY: EpubLocationMigrationSummary = {
	progressMigrated: false,
	bookmarksMigrated: 0,
	notesMigrated: 0,
	resumePointsMigrated: 0,
};

export class EpubLocationMigrationService {
	private readonly app: App;
	private readonly storageService: EpubStorageService;
	private readonly readerService: EpubReaderEngine;

	constructor(app: App, storageService: EpubStorageService, readerService: EpubReaderEngine) {
		this.app = app;
		this.storageService = storageService;
		this.readerService = readerService;
	}

	async migrateBookData(bookId: string, filePath: string): Promise<EpubLocationMigrationSummary> {
		if (typeof this.readerService.canonicalizeLocation !== "function") {
			return { ...EMPTY_SUMMARY };
		}

		const summary: EpubLocationMigrationSummary = {
			...EMPTY_SUMMARY,
			progressMigrated: await this.migrateReadingProgress(bookId),
		};

		const migratedBookmarks = await this.migrateBookmarks(bookId);
		if (migratedBookmarks.length > 0) {
			summary.bookmarksMigrated = migratedBookmarks.length;
		}

		const migratedNotes = await this.migrateNotes(bookId);
		if (migratedNotes.length > 0) {
			summary.notesMigrated = migratedNotes.length;
		}

		summary.resumePointsMigrated = await this.migrateResumePoints(filePath);

		if (
			summary.progressMigrated ||
			summary.bookmarksMigrated > 0 ||
			summary.notesMigrated > 0 ||
			summary.resumePointsMigrated > 0
		) {
			logger.info("[EpubLocationMigrationService] Migrated legacy EPUB locations:", {
				bookId,
				filePath,
				...summary,
			});
		}

		return summary;
	}

	private async migrateReadingProgress(bookId: string): Promise<boolean> {
		const progress = await this.storageService.loadProgress(bookId);
		if (!progress?.cfi) {
			return false;
		}

		const nextCfi = await this.canonicalizeLocation(progress.cfi);
		if (!nextCfi || nextCfi === progress.cfi) {
			return false;
		}

		await this.storageService.saveProgress(bookId, {
			...progress,
			cfi: nextCfi,
		});
		await this.storageService.flushPendingProgress();
		return true;
	}

	private async migrateBookmarks(bookId: string): Promise<Bookmark[]> {
		const bookmarks = await this.storageService.loadBookmarks(bookId);
		if (bookmarks.length === 0) {
			return [];
		}

		let changed = false;
		const migrated: Bookmark[] = [];

		for (const bookmark of bookmarks) {
			const nextCfi = await this.canonicalizeLocation(bookmark.cfi);
			if (nextCfi && nextCfi !== bookmark.cfi) {
				migrated.push({ ...bookmark, cfi: nextCfi });
				changed = true;
				continue;
			}
			migrated.push(bookmark);
		}

		if (!changed) {
			return [];
		}

		await this.storageService.saveBookmarks(bookId, migrated);
		return migrated.filter((bookmark, index) => bookmark.cfi !== bookmarks[index]?.cfi);
	}

	private async migrateNotes(bookId: string): Promise<Note[]> {
		const notes = await this.storageService.loadNotes(bookId);
		if (notes.length === 0) {
			return [];
		}

		let changed = false;
		const migrated: Note[] = [];

		for (const note of notes) {
			if (!note.cfi) {
				migrated.push(note);
				continue;
			}

			const nextCfi = await this.canonicalizeLocation(note.cfi, note.quotedText);
			if (nextCfi && nextCfi !== note.cfi) {
				migrated.push({ ...note, cfi: nextCfi });
				changed = true;
				continue;
			}
			migrated.push(note);
		}

		if (!changed) {
			return [];
		}

		await this.storageService.saveNotes(bookId, migrated);
		return migrated.filter((note, index) => note.cfi !== notes[index]?.cfi);
	}

	private async migrateResumePoints(filePath: string): Promise<number> {
		const taskService = new IREpubBookmarkTaskService(this.app);
		const tasks = await taskService.getTasksByEpub(filePath);
		let migratedCount = 0;

		for (const task of tasks) {
			if (!task.resumeCfi) {
				continue;
			}

			const nextCfi = await this.canonicalizeLocation(task.resumeCfi);
			if (!nextCfi || nextCfi === task.resumeCfi) {
				continue;
			}

			await taskService.setResumePoint(task.id, nextCfi);
			migratedCount += 1;
		}

		return migratedCount;
	}

	private async canonicalizeLocation(cfi: string, textHint?: string): Promise<string | null> {
		if (!cfi || typeof this.readerService.canonicalizeLocation !== "function") {
			return null;
		}

		try {
			return await this.readerService.canonicalizeLocation(cfi, textHint);
		} catch (error) {
			logger.warn("[EpubLocationMigrationService] Failed to canonicalize location:", {
				cfi,
				error,
			});
			return null;
		}
	}
}
