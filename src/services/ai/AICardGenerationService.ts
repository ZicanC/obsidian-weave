/**
 * AI制卡核心生成服务
 *
 * 从 AIAssistantPage 提取的独立生成逻辑，供 AI助手页面 和 编辑器全局工具栏 共用。
 */

import { Notice } from "obsidian";
import type { WeavePlugin } from "../../main";
import type {
	GeneratedCard,
	GenerationConfig,
	GenerationProgress,
	PromptTemplate,
} from "../../types/ai-types";
import { validateContentLength } from "../../utils/file-utils";
import { logger } from "../../utils/logger";
import {
	buildVariablesFromConfig,
	replaceTemplateVariables,
} from "../../utils/prompt-template-utils";
import { AIServiceFactory } from "./AIServiceFactory";

/** 卡片内容相似度去重阈值（前 N 个非空白字符相同即视为重复） */
const DEDUP_PREFIX_LENGTH = 60;

export interface AICardGenerationCallbacks {
	onProgress: (progress: GenerationProgress) => void;
	onCardsUpdate: (cards: GeneratedCard[]) => void;
}

export class AICardGenerationService {
	private plugin: WeavePlugin;

	constructor(plugin: WeavePlugin) {
		this.plugin = plugin;
	}

	private isRateLimitErrorMessage(message?: string): boolean {
		if (!message) return false;
		const m = message.toLowerCase();
		return (
			m.includes("429") ||
			m.includes("rate limit") ||
			m.includes("too many requests") ||
			m.includes("quota") ||
			message.includes("频率") ||
			message.includes("限流")
		);
	}

	private buildRateLimitNotice(provider: string, raw?: string): string {
		const detail = raw ? `\n\n原始信息：${raw}` : "";
		return `AI服务触发限流/配额限制（429）。\n\n建议：\n1) 稍后再试（通常需要等待一段时间）\n2) 减少生成数量或降低并发/频率\n3) 检查${provider}账户配额、余额或套餐限制\n4) 需要时切换模型/提供商${detail}`;
	}

	/**
	 * 提取卡片内容的去重指纹（取 content 的前 N 个非空白字符）
	 */
	private getContentFingerprint(card: GeneratedCard): string {
		const raw = (card.content || "").replace(/\s+/g, "").toLowerCase();
		return raw.slice(0, DEDUP_PREFIX_LENGTH);
	}

	/**
	 * 对新生成的卡片进行去重，过滤掉与已有卡片内容重复的条目
	 */
	private deduplicateCards(
		newCards: GeneratedCard[],
		existingCards: GeneratedCard[]
	): GeneratedCard[] {
		const existingFingerprints = new Set(
			existingCards.map((existingCard) => this.getContentFingerprint(existingCard))
		);

		const uniqueCards: GeneratedCard[] = [];
		for (const card of newCards) {
			const fp = this.getContentFingerprint(card);
			if (!fp) continue;
			if (existingFingerprints.has(fp)) {
				logger.debug("[Dedup] 跳过重复卡片:", `${fp.slice(0, 30)}...`);
				continue;
			}
			existingFingerprints.add(fp);
			uniqueCards.push(card);
		}

		const removedCount = newCards.length - uniqueCards.length;
		if (removedCount > 0) {
			logger.debug(`[Dedup] 移除了 ${removedCount} 张重复卡片`);
		}
		return uniqueCards;
	}

	/**
	 * 执行AI制卡生成（单次请求）
	 *
	 * @param content 文档内容
	 * @param generationConfig 生成配置
	 * @param selectedPrompt 选中的提示词模板（可选）
	 * @param customPrompt 自定义提示词（可选）
	 * @param callbacks 进度和卡片更新回调
	 * @returns 生成的卡片数组
	 */
	async generateCards(
		content: string,
		generationConfig: GenerationConfig,
		selectedPrompt: PromptTemplate | null,
		customPrompt: string,
		callbacks: AICardGenerationCallbacks
	): Promise<GeneratedCard[]> {
		// 验证内容
		const validation = validateContentLength(content);
		if (!validation.valid) {
			new Notice(validation.message || "内容验证失败");
			throw new Error(validation.message || "内容验证失败");
		}

		// 验证AI配置
		if (!this.plugin.settings.aiConfig) {
			new Notice("请先在设置中配置AI服务");
			throw new Error("请先在设置中配置AI服务");
		}

		// 确定使用的提示词模板（未替换变量的原始模板）
		const promptText = selectedPrompt
			? selectedPrompt.prompt
			: customPrompt || "请根据以下内容生成学习卡片";

		const totalCount = generationConfig.cardCount;

		callbacks.onProgress({
			status: "preparing",
			progress: 0,
			message: "准备生成卡片...",
			currentCard: 0,
			totalCards: totalCount,
		});

		// 构建基础生成配置
		const aiConfig = this.plugin.settings.aiConfig;
		if (!aiConfig) {
			throw new Error("AI配置未初始化");
		}

		const provider = generationConfig.provider;
		const model = generationConfig.model;
		const apiKeys = aiConfig.apiKeys as
			| Record<string, { apiKey: string; enabled?: boolean } | undefined>
			| undefined;
		const providerConfig = apiKeys?.[provider];

		const aiService = AIServiceFactory.createService(provider, this.plugin, model);

		if (!providerConfig || !providerConfig.apiKey) {
			throw new Error(`${provider} API密钥未配置`);
		}

		const promptVariables = buildVariablesFromConfig(generationConfig);
		const resolvedPrompt = replaceTemplateVariables(promptText, promptVariables);

		const requestConfig: GenerationConfig = {
			...generationConfig,
			cardCount: totalCount,
			templateId: selectedPrompt?.id || "custom",
			promptTemplate: resolvedPrompt,
			customPrompt: customPrompt || undefined,
			provider,
			model,
			temperature: generationConfig.temperature,
			maxTokens: generationConfig.maxTokens,
		};

		logger.debug(`单次生成策略: 1次请求生成 ${totalCount} 张卡片`);

		callbacks.onProgress({
			status: "generating",
			progress: 5,
			message: `正在一次生成 ${totalCount} 张卡片...`,
			currentCard: 0,
			totalCards: totalCount,
		});

		const response = await aiService.generateCards(content, requestConfig, (progress) => {
			callbacks.onProgress({
				...progress,
				currentCard: 0,
				totalCards: totalCount,
			});
		});

		if (!response.success || !response.cards) {
			logger.error("单次生成失败:", response.error);
			if (this.isRateLimitErrorMessage(response.error)) {
				throw new Error(this.buildRateLimitNotice(provider, response.error));
			}
			throw new Error(response.error || "AI生成失败");
		}

		// 截断：AI返回数量可能超出请求，只取需要的数量
		let generatedCards = response.cards;
		if (generatedCards.length > totalCount) {
			logger.debug(`[Truncate] AI返回 ${generatedCards.length} 张，截断到请求的 ${totalCount} 张`);
			generatedCards = generatedCards.slice(0, totalCount);
		}

		// 去重：过滤掉本次请求中重复的卡片
		generatedCards = this.deduplicateCards(generatedCards, []);

		// 总量保护：确保不超过目标总数
		if (generatedCards.length > totalCount) {
			generatedCards = generatedCards.slice(0, totalCount);
		}

		let cardsWithNewFlag = generatedCards.map((generatedCard) => ({
			...generatedCard,
			isNew: true,
		}));

		callbacks.onCardsUpdate(cardsWithNewFlag);

		logger.debug(`单次生成完成: 返回${generatedCards.length}/${totalCount}张卡片`);

		// 短暂延迟，让用户看到卡片出现的动画
		await new Promise((resolve) => setTimeout(resolve, 100));

		cardsWithNewFlag = cardsWithNewFlag.map((generatedCard) => ({
			...generatedCard,
			isNew: false,
		}));
		callbacks.onCardsUpdate(cardsWithNewFlag);

		// 全部完成
		callbacks.onProgress({
			status: "completed",
			progress: 100,
			message: `成功生成${cardsWithNewFlag.length}张卡片`,
			currentCard: cardsWithNewFlag.length,
			totalCards: totalCount,
		});

		logger.debug("单次生成完成:", cardsWithNewFlag);

		return cardsWithNewFlag;
	}
}
