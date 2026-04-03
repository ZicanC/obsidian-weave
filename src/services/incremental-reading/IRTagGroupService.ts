/**
 * 标签组（材料类型）服务 v3.0
 *
 * 职责：
 * - 管理标签组定义的 CRUD
 * - 管理标签组参数（可学习）
 * - 文档到标签组的匹配与缓存
 * - 组参数的 shrinkage 学习
 *
 * @module services/incremental-reading/IRTagGroupService
 * @version 3.0.0
 */

import { TFile } from "obsidian";
import type { App } from "obsidian";
import { getV2PathsFromApp } from "../../config/paths";
import type {
	IRAdvancedScheduleSettings,
	IRDocumentGroupMap,
	IRDocumentGroupMapStore,
	IRTagGroup,
	IRTagGroupMatchSource,
	IRTagGroupProfile,
	IRTagGroupProfilesStore,
	IRTagGroupsStore,
} from "../../types/ir-types";
import {
	DEFAULT_ADVANCED_SCHEDULE_SETTINGS,
	DEFAULT_TAG_GROUP,
	DEFAULT_TAG_GROUP_PROFILE,
	IR_STORAGE_VERSION,
} from "../../types/ir-types";
import { logger } from "../../utils/logger";
import { extractAllTags } from "../../utils/yaml-utils";

// ============================================
// 存储路径常量
// ============================================

const TAG_GROUPS_FILE = "tag-groups.json";
const TAG_GROUP_PROFILES_FILE = "tag-group-profiles.json";
const DOCUMENT_GROUP_MAP_FILE = "document-group-map.json";

// ============================================
// IRTagGroupService 类
// ============================================

export class IRTagGroupService {
	private app: App;
	private initialized = false;
	private initPromise: Promise<void> | null = null;

	private groupsCache: Record<string, IRTagGroup> = {};
	private profilesCache: Record<string, IRTagGroupProfile> = {};
	private documentMapCache: Record<string, IRDocumentGroupMap> = {};

	constructor(app: App) {
		this.app = app;
	}

	private getStorageDir(): string {
		return getV2PathsFromApp(this.app).ir.root;
	}

	/**
	 * 初始化服务
	 */
	async initialize(): Promise<void> {
		if (this.initialized) return;
		if (this.initPromise) return this.initPromise;

		this.initPromise = this.doInitialize();
		try {
			await this.initPromise;
		} finally {
			this.initPromise = null;
		}
	}

	private async doInitialize(): Promise<void> {
		try {
			const adapter = this.app.vault.adapter;

			const storageDir = this.getStorageDir();

			// 确保目录存在
			if (!(await adapter.exists(storageDir))) {
				await adapter.mkdir(storageDir);
			}

			// 🔧 优化：并行加载所有数据
			await Promise.all([this.loadGroups(), this.loadProfiles(), this.loadDocumentMap()]);

			// 确保默认组存在（这些通常很快）
			const savePromises: Promise<void>[] = [];
			if (!this.groupsCache.default) {
				this.groupsCache.default = { ...DEFAULT_TAG_GROUP };
				savePromises.push(this.saveGroups());
			}
			if (!this.profilesCache.default) {
				this.profilesCache.default = { ...DEFAULT_TAG_GROUP_PROFILE };
				savePromises.push(this.saveProfiles());
			}
			if (savePromises.length > 0) {
				await Promise.all(savePromises);
			}

			this.initialized = true;
			logger.info("[IRTagGroupService] 初始化完成");
		} catch (error) {
			logger.error("[IRTagGroupService] 初始化失败:", error);
			this.initialized = true; // 允许继续，使用默认值
		}
	}

	// ============================================
	// 标签组管理
	// ============================================

	/**
	 * 加载所有标签组
	 */
	private async loadGroups(): Promise<void> {
		const adapter = this.app.vault.adapter;
		const filePath = `${this.getStorageDir()}/${TAG_GROUPS_FILE}`;

		try {
			if (!(await adapter.exists(filePath))) {
				this.groupsCache = {};
				return;
			}

			const content = await adapter.read(filePath);
			const parsed = JSON.parse(content) as IRTagGroupsStore;
			const groups =
				parsed &&
				typeof parsed === "object" &&
				(parsed as any).groups &&
				typeof (parsed as any).groups === "object"
					? (parsed as any).groups
					: {};
			this.groupsCache = groups as Record<string, IRTagGroup>;
		} catch {
			this.groupsCache = {};
		}
	}

	private async saveGroups(): Promise<void> {
		const adapter = this.app.vault.adapter;
		const filePath = `${this.getStorageDir()}/${TAG_GROUPS_FILE}`;

		const store: IRTagGroupsStore = {
			version: IR_STORAGE_VERSION,
			groups: this.groupsCache,
		};

		await adapter.write(filePath, JSON.stringify(store));
	}

	private async loadProfiles(): Promise<void> {
		const adapter = this.app.vault.adapter;
		const filePath = `${this.getStorageDir()}/${TAG_GROUP_PROFILES_FILE}`;

		try {
			if (!(await adapter.exists(filePath))) {
				this.profilesCache = {};
			} else {
				const content = await adapter.read(filePath);
				const parsed = JSON.parse(content) as IRTagGroupProfilesStore;
				const profiles =
					parsed &&
					typeof parsed === "object" &&
					(parsed as any).profiles &&
					typeof (parsed as any).profiles === "object"
						? (parsed as any).profiles
						: {};
				this.profilesCache = profiles as Record<string, IRTagGroupProfile>;
			}
		} catch {
			this.profilesCache = {};
		}
	}

	private async saveProfiles(): Promise<void> {
		const adapter = this.app.vault.adapter;
		const filePath = `${this.getStorageDir()}/${TAG_GROUP_PROFILES_FILE}`;

		const store: IRTagGroupProfilesStore = {
			version: IR_STORAGE_VERSION,
			profiles: this.profilesCache,
		};

		await adapter.write(filePath, JSON.stringify(store));
	}

	private async loadDocumentMap(): Promise<void> {
		const adapter = this.app.vault.adapter;
		const filePath = `${this.getStorageDir()}/${DOCUMENT_GROUP_MAP_FILE}`;

		try {
			if (!(await adapter.exists(filePath))) {
				this.documentMapCache = {};
				return;
			}

			const content = await adapter.read(filePath);
			const parsed = JSON.parse(content) as IRDocumentGroupMapStore;
			const map =
				parsed &&
				typeof parsed === "object" &&
				(parsed as any).map &&
				typeof (parsed as any).map === "object"
					? (parsed as any).map
					: {};
			this.documentMapCache = map as Record<string, IRDocumentGroupMap>;
		} catch {
			this.documentMapCache = {};
		}
	}

	private async saveDocumentMap(): Promise<void> {
		const adapter = this.app.vault.adapter;
		const filePath = `${this.getStorageDir()}/${DOCUMENT_GROUP_MAP_FILE}`;

		const store: IRDocumentGroupMapStore = {
			version: IR_STORAGE_VERSION,
			map: this.documentMapCache,
		};

		await adapter.write(filePath, JSON.stringify(store));
	}

	async getAllGroups(): Promise<IRTagGroup[]> {
		await this.initialize();
		return Object.values(this.groupsCache).sort(
			(a, b) => (a.matchPriority ?? 0) - (b.matchPriority ?? 0)
		);
	}

	async createGroup(
		name: string,
		matchAnyTags: string[],
		description = "",
		matchPriority = 100
	): Promise<IRTagGroup> {
		await this.initialize();
		const id = `group_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
		const now = new Date().toISOString();
		const group: IRTagGroup = {
			id,
			name,
			description,
			matchAnyTags: Array.isArray(matchAnyTags) ? matchAnyTags : [],
			matchPriority,
			createdAt: now,
			updatedAt: now,
		};
		this.groupsCache[id] = group;
		await this.saveGroups();

		if (!this.profilesCache[id]) {
			this.profilesCache[id] = {
				...DEFAULT_TAG_GROUP_PROFILE,
				groupId: id,
			};
			await this.saveProfiles();
		}

		return group;
	}

	async saveGroup(group: IRTagGroup): Promise<void> {
		await this.initialize();
		this.groupsCache[group.id] = group;
		await this.saveGroups();
	}

	async deleteGroup(
		groupId: string,
		storageService?: {
			getAllChunkData?: () => Promise<Record<string, any>>;
			saveChunkData?: (data: any) => Promise<void>;
			getAllSources?: () => Promise<Record<string, any>>;
			saveSource?: (data: any) => Promise<void>;
		}
	): Promise<void> {
		await this.initialize();

		if (!groupId || groupId === "default") {
			return;
		}

		for (const mapping of Object.values(this.documentMapCache)) {
			if (mapping.groupId === groupId) {
				mapping.groupId = "default";
				mapping.updatedAt = new Date().toISOString();
			}
		}

		delete this.groupsCache[groupId];
		delete this.profilesCache[groupId];

		await Promise.all([this.saveGroups(), this.saveProfiles(), this.saveDocumentMap()]);

		// 级联清理 chunk/source 中的残留 groupId
		if (storageService?.getAllChunkData && storageService?.saveChunkData) {
			try {
				const allChunks = await storageService.getAllChunkData();
				for (const chunk of Object.values(allChunks)) {
					if (chunk?.meta?.tagGroup === groupId) {
						chunk.meta.tagGroup = "default";
						chunk.updatedAt = Date.now();
						await storageService.saveChunkData(chunk);
					}
				}
			} catch (error) {
				logger.warn(`[IRTagGroupService] 级联清理 chunk tagGroup 失败: ${groupId}`, error);
			}
		}
		if (storageService?.getAllSources && storageService?.saveSource) {
			try {
				const allSources = await storageService.getAllSources();
				for (const source of Object.values(allSources)) {
					if (source?.tagGroup === groupId) {
						source.tagGroup = "default";
						source.updatedAt = Date.now();
						await storageService.saveSource(source);
					}
				}
			} catch (error) {
				logger.warn(`[IRTagGroupService] 级联清理 source tagGroup 失败: ${groupId}`, error);
			}
		}
	}

	async getProfile(groupId: string): Promise<IRTagGroupProfile> {
		await this.initialize();
		const existing = this.profilesCache[groupId];
		if (existing) return existing;

		const created: IRTagGroupProfile = {
			...DEFAULT_TAG_GROUP_PROFILE,
			groupId,
		};
		this.profilesCache[groupId] = created;
		await this.saveProfiles();
		return created;
	}

	async saveProfile(profile: IRTagGroupProfile): Promise<void> {
		await this.initialize();
		this.profilesCache[profile.groupId] = profile;
		await this.saveProfiles();
	}

	/**
	 * 从文件中提取标签（默认提取所有来源）
	 */
	async extractTagsFromFile(filePath: string): Promise<string[]> {
		return this.extractTagsWithSource(filePath);
	}

	/**
	 * 按 matchSource 配置从文件提取标签
	 * 未传 matchSource 时默认提取 yamlTags + inlineTags
	 */
	async extractTagsWithSource(
		filePath: string,
		matchSource?: IRTagGroupMatchSource
	): Promise<string[]> {
		const useYamlTags = matchSource?.yamlTags ?? true;
		const useInlineTags = matchSource?.inlineTags ?? true;
		const customProps = matchSource?.customProperties ?? [];

		try {
			const file = this.app.vault.getAbstractFileByPath(filePath);
			if (!(file instanceof TFile)) return [];

			const cache = this.app.metadataCache.getFileCache(file);
			const collected: string[] = [];

			// 1. YAML frontmatter tags 属性
			if (useYamlTags) {
				const frontmatterTags = cache?.frontmatter?.tags || [];
				if (Array.isArray(frontmatterTags)) {
					collected.push(...frontmatterTags.map((t) => String(t)));
				} else if (typeof frontmatterTags === "string") {
					collected.push(...frontmatterTags.split(",").map((t) => t.trim()));
				}
			}

			// 2. 内联 #tags
			if (useInlineTags) {
				const inlineTags = cache?.tags?.map((t) => t.tag.replace(/^#/, "")) || [];
				collected.push(...inlineTags);
			}

			// 3. 自定义 YAML 属性
			if (customProps.length > 0 && cache?.frontmatter) {
				for (const prop of customProps) {
					const value = cache.frontmatter[prop];
					if (Array.isArray(value)) {
						collected.push(...value.map((t) => String(t)));
					} else if (typeof value === "string") {
						collected.push(...value.split(",").map((t) => t.trim()));
					}
				}
			}

			// 清理并去重
			const cleaned = collected.map((t) => t.replace(/^#/, "")).filter(Boolean);

			const allTags = [...new Set(cleaned)];

			// 回退：当无任何匹配源配置且无结果时，尝试全文提取
			if (allTags.length === 0 && !matchSource) {
				try {
					const content = await this.app.vault.cachedRead(file);
					const extracted = extractAllTags(content)
						.map((t) => String(t).replace(/^#/, ""))
						.filter(Boolean)
						.map((t) => t.toLowerCase());
					return [...new Set(extracted)];
				} catch {
					return [];
				}
			}

			return allTags.map((t) => t.toLowerCase());
		} catch (error) {
			logger.debug(`[IRTagGroupService] 提取标签失败: ${filePath}`, error);
		}
		return [];
	}

	/**
	 * 为文档匹配标签组
	 *
	 * @param filePath 文件路径
	 * @param forceRefresh 强制刷新（忽略缓存）
	 * @returns 匹配的标签组 ID
	 */
	async matchGroupForDocument(filePath: string, forceRefresh = false): Promise<string> {
		await this.initialize();

		// 检查缓存
		if (!forceRefresh && this.documentMapCache[filePath]) {
			return this.documentMapCache[filePath].groupId;
		}

		// 获取所有标签组（排除 default），按优先级排序
		const groups = Object.values(this.groupsCache)
			.filter((g) => g.id !== "default")
			.sort((a, b) => a.matchPriority - b.matchPriority);

		// 按每个 group 的 matchSource 分别提取并匹配
		let matchedGroupId = "default";
		let allCollectedTags: string[] = [];

		for (const group of groups) {
			const documentTags = await this.extractTagsWithSource(filePath, group.matchSource);
			if (allCollectedTags.length === 0 && documentTags.length > 0) {
				allCollectedTags = documentTags;
			}

			const groupTags = group.matchAnyTags.map((t) => t.toLowerCase());
			const hasMatch = documentTags.some((dt) => groupTags.includes(dt));
			if (hasMatch) {
				matchedGroupId = group.id;
				allCollectedTags = documentTags;
				break;
			}
		}

		// 如果没有匹配到任何组，用默认提取方式记录标签快照
		if (matchedGroupId === "default" && allCollectedTags.length === 0) {
			allCollectedTags = await this.extractTagsFromFile(filePath);
		}

		// 更新缓存
		this.documentMapCache[filePath] = {
			filePath,
			groupId: matchedGroupId,
			tagsSnapshot: allCollectedTags,
			updatedAt: new Date().toISOString(),
		};
		await this.saveDocumentMap();

		logger.debug(
			`[IRTagGroupService] 匹配标签组: ${filePath} -> ${matchedGroupId}, ` +
				`文档标签=[${allCollectedTags.join(", ")}]`
		);

		return matchedGroupId;
	}

	invalidateDocumentCache(filePath: string): void {
		if (this.documentMapCache[filePath]) {
			delete this.documentMapCache[filePath];
		}
	}

	/**
	 * 手动设置文档的标签组映射（用于右键菜单等手动切换场景）
	 * 同步更新 documentMapCache，使设置界面文档数统计正确
	 */
	async updateDocumentGroupManual(filePath: string, groupId: string): Promise<void> {
		await this.initialize();
		this.documentMapCache[filePath] = {
			filePath,
			groupId,
			tagsSnapshot: this.documentMapCache[filePath]?.tagsSnapshot || [],
			updatedAt: new Date().toISOString(),
		};
		await this.saveDocumentMap();
	}

	/**
	 * 获取文档的标签组参数
	 */
	async getProfileForDocument(filePath: string): Promise<IRTagGroupProfile> {
		const groupId = await this.matchGroupForDocument(filePath);
		return this.getProfile(groupId);
	}

	/**
	 * 清除文档映射缓存
	 */
	async clearDocumentMapCache(filePath?: string): Promise<void> {
		await this.initialize();

		if (filePath) {
			delete this.documentMapCache[filePath];
		} else {
			this.documentMapCache = {};
		}

		await this.saveDocumentMap();
	}

	// ============================================
	// 标签漂移检测
	// ============================================

	/**
	 * 检测文档标签是否发生漂移（匹配到不同标签组）
	 *
	 * @param filePath 源文档路径
	 * @param currentTagGroup 当前存储的标签组 ID
	 * @returns 漂移信息，null 表示未漂移
	 */
	async detectTagGroupDrift(
		filePath: string,
		currentTagGroup: string
	): Promise<{
		oldGroupId: string;
		newGroupId: string;
		oldGroupName: string;
		newGroupName: string;
		currentTags: string[];
	} | null> {
		await this.initialize();

		// 重新提取文档当前标签
		const currentTags = await this.extractTagsFromFile(filePath);

		// 重新匹配标签组（强制刷新）
		const newGroupId = await this.matchGroupForDocument(filePath, true);

		// 未漂移
		if (newGroupId === currentTagGroup) {
			return null;
		}

		// 获取组名称
		const oldGroup = this.groupsCache[currentTagGroup];
		const newGroup = this.groupsCache[newGroupId];

		return {
			oldGroupId: currentTagGroup,
			newGroupId,
			oldGroupName: oldGroup?.name || (currentTagGroup === "default" ? "默认" : currentTagGroup),
			newGroupName: newGroup?.name || (newGroupId === "default" ? "默认" : newGroupId),
			currentTags,
		};
	}

	/**
	 * 执行标签组切换：批量更新同一 sourceId 下所有 chunk 和 source 的 tagGroup
	 *
	 * @param chunkId 触发切换的块 ID
	 * @param sourceId 源文件 ID（可选）
	 * @param newGroupId 新标签组 ID
	 * @param storageService 存储服务（用于回写数据）
	 */
	async applyTagGroupSwitch(
		chunkId: string,
		sourceId: string | undefined,
		newGroupId: string,
		storageService: {
			getChunkData: (id: string) => Promise<any>;
			saveChunkData: (data: any) => Promise<void>;
			getSource: (id: string) => Promise<any>;
			saveSource: (data: any) => Promise<void>;
			getAllChunkData?: () => Promise<Record<string, any>>;
		}
	): Promise<void> {
		await this.initialize();

		let updatedCount = 0;

		// 批量更新同一 sourceId 下所有 chunk 的 tagGroup
		if (sourceId && storageService.getAllChunkData) {
			try {
				const allChunks = await storageService.getAllChunkData();
				for (const chunk of Object.values(allChunks)) {
					if (chunk?.sourceId === sourceId) {
						chunk.meta = chunk.meta || {};
						chunk.meta.tagGroup = newGroupId;
						chunk.updatedAt = Date.now();
						await storageService.saveChunkData(chunk);
						updatedCount++;
					}
				}
			} catch (error) {
				logger.warn(
					`[IRTagGroupService] 批量更新 chunk tagGroup 失败: sourceId=${sourceId}`,
					error
				);
			}
		} else {
			// 回退：仅更新当前 chunk
			try {
				const chunkData = await storageService.getChunkData(chunkId);
				if (chunkData) {
					chunkData.meta = chunkData.meta || {};
					chunkData.meta.tagGroup = newGroupId;
					chunkData.updatedAt = Date.now();
					await storageService.saveChunkData(chunkData);
					updatedCount = 1;
				}
			} catch (error) {
				logger.warn(`[IRTagGroupService] 更新 chunk tagGroup 失败: ${chunkId}`, error);
			}
		}

		// 更新 source 的 tagGroup
		if (sourceId) {
			try {
				const source = await storageService.getSource(sourceId);
				if (source) {
					source.tagGroup = newGroupId;
					source.updatedAt = Date.now();
					await storageService.saveSource(source);
				}
			} catch (error) {
				logger.warn(`[IRTagGroupService] 更新 source tagGroup 失败: ${sourceId}`, error);
			}
		}

		logger.info(
			`[IRTagGroupService] 标签组切换: sourceId=${sourceId}, newGroup=${newGroupId}, 更新 ${updatedCount} 个 chunk`
		);
	}

	// ============================================
	// 组参数学习（shrinkage + 慢学习）
	// ============================================

	/**
	 * 更新组参数（基于负载信号，使用 shrinkage）
	 *
	 * @param groupId 标签组 ID
	 * @param loadSignal 负载信号 L (0-1)
	 * @param priorityWeight 优先级权重 (0.5-1.5)
	 * @param settings 高级设置
	 */
	async updateGroupProfile(
		groupId: string,
		loadSignal: number,
		priorityWeight: number,
		settings: IRAdvancedScheduleSettings = DEFAULT_ADVANCED_SCHEDULE_SETTINGS
	): Promise<void> {
		// 检查是否启用学习
		if (settings.tagGroupLearningSpeed === "off") {
			return;
		}

		await this.initialize();
		const profile = await this.getProfile(groupId);

		// 学习速度对应的半衰期（天）
		const learningHalfLife: Record<string, number> = {
			slow: 90,
			medium: 45,
			fast: 20,
		};
		const halfLifeDays = learningHalfLife[settings.tagGroupLearningSpeed] || 90;

		// 计算目标 intervalFactorBase
		// L 高（更需要密集处理）→ A_target 更小
		const globalBase = 1.5;
		const beta = 0.8;
		const l0 = 0.5;
		const aTarget = Math.max(
			settings.intervalFactorClamp[0],
			Math.min(settings.intervalFactorClamp[1], globalBase * Math.exp(-beta * (loadSignal - l0)))
		);

		// 慢学习 EWMA
		const eta = 1 - 2 ** (-1 / halfLifeDays);
		const wNorm = (priorityWeight - 0.5) / 1.0; // 映射到 0-1
		const aRawNew = (1 - eta * wNorm) * profile.intervalFactorBase + eta * wNorm * aTarget;

		// Shrinkage: λ(n) = k / (k + n)
		const k = settings.shrinkageStrength;
		const n = profile.sampleCount;
		const lambda = k / (k + n);

		// 融合
		const aFinal = lambda * globalBase + (1 - lambda) * aRawNew;

		// Clamp
		const aFinalClamped = Math.max(
			settings.intervalFactorClamp[0],
			Math.min(settings.intervalFactorClamp[1], aFinal)
		);

		// 更新 profile
		profile.intervalFactorBase = aFinalClamped;
		profile.sampleCount = n + 1;

		// 记录历史（每次更新都记录，便于可视化）
		if (!profile.history) {
			profile.history = [];
		}
		profile.history.push({
			timestamp: new Date().toISOString(),
			value: aFinalClamped,
			sampleCount: n + 1,
		});
		// 保留最近 100 条记录
		if (profile.history.length > 100) {
			profile.history = profile.history.slice(-100);
		}

		await this.saveProfile(profile);

		logger.debug(
			`[IRTagGroupService] 更新组参数 ${groupId}: ` +
				`L=${loadSignal.toFixed(2)}, w=${priorityWeight.toFixed(2)}, ` +
				`A_target=${aTarget.toFixed(2)}, A_final=${aFinalClamped.toFixed(2)}, ` +
				`n=${n + 1}, λ=${lambda.toFixed(3)}`
		);
	}

	/**
	 * 获取组统计信息
	 */
	async getGroupStats(): Promise<
		Array<{
			group: IRTagGroup;
			profile: IRTagGroupProfile;
			documentCount: number;
		}>
	> {
		await this.initialize();

		const stats: Array<{
			group: IRTagGroup;
			profile: IRTagGroupProfile;
			documentCount: number;
		}> = [];

		// 统计每个组的文档数
		const groupDocCounts: Record<string, number> = {};
		for (const mapping of Object.values(this.documentMapCache)) {
			groupDocCounts[mapping.groupId] = (groupDocCounts[mapping.groupId] || 0) + 1;
		}

		for (const group of Object.values(this.groupsCache)) {
			stats.push({
				group,
				profile: await this.getProfile(group.id),
				documentCount: groupDocCounts[group.id] || 0,
			});
		}

		return stats;
	}
}
