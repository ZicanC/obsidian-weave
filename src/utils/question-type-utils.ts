import type { Card } from "../data/types";

export type QuestionTypeLabelFormat = "short" | "long" | "emoji";

const QUESTION_TYPE_ALIASES: Record<string, string> = {
	single_choice: "single_choice",
	single: "single_choice",
	multiple_choice: "multiple_choice",
	multiple: "multiple_choice",
	choice: "choice",
	cloze: "cloze",
	fill: "cloze",
	short_answer: "short_answer",
	qa: "short_answer",
	judge: "judge",
};

const QUESTION_TYPE_LABELS: Record<string, Record<QuestionTypeLabelFormat, string>> = {
	single_choice: {
		short: "单选",
		long: "单选题",
		emoji: "📝 单选",
	},
	multiple_choice: {
		short: "多选",
		long: "多选题",
		emoji: "☑️ 多选",
	},
	choice: {
		short: "选择",
		long: "选择题",
		emoji: "📝 选择",
	},
	cloze: {
		short: "填空",
		long: "填空题",
		emoji: "📋 填空",
	},
	short_answer: {
		short: "问答",
		long: "问答题",
		emoji: "✍️ 问答",
	},
	judge: {
		short: "判断",
		long: "判断题",
		emoji: "⚖️ 判断",
	},
};

export function normalizeQuestionType(type?: string | null): string | undefined {
	if (!type) return undefined;
	const normalized = String(type).trim().toLowerCase();
	return QUESTION_TYPE_ALIASES[normalized] || normalized;
}

export function getQuestionTypeFromCard(card?: Card | null): string | undefined {
	if (!card) return undefined;
	const rawType = card.metadata?.questionType || card.metadata?.questionMetadata?.type;
	return normalizeQuestionType(typeof rawType === "string" ? rawType : undefined);
}

export function getQuestionTypeLabel(
	type?: string | null,
	format: QuestionTypeLabelFormat = "short",
	fallback = "未知"
): string {
	const normalized = normalizeQuestionType(type);
	if (!normalized) return fallback;
	return QUESTION_TYPE_LABELS[normalized]?.[format] || normalized || fallback;
}

export function getQuestionTypeLabelFromCard(
	card?: Card | null,
	format: QuestionTypeLabelFormat = "short",
	fallback = "未知"
): string {
	return getQuestionTypeLabel(getQuestionTypeFromCard(card), format, fallback);
}
