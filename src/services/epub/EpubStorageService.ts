import { type App, TAbstractFile, TFile } from "obsidian";
import { Platform, normalizePath } from "obsidian";
import { getReadableWeaveRoot, getV2Paths, normalizeWeaveParentFolder } from "../../config/paths";
import { DirectoryUtils } from "../../utils/directory-utils";
import { logger } from "../../utils/logger";
import { migrateLegacyDirectory } from "../data-migration/LegacyWeaveFolderMigration";
import type {
	Bookmark,
	ConcealedText,
	EpubBook,
	EpubReaderSettings,
	Highlight,
	Note,
	ReadingPosition,
} from "./types";

export type EpubBookshelfSourceMode = "cache-first" | "folder-only";

export interface EpubBookshelfSettings {
	sourceMode: EpubBookshelfSourceMode;
	sourceFolder: string;
}

export interface EpubBookshelfIndexEntry {
	path: string;
	name: string;
	folder: string;
	size: number;
}

export const DEFAULT_EPUB_BOOKSHELF_SETTINGS: EpubBookshelfSettings = {
	sourceMode: "cache-first",
	sourceFolder: "",
};

export class EpubStorageService {
	private app: App;
	private basePath: string;
	private _progressDebounceTimer: ReturnType<typeof setTimeout> | null = null;
	private _pendingProgress: { bookId: string; position: ReadingPosition } | null = null;
	private _booksCache: Record<string, EpubBook> | null = null;
	private _booksWriteLock: Promise<void> = Promise.resolve();
	private _bookStateWriteLocks = new Map<string, Promise<void>>();

	constructor(app: App) {
		this.app = app;
		const plugin: any = (app as any)?.plugins?.getPlugin?.("weave");
		const parentFolder = normalizeWeaveParentFolder(plugin?.settings?.weaveParentFolder);
		this.basePath = getV2Paths(parentFolder).ir.epub;
	}

	async ensureDirectories(): Promise<void> {
		await this.migrateLegacyDirectoryIfNeeded();
		await DirectoryUtils.ensureDirRecursive(this.app.vault.adapter, this.basePath);
	}

	private getLegacyBasePath(): string {
		const plugin: any = (this.app as any)?.plugins?.getPlugin?.("weave");
		const parentFolder = normalizeWeaveParentFolder(plugin?.settings?.weaveParentFolder);
		return `${getReadableWeaveRoot(parentFolder)}/epub-reading`;
	}

	private async migrateLegacyDirectoryIfNeeded(): Promise<void> {
		const legacyPath = this.getLegacyBasePath();
		if (legacyPath === this.basePath) return;

		await migrateLegacyDirectory(this.app, {
			legacyPath,
			targetPath: this.basePath,
			label: "epub-reading",
		});
	}

	async loadBooks(): Promise<Record<string, EpubBook>> {
		if (this._booksCache) return this._booksCache;
		await this.ensureDirectories();
		const booksPath = `${this.basePath}/books.json`;
		const adapter = this.app.vault.adapter;

		if (await adapter.exists(booksPath)) {
			try {
				const content = await adapter.read(booksPath);
				const parsed = JSON.parse(content) as Record<string, EpubBook>;
				this._booksCache = parsed;
				await this.hydrateBookStates(parsed);
				return this._booksCache!;
			} catch (e) {
				logger.warn("[EpubStorageService] Failed to parse books.json:", e);
				this._booksCache = {};
				return this._booksCache;
			}
		}

		this._booksCache = {};
		return this._booksCache;
	}

	private async writeBooksWithLock(books: Record<string, EpubBook>): Promise<void> {
		const doWrite = async () => {
			await this.ensureDirectories();
			const booksPath = `${this.basePath}/books.json`;
			this._booksCache = books;
			await this.app.vault.adapter.write(booksPath, JSON.stringify(books));
		};
		this._booksWriteLock = this._booksWriteLock.then(doWrite, doWrite);
		await this._booksWriteLock;
	}

	private getBookStatePath(bookId: string): string {
		return `${this.basePath}/${bookId}/state.json`;
	}

	private getBookshelfIndexPath(): string {
		return `${this.basePath}/bookshelf-index.json`;
	}

	private parseBookshelfIndexEntries(content: string): EpubBookshelfIndexEntry[] {
		try {
			const parsed = JSON.parse(content);
			if (!Array.isArray(parsed)) {
				return [];
			}
			return parsed.filter(
				(item) =>
					item &&
					typeof item.path === "string" &&
					typeof item.name === "string" &&
					typeof item.folder === "string" &&
					typeof item.size === "number"
			);
		} catch (error) {
			logger.warn("[EpubStorageService] Failed to parse bookshelf-index.json:", error);
			return [];
		}
	}

	private async readStoredBookshelfIndex(): Promise<EpubBookshelfIndexEntry[] | null> {
		await this.ensureDirectories();
		const indexPath = this.getBookshelfIndexPath();
		const adapter = this.app.vault.adapter;
		if (!(await adapter.exists(indexPath))) {
			return null;
		}

		try {
			const content = await adapter.read(indexPath);
			return this.parseBookshelfIndexEntries(content);
		} catch (error) {
			logger.warn("[EpubStorageService] Failed to read bookshelf-index.json:", error);
			return null;
		}
	}

	private buildBookshelfIndexEntriesFromBooks(
		books: Record<string, EpubBook>
	): EpubBookshelfIndexEntry[] {
		return Object.values(books).map((book) => {
			const file = this.app.vault.getAbstractFileByPath(book.filePath);
			const size = file instanceof TFile ? file.stat.size : 0;
			const normalizedPath = normalizePath(book.filePath || "");
			const slashIndex = normalizedPath.lastIndexOf("/");
			return {
				path: normalizedPath,
				name:
					normalizedPath
						.split("/")
						.pop()
						?.replace(/\.epub$/i, "") ||
					book.metadata.title ||
					"EPUB",
				folder: slashIndex >= 0 ? normalizedPath.slice(0, slashIndex) || "/" : "/",
				size,
			};
		});
	}

	private isEpubPath(filePath: string): boolean {
		const normalizedPath = normalizePath(filePath || "");
		return /\.epub$/i.test(normalizedPath);
	}

	private isEpubFile(file: TAbstractFile | null | undefined): boolean {
		if (!(file instanceof TFile)) {
			return false;
		}

		return this.isEpubPath(file.path) || String(file.extension || "").toLowerCase() === "epub";
	}

	private isPathWithinFolder(filePath: string, folderPath: string): boolean {
		if (!folderPath) {
			return true;
		}

		const normalizedFilePath = normalizePath(filePath || "");
		return normalizedFilePath.startsWith(`${folderPath}/`);
	}

	private filterBookshelfEntriesByFolder(
		entries: EpubBookshelfIndexEntry[],
		folderPath: string
	): EpubBookshelfIndexEntry[] {
		return entries.filter((entry) => this.isPathWithinFolder(entry.path, folderPath));
	}

	private collectEpubPathsFromVaultIndex(folderPath?: string): string[] {
		const normalizedFolder = normalizePath(folderPath || "");

		return this.app.vault
			.getFiles()
			.filter(
				(file) => this.isEpubFile(file) && this.isPathWithinFolder(file.path, normalizedFolder)
			)
			.map((file) => normalizePath(file.path));
	}

	private async collectEpubPathsFromAdapter(folderPath?: string): Promise<string[]> {
		const adapter = this.app.vault.adapter as {
			list?: (path: string) => Promise<{ files: string[]; folders: string[] }>;
		};
		if (typeof adapter.list !== "function") {
			return [];
		}

		const normalizedFolder = normalizePath(folderPath || "");
		const pendingDirs = [normalizedFolder];
		const visitedDirs = new Set<string>();
		const paths = new Set<string>();

		while (pendingDirs.length > 0) {
			const currentDir = normalizePath(pendingDirs.pop() || "");
			if (visitedDirs.has(currentDir)) {
				continue;
			}
			visitedDirs.add(currentDir);

			let listing: { files: string[]; folders: string[] };
			try {
				listing = await adapter.list(currentDir);
			} catch (error) {
				if (currentDir === normalizedFolder) {
					logger.warn("[EpubStorageService] Failed to list EPUB scan directory:", {
						dir: currentDir,
						error,
					});
				}
				continue;
			}

			for (const filePath of Array.isArray(listing.files) ? listing.files : []) {
				const normalizedFilePath = normalizePath(filePath || "");
				if (!this.isEpubPath(normalizedFilePath)) {
					continue;
				}
				if (!this.isPathWithinFolder(normalizedFilePath, normalizedFolder)) {
					continue;
				}
				paths.add(normalizedFilePath);
			}

			for (const nextDir of Array.isArray(listing.folders) ? listing.folders : []) {
				const normalizedNextDir = normalizePath(nextDir || "");
				if (!normalizedNextDir) {
					continue;
				}
				pendingDirs.push(normalizedNextDir);
			}
		}

		return Array.from(paths);
	}

	private async createBookshelfEntryFromPath(filePath: string): Promise<EpubBookshelfIndexEntry> {
		const normalizedPath = normalizePath(filePath || "");
		const file = this.app.vault.getAbstractFileByPath(normalizedPath);
		const slashIndex = normalizedPath.lastIndexOf("/");
		let size = file instanceof TFile ? file.stat.size : 0;

		if (
			size === 0 &&
			typeof (this.app.vault.adapter as { stat?: (path: string) => Promise<{ size?: number }> })
				.stat === "function"
		) {
			try {
				const stat = await (
					this.app.vault.adapter as { stat: (path: string) => Promise<{ size?: number }> }
				).stat(normalizedPath);
				if (typeof stat?.size === "number") {
					size = stat.size;
				}
			} catch {
				// noop
			}
		}

		return {
			path: normalizedPath,
			name:
				file instanceof TFile
					? file.basename
					: normalizedPath
							.split("/")
							.pop()
							?.replace(/\.epub$/i, "") || "EPUB",
			folder:
				file instanceof TFile
					? file.parent?.path || "/"
					: slashIndex >= 0
					? normalizedPath.slice(0, slashIndex) || "/"
					: "/",
			size,
		};
	}

	private async scanVaultBookshelfEntries(folderPath?: string): Promise<EpubBookshelfIndexEntry[]> {
		const pathSet = new Set<string>();
		for (const path of this.collectEpubPathsFromVaultIndex(folderPath)) {
			pathSet.add(path);
		}
		for (const path of await this.collectEpubPathsFromAdapter(folderPath)) {
			pathSet.add(path);
		}

		const entries = await Promise.all(
			Array.from(pathSet).map((path) => this.createBookshelfEntryFromPath(path))
		);

		return entries.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
	}

	private areBookshelfEntryListsEqual(
		left: EpubBookshelfIndexEntry[],
		right: EpubBookshelfIndexEntry[]
	): boolean {
		if (left.length !== right.length) {
			return false;
		}

		return left.every((entry, index) => {
			const other = right[index];
			return (
				entry.path === other?.path &&
				entry.name === other.name &&
				entry.folder === other.folder &&
				entry.size === other.size
			);
		});
	}

	private async syncFolderBookshelfIndex(
		folderPath: string,
		entries: EpubBookshelfIndexEntry[],
		existingEntries?: EpubBookshelfIndexEntry[]
	): Promise<void> {
		const normalizedFolder = normalizePath(folderPath || "");
		if (!normalizedFolder) {
			await this.saveBookshelfIndex(entries);
			return;
		}

		const baseEntries = existingEntries ?? (await this.loadBookshelfIndex());
		const nextEntries = baseEntries
			.filter((entry) => !this.isPathWithinFolder(entry.path, normalizedFolder))
			.concat(entries)
			.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));

		await this.saveBookshelfIndex(nextEntries);
	}

	private async hasExistingEpubFile(filePath: string): Promise<boolean> {
		const normalizedPath = normalizePath(filePath || "");
		if (!this.isEpubPath(normalizedPath)) {
			return false;
		}

		const file = this.app.vault.getAbstractFileByPath(normalizedPath);
		if (file instanceof TFile && this.isEpubFile(file)) {
			return true;
		}

		const adapter = this.app.vault.adapter as { exists?: (path: string) => Promise<boolean> };
		if (typeof adapter.exists !== "function") {
			return false;
		}

		try {
			return await adapter.exists(normalizedPath);
		} catch {
			return false;
		}
	}

	private async filterExistingBookshelfEntries(
		entries: EpubBookshelfIndexEntry[]
	): Promise<EpubBookshelfIndexEntry[]> {
		const results = await Promise.all(
			entries.map(async (entry) => ({
				entry,
				exists: await this.hasExistingEpubFile(entry.path),
			}))
		);

		return results.filter((item) => item.exists).map((item) => item.entry);
	}

	private async getMutableBookshelfIndexEntries(): Promise<EpubBookshelfIndexEntry[]> {
		const storedEntries = await this.readStoredBookshelfIndex();
		if (storedEntries !== null) {
			return storedEntries;
		}
		const books = await this.loadBooks();
		return this.buildBookshelfIndexEntriesFromBooks(books);
	}

	private async readBookState(
		bookId: string
	): Promise<Pick<EpubBook, "currentPosition" | "readingStats"> | null> {
		const statePath = this.getBookStatePath(bookId);
		const adapter = this.app.vault.adapter;

		if (!(await adapter.exists(statePath))) {
			return null;
		}

		try {
			const content = await adapter.read(statePath);
			const parsed = JSON.parse(content);
			if (!parsed || typeof parsed !== "object") return null;
			return {
				currentPosition: parsed.currentPosition,
				readingStats: parsed.readingStats,
			};
		} catch (error) {
			logger.warn(`[EpubStorageService] Failed to read state for ${bookId}:`, error);
			return null;
		}
	}

	private async writeBookState(
		bookId: string,
		data: Pick<EpubBook, "currentPosition" | "readingStats">
	): Promise<void> {
		const previous = this._bookStateWriteLocks.get(bookId) || Promise.resolve();
		const next = previous.then(
			async () => {
				await this.ensureBookDirectory(bookId);
				await this.app.vault.adapter.write(this.getBookStatePath(bookId), JSON.stringify(data));
			},
			async () => {
				await this.ensureBookDirectory(bookId);
				await this.app.vault.adapter.write(this.getBookStatePath(bookId), JSON.stringify(data));
			}
		);
		this._bookStateWriteLocks.set(bookId, next);
		await next;
	}

	private async hydrateBookStates(books: Record<string, EpubBook>): Promise<void> {
		for (const book of Object.values(books)) {
			const state = await this.readBookState(book.id);
			if (!state) continue;
			book.currentPosition = state.currentPosition ?? book.currentPosition;
			book.readingStats = state.readingStats ?? book.readingStats;
		}
	}

	async saveBooks(books: Record<string, EpubBook>): Promise<void> {
		await this.writeBooksWithLock(books);
	}

	async saveBook(book: EpubBook): Promise<void> {
		const books = await this.loadBooks();
		books[book.id] = book;
		await this.writeBooksWithLock(books);
		await this.writeBookState(book.id, {
			currentPosition: book.currentPosition,
			readingStats: book.readingStats,
		});
		await this.upsertBookshelfIndexEntry(book.filePath);
	}

	async loadBookshelfIndex(): Promise<EpubBookshelfIndexEntry[]> {
		let entries = await this.readStoredBookshelfIndex();

		if (entries === null) {
			const books = await this.loadBooks();
			entries = this.buildBookshelfIndexEntriesFromBooks(books);
			if (entries.length > 0) {
				await this.saveBookshelfIndex(entries);
			}
		}

		const filteredEntries = await this.filterExistingBookshelfEntries(entries);
		if (filteredEntries.length !== entries.length) {
			await this.saveBookshelfIndex(filteredEntries);
		}
		return filteredEntries;
	}

	async saveBookshelfIndex(entries: EpubBookshelfIndexEntry[]): Promise<void> {
		await this.ensureDirectories();
		await this.app.vault.adapter.write(this.getBookshelfIndexPath(), JSON.stringify(entries));
	}

	async rebuildBookshelfIndex(folderPath?: string): Promise<EpubBookshelfIndexEntry[]> {
		const normalizedFolder = normalizePath(folderPath || "");
		const entries = await this.scanVaultBookshelfEntries(normalizedFolder);

		await this.syncFolderBookshelfIndex(normalizedFolder, entries);
		return entries;
	}

	async loadBookshelfEntriesForFolder(folderPath: string): Promise<EpubBookshelfIndexEntry[]> {
		const normalizedFolder = normalizePath(folderPath || "");
		if (!normalizedFolder) {
			return [];
		}

		const cachedEntries = await this.loadBookshelfIndex();
		const filteredCachedEntries = this.filterBookshelfEntriesByFolder(
			cachedEntries,
			normalizedFolder
		);
		const liveEntries = await this.scanVaultBookshelfEntries(normalizedFolder);

		if (!this.areBookshelfEntryListsEqual(filteredCachedEntries, liveEntries)) {
			await this.syncFolderBookshelfIndex(normalizedFolder, liveEntries, cachedEntries);
		}

		return liveEntries;
	}

	private async upsertBookshelfIndexEntry(filePath: string): Promise<void> {
		const normalizedFilePath = normalizePath(filePath || "");
		if (!normalizedFilePath) return;

		const file = this.app.vault.getAbstractFileByPath(normalizedFilePath);
		if (!(file instanceof TFile) || !this.isEpubFile(file)) return;

		const entries = await this.getMutableBookshelfIndexEntries();
		const nextEntry = {
			path: file.path,
			name: file.basename,
			folder: file.parent?.path || "/",
			size: file.stat.size,
		};
		const existingIndex = entries.findIndex((entry) => entry.path === normalizedFilePath);
		if (existingIndex >= 0) {
			entries[existingIndex] = nextEntry;
		} else {
			entries.push(nextEntry);
			entries.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
		}
		await this.saveBookshelfIndex(entries);
	}

	private async removeBookshelfIndexEntry(filePath: string): Promise<boolean> {
		const normalizedFilePath = normalizePath(filePath || "");
		if (!normalizedFilePath) {
			return false;
		}

		const entries = await this.getMutableBookshelfIndexEntries();
		const nextEntries = entries.filter((entry) => entry.path !== normalizedFilePath);
		if (nextEntries.length === entries.length) {
			return false;
		}

		await this.saveBookshelfIndex(nextEntries);
		return true;
	}

	async getBook(bookId: string): Promise<EpubBook | null> {
		const books = await this.loadBooks();
		return books[bookId] || null;
	}

	async findBookByFilePath(filePath: string): Promise<EpubBook | null> {
		const books = await this.loadBooks();
		for (const book of Object.values(books)) {
			if (book.filePath === filePath) {
				return book;
			}
		}
		return null;
	}

	async updateBookFileReferences(oldPath: string, newPath: string): Promise<number> {
		const normalizedOldPath = normalizePath(oldPath || "");
		const normalizedNewPath = normalizePath(newPath || "");
		if (!normalizedOldPath || !normalizedNewPath || normalizedOldPath === normalizedNewPath) {
			return 0;
		}

		const books = await this.loadBooks();
		let updated = 0;
		let changed = false;

		for (const book of Object.values(books)) {
			const remapped = this.remapPath(book.filePath, normalizedOldPath, normalizedNewPath);
			if (!remapped || remapped === book.filePath) {
				continue;
			}

			book.filePath = remapped;
			updated += 1;
			changed = true;
		}

		if (changed) {
			await this.writeBooksWithLock(books);
		}

		await this.updateBookshelfIndexReferences(normalizedOldPath, normalizedNewPath);

		return updated;
	}

	private async updateBookshelfIndexReferences(oldPath: string, newPath: string): Promise<number> {
		const entries = await this.getMutableBookshelfIndexEntries();
		let updated = 0;
		let changed = false;

		const nextEntries = entries.map((entry) => {
			const remappedPath = this.remapPath(entry.path, oldPath, newPath);
			if (!remappedPath || remappedPath === entry.path) {
				return entry;
			}

			updated += 1;
			changed = true;
			const file = this.app.vault.getAbstractFileByPath(remappedPath);
			const slashIndex = remappedPath.lastIndexOf("/");

			return {
				path: remappedPath,
				name:
					file instanceof TFile
						? file.basename
						: remappedPath
								.split("/")
								.pop()
								?.replace(/\.epub$/i, "") || entry.name,
				folder:
					file instanceof TFile
						? file.parent?.path || "/"
						: slashIndex >= 0
						? remappedPath.slice(0, slashIndex) || "/"
						: "/",
				size: file instanceof TFile ? file.stat.size : entry.size,
			};
		});

		if (!changed) {
			return 0;
		}

		const dedupedEntries = Array.from(
			new Map(nextEntries.map((entry) => [entry.path, entry] as const)).values()
		).sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));

		await this.saveBookshelfIndex(dedupedEntries);
		return updated;
	}

	async pruneMissingBooks(): Promise<{ removedBookIds: string[]; removedPaths: string[] }> {
		const books = await this.loadBooks();
		const removedBookIds: string[] = [];
		const removedPaths: string[] = [];
		let changed = false;

		for (const [bookId, book] of Object.entries(books)) {
			if (await this.hasExistingEpubFile(book.filePath)) {
				continue;
			}

			removedBookIds.push(bookId);
			removedPaths.push(book.filePath);
			delete books[bookId];
			changed = true;
		}

		if (!changed) {
			return { removedBookIds, removedPaths };
		}

		await this.writeBooksWithLock(books);

		for (const bookId of removedBookIds) {
			const bookDir = `${this.basePath}/${bookId}`;
			if (await this.app.vault.adapter.exists(bookDir)) {
				await this.app.vault.adapter.rmdir(bookDir, true);
			}
		}

		logger.info("[EpubStorageService] Pruned missing EPUB records:", {
			removedBookIds,
			removedPaths,
		});

		return { removedBookIds, removedPaths };
	}

	async deleteBook(bookId: string): Promise<void> {
		const books = await this.loadBooks();
		const existingBook = books[bookId];
		delete books[bookId];
		await this.writeBooksWithLock(books);

		const bookDir = `${this.basePath}/${bookId}`;
		const adapter = this.app.vault.adapter;
		if (await adapter.exists(bookDir)) {
			await adapter.rmdir(bookDir, true);
		}

		if (existingBook?.filePath) {
			await this.removeBookshelfIndexEntry(existingBook.filePath);
		}
	}

	async removeBookByFilePath(
		filePath: string
	): Promise<{ removedBookId: string | null; removedIndexEntry: boolean }> {
		const normalizedFilePath = normalizePath(filePath || "");
		if (!normalizedFilePath) {
			return { removedBookId: null, removedIndexEntry: false };
		}

		const existingBook = await this.findBookByFilePath(normalizedFilePath);
		if (existingBook) {
			const hadIndexEntry = (await this.loadBookshelfIndex()).some(
				(entry) => entry.path === normalizedFilePath
			);
			await this.deleteBook(existingBook.id);
			return {
				removedBookId: existingBook.id,
				removedIndexEntry: hadIndexEntry,
			};
		}

		return {
			removedBookId: null,
			removedIndexEntry: await this.removeBookshelfIndexEntry(normalizedFilePath),
		};
	}

	async saveProgress(bookId: string, position: ReadingPosition): Promise<void> {
		this._pendingProgress = { bookId, position };
		if (this._progressDebounceTimer) return;
		this._progressDebounceTimer = setTimeout(async () => {
			this._progressDebounceTimer = null;
			const pending = this._pendingProgress;
			if (!pending) return;
			this._pendingProgress = null;
			try {
				const book = await this.getBook(pending.bookId);
				if (book) {
					book.currentPosition = pending.position;
					book.readingStats.lastReadTime = Date.now();
					await this.writeBookState(book.id, {
						currentPosition: book.currentPosition,
						readingStats: book.readingStats,
					});
				}
			} catch (e) {
				logger.warn("[EpubStorageService] saveProgress failed:", e);
			}
		}, 300);
	}

	async flushPendingProgress(): Promise<void> {
		if (this._progressDebounceTimer) {
			clearTimeout(this._progressDebounceTimer);
			this._progressDebounceTimer = null;
		}
		const pending = this._pendingProgress;
		if (pending) {
			this._pendingProgress = null;
			try {
				const book = await this.getBook(pending.bookId);
				if (book) {
					book.currentPosition = pending.position;
					book.readingStats.lastReadTime = Date.now();
					await this.writeBookState(book.id, {
						currentPosition: book.currentPosition,
						readingStats: book.readingStats,
					});
				}
			} catch (_e) {
				logger.warn("[EpubStorageService] flushPendingProgress failed:", _e);
			}
		}
	}

	async loadProgress(bookId: string): Promise<ReadingPosition | null> {
		const book = await this.getBook(bookId);
		return book?.currentPosition || null;
	}

	private async ensureBookDirectory(bookId: string): Promise<void> {
		const bookDir = `${this.basePath}/${bookId}`;
		await DirectoryUtils.ensureDirRecursive(this.app.vault.adapter, bookDir);
	}

	async loadBookmarks(bookId: string): Promise<Bookmark[]> {
		await this.ensureBookDirectory(bookId);
		const bookmarksPath = `${this.basePath}/${bookId}/bookmarks.json`;
		const adapter = this.app.vault.adapter;

		if (await adapter.exists(bookmarksPath)) {
			try {
				const content = await adapter.read(bookmarksPath);
				return JSON.parse(content);
			} catch (e) {
				logger.warn("[EpubStorageService] Failed to parse bookmarks.json:", e);
				return [];
			}
		}

		return [];
	}

	async saveBookmarks(bookId: string, bookmarks: Bookmark[]): Promise<void> {
		await this.ensureBookDirectory(bookId);
		const bookmarksPath = `${this.basePath}/${bookId}/bookmarks.json`;
		await this.app.vault.adapter.write(bookmarksPath, JSON.stringify(bookmarks));
	}

	async addBookmark(bookId: string, bookmark: Bookmark): Promise<void> {
		const bookmarks = await this.loadBookmarks(bookId);
		bookmarks.push(bookmark);
		await this.saveBookmarks(bookId, bookmarks);
	}

	async deleteBookmark(bookId: string, bookmarkId: string): Promise<void> {
		const bookmarks = await this.loadBookmarks(bookId);
		const filtered = bookmarks.filter((b) => b.id !== bookmarkId);
		await this.saveBookmarks(bookId, filtered);
	}

	async loadHighlights(bookId: string): Promise<Highlight[]> {
		await this.ensureBookDirectory(bookId);
		const highlightsPath = `${this.basePath}/${bookId}/highlights.json`;
		const adapter = this.app.vault.adapter;

		if (await adapter.exists(highlightsPath)) {
			try {
				const content = await adapter.read(highlightsPath);
				return this.normalizeHighlights(JSON.parse(content));
			} catch (e) {
				logger.warn("[EpubStorageService] Failed to parse highlights.json:", e);
				return [];
			}
		}

		return [];
	}

	async saveHighlights(bookId: string, highlights: Highlight[]): Promise<void> {
		await this.ensureBookDirectory(bookId);
		const highlightsPath = `${this.basePath}/${bookId}/highlights.json`;
		await this.app.vault.adapter.write(
			highlightsPath,
			JSON.stringify(this.normalizeHighlights(highlights))
		);
	}

	async addHighlight(bookId: string, highlight: Highlight): Promise<void> {
		const highlights = await this.loadHighlights(bookId);
		highlights.push({ ...highlight, color: this.normalizeHighlightColor(highlight.color) });
		await this.saveHighlights(bookId, highlights);
	}

	private normalizeHighlightColor(color?: string): Highlight["color"] {
		switch (color) {
			case "blue":
			case "green":
			case "purple":
			case "red":
				return color;
			case "pink":
				return "red";
			default:
				return "yellow";
		}
	}

	private normalizeHighlights(highlights: unknown): Highlight[] {
		if (!Array.isArray(highlights)) {
			return [];
		}
		return highlights
			.filter((item): item is Highlight => Boolean(item && typeof item === "object"))
			.map((item) => ({
				...item,
				color: this.normalizeHighlightColor((item as Highlight).color),
			}));
	}

	async deleteHighlight(bookId: string, highlightId: string): Promise<void> {
		const highlights = await this.loadHighlights(bookId);
		const filtered = highlights.filter((h) => h.id !== highlightId);
		await this.saveHighlights(bookId, filtered);
	}

	async loadConcealedTexts(bookId: string): Promise<ConcealedText[]> {
		await this.ensureBookDirectory(bookId);
		const concealedTextsPath = `${this.basePath}/${bookId}/concealed-texts.json`;
		const adapter = this.app.vault.adapter;

		if (await adapter.exists(concealedTextsPath)) {
			try {
				const content = await adapter.read(concealedTextsPath);
				return this.normalizeConcealedTexts(JSON.parse(content));
			} catch (e) {
				logger.warn("[EpubStorageService] Failed to parse concealed-texts.json:", e);
				return [];
			}
		}

		return [];
	}

	async saveConcealedTexts(bookId: string, concealedTexts: ConcealedText[]): Promise<void> {
		await this.ensureBookDirectory(bookId);
		const concealedTextsPath = `${this.basePath}/${bookId}/concealed-texts.json`;
		await this.app.vault.adapter.write(
			concealedTextsPath,
			JSON.stringify(this.normalizeConcealedTexts(concealedTexts))
		);
	}

	async addConcealedText(bookId: string, concealedText: ConcealedText): Promise<void> {
		const concealedTexts = await this.loadConcealedTexts(bookId);
		const existingIndex = concealedTexts.findIndex(
			(item) => item.cfiRange === concealedText.cfiRange
		);
		const normalizedItem = {
			...concealedText,
			mode: this.normalizeConcealedTextMode(concealedText.mode),
		};
		if (existingIndex >= 0) {
			concealedTexts[existingIndex] = normalizedItem;
		} else {
			concealedTexts.push(normalizedItem);
		}
		await this.saveConcealedTexts(bookId, concealedTexts);
	}

	async deleteConcealedText(bookId: string, concealedTextId: string): Promise<void> {
		const concealedTexts = await this.loadConcealedTexts(bookId);
		const filtered = concealedTexts.filter((item) => item.id !== concealedTextId);
		await this.saveConcealedTexts(bookId, filtered);
	}

	async deleteConcealedTextByCfi(bookId: string, cfiRange: string): Promise<void> {
		const concealedTexts = await this.loadConcealedTexts(bookId);
		const filtered = concealedTexts.filter((item) => item.cfiRange !== cfiRange);
		await this.saveConcealedTexts(bookId, filtered);
	}

	private normalizeConcealedTextMode(mode?: string): ConcealedText["mode"] {
		switch (mode) {
			default:
				return "mask";
		}
	}

	private normalizeConcealedTexts(concealedTexts: unknown): ConcealedText[] {
		if (!Array.isArray(concealedTexts)) {
			return [];
		}

		return concealedTexts
			.filter((item): item is ConcealedText => Boolean(item && typeof item === "object"))
			.map((item) => ({
				...item,
				mode: this.normalizeConcealedTextMode((item as ConcealedText).mode),
			}));
	}

	async loadNotes(bookId: string): Promise<Note[]> {
		await this.ensureBookDirectory(bookId);
		const notesPath = `${this.basePath}/${bookId}/notes.json`;
		const adapter = this.app.vault.adapter;

		if (await adapter.exists(notesPath)) {
			try {
				const content = await adapter.read(notesPath);
				return JSON.parse(content);
			} catch (e) {
				logger.warn("[EpubStorageService] Failed to parse notes.json:", e);
				return [];
			}
		}

		return [];
	}

	async saveNotes(bookId: string, notes: Note[]): Promise<void> {
		await this.ensureBookDirectory(bookId);
		const notesPath = `${this.basePath}/${bookId}/notes.json`;
		await this.app.vault.adapter.write(notesPath, JSON.stringify(notes));
	}

	async addNote(bookId: string, note: Note): Promise<void> {
		const notes = await this.loadNotes(bookId);
		notes.push(note);
		await this.saveNotes(bookId, notes);
	}

	async updateNote(bookId: string, noteId: string, content: string): Promise<void> {
		const notes = await this.loadNotes(bookId);
		const note = notes.find((n) => n.id === noteId);
		if (note) {
			note.content = content;
			note.modifiedTime = Date.now();
			await this.saveNotes(bookId, notes);
		}
	}

	async deleteNote(bookId: string, noteId: string): Promise<void> {
		const notes = await this.loadNotes(bookId);
		const filtered = notes.filter((n) => n.id !== noteId);
		await this.saveNotes(bookId, filtered);
	}

	async getCanvasBinding(bookId: string): Promise<string | null> {
		const bindings = await this.loadCanvasBindings();
		return bindings[bookId] || null;
	}

	async setCanvasBinding(bookId: string, canvasPath: string): Promise<void> {
		const bindings = await this.loadCanvasBindings();
		bindings[bookId] = canvasPath;
		await this.saveCanvasBindings(bindings);
	}

	async updateCanvasBindingReferences(oldPath: string, newPath: string): Promise<number> {
		const normalizedOldPath = normalizePath(oldPath || "");
		const normalizedNewPath = normalizePath(newPath || "");
		if (!normalizedOldPath || !normalizedNewPath || normalizedOldPath === normalizedNewPath) {
			return 0;
		}

		const bindings = await this.loadCanvasBindings();
		let updated = 0;
		let changed = false;

		for (const [bookId, canvasPath] of Object.entries(bindings)) {
			const remapped = this.remapPath(canvasPath, normalizedOldPath, normalizedNewPath);
			if (!remapped || remapped === canvasPath) {
				continue;
			}

			bindings[bookId] = remapped;
			updated += 1;
			changed = true;
		}

		if (changed) {
			await this.saveCanvasBindings(bindings);
		}

		return updated;
	}

	async removeCanvasBinding(bookId: string): Promise<void> {
		const bindings = await this.loadCanvasBindings();
		delete bindings[bookId];
		await this.saveCanvasBindings(bindings);
	}

	async loadExcerptSettings(): Promise<EpubExcerptSettings> {
		await this.ensureDirectories();
		const settingsPath = `${this.basePath}/excerpt-settings.json`;
		const adapter = this.app.vault.adapter;

		if (await adapter.exists(settingsPath)) {
			try {
				const content = await adapter.read(settingsPath);
				return { ...DEFAULT_EXCERPT_SETTINGS, ...JSON.parse(content) };
			} catch {
				return { ...DEFAULT_EXCERPT_SETTINGS };
			}
		}
		return { ...DEFAULT_EXCERPT_SETTINGS };
	}

	async saveExcerptSettings(settings: EpubExcerptSettings): Promise<void> {
		await this.ensureDirectories();
		const settingsPath = `${this.basePath}/excerpt-settings.json`;
		await this.app.vault.adapter.write(settingsPath, JSON.stringify(settings));
	}

	async loadReaderSettings(): Promise<EpubReaderSettings> {
		await this.ensureDirectories();
		const adapter = this.app.vault.adapter;

		for (const settingsPath of [
			this.getReaderSettingsPathForCurrentDevice(),
			this.getLegacyReaderSettingsPath(),
		]) {
			if (!(await adapter.exists(settingsPath))) {
				continue;
			}

			try {
				const content = await adapter.read(settingsPath);
				return this.normalizeLoadedReaderSettings(JSON.parse(content));
			} catch {
				return { ...this.getDefaultReaderSettingsForCurrentDevice() };
			}
		}

		return { ...this.getDefaultReaderSettingsForCurrentDevice() };
	}

	async saveReaderSettings(settings: EpubReaderSettings): Promise<void> {
		await this.ensureDirectories();
		const settingsPath = this.getReaderSettingsPathForCurrentDevice();
		await this.app.vault.adapter.write(settingsPath, JSON.stringify(settings));
	}

	private getDefaultReaderSettingsForCurrentDevice(): EpubReaderSettings {
		return Platform.isMobile
			? { ...DEFAULT_MOBILE_READER_SETTINGS }
			: { ...DEFAULT_READER_SETTINGS };
	}

	private normalizeLoadedReaderSettings(settings: Partial<EpubReaderSettings>): EpubReaderSettings {
		const mergedSettings = {
			...this.getDefaultReaderSettingsForCurrentDevice(),
			...settings,
		};

		if (!Platform.isMobile && this.matchesLegacyDesktopReaderSettings(mergedSettings)) {
			return { ...DEFAULT_READER_SETTINGS };
		}

		if (Platform.isMobile && this.matchesLegacyForcedMobileReaderSettings(mergedSettings)) {
			return { ...DEFAULT_MOBILE_READER_SETTINGS };
		}

		return mergedSettings;
	}

	private matchesLegacyForcedMobileReaderSettings(settings: EpubReaderSettings): boolean {
		return (
			settings.lineHeight === LEGACY_FORCED_MOBILE_READER_SETTINGS.lineHeight &&
			settings.theme === LEGACY_FORCED_MOBILE_READER_SETTINGS.theme &&
			settings.widthMode === LEGACY_FORCED_MOBILE_READER_SETTINGS.widthMode &&
			settings.layoutMode === LEGACY_FORCED_MOBILE_READER_SETTINGS.layoutMode &&
			settings.flowMode === LEGACY_FORCED_MOBILE_READER_SETTINGS.flowMode &&
			settings.showScrolledSideNav === LEGACY_FORCED_MOBILE_READER_SETTINGS.showScrolledSideNav
		);
	}

	private matchesLegacyDesktopReaderSettings(settings: EpubReaderSettings): boolean {
		return (
			settings.lineHeight === LEGACY_DESKTOP_READER_SETTINGS.lineHeight &&
			settings.theme === LEGACY_DESKTOP_READER_SETTINGS.theme &&
			settings.widthMode === LEGACY_DESKTOP_READER_SETTINGS.widthMode &&
			settings.layoutMode === LEGACY_DESKTOP_READER_SETTINGS.layoutMode &&
			settings.flowMode === LEGACY_DESKTOP_READER_SETTINGS.flowMode &&
			settings.showScrolledSideNav === LEGACY_DESKTOP_READER_SETTINGS.showScrolledSideNav
		);
	}

	private getReaderSettingsPathForCurrentDevice(): string {
		const suffix = Platform.isMobile ? "mobile" : "desktop";
		return `${this.basePath}/reader-settings.${suffix}.json`;
	}

	private getLegacyReaderSettingsPath(): string {
		return `${this.basePath}/reader-settings.json`;
	}

	private async loadCanvasBindings(): Promise<Record<string, string>> {
		await this.ensureDirectories();
		const bindingsPath = `${this.basePath}/canvas-bindings.json`;
		const adapter = this.app.vault.adapter;

		if (await adapter.exists(bindingsPath)) {
			try {
				const content = await adapter.read(bindingsPath);
				return JSON.parse(content);
			} catch {
				return {};
			}
		}
		return {};
	}

	private async saveCanvasBindings(bindings: Record<string, string>): Promise<void> {
		await this.ensureDirectories();
		const bindingsPath = `${this.basePath}/canvas-bindings.json`;
		await this.app.vault.adapter.write(bindingsPath, JSON.stringify(bindings));
	}

	private remapPath(filePath: string, oldPath: string, newPath: string): string | null {
		const normalizedFilePath = normalizePath(filePath || "");
		if (!normalizedFilePath) {
			return null;
		}

		if (normalizedFilePath === oldPath) {
			return newPath;
		}

		if (normalizedFilePath.startsWith(`${oldPath}/`)) {
			return `${newPath}${normalizedFilePath.slice(oldPath.length)}`;
		}

		return null;
	}
}

export interface EpubExcerptSettings {
	addCreationTime: boolean;
}

const DEFAULT_EXCERPT_SETTINGS: EpubExcerptSettings = {
	addCreationTime: false,
};

const DEFAULT_READER_SETTINGS: EpubReaderSettings = {
	lineHeight: 1.72,
	theme: "default",
	widthMode: "standard",
	layoutMode: "paginated",
	flowMode: "paginated",
	showScrolledSideNav: true,
};

const DEFAULT_MOBILE_READER_SETTINGS: EpubReaderSettings = {
	...DEFAULT_READER_SETTINGS,
	lineHeight: 1.66,
	widthMode: "full",
};

const LEGACY_DESKTOP_READER_SETTINGS: EpubReaderSettings = {
	lineHeight: 1.9,
	theme: "default",
	widthMode: "full",
	layoutMode: "paginated",
	flowMode: "paginated",
	showScrolledSideNav: true,
};

const LEGACY_FORCED_MOBILE_READER_SETTINGS: EpubReaderSettings = {
	...LEGACY_DESKTOP_READER_SETTINGS,
	flowMode: "scrolled",
};
