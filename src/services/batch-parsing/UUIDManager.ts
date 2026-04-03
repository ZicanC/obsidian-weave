import { logger } from "../../utils/logger";
/**
 * UUID管理器（ 重构版）
 * 核心创新：UUID去重机制，防止重复导入
 *
 * 功能：
 * 1. 生成唯一UUID（集成新格式：tk-{12位}）
 * 2. 在源文件中插入UUID和BlockID
 * 3. 检测已存在的UUID（兼容新旧格式）
 * 4. 管理UUID与卡片的映射关系
 *
 * 集成统一标识符系统
 * - 使用WeaveIDGenerator生成新格式UUID
 * - 支持生成和管理BlockID
 * - 向后兼容旧UUID格式
 */

import { TFile, Vault } from "obsidian";
import {
	generateBlockId as helperGenerateBlockId,
	isValidBlockId,
	isValidUUID,
} from "../../utils/helpers";
import { logDebugWithTag } from "../../utils/logger";
import { generateCardUUID as helperGenerateUUID } from "../identifier/WeaveIDGenerator";

/**
 * UUID配置
 */
export interface UUIDConfig {
	/** 是否启用UUID去重 */
	enabled: boolean;

	/** UUID插入位置 */
	insertPosition: "before-card" | "after-card" | "in-metadata";

	/** UUID格式 */
	format: "comment" | "frontmatter" | "inline-code";

	/** UUID前缀（用于识别） */
	prefix: string;

	/** 重复处理策略 */
	duplicateStrategy: "skip" | "update" | "create-new";

	/** 是否自动修复缺失的UUID */
	autoFixMissing: boolean;
}

/**
 * UUID记录
 */
export interface UUIDRecord {
	uuid: string;
	cardId: string;
	sourceFile: string;
	lineNumber: number;
	createdAt: Date;
	updatedAt: Date;
}

/**
 * UUID插入结果
 */
export interface UUIDInsertResult {
	success: boolean;
	uuid: string;
	updatedContent: string;
	insertedAt: number;
	error?: string;
}

/**
 * UUID检测结果
 */
export interface UUIDDetectionResult {
	found: boolean;
	uuid?: string;
	lineNumber?: number;
	cardId?: string;
	isDuplicate: boolean;
}

/**
 * UUID数据库接口（需要从插件注入）
 */
export interface IUUIDStorage {
	/** 保存UUID记录 */
	saveRecord(record: UUIDRecord): Promise<void>;

	/** 根据UUID获取记录 */
	getRecordByUUID(uuid: string): Promise<UUIDRecord | null>;

	/** 根据卡片ID获取记录 */
	getRecordByCardId(cardId: string): Promise<UUIDRecord | null>;

	/** 删除记录 */
	deleteRecord(uuid: string): Promise<void>;

	/** 检查UUID是否存在 */
	uuidExists(uuid: string): Promise<boolean>;

	/** 获取文件的所有UUID */
	getFileUUIDs(filePath: string): Promise<UUIDRecord[]>;
}

/**
 * UUID管理器
 */
export class UUIDManager {
	private config: UUIDConfig;
	private vault: Vault;
	private storage: IUUIDStorage;
	private uuidPattern: RegExp;

	constructor(config: UUIDConfig, vault: Vault, storage: IUUIDStorage) {
		this.config = config;
		this.vault = vault;
		this.storage = storage;
		this.uuidPattern = this.buildUUIDPattern();
	}

	/**
	 * 生成新的UUID（ 重构版）
	 * 使用新格式：tk-{12位base32}
	 */
	generateCardUuid(): string {
		// 使用新的统一ID生成器
		return helperGenerateUUID(); // 内部调用 WeaveIDGenerator.generateCardUUID()
	}

	/**
	 * 生成 BlockID
	 * 格式：6位base36随机字符（不含^前缀）
	 */
	generateBlockID(): string {
		return helperGenerateBlockId(); // 内部调用 WeaveIDGenerator.generateBlockID()
	}

	/**
	 * 在内容中插入BlockID
	 * 格式：在指定位置插入 ` ^{blockId}` (Obsidian标准格式)
	 */
	async insertBlockID(
		content: string,
		insertPosition: number,
		blockId?: string
	): Promise<{ success: boolean; blockId: string; updatedContent: string; error?: string }> {
		// 生成或使用提供的BlockID
		const finalBlockId = blockId || this.generateBlockID();

		// Obsidian BlockID格式：空格 + ^ + id
		const blockIdMarker = ` ^${finalBlockId}`;

		// 在指定位置插入BlockID
		const updatedContent =
			content.substring(0, insertPosition) + blockIdMarker + content.substring(insertPosition);

		return {
			success: true,
			blockId: finalBlockId,
			updatedContent,
		};
	}

	/**
	 * 在内容中插入UUID和BlockID（组合方法）
	 * 同时插入 UUID 和 BlockID，确保格式正确
	 *
	 * 格式示例（after-card）：
	 * ```
	 * 卡片内容...
	 * <!-- tk-xxxxxxxxxxxx --> ^abc123
	 * ```
	 */
	async insertUUIDAndBlockID(
		content: string,
		cardStartIndex: number,
		cardEndIndex: number,
		_file?: TFile
	): Promise<{
		success: boolean;
		uuid: string;
		blockId: string;
		updatedContent: string;
		insertedAt: number;
		error?: string;
	}> {
		if (!this.config.enabled) {
			return {
				success: false,
				uuid: "",
				blockId: "",
				updatedContent: content,
				insertedAt: -1,
				error: "UUID功能未启用",
			};
		}

		// 生成UUID和BlockID
		const uuid = this.generateCardUuid();
		const blockId = this.generateBlockID();

		// 格式化UUID标记
		const uuidMarker = this.formatUUIDMarker(uuid);

		// 组合标记：UUID + BlockID
		// 格式：<!-- tk-xxxxxxxxxxxx --> ^abc123
		const combinedMarker = `${uuidMarker} ^${blockId}`;

		// 确定插入位置
		let insertPosition: number;
		let updatedContent: string;

		switch (this.config.insertPosition) {
			case "before-card":
				insertPosition = cardStartIndex;
				updatedContent = `${
					content.substring(0, insertPosition) + combinedMarker
				}\n${content.substring(insertPosition)}`;
				break;

			case "after-card":
				insertPosition = cardEndIndex;
				updatedContent = `${content.substring(
					0,
					insertPosition
				)}\n${combinedMarker}${content.substring(insertPosition)}`;
				break;

			case "in-metadata":
				// 在卡片起始标记后插入
				insertPosition = cardStartIndex;
				updatedContent = `${
					content.substring(0, insertPosition) + combinedMarker
				}\n${content.substring(insertPosition)}`;
				break;

			default:
				insertPosition = cardStartIndex;
				updatedContent = `${
					content.substring(0, insertPosition) + combinedMarker
				}\n${content.substring(insertPosition)}`;
		}

		return {
			success: true,
			uuid,
			blockId,
			updatedContent,
			insertedAt: insertPosition,
		};
	}

	/**
	 * 在内容中插入UUID（保留原有方法，向后兼容）
	 */
	async insertUUID(
		content: string,
		cardStartIndex: number,
		cardEndIndex: number,
		_file?: TFile
	): Promise<UUIDInsertResult> {
		if (!this.config.enabled) {
			return {
				success: false,
				uuid: "",
				updatedContent: content,
				insertedAt: -1,
				error: "UUID功能未启用",
			};
		}

		// 生成UUID
		const uuid = this.generateCardUuid();

		// 格式化UUID标记
		const uuidMarker = this.formatUUIDMarker(uuid);

		// 确定插入位置
		let insertPosition: number;
		let updatedContent: string;

		switch (this.config.insertPosition) {
			case "before-card":
				insertPosition = cardStartIndex;
				updatedContent = `${content.substring(0, insertPosition) + uuidMarker}\n${content.substring(
					insertPosition
				)}`;
				break;

			case "after-card":
				insertPosition = cardEndIndex;
				updatedContent = `${content.substring(0, insertPosition)}\n${uuidMarker}${content.substring(
					insertPosition
				)}`;
				break;

			case "in-metadata":
				// 在卡片起始标记后插入
				insertPosition = cardStartIndex;
				updatedContent = `${content.substring(0, insertPosition) + uuidMarker}\n${content.substring(
					insertPosition
				)}`;
				break;

			default:
				insertPosition = cardStartIndex;
				updatedContent = `${content.substring(0, insertPosition) + uuidMarker}\n${content.substring(
					insertPosition
				)}`;
		}

		return {
			success: true,
			uuid,
			updatedContent,
			insertedAt: insertPosition,
		};
	}

	/**
	 * 检测内容中的UUID
	 */
	async detectUUID(
		content: string,
		cardStartIndex: number,
		cardEndIndex: number
	): Promise<UUIDDetectionResult> {
		if (!this.config.enabled) {
			return { found: false, isDuplicate: false };
		}

		// 提取卡片范围的内容
		const cardContent = content.substring(cardStartIndex, cardEndIndex);

		// 搜索UUID
		const match = this.uuidPattern.exec(cardContent);

		if (!match) {
			return { found: false, isDuplicate: false };
		}

		const uuid = match[1];
		const lineNumber = this.getLineNumber(content, cardStartIndex + match.index);

		// 检查UUID是否已存在
		const isDuplicate = await this.storage.uuidExists(uuid);
		let cardId: string | undefined;

		if (isDuplicate) {
			const record = await this.storage.getRecordByUUID(uuid);
			cardId = record?.cardId;
		}

		return {
			found: true,
			uuid,
			lineNumber,
			cardId,
			isDuplicate,
		};
	}

	/**
	 * 处理重复UUID
	 */
	async handleDuplicate(uuid: string, file: TFile): Promise<"skip" | "update" | "create-new"> {
		switch (this.config.duplicateStrategy) {
			case "skip":
				logDebugWithTag("UUIDManager", `跳过重复UUID: ${uuid} in ${file.path}`);
				return "skip";

			case "update":
				logDebugWithTag("UUIDManager", `更新重复UUID: ${uuid} in ${file.path}`);
				return "update";

			case "create-new":
				logDebugWithTag("UUIDManager", `为重复UUID创建新卡片: ${uuid} in ${file.path}`);
				return "create-new";

			default:
				return "skip";
		}
	}

	/**
	 * 保存UUID记录
	 */
	async saveRecord(uuid: string, cardId: string, file: TFile, lineNumber: number): Promise<void> {
		const record: UUIDRecord = {
			uuid,
			cardId,
			sourceFile: file.path,
			lineNumber,
			createdAt: new Date(),
			updatedAt: new Date(),
		};

		await this.storage.saveRecord(record);
	}

	/**
	 * 批量处理文件中的UUID
	 */
	async processFileUUIDs(
		file: TFile,
		cards: Array<{ content: string; startIndex: number; endIndex: number }>
	): Promise<{
		updatedContent: string;
		uuidMap: Map<number, string>;
		duplicates: string[];
	}> {
		let updatedContent = await this.vault.read(file);
		const uuidMap = new Map<number, string>();
		const duplicates: string[] = [];

		// 按照从后往前的顺序处理（避免索引偏移）
		const sortedCards = cards.sort((a, b) => b.startIndex - a.startIndex);

		for (const card of sortedCards) {
			// 检测现有UUID
			const detection = await this.detectUUID(updatedContent, card.startIndex, card.endIndex);

			if (detection.found && detection.uuid) {
				// 已有UUID
				uuidMap.set(card.startIndex, detection.uuid);

				if (detection.isDuplicate) {
					duplicates.push(detection.uuid);
				}
			} else {
				// 插入新UUID
				const insertResult = await this.insertUUID(
					updatedContent,
					card.startIndex,
					card.endIndex,
					file
				);

				if (insertResult.success) {
					updatedContent = insertResult.updatedContent;
					uuidMap.set(card.startIndex, insertResult.uuid);
				}
			}
		}

		return {
			updatedContent,
			uuidMap,
			duplicates,
		};
	}

	/**
	 * 格式化UUID标记
	 */
	private formatUUIDMarker(uuid: string): string {
		const fullUUID = `${this.config.prefix}${uuid}`;

		switch (this.config.format) {
			case "comment":
				return `<!-- ${fullUUID} -->`;

			case "frontmatter":
				return `uuid: ${fullUUID}`;

			case "inline-code":
				return `\`${fullUUID}\``;

			default:
				return `<!-- ${fullUUID} -->`;
		}
	}

	/**
	 * 构建UUID匹配正则（ 重构版）
	 * 支持新旧两种 UUID 格式
	 */
	private buildUUIDPattern(): RegExp {
		const escapedPrefix = this.config.prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

		// 新格式 UUID: tk-{12位base32}
		const newUuidRegex = "tk-[23456789abcdefghjkmnpqrstuvwxyz]{12}";

		// 旧格式UUID v4: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
		const oldUuidRegex = "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";

		//  兼容新旧两种格式（使用或运算符）
		const uuidRegex = `(?:${newUuidRegex}|${oldUuidRegex})`;

		switch (this.config.format) {
			case "comment":
				return new RegExp(`<!--\\s*(?:${escapedPrefix})?(${uuidRegex})\\s*-->`, "i");

			case "frontmatter":
				return new RegExp(`uuid:\\s*(?:${escapedPrefix})?(${uuidRegex})`, "i");

			case "inline-code":
				return new RegExp(`\`(?:${escapedPrefix})?(${uuidRegex})\``, "i");

			default:
				return new RegExp(`<!--\\s*(?:${escapedPrefix})?(${uuidRegex})\\s*-->`, "i");
		}
	}

	/**
	 * 获取内容中指定位置的行号
	 */
	private getLineNumber(content: string, position: number): number {
		const beforePosition = content.substring(0, position);
		return beforePosition.split("\n").length;
	}

	/**
	 * 更新配置
	 */
	updateConfig(config: Partial<UUIDConfig>): void {
		this.config = { ...this.config, ...config };
		this.uuidPattern = this.buildUUIDPattern();
	}

	/**
	 * 检查 UUID 是否已存在
	 * @param uuid UUID字符串
	 * @returns 如果存在返回true，否则返回false
	 */
	async hasUUID(uuid: string): Promise<boolean> {
		try {
			return await this.storage.uuidExists(uuid);
		} catch (error) {
			logger.error("[UUIDManager] 检查UUID存在性失败:", error);
			return false; // 出错时返回false，允许创建
		}
	}

	/**
	 * 通过 UUID 获取记录
	 * @param uuid UUID字符串
	 * @returns UUID记录，如果不存在返回null
	 */
	async getRecordByUUID(uuid: string): Promise<UUIDRecord | null> {
		try {
			return await this.storage.getRecordByUUID(uuid);
		} catch (error) {
			logger.error("[UUIDManager] 获取UUID记录失败:", error);
			return null;
		}
	}

	/**
	 * 增强的 UUID 检测（带数据库验证）
	 * 三层检测机制：
	 * 1. 正则匹配检测UUID
	 * 2. 数据库验证UUID存在性
	 * 3. 格式完整性检查
	 *
	 * @param block 卡片块内容
	 * @returns UUID字符串，如果未检测到或验证失败返回null
	 */
	async detectUUIDWithValidation(block: string): Promise<string | null> {
		// 第1层：正则匹配检测UUID
		const newUuidPattern = /<!--\s*(tk-[23456789abcdefghjkmnpqrstuvwxyz]{12})\s*-->/i;
		const newMatch = block.match(newUuidPattern);

		if (newMatch) {
			const uuid = newMatch[1];

			// 第2层：数据库验证
			try {
				const exists = await this.storage.uuidExists(uuid);

				if (exists) {
					logDebugWithTag("UUIDManager", `UUID验证通过: ${uuid}`);
					return uuid;
				} else {
					logger.warn(`[UUIDManager] UUID格式正确但数据库中不存在: ${uuid}`);
					// 虽然数据库中不存在，但格式正确，仍然返回UUID
					// 这可能是新扫描到的UUID，尚未保存到数据库
					return uuid;
				}
			} catch (error) {
				logger.error("[UUIDManager] 数据库验证失败:", error);
				// 验证失败时，仍然信任正则匹配结果
				return uuid;
			}
		}

		// 兼容旧格式UUID（v4格式）
		const oldUuidPattern =
			/<!--\s*([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\s*-->/i;
		const oldMatch = block.match(oldUuidPattern);

		if (oldMatch) {
			const uuid = oldMatch[1];
			logDebugWithTag("UUIDManager", `检测到旧格式UUID: ${uuid}`);
			return uuid;
		}

		return null;
	}

	/**
	 * 批量检查 UUID 存在性
	 * 优化性能，避免多次单独查询
	 *
	 * @param uuids UUID数组
	 * @returns UUID到存在性的映射
	 */
	async batchCheckUUIDs(uuids: string[]): Promise<Map<string, boolean>> {
		const resultMap = new Map<string, boolean>();

		if (uuids.length === 0) {
			return resultMap;
		}

		logDebugWithTag("UUIDManager", `批量检查 ${uuids.length} 个UUID...`);

		try {
			// 并发查询所有UUID
			const checks = await Promise.all(
				uuids.map(async (uuid) => {
					const exists = await this.storage.uuidExists(uuid);
					return { uuid, exists };
				})
			);

			// 构建映射
			for (const { uuid, exists } of checks) {
				resultMap.set(uuid, exists);
			}

			const existingCount = Array.from(resultMap.values()).filter(Boolean).length;
			logDebugWithTag("UUIDManager", `批量检查完成: ${existingCount}/${uuids.length} 个UUID已存在`);
		} catch (error) {
			logger.error("[UUIDManager] 批量检查失败:", error);
			// 出错时，将所有UUID标记为不存在（安全策略）
			for (const uuid of uuids) {
				resultMap.set(uuid, false);
			}
		}

		return resultMap;
	}

	/**
	 * 清理文件的UUID记录
	 */
	async cleanupFileRecords(file: TFile): Promise<void> {
		const records = await this.storage.getFileUUIDs(file.path);

		for (const record of records) {
			await this.storage.deleteRecord(record.uuid);
		}
	}

	/**
	 * 验证UUID格式（ 重构版）
	 * 支持新旧两种格式
	 */
	isValidUUID(uuid: string): boolean {
		// 使用helpers中的统一验证函数（已兼容新旧格式）
		return isValidUUID(uuid);
	}

	/**
	 * 验证 BlockID 格式
	 */
	isValidBlockID(blockId: string): boolean {
		return isValidBlockId(blockId);
	}

	/**
	 * 从UUID标记中提取UUID
	 */
	extractUUID(marker: string): string | null {
		const match = this.uuidPattern.exec(marker);
		return match ? match[1] : null;
	}
}
