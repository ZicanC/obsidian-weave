import type { App } from "obsidian";
import { normalizePath } from "obsidian";
import { getV2PathsFromApp } from "../../config/paths";
import type { IRBlockMeta, IRBlockStats, IRBlockStatus, IRBlockV4 } from "../../types/ir-types";
import { DEFAULT_IR_BLOCK_META, DEFAULT_IR_BLOCK_STATS } from "../../types/ir-types";
import {
	getTaskTopicId,
	normalizeBookmarkTaskForRuntime,
	serializeBookmarkTaskForStorage,
} from "../../utils/ir-topic-compat";
import { logger } from "../../utils/logger";

/**
 * EPUB 书签 IR 任务
 * 每个任务对应 EPUB 目录中的一个条目（章节/节），参与 IR 调度队列
 */
export interface IREpubBookmarkTask {
	id: string;
	topicId?: string;
	deckId: string;
	/** EPUB 文件在 Vault 中的路径 */
	epubFilePath: string;
	/** TOC 条目标题 */
	title: string;
	/** TOC 条目的 href（用于导航跳转） */
	tocHref: string;
	/** TOC 层级深度（0=顶层章节，1=节，2=小节...） */
	tocLevel: number;
	/** 续读点 CFI（用户手动标记的阅读位置） */
	resumeCfi?: string;
	/** 续读点更新时间 */
	resumeUpdatedAt?: number;

	status: IRBlockStatus;
	priorityUi: number;
	priorityEff: number;
	intervalDays: number;
	nextRepDate: number;
	stats: IRBlockStats;
	meta: IRBlockMeta;
	tags: string[];
	createdAt: number;
	updatedAt: number;
}

interface IREpubBookmarkTaskStore {
	version: number;
	tasks: Record<string, IREpubBookmarkTask>;
}

const DEFAULT_STORE: IREpubBookmarkTaskStore = {
	version: 1,
	tasks: {},
};

export function isEpubBookmarkTaskId(id: string): boolean {
	return typeof id === "string" && id.startsWith("epubbm-");
}

function generateEpubBookmarkTaskId(): string {
	return `epubbm-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export class IREpubBookmarkTaskService {
	private app: App;
	private initialized = false;
	private filePath: string;

	constructor(app: App) {
		this.app = app;
		const storageDir = getV2PathsFromApp(app as any).ir.root;
		this.filePath = normalizePath(`${storageDir}/epub-bookmark-tasks.json`);
	}

	async initialize(): Promise<void> {
		if (this.initialized) return;
		const adapter = this.app.vault.adapter;

		logger.info("[IREpubBookmarkTaskService] init:", { filePath: this.filePath });

		const ensureDir = async (dirPath: string): Promise<void> => {
			const normalized = normalizePath(dirPath);
			const parts = normalized.split("/").filter(Boolean);
			let current = "";
			for (const part of parts) {
				current = current ? `${current}/${part}` : part;
				try {
					if (!(await adapter.exists(current))) {
						await adapter.mkdir(current);
					}
				} catch {
					// ignore
				}
			}
		};

		const parts = this.filePath.split("/");
		parts.pop();
		const dir = parts.join("/");
		try {
			await ensureDir(dir);
		} catch {}

		try {
			if (!(await adapter.exists(this.filePath))) {
				await adapter.write(this.filePath, JSON.stringify(DEFAULT_STORE));
				logger.info("[IREpubBookmarkTaskService] storage file created:", {
					filePath: this.filePath,
				});
			}
		} catch (e) {
			logger.warn("[IREpubBookmarkTaskService] init failed:", e);
		}

		this.initialized = true;
	}

	private async readStore(): Promise<IREpubBookmarkTaskStore> {
		await this.initialize();
		const adapter = this.app.vault.adapter;

		try {
			if (!(await adapter.exists(this.filePath))) {
				return { ...DEFAULT_STORE };
			}
			const content = await adapter.read(this.filePath);
			const parsed = JSON.parse(content) as IREpubBookmarkTaskStore;
			if (!parsed || typeof parsed !== "object") return { ...DEFAULT_STORE };
			const tasks = (parsed as any).tasks;
			if (!tasks || typeof tasks !== "object") return { version: 1, tasks: {} };
			return {
				version: typeof (parsed as any).version === "number" ? (parsed as any).version : 1,
				tasks: Object.fromEntries(
					Object.entries(tasks as Record<string, IREpubBookmarkTask>).map(([id, task]) => [
						id,
						normalizeBookmarkTaskForRuntime(task),
					])
				),
			};
		} catch (e) {
			logger.warn("[IREpubBookmarkTaskService] read failed:", e);
			return { ...DEFAULT_STORE };
		}
	}

	private async writeStore(store: IREpubBookmarkTaskStore): Promise<void> {
		await this.initialize();
		const adapter = this.app.vault.adapter;
		const serializedStore: IREpubBookmarkTaskStore = {
			version: store.version,
			tasks: Object.fromEntries(
				Object.entries(store.tasks || {}).map(([id, task]) => [
					id,
					serializeBookmarkTaskForStorage(task),
				])
			),
		};
		await adapter.write(this.filePath, JSON.stringify(serializedStore));
		logger.debug("[IREpubBookmarkTaskService] written:", {
			filePath: this.filePath,
			count: Object.keys(store.tasks || {}).length,
		});
	}

	async getTask(id: string): Promise<IREpubBookmarkTask | null> {
		const store = await this.readStore();
		return store.tasks[id] || null;
	}

	async getAllTasks(): Promise<IREpubBookmarkTask[]> {
		const store = await this.readStore();
		return Object.values(store.tasks);
	}

	async getTasksByDeck(deckId: string): Promise<IREpubBookmarkTask[]> {
		const store = await this.readStore();
		return Object.values(store.tasks).filter((t) => getTaskTopicId(t) === deckId);
	}

	async getTasksByEpub(epubFilePath: string): Promise<IREpubBookmarkTask[]> {
		const store = await this.readStore();
		return Object.values(store.tasks).filter((t) => t.epubFilePath === epubFilePath);
	}

	async updateEpubFileReferences(oldPath: string, newPath: string): Promise<number> {
		const normalizedOldPath = normalizePath(oldPath || "");
		const normalizedNewPath = normalizePath(newPath || "");
		if (!normalizedOldPath || !normalizedNewPath || normalizedOldPath === normalizedNewPath) {
			return 0;
		}

		const store = await this.readStore();
		let updated = 0;
		let changed = false;

		for (const task of Object.values(store.tasks)) {
			const remapped = this.remapPath(task.epubFilePath, normalizedOldPath, normalizedNewPath);
			if (!remapped || remapped === task.epubFilePath) {
				continue;
			}

			task.epubFilePath = remapped;
			task.updatedAt = Date.now();
			updated += 1;
			changed = true;
		}

		if (changed) {
			await this.writeStore(store);
		}

		return updated;
	}

	async createTask(input: {
		topicId?: string;
		deckId?: string;
		epubFilePath: string;
		title: string;
		tocHref: string;
		tocLevel: number;
		priorityUi?: number;
	}): Promise<IREpubBookmarkTask> {
		const store = await this.readStore();

		const now = Date.now();
		const id = generateEpubBookmarkTaskId();
		const priorityUi = typeof input.priorityUi === "number" ? input.priorityUi : 5;

		const topicId = getTaskTopicId(input);
		if (!topicId) {
			throw new Error("EPUB 书签任务缺少专题 ID");
		}

		const task: IREpubBookmarkTask = {
			id,
			topicId,
			deckId: topicId,
			epubFilePath: input.epubFilePath,
			title: input.title,
			tocHref: input.tocHref,
			tocLevel: input.tocLevel,
			status: "new",
			priorityUi,
			priorityEff: priorityUi,
			intervalDays: 0,
			nextRepDate: 0,
			stats: { ...DEFAULT_IR_BLOCK_STATS },
			meta: { ...DEFAULT_IR_BLOCK_META, siblings: { prev: null, next: null } },
			tags: [],
			createdAt: now,
			updatedAt: now,
		};

		store.tasks[id] = task;
		await this.writeStore(store);

		return task;
	}

	/**
	 * Batch create tasks from EPUB TOC items.
	 * Sets up sibling chain (prev/next) for navigation context.
	 */
	async batchCreateTasks(
		inputs: Array<{
			topicId?: string;
			deckId?: string;
			epubFilePath: string;
			title: string;
			tocHref: string;
			tocLevel: number;
			priorityUi?: number;
			nextRepDate?: number;
		}>
	): Promise<IREpubBookmarkTask[]> {
		if (inputs.length === 0) return [];

		const store = await this.readStore();
		const now = Date.now();
		const created: IREpubBookmarkTask[] = [];

		for (const input of inputs) {
			const id = generateEpubBookmarkTaskId();
			const priorityUi = typeof input.priorityUi === "number" ? input.priorityUi : 5;

			const topicId = getTaskTopicId(input);
			if (!topicId) {
				throw new Error("EPUB 书签任务缺少专题 ID");
			}

			const task: IREpubBookmarkTask = {
				id,
				topicId,
				deckId: topicId,
				epubFilePath: input.epubFilePath,
				title: input.title,
				tocHref: input.tocHref,
				tocLevel: input.tocLevel,
				status: input.nextRepDate ? "queued" : "new",
				priorityUi,
				priorityEff: priorityUi,
				intervalDays: input.nextRepDate ? 1 : 0,
				nextRepDate: input.nextRepDate || 0,
				stats: { ...DEFAULT_IR_BLOCK_STATS },
				meta: { ...DEFAULT_IR_BLOCK_META, siblings: { prev: null, next: null } },
				tags: [],
				createdAt: now,
				updatedAt: now,
			};

			store.tasks[id] = task;
			created.push(task);
		}

		// Set up sibling chain
		for (let i = 0; i < created.length; i++) {
			const task = created[i];
			task.meta.siblings = {
				prev: i > 0 ? created[i - 1].id : null,
				next: i < created.length - 1 ? created[i + 1].id : null,
			};
			store.tasks[task.id] = task;
		}

		await this.writeStore(store);
		logger.info("[IREpubBookmarkTaskService] batch created:", {
			count: created.length,
			topicId: getTaskTopicId(inputs[0]),
		});

		return created;
	}

	async updateTask(
		id: string,
		updates: Partial<Omit<IREpubBookmarkTask, "id" | "createdAt">>
	): Promise<IREpubBookmarkTask | null> {
		const store = await this.readStore();
		const existing = store.tasks[id];
		if (!existing) return null;

		const updated: IREpubBookmarkTask = {
			...existing,
			...updates,
			meta: (updates as any).meta ? (updates as any).meta : existing.meta,
			stats: (updates as any).stats ? (updates as any).stats : existing.stats,
			updatedAt: Date.now(),
		};

		store.tasks[id] = updated;
		await this.writeStore(store);

		return updated;
	}

	/**
	 * Update task scheduling data from IRBlockV4 (after IR session completion)
	 */
	async updateTaskFromBlock(
		block: IRBlockV4 & { epubBookmarkHref?: string; epubBookmarkTitle?: string }
	): Promise<void> {
		if (!isEpubBookmarkTaskId(block.id)) return;

		const store = await this.readStore();
		const existing = store.tasks[block.id];
		if (!existing) return;

		store.tasks[block.id] = {
			...existing,
			status: block.status,
			priorityUi: block.priorityUi,
			priorityEff: block.priorityEff,
			intervalDays: block.intervalDays,
			nextRepDate: block.nextRepDate,
			stats: block.stats,
			meta: block.meta,
			tags: Array.isArray(block.tags) ? block.tags : existing.tags || [],
			updatedAt: Date.now(),
		};

		await this.writeStore(store);
	}

	/**
	 * Set or update the resume point (CFI) for a task
	 */
	async setResumePoint(taskId: string, cfi: string): Promise<void> {
		const store = await this.readStore();
		const existing = store.tasks[taskId];
		if (!existing) return;

		existing.resumeCfi = cfi;
		existing.resumeUpdatedAt = Date.now();
		existing.updatedAt = Date.now();
		store.tasks[taskId] = existing;

		await this.writeStore(store);
		logger.debug("[IREpubBookmarkTaskService] resume point set:", { taskId, cfi });
	}

	/**
	 * Clear the resume point for a task
	 */
	async clearResumePoint(taskId: string): Promise<void> {
		const store = await this.readStore();
		const existing = store.tasks[taskId];
		if (!existing) return;

		existing.resumeCfi = undefined;
		existing.resumeUpdatedAt = undefined;
		existing.updatedAt = Date.now();
		store.tasks[taskId] = existing;

		await this.writeStore(store);
	}

	async recordTaskInteraction(
		taskId: string,
		readingTimeSec: number,
		actions: { extracts?: number; cardsCreated?: number; notesWritten?: number } = {}
	): Promise<void> {
		const store = await this.readStore();
		const existing = store.tasks[taskId];
		if (!existing) return;

		const stats = existing.stats;
		stats.impressions++;
		stats.totalReadingTimeSec += readingTimeSec;
		stats.effectiveReadingTimeSec += Math.min(readingTimeSec, 600);
		stats.extracts += actions.extracts || 0;
		stats.cardsCreated += actions.cardsCreated || 0;
		stats.notesWritten += actions.notesWritten || 0;
		stats.lastInteraction = Date.now();
		stats.lastShownAt = Date.now();

		const todayStr = new Date().toISOString().slice(0, 10);
		if (stats.todayShownDate === todayStr) {
			stats.todayShownCount = (stats.todayShownCount || 0) + 1;
		} else {
			stats.todayShownDate = todayStr;
			stats.todayShownCount = 1;
		}

		store.tasks[taskId] = {
			...existing,
			stats,
			updatedAt: Date.now(),
		};

		await this.writeStore(store);
	}

	async deleteTask(id: string): Promise<boolean> {
		const store = await this.readStore();
		if (!store.tasks[id]) return false;
		delete store.tasks[id];
		await this.writeStore(store);
		logger.info("[IREpubBookmarkTaskService] task deleted:", id);
		return true;
	}

	async deleteTasksByDeck(deckId: string): Promise<number> {
		return this.deleteTasksByDeckIdentifiers([deckId]);
	}

	async deleteTasksByDeckIdentifiers(deckIds: string[]): Promise<number> {
		const identifiers = this.toNormalizedSet(deckIds);
		return this.deleteTasksByPredicate(
			(task) => identifiers.has(String(getTaskTopicId(task) || "").trim()),
			"[IREpubBookmarkTaskService] tasks deleted by deck identifiers:",
			{ deckIds: Array.from(identifiers) }
		);
	}

	async deleteTasksByEpubPaths(epubFilePaths: string[]): Promise<number> {
		const paths = this.toNormalizedSet(epubFilePaths);
		return this.deleteTasksByPredicate(
			(task) => paths.has(String(task?.epubFilePath || "").trim()),
			"[IREpubBookmarkTaskService] tasks deleted by epub paths:",
			{ epubFilePaths: Array.from(paths) }
		);
	}

	private toNormalizedSet(values: string[]): Set<string> {
		return new Set(
			(Array.isArray(values) ? values : [])
				.map((value) => String(value || "").trim())
				.filter(Boolean)
		);
	}

	private remapPath(filePath: string, oldPath: string, newPath: string): string | null {
		const normalizedFilePath = normalizePath(filePath || "");
		if (!normalizedFilePath) {
			return null;
		}

		if (normalizedFilePath === oldPath) {
			return newPath;
		}

		if (normalizedFilePath.startsWith(`${oldPath}/`)) {
			return `${newPath}${normalizedFilePath.slice(oldPath.length)}`;
		}

		return null;
	}

	private async deleteTasksByPredicate(
		predicate: (task: IREpubBookmarkTask) => boolean,
		logMessage: string,
		logMeta: Record<string, unknown>
	): Promise<number> {
		const store = await this.readStore();
		const toDelete = Object.entries(store.tasks)
			.filter(([, task]) => predicate(task))
			.map(([id]) => id);

		if (toDelete.length === 0) {
			return 0;
		}

		for (const id of toDelete) {
			delete store.tasks[id];
		}

		await this.writeStore(store);
		logger.info(logMessage, {
			...logMeta,
			count: toDelete.length,
		});

		return toDelete.length;
	}

	/**
	 * Convert task to IRBlockV4 for IR scheduling integration
	 */
	toBlockV4(task: IREpubBookmarkTask): IRBlockV4 {
		const block: IRBlockV4 = {
			id: task.id,
			sourcePath: task.epubFilePath,
			blockId: task.id,
			contentHash: "",
			status: task.status,
			priorityUi: task.priorityUi,
			priorityEff: task.priorityEff,
			intervalDays: task.intervalDays,
			nextRepDate: task.nextRepDate,
			stats: task.stats,
			meta: task.meta,
			tags: task.tags || [],
			createdAt: task.createdAt,
			updatedAt: task.updatedAt,
		};

		(block as any).contentPreview = task.title;
		(block as any).epubBookmarkHref = task.tocHref;
		(block as any).epubBookmarkTitle = task.title;
		(block as any).epubBookmarkLevel = task.tocLevel;
		(block as any).epubBookmarkResumeCfi = task.resumeCfi;

		return block;
	}
}
