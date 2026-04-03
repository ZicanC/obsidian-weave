import { type App, MarkdownView, Notice, type WorkspaceLeaf } from "obsidian";
import {
	openFileWithExistingLeaf,
	openLinkWithExistingLeaf,
} from "../../utils/workspace-navigation";
import { getSourceLocateOverlayService } from "./SourceLocateOverlayService";

interface LocateOptions {
	label?: string;
	icon?: string;
	delayMs?: number;
	openInNewTab?: boolean;
	focus?: boolean;
	fallbackEl?: HTMLElement | null;
	nodeRect?: {
		x: number;
		y: number;
		width?: number;
		height?: number;
	} | null;
}

const DEFAULT_LABEL = "定位到溯源位置";
const DEFAULT_ICON = "map-pinned";

export class SourceNavigationService {
	private readonly overlay = getSourceLocateOverlayService();
	private readonly markdownLocateRetryDelayMs = 180;
	private readonly markdownLocateMaxAttempts = 6;

	constructor(private readonly app: App) {}

	async locateInMarkdownView(
		view: MarkdownView | any,
		candidates: string[],
		options: LocateOptions = {}
	): Promise<boolean> {
		if (!view?.containerEl) return false;

		const target = this.overlay.findMarkdownTarget(view.containerEl as HTMLElement, candidates);
		if (!target) return false;

		try {
			target.scrollIntoView({ behavior: "auto", block: "center", inline: "nearest" });
		} catch (_e) {
			/* ignore */
		}

		window.setTimeout(() => {
			this.overlay.showAtRect(target.getBoundingClientRect(), {
				label: options.label || DEFAULT_LABEL,
				icon: options.icon || DEFAULT_ICON,
			});
		}, 40);

		return true;
	}

	locateOpenedMarkdownLeaf(
		openedLeaf: WorkspaceLeaf | null,
		candidates: string[],
		options: LocateOptions = {}
	): void {
		this.locateOpenedMarkdownLeafWithRetry(openedLeaf, candidates, options, 0);
	}

	private locateOpenedMarkdownLeafWithRetry(
		openedLeaf: WorkspaceLeaf | null,
		candidates: string[],
		options: LocateOptions,
		attempt: number
	): void {
		const delay = attempt === 0 ? options.delayMs ?? 220 : this.markdownLocateRetryDelayMs;
		window.setTimeout(async () => {
			try {
				const activeView = (
					openedLeaf?.view?.getViewType?.() === "markdown"
						? openedLeaf.view
						: this.app.workspace.getActiveViewOfType("markdown" as any)
				) as any;
				const located = activeView
					? await this.locateInMarkdownView(activeView, candidates, options)
					: false;
				if (located) return;

				if (attempt + 1 < this.markdownLocateMaxAttempts) {
					this.locateOpenedMarkdownLeafWithRetry(openedLeaf, candidates, options, attempt + 1);
					return;
				}

				if (!activeView?.containerEl && options.fallbackEl) {
					this.overlay.showAtRect(options.fallbackEl.getBoundingClientRect(), {
						label: options.label || DEFAULT_LABEL,
						icon: options.icon || DEFAULT_ICON,
					});
					return;
				}

				new Notice("已打开源文档，但未精确定位到溯源内容");
			} catch (_e) {
				/* ignore */
			}
		}, delay);
	}

	async openMarkdownLinkAndLocate(
		linkText: string,
		contextPath: string,
		candidates: string[],
		options: LocateOptions = {}
	): Promise<WorkspaceLeaf | null> {
		const openedLeaf = await openLinkWithExistingLeaf(this.app, linkText, contextPath, {
			openInNewTab: options.openInNewTab ?? true,
			focus: options.focus ?? true,
		});
		this.locateOpenedMarkdownLeaf(openedLeaf, candidates, options);
		return openedLeaf;
	}

	async openCanvasAndLocate(
		canvasPath: string,
		candidates: string[],
		nodeId?: string,
		options: LocateOptions = {}
	): Promise<WorkspaceLeaf | null> {
		let canvasLeaf =
			this.app.workspace.getLeavesOfType("canvas").find((leaf) => {
				return (leaf.view as any)?.file?.path === canvasPath;
			}) || null;

		if (!canvasLeaf) {
			canvasLeaf = await openFileWithExistingLeaf(this.app, canvasPath, {
				openInNewTab: options.openInNewTab ?? true,
				focus: options.focus ?? true,
			});
		}
		if (!canvasLeaf) return null;

		this.app.workspace.setActiveLeaf(canvasLeaf, { focus: options.focus ?? true });

		this.locateCanvasNodeWithRetry(canvasLeaf, candidates, nodeId, options, 0);

		return canvasLeaf;
	}

	private locateCanvasNodeWithRetry(
		canvasLeaf: WorkspaceLeaf,
		candidates: string[],
		nodeId: string | undefined,
		options: LocateOptions,
		attempt: number
	): void {
		window.setTimeout(() => {
			try {
				const canvasView = canvasLeaf.view as any;
				const canvas = canvasView?.canvas;
				const nodesMap = canvas?.nodes;
				if (!canvas || !nodesMap) {
					if (attempt < 5) {
						this.locateCanvasNodeWithRetry(canvasLeaf, candidates, nodeId, options, attempt + 1);
					}
					return;
				}

				const nodes = Array.from(nodesMap.values());
				const matchedNode =
					this.findCanvasNodeById(nodes, nodeId) ||
					this.findCanvasNodeByText(nodes, candidates) ||
					this.findCanvasNodeByRect(nodes, options.nodeRect);

				if (!matchedNode) {
					if (attempt < 5) {
						this.locateCanvasNodeWithRetry(canvasLeaf, candidates, nodeId, options, attempt + 1);
					} else if (options.fallbackEl) {
						this.overlay.showAtRect(options.fallbackEl.getBoundingClientRect(), {
							label: options.label || DEFAULT_LABEL,
							icon: options.icon || DEFAULT_ICON,
						});
					}
					return;
				}

				canvas.selectOnly(matchedNode);
				canvas.zoomToSelection();

				const nodeEl =
					(matchedNode as any)?.nodeEl ||
					(matchedNode as any)?.contentEl ||
					(matchedNode as any)?.containerEl ||
					(matchedNode as any)?.el;
				if (nodeEl instanceof HTMLElement) {
					window.setTimeout(() => {
						this.overlay.showAtRect(nodeEl.getBoundingClientRect(), {
							label: options.label || DEFAULT_LABEL,
							icon: options.icon || DEFAULT_ICON,
						});
					}, 120);
				}
			} catch (_e) {
				if (attempt < 5) {
					this.locateCanvasNodeWithRetry(canvasLeaf, candidates, nodeId, options, attempt + 1);
				}
			}
		}, (options.delayMs ?? 350) + attempt * 180);
	}

	private findCanvasNodeById(nodes: any[], nodeId?: string): any | null {
		const normalizedNodeId = this.normalizeCanvasNodeId(nodeId);
		if (!normalizedNodeId) return null;
		for (const node of nodes) {
			const data = typeof node?.getData === "function" ? node.getData() : node;
			const currentId = node?.id || data?.id || node?.unknownData?.id;
			if (typeof currentId === "string" && currentId === normalizedNodeId) {
				return node;
			}
		}
		return null;
	}

	private normalizeCanvasNodeId(nodeId?: string): string | undefined {
		if (!nodeId || typeof nodeId !== "string") return undefined;
		const trimmed = nodeId.trim();
		if (!trimmed) return undefined;

		const withoutPrefix = trimmed.startsWith("canvas:") ? trimmed.slice(7) : trimmed;
		const withoutCaret = withoutPrefix.startsWith("^") ? withoutPrefix.slice(1) : withoutPrefix;
		const queryIndex = withoutCaret.indexOf("?");
		return queryIndex >= 0 ? withoutCaret.slice(0, queryIndex) : withoutCaret;
	}

	private findCanvasNodeByText(nodes: any[], candidates: string[]): any | null {
		const normalizedCandidates = candidates.filter(
			(candidate): candidate is string => typeof candidate === "string" && candidate.length > 0
		);
		if (normalizedCandidates.length === 0) return null;

		for (const node of nodes) {
			const text = node?.text || node?.unknownData?.text || "";
			if (normalizedCandidates.some((candidate) => text.includes(candidate))) {
				return node;
			}
		}

		return null;
	}

	private findCanvasNodeByRect(nodes: any[], nodeRect?: LocateOptions["nodeRect"]): any | null {
		if (!nodeRect || !Number.isFinite(nodeRect.x) || !Number.isFinite(nodeRect.y)) {
			return null;
		}

		let bestNode: any | null = null;
		let bestScore = Number.POSITIVE_INFINITY;

		for (const node of nodes) {
			const data = typeof node?.getData === "function" ? node.getData() : node;
			const x = Number(data?.x);
			const y = Number(data?.y);
			if (!Number.isFinite(x) || !Number.isFinite(y)) continue;

			const width = Number(data?.width);
			const height = Number(data?.height);
			const dx = Math.abs(x - nodeRect.x);
			const dy = Math.abs(y - nodeRect.y);
			const dw =
				Number.isFinite(width) && Number.isFinite(nodeRect.width)
					? Math.abs(width - (nodeRect.width as number))
					: 0;
			const dh =
				Number.isFinite(height) && Number.isFinite(nodeRect.height)
					? Math.abs(height - (nodeRect.height as number))
					: 0;
			const score = dx + dy + dw + dh;

			if (score < bestScore) {
				bestScore = score;
				bestNode = node;
			}
		}

		return bestNode;
	}
}
