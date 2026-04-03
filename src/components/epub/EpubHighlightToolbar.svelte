<script lang="ts">
	import { setIcon, Platform } from 'obsidian';
	import { onMount, tick } from 'svelte';
	import type { HighlightClickInfo } from '../../services/epub';

	interface Props {
		info: HighlightClickInfo | null;
		onDelete: (info: HighlightClickInfo) => void;
		onTemporarilyReveal: (info: HighlightClickInfo) => void;
		onChangeColor: (info: HighlightClickInfo, newColor: string) => void;
		onBacklink: (info: HighlightClickInfo) => void;
		onExtractToCard: (info: HighlightClickInfo) => void;
		onCopyText: (info: HighlightClickInfo) => void;
		onDismiss: () => void;
	}

	let { info, onDelete, onTemporarilyReveal, onChangeColor, onBacklink, onExtractToCard, onCopyText, onDismiss }: Props = $props();

	let toolbarEl: HTMLDivElement | undefined = $state(undefined);
	let colorPickerOpen = $state(false);
	let posTop = $state(0);
	let posLeft = $state(0);
	let isBelowTarget = $state(false);
	let toolbarMode = $state<'floating' | 'docked'>('floating');
	let arrowOffset = $state(0);
	let teardownViewportTracking: (() => void) | null = null;
	let previousInfo: HighlightClickInfo | null = null;

	const colors = ['yellow', 'blue', 'red', 'purple', 'green'] as const;
	const colorLabels: Record<(typeof colors)[number], string> = {
		yellow: '黄色',
		blue: '蓝色',
		red: '红色',
		purple: '紫色',
		green: '绿色'
	};
	const isMobileToolbar = Platform.isMobile || document.body.classList.contains('is-mobile');
	const FLOATING_EDGE_MARGIN = 12;
	const FLOATING_GAP = 12;
	const FLOATING_ARROW_PADDING = 18;

	function icon(node: HTMLElement, name: string) {
		setIcon(node, name);
		return {
			update(newName: string) {
				// /skip innerHTML is used to clear the trusted icon container before setIcon rerenders it
				node.replaceChildren();
				setIcon(node, newName);
			}
		};
	}

	function clamp(value: number, min: number, max: number) {
		if (max < min) return min;
		return Math.min(Math.max(value, min), max);
	}

	function stopViewportTracking() {
		teardownViewportTracking?.();
		teardownViewportTracking = null;
	}

	function startViewportTracking() {
		if (!toolbarEl || teardownViewportTracking) return;

		const viewportEl = toolbarEl.closest('.epub-reader-viewport') as HTMLElement | null;
		const scrollHost = toolbarEl.closest('.epub-reader-viewport')?.querySelector('.epub-content-wrapper') as HTMLElement | null;
		const visualViewport = window.visualViewport;
		const listeners: Array<() => void> = [];
		const dismiss = () => onDismiss();
		const bind = (
			target: EventTarget | null | undefined,
			event: string,
			handler: EventListenerOrEventListenerObject,
			options?: AddEventListenerOptions | boolean
		) => {
			if (!target?.addEventListener || !target?.removeEventListener) return;
			target.addEventListener(event, handler, options);
			listeners.push(() => target.removeEventListener(event, handler, options));
		};

		bind(scrollHost, 'scroll', dismiss, { passive: true });
		bind(viewportEl, 'scroll', dismiss, { passive: true });
		bind(window, 'resize', dismiss);
		bind(window, 'orientationchange', dismiss);
		bind(visualViewport, 'resize', dismiss);
		bind(visualViewport, 'scroll', dismiss);

		teardownViewportTracking = () => {
			for (const dispose of listeners) {
				dispose();
			}
		};
	}

	async function positionToolbar() {
		if (!info) {
			stopViewportTracking();
			toolbarMode = 'floating';
			arrowOffset = 0;
			return;
		}

		await tick();
		if (!toolbarEl) return;

		const viewportEl = toolbarEl.closest('.epub-reader-viewport') as HTMLElement | null;
		if (!viewportEl) return;

		toolbarMode = isMobileToolbar ? 'docked' : 'floating';
		startViewportTracking();

		if (toolbarMode === 'docked') {
			posLeft = viewportEl.clientWidth / 2;
			posTop = 0;
			isBelowTarget = true;
			arrowOffset = 0;
			return;
		}

		const toolbarWidth = toolbarEl.offsetWidth || 296;
		const toolbarHeight = toolbarEl.offsetHeight || 78;
		const anchorCenterX = info.rect.left + info.rect.width / 2;
		const minCenterX = FLOATING_EDGE_MARGIN + toolbarWidth / 2;
		const maxCenterX = viewportEl.clientWidth - FLOATING_EDGE_MARGIN - toolbarWidth / 2;
		const nextLeft = clamp(anchorCenterX, minCenterX, maxCenterX);
		const availableAbove = info.rect.top - FLOATING_GAP - FLOATING_EDGE_MARGIN;
		const availableBelow = viewportEl.clientHeight - info.rect.bottom - FLOATING_GAP - FLOATING_EDGE_MARGIN;
		const shouldPlaceBelow = availableAbove < toolbarHeight && availableBelow > availableAbove;
		const preferredTop = shouldPlaceBelow
			? info.rect.bottom + FLOATING_GAP
			: info.rect.top - toolbarHeight - FLOATING_GAP;
		const maxTop = viewportEl.clientHeight - toolbarHeight - FLOATING_EDGE_MARGIN;

		posTop = clamp(preferredTop, FLOATING_EDGE_MARGIN, maxTop);
		posLeft = nextLeft;
		isBelowTarget = shouldPlaceBelow;

		const arrowLimit = Math.max(0, toolbarWidth / 2 - FLOATING_ARROW_PADDING);
		arrowOffset = clamp(anchorCenterX - nextLeft, -arrowLimit, arrowLimit);
	}

	function handleClickOutside(e: Event) {
		if (info && toolbarEl && !toolbarEl.contains(e.target as Node)) {
			onDismiss();
		}
	}

	$effect(() => {
		const _info = info;
		const _picker = colorPickerOpen;
		if (info) {
			if (info !== previousInfo) {
				colorPickerOpen = false;
				previousInfo = info;
			}
			void positionToolbar();
		} else {
			stopViewportTracking();
			toolbarMode = 'floating';
			arrowOffset = 0;
			previousInfo = null;
		}

		return () => {
			if (!info) {
				stopViewportTracking();
			}
		};
	});

	onMount(() => {
		document.addEventListener('mousedown', handleClickOutside);
		document.addEventListener('touchstart', handleClickOutside);
		return () => {
			document.removeEventListener('mousedown', handleClickOutside);
			document.removeEventListener('touchstart', handleClickOutside);
			stopViewportTracking();
		};
	});
</script>

<div
	class="epub-highlight-toolbar epub-glass-panel"
	class:visible={info !== null}
	class:below-target={isBelowTarget}
	class:mobile-docked={toolbarMode === 'docked'}
	style={`top: ${posTop}px; left: ${posLeft}px; --toolbar-arrow-offset: ${arrowOffset}px;`}
	bind:this={toolbarEl}
>
	{#if info}
		{#if info.presentation === 'conceal'}
                        <div class="toolbar-row actions-row concealment-actions">
                                <button class="action-item" onclick={() => onTemporarilyReveal(info)} title="暂时显示隐藏文本">
                                        <span class="action-icon" use:icon={'eye'}></span>
                                        <span class="action-label">暂显</span>
                                </button>
				<button class="action-item" onclick={() => onCopyText(info)} title="复制隐藏文本">
					<span class="action-icon" use:icon={'clipboard-copy'}></span>
					<span class="action-label">复制</span>
				</button>
				<button class="action-item accent concealment-reset" onclick={() => onDelete(info)} title="恢复文本显示">
					<span class="action-icon" use:icon={'eye'}></span>
					<span class="action-label">恢复</span>
				</button>
			</div>
		{:else if colorPickerOpen}
			<div class="toolbar-row colors-row">
				{#each colors as c}
					<button
						class="color-btn {c}"
						class:active={c === info.color}
						onclick={() => { onChangeColor(info, c); colorPickerOpen = false; }}
						title={`切换为${colorLabels[c]}`}
						aria-label={`切换为${colorLabels[c]}高亮`}
					>
						<span class="color-btn-core"></span>
					</button>
				{/each}
			</div>
		{:else}
			<div class="toolbar-row colors-row">
				{#each colors as c}
					<button
						class="color-btn {c}"
						class:active={c === info.color}
						onclick={() => onChangeColor(info, c)}
						title={`切换为${colorLabels[c]}`}
						aria-label={`切换为${colorLabels[c]}高亮`}
					>
						<span class="color-btn-core"></span>
					</button>
				{/each}
			</div>
			<div class="toolbar-row actions-row">
				<button class="action-item" onclick={() => colorPickerOpen = true} title="颜色菜单">
					<span class="action-icon" use:icon={'palette'}></span>
					<span class="action-label">颜色</span>
				</button>
				<button class="action-item" onclick={() => onBacklink(info)} title="跳转到笔记">
					<span class="action-icon" use:icon={'external-link'}></span>
					<span class="action-label">笔记</span>
				</button>
				<button class="action-item accent" onclick={() => onExtractToCard(info)} title="摘录到卡片">
					<span class="action-icon" use:icon={'scissors'}></span>
					<span class="action-label">摘录</span>
				</button>
				<button class="action-item" onclick={() => onCopyText(info)} title="复制文本">
					<span class="action-icon" use:icon={'clipboard-copy'}></span>
					<span class="action-label">复制</span>
				</button>
				<div class="row-divider"></div>
				<button class="action-item delete" onclick={() => onDelete(info)} title="删除高亮">
					<span class="action-icon" use:icon={'trash-2'}></span>
					<span class="action-label">删除</span>
				</button>
			</div>
		{/if}
	{/if}

	<div class="toolbar-arrow"></div>
</div>
