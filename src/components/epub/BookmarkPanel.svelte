	<script lang="ts">
		import { Menu, Notice, setIcon } from 'obsidian';
		import type { Bookmark, EpubBook, EpubReaderEngine } from '../../services/epub';
		import type { EpubAnnotationService } from '../../services/epub';
		import { epubActiveDocumentStore } from '../../stores/epub-active-document-store';

	interface Props {
		book: EpubBook | null;
		annotationService: EpubAnnotationService;
		readerService?: EpubReaderEngine;
		annotationRevision?: number;
		onNavigate: (cfi: string, text?: string, color?: string) => void;
	}

	type DisplayBookmark = Bookmark & { resolvedPageNumber?: number };

	let { book, annotationService, readerService, annotationRevision = 0, onNavigate }: Props = $props();

	let bookmarks = $state<DisplayBookmark[]>([]);

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

	async function loadBookmarks() {
		if (!book) {
			bookmarks = [];
			return;
		}
		try {
			const storedBookmarks = await annotationService.getBookmarks(book.id);
			const hydratedBookmarks = await Promise.all(
				storedBookmarks.map(async (bookmark) => ({
					...bookmark,
					resolvedPageNumber: bookmark.pageNumber ?? await readerService?.getPageNumberFromCfi(bookmark.cfi)
				}))
			);
			bookmarks = hydratedBookmarks.sort((a, b) => b.createdTime - a.createdTime);
		} catch (_e) {
			bookmarks = [];
		}
	}

	async function removeBookmark(bookmark: DisplayBookmark) {
		if (!book) {
			return;
		}

		try {
			await annotationService.deleteBookmark(book.id, bookmark.id);
			bookmarks = bookmarks.filter((item) => item.id !== bookmark.id);

			const { annotationRevision: currentRevision = 0 } = epubActiveDocumentStore.getSharedState();
			epubActiveDocumentStore.setSharedState({ annotationRevision: currentRevision + 1 });
			new Notice('书签已移除');
		} catch (_e) {
			new Notice('移除书签失败');
		}
	}

	function showBookmarkContextMenu(event: MouseEvent, bookmark: DisplayBookmark) {
		event.preventDefault();

		const menu = new Menu();
		menu.addItem((item) => {
			item.setTitle('移除书签');
			item.setIcon('trash');
			item.onClick(() => {
				void removeBookmark(bookmark);
			});
		});
		menu.showAtMouseEvent(event);
	}

	$effect(() => {
		annotationRevision;
		if (book) {
			void loadBookmarks();
		}
	});
</script>

<div class="epub-bookmark-panel">
	{#if bookmarks.length === 0}
		<div class="epub-placeholder">暂无书签。阅读时点击书签按钮，即可把当前位置保存到这里。</div>
	{:else}
		<div class="epub-bookmark-list">
			{#each bookmarks as bm}
				<div
					class="epub-bookmark-item"
					onclick={() => onNavigate(bm.cfi, bm.preview)}
					oncontextmenu={(event) => showBookmarkContextMenu(event, bm)}
					onkeydown={(event) => {
						if (event.key === 'Enter' || event.key === ' ') {
							event.preventDefault();
							onNavigate(bm.cfi, bm.preview);
						}
					}}
					role="button"
					tabindex="0"
				>
					<div class="bookmark-leading">
						<span class="bookmark-icon" use:icon={'bookmark'}></span>
					</div>
					<div class="bookmark-body">
						<div class="bookmark-title-row">
							<div class="bookmark-title">{bm.title || '未命名位置'}</div>
							<div class="bookmark-page">
								{#if bm.resolvedPageNumber}
									第 {bm.resolvedPageNumber} 页
								{:else}
									页码未知
								{/if}
							</div>
						</div>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.epub-bookmark-panel {
		display: flex;
		flex-direction: column;
		padding: 14px 12px 22px;
	}

	.epub-placeholder {
		padding: 22px 14px;
		border-radius: 16px;
		background: color-mix(in srgb, var(--weave-elevated-background, var(--background-secondary)) 88%, transparent);
		color: var(--text-muted);
		font-size: 13px;
		line-height: 1.7;
		overflow-wrap: anywhere;
	}

	.epub-bookmark-list {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.epub-bookmark-item {
		display: flex;
		align-items: stretch;
		gap: 12px;
		padding: 12px;
		border-radius: 16px;
		border: 1px solid color-mix(in srgb, var(--background-modifier-border) 72%, transparent);
		background:
			linear-gradient(
				180deg,
				color-mix(in srgb, var(--weave-elevated-background, var(--background-primary)) 96%, transparent),
				color-mix(in srgb, var(--weave-surface-background, var(--background-secondary)) 90%, transparent)
			);
		box-shadow: 0 8px 20px rgba(0, 0, 0, 0.05);
		cursor: pointer;
		transition: transform 0.16s ease, box-shadow 0.16s ease, border-color 0.16s ease;
	}

	.epub-bookmark-item:hover,
	.epub-bookmark-item:focus-visible {
		transform: translateY(-1px);
		border-color: color-mix(in srgb, var(--interactive-accent) 28%, transparent);
		box-shadow: 0 12px 28px rgba(0, 0, 0, 0.08);
		outline: none;
	}

	.bookmark-leading {
		flex: 0 0 auto;
		display: flex;
		align-items: flex-start;
		padding-top: 2px;
	}

	.bookmark-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		border-radius: 10px;
		background: color-mix(in srgb, var(--interactive-accent) 12%, var(--weave-surface-background, var(--background-secondary)) 88%);
		color: var(--interactive-accent);
	}

	.bookmark-icon :global(.svg-icon) {
		width: 15px;
		height: 15px;
	}

	.bookmark-body {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		justify-content: center;
	}

	.bookmark-title-row {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 12px;
		min-width: 0;
	}

	.bookmark-title {
		min-width: 0;
		flex: 1;
		font-size: 14px;
		font-weight: 600;
		line-height: 1.35;
		color: var(--text-normal);
		overflow-wrap: anywhere;
		word-break: break-word;
	}

	.bookmark-page {
		flex-shrink: 0;
		font-size: 12px;
		line-height: 1.4;
		color: var(--text-muted);
		text-align: right;
		white-space: nowrap;
		max-width: 100%;
	}

	@media (max-width: 520px) {
		.epub-bookmark-panel {
			padding: 12px 10px 18px;
		}

		.epub-bookmark-item {
			gap: 10px;
			padding: 11px;
			border-radius: 14px;
		}

		.bookmark-title-row {
			flex-direction: column;
			gap: 4px;
		}

		.bookmark-page {
			text-align: left;
			white-space: normal;
		}
	}
</style>
