import { detectClozeModeFromContent, hasClozeSyntax } from "../cloze-mode";

const INPUT_CLOZE_ANSWER_REGEX = /\{\{c\d*::([\s\S]+?)(?:::[\s\S]*?)?\}\}|==([\s\S]+?)==/g;

export function isInputClozeQuestionContent(content: string): boolean {
	return hasClozeSyntax(content) && detectClozeModeFromContent(content) === "input";
}

export function extractInputClozeAnswers(content: string): string[] {
	if (!content) {
		return [];
	}

	const answers: string[] = [];

	for (const match of content.matchAll(INPUT_CLOZE_ANSWER_REGEX)) {
		const answer = (match[1] ?? match[2] ?? "").trim();
		if (answer) {
			answers.push(answer);
		}
	}

	return answers;
}

export function normalizeInputClozeAnswer(value: string): string {
	return (value ?? "")
		.normalize("NFKC")
		.replace(/\s+/g, " ")
		.trim()
		.toLocaleLowerCase();
}

export function checkInputClozeAnswers(userAnswers: string[], correctAnswers: string[]): boolean {
	if (userAnswers.length !== correctAnswers.length || correctAnswers.length === 0) {
		return false;
	}

	return correctAnswers.every((correctAnswer, index) => {
		const normalizedCorrect = normalizeInputClozeAnswer(correctAnswer);
		if (!normalizedCorrect) {
			return false;
		}

		return normalizeInputClozeAnswer(userAnswers[index] ?? "") === normalizedCorrect;
	});
}
