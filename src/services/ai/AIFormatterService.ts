/**
 * AI驱动的卡片格式化服务
 * 使用真实AI模型进行智能格式规范化
 */

import type { Card, Deck } from "../../data/types";
import type { WeavePlugin } from "../../main";
import type { AIProvider, CustomFormatAction, FormatPreviewResult } from "../../types/ai-types";
import type { ParseTemplate } from "../../types/newCardParsingTypes";
import type { AIConfig } from "../../types/plugin-settings";
import { logger } from "../../utils/logger";
import { AIServiceFactory } from "./AIServiceFactory";
import { PromptVariableResolver } from "./PromptVariableResolver";

export interface FormatRequest {
	content: string;
	formatType: "choice";
}

export interface FormatResponse {
	success: boolean;
	formattedContent?: string;
	error?: string;
	provider?: AIProvider;
	model?: string;
}

interface AIProviderConfig {
	apiKey: string;
	model?: string;
	baseUrl?: string;
	verified?: boolean;
	lastVerified?: string;
}

type AIConfigWithFormattingProvider = AIConfig & {
	apiKeys?: Partial<Record<AIProvider, AIProviderConfig>>;
	formattingProvider?: string;
};

type FormatContext = { template?: ParseTemplate; deck?: Deck };

const AI_PROVIDERS: AIProvider[] = [
	"openai",
	"gemini",
	"anthropic",
	"deepseek",
	"zhipu",
	"siliconflow",
	"xai",
];

const variableResolver = new PromptVariableResolver();

function isAIProvider(value?: string): value is AIProvider {
	return value !== undefined && AI_PROVIDERS.includes(value as AIProvider);
}

function getAIConfig(plugin: WeavePlugin): AIConfigWithFormattingProvider | undefined {
	return plugin.settings.aiConfig as AIConfigWithFormattingProvider | undefined;
}

function getProviderConfig(
	aiConfig: AIConfigWithFormattingProvider,
	provider: AIProvider
): AIProviderConfig | undefined {
	return aiConfig.apiKeys?.[provider];
}

function buildSystemPrompt(): string {
	return `你是一个选择题格式规范化助手。

## 核心原则
1. **不修改内容** - 保持所有文本完全一致
2. **仅调整格式** - 将内容重组为标准格式
3. **识别正确答案** - 将正确答案编码到题干末尾括号中

## 标准格式
\`\`\`
Q: [问题内容]（B）

A. [选项A]
B. [选项B]
C. [选项C]
D. [选项D]

---div---

[解析内容]
\`\`\`

## 格式要求
- 问题以"Q: "开头
- 选项用 A. B. C. D. 标记
- 正确答案只能写在题干末尾：例如（B）或（A,C）
- 解析内容放在 ---div--- 分隔符之后

## 严格禁止
- 改写或润色任何文本
- 添加新内容或删除原有内容
- 修改正确答案
- 纠正拼写/语法错误
- 在选项行中添加 {✓}/{correct}/{*} 等标记
- 输出 Answer: / 正确答案: 这样的单独答案行

## 允许操作
- 统一格式标记（A) → A.）
- 添加/调整空行
- 把旧格式的正确答案标记（如 {✓}）转换为题干末尾括号（如（B））
- 规范分隔符格式

## 输出格式要求
**重要**：直接返回格式化后的文本内容，不要使用markdown代码块（\`\`\`）包裹，不要添加任何前缀、后缀或额外说明。

示例正确输出：
Q: 问题内容（B）

A. 选项A
B. 选项B

---div---

解析内容`;
}

function buildUserPrompt(content: string): string {
	return `请规范化以下选择题：

${content}`;
}

function cleanAIResponse(content: string): string {
	if (!content) {
		return "";
	}

	let cleaned = content.trim();
	const codeBlockRegex = /^```(?:markdown|md|text|)?\s*\n?([\s\S]*?)\n?```$/;
	const match = cleaned.match(codeBlockRegex);

	if (match) {
		cleaned = match[1].trim();
	}

	return cleaned.replace(/\n{3,}/g, "\n\n");
}

function validateChoiceFormat(content: string): {
	isValid: boolean;
	reason?: string;
} {
	if (!content.includes("Q:") && !content.includes("q:")) {
		return { isValid: false, reason: "缺少问题部分（Q:）" };
	}

	const optionsMatch = content.match(/^[A-Z][\)\.．、）]\s*/gm);
	if (!optionsMatch || optionsMatch.length < 2) {
		return { isValid: false, reason: "选项数量不足（至少需要2个）" };
	}

	const hasLegacyCorrectMarker =
		content.includes("{✓}") ||
		content.toLowerCase().includes("{correct}") ||
		content.includes("{*}");
	const hasTrailingAnswerParens =
		/^(?:Q:|q:|问题：)\s*.*[（(]\s*[A-Z](?:\s*[,，、]\s*[A-Z])*\s*[）)]\s*$/m.test(content);

	if (!hasLegacyCorrectMarker && !hasTrailingAnswerParens) {
		return { isValid: false, reason: "缺少正确答案信息（题干末尾（A,C）或旧格式{✓}）" };
	}

	return { isValid: true };
}

async function formatWithCustomAction(
	action: CustomFormatAction,
	card: Card,
	context: FormatContext,
	plugin: WeavePlugin
): Promise<FormatPreviewResult> {
	try {
		const aiConfig = getAIConfig(plugin);

		if (!aiConfig?.formatting?.enabled) {
			return {
				success: false,
				originalContent: card.content || "",
				error: "AI格式化功能未启用",
			};
		}

		const provider =
			action.provider ||
			(isAIProvider(aiConfig.defaultProvider) ? aiConfig.defaultProvider : undefined);

		if (!provider) {
			return {
				success: false,
				originalContent: card.content || "",
				error: "未设置AI提供商",
			};
		}

		const providerConfig = getProviderConfig(aiConfig, provider);
		if (!providerConfig?.apiKey) {
			return {
				success: false,
				originalContent: card.content || "",
				error: `AI提供商"${provider}"未配置API密钥，请前往 [插件设置 > AI服务] 进行配置`,
			};
		}

		const systemPrompt = variableResolver.resolve(action.systemPrompt, card, context);
		const userPrompt = variableResolver.resolve(action.userPromptTemplate, card, context);
		const aiService = AIServiceFactory.createService(provider, plugin, action.model);
		const response = await aiService.chat({
			messages: [
				{ role: "system", content: systemPrompt },
				{ role: "user", content: userPrompt },
			],
			temperature: action.temperature ?? 0.1,
			maxTokens: action.maxTokens ?? 2000,
		});

		if (!response.success || !response.content) {
			return {
				success: false,
				originalContent: card.content || "",
				error: response.error || "AI格式化失败",
			};
		}

		return {
			success: true,
			originalContent: card.content || "",
			formattedContent: cleanAIResponse(response.content),
			provider,
			model: response.model,
		};
	} catch (error) {
		logger.error("[AIFormatterService] Error:", error);
		return {
			success: false,
			originalContent: card.content || "",
			error: error instanceof Error ? error.message : "未知错误",
		};
	}
}

async function formatChoiceQuestion(
	request: FormatRequest,
	plugin: WeavePlugin
): Promise<FormatResponse> {
	try {
		const aiConfig = getAIConfig(plugin);

		if (!aiConfig?.formatting?.enabled) {
			return {
				success: false,
				error: "AI格式化功能未启用，请在设置中开启",
			};
		}

		const provider =
			(isAIProvider(aiConfig.formattingProvider) ? aiConfig.formattingProvider : undefined) ||
			(isAIProvider(aiConfig.defaultProvider) ? aiConfig.defaultProvider : undefined);

		if (!provider) {
			return {
				success: false,
				error: "未设置AI提供商，请在设置中配置",
			};
		}

		const providerConfig = getProviderConfig(aiConfig, provider);
		if (!providerConfig?.apiKey) {
			return {
				success: false,
				error: `格式化AI提供商"${provider}"未配置API密钥，请在设置中配置`,
			};
		}

		const aiService = AIServiceFactory.createService(provider, plugin, providerConfig.model);
		const response = await aiService.chat({
			messages: [
				{ role: "system", content: buildSystemPrompt() },
				{ role: "user", content: buildUserPrompt(request.content) },
			],
			temperature: 0.1,
			maxTokens: 2000,
		});

		if (!response.success || !response.content) {
			logger.error("[AIFormatterService] AI调用失败:", response.error);
			return {
				success: false,
				error: response.error || "AI格式化失败",
			};
		}

		const formattedContent = cleanAIResponse(response.content);
		const validation = validateChoiceFormat(formattedContent);

		if (!validation.isValid) {
			logger.error("[AIFormatterService] 格式验证失败:", validation.reason);
			return {
				success: false,
				error: `格式化结果不符合规范：${validation.reason}`,
			};
		}

		return {
			success: true,
			formattedContent,
			provider,
			model: response.model,
		};
	} catch (error) {
		logger.error("[AIFormatterService] Error:", error);
		return {
			success: false,
			error: error instanceof Error ? error.message : "未知错误",
		};
	}
}

export const AIFormatterService = {
	formatWithCustomAction,
	formatChoiceQuestion,
};
