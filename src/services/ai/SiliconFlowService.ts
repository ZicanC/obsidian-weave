import { logger } from "../../utils/logger";
/**
 * 硅基流动AI服务实现
 * 继承自OpenAIService，因为硅基流动完全兼容OpenAI API格式
 * 硅基流动作为AI服务中转站，提供多种开源大模型的统一访问接口
 */

import type { AIServiceResponse, SystemPromptConfig } from "../../types/ai-types";
import { OpenAIService } from "./OpenAIService";

type SiliconFlowErrorLike = {
	message?: string;
	status?: number;
	code?: string;
};

export class SiliconFlowService extends OpenAIService {
	/**
	 * 硅基流动API基础URL
	 * 兼容OpenAI chat/completions格式
	 */
	protected baseUrl = "https://api.siliconflow.cn/v1"; // 默认官方地址

	constructor(
		apiKey: string,
		model: string,
		baseUrl?: string,
		systemPromptConfig?: SystemPromptConfig
	) {
		super(apiKey, model, baseUrl, systemPromptConfig);
		// 如果提供了自定义 baseUrl，则覆盖默认值
		if (baseUrl) {
			this.baseUrl = baseUrl;
		}
	}

	/**
	 * 硅基流动成本估算
	 * 注意：硅基流动提供免费额度，这里按实际价格计算（需要根据官方文档更新）
	 * 参考：硅基流动官网定价页面
	 */
	protected estimateCost(promptTokens: number, completionTokens: number): number {
		// 硅基流动的定价策略（示例价格，需根据实际调整）
		// 不同模型定价可能不同，这里使用平均值
		const PROMPT_PRICE = 0.0005; // ¥0.0005/1K tokens (输入)
		const COMPLETION_PRICE = 0.001; // ¥0.001/1K tokens (输出)

		const promptCost = (promptTokens / 1000) * PROMPT_PRICE;
		const completionCost = (completionTokens / 1000) * COMPLETION_PRICE;

		return promptCost + completionCost;
	}

	/**
	 * 测试硅基流动API连接
	 * 使用models端点验证API密钥有效性
	 */
	async testConnection(): Promise<boolean> {
		try {
			const response = await this.request({
				url: `${this.baseUrl}/models`,
				method: "GET",
				headers: {
					Authorization: `Bearer ${this.apiKey}`,
				},
			});

			return response.status === 200;
		} catch (error) {
			throw this.classifyConnectionError(error);
		}
	}

	/**
	 * 硅基流动特定错误处理
	 * 提供更友好的错误提示信息
	 */
	protected handleError(error: unknown): AIServiceResponse {
		logger.error("SiliconFlow API Error:", error);

		const errorLike =
			typeof error === "object" && error !== null ? (error as SiliconFlowErrorLike) : {};

		let errorMessage = "硅基流动API调用失败";

		if (errorLike.message) {
			if (errorLike.message.includes("401") || errorLike.message.includes("Unauthorized")) {
				errorMessage = "硅基流动API密钥无效，请在设置中检查配置";
			} else if (errorLike.message.includes("429") || errorLike.message.includes("rate limit")) {
				errorMessage = "硅基流动API请求频率超限，请稍后重试";
			} else if (
				errorLike.message.includes("quota") ||
				errorLike.message.includes("insufficient")
			) {
				errorMessage = "硅基流动API配额不足，请检查账户余额";
			} else if (errorLike.message.includes("timeout")) {
				errorMessage = "硅基流动API请求超时，请检查网络连接";
			} else if (errorLike.message.includes("model") && errorLike.message.includes("not found")) {
				errorMessage = "所选模型不可用，请在设置中选择其他模型";
			} else {
				errorMessage = `硅基流动API错误: ${errorLike.message}`;
			}
		} else if (errorLike.status) {
			switch (errorLike.status) {
				case 401:
					errorMessage = "硅基流动API密钥无效或已过期";
					break;
				case 403:
					errorMessage = "硅基流动API访问被拒绝，请检查权限";
					break;
				case 429:
					errorMessage = "硅基流动API请求过于频繁，请稍后再试";
					break;
				case 500:
					errorMessage = "硅基流动服务器错误，请稍后重试";
					break;
				case 503:
					errorMessage = "硅基流动服务暂时不可用，请稍后重试";
					break;
				default:
					errorMessage = `硅基流动API错误 (状态码: ${errorLike.status})`;
			}
		} else if (errorLike.code === "ECONNREFUSED") {
			errorMessage = "无法连接到硅基流动服务器，请检查网络连接";
		}

		return {
			success: false,
			error: errorMessage,
			cards: [],
		};
	}
}
