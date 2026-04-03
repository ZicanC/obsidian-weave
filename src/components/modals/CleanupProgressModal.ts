/**
 * 全局清理进度模态窗口
 *
 * 职责：
 * - 显示清理进度（动画进度条）
 * - 三列统计卡片（文件/检测/清理）
 * - 可折叠的清理详情列表
 * - 显示保护状态和错误信息
 * - 提供取消/暂停功能
 */

import { App, Modal, setIcon } from "obsidian";
import { GlobalCleanupScanner } from "../../services/cleanup/GlobalCleanupScanner";
import { GlobalScanResult, ScanProgress } from "../../services/cleanup/types";

interface CleanupDetail {
	filePath: string;
	status: "success" | "protected" | "processing" | "error" | "skipped";
	message: string;
	remainingTime?: number;
}

export class CleanupProgressModal extends Modal {
	private scanner: GlobalCleanupScanner;
	private progressBar!: HTMLElement;
	private progressPercentEl!: HTMLElement;
	private currentFileEl!: HTMLElement;
	private statsCards!: HTMLElement;
	private detailsContainer!: HTMLElement;
	private detailsList!: HTMLElement;
	private timerEl!: HTMLElement;
	private actionBtnContainer!: HTMLElement;
	private cancelBtn!: HTMLButtonElement;
	private isCancelled = false;
	private isCompleted = false;
	private startTime = 0;
	private timerInterval?: number;
	private cleanupDetails: CleanupDetail[] = [];
	private isDetailsExpanded = true;

	// 统计数据
	private stats = {
		totalFiles: 0,
		processedFiles: 0,
		detectedOrphans: 0,
		cleanedOrphans: 0,
		protectedCount: 0,
		errorCount: 0,
	};

	constructor(app: App, scanner: GlobalCleanupScanner) {
		super(app);
		this.scanner = scanner;
	}

	onOpen(): void {
		this.startTime = Date.now();
		this.buildUI();
		this.startTimer();
	}

	onClose(): void {
		if (this.timerInterval) {
			window.clearInterval(this.timerInterval);
		}
		this.contentEl.empty();
	}

	/**
	 * 构建UI
	 */
	private buildUI(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("weave-cleanup-modal");

		// === 头部 ===
		const header = contentEl.createDiv("cleanup-modal-header");
		const titleRow = header.createDiv("cleanup-title-row");
		const titleIcon = titleRow.createSpan("cleanup-title-icon");
		setIcon(titleIcon, "brush");
		titleRow.createSpan({ text: "全局清理 - Weave残留元数据", cls: "cleanup-title-text" });

		// === 进度区域 ===
		const progressSection = contentEl.createDiv("cleanup-progress-section");

		// 进度条
		const progressBarContainer = progressSection.createDiv("cleanup-progress-bar-container");
		this.progressBar = progressBarContainer.createDiv("cleanup-progress-bar");
		this.progressBar.setCssProps({ width: "0%" });
		this.progressPercentEl = progressBarContainer.createSpan({
			text: "0%",
			cls: "cleanup-progress-percent",
		});

		// 当前文件/状态行（包含用时）
		const currentFileRow = progressSection.createDiv("cleanup-current-file");
		const fileIcon = currentFileRow.createSpan("cleanup-file-icon");
		setIcon(fileIcon, "file-text");
		this.currentFileEl = currentFileRow.createSpan({
			text: "准备扫描...",
			cls: "cleanup-file-path",
		});

		// 用时显示（在同一行右侧）
		this.timerEl = currentFileRow.createSpan({ text: "", cls: "cleanup-timer-inline" });

		// === 统计卡片 ===
		const statsSection = contentEl.createDiv("cleanup-stats-section");
		const statsLabel = statsSection.createDiv("cleanup-section-label");
		const statsIcon = statsLabel.createSpan("cleanup-label-icon");
		setIcon(statsIcon, "bar-chart-2");
		statsLabel.createSpan({ text: "扫描统计" });

		this.statsCards = statsSection.createDiv("cleanup-stats-cards");
		this.renderStatsCards();

		// === 清理详情 ===
		this.detailsContainer = contentEl.createDiv("cleanup-details-section");
		const detailsHeader = this.detailsContainer.createDiv("cleanup-details-header");
		const detailsLabel = detailsHeader.createDiv("cleanup-section-label");
		const detailsIcon = detailsLabel.createSpan("cleanup-label-icon");
		setIcon(detailsIcon, "list");
		detailsLabel.createSpan({ text: "清理详情" });

		const toggleBtn = detailsHeader.createEl("button", { cls: "cleanup-toggle-btn" });
		const toggleIcon = toggleBtn.createSpan("cleanup-toggle-icon");
		setIcon(toggleIcon, "chevron-down");
		toggleBtn.createSpan({ text: "收起" });
		toggleBtn.onclick = () => this.toggleDetails(toggleBtn, toggleIcon);

		this.detailsList = this.detailsContainer.createDiv("cleanup-details-list");
		this.detailsList.createDiv({ text: "等待扫描结果...", cls: "cleanup-details-empty" });

		// === 底部（仅在扫描中显示取消按钮） ===
		const footer = contentEl.createDiv("cleanup-modal-footer");
		this.actionBtnContainer = footer.createDiv("cleanup-action-buttons");

		// 取消按钮（扫描完成后隐藏）
		this.cancelBtn = this.actionBtnContainer.createEl("button", {
			cls: "cleanup-btn cleanup-btn-cancel",
		});
		const cancelIcon = this.cancelBtn.createSpan("cleanup-btn-icon");
		setIcon(cancelIcon, "x");
		this.cancelBtn.createSpan({ text: "取消" });
		this.cancelBtn.onclick = () => this.handleCancel();

		// 添加样式
		this.addStyles();
	}

	/**
	 * 渲染统计卡片
	 */
	private renderStatsCards(): void {
		this.statsCards.empty();

		const cards = [
			{
				icon: "folder",
				label: "文件",
				value: `${this.stats.processedFiles}/${this.stats.totalFiles}`,
				cls: "files",
			},
			{ icon: "search", label: "检测", value: String(this.stats.detectedOrphans), cls: "detected" },
			{
				icon: "check-circle",
				label: "已清理",
				value: String(this.stats.cleanedOrphans),
				cls: "cleaned",
			},
		];

		cards.forEach((_card) => {
			const cardEl = this.statsCards.createDiv(`cleanup-stat-card cleanup-stat-${_card.cls}`);
			const iconEl = cardEl.createDiv("cleanup-stat-icon");
			setIcon(iconEl, _card.icon);
			const _valueEl = cardEl.createDiv({ text: _card.value, cls: "cleanup-stat-value" });
			cardEl.createDiv({ text: _card.label, cls: "cleanup-stat-label" });
		});
	}

	/**
	 * 切换详情展开/收起
	 */
	private toggleDetails(btn: HTMLButtonElement, iconEl: HTMLElement): void {
		this.isDetailsExpanded = !this.isDetailsExpanded;

		if (this.isDetailsExpanded) {
			this.detailsList.removeClass("collapsed");
			setIcon(iconEl, "chevron-down");
			btn.querySelector("span:last-child")!.textContent = "收起";
		} else {
			this.detailsList.addClass("collapsed");
			setIcon(iconEl, "chevron-right");
			btn.querySelector("span:last-child")!.textContent = "展开";
		}
	}

	/**
	 * 启动计时器
	 */
	private startTimer(): void {
		this.timerInterval = window.setInterval(() => {
			const elapsed = (Date.now() - this.startTime) / 1000;
			this.timerEl.textContent = `${elapsed.toFixed(1)}秒`;
		}, 100);
	}

	/**
	 * 更新进度
	 */
	public updateProgress(progress: ScanProgress): void {
		// 更新统计
		this.stats.totalFiles = progress.totalFiles;
		this.stats.processedFiles = progress.processedFiles;
		this.stats.cleanedOrphans = progress.cleanedCount;

		// 更新进度条
		this.progressBar.setCssProps({ width: `${progress.percentage}%` });
		this.progressPercentEl.textContent = `${progress.percentage}%`;

		// 更新当前文件（截断过长路径）
		const filePath = progress.currentFile || "";
		const displayPath = filePath.length > 50 ? `...${filePath.slice(-47)}` : filePath;
		this.currentFileEl.textContent = displayPath || "处理中...";

		// 更新统计卡片
		this.renderStatsCards();
	}

	/**
	 * 添加清理详情
	 */
	public addCleanupDetail(detail: CleanupDetail): void {
		// 移除空状态提示
		const emptyEl = this.detailsList.querySelector(".cleanup-details-empty");
		if (emptyEl) emptyEl.remove();

		this.cleanupDetails.push(detail);

		// 限制显示数量，保留最新的50条
		if (this.cleanupDetails.length > 50) {
			this.cleanupDetails.shift();
			this.detailsList.firstChild?.remove();
		}

		// 渲染详情项
		const item = this.detailsList.createDiv("cleanup-detail-item");

		// 状态图标
		const statusIcon = item.createSpan("cleanup-detail-status");
		switch (detail.status) {
			case "success":
				setIcon(statusIcon, "check");
				item.addClass("status-success");
				break;
			case "protected":
				setIcon(statusIcon, "shield");
				item.addClass("status-protected");
				break;
			case "processing":
				setIcon(statusIcon, "loader");
				item.addClass("status-processing");
				break;
			case "error":
				setIcon(statusIcon, "alert-circle");
				item.addClass("status-error");
				break;
			case "skipped":
				setIcon(statusIcon, "info");
				item.addClass("status-skipped");
				break;
		}

		// 文件路径
		const fileName = detail.filePath.split("/").pop() || detail.filePath;
		item.createSpan({ text: fileName, cls: "cleanup-detail-file" });

		// 消息
		item.createSpan({ text: detail.message, cls: "cleanup-detail-message" });

		// 滚动到底部
		this.detailsList.scrollTop = this.detailsList.scrollHeight;
	}

	/**
	 * 显示结果
	 */
	public showResult(result: GlobalScanResult): void {
		this.isCompleted = true;

		// 停止计时器
		if (this.timerInterval) {
			window.clearInterval(this.timerInterval);
		}

		// 更新统计
		this.stats.totalFiles = result.totalFiles;
		this.stats.processedFiles = result.totalFiles;
		this.stats.detectedOrphans = result.totalOrphans;
		this.stats.cleanedOrphans = result.cleanedOrphans;

		// 更新进度条为100%
		this.progressBar.setCssProps({ width: "100%" });
		this.progressPercentEl.textContent = "100%";
		this.progressBar.addClass("completed");

		// 更新当前文件显示
		this.currentFileEl.textContent = "扫描完成";

		// 更新计时器
		this.timerEl.textContent = `${(result.duration / 1000).toFixed(1)}秒`;

		// 更新统计卡片
		this.renderStatsCards();

		// 显示错误（如果有）
		if (result.errors.length > 0) {
			result.errors.forEach((_err) => {
				this.addCleanupDetail({
					filePath: _err.filePath,
					status: "error",
					message: _err.error,
				});
			});
		}

		// 隐藏取消按钮（扫描完成后用户可点击右上角X关闭）
		this.cancelBtn.addClass("hidden");
	}

	/**
	 * 处理取消
	 */
	private handleCancel(): void {
		if (this.isCompleted) {
			this.close();
		} else {
			this.isCancelled = true;
			this.scanner.cancel();
			this.cancelBtn.disabled = true;
			this.cancelBtn.textContent = "取消中...";

			setTimeout(() => {
				this.close();
			}, 1500);
		}
	}

	/**
	 * 添加样式
	 */
	private addStyles(): void {
		// 样式已迁移到 styles/dynamic-injected.css
	}
}
