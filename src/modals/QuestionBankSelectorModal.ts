import { type App, SuggestModal } from "obsidian";
import type { QuestionBankMatchCandidate } from "../services/question-bank/QuestionBankService";

export class QuestionBankSelectorModal extends SuggestModal<QuestionBankMatchCandidate> {
	private candidates: QuestionBankMatchCandidate[];
	private onSelect: (candidate: QuestionBankMatchCandidate) => void;

	constructor(
		app: App,
		candidates: QuestionBankMatchCandidate[],
		onSelect: (candidate: QuestionBankMatchCandidate) => void
	) {
		super(app);
		this.candidates = candidates;
		this.onSelect = onSelect;

		this.setPlaceholder("选择要进入的考试题组...");
		this.setInstructions([
			{ command: "↑↓", purpose: "选择考试题组" },
			{ command: "Enter", purpose: "确认进入" },
			{ command: "Esc", purpose: "取消" },
		]);
	}

	getSuggestions(query: string): QuestionBankMatchCandidate[] {
		const q = (query || "").trim().toLowerCase();
		if (!q) return this.candidates;

		return this.candidates.filter((candidate) => {
			const bank = candidate.bank;
			const name = bank.name?.toLowerCase?.() || "";
			const id = bank.id?.toLowerCase?.() || "";
			return name.includes(q) || id.includes(q);
		});
	}

	renderSuggestion(candidate: QuestionBankMatchCandidate, el: HTMLElement): void {
		const bank = candidate.bank;
		const container = el.createDiv({ cls: "weave-question-bank-suggestion" });
		container.createDiv({
			text: bank.name || "未命名考试题组",
			cls: "weave-question-bank-suggestion__title",
		});

		const meta: string[] = [];
		if (bank.id) meta.push(bank.id.slice(0, 8));
		const questionCountValue = bank.metadata?.questionCount;
		const questionCount =
			typeof questionCountValue === "number" ? questionCountValue : Number(questionCountValue ?? 0);
		if (questionCount > 0) meta.push(`${questionCount} 题`);
		meta.push(candidate.matchType === "pairedMemoryDeckId" ? "显式关联" : "卡片引用匹配");

		if (meta.length > 0) {
			container.createDiv({
				text: meta.join(" · "),
				cls: "weave-question-bank-suggestion__meta",
			});
		}

		if (candidate.matchType === "card-overlap") {
			container.createDiv({
				text: `命中 ${candidate.overlapCount} 张关联卡片`,
				cls: "weave-question-bank-suggestion__meta",
			});
		}
	}

	onChooseSuggestion(candidate: QuestionBankMatchCandidate): void {
		this.onSelect(candidate);
	}
}
