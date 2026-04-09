import { describe, expect, it, vi } from "vitest";
import { DeckAggregationService } from "../deck/DeckAggregationService";
import {
	createDeckTagColumnKey,
	DECK_TAG_EMPTY_GROUP_KEY,
	DECK_TAG_GROUP_OTHER_KEY,
	normalizeDeckTagGroup,
	normalizeDeckTagGroupTags,
} from "../../types/deck-kanban-types";

describe("DeckAggregationService tag grouping", () => {
	it("normalizes tag group tags before persistence and grouping", () => {
		expect(normalizeDeckTagGroupTags(["  anatomy ", "anatomy", "", "physiology"])).toEqual([
			"anatomy",
			"physiology",
		]);

		expect(
			normalizeDeckTagGroup({
				id: "group-1",
				name: "  Human Body  ",
				tags: ["  anatomy ", "anatomy", "physiology"],
			})
		).toEqual({
			id: "group-1",
			name: "Human Body",
			tags: ["anatomy", "physiology"],
		});
	});

	it("uses internal keys so duplicate tags and reserved labels cannot crash keyed lists", async () => {
		const service = new DeckAggregationService(
			{
				getCards: vi.fn().mockResolvedValue([]),
			} as any
		);

		expect(service.analyzeTag({ tags: ["  anatomy "] } as any)).toBe(createDeckTagColumnKey("anatomy"));
		expect(service.analyzeTag({ tags: [] } as any)).toBe(DECK_TAG_EMPTY_GROUP_KEY);

		const grouped = await service.groupDecks(
			[
				{ id: "deck-1", tags: ["anatomy"] },
				{ id: "deck-2", tags: [] },
			] as any,
			"tagGroup",
			{
				id: "group-1",
				name: "Human Body",
				tags: [" anatomy ", "anatomy", "__other__"],
			}
		);

		expect(Object.keys(grouped).sort()).toEqual(
			[createDeckTagColumnKey("anatomy"), DECK_TAG_GROUP_OTHER_KEY].sort()
		);
		expect(grouped[createDeckTagColumnKey("anatomy")]).toHaveLength(1);
		expect(grouped[DECK_TAG_GROUP_OTHER_KEY]).toHaveLength(1);
	});
});
