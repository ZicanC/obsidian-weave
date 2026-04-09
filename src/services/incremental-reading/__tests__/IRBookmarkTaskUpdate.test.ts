import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({
	normalizePath: (path: string) => path.replace(/\\/g, "/").replace(/\/{2,}/g, "/"),
}));

vi.mock("../../../config/paths", () => ({
	getV2PathsFromApp: () => ({
		ir: {
			root: "weave/incremental-reading",
		},
	}),
}));

import { IREpubBookmarkTaskService } from "../IREpubBookmarkTaskService";
import { IRPdfBookmarkTaskService } from "../IRPdfBookmarkTaskService";

type MemoryAdapter = {
	exists: any;
	mkdir: any;
	read: any;
	write: any;
};

function createMemoryAdapter(): MemoryAdapter {
	const files = new Map<string, string>();

	return {
		exists: vi.fn(async (path: string) => files.has(path)),
		mkdir: vi.fn(async (_path: string) => {}),
		read: vi.fn(async (path: string) => {
			const value = files.get(path);
			if (value === undefined) {
				throw new Error(`Missing file: ${path}`);
			}
			return value;
		}),
		write: vi.fn(async (path: string, content: string) => {
			files.set(path, content);
		}),
	};
}

function createApp(adapter: MemoryAdapter): any {
	return {
		vault: {
			adapter,
		},
	};
}

describe("bookmark task update merging", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-04-08T10:00:00.000Z"));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("pdf bookmark updates preserve existing meta and stats fields", async () => {
		const adapter = createMemoryAdapter();
		const service = new IRPdfBookmarkTaskService(createApp(adapter));
		const task = await service.createTask({
			topicId: "deck-1",
			pdfPath: "Books/Test.pdf",
			title: "Test",
			link: "obsidian://pdf",
		});

		const updated = await service.updateTask(task.id, {
			meta: {
				associatedNotePath: "Inbox/Linked.md",
			} as any,
			stats: {
				notesWritten: 3,
			} as any,
		});

		expect(updated).not.toBeNull();
		expect(updated?.meta.associatedNotePath).toBe("Inbox/Linked.md");
		expect(updated?.meta.siblings).toEqual({ prev: null, next: null });
		expect(updated?.meta.priorityLog).toEqual(task.meta.priorityLog);
		expect(updated?.stats.notesWritten).toBe(3);
		expect(updated?.stats.impressions).toBe(task.stats.impressions);
	});

	it("epub bookmark updates preserve existing meta and stats fields", async () => {
		const adapter = createMemoryAdapter();
		const service = new IREpubBookmarkTaskService(createApp(adapter));
		const task = await service.createTask({
			topicId: "deck-1",
			epubFilePath: "Books/Test.epub",
			title: "Chapter 1",
			tocHref: "chapter-1.xhtml",
			tocLevel: 0,
		});

		const updated = await service.updateTask(task.id, {
			meta: {
				associatedNotePath: "Inbox/Epub-Linked.md",
			} as any,
			stats: {
				notesWritten: 5,
			} as any,
		});

		expect(updated).not.toBeNull();
		expect(updated?.meta.associatedNotePath).toBe("Inbox/Epub-Linked.md");
		expect(updated?.meta.siblings).toEqual({ prev: null, next: null });
		expect(updated?.meta.priorityLog).toEqual(task.meta.priorityLog);
		expect(updated?.stats.notesWritten).toBe(5);
		expect(updated?.stats.impressions).toBe(task.stats.impressions);
	});

	it("pdf bookmark tasks support mixed deck identifiers", async () => {
		const adapter = createMemoryAdapter();
		const service = new IRPdfBookmarkTaskService(createApp(adapter));

		const canonical = await service.createTask({
			deckId: "deck-1",
			pdfPath: "Books/Test.pdf",
			title: "Canonical",
			link: "obsidian://canonical",
		});
		const legacy = await service.createTask({
			deckId: "Books/Test.pdf::deck",
			pdfPath: "Books/Test.pdf",
			title: "Legacy",
			link: "obsidian://legacy",
		});

		const tasks = await service.getTasksByDeckIdentifiers([
			"deck-1",
			" Books/Test.pdf::deck ",
			"deck-1",
		]);

		expect(tasks.map((task) => task.id).sort()).toEqual([canonical.id, legacy.id].sort());
	});

	it("epub bookmark tasks support mixed deck identifiers", async () => {
		const adapter = createMemoryAdapter();
		const service = new IREpubBookmarkTaskService(createApp(adapter));

		const canonical = await service.createTask({
			deckId: "deck-1",
			epubFilePath: "Books/Test.epub",
			title: "Chapter 1",
			tocHref: "chapter-1.xhtml",
			tocLevel: 0,
		});
		const legacy = await service.createTask({
			deckId: "Books/Test.epub::deck",
			epubFilePath: "Books/Test.epub",
			title: "Chapter 2",
			tocHref: "chapter-2.xhtml",
			tocLevel: 0,
		});

		const tasks = await service.getTasksByDeckIdentifiers([
			"deck-1",
			"Books/Test.epub::deck",
			"",
		]);

		expect(tasks.map((task) => task.id).sort()).toEqual([canonical.id, legacy.id].sort());
	});
});
