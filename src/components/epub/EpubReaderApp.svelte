<script lang="ts">
        import type { App, WorkspaceLeaf, TAbstractFile, EventRef } from 'obsidian';
        import { setIcon, MarkdownView, Notice, Menu, TFile, Platform, SuggestModal, TFolder } from 'obsidian';
	import { onMount } from 'svelte';
	import EpubReaderView from './EpubReaderView.svelte';
	import BottomNav from './BottomNav.svelte';
	import SelectionToolbar from './SelectionToolbar.svelte';
	import ScreenshotOverlay from './ScreenshotOverlay.svelte';
	import EpubTutorial from './EpubTutorial.svelte';
	import EpubHighlightToolbar from './EpubHighlightToolbar.svelte';
	import { ReadiumReaderService, EpubStorageService, EpubAnnotationService, EpubLinkService, EpubLocationMigrationService } from '../../services/epub';
	import type { EpubExcerptSettings, EpubBookshelfSettings, EpubBookshelfSourceMode } from '../../services/epub/EpubStorageService';
	import { DEFAULT_EPUB_BOOKSHELF_SETTINGS } from '../../services/epub/EpubStorageService';
	import { EpubBacklinkHighlightService } from '../../services/epub/EpubBacklinkHighlightService';
	import { IREpubBookmarkTaskService } from '../../services/incremental-reading/IREpubBookmarkTaskService';
	import { EpubScreenshotService } from '../../services/epub/EpubScreenshotService';
	import { EpubCanvasService } from '../../services/epub/EpubCanvasService';
	import type { EpubVisibleFrameLike, ScreenshotRect } from '../../services/epub/EpubScreenshotService';
	import type { EpubBook, EpubFlowMode, EpubLayoutMode, EpubReaderEngine, EpubReaderSettings, EpubTheme, FlashStyle, HighlightClickInfo, PaginationInfo, ReaderHighlight } from '../../services/epub';
	import { epubActiveDocumentStore } from '../../stores/epub-active-document-store';
	import { logger } from '../../utils/logger';
	import { openFileWithExistingLeaf } from '../../utils/workspace-navigation';
	import { getSourceLocateOverlayService } from '../../services/ui/SourceLocateOverlayService';
	import { SourceNavigationService } from '../../services/ui/SourceNavigationService';
	import '../../styles/epub/epub-reader.css';

	interface Props {
		app: App;
		filePath: string;
		pendingCfi?: string;
		pendingText?: string;
		autoInsertEnabled?: boolean;
		getLastActiveMarkdownLeaf?: () => WorkspaceLeaf | null;
		onTitleChange?: (title: string) => void;
		onReaderSettingsLoaded?: (settings: EpubReaderSettings) => void;
		onActionsReady?: (actions: {
			setAutoInsert: (enabled: boolean) => void;
			setScreenshotMode: (active: boolean) => void;
			setLayoutMode: (mode: EpubLayoutMode) => void;
			setFlowMode: (mode: EpubFlowMode) => void;
			setScreenshotSaveMode: (saveAsImage: boolean) => void;
			forceReflow: () => Promise<void>;
			navigateToCfi: (cfi: string, text: string) => void;
			toggleTutorial: () => void;
			addBookmark: () => Promise<void>;
			bindCanvasPath: (canvasPath: string) => void;
			unbindCanvas: () => void;
			getCanvasService: () => EpubCanvasService;
			markIRResumePoint: () => Promise<void>;
		}) => void;
		onSwitchBook?: (filePath: string) => void;
		onCanvasStateChange?: (active: boolean, canvasPath: string | null) => void;
	}

	let { app, filePath, pendingCfi = '', pendingText = '', autoInsertEnabled: initialAutoInsert = false, getLastActiveMarkdownLeaf, onTitleChange, onReaderSettingsLoaded, onActionsReady, onSwitchBook, onCanvasStateChange }: Props = $props();

	function getDefaultReaderLineHeight(): number {
		return Platform.isMobile ? 1.66 : 1.72;
	}

	function getDefaultReaderWidthMode(): EpubReaderSettings['widthMode'] {
		return Platform.isMobile ? 'full' : 'standard';
	}

	function getDefaultReaderFlowMode(): EpubReaderSettings['flowMode'] {
		return 'paginated';
	}

	let readerService: EpubReaderEngine = new ReadiumReaderService(app);
	let storageService = new EpubStorageService(app);
	let annotationService = new EpubAnnotationService(storageService);
	let locationMigrationService = new EpubLocationMigrationService(app, storageService, readerService);
	let linkService = new EpubLinkService(app);
	let screenshotService = new EpubScreenshotService(app);
	let canvasService = new EpubCanvasService(app);
	let backlinkService = new EpubBacklinkHighlightService(app);

	let book = $state<EpubBook | null>(null);
	let loading = $state(true);
	let errorMsg = $state('');
	let readingProgress = $state(0);
	let paginationInfo = $state<PaginationInfo>({ currentPage: 0, totalPages: 0 });
	let readerVersion = $state(0);
	let autoInsert = $state(initialAutoInsert);
	let screenshotMode = $state(false);
	let screenshotSaveAsImage = $state(true);
	let tutorialVisible = $state(false);
	let canvasMode = $state(false);
	let transientStatusText = $state('');
	let rootEl = $state<HTMLDivElement | undefined>(undefined);
	let viewportEl = $state<HTMLDivElement | undefined>(undefined);
	let highlightToolbarInfo = $state<HighlightClickInfo | null>(null);
	const EPUB_LOCATE_LINK_PREFIX = '__weave_epub_link__=';
	const EPUB_LOCATE_CFI_PREFIX = '__weave_epub_cfi__=';
	const EPUB_LOCATE_TIME_PREFIX = '__weave_epub_time__=';
	let excerptSettings = $state<EpubExcerptSettings>({ addCreationTime: false });
	let trackedHighlightSourceFiles = new Set<string>();
	let vaultEventRefs: EventRef[] = [];
	let pendingLoadedHighlights: ReaderHighlight[] | null = null;
	let highlightReloadToken = 0;
	let annotationRevision = $state(0);
	let migratedLocationBookIds = new Set<string>();
	let migratingLocationBookId: string | null = null;
	const sourceLocateOverlay = getSourceLocateOverlayService();
	const sourceNavigationService = new SourceNavigationService(app);

	type ReaderNavigationIntent = {
		cfi?: string;
		href?: string;
		text?: string;
		flashStyle?: FlashStyle;
		showLocateOverlay?: boolean;
	};

	// IR/navigation buffer: store navigation intent until the reader is ready
	let pendingIRNav = $state<ReaderNavigationIntent | null>(null);
	let readerReady = $state(false);
	let transientStatusTimer: ReturnType<typeof setTimeout> | null = null;
	let deferredHighlightReloadTimer: ReturnType<typeof setTimeout> | null = null;
	let componentDisposed = false;
	let activeBookLoadToken = 0;

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

	let settings = $state<EpubReaderSettings>({
		lineHeight: getDefaultReaderLineHeight(),
		theme: 'default',
		widthMode: getDefaultReaderWidthMode(),
		layoutMode: 'paginated',
		flowMode: getDefaultReaderFlowMode(),
		showScrolledSideNav: true
	});

	function isMobileReader(): boolean {
		return Platform.isMobile;
	}

	function normalizeReaderSettings(readerSettings: EpubReaderSettings): EpubReaderSettings {
		const normalizedSettings: EpubReaderSettings = {
			...readerSettings,
			lineHeight: typeof readerSettings.lineHeight === 'number' && readerSettings.lineHeight > 0
				? readerSettings.lineHeight
				: getDefaultReaderLineHeight(),
			widthMode: readerSettings.widthMode === 'standard' || readerSettings.widthMode === 'full'
				? readerSettings.widthMode
				: getDefaultReaderWidthMode(),
		};

		if (normalizedSettings.flowMode === 'scrolled') {
			normalizedSettings.layoutMode = 'paginated';
		}

		if (isMobileReader() && normalizedSettings.layoutMode === 'double') {
			normalizedSettings.layoutMode = 'paginated';
		}

		if (normalizedSettings.layoutMode === 'double') {
			normalizedSettings.widthMode = 'full';
		}

		return normalizedSettings;
	}

	function setError(message: string) {
		clearTransientStatus();
		errorMsg = message;
		loading = false;
	}

	function clearTransientStatus() {
		if (transientStatusTimer) {
			clearTimeout(transientStatusTimer);
			transientStatusTimer = null;
		}
		transientStatusText = '';
	}

	function showTransientStatus(message: string, durationMs = 2200) {
		if (transientStatusTimer) {
			clearTimeout(transientStatusTimer);
			transientStatusTimer = null;
		}
		transientStatusText = message;
		if (durationMs > 0) {
			transientStatusTimer = setTimeout(() => {
				transientStatusTimer = null;
				transientStatusText = '';
			}, durationMs);
		}
	}

	function isStaleBookLoad(loadToken: number): boolean {
		return componentDisposed || loadToken !== activeBookLoadToken;
	}

	function rememberHighlightSourcePath(path?: string | null) {
		const normalizedPath = String(path || '').trim();
		if (!normalizedPath) {
			return;
		}
		trackedHighlightSourceFiles.add(normalizedPath);
	}

	function queueHighlightReload(delayMs = 350) {
		if (componentDisposed) {
			return;
		}
		if (deferredHighlightReloadTimer) {
			clearTimeout(deferredHighlightReloadTimer);
		}
		deferredHighlightReloadTimer = setTimeout(() => {
			deferredHighlightReloadTimer = null;
			if (!componentDisposed) {
				void reloadHighlights();
			}
		}, delayMs);
	}

        function getWeavePlugin(): any {
                return (app as any)?.plugins?.getPlugin?.('weave');
        }

        class EpubFolderSuggestModal extends SuggestModal<string> {
                private folders: string[];
                private onChoose: (folderPath: string) => void;

                constructor(app: App, folders: string[], onChoose: (folderPath: string) => void) {
                        super(app);
                        this.folders = folders;
                        this.onChoose = onChoose;
                        this.setPlaceholder('选择 EPUB 书架文件夹...');
                }

                getSuggestions(query: string): string[] {
                        const normalizedQuery = (query || '').trim().toLowerCase();
                        if (!normalizedQuery) {
                                return this.folders;
                        }
                        return this.folders.filter((folder) => folder.toLowerCase().includes(normalizedQuery));
                }

                renderSuggestion(folder: string, el: HTMLElement): void {
                        el.setText(folder);
                }

                onChooseSuggestion(folder: string, _evt: MouseEvent | KeyboardEvent): void {
                        this.onChoose(folder);
                }
        }

        function buildFolderList(): string[] {
                const result: string[] = [];

                function traverse(folder: TFolder) {
                        if (folder.path) {
                                result.push(folder.path);
                        }

                        for (const child of folder.children) {
                                if (child instanceof TFolder) {
                                        traverse(child);
                                }
                        }
                }

                traverse(app.vault.getRoot());
                result.sort((a, b) => a.localeCompare(b, 'zh-CN'));
                return result;
        }

        function getBookshelfSettings(): EpubBookshelfSettings {
                const plugin = getWeavePlugin();
                if (plugin && typeof plugin.getEpubBookshelfSettings === 'function') {
                        return plugin.getEpubBookshelfSettings();
                }
                return { ...DEFAULT_EPUB_BOOKSHELF_SETTINGS };
        }

        async function saveBookshelfSettings(nextSettings: Partial<EpubBookshelfSettings>, noticeMessage?: string) {
                const plugin = getWeavePlugin();
                if (!plugin || typeof plugin.saveEpubBookshelfSettings !== 'function') {
                        new Notice('weave：无法保存 EPUB 书架设置');
                        return;
                }

                await plugin.saveEpubBookshelfSettings({
                        ...DEFAULT_EPUB_BOOKSHELF_SETTINGS,
                        ...getBookshelfSettings(),
                        ...nextSettings
                });
                window.dispatchEvent(new CustomEvent('Weave:epub-bookshelf-settings-changed'));

                if (noticeMessage) {
                        new Notice(noticeMessage);
                }
        }

        async function requestBookshelfRefresh() {
                const bookshelfSettings = getBookshelfSettings();
                if (bookshelfSettings.sourceMode === 'folder-only' && !bookshelfSettings.sourceFolder) {
                        new Notice('weave：请先选择 EPUB 书架指定文件夹');
                        return;
                }

                const scopeLabel = bookshelfSettings.sourceMode === 'folder-only' && bookshelfSettings.sourceFolder
                        ? `指定文件夹“${bookshelfSettings.sourceFolder}”`
                        : '当前仓库';

                try {
                        const result = await storageService.pruneMissingBooks();
                        const rebuilt = bookshelfSettings.sourceMode === 'folder-only'
                                ? await storageService.rebuildBookshelfIndex(bookshelfSettings.sourceFolder)
                                : await storageService.rebuildBookshelfIndex();

                        window.dispatchEvent(new CustomEvent('Weave:epub-bookshelf-settings-changed'));

                        const cleanupText = result.removedPaths.length > 0
                                ? `，并清理 ${result.removedPaths.length} 条失效缓存`
                                : '';
                        new Notice(`weave：已刷新 ${scopeLabel} 的 EPUB 书架，共 ${rebuilt.length} 本${cleanupText}`);
                } catch (error) {
                        logger.error('[EpubReaderApp] Failed to refresh EPUB bookshelf:', error);
                        new Notice('weave：刷新 EPUB 书架失败');
                }
        }

        function openBookshelfFolderPicker() {
                const folders = buildFolderList();
                if (folders.length === 0) {
                        new Notice('weave：当前仓库没有可选文件夹');
                        return;
                }

                const modal = new EpubFolderSuggestModal(app, folders, (folderPath) => {
                        void saveBookshelfSettings(
                                {
                                        sourceMode: 'folder-only',
                                        sourceFolder: folderPath
                                },
                                `weave：EPUB 书架已切换为指定文件夹：${folderPath}`
                        );
                });
                modal.open();
        }

        async function handleBookshelfModeChange(mode: EpubBookshelfSourceMode) {
                if (mode === 'folder-only' && !getBookshelfSettings().sourceFolder) {
                        openBookshelfFolderPicker();
                        return;
                }

                await saveBookshelfSettings(
                        { sourceMode: mode },
                        mode === 'folder-only'
                                ? 'weave：EPUB 书架已切换为指定文件夹模式'
                                : 'weave：EPUB 书架已切换为缓存优先模式'
                );
        }

	function getCreateCardPlugin(): { openCreateCardModal?: (input: { initialContent: string }) => Promise<void> } | null {
		const plugin = getWeavePlugin();
		if (!plugin?.openCreateCardModal) {
			new Notice('创建卡片功能暂不可用');
			return null;
		}
		return plugin;
	}

	async function extractContentToCard(
		content: string,
		successMessage: string,
		errorLogLabel: string,
		failureMessage: string,
		onSuccess?: () => void
	) {
		try {
			const plugin = getCreateCardPlugin();
			if (!plugin?.openCreateCardModal) return;

			await plugin.openCreateCardModal({
				initialContent: `${content}\n---div---\n\n`
			});
			onSuccess?.();
			new Notice(successMessage);
		} catch (error) {
			logger.error(`[EpubReaderApp] ${errorLogLabel}:`, error);
			new Notice(failureMessage);
		}
	}

	function applyAndPersistReaderSettings(nextSettings: EpubReaderSettings) {
		const normalizedSettings = normalizeReaderSettings(nextSettings);
		settings = normalizedSettings;
		onReaderSettingsLoaded?.(normalizedSettings);
		void storageService.saveReaderSettings(normalizedSettings);
	}

	function canReuseExistingBook(existingBook: EpubBook | null, vaultFile: TFile): existingBook is EpubBook {
		if (!existingBook) {
			return false;
		}

		const storedSize = typeof existingBook.sourceSize === 'number' && Number.isFinite(existingBook.sourceSize)
			? existingBook.sourceSize
			: null;
		const storedMtime = typeof existingBook.sourceMtime === 'number' && Number.isFinite(existingBook.sourceMtime)
			? existingBook.sourceMtime
			: null;

		if (storedSize === null && storedMtime === null) {
			return true;
		}

		if (storedSize !== null && storedSize !== vaultFile.stat.size) {
			return false;
		}

		if (storedMtime !== null && storedMtime !== vaultFile.stat.mtime) {
			return false;
		}

		return true;
	}

	async function loadBook() {
		const loadToken = ++activeBookLoadToken;
		const targetFilePath = filePath;
		loading = true;
		errorMsg = '';
		readerReady = false;
		pendingLoadedHighlights = null;
		highlightToolbarInfo = null;
		try {
			const vaultFile = app.vault.getAbstractFileByPath(targetFilePath);
			if (!(vaultFile instanceof TFile) || vaultFile.extension !== 'epub') {
				await storageService.pruneMissingBooks();
				throw new Error('EPUB 文件不存在，已从书架索引中清理');
			}

			const existingBook = await storageService.findBookByFilePath(targetFilePath);
			if (isStaleBookLoad(loadToken)) {
				return;
			}
			const reusableBook = canReuseExistingBook(existingBook, vaultFile) ? existingBook : null;
			if (existingBook && !reusableBook) {
				await storageService.removeBookByFilePath(targetFilePath);
				showTransientStatus('检测到 EPUB 文件已更新，已按新导入重建阅读缓存', 3200);
			}
			const loadedBook = await Promise.race([
				readerService.loadEpub(targetFilePath, reusableBook?.id),
				new Promise<never>((_, reject) => {
					window.setTimeout(() => reject(new Error('EPUB 加载超时，请刷新书架后重试')), 15000);
				})
			]);

			if (isStaleBookLoad(loadToken)) {
				return;
			}

			if (reusableBook) {
				loadedBook.readingStats = reusableBook.readingStats;
			}

			const migratedProgress = await storageService.loadProgress(loadedBook.id);
			if (isStaleBookLoad(loadToken)) {
				return;
			}
			if (migratedProgress) {
				loadedBook.currentPosition = migratedProgress;
			} else if (reusableBook?.currentPosition) {
				loadedBook.currentPosition = reusableBook.currentPosition;
			}

			book = loadedBook;
			await storageService.saveBook(loadedBook);
			if (isStaleBookLoad(loadToken)) {
				return;
			}
			onTitleChange?.(loadedBook.metadata.title);
			epubActiveDocumentStore.setSharedState({ filePath: targetFilePath, book: loadedBook });
			syncAsActiveEpubDocument();
			await initCanvasBinding();
			if (isStaleBookLoad(loadToken)) {
				return;
			}
			void reloadHighlights();
		} catch (error) {
			if (isStaleBookLoad(loadToken)) {
				return;
			}
			logger.error('[EpubReaderApp] Failed to load EPUB:', error);
			setError(`${error instanceof Error ? error.message : '未知错误'}`);
		} finally {
			if (!isStaleBookLoad(loadToken)) {
				loading = false;
			}
		}
	}


	function toggleTutorial() {
		tutorialVisible = !tutorialVisible;
	}

	async function addBookmark() {
		if (!book) {
			new Notice('未加载书籍');
			return;
		}
		const bookId = book.id;
		try {
			const pos = readerService.getCurrentPosition();
			const currentCfi = EpubLinkService.normalizeCfi(
				pos.cfi || readerService.getCurrentCFI() || book.currentPosition?.cfi || ''
			);
			if (!currentCfi) {
				new Notice('无法获取当前阅读位置');
				return;
			}

			const existingBookmarks = await annotationService.getBookmarks(bookId);
			const matchedBookmarks = existingBookmarks.filter((bookmark) =>
				EpubLinkService.normalizeCfi(bookmark.cfi) === currentCfi
			);

			if (matchedBookmarks.length > 0) {
				await Promise.all(
					matchedBookmarks.map((bookmark) => annotationService.deleteBookmark(bookId, bookmark.id))
				);
				annotationRevision += 1;
				epubActiveDocumentStore.setSharedState({ annotationRevision });
				if (matchedBookmarks.length > 1) {
					new Notice('已移除 ' + matchedBookmarks.length + ' 个重复书签');
				} else {
					new Notice('书签已移除');
				}
				return;
			}

			const chapterTitle = readerService.getCurrentChapterTitle() || ('阅读位置 ' + Math.round(pos.percent) + '%');
			const preview = chapterTitle;
			await annotationService.createBookmark(
				bookId,
				chapterTitle,
				pos.chapterIndex,
				currentCfi,
				preview,
				settings.flowMode !== 'scrolled' && paginationInfo.currentPage > 0
					? paginationInfo.currentPage
					: undefined
			);
			annotationRevision += 1;
			epubActiveDocumentStore.setSharedState({ annotationRevision });
			new Notice('书签已添加');
		} catch (_e) {
			new Notice('书签操作失败');
		}
	}

        function showSettingsMenu(evt: MouseEvent) {
                const menu = new Menu();
                const bookshelfSettings = getBookshelfSettings();

                menu.addItem(item => {
                        item.setTitle('护眼模式');
			item.setIcon('sun');
			item.setChecked(settings.theme === 'sepia');
			item.onClick(() => {
				handleThemeChange(settings.theme === 'sepia' ? 'default' : 'sepia');
			});
		});

                menu.addSeparator();

                menu.addItem(item => {
                        item.setTitle('摘录时间戳');
			item.setIcon('clock');
			item.setChecked(excerptSettings.addCreationTime);
			item.onClick(async () => {
				excerptSettings = { ...excerptSettings, addCreationTime: !excerptSettings.addCreationTime };
                                await storageService.saveExcerptSettings(excerptSettings);
                        });
                });

                menu.addItem(item => {
                        item.setTitle('连续滚动侧边翻页键');
			item.setIcon('panel-right');
			item.setChecked(settings.showScrolledSideNav);
			item.onClick(() => {
				handleScrolledSideNavToggle(!settings.showScrolledSideNav);
			});
                });

                menu.addSeparator();

                menu.addItem(item => {
                        item.setTitle('书架来源：缓存优先');
                        item.setIcon('database');
                        item.setChecked(bookshelfSettings.sourceMode === 'cache-first');
                        item.onClick(() => {
                                void handleBookshelfModeChange('cache-first');
                        });
                });

                menu.addItem(item => {
                        item.setTitle('书架来源：仅指定文件夹');
                        item.setIcon('folder-open');
                        item.setChecked(bookshelfSettings.sourceMode === 'folder-only');
                        item.onClick(() => {
                                void handleBookshelfModeChange('folder-only');
                        });
                });

                menu.addItem(item => {
                        const folderLabel = bookshelfSettings.sourceFolder || '未设置';
                        item.setTitle(`指定文件夹：${folderLabel}`);
                        item.setIcon('folder-search');
                        item.onClick(() => {
                                openBookshelfFolderPicker();
                        });
                });

                if (bookshelfSettings.sourceFolder) {
                        menu.addItem(item => {
                                item.setTitle('清除指定文件夹');
                                item.setIcon('x');
                                item.onClick(() => {
                                        void saveBookshelfSettings(
                                                { sourceFolder: '', sourceMode: 'cache-first' },
                                                'weave：已清除 EPUB 书架指定文件夹，恢复缓存优先模式'
                                        );
                                });
                        });
                }

                menu.addItem(item => {
                        item.setTitle('立即刷新书架索引');
                        item.setIcon('refresh-cw');
                        item.onClick(() => {
                                void requestBookshelfRefresh();
                        });
                });

                menu.showAtMouseEvent(evt);
        }

	function handleThemeChange(theme: EpubTheme) {
		applyAndPersistReaderSettings({ ...settings, theme });
	}

	function handleLayoutModeChange(mode: EpubLayoutMode) {
		if (isMobileReader() && mode === 'double') {
			mode = 'paginated';
		}
		applyAndPersistReaderSettings({
			...settings,
			layoutMode: mode,
			widthMode: mode === 'double' ? 'full' : settings.widthMode,
			flowMode: 'paginated'
		});
	}

	function handleFlowModeChange(mode: EpubFlowMode) {
		applyAndPersistReaderSettings({
			...settings,
			layoutMode: mode === 'scrolled' ? 'paginated' : settings.layoutMode,
			flowMode: mode
		});
	}

	function handleScrolledSideNavToggle(enabled: boolean) {
		applyAndPersistReaderSettings({
			...settings,
			showScrolledSideNav: enabled
		});
	}

	function showBottomNav() {
		return settings.flowMode !== 'scrolled' || (!isMobileReader() && settings.showScrolledSideNav);
	}

	function useVerticalNav() {
		return settings.flowMode === 'scrolled';
	}

	function getBottomNavStatusText(): string | undefined {
		if (transientStatusText.trim()) {
			return transientStatusText;
		}
		if (!useVerticalNav()) {
			return undefined;
		}
		return `${Math.max(0, Math.round(readingProgress))}%`;
	}

	async function handlePrevPage() {
		await readerService.prevPage();
	}

	async function handleNextPage() {
		await readerService.nextPage();
	}

	async function forceReflow() {
		if (!book) {
			new Notice('书籍尚未加载完成');
			return;
		}

		showTransientStatus('重排中...', 0);

		try {
			const currentCfi = readerService.getCurrentCFI() || book.currentPosition?.cfi || '';
			const rect = viewportEl?.getBoundingClientRect();
			const width = Math.max(0, Math.round(rect?.width || 0));
			const height = Math.max(0, Math.round(rect?.height || 0));

			await readerService.setLayoutMode(settings.layoutMode, settings.flowMode, {
				theme: settings.theme,
				lineHeight: settings.lineHeight,
				widthMode: settings.widthMode,
			});

			if (width > 0 && height > 0) {
				readerService.resize(width, height);
			} else {
				readerService.resize(window.innerWidth || 0, window.innerHeight || 0);
			}

			if (currentCfi) {
				await readerService.goToLocation(currentCfi);
			}

			await readerService.refreshHighlights?.();
			showTransientStatus('已重排', 2000);
			new Notice('已触发正文重排版');
		} catch (error) {
			logger.error('[EpubReaderApp] forceReflow failed:', error);
			showTransientStatus('重排失败', 3200);
			new Notice(error instanceof Error ? `重排失败：${error.message}` : '重排失败');
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'ArrowLeft') {
			e.preventDefault();
			readerService.prevPage();
		} else if (e.key === 'ArrowRight') {
			e.preventDefault();
			readerService.nextPage();
		}
	}

	function buildNoteContent(text: string, cfiRange: string, color?: string): string {
		const chapterIndex = readerService.getCurrentChapterIndex();
		const chapterTitle = readerService.getCurrentChapterTitle();
		const timestamp = excerptSettings.addCreationTime ? formatTimestamp(new Date()) : undefined;
		return linkService.buildQuoteBlock(filePath, cfiRange, text, chapterIndex, color, chapterTitle, timestamp);
	}

	function formatTimestamp(date: Date): string {
		const y = date.getFullYear();
		const mo = String(date.getMonth() + 1).padStart(2, '0');
		const d = String(date.getDate()).padStart(2, '0');
		const h = String(date.getHours()).padStart(2, '0');
		const mi = String(date.getMinutes()).padStart(2, '0');
		return `${y}-${mo}-${d} ${h}:${mi}`;
	}

	function insertToEditor(content: string): string | null {
		const leaf = getLastActiveMarkdownLeaf?.();
		if (!leaf) {
			new Notice('未找到活动的 Markdown 编辑器');
			return null;
		}
		const view = leaf.view;
		if (!(view instanceof MarkdownView) || !view.editor) {
			new Notice('未找到活动的 Markdown 编辑器');
			return null;
		}
		const editor = view.editor;
		const cursor = editor.getCursor();
		editor.replaceRange(content + '\n', cursor);
		const lines = content.split('\n').length;
		editor.setCursor({ line: cursor.line + lines, ch: 0 });
		return view.file?.path || null;
	}

	function insertToEditorAndTrack(content: string, delayMs = 900) {
		const sourcePath = insertToEditor(content);
		rememberHighlightSourcePath(sourcePath);
		if (sourcePath) {
			queueHighlightReload(delayMs);
		}
	}

	async function copyTextToClipboard(content: string) {
		try {
			await navigator.clipboard.writeText(content);
			new Notice('已复制到剪贴板');
		} catch (_e) {
			new Notice('复制失败');
		}
	}

	async function copyImageToClipboard(blob: Blob) {
		try {
			await navigator.clipboard.write([
				new ClipboardItem({ [blob.type]: blob })
			]);
			new Notice('图片已复制到剪贴板');
		} catch (_e) {
			new Notice('图片复制失败');
		}
	}

	function outputNote(text: string, cfiRange: string, color?: string) {
		if (canvasMode && canvasService.isActive()) {
			addToCanvas(text, cfiRange, color);
			return;
		}

		const content = buildNoteContent(text, cfiRange, color);
		if (autoInsert) {
			insertToEditorAndTrack(content);
		} else {
			copyTextToClipboard(content);
		}
	}

	async function addToCanvas(text: string, cfiRange: string, color?: string) {
		const chapterIndex = readerService.getCurrentChapterIndex();
		const chapterTitle = readerService.getCurrentChapterTitle();

		canvasService.updateAnchorFromCanvasSelection(app);

		const timestamp = excerptSettings.addCreationTime ? formatTimestamp(new Date()) : undefined;
		const node = await canvasService.addExcerptNode(
			text, cfiRange, filePath, chapterIndex, chapterTitle, color, timestamp
		);
		if (node) {
			rememberHighlightSourcePath(canvasService.getCanvasPath());
			queueHighlightReload(120);
			new Notice('已添加到 Canvas');
		}
	}

	async function initCanvasBinding() {
		if (!book) return;
		const savedPath = await storageService.getCanvasBinding(book.id);
		if (savedPath) {
			const exists = await app.vault.adapter.exists(savedPath);
			if (exists) {
				canvasService.setCanvasPath(savedPath);
				canvasMode = true;
				onCanvasStateChange?.(true, savedPath);
			}
		}
	}

	async function bindCanvas(canvasPath: string) {
		if (!book) return;
		canvasService.setCanvasPath(canvasPath);
		await storageService.setCanvasBinding(book.id, canvasPath);
		canvasMode = true;
		onCanvasStateChange?.(true, canvasPath);
	}

	async function unbindCanvas() {
		if (!book) return;
		canvasService.setCanvasPath(null);
		canvasService.setAnchor(null);
		await storageService.removeCanvasBinding(book.id);
		canvasMode = false;
		onCanvasStateChange?.(false, null);
	}

	function handleInsertToNote(text: string, cfiRange: string, color?: string) {
		outputNote(text, cfiRange, color);
	}

	async function handleExtractToCard(text: string, cfiRange: string) {
		await extractContentToCard(
			buildNoteContent(text, cfiRange),
			'摘录已填充到创建卡片窗口',
			'Failed to extract selection to card',
			'摘录失败，请重试'
		);
	}

	async function handleHighlightExtractToCard(info: HighlightClickInfo) {
		await extractContentToCard(
			buildNoteContent(info.text, info.cfiRange, info.color),
			'高亮摘录已填充到创建卡片窗口',
			'Failed to extract highlight to card',
			'高亮摘录失败，请重试',
			() => {
				highlightToolbarInfo = null;
			}
		);
	}

        function handleAutoInsertSelection(text: string, cfiRange: string, color?: string) {
                outputNote(text, cfiRange, color);
        }

        async function handleConcealSelection(text: string, cfiRange: string) {
                if (!book) {
                        new Notice('当前书籍尚未加载完成');
                        return;
                }

                try {
                        const canonicalCfi = typeof readerService.canonicalizeLocation === 'function'
                                ? await readerService.canonicalizeLocation(cfiRange, text)
                                : cfiRange;
                        await annotationService.createConcealedText(
                                book.id,
                                text,
                                readerService.getCurrentChapterIndex(),
                                canonicalCfi || cfiRange,
                                'mask'
                        );
                        new Notice('已隐藏所选文本');
                        void reloadHighlights();
                } catch (error) {
                        logger.error('[EpubReaderApp] Failed to conceal selection:', error);
                        new Notice('隐藏文本失败，请重试');
                }
        }

        async function navigateToCfi(cfi: string, text: string) {
                await readerService.navigateAndHighlight({ cfi, text, flashStyle: 'highlight' });
		window.setTimeout(() => {
			const rect = readerService.getNavigationTargetRect({ cfi, text });
			if (rect) {
				sourceLocateOverlay.showAtRect(rect, { label: '定位到溯源位置', icon: 'map-pinned', durationMs: 2200 });
			}
		}, 80);
	}

	function getVisibleReaderFrames(): EpubVisibleFrameLike[] {
		return readerService.getVisibleFrames() as EpubVisibleFrameLike[];
	}

	async function handleScreenshotCapture(blob: Blob, rect: ScreenshotRect) {
		const currentCfi = readerService.getCurrentCFI();
		const chapterIndex = readerService.getCurrentChapterIndex();
		const chapterTitle = readerService.getCurrentChapterTitle();

		let canvasContent: string | null = null;

		if (autoInsert) {
			if (screenshotSaveAsImage) {
				const bookTitle = book?.metadata.title || 'epub';
				const imagePath = await screenshotService.saveAsJpeg(blob, bookTitle);
				const insertText = screenshotService.buildJpegInsert(imagePath, filePath, currentCfi, chapterIndex, chapterTitle);
				insertToEditorAndTrack(insertText);
				canvasContent = insertText;
			} else {
				const extractedText = screenshotService.extractTextFromRect(viewportEl!, rect, getVisibleReaderFrames());
				const insertText = screenshotService.buildSnapshotEmbed(filePath, currentCfi, extractedText, chapterIndex, chapterTitle);
				insertToEditorAndTrack(insertText);
				canvasContent = insertText;
			}
		} else {
			if (screenshotSaveAsImage) {
				const pngBlob = await convertToClipboardImage(blob);
				await copyImageToClipboard(pngBlob);
			} else {
				const extractedText = screenshotService.extractTextFromRect(viewportEl!, rect, getVisibleReaderFrames());
				const content = screenshotService.buildSnapshotEmbed(filePath, currentCfi, extractedText, chapterIndex, chapterTitle);
				await copyTextToClipboard(content);
				canvasContent = content;
			}
		}

		if (canvasMode && canvasService.isActive() && canvasContent) {
			canvasService.updateAnchorFromCanvasSelection(app);
			const node = await canvasService.addRawTextNode(canvasContent);
			if (node) {
				new Notice('截图已添加到 Canvas');
			}
		}
	}

	async function convertToClipboardImage(blob: Blob): Promise<Blob> {
		const img = new Image();
		const url = URL.createObjectURL(blob);
		return new Promise((resolve) => {
			img.onload = () => {
				const canvas = document.createElement('canvas');
				canvas.width = img.naturalWidth;
				canvas.height = img.naturalHeight;
				const ctx = canvas.getContext('2d')!;
				ctx.drawImage(img, 0, 0);
				URL.revokeObjectURL(url);
				canvas.toBlob((b) => resolve(b || blob), 'image/png');
			};
			img.onerror = () => {
				URL.revokeObjectURL(url);
				resolve(blob);
			};
			img.src = url;
		});
	}

	async function markIRResumePoint() {
		try {
			const currentCfi = readerService.getCurrentCFI();
			if (!currentCfi) {
				new Notice('没有可用的阅读位置');
				return;
			}

			const epubTaskService = new IREpubBookmarkTaskService(app);
			await epubTaskService.initialize();
			const tasks = await epubTaskService.getTasksByEpub(filePath);

			if (tasks.length === 0) {
				new Notice('未找到此 EPUB 的 IR 任务');
				return;
			}

			const chapterHref = readerService.getCurrentChapterHref?.() || '';
			let matchedTask = tasks.find(t => {
				if (!chapterHref || !t.tocHref) return false;
				const normalizedTaskHref = t.tocHref.split('#')[0].split('?')[0];
				const normalizedChapterHref = chapterHref.split('#')[0].split('?')[0];
				return normalizedChapterHref.endsWith(normalizedTaskHref) || normalizedTaskHref.endsWith(normalizedChapterHref);
			});

			if (!matchedTask) {
				matchedTask = tasks[0];
			}

			await epubTaskService.setResumePoint(matchedTask.id, currentCfi);
			const chapterTitle = readerService.getCurrentChapterTitle() || matchedTask.title;
			new Notice(`续读点已保存：${chapterTitle}`);
		} catch (e) {
			logger.error('[EpubReaderApp] markIRResumePoint failed:', e);
			new Notice('保存续读点失败');
		}
	}

	function handleEpubNavigateEvent(e: Event) {
		const detail = (e as CustomEvent).detail;
		if (!detail || detail.filePath !== filePath) return;

		const nav: ReaderNavigationIntent = {};
		if (detail.cfi) nav.cfi = detail.cfi;
		else if (detail.href) nav.href = detail.href;
		else return;
		if (typeof detail.text === 'string' && detail.text.trim()) {
			nav.text = detail.text;
		}
		if (detail.flashStyle === 'pulse' || detail.flashStyle === 'highlight' || detail.flashStyle === 'none') {
			nav.flashStyle = detail.flashStyle;
		}
		if (typeof detail.showLocateOverlay === 'boolean') {
			nav.showLocateOverlay = detail.showLocateOverlay;
		}

		if (!readerReady) {
			pendingIRNav = nav;
			return;
		}
		applyIRNav(nav);
	}

	async function applyIRNav(nav: ReaderNavigationIntent) {
		try {
			if (nav.flashStyle && nav.flashStyle !== 'none') {
				await readerService.navigateAndHighlight({
					cfi: nav.cfi,
					href: nav.href,
					text: nav.text,
					flashStyle: nav.flashStyle
				});
			} else {
				await readerService.navigateTo({
					cfi: nav.cfi,
					href: nav.href,
					text: nav.text,
				});
			}
			if (nav.showLocateOverlay) {
				window.setTimeout(() => {
					const rect = readerService.getNavigationTargetRect({ cfi: nav.cfi, href: nav.href, text: nav.text });
					if (rect) {
						sourceLocateOverlay.showAtRect(rect, { label: '定位到溯源位置', icon: 'map-pinned', durationMs: 2200 });
					}
				}, 80);
			}
		} catch (e) {
			logger.warn('[EpubReaderApp] IR navigation failed:', e);
		}
	}

	function setupHighlightClickHandler() {
		readerService.onHighlightClick((info: HighlightClickInfo) => {
			highlightToolbarInfo = info;
		});
	}

	function syncAsActiveEpubDocument() {
		epubActiveDocumentStore.setActiveDocument(filePath);
		epubActiveDocumentStore.setSharedState({
			filePath,
			readerService,
			annotationService,
			backlinkService,
			book,
			annotationRevision,
			progress: readingProgress,
			onSettingsClick: showSettingsMenu,
			onSwitchBook
		});
	}

	async function handleHighlightDelete(info: HighlightClickInfo) {
		readerService.removeHighlight(info.cfiRange);
		if (info.presentation === 'conceal') {
			if (!book) {
				new Notice('当前书籍尚未加载完成');
				return;
			}
			await annotationService.deleteConcealedTextByCfi(book.id, info.cfiRange);
			new Notice('已恢复隐藏文本');
			highlightToolbarInfo = null;
			void reloadHighlights();
			return;
		}
		const sourceFile = info.sourceFile || await backlinkService.findSourceFileForCfi(info.cfiRange, filePath) || undefined;
		if (!sourceFile) {
			new Notice('该高亮尚未同步到摘录来源，请稍后再试');
			void reloadHighlights();
			return;
		}
		const deleted = await backlinkService.deleteHighlight(sourceFile, info.cfiRange, filePath, info.sourceRef);
		if (deleted) {
			new Notice('高亮已删除');
			highlightToolbarInfo = null;
			void reloadHighlights();
		} else {
			new Notice('删除高亮失败');
			void reloadHighlights();
		}
	}

        function handleTemporarilyRevealConcealed(info: HighlightClickInfo) {
                if (info.presentation !== 'conceal') {
                        return;
                }

                readerService.temporarilyRevealConcealedText?.(info.cfiRange, 3000);
                highlightToolbarInfo = null;
                new Notice('已暂时显示隐藏内容 3 秒');
        }

        async function handleHighlightChangeColor(info: HighlightClickInfo, newColor: string) {
                if (newColor === info.color) return;
                const sourceFile = info.sourceFile || await backlinkService.findSourceFileForCfi(info.cfiRange, filePath) || undefined;
		if (!sourceFile) {
			new Notice('该高亮尚未同步到摘录来源，请稍后再试');
			void reloadHighlights();
			return;
		}
		const changed = await backlinkService.changeHighlightColor(sourceFile, info.cfiRange, filePath, newColor, info.sourceRef);

		if (changed) {
			highlightToolbarInfo = null;
			void reloadHighlights();
		} else {
			new Notice('更改颜色失败');
		}
	}

	async function handleHighlightBacklink(info: HighlightClickInfo) {
		let sourceFile: string | undefined = info.sourceFile || undefined;

		if (!sourceFile) {
			sourceFile = await backlinkService.findSourceFileForCfi(info.cfiRange, filePath) ?? undefined;
		}

		if (!sourceFile) {
			new Notice('未找到关联笔记');
			return;
		}

		if (info.sourceRef?.startsWith('card:')) {
			await openCardBacklink(info.sourceRef.slice(5));
			highlightToolbarInfo = null;
			return;
		}

		const encodedCfi = EpubLinkService.encodeCfiForWikilink(info.cfiRange);

		// Handle canvas files
		if (sourceFile.endsWith('.canvas')) {
			await sourceNavigationService.openCanvasAndLocate(
				sourceFile,
				[encodedCfi, info.cfiRange, sourceFile],
				info.sourceRef,
				{ label: '定位到溯源位置', icon: 'map-pinned', focus: true, openInNewTab: true, delayMs: 500 }
			);
			highlightToolbarInfo = null;
			return;
		}

		// Handle markdown files
		await navigateToMarkdownCallout(sourceFile, encodedCfi, info.cfiRange, info.text, info.createdTime);
		highlightToolbarInfo = null;
	}

	function buildMarkdownLocateCandidates(encodedCfi: string, rawCfi: string, excerptText?: string, createdTime?: number): string[] {
		const candidates: string[] = [];
		candidates.push(`${EPUB_LOCATE_LINK_PREFIX}${filePath}#weave-cfi=${encodedCfi}`);
		candidates.push(`${EPUB_LOCATE_CFI_PREFIX}${encodedCfi}`);
		candidates.push(`${EPUB_LOCATE_CFI_PREFIX}${rawCfi}`);
		if (typeof createdTime === 'number' && Number.isFinite(createdTime) && createdTime > 0) {
			candidates.push(`${EPUB_LOCATE_TIME_PREFIX}${Math.trunc(createdTime)}`);
		}
		const trimmedExcerpt = String(excerptText || '').trim();
		if (trimmedExcerpt) {
			candidates.push(trimmedExcerpt);
			const firstLine = trimmedExcerpt.split('\n').map((line) => line.trim()).find(Boolean);
			if (firstLine && firstLine !== trimmedExcerpt) {
				candidates.push(firstLine);
			}
		}
		return candidates.filter(Boolean);
	}

	async function navigateToMarkdownCallout(sourceFile: string, encodedCfi: string, rawCfi: string, excerptText?: string, createdTime?: number) {
		const locateCandidates = buildMarkdownLocateCandidates(encodedCfi, rawCfi, excerptText, createdTime);
		const openedLeaf = await sourceNavigationService.openMarkdownLinkAndLocate(
			sourceFile,
			filePath,
			locateCandidates,
			{
				label: '定位到溯源位置',
				icon: 'map-pinned',
				openInNewTab: true,
				focus: true,
				delayMs: 220
			}
		);
		if (!openedLeaf) {
			new Notice('未找到关联笔记');
		}
	}

	async function navigateToCanvasNode(canvasPath: string, encodedCfi: string, rawCfi: string, nodeId?: string) {
		// Find existing canvas leaf or open a new one
		let canvasLeaf = app.workspace.getLeavesOfType('canvas').find(leaf => {
			return (leaf.view as any)?.file?.path === canvasPath;
		});

		if (!canvasLeaf) {
			const file = app.vault.getAbstractFileByPath(canvasPath);
			if (!file) {
				new Notice('Canvas 文件未找到');
				return;
			}
			const openedCanvasLeaf = await openFileWithExistingLeaf(app, file as any, { openInNewTab: true, focus: true });
			if (!openedCanvasLeaf) return;
			canvasLeaf = openedCanvasLeaf;
		}

		app.workspace.setActiveLeaf(canvasLeaf!, { focus: true });

		// Find and select the target node
		setTimeout(() => {
			try {
				const canvasView = canvasLeaf!.view as any;
				const canvas = canvasView?.canvas;
				if (!canvas) return;

				const nodes = canvas.nodes;
				if (!nodes) return;

				for (const [, node] of nodes) {
					if (nodeId && node?.id !== nodeId) continue;
					const text = node?.text || node?.unknownData?.text || '';
					if (text.includes(encodedCfi) || text.includes(rawCfi)) {
						canvas.selectOnly(node);
						canvas.zoomToSelection();
						const nodeEl = (node as any)?.nodeEl || (node as any)?.contentEl || (node as any)?.containerEl || (node as any)?.el;
						if (nodeEl instanceof HTMLElement) {
							window.setTimeout(() => {
								sourceLocateOverlay.showAtRect(nodeEl.getBoundingClientRect(), { label: '定位到溯源位置', icon: 'map-pinned' });
							}, 120);
						}
						return;
					}
				}
			} catch (e) {
				logger.warn('[EpubReaderApp] Failed to select canvas node:', e);
			}
		}, 500);
	}

	async function openCardBacklink(cardUuid: string) {
		try {
			const plugin = getWeavePlugin();
			if (!plugin) {
				new Notice('未找到 Weave 插件实例');
				return;
			}

			if (typeof plugin.activateView === 'function') {
				const { VIEW_TYPE_WEAVE } = await import('../../views/WeaveView');
				await plugin.activateView(VIEW_TYPE_WEAVE);
			}

			window.dispatchEvent(new CustomEvent('Weave:navigate', {
				detail: 'weave-card-management'
			}));

			setTimeout(() => {
				window.dispatchEvent(new CustomEvent('Weave:filter-by-cards', {
					detail: {
						cardIds: [cardUuid],
						filterName: 'EPUB 摘录来源卡片',
						replaceExisting: true,
						targetView: 'grid',
						selectCards: true,
						scrollToCard: true
					}
				}));
			}, 160);
			new Notice('已在卡片管理中定位该摘录卡片');
		} catch (error) {
			logger.error('[EpubReaderApp] Failed to open card backlink:', error);
			new Notice('打开摘录来源卡片失败');
		}
	}

	async function handleHighlightCopyText(info: HighlightClickInfo) {
		const plainText = info.text.replace(/^>\s?/gm, '').trim();
		await copyTextToClipboard(plainText);
		highlightToolbarInfo = null;
	}

	async function reloadHighlights() {
		if (!book || componentDisposed) return;
		const reloadToken = ++highlightReloadToken;
		try {
			const allHighlights = await annotationService.collectAllHighlights(book.id, filePath, backlinkService);
			if (componentDisposed || reloadToken !== highlightReloadToken) {
				return;
			}
			trackedHighlightSourceFiles = new Set(
				allHighlights
					.map((highlight) => highlight.sourceFile)
					.filter((path): path is string => typeof path === 'string' && path.length > 0)
			);
			pendingLoadedHighlights = allHighlights;
			annotationRevision += 1;
			epubActiveDocumentStore.setSharedState({ annotationRevision });
			if (readerReady) {
				await readerService.applyHighlights(allHighlights);
			}
		} catch (_e) {
			logger.warn('[EpubReaderApp] Failed to reload highlights:', _e);
		}
	}

	async function migrateLegacyStoredLocations(options?: {
		requireReaderReady?: boolean;
		targetBook?: EpubBook | null;
	}) {
		const targetBook = options?.targetBook ?? book;
		const requireReaderReady = options?.requireReaderReady ?? true;
		if (!targetBook || (requireReaderReady && !readerReady)) {
			return;
		}
		if (migratedLocationBookIds.has(targetBook.id) || migratingLocationBookId === targetBook.id) {
			return;
		}

		migratingLocationBookId = targetBook.id;
		try {
			const summary = await locationMigrationService.migrateBookData(targetBook.id, filePath);
			migratedLocationBookIds.add(targetBook.id);
			if (summary.progressMigrated) {
				const latestProgress = await storageService.loadProgress(targetBook.id);
				if (latestProgress) {
					targetBook.currentPosition = latestProgress;
				}
			}
			if (
				summary.progressMigrated
				|| summary.bookmarksMigrated > 0
				|| summary.notesMigrated > 0
				|| summary.resumePointsMigrated > 0
			) {
				if (readerReady) {
					annotationRevision += 1;
					epubActiveDocumentStore.setSharedState({ annotationRevision });
				}
			}
		} catch (error) {
			logger.warn('[EpubReaderApp] Failed to migrate legacy EPUB locations:', error);
		} finally {
			if (migratingLocationBookId === targetBook.id) {
				migratingLocationBookId = null;
			}
		}
	}

	function trackHighlightSourceChanges() {
		if (vaultEventRefs.length > 0) return;

		const shouldReloadForPath = (path: string): boolean => {
			if (!path) return false;
			if (trackedHighlightSourceFiles.has(path)) return true;
			const canvasPath = canvasService.getCanvasPath();
			if (canvasPath && path === canvasPath) return true;
			return false;
		};

		const requestReload = (path: string) => {
			if (!shouldReloadForPath(path)) return;
			void reloadHighlights();
		};

		vaultEventRefs = [
			app.vault.on('modify', (file: TAbstractFile) => {
				requestReload(file.path);
			}),
			app.vault.on('delete', (file: TAbstractFile) => {
				requestReload(file.path);
			}),
			app.vault.on('rename', (file: TAbstractFile, oldPath: string) => {
				if (shouldReloadForPath(oldPath) || shouldReloadForPath(file.path)) {
					void reloadHighlights();
				}
			}),
		];
	}

	onMount(() => {
		componentDisposed = false;
		void (async () => {
			try {
				const [savedExcerptSettings, savedReaderSettings] = await Promise.all([
					storageService.loadExcerptSettings(),
					storageService.loadReaderSettings()
				]);
				excerptSettings = savedExcerptSettings;
				const normalizedSettings = normalizeReaderSettings(savedReaderSettings);
				settings = normalizedSettings;
				onReaderSettingsLoaded?.(normalizedSettings);
				if (
					normalizedSettings.widthMode !== savedReaderSettings.widthMode
					|| normalizedSettings.layoutMode !== savedReaderSettings.layoutMode
					|| normalizedSettings.flowMode !== savedReaderSettings.flowMode
				) {
					await storageService.saveReaderSettings(normalizedSettings);
				}
			} catch (error) {
				logger.warn('[EpubReaderApp] Failed to load reader settings:', error);
			}
			await loadBook();
		})();

		// Check global pending IR navigation (set by sidebar before this component mounts)
		const pending = (window as any).__weaveEpubPendingNav;
		if (pending && pending.filePath === filePath) {
			const nav: ReaderNavigationIntent = {};
			if (pending.cfi) nav.cfi = pending.cfi;
			else if (pending.href) nav.href = pending.href;
			if (typeof pending.text === 'string' && pending.text.trim()) {
				nav.text = pending.text;
			}
			if (pending.flashStyle === 'pulse' || pending.flashStyle === 'highlight' || pending.flashStyle === 'none') {
				nav.flashStyle = pending.flashStyle;
			}
			if (typeof pending.showLocateOverlay === 'boolean') {
				nav.showLocateOverlay = pending.showLocateOverlay;
			}
			if (nav.cfi || nav.href) {
				pendingIRNav = nav;
			}
			delete (window as any).__weaveEpubPendingNav;
		}

		setupHighlightClickHandler();
		trackHighlightSourceChanges();
		syncAsActiveEpubDocument();

		if (rootEl) {
			rootEl.addEventListener('keydown', handleKeydown);
			rootEl.addEventListener('pointerdown', syncAsActiveEpubDocument);
			rootEl.addEventListener('focusin', syncAsActiveEpubDocument);
			rootEl.setAttribute('tabindex', '0');
		}

		window.addEventListener('Weave:epub-navigate', handleEpubNavigateEvent);

		onActionsReady?.({
			setAutoInsert: (enabled: boolean) => { autoInsert = enabled; },
			setScreenshotMode: (active: boolean) => { screenshotMode = active; },
			setLayoutMode: handleLayoutModeChange,
			setFlowMode: handleFlowModeChange,
			setScreenshotSaveMode: (saveAsImage: boolean) => { screenshotSaveAsImage = saveAsImage; },
			forceReflow,
			navigateToCfi,
			toggleTutorial,
			addBookmark,
			bindCanvasPath: (canvasPath: string) => { bindCanvas(canvasPath); },
			unbindCanvas: () => { unbindCanvas(); },
			getCanvasService: () => canvasService,
			markIRResumePoint
		});
		return () => {
			componentDisposed = true;
			activeBookLoadToken += 1;
			clearTransientStatus();
			if (deferredHighlightReloadTimer) {
				clearTimeout(deferredHighlightReloadTimer);
				deferredHighlightReloadTimer = null;
			}
			if (rootEl) {
				rootEl.removeEventListener('keydown', handleKeydown);
				rootEl.removeEventListener('pointerdown', syncAsActiveEpubDocument);
				rootEl.removeEventListener('focusin', syncAsActiveEpubDocument);
			}
			for (const ref of vaultEventRefs) {
				app.vault.offref(ref);
			}
			vaultEventRefs = [];
			window.removeEventListener('Weave:epub-navigate', handleEpubNavigateEvent);
			sourceLocateOverlay.clear();
			storageService.flushPendingProgress();
			readerService.destroy();
			epubActiveDocumentStore.clearActiveDocument(filePath);
		};
	});
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="epub-reader-root"
	data-theme={settings.theme}
	data-flow={settings.flowMode}
	data-layout={settings.layoutMode}
	bind:this={rootEl}
>
	{#if loading}
		<div class="epub-loading">
			<div class="epub-loading-spinner"></div>
			<span>加载中...</span>
		</div>
	{:else if errorMsg}
		<div class="epub-error">
			<span>{errorMsg}</span>
		</div>
	{:else}
		<div
			class="epub-reader-viewport"
			class:with-side-nav={showBottomNav() && useVerticalNav()}
			bind:this={viewportEl}
		>
			<div class="epub-content-wrapper" class:with-side-nav={showBottomNav() && useVerticalNav()}>
									<EpubReaderView
						{app}
						{filePath}
						{book}
						{readerService}
						{storageService}
						{annotationService}
						{backlinkService}
						{settings}
						onProgressChange={(p) => { readingProgress = p; epubActiveDocumentStore.setSharedState({ progress: p }); }}
						onPaginationChange={(info) => { paginationInfo = info; }}
						onReaderReady={() => {
							readerVersion++;
							readerReady = true;
							if (pendingLoadedHighlights) {
								void readerService.applyHighlights(pendingLoadedHighlights);
							} else if (book) {
								void reloadHighlights();
							}
								if (pendingIRNav) {
									const nav = pendingIRNav;
									pendingIRNav = null;
									applyIRNav(nav);
								}
								void migrateLegacyStoredLocations();
							}}
						onRenderError={(message) => {
							logger.error('[EpubReaderApp] Reader view render error:', message);
							setError(message);
						}}
					/>
			</div>

		{#if showBottomNav() && useVerticalNav()}
				<BottomNav
					onPrev={handlePrevPage}
					onNext={handleNextPage}
					currentPage={paginationInfo.currentPage}
					totalPages={paginationInfo.totalPages}
					vertical={true}
					statusText={getBottomNavStatusText()}
				/>
			{/if}

                        <EpubHighlightToolbar
                                info={highlightToolbarInfo}
                                onDelete={handleHighlightDelete}
                                onTemporarilyReveal={handleTemporarilyRevealConcealed}
                                onChangeColor={handleHighlightChangeColor}
                                onBacklink={handleHighlightBacklink}
				onExtractToCard={handleHighlightExtractToCard}
				onCopyText={handleHighlightCopyText}
				onDismiss={() => highlightToolbarInfo = null}
			/>

			<SelectionToolbar
				{app}
				{readerService}
				{book}
				{readerVersion}
				{autoInsert}
				{canvasMode}
				onInsertToNote={handleInsertToNote}
				onExtractToCard={handleExtractToCard}
				onAutoInsert={handleAutoInsertSelection}
				onConcealText={handleConcealSelection}
			/>

			<EpubTutorial
				visible={tutorialVisible}
				onClose={() => tutorialVisible = false}
			/>

			<ScreenshotOverlay
				active={screenshotMode}
				sourceEl={viewportEl}
				{screenshotService}
				getVisibleFrames={getVisibleReaderFrames}
				onCapture={handleScreenshotCapture}
				onCancel={() => screenshotMode = false}
			/>

		</div>

		{#if showBottomNav() && !useVerticalNav()}
			<div class="epub-bottom-nav-slot">
				<BottomNav
					onPrev={handlePrevPage}
					onNext={handleNextPage}
					currentPage={paginationInfo.currentPage}
					totalPages={paginationInfo.totalPages}
					vertical={false}
					statusText={getBottomNavStatusText()}
				/>
			</div>
		{/if}
	{/if}
</div>
