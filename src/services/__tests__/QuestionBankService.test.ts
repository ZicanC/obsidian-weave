import type { Deck } from "../../data/types";
import { QuestionBankService } from "../question-bank/QuestionBankService";

function createBank(
	id: string,
	name: string,
	pairedMemoryDeckId?: string
): Deck {
	const now = new Date().toISOString();
	return {
		id,
		name,
		description: "",
		category: "",
		categoryIds: [],
		path: name,
		level: 0,
		order: 0,
		inheritSettings: false,
		deckType: "question-bank",
		settings: {} as any,
		stats: {} as any,
		includeSubdecks: false,
		created: now,
		modified: now,
		tags: [],
		metadata: pairedMemoryDeckId ? { pairedMemoryDeckId } : {},
	};
}

function createService(initialBanks: Deck[]) {
	let storedBanks = structuredClone(initialBanks);
	const storage = {
		loadBanks: vi.fn(async () => structuredClone(storedBanks)),
		saveBanks: vi.fn(async (banks: Deck[]) => {
			storedBanks = structuredClone(banks);
		}),
	} as any;
	const dataStorage = {} as any;
	return {
		service: new QuestionBankService(storage, dataStorage),
		storage,
		getStoredBanks: () => structuredClone(storedBanks),
	};
}

describe("QuestionBankService.pairBankWithMemoryDeck", () => {
	it("sets explicit pairing on the selected bank and clears duplicate pairings for the same memory deck", async () => {
		const bankA = createBank("bank-a", "考试 A", "deck-1");
		const bankB = createBank("bank-b", "考试 B");
		const bankC = createBank("bank-c", "考试 C", "deck-2");
		const { service, storage, getStoredBanks } = createService([bankA, bankB, bankC]);

		const pairedBank = await service.pairBankWithMemoryDeck("bank-b", "deck-1");
		const savedBanks = getStoredBanks();

		expect((pairedBank.metadata as any).pairedMemoryDeckId).toBe("deck-1");
		expect((savedBanks.find((bank) => bank.id === "bank-a")?.metadata as any)?.pairedMemoryDeckId).toBeUndefined();
		expect((savedBanks.find((bank) => bank.id === "bank-b")?.metadata as any)?.pairedMemoryDeckId).toBe("deck-1");
		expect((savedBanks.find((bank) => bank.id === "bank-c")?.metadata as any)?.pairedMemoryDeckId).toBe("deck-2");
		expect(storage.saveBanks).toHaveBeenCalledTimes(1);
	});

	it("does not rewrite storage when the selected bank is already the unique explicit pairing", async () => {
		const bankA = createBank("bank-a", "考试 A", "deck-1");
		const bankB = createBank("bank-b", "考试 B", "deck-2");
		const { service, storage, getStoredBanks } = createService([bankA, bankB]);

		await service.pairBankWithMemoryDeck("bank-a", "deck-1");

		expect(getStoredBanks()).toEqual([bankA, bankB]);
		expect(storage.saveBanks).not.toHaveBeenCalled();
	});
});
