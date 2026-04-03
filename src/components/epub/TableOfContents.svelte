<script lang="ts">
	import type { TocItem } from '../../services/epub';

	interface Props {
		items: TocItem[];
		onNavigate: (href: string) => void;
	}

	let { items, onNavigate }: Props = $props();

	let activeHref = $state<string | null>(null);

	type FlatTocItem = TocItem & { depth: number };

	function handleClick(item: TocItem) {
		activeHref = item.href;
		onNavigate(item.href);
	}

	function handleKeydown(event: KeyboardEvent, item: TocItem) {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			handleClick(item);
		}
	}

	function flattenItems(source: TocItem[], depth = 0): FlatTocItem[] {
		const result: FlatTocItem[] = [];
		for (const item of source) {
			result.push({ ...item, depth });
			if (item.subitems?.length) {
				result.push(...flattenItems(item.subitems, depth + 1));
			}
		}
		return result;
	}

	let flatItems = $derived(flattenItems(items));
</script>

<div class="epub-toc-panel">
	{#if flatItems.length === 0}
		<div class="epub-placeholder">目录还没有加载出来，请稍后再试。</div>
	{:else}
		<div class="epub-toc-list" aria-label="目录">
			{#each flatItems as item}
				<div
					class="epub-toc-item"
					class:active={activeHref === item.href}
					style={`--toc-depth:${item.depth};`}
					onclick={() => handleClick(item)}
					onkeydown={(event) => handleKeydown(event, item)}
					role="button"
					tabindex="0"
				>
					<span class="toc-bullet" aria-hidden="true"></span>
					<span class="toc-title">{item.label}</span>
					{#if item.pageNumber}
						<span class="toc-page">{item.pageNumber}</span>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.epub-toc-panel {
		display: flex;
		flex-direction: column;
		padding: 10px 0 18px;
	}

	.epub-placeholder {
		margin: 4px 12px 0;
		padding: 22px 14px;
		border-radius: 16px;
		background: color-mix(in srgb, var(--weave-elevated-background, var(--background-secondary)) 88%, transparent);
		color: var(--text-muted);
		font-size: 13px;
		line-height: 1.7;
	}

	.epub-toc-list {
		display: flex;
		flex-direction: column;
	}

	.epub-toc-item {
		--indent: calc(var(--toc-depth, 0) * 18px);
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 12px 8px calc(16px + var(--indent));
		color: var(--text-muted);
		cursor: pointer;
		border-left: 2px solid transparent;
		transition: background-color 0.14s ease, color 0.14s ease, border-color 0.14s ease;
	}

	.epub-toc-item:hover,
	.epub-toc-item:focus-visible {
		background: color-mix(in srgb, var(--background-modifier-hover) 88%, transparent);
		color: var(--text-normal);
		outline: none;
	}

	.epub-toc-item.active {
		background: color-mix(in srgb, var(--interactive-accent) 10%, transparent);
		color: var(--text-normal);
		border-left-color: var(--interactive-accent);
	}

	.toc-bullet {
		flex: 0 0 auto;
		width: 4px;
		height: 4px;
		border-radius: 999px;
		background: color-mix(in srgb, var(--text-faint) 72%, transparent);
	}

	.epub-toc-item.active .toc-bullet {
		background: var(--interactive-accent);
	}

	.toc-title {
		flex: 1;
		min-width: 0;
		font-size: 13px;
		line-height: 1.55;
		word-break: break-word;
	}

	.toc-page {
		flex: 0 0 auto;
		margin-left: 10px;
		color: var(--text-faint);
		font-size: 12px;
		line-height: 1;
		font-variant-numeric: tabular-nums;
	}

	.epub-toc-item.active .toc-page {
		color: color-mix(in srgb, var(--interactive-accent) 72%, var(--text-muted) 28%);
	}
</style>
