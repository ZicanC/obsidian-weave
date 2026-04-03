/**
 * APKG 数据修复工具
 *
 * 用于修复旧版 APKG 导入产生的字段重复问题。
 */

import type { Card } from "../data/types";

export interface RepairResult {
	success: boolean;
	repairedCount: number;
	skippedCount: number;
	errors: string[];
	details: RepairDetail[];
}

export interface RepairDetail {
	cardId: string;
	action: "cleaned" | "skipped" | "error";
	removedFields: string[];
	message?: string;
}

type AnkiOriginalFields = {
	fields: Record<string, string>;
};

type CardCustomFieldsWithAnki = Record<string, unknown> & {
	ankiOriginal?: AnkiOriginalFields;
};

function getMutableCustomFields(card: Card): CardCustomFieldsWithAnki {
	const customFields = (card.customFields ?? {}) as CardCustomFieldsWithAnki;

	if (!card.customFields) {
		card.customFields = customFields as Card["customFields"];
	}

	return customFields;
}

function detectDuplication(card: Card): boolean {
	if (!card.fields || typeof card.fields !== "object") {
		return false;
	}

	const fields = card.fields;
	const hasStandardFields = "front" in fields || "back" in fields;
	const hasCompatFields = "question" in fields || "answer" in fields;
	const hasAnkiFields = Object.keys(fields).some(
		(key) => key !== "front" && key !== "back" && key !== "question" && key !== "answer"
	);

	return (hasStandardFields && hasCompatFields) || hasAnkiFields;
}

function cleanDuplicateFields(card: Card): RepairDetail {
	const removedFields: string[] = [];

	try {
		if (!card.fields || typeof card.fields !== "object") {
			return {
				cardId: card.uuid,
				action: "skipped",
				removedFields: [],
				message: "fields 为空或格式错误",
			};
		}

		const originalFields = { ...(card.fields ?? {}) };
		const cleanedFields: Record<string, string> = {};

		if (originalFields.front) {
			cleanedFields.front = originalFields.front;
		} else if (originalFields.question) {
			cleanedFields.front = originalFields.question;
			removedFields.push("question (merged to front)");
		}

		if (originalFields.back) {
			cleanedFields.back = originalFields.back;
		} else if (originalFields.answer) {
			cleanedFields.back = originalFields.answer;
			removedFields.push("answer (merged to back)");
		}

		for (const key of Object.keys(originalFields)) {
			if (key !== "front" && key !== "back") {
				removedFields.push(key);
			}
		}

		card.fields = cleanedFields;

		if (removedFields.length > 0 && !card.customFields?.ankiOriginal) {
			const customFields = getMutableCustomFields(card);
			const ankiFields: Record<string, string> = {};

			for (const key of Object.keys(originalFields)) {
				if (key !== "front" && key !== "back" && key !== "question" && key !== "answer") {
					const value = originalFields[key];
					ankiFields[key] = typeof value === "string" ? value : String(value || "");
				}
			}

			if (Object.keys(ankiFields).length > 0) {
				customFields.ankiOriginal = {
					...(customFields.ankiOriginal ?? {}),
					fields: ankiFields,
				};
			}
		}

		return {
			cardId: card.uuid,
			action: "cleaned",
			removedFields,
			message: `已清理 ${removedFields.length} 个重复字段`,
		};
	} catch (error) {
		return {
			cardId: card.uuid,
			action: "error",
			removedFields: [],
			message: `清理失败: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

function repairContentDivider(card: Card): boolean {
	if (!card.content) {
		return false;
	}

	if (card.content.startsWith("---div---")) {
		card.content = card.content.substring("---div---".length).trim();
		return true;
	}

	return false;
}

function repairCards(cards: Card[]): RepairResult {
	const result: RepairResult = {
		success: true,
		repairedCount: 0,
		skippedCount: 0,
		errors: [],
		details: [],
	};

	for (const card of cards) {
		const cleanDetail = cleanDuplicateFields(card);
		result.details.push(cleanDetail);

		if (cleanDetail.action === "cleaned") {
			result.repairedCount++;
		} else if (cleanDetail.action === "skipped") {
			result.skippedCount++;
		} else if (cleanDetail.action === "error") {
			result.errors.push(cleanDetail.message || "未知错误");
		}

		if (repairContentDivider(card)) {
			result.details.push({
				cardId: card.uuid,
				action: "cleaned",
				removedFields: [],
				message: "已修复 content 分隔符位置",
			});
		}
	}

	result.success = result.errors.length === 0;
	return result;
}

function generateReport(result: RepairResult): string {
	const lines: string[] = [];

	lines.push("# APKG 数据修复报告");
	lines.push("");
	lines.push("## 总结");
	lines.push(`- 修复状态: ${result.success ? "成功" : "失败"}`);
	lines.push(`- 已修复卡片: ${result.repairedCount}`);
	lines.push(`- 跳过卡片: ${result.skippedCount}`);
	lines.push(`- 错误数量: ${result.errors.length}`);
	lines.push("");

	if (result.errors.length > 0) {
		lines.push("## 错误列表");
		for (const [index, error] of result.errors.entries()) {
			lines.push(`${index + 1}. ${error}`);
		}
		lines.push("");
	}

	lines.push("## 详细信息");
	lines.push("");

	const cleanedCards = result.details.filter((detail) => detail.action === "cleaned");
	if (cleanedCards.length > 0) {
		lines.push(`### 已清理的卡片 (${cleanedCards.length})`);
		for (const detail of cleanedCards) {
			lines.push(`- 卡片 ${detail.cardId}:`);
			if (detail.removedFields.length > 0) {
				lines.push(`  - 移除字段: ${detail.removedFields.join(", ")}`);
			}
			if (detail.message) {
				lines.push(`  - ${detail.message}`);
			}
		}
		lines.push("");
	}

	const skippedCards = result.details.filter((detail) => detail.action === "skipped");
	if (skippedCards.length > 0) {
		lines.push(`### 跳过的卡片 (${skippedCards.length})`);
		for (const detail of skippedCards.slice(0, 10)) {
			lines.push(`- 卡片 ${detail.cardId}: ${detail.message || "无需修复"}`);
		}
		if (skippedCards.length > 10) {
			lines.push(`- ... 还有 ${skippedCards.length - 10} 张卡片`);
		}
		lines.push("");
	}

	return lines.join("\n");
}

export const APKGDataRepairTool = {
	detectDuplication,
	cleanDuplicateFields,
	repairContentDivider,
	repairCards,
	generateReport,
};
