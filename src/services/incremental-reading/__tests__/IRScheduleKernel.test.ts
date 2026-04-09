import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({
	normalizePath: (path: string) => path.replace(/\\/g, "/").replace(/\/{2,}/g, "/"),
}));

vi.mock("../../../config/paths", () => ({
	getV2PathsFromApp: () => ({
		ir: {
			root: "weave/incremental-reading",
		},
	}),
	resolveIRImportFolder: (chunkRoot?: string) => String(chunkRoot || "weave/incremental-reading/chunks"),
}));

import { IREpubBookmarkTaskService } from "../IREpubBookmarkTaskService";
import { IRPdfBookmarkTaskService } from "../IRPdfBookmarkTaskService";
import { IRScheduleKernel } from "../IRScheduleKernel";
import { IRStorageService } from "../IRStorageService";
import { IRV4SchedulerService } from "../IRV4SchedulerService";

describe("IRScheduleKernel deck identifier compatibility", () => {
	beforeEach(() => {
		vi.restoreAllMocks();

		vi.spyOn(IRStorageService.prototype, "initialize").mockResolvedValue(undefined);
		vi.spyOn(IRStorageService.prototype, "getAllDecks").mockResolvedValue({
			"deck-1": {
				id: "deck-1",
				name: "Deck 1",
				path: "legacy/deck-path",
			} as any,
		});
		vi.spyOn(IRV4SchedulerService.prototype, "getStudyQueueV4").mockResolvedValue([] as any);
		vi.spyOn(IRPdfBookmarkTaskService.prototype, "initialize").mockResolvedValue(undefined);
		vi.spyOn(IREpubBookmarkTaskService.prototype, "initialize").mockResolvedValue(undefined);
		vi.spyOn(IREpubBookmarkTaskService.prototype, "getAllTasks").mockResolvedValue([]);
	});

	it("includes legacy-path pdf tasks in canonical deck recompute output", async () => {
		vi.spyOn(IRStorageService.prototype, "getAllChunkDataWithSync").mockResolvedValue({});
		vi.spyOn(IRPdfBookmarkTaskService.prototype, "getAllTasks").mockResolvedValue([
			{
				id: "pdfbm-1",
				topicId: "legacy/deck-path",
				deckId: "legacy/deck-path",
				pdfPath: "Books/Test.pdf",
				title: "Legacy PDF",
				link: "[[Books/Test.pdf#page=1]]",
				status: "new",
				priorityUi: 5,
				priorityEff: 5,
				intervalDays: 1,
				nextRepDate: 0,
				stats: {},
				meta: {},
				tags: [],
				createdAt: 1,
				updatedAt: 1,
			} as any,
		]);

		const kernel = new IRScheduleKernel({
			plugins: {
				getPlugin: () => null,
			},
		} as any);
		const plan = await kernel.recomputeScheduleForDeck("ui_refresh", { deckIds: ["deck-1"] });
		const items = plan.days.flatMap((day) => day.items);

		expect(items).toHaveLength(1);
		expect(items[0]?.id).toBe("pdfbm-1");
		expect(items[0]?.deckId).toBe("deck-1");
		expect(plan.deckIds).toEqual(["deck-1"]);
	});

	it("includes legacy-path chunks in canonical deck recompute output", async () => {
		vi.spyOn(IRStorageService.prototype, "getAllChunkDataWithSync").mockResolvedValue({
			"chunk-1": {
				chunkId: "chunk-1",
				filePath: "Books/Chunk.md",
				deckIds: ["legacy/deck-path"],
				priorityEff: 5,
				intervalDays: 1,
				nextRepDate: 0,
				scheduleStatus: "new",
				stats: {},
				meta: {},
			} as any,
		});
		vi.spyOn(IRPdfBookmarkTaskService.prototype, "getAllTasks").mockResolvedValue([]);

		const kernel = new IRScheduleKernel({
			plugins: {
				getPlugin: () => null,
			},
		} as any);
		const plan = await kernel.recomputeScheduleForDeck("ui_refresh", { deckIds: ["deck-1"] });
		const items = plan.days.flatMap((day) => day.items);

		expect(items).toHaveLength(1);
		expect(items[0]?.id).toBe("chunk-1");
		expect(items[0]?.deckId).toBe("deck-1");
		expect(plan.deckIds).toEqual(["deck-1"]);
	});
});
