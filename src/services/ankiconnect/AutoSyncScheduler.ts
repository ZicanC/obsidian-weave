import { type App, type EventRef, Notice, TFile } from "obsidian";
import type { WeavePlugin } from "../../main";
import type { IncrementalSyncResult } from "../../types/ankiconnect-types";
import { logger } from "../../utils/logger";
import type { AnkiConnectService } from "./AnkiConnectService";

export interface SyncTask {
	type: "scheduled" | "on_change" | "manual";
	timestamp: number;
	triggeredBy?: string;
}

export interface AutoSyncSchedulerConfig {
	intervalMinutes: number;
	syncOnStartup: boolean;
	onlyWhenAnkiRunning: boolean;
	enableFileWatcher: boolean;
	debounceDelay: number;
}

export class AutoSyncScheduler {
	private intervalTimer: number | null = null;
	private debounceTimer: number | null = null;
	private isRunning = false;
	private isSyncing = false;
	private fileModifyRef: EventRef | null = null;

	constructor(
		private app: App,
		private plugin: WeavePlugin,
		private ankiService: AnkiConnectService,
		private config: AutoSyncSchedulerConfig
	) {}

	start(): void {
		if (this.isRunning) {
			logger.warn("[AutoSyncScheduler] Scheduler is already running");
			return;
		}

		logger.debug("[AutoSyncScheduler] Starting scheduler", {
			intervalMinutes: this.config.intervalMinutes,
			syncOnStartup: this.config.syncOnStartup,
			enableFileWatcher: this.config.enableFileWatcher,
		});

		this.isRunning = true;

		if (this.config.syncOnStartup) {
			this.scheduleSyncTask("scheduled", 2000);
		}

		this.startScheduledSync();

		if (this.config.enableFileWatcher) {
			this.startFileWatcher();
		}
	}

	stop(): void {
		if (!this.isRunning) {
			return;
		}

		logger.debug("[AutoSyncScheduler] Stopping scheduler");

		if (this.intervalTimer !== null) {
			window.clearInterval(this.intervalTimer);
			this.intervalTimer = null;
		}

		if (this.debounceTimer !== null) {
			window.clearTimeout(this.debounceTimer);
			this.debounceTimer = null;
		}

		if (this.fileModifyRef) {
			this.app.vault.offref(this.fileModifyRef);
			this.fileModifyRef = null;
		}

		this.isRunning = false;
	}

	private startScheduledSync(): void {
		const intervalMs = this.config.intervalMinutes * 60 * 1000;

		logger.debug("[AutoSyncScheduler] Starting scheduled sync timer", {
			intervalMinutes: this.config.intervalMinutes,
		});

		this.intervalTimer = window.setInterval(() => {
			logger.debug("[AutoSyncScheduler] Scheduled sync triggered");
			this.scheduleSyncTask("scheduled");
		}, intervalMs);
	}

	private startFileWatcher(): void {
		logger.debug("[AutoSyncScheduler] Starting file watcher");

		this.fileModifyRef = this.app.vault.on("modify", (_file) => {
			if (_file instanceof TFile) {
				this.onFileChange(_file);
			}
		});
	}

	private onFileChange(file: TFile): void {
		if (!this.isWeaveCardFile(file)) {
			return;
		}

		logger.debug("[AutoSyncScheduler] Relevant file changed", { path: file.path });

		if (this.debounceTimer !== null) {
			window.clearTimeout(this.debounceTimer);
		}

		this.debounceTimer = window.setTimeout(() => {
			logger.debug("[AutoSyncScheduler] Debounced change sync triggered", { path: file.path });
			this.scheduleSyncTask("on_change", 0, file.path);
		}, this.config.debounceDelay);
	}

	private isWeaveCardFile(file: TFile): boolean {
		const weaveFolder = this.plugin.settings.dataFolderVisibility?.folderName || "weave";
		if (!file.path.startsWith(weaveFolder)) {
			return false;
		}

		if (file.extension !== "md") {
			return false;
		}

		if (file.path.includes("template") || file.path.includes("settings")) {
			return false;
		}

		return true;
	}

	private scheduleSyncTask(type: SyncTask["type"], delay = 0, triggeredBy?: string): void {
		const task: SyncTask = {
			type,
			timestamp: Date.now(),
			triggeredBy,
		};

		if (delay > 0) {
			window.setTimeout(() => void this.executeSync(task), delay);
			return;
		}

		void this.executeSync(task);
	}

	private async executeSync(task: SyncTask): Promise<void> {
		if (this.isSyncing) {
			logger.debug("[AutoSyncScheduler] Sync already in progress, skipping task", {
				type: task.type,
			});
			return;
		}

		if (this.config.onlyWhenAnkiRunning) {
			const connectionState = this.ankiService.getConnectionState();
			if (connectionState.status !== "connected") {
				logger.debug("[AutoSyncScheduler] Anki is not connected, skipping task");
				return;
			}
		}

		this.isSyncing = true;

		try {
			logger.debug("[AutoSyncScheduler] Executing sync task", {
				type: task.type,
				triggeredBy: task.triggeredBy || "manual",
			});

			const result = await this.ankiService.performIncrementalSync();

			logger.debug("[AutoSyncScheduler] Sync completed", {
				totalCards: result.totalCards,
				changedCards: result.changedCards,
				importedCards: result.importedCards,
				exportedCards: result.exportedCards,
				skippedCards: result.skippedCards,
				errorCount: result.errors.length,
			});

			if (task.type === "scheduled" || task.type === "manual") {
				this.showCompletionNotice(result);
			}
		} catch (error) {
			logger.error("[AutoSyncScheduler] Sync failed", error);

			if (this.plugin.app?.workspace) {
				new Notice(
					`\u540c\u6b65\u5931\u8d25: ${
						error instanceof Error ? error.message : "\u672a\u77e5\u9519\u8bef"
					}`
				);
			}
		} finally {
			this.isSyncing = false;
		}
	}

	private showCompletionNotice(result: IncrementalSyncResult): void {
		if (!this.plugin.app || !this.plugin.app.workspace) {
			return;
		}

		const parts: string[] = [];

		if (result.importedCards > 0) {
			parts.push(`\u5bfc\u5165 ${result.importedCards} \u5f20`);
		}
		if (result.createdCards > 0) {
			parts.push(`\u65b0\u589e ${result.createdCards} \u5f20`);
		}
		if (result.updatedCards > 0) {
			parts.push(`\u66f4\u65b0 ${result.updatedCards} \u5f20`);
		}
		if (result.unchangedCards > 0) {
			parts.push(`\u65e0\u53d8\u5316 ${result.unchangedCards} \u5f20`);
		}
		if (result.duplicateCards > 0) {
			parts.push(`\u91cd\u590d ${result.duplicateCards} \u5f20`);
		}
		if (result.failedCards > 0) {
			parts.push(
				`\u5931\u8d25 ${result.failedCards} \u5f20\uff08${this.formatFailureSummary(result)}\uff09`
			);
		}
		if (result.warningCards > 0) {
			parts.push(`\u8b66\u544a ${result.warningCards} \u5f20`);
		}

		const message =
			parts.length > 0
				? `\u540c\u6b65\u5b8c\u6210\uff1a${parts.join("\uff1b")}`
				: "\u540c\u6b65\u5b8c\u6210\uff1a\u65e0\u53d8\u5316";

		new Notice(message, 8000);
	}

	private formatFailureSummary(result: IncrementalSyncResult): string {
		const summary: string[] = [];
		const failureReasons = result.summary.failureReasons ?? {};
		const emptyContentCount = failureReasons.empty_content ?? 0;
		const missingPrimaryFieldCount = failureReasons.missing_primary_field ?? 0;
		const otherCount = Math.max(
			result.failedCards - emptyContentCount - missingPrimaryFieldCount,
			0
		);

		if (emptyContentCount > 0) {
			summary.push(`\u7a7a\u5185\u5bb9 ${emptyContentCount}`);
		}
		if (missingPrimaryFieldCount > 0) {
			summary.push(`\u7f3a\u4e3b\u5b57\u6bb5 ${missingPrimaryFieldCount}`);
		}
		if (otherCount > 0) {
			summary.push(`\u5176\u4ed6 ${otherCount}`);
		}

		return summary.join("\uff0c") || "\u672a\u5206\u7c7b";
	}

	public manualSync(): void {
		logger.debug("[AutoSyncScheduler] Manual sync triggered");
		this.scheduleSyncTask("manual");
	}

	public getStatus(): {
		isRunning: boolean;
		isSyncing: boolean;
	} {
		return {
			isRunning: this.isRunning,
			isSyncing: this.isSyncing,
		};
	}
}
