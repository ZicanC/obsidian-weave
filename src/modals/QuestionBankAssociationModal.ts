import { type App, SuggestModal } from "obsidian";
import { get } from "svelte/store";
import type { Deck } from "../data/types";
import { tr } from "../utils/i18n";

export class QuestionBankAssociationModal extends SuggestModal<Deck> {
	private banks: Deck[];
	private currentBankId: string | null;
	private onSelect: (bank: Deck) => void;
	private t = get(tr);

	constructor(
		app: App,
		banks: Deck[],
		currentBankId: string | null,
		onSelect: (bank: Deck) => void
	) {
		super(app);
		this.banks = banks;
		this.currentBankId = currentBankId;
		this.onSelect = onSelect;

		this.setPlaceholder(this.t("deckStudyPage.exam.linkPrompt"));
		this.setInstructions([
			{ command: "↑↓", purpose: this.t("deckStudyPage.exam.linkSelectPurpose") },
			{ command: "Enter", purpose: this.t("deckStudyPage.exam.linkConfirmPurpose") },
			{ command: "Esc", purpose: this.t("deckStudyPage.exam.linkCancelPurpose") },
		]);
	}

	getSuggestions(query: string): Deck[] {
		const normalizedQuery = query.trim().toLowerCase();
		if (!normalizedQuery) return this.banks;

		return this.banks.filter((bank) => {
			const name = bank.name?.toLowerCase?.() || "";
			const path = bank.path?.toLowerCase?.() || "";
			const id = bank.id?.toLowerCase?.() || "";
			return (
				name.includes(normalizedQuery) ||
				path.includes(normalizedQuery) ||
				id.includes(normalizedQuery)
			);
		});
	}

	renderSuggestion(bank: Deck, el: HTMLElement): void {
		const container = el.createDiv({ cls: "weave-question-bank-suggestion" });
		container.createDiv({
			text: bank.name || this.t("deckStudyPage.fallback.unknownBank"),
			cls: "weave-question-bank-suggestion__title",
		});

		const meta: string[] = [];
		if (bank.path && bank.path !== bank.name) meta.push(bank.path);

		const questionCountValue = bank.metadata?.questionCount;
		const questionCount =
			typeof questionCountValue === "number"
				? questionCountValue
				: Number(questionCountValue ?? 0);
		if (questionCount > 0) meta.push(`${questionCount} 题`);

		const pairedMemoryDeckId = (bank.metadata as Record<string, unknown> | undefined)?.pairedMemoryDeckId;
		if (bank.id === this.currentBankId) {
			meta.push(this.t("deckStudyPage.exam.statusCurrentLinked"));
		} else if (typeof pairedMemoryDeckId === "string" && pairedMemoryDeckId.trim().length > 0) {
			meta.push(this.t("deckStudyPage.exam.statusLinkedElsewhere"));
		} else {
			meta.push(this.t("deckStudyPage.exam.statusUnlinked"));
		}

		container.createDiv({
			text: meta.join(" · "),
			cls: "weave-question-bank-suggestion__meta",
		});
	}

	onChooseSuggestion(bank: Deck): void {
		this.onSelect(bank);
	}
}
