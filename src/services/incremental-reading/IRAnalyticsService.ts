import type { App } from "obsidian";
import type {
	IRBlockStats,
	IRChunkFileData,
	IRSession,
	IRSourceFileMeta,
} from "../../types/ir-types";
import { type IREpubBookmarkTask, IREpubBookmarkTaskService } from "./IREpubBookmarkTaskService";
import { IRMonitoringService } from "./IRMonitoringService";
import { type IRPdfBookmarkTask, IRPdfBookmarkTaskService } from "./IRPdfBookmarkTaskService";
import {
	type IRPlannedDay,
	type IRPlannedScheduleItem,
	IRScheduleKernel,
} from "./IRScheduleKernel";
import { IRStorageService } from "./IRStorageService";

export type IRAnalyticsSourceKind = "document" | "pdf" | "epub" | "other";

export interface IRAnalyticsSourceOption {
	key: string;
	label: string;
	subtitle: string;
	kind: IRAnalyticsSourceKind;
	itemCount: number;
	activeCount: number;
	dueCount: number;
	overdueCount: number;
	totalReadingHours: number;
	avgPriority: number;
}

export interface IRAnalyticsOverview {
	totalItems: number;
	activeItems: number;
	dueToday: number;
	overdueItems: number;
	totalReadingHours: number;
	avgPriority: number;
	cardsCreated: number;
	extracts: number;
	notesWritten: number;
}

export interface IRAnalyticsActivityPoint {
	dateKey: string;
	label: string;
	createdCount: number;
	interactedCount: number;
	completedCount: number;
}

export interface IRAnalyticsQuantityPoint {
	dateKey: string;
	label: string;
	totalCount: number;
	activeCount: number;
	closedCount: number;
}

export interface IRAnalyticsTimingBucket {
	label: string;
	count: number;
}

export interface IRAnalyticsScatterPoint {
	label: string;
	x: number;
	y: number;
	size: number;
	itemCount: number;
	readingHours: number;
	cardsCreated: number;
	extracts: number;
	notesWritten: number;
}

export interface IRAnalyticsForecastPoint {
	dateKey: string;
	label: string;
	itemCount: number;
	totalEstimatedMinutes: number;
	overloadLevel: "normal" | "warning" | "overloaded";
}

export interface IRAnalyticsMonitoringSummary {
	dailyReadingMinutes: number;
	dailyScheduled: number;
	dailyCompleted: number;
	linkedOutcomeRate: number;
}

export interface IRAnalyticsSnapshot {
	scopeKey: string | null;
	scopeLabel: string;
	sources: IRAnalyticsSourceOption[];
	overview: IRAnalyticsOverview;
	activityTrend: IRAnalyticsActivityPoint[];
	quantityTrend: IRAnalyticsQuantityPoint[];
	timingBuckets: IRAnalyticsTimingBucket[];
	difficultyScatter: IRAnalyticsScatterPoint[];
	forecast: IRAnalyticsForecastPoint[];
	monitoringSummary: IRAnalyticsMonitoringSummary | null;
}

interface IRAnalyticsUnit {
	id: string;
	title: string;
	sourceKey: string;
	sourceLabel: string;
	sourceSubtitle: string;
	sourceKind: IRAnalyticsSourceKind;
	sourceType: "chunk" | "pdf" | "epub";
	status: string;
	priorityUi: number;
	priorityEff: number;
	intervalDays: number;
	nextRepDate: number;
	createdAt: number;
	updatedAt: number;
	doneAt: number;
	stats: IRBlockStats;
}

interface AnalyticsDatePoint {
	dateKey: string;
	label: string;
	startMs: number;
	endMs: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const CLOSED_STATUSES = new Set(["done", "suspended", "removed"]);

function formatDateKeyFromMs(ms: number): string {
	const date = new Date(ms);
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
		date.getDate()
	).padStart(2, "0")}`;
}

function buildRecentDatePoints(days: number): AnalyticsDatePoint[] {
	const safeDays = Math.max(1, days);
	const today = new Date();
	today.setHours(0, 0, 0, 0);
	const points: AnalyticsDatePoint[] = [];

	for (let i = safeDays - 1; i >= 0; i--) {
		const start = today.getTime() - i * DAY_MS;
		const end = start + DAY_MS - 1;
		const date = new Date(start);
		points.push({
			dateKey: formatDateKeyFromMs(start),
			label: `${date.getMonth() + 1}/${date.getDate()}`,
			startMs: start,
			endMs: end,
		});
	}

	return points;
}

function getPathBaseName(path: string): string {
	const normalized = String(path || "").replace(/\\/g, "/");
	const base = normalized.split("/").pop() || normalized;
	return base || "未命名";
}

function stripExtension(name: string): string {
	return String(name || "").replace(/\.[^.]+$/i, "");
}

function classifySourceKind(path: string): IRAnalyticsSourceKind {
	const lower = String(path || "").toLowerCase();
	if (lower.endsWith(".pdf")) return "pdf";
	if (lower.endsWith(".epub")) return "epub";
	if (lower.endsWith(".md") || lower.endsWith(".markdown") || lower.endsWith(".txt"))
		return "document";
	return "other";
}

function isClosedStatus(status: string): boolean {
	return CLOSED_STATUSES.has(String(status || "").toLowerCase());
}

function toCloseTimestamp(unit: IRAnalyticsUnit): number {
	if (unit.doneAt > 0) return unit.doneAt;
	return isClosedStatus(unit.status) ? unit.updatedAt : 0;
}

function average(values: number[]): number {
	if (!values.length) return 0;
	return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value: number, digits = 1): number {
	const factor = 10 ** digits;
	return Math.round(value * factor) / factor;
}

function truncateLabel(label: string, max: number): string {
	if (label.length <= max) return label;
	return `${label.slice(0, Math.max(1, max - 1))}…`;
}

function estimateReadingHours(stats: IRBlockStats): number {
	return (stats.totalReadingTimeSec || 0) / 3600;
}

function buildSessionSecondsByBlockId(sessions: IRSession[]): Map<string, number> {
	const totals = new Map<string, number>();
	for (const session of sessions || []) {
		const blockId = String(session?.blockId || "");
		const duration = Number(session?.duration || 0);
		if (!blockId || duration <= 0) continue;
		totals.set(blockId, (totals.get(blockId) || 0) + duration);
	}
	return totals;
}

function getReadingHoursForUnit(
	unit: IRAnalyticsUnit,
	sessionSecondsByBlockId: Map<string, number>
): number {
	if (sessionSecondsByBlockId.has(unit.id)) {
		return (sessionSecondsByBlockId.get(unit.id) || 0) / 3600;
	}
	return estimateReadingHours(unit.stats);
}

function estimatePriority(unit: IRAnalyticsUnit): number {
	return typeof unit.priorityUi === "number" ? unit.priorityUi : unit.priorityEff;
}

export class IRAnalyticsService {
	private readonly storage: IRStorageService;
	private readonly pdfService: IRPdfBookmarkTaskService;
	private readonly epubService: IREpubBookmarkTaskService;
	private readonly monitoringService: IRMonitoringService;
	private readonly scheduleKernel: IRScheduleKernel;

	constructor(private readonly app: App) {
		this.storage = new IRStorageService(app);
		this.pdfService = new IRPdfBookmarkTaskService(app);
		this.epubService = new IREpubBookmarkTaskService(app);
		this.monitoringService = new IRMonitoringService(app.vault);
		this.scheduleKernel = new IRScheduleKernel(app);
	}

	async initialize(): Promise<void> {
		await this.storage.initialize();
		await this.pdfService.initialize();
		await this.epubService.initialize();
		await this.monitoringService.load();
	}

	async getSnapshot(options?: { sourceKey?: string; days?: number }): Promise<IRAnalyticsSnapshot> {
		await this.initialize();

		const days = Math.max(7, options?.days ?? 30);
		const [sourcesMap, chunksMap, pdfTasks, epubTasks, schedule, history] = await Promise.all([
			this.storage.getAllSources(),
			this.storage.getAllChunkDataWithSync(),
			this.pdfService.getAllTasks(),
			this.epubService.getAllTasks(),
			this.scheduleKernel.recomputeScheduleForDeck("ui_refresh"),
			this.storage.getHistory(),
		]);

		const sourceInfoByKey = new Map<
			string,
			{ label: string; subtitle: string; kind: IRAnalyticsSourceKind }
		>();
		const units = this.buildUnits({
			sourcesMap,
			chunks: Object.values(chunksMap || {}),
			pdfTasks,
			epubTasks,
			sourceInfoByKey,
		});

		const sessionSecondsByBlockId = buildSessionSecondsByBlockId(history.sessions || []);
		const sources = this.buildSourceOptions(units, sourceInfoByKey, sessionSecondsByBlockId);
		const resolvedSourceKey =
			options?.sourceKey && sources.some((source) => source.key === options.sourceKey)
				? options.sourceKey
				: undefined;
		const filteredUnits = resolvedSourceKey
			? units.filter((unit) => unit.sourceKey === resolvedSourceKey)
			: units;

		const sourceKeyByUnitId = new Map<string, string>();
		for (const unit of units) {
			sourceKeyByUnitId.set(unit.id, unit.sourceKey);
		}

		const forecast = this.buildForecast(schedule.days, sourceKeyByUnitId, resolvedSourceKey);

		return {
			scopeKey: resolvedSourceKey ?? null,
			scopeLabel: resolvedSourceKey
				? sources.find((source) => source.key === resolvedSourceKey)?.label || "单体数据源"
				: "总体数据源",
			sources,
			overview: this.buildOverview(filteredUnits, sessionSecondsByBlockId),
			activityTrend: this.buildActivityTrend(filteredUnits, days),
			quantityTrend: this.buildQuantityTrend(filteredUnits, days),
			timingBuckets: this.buildTimingBuckets(filteredUnits),
			difficultyScatter: this.buildDifficultyScatter(
				filteredUnits,
				sources,
				sessionSecondsByBlockId,
				resolvedSourceKey
			),
			forecast,
			monitoringSummary: resolvedSourceKey ? null : this.buildMonitoringSummary(),
		};
	}

	private buildUnits(input: {
		sourcesMap: Record<string, IRSourceFileMeta>;
		chunks: IRChunkFileData[];
		pdfTasks: IRPdfBookmarkTask[];
		epubTasks: IREpubBookmarkTask[];
		sourceInfoByKey: Map<string, { label: string; subtitle: string; kind: IRAnalyticsSourceKind }>;
	}): IRAnalyticsUnit[] {
		const units: IRAnalyticsUnit[] = [];

		for (const chunk of input.chunks) {
			const sourceMeta = chunk.sourceId ? input.sourcesMap[chunk.sourceId] : undefined;
			const sourcePath = sourceMeta?.originalPath || chunk.filePath;
			const sourceKey = sourceMeta ? `source:${sourceMeta.sourceId}` : `path:${chunk.filePath}`;
			const sourceLabel = sourceMeta?.title || stripExtension(getPathBaseName(sourcePath));
			const sourceSubtitle = sourcePath || chunk.filePath;
			const sourceKind = classifySourceKind(sourcePath);

			input.sourceInfoByKey.set(sourceKey, {
				label: sourceLabel,
				subtitle: sourceSubtitle,
				kind: sourceKind,
			});

			units.push({
				id: chunk.chunkId,
				title: stripExtension(getPathBaseName(chunk.filePath)),
				sourceKey,
				sourceLabel,
				sourceSubtitle,
				sourceKind,
				sourceType: "chunk",
				status: String(chunk.scheduleStatus || "new"),
				priorityUi: Number(chunk.priorityUi ?? chunk.priorityEff ?? 5),
				priorityEff: Number(chunk.priorityEff ?? chunk.priorityUi ?? 5),
				intervalDays: Number(chunk.intervalDays ?? 0),
				nextRepDate: Number(chunk.nextRepDate ?? 0),
				createdAt: Number(chunk.createdAt ?? 0),
				updatedAt: Number(chunk.updatedAt ?? 0),
				doneAt: Number(chunk.doneAt ?? 0),
				stats: { ...(chunk.stats || {}) },
			});
		}

		for (const task of input.pdfTasks) {
			const sourceKey = `pdf:${task.pdfPath}`;
			const sourceLabel = stripExtension(getPathBaseName(task.pdfPath));
			input.sourceInfoByKey.set(sourceKey, {
				label: sourceLabel,
				subtitle: task.pdfPath,
				kind: "pdf",
			});

			units.push({
				id: task.id,
				title: task.title || sourceLabel,
				sourceKey,
				sourceLabel,
				sourceSubtitle: task.pdfPath,
				sourceKind: "pdf",
				sourceType: "pdf",
				status: String(task.status || "new"),
				priorityUi: Number(task.priorityUi ?? task.priorityEff ?? 5),
				priorityEff: Number(task.priorityEff ?? task.priorityUi ?? 5),
				intervalDays: Number(task.intervalDays ?? 0),
				nextRepDate: Number(task.nextRepDate ?? 0),
				createdAt: Number(task.createdAt ?? 0),
				updatedAt: Number(task.updatedAt ?? 0),
				doneAt: 0,
				stats: { ...(task.stats || {}) },
			});
		}

		for (const task of input.epubTasks) {
			const sourceKey = `epub:${task.epubFilePath}`;
			const sourceLabel = stripExtension(getPathBaseName(task.epubFilePath));
			input.sourceInfoByKey.set(sourceKey, {
				label: sourceLabel,
				subtitle: task.epubFilePath,
				kind: "epub",
			});

			units.push({
				id: task.id,
				title: task.title || sourceLabel,
				sourceKey,
				sourceLabel,
				sourceSubtitle: task.epubFilePath,
				sourceKind: "epub",
				sourceType: "epub",
				status: String(task.status || "new"),
				priorityUi: Number(task.priorityUi ?? task.priorityEff ?? 5),
				priorityEff: Number(task.priorityEff ?? task.priorityUi ?? 5),
				intervalDays: Number(task.intervalDays ?? 0),
				nextRepDate: Number(task.nextRepDate ?? 0),
				createdAt: Number(task.createdAt ?? 0),
				updatedAt: Number(task.updatedAt ?? 0),
				doneAt: 0,
				stats: { ...(task.stats || {}) },
			});
		}

		return units;
	}

	private buildSourceOptions(
		units: IRAnalyticsUnit[],
		sourceInfoByKey: Map<string, { label: string; subtitle: string; kind: IRAnalyticsSourceKind }>,
		sessionSecondsByBlockId: Map<string, number>
	): IRAnalyticsSourceOption[] {
		const grouped = new Map<string, IRAnalyticsUnit[]>();
		for (const unit of units) {
			const current = grouped.get(unit.sourceKey) || [];
			current.push(unit);
			grouped.set(unit.sourceKey, current);
		}

		const today = new Date();
		today.setHours(23, 59, 59, 999);
		const todayEnd = today.getTime();
		const todayStart = todayEnd - DAY_MS + 1;

		return Array.from(grouped.entries())
			.map(([key, items]) => {
				const info = sourceInfoByKey.get(key) || {
					label: "未命名数据源",
					subtitle: "",
					kind: "other" as IRAnalyticsSourceKind,
				};
				const activeItems = items.filter((item) => !isClosedStatus(item.status));
				const dueCount = activeItems.filter(
					(item) => item.nextRepDate <= 0 || item.nextRepDate <= todayEnd
				).length;
				const overdueCount = activeItems.filter(
					(item) => item.nextRepDate > 0 && item.nextRepDate < todayStart
				).length;
				const totalReadingHours = round(
					items.reduce(
						(sum, item) => sum + getReadingHoursForUnit(item, sessionSecondsByBlockId),
						0
					),
					1
				);
				const avgPriority = round(average(items.map((item) => estimatePriority(item))), 1);

				return {
					key,
					label: info.label,
					subtitle: info.subtitle,
					kind: info.kind,
					itemCount: items.length,
					activeCount: activeItems.length,
					dueCount,
					overdueCount,
					totalReadingHours,
					avgPriority,
				} satisfies IRAnalyticsSourceOption;
			})
			.sort((a, b) => {
				if (b.dueCount !== a.dueCount) return b.dueCount - a.dueCount;
				if (b.activeCount !== a.activeCount) return b.activeCount - a.activeCount;
				return a.label.localeCompare(b.label, "zh-CN");
			});
	}

	private buildOverview(
		units: IRAnalyticsUnit[],
		sessionSecondsByBlockId: Map<string, number>
	): IRAnalyticsOverview {
		const today = new Date();
		today.setHours(0, 0, 0, 0);
		const todayStart = today.getTime();
		const todayEnd = todayStart + DAY_MS - 1;
		const activeUnits = units.filter((unit) => !isClosedStatus(unit.status));

		return {
			totalItems: units.length,
			activeItems: activeUnits.length,
			dueToday: activeUnits.filter((unit) => unit.nextRepDate <= 0 || unit.nextRepDate <= todayEnd)
				.length,
			overdueItems: activeUnits.filter(
				(unit) => unit.nextRepDate > 0 && unit.nextRepDate < todayStart
			).length,
			totalReadingHours: round(
				units.reduce((sum, unit) => sum + getReadingHoursForUnit(unit, sessionSecondsByBlockId), 0),
				1
			),
			avgPriority: round(average(units.map((unit) => estimatePriority(unit))), 1),
			cardsCreated: units.reduce((sum, unit) => sum + (unit.stats.cardsCreated || 0), 0),
			extracts: units.reduce((sum, unit) => sum + (unit.stats.extracts || 0), 0),
			notesWritten: units.reduce((sum, unit) => sum + (unit.stats.notesWritten || 0), 0),
		};
	}

	private buildActivityTrend(units: IRAnalyticsUnit[], days: number): IRAnalyticsActivityPoint[] {
		const datePoints = buildRecentDatePoints(days);
		return datePoints.map((point) => ({
			dateKey: point.dateKey,
			label: point.label,
			createdCount: units.filter(
				(unit) =>
					unit.createdAt > 0 && unit.createdAt >= point.startMs && unit.createdAt <= point.endMs
			).length,
			interactedCount: units.filter((_unit) => {
				const ts = Number(_unit.stats.lastInteraction || 0);
				return ts > 0 && ts >= point.startMs && ts <= point.endMs;
			}).length,
			completedCount: units.filter((_unit) => {
				const closedAt = toCloseTimestamp(_unit);
				return closedAt > 0 && closedAt >= point.startMs && closedAt <= point.endMs;
			}).length,
		}));
	}

	private buildQuantityTrend(units: IRAnalyticsUnit[], days: number): IRAnalyticsQuantityPoint[] {
		const datePoints = buildRecentDatePoints(days);
		return datePoints.map((_point) => {
			const existing = units.filter((unit) => unit.createdAt <= _point.endMs);
			const closed = existing.filter((_unit) => {
				const closedAt = toCloseTimestamp(_unit);
				return closedAt > 0 && closedAt <= _point.endMs;
			});
			return {
				dateKey: _point.dateKey,
				label: _point.label,
				totalCount: existing.length,
				activeCount: existing.length - closed.length,
				closedCount: closed.length,
			};
		});
	}

	private buildTimingBuckets(units: IRAnalyticsUnit[]): IRAnalyticsTimingBucket[] {
		const activeUnits = units.filter((unit) => !isClosedStatus(unit.status));
		const now = new Date();
		now.setHours(0, 0, 0, 0);
		const todayStart = now.getTime();

		const buckets: IRAnalyticsTimingBucket[] = [
			{ label: "已逾期 7 天+", count: 0 },
			{ label: "已逾期 2-7 天", count: 0 },
			{ label: "已逾期 1 天内", count: 0 },
			{ label: "今日到期", count: 0 },
			{ label: "1-3 天", count: 0 },
			{ label: "4-7 天", count: 0 },
			{ label: "8-14 天", count: 0 },
			{ label: "15-30 天", count: 0 },
			{ label: "30 天以上", count: 0 },
			{ label: "未排期", count: 0 },
		];

		for (const unit of activeUnits) {
			if (unit.nextRepDate <= 0) {
				buckets[9].count += 1;
				continue;
			}

			const diffDays = Math.floor((unit.nextRepDate - todayStart) / DAY_MS);
			if (diffDays <= -7) buckets[0].count += 1;
			else if (diffDays <= -2) buckets[1].count += 1;
			else if (diffDays < 0) buckets[2].count += 1;
			else if (diffDays === 0) buckets[3].count += 1;
			else if (diffDays <= 3) buckets[4].count += 1;
			else if (diffDays <= 7) buckets[5].count += 1;
			else if (diffDays <= 14) buckets[6].count += 1;
			else if (diffDays <= 30) buckets[7].count += 1;
			else buckets[8].count += 1;
		}

		return buckets;
	}

	private buildDifficultyScatter(
		units: IRAnalyticsUnit[],
		sources: IRAnalyticsSourceOption[],
		sessionSecondsByBlockId: Map<string, number>,
		sourceKey?: string
	): IRAnalyticsScatterPoint[] {
		if (!units.length) return [];

		if (sourceKey) {
			return units
				.slice()
				.sort((a, b) => estimatePriority(b) - estimatePriority(a))
				.slice(0, 80)
				.map((unit) => ({
					label: truncateLabel(unit.title || unit.sourceLabel, 18),
					x: round(estimatePriority(unit), 1),
					y: round(unit.intervalDays || 0, 1),
					size: Math.max(
						8,
						Math.min(
							38,
							8 +
								Math.sqrt(
									(unit.stats.cardsCreated || 0) * 6 +
										(unit.stats.extracts || 0) * 4 +
										(unit.stats.notesWritten || 0) * 3 +
										4
								)
						)
					),
					itemCount: 1,
					readingHours: round(getReadingHoursForUnit(unit, sessionSecondsByBlockId), 2),
					cardsCreated: unit.stats.cardsCreated || 0,
					extracts: unit.stats.extracts || 0,
					notesWritten: unit.stats.notesWritten || 0,
				}));
		}

		const grouped = new Map<string, IRAnalyticsUnit[]>();
		for (const unit of units) {
			const current = grouped.get(unit.sourceKey) || [];
			current.push(unit);
			grouped.set(unit.sourceKey, current);
		}

		const topSourceKeys = new Set(sources.slice(0, 60).map((source) => source.key));
		return Array.from(grouped.entries())
			.filter(([key]) => topSourceKeys.has(key))
			.map(([key, items]) => {
				const source = sources.find((item) => item.key === key);
				const itemCount = items.length;
				const cardsCreated = items.reduce((sum, item) => sum + (item.stats.cardsCreated || 0), 0);
				const extracts = items.reduce((sum, item) => sum + (item.stats.extracts || 0), 0);
				const notesWritten = items.reduce((sum, item) => sum + (item.stats.notesWritten || 0), 0);
				return {
					label: truncateLabel(source?.label || items[0]?.sourceLabel || "来源文档", 16),
					x: round(average(items.map((item) => estimatePriority(item))), 1),
					y: round(average(items.map((item) => item.intervalDays || 0)), 1),
					size: Math.max(
						10,
						Math.min(42, 10 + Math.sqrt(itemCount * 6 + cardsCreated * 5 + extracts * 3 + 4))
					),
					itemCount,
					readingHours: round(
						items.reduce(
							(sum, item) => sum + getReadingHoursForUnit(item, sessionSecondsByBlockId),
							0
						),
						2
					),
					cardsCreated,
					extracts,
					notesWritten,
				};
			})
			.sort((a, b) => b.itemCount - a.itemCount);
	}

	private buildForecast(
		days: IRPlannedDay[],
		sourceKeyByUnitId: Map<string, string>,
		sourceKey?: string
	): IRAnalyticsForecastPoint[] {
		return days.map((_day) => {
			const items = sourceKey
				? _day.items.filter((item) => sourceKeyByUnitId.get(item.id) === sourceKey)
				: _day.items;
			return {
				dateKey: _day.dateKey,
				label: this.toShortDateLabel(_day.dateKey),
				itemCount: items.length,
				totalEstimatedMinutes: round(
					items.reduce((sum, item) => sum + Number(item.estimatedMinutes || 0), 0),
					1
				),
				overloadLevel: items.length === 0 ? "normal" : _day.overloadLevel,
			};
		});
	}

	private buildMonitoringSummary(): IRAnalyticsMonitoringSummary | null {
		const report = this.monitoringService.getSummaryReport();
		const calibration = this.monitoringService.getDecisionCalibrationSummary();
		return {
			dailyReadingMinutes: round(report.weeklyAvg.readingMinutes, 1),
			dailyScheduled: round(report.weeklyAvg.scheduledCount, 1),
			dailyCompleted: round(report.weeklyAvg.completedCount, 1),
			linkedOutcomeRate: round(calibration.linkedOutcomeRate * 100, 1),
		};
	}

	private toShortDateLabel(dateKey: string): string {
		const parts = String(dateKey || "").split("-");
		if (parts.length !== 3) return dateKey;
		return `${Number(parts[1])}/${Number(parts[2])}`;
	}
}
