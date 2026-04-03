<script lang="ts">
	import { onMount } from 'svelte';
	import { logger } from '../../utils/logger';
	import type { EpubBook, Note } from '../../services/epub';
	import type { EpubAnnotationService } from '../../services/epub';
	import type { EpubBacklinkHighlightService } from '../../services/epub/EpubBacklinkHighlightService';
	import { EpubLinkService } from '../../services/epub/EpubLinkService';
	import EpubAnnotationCard from './EpubAnnotationCard.svelte';

	interface Props {
		book: EpubBook | null;
		annotationService: EpubAnnotationService;
		backlinkService?: EpubBacklinkHighlightService;
		filePath?: string;
		annotationRevision?: number;
		onNavigate?: (cfi: string, text?: string, color?: string) => void;
	}

	let { book, annotationService, backlinkService, filePath, annotationRevision = 0, onNavigate }: Props = $props();

	type HighlightColor = 'yellow' | 'green' | 'blue' | 'red' | 'purple';

	interface DisplayHighlight {
		cfiRange: string;
		text: string;
		color: HighlightColor;
		createdTime: number;
		sourceFile?: string;
	}

	interface DisplayNote extends Note {
		color: HighlightColor;
	}

	let highlights = $state<DisplayHighlight[]>([]);
	let notes = $state<DisplayNote[]>([]);
	let loading = $state(false);
	let annotationLoadToken = 0;
	let panelDisposed = false;

	function formatTime(timestamp: number): string {
		if (!timestamp) return '';
		const date = new Date(timestamp);
		const y = date.getFullYear();
		const m = String(date.getMonth() + 1).padStart(2, '0');
		const d = String(date.getDate()).padStart(2, '0');
		const h = String(date.getHours()).padStart(2, '0');
		const min = String(date.getMinutes()).padStart(2, '0');
		return `${y}-${m}-${d} ${h}:${min}`;
	}

	function getSourceLabel(sourceFile?: string): string {
		return sourceFile ? (sourceFile.split('/').pop() || sourceFile) : '';
	}

	function navigateToHighlight(hl: DisplayHighlight) {
		if (hl.cfiRange) {
			onNavigate?.(hl.cfiRange, hl.text, hl.color);
		}
	}

	function navigateToNote(note: DisplayNote) {
		if (note.cfi) {
			onNavigate?.(note.cfi, note.quotedText || note.content, note.color);
		}
	}

	function normalizeColor(color?: string): HighlightColor {
		switch (color) {
			case 'green':
			case 'blue':
			case 'red':
			case 'purple':
				return color;
			case 'pink':
				return 'red';
			default:
				return 'yellow';
		}
	}

	function isStaleAnnotationsLoad(loadToken: number, expectedBookId: string, expectedFilePath?: string): boolean {
		return panelDisposed
			|| loadToken !== annotationLoadToken
			|| book?.id !== expectedBookId
			|| (filePath ?? '') !== (expectedFilePath ?? '');
	}

	async function loadAnnotations() {
		const currentBook = book;
		if (!currentBook) {
			highlights = [];
			notes = [];
			loading = false;
			return;
		}
		const expectedFilePath = filePath;
		const loadToken = ++annotationLoadToken;
		loading = true;
		try {
			const [allHighlights, allNotes] = await Promise.all([
				backlinkService && expectedFilePath
					? annotationService.collectAllHighlights(currentBook.id, expectedFilePath, backlinkService)
					: annotationService.getHighlights(currentBook.id),
				annotationService.getNotes(currentBook.id)
			]);
			if (isStaleAnnotationsLoad(loadToken, currentBook.id, expectedFilePath)) {
				return;
			}

			const mappedHighlights = allHighlights
				.map((highlight) => ({
					cfiRange: highlight.cfiRange,
					text: highlight.text || '',
					color: normalizeColor(highlight.color),
					createdTime: highlight.createdTime || 0,
					sourceFile: 'sourceFile' in highlight ? highlight.sourceFile : undefined
				}))
				.sort((a, b) => (b.createdTime || 0) - (a.createdTime || 0));

			const colorByCfi = new Map<string, HighlightColor>();
			for (const highlight of mappedHighlights) {
				colorByCfi.set(EpubLinkService.normalizeCfi(highlight.cfiRange), highlight.color);
			}

			highlights = mappedHighlights;
			notes = allNotes
				.map((note) => ({
					...note,
					color: note.cfi ? (colorByCfi.get(EpubLinkService.normalizeCfi(note.cfi)) || 'yellow') : 'yellow'
				}))
				.sort((a, b) => b.createdTime - a.createdTime);
		} catch (error) {
			if (isStaleAnnotationsLoad(loadToken, currentBook.id, expectedFilePath)) {
				return;
			}
			logger.error('[NotesPanel] Failed to load annotations:', error);
			highlights = [];
			notes = [];
		} finally {
			if (!isStaleAnnotationsLoad(loadToken, currentBook.id, expectedFilePath)) {
				loading = false;
			}
		}
	}

	$effect(() => {
		annotationRevision;
		if (book && annotationService) {
			void loadAnnotations();
		} else {
			annotationLoadToken += 1;
			highlights = [];
			notes = [];
			loading = false;
		}
	});

	onMount(() => {
		return () => {
			panelDisposed = true;
			annotationLoadToken += 1;
		};
	});
</script>

<div class="epub-notes-panel">
	{#if loading}
		<div class="epub-placeholder">正在加载摘录与笔记...</div>
	{:else if highlights.length === 0 && notes.length === 0}
		<div class="epub-placeholder">暂时还没有摘录或笔记，阅读时选中文本后就可以在这里回看。</div>
	{:else}
		{#if highlights.length > 0}
			<section class="notes-section">
				<div class="notes-section-list">
					{#each highlights as hl}
						<EpubAnnotationCard
							clickable={true}
							onActivate={() => navigateToHighlight(hl)}
							color={hl.color}
							quoteText={hl.text}
							metaLeft={getSourceLabel(hl.sourceFile)}
							metaRight={formatTime(hl.createdTime)}
						/>
					{/each}
				</div>
			</section>
		{/if}

		{#if notes.length > 0}
			<section class="notes-section" aria-labelledby="epub-notes-heading">
				<div class="notes-section-header">
					<h3 class="notes-section-title" id="epub-notes-heading">笔记批注</h3>
					<span class="notes-section-count">{notes.length}</span>
				</div>
				<div class="notes-section-list">
					{#each notes as note}
						<EpubAnnotationCard
							clickable={true}
							onActivate={() => navigateToNote(note)}
							color={note.color}
							quoteText={note.quotedText || ''}
							commentText={note.content}
							metaRight={formatTime(note.createdTime)}
							commentMuted={true}
						/>
					{/each}
				</div>
			</section>
		{/if}
	{/if}
</div>

<style>
	.epub-notes-panel {
		display: flex;
		flex-direction: column;
		gap: 16px;
		padding: 14px 12px 22px;
	}

	.epub-placeholder {
		padding: 22px 14px;
		border-radius: 16px;
		background: color-mix(in srgb, var(--weave-elevated-background, var(--background-secondary)) 88%, transparent);
		color: var(--text-muted);
		font-size: 13px;
		line-height: 1.7;
	}

	.notes-section {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.notes-section-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 0 4px;
	}

	.notes-section-title {
		margin: 0;
		font-size: 15px;
		font-weight: 600;
		line-height: 1.25;
		color: var(--text-normal);
	}

	.notes-section-count {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 4px 10px;
		border-radius: 999px;
		background: color-mix(in srgb, var(--weave-elevated-background, var(--background-secondary)) 92%, transparent);
		border: 1px solid color-mix(in srgb, var(--background-modifier-border) 68%, transparent);
		color: var(--text-muted);
		font-size: 12px;
		font-weight: 600;
		line-height: 1;
	}

	.notes-section-list {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
</style>
