/**
 * 选择题解析器
 * 遵循卡片数据结构规范 v1.0
 */

import { CARD_TYPE_MARKERS, MAIN_SEPARATOR } from "../../constants/markdown-delimiters";
import { parseChoiceQuestion } from "../../parsing/choice-question-parser";
import type { ParseResult } from "../../types/metadata-types";
import { ParseErrorType } from "../../types/metadata-types";
import { stripHintBlock } from "../../utils/hint-block-utils";
import { extractBodyContent } from "../../utils/yaml-utils";
import { CardType, MarkdownFieldsConverter } from "../MarkdownFieldsConverter";

/**
 * 选择题解析器
 *
 * 支持格式：
 * Q: 问题
 * A) / A. / A、 选项1
 * B) / B. / B、 选项2 {✓}
 * C) / C. / C、 选项3
 * ---div---
 * 解析内容（可选）
 *
 * 兼容答案表达：
 * - 选项后的 {✓} / {correct} / {*}
 * - 题干末尾的 (B) / （AC）
 * - Answer: B / Answer: A,C
 *
 *  标准字段：只生成 { front, back, options, correctAnswers }
 *  禁止添加元数据字段到fields（hint/explanation等）
 */
export class ChoiceCardParser extends MarkdownFieldsConverter {
	/**
	 * 解析Markdown为fields
	 *
	 * 标准字段：{ front, back, options, correctAnswers }
	 */
	parseMarkdownToFields(content: string, _type: CardType): ParseResult {
		try {
			//  v2.2: 先剥离 YAML frontmatter，只保留正文（Anki 导出不需要元数据）
			const bodyContent = extractBodyContent(content);
			const cleanContent = stripHintBlock(bodyContent).trim();

			if (!cleanContent) {
				return this.createErrorResult(
					ParseErrorType.INVALID_FORMAT,
					"内容为空",
					content,
					"请输入选择题内容"
				);
			}

			// 统一复用项目内更健壮的选择题解析器，避免 UI / 预览 / Anki 导出各走一套规则。
			const parsedQuestion = parseChoiceQuestion(cleanContent);
			if (!parsedQuestion) {
				return this.createErrorResult(
					ParseErrorType.INVALID_FORMAT,
					"未找到问题部分或选项",
					content,
					"选择题需要包含题干和至少2个选项（支持 A) / A. / A、 等格式）"
				);
			}

			// 构建标准fields对象（只有4个字段）
			const fields: Record<string, string> = {
				front: this.cleanFieldContent(parsedQuestion.question),
				back: this.cleanFieldContent(parsedQuestion.explanation || ""),
				options: this.serializeOptions(parsedQuestion.options),
				correctAnswers: this.serializeCorrectAnswers(parsedQuestion.correctAnswers),
			};

			// 验证
			const validation = this.validateRequiredFields(fields, ["front", "options"]);
			if (!validation.valid) {
				return this.createErrorResult(
					ParseErrorType.MISSING_REQUIRED_FIELD,
					`缺少必需字段: ${validation.missing.join(", ")}`,
					content
				);
			}

			// 警告：未找到正确答案
			const warnings: string[] = [];
			if (parsedQuestion.correctAnswers.length === 0) {
				warnings.push("未找到正确答案标记或答案声明");
			}

			return this.createSuccessResult(
				fields,
				content,
				undefined,
				warnings.length > 0 ? warnings : undefined
			);
		} catch (error) {
			return this.createErrorResult(
				ParseErrorType.INVALID_FORMAT,
				`解析失败: ${error instanceof Error ? error.message : String(error)}`,
				content
			);
		}
	}

	/**
	 * 序列化选项为字符串（用于存储）
	 */
	private serializeOptions(
		options: Array<{ label: string; content: string; isCorrect: boolean }>
	): string {
		return options
			.map((opt) => `${opt.label}) ${opt.content}${opt.isCorrect ? " {✓}" : ""}`)
			.join("\n");
	}

	private serializeCorrectAnswers(correctAnswers: string[]): string {
		return correctAnswers.map((answer) => `${answer})`).join(",");
	}

	/**
	 * 从fields重建Markdown
	 *
	 * 重建规则：
	 * - Q: 问题
	 * - A) B) C) 选项
	 * - 如果有back，添加---div---和解析
	 */
	buildMarkdownFromFields(fields: Record<string, string>, _type: CardType): string {
		let markdown = "";

		// 1. 构建问题部分
		const question = fields.front || fields.Front || "";
		markdown += `${CARD_TYPE_MARKERS.CHOICE.QUESTION} ${question}\n\n`;

		// 2. 构建选项部分
		if (fields.options) {
			markdown += `${fields.options}\n\n`;
		}

		// 3. 如果有解析，添加分隔符和解析
		const explanation = fields.back || fields.Back || "";
		if (explanation) {
			markdown += `${MAIN_SEPARATOR}\n\n`;
			markdown += explanation;
		}

		return markdown.trim();
	}
}
