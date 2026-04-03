/**
 * AI配置响应式Store
 * 单一数据源，所有组件从这里读取和更新配置
 *
 * 核心理念：
 * - Single Source of Truth (单一数据源)
 * - Immutable Updates (不可变更新)
 * - Reactive Propagation (响应式传播)
 *
 * @module stores/ai-config
 */

import { derived, get, writable } from "svelte/store";
import { OFFICIAL_FORMAT_ACTIONS } from "../constants/official-format-actions";
import { OFFICIAL_TEST_GEN_ACTIONS } from "../constants/official-test-gen-actions";
import { DEFAULT_SPLIT_ACTIONS } from "../data/default-split-actions";
import type { WeavePlugin } from "../main";
import type { AIAction, AIProvider } from "../types/ai-types";
import { logger } from "../utils/logger";

type PersistedAIConfig = NonNullable<WeavePlugin["settings"]["aiConfig"]>;

function createDefaultPersistedAIConfig(): PersistedAIConfig {
	return {
		apiKeys: {},
		defaultProvider: "zhipu",
		customFormatActions: [],
		customTestGenActions: [],
		customSplitActions: [],
		officialFormatActions: {
			choice: { enabled: true },
			mathFormula: { enabled: true },
			memoryAid: { enabled: true },
		},
	} as PersistedAIConfig;
}

function hasPersistableActionIdentity(action: AIAction, expectedType: string): boolean {
	return (
		action.category === "custom" &&
		action.type === expectedType &&
		typeof action.id === "string" &&
		action.id.trim().length > 0
	);
}

function isActionReadyForMenu(action: AIAction, expectedType: string): boolean {
	if (!hasPersistableActionIdentity(action, expectedType)) {
		return false;
	}

	const userPrompt = (action.userPromptTemplate || action.userPrompt || "").trim();

	if (!action.name.trim() || !action.systemPrompt.trim() || !userPrompt) {
		return false;
	}

	if (action.enabled === false) {
		return false;
	}

	if (expectedType === "test-generator" && !action.testConfig) {
		return false;
	}

	if (expectedType === "split" && !action.splitConfig) {
		return false;
	}

	return true;
}

// ============================================================================
// Type Definitions
// ============================================================================

export interface AIConfigState {
	// 自定义功能列表
	customFormatActions: AIAction[];
	customTestGenActions: AIAction[];
	customSplitActions: AIAction[];

	// 默认配置
	defaultProvider: AIProvider;
	apiKeys: Record<string, { apiKey: string; model?: string }>;

	// 元数据
	lastModified: number;
	version: number; // 用于追踪变更
}

// ============================================================================
// Core Store Class
// ============================================================================

class AIConfigStore {
	private plugin: WeavePlugin | null = null;
	private store = writable<AIConfigState>(this.getInitialState());
	private saveDebounceTimer: ReturnType<typeof setTimeout> | null = null;
	private readonly SAVE_DEBOUNCE_MS = 1000; // 1秒防抖

	// ============================================================================
	// Initialization
	// ============================================================================

	initialize(plugin: WeavePlugin) {
		this.plugin = plugin;
		this.loadFromPlugin();
		logger.info("[AIConfigStore] Store已初始化");
	}

	reloadFromPlugin() {
		this.loadFromPlugin();
	}

	private getInitialState(): AIConfigState {
		return {
			customFormatActions: [],
			customTestGenActions: [],
			customSplitActions: [],
			defaultProvider: "zhipu",
			apiKeys: {},
			lastModified: Date.now(),
			version: 0,
		};
	}

	private loadFromPlugin() {
		if (!this.plugin) {
			logger.warn("[AIConfigStore] Plugin未初始化，跳过加载");
			return;
		}

		const aiConfig = this.plugin.settings.aiConfig;
		if (!aiConfig) {
			logger.warn("[AIConfigStore] aiConfig不存在，使用默认值");
			return;
		}

		// ✅ 使用安全的深拷贝方法并确保类型正确
		try {
			this.store.set({
				customFormatActions: structuredClone((aiConfig.customFormatActions || []) as AIAction[]),
				customTestGenActions: structuredClone((aiConfig.customTestGenActions || []) as AIAction[]),
				customSplitActions: structuredClone((aiConfig.customSplitActions || []) as AIAction[]),
				defaultProvider: aiConfig.defaultProvider || "zhipu",
				apiKeys: structuredClone(aiConfig.apiKeys || {}),
				lastModified: Date.now(),
				version: 0,
			});
		} catch (error) {
			// fallback到JSON方法
			logger.warn("[AIConfigStore] 加载时structuredClone失败，使用JSON fallback:", error);
			this.store.set({
				customFormatActions: JSON.parse(
					JSON.stringify((aiConfig.customFormatActions || []) as AIAction[])
				),
				customTestGenActions: JSON.parse(
					JSON.stringify((aiConfig.customTestGenActions || []) as AIAction[])
				),
				customSplitActions: JSON.parse(
					JSON.stringify((aiConfig.customSplitActions || []) as AIAction[])
				),
				defaultProvider: aiConfig.defaultProvider || "zhipu",
				apiKeys: JSON.parse(JSON.stringify(aiConfig.apiKeys || {})),
				lastModified: Date.now(),
				version: 0,
			});
		}

		logger.info("[AIConfigStore] 配置已从plugin加载", {
			formatActions: aiConfig.customFormatActions?.length || 0,
			testGenActions: aiConfig.customTestGenActions?.length || 0,
			splitActions: aiConfig.customSplitActions?.length || 0,
		});
	}

	// ============================================================================
	// Read Operations
	// ============================================================================

	subscribe = this.store.subscribe;

	getState(): AIConfigState {
		return get(this.store);
	}

	// ============================================================================
	// Update Operations (Immutable)
	// ============================================================================

	/**
	 * 更新格式化功能列表
	 */
	updateFormatActions(actions: AIAction[]) {
		this.store.update((state) => ({
			...state,
			customFormatActions: this.validateAndClone(actions, "format"),
			lastModified: Date.now(),
			version: state.version + 1,
		}));
		this.scheduleSave();
		logger.debug("[AIConfigStore] 格式化功能已更新", { count: actions.length });
	}

	/**
	 * 更新测试题生成功能列表
	 */
	updateTestGenActions(actions: AIAction[]) {
		this.store.update((state) => ({
			...state,
			customTestGenActions: this.validateAndClone(actions, "test-generator"),
			lastModified: Date.now(),
			version: state.version + 1,
		}));
		this.scheduleSave();
		logger.debug("[AIConfigStore] 测试题功能已更新", { count: actions.length });
	}

	/**
	 * 更新AI拆分功能列表
	 */
	updateSplitActions(actions: AIAction[]) {
		this.store.update((state) => ({
			...state,
			customSplitActions: this.validateAndClone(actions, "split"),
			lastModified: Date.now(),
			version: state.version + 1,
		}));
		this.scheduleSave();
		logger.debug("[AIConfigStore] 拆分功能已更新", { count: actions.length });
	}

	/**
	 * 批量更新所有功能
	 */
	updateAllActions(
		formatActions: AIAction[],
		testGenActions: AIAction[],
		splitActions: AIAction[]
	) {
		this.store.update((state) => ({
			...state,
			customFormatActions: this.validateAndClone(formatActions, "format"),
			customTestGenActions: this.validateAndClone(testGenActions, "test-generator"),
			customSplitActions: this.validateAndClone(splitActions, "split"),
			lastModified: Date.now(),
			version: state.version + 1,
		}));
		this.scheduleSave();
		logger.debug("[AIConfigStore] 所有功能已批量更新");
	}

	// ============================================================================
	// Validation & Deep Clone
	// ============================================================================

	private validateAndClone(actions: AIAction[], expectedType: string): AIAction[] {
		return actions
			.filter((a) => hasPersistableActionIdentity(a, expectedType))
			.map((a) => this.deepCloneAction(a));
	}

	private deepCloneAction(action: AIAction): AIAction {
		// ✅ 使用安全的深拷贝方法，只克隆可序列化的字段
		try {
			// 方法1：尝试使用 structuredClone（最快）
			const cloned = structuredClone(action);
			return {
				...cloned,
				provider: action.provider,
				model: action.model,
				testConfig: action.testConfig,
				splitConfig: action.splitConfig,
			};
		} catch (error) {
			// 方法2：fallback到JSON方法（兼容但会丢失undefined）
			logger.warn("[AIConfigStore] structuredClone失败，使用JSON fallback:", error);

			// 手动构造对象，显式保留所有字段
			const cloned = JSON.parse(JSON.stringify(action)) as Partial<AIAction>;

			// ✅ 显式恢复可能丢失的字段
			return {
				...cloned,
				id: action.id,
				name: action.name,
				type: action.type,
				category: action.category,
				systemPrompt: action.systemPrompt,
				userPromptTemplate: action.userPromptTemplate,
				provider: action.provider,
				model: action.model,
				testConfig: action.testConfig,
				splitConfig: action.splitConfig,
				description: action.description,
				icon: action.icon,
				enabled: action.enabled,
				createdAt: action.createdAt,
				updatedAt: action.updatedAt,
			} as AIAction;
		}
	}

	private ensurePluginAIConfig(): PersistedAIConfig {
		if (!this.plugin) {
			throw new Error("Plugin未初始化");
		}

		if (!this.plugin.settings.aiConfig) {
			this.plugin.settings.aiConfig = createDefaultPersistedAIConfig();
		}

		return this.plugin.settings.aiConfig as PersistedAIConfig;
	}

	// ============================================================================
	// Persistence (Debounced)
	// ============================================================================

	private scheduleSave() {
		if (this.saveDebounceTimer) {
			clearTimeout(this.saveDebounceTimer);
		}

		this.saveDebounceTimer = setTimeout(() => {
			void this.saveToPlugin();
		}, this.SAVE_DEBOUNCE_MS);
	}

	async saveToPlugin() {
		if (!this.plugin) {
			logger.error("[AIConfigStore] Plugin未初始化，无法保存");
			return;
		}

		const state = this.getState();
		const aiConfig = this.ensurePluginAIConfig();

		try {
			aiConfig.customFormatActions = structuredClone(state.customFormatActions);
			aiConfig.customTestGenActions = structuredClone(state.customTestGenActions);
			aiConfig.customSplitActions = structuredClone(state.customSplitActions);
		} catch (error) {
			// fallback到JSON方法
			logger.warn("[AIConfigStore] 保存时structuredClone失败，使用JSON fallback:", error);
			aiConfig.customFormatActions = JSON.parse(
				JSON.stringify(state.customFormatActions)
			) as AIAction[];
			aiConfig.customTestGenActions = JSON.parse(
				JSON.stringify(state.customTestGenActions)
			) as AIAction[];
			aiConfig.customSplitActions = JSON.parse(
				JSON.stringify(state.customSplitActions)
			) as AIAction[];
		}

		try {
			await this.plugin.saveSettings();
			logger.info("[AIConfigStore] 配置已保存到磁盘", {
				version: state.version,
				formatActions: state.customFormatActions.length,
				testGenActions: state.customTestGenActions.length,
				splitActions: state.customSplitActions.length,
			});
		} catch (error) {
			logger.error("[AIConfigStore] 保存失败:", error);
			throw error;
		}
	}

	/**
	 * 强制立即保存（用于关闭时）
	 */
	async forceSave() {
		if (this.saveDebounceTimer) {
			clearTimeout(this.saveDebounceTimer);
			this.saveDebounceTimer = null;
		}
		await this.saveToPlugin();
	}

	/**
	 * 清理资源
	 */
	destroy() {
		if (this.saveDebounceTimer) {
			clearTimeout(this.saveDebounceTimer);
			this.saveDebounceTimer = null;
		}
	}
}

// ============================================================================
// Singleton Instance
// ============================================================================

export const aiConfigStore = new AIConfigStore();

// ============================================================================
// Derived Stores (Auto-computed)
// ============================================================================

/**
 * 所有格式化功能（官方 + 自定义）
 */
export const allFormatActions = derived(aiConfigStore, ($state) => {
	const official = OFFICIAL_FORMAT_ACTIONS.map((officialAction) => {
		return {
			...officialAction,
			type: "format" as const,
			category: "official" as const,
		};
	});

	const custom = $state.customFormatActions.map((customAction) => {
		return {
			...customAction,
			type: "format" as const,
			category: "custom" as const,
		};
	});

	return [...official, ...custom] as AIAction[];
});

/**
 * 所有测试题生成功能（官方 + 自定义）
 */
export const allTestGenActions = derived(aiConfigStore, ($state) => {
	const official = OFFICIAL_TEST_GEN_ACTIONS.map((officialAction) => {
		return {
			...officialAction,
			type: "test-generator" as const,
			category: "official" as const,
		};
	});

	const custom = $state.customTestGenActions.map((customAction) => {
		return {
			...customAction,
			type: "test-generator" as const,
			category: "custom" as const,
		};
	});

	return [...official, ...custom] as AIAction[];
});

/**
 * 所有AI拆分功能（官方 + 自定义）
 */
export const allSplitActions = derived(aiConfigStore, ($state) => {
	const official = DEFAULT_SPLIT_ACTIONS.map((officialAction) => {
		return {
			...officialAction,
			type: "split" as const,
			category: "official" as const,
		};
	});

	const custom = $state.customSplitActions.map((customAction) => {
		return {
			...customAction,
			type: "split" as const,
			category: "custom" as const,
		};
	});

	return [...official, ...custom] as AIAction[];
});

/**
 * 仅自定义功能（用于AI助手菜单）
 */
export const customActionsForMenu = derived(aiConfigStore, ($state) => ({
	format: $state.customFormatActions.filter((a) => isActionReadyForMenu(a, "format")),
	testGen: $state.customTestGenActions.filter((a) => isActionReadyForMenu(a, "test-generator")),
	split: $state.customSplitActions.filter((a) => isActionReadyForMenu(a, "split")),
}));
