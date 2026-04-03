import type WeavePlugin from "../main";
import type { QuestionTestStats, TestAttempt } from "../types/question-bank-types";

const BASE_ALPHA = 0.2;

function normalizeAttempt(attempt: Partial<TestAttempt> | null | undefined): TestAttempt | null {
	if (!attempt?.timestamp) {
		return null;
	}

	return {
		isCorrect: !!attempt.isCorrect,
		mode: "exam",
		timestamp: attempt.timestamp,
		score: typeof attempt.score === "number" ? attempt.score : attempt.isCorrect ? 100 : 0,
		timeSpent: typeof attempt.timeSpent === "number" ? attempt.timeSpent : 0,
	};
}

function getAttemptsFromStats(stats?: QuestionTestStats): TestAttempt[] {
	if (!stats?.attempts || !Array.isArray(stats.attempts)) {
		return [];
	}

	return stats.attempts
		.map((attempt) => normalizeAttempt(attempt))
		.filter((attempt): attempt is TestAttempt => !!attempt);
}

export async function loadQuestionBankAttempts(
	plugin: WeavePlugin,
	bankId: string
): Promise<TestAttempt[]> {
	if (!plugin.questionBankStorage) {
		return [];
	}

	const [refs, globalStats, legacyBankStats] = await Promise.all([
		plugin.questionBankStorage.loadBankQuestionRefs(bankId),
		plugin.questionBankStorage.loadGlobalQuestionStats(),
		plugin.questionBankStorage.loadBankQuestionStats(bankId),
	]);

	const uniqueAttempts = new Map<string, TestAttempt>();

	const pushAttempts = (attempts: TestAttempt[]) => {
		for (const attempt of attempts) {
			const key = `${attempt.timestamp}_${attempt.isCorrect}_${attempt.score ?? ""}_${
				attempt.timeSpent ?? ""
			}`;
			uniqueAttempts.set(key, attempt);
		}
	};

	if (refs.length > 0) {
		for (const ref of refs) {
			pushAttempts(getAttemptsFromStats(globalStats[ref.cardUuid]));
			pushAttempts(getAttemptsFromStats(legacyBankStats[ref.cardUuid]));
		}
	} else {
		for (const stats of Object.values(legacyBankStats)) {
			pushAttempts(getAttemptsFromStats(stats));
		}
	}

	return Array.from(uniqueAttempts.values()).sort(
		(left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime()
	);
}

export function groupAttemptsByDate(attempts: TestAttempt[]): Record<string, TestAttempt[]> {
	return attempts.reduce<Record<string, TestAttempt[]>>((acc, attempt) => {
		const date = new Date(attempt.timestamp).toISOString().split("T")[0];
		if (!acc[date]) {
			acc[date] = [];
		}
		acc[date].push(attempt);
		return acc;
	}, {});
}

export function buildQuestionBankEwmaSeries(attempts: TestAttempt[]) {
	if (attempts.length === 0) {
		return {
			dates: [] as string[],
			ewmaData: [] as number[],
			historicalData: [] as number[],
			confidenceData: [] as number[],
		};
	}

	const dates: string[] = [];
	const ewmaData: number[] = [];
	const historicalData: number[] = [];
	const confidenceData: number[] = [];

	let ewma = 0.5;
	let correctCount = 0;

	attempts.forEach((attempt, index) => {
		const score = attempt.isCorrect ? 1 : 0;

		ewma = BASE_ALPHA * score + (1 - BASE_ALPHA) * ewma;
		correctCount += score;

		dates.push(
			new Date(attempt.timestamp).toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" })
		);
		ewmaData.push(Math.round(ewma * 1000) / 10);
		historicalData.push(Math.round((correctCount / (index + 1)) * 1000) / 10);
		confidenceData.push(Math.round((1 - Math.exp(-(index + 1) / 20)) * 1000) / 1000);
	});

	return { dates, ewmaData, historicalData, confidenceData };
}
