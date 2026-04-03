<script lang="ts">
  import { logger } from '../../utils/logger';
  import { vaultStorage } from '../../utils/vault-local-storage';

  import type { WeaveDataStorage } from "../../data/storage";
  import type { FSRS } from "../../algorithms/fsrs";
  import type { WeavePlugin } from "../../main";

  import type { Card, Deck } from "../../data/types";
  import type { TimeFilterType } from "../../types/time-filter-types";
  import { MarkdownView, Platform, Menu, TFile, Modal, FuzzySuggestModal } from "obsidian";
  import type { WorkspaceLeaf } from "obsidian";
  import EnhancedIcon from "../ui/EnhancedIcon.svelte";
  import BouncingBallsLoader from "../ui/BouncingBallsLoader.svelte";
  import WeaveCardTable from "../tables/WeaveCardTable.svelte";
  import TableSortingOverlay from "../tables/components/TableSortingOverlay.svelte";
  import KanbanView from "../study/KanbanView.svelte";
  import GridView from "../views/GridView.svelte";
  import MasonryGridView from "../views/MasonryGridView.svelte";
  import GridTimelineView from "../views/GridTimelineView.svelte";
  import WeaveBatchToolbar from "../batch/WeaveBatchToolbar.svelte";
  // BatchTemplateChangeModal 已删除（基于弃用的字段模板系统）
  // BatchDeckChangeModal、BatchRemoveTagsModal、BatchAddTagsModal 已改用 Obsidian Menu API
  // 🆕 v2.0 引用式牌组系统模态窗
  import BuildDeckModal from "../modals/BuildDeckModal.svelte";
  // 🆕 v2.0 增量阅读牌组模态窗
  import BuildIRDeckModal from "../modals/BuildIRDeckModal.svelte";
  // 🆕 v2.2 数据管理模态窗
  import { DataManagementModalObsidian } from "../modals/DataManagementModalObsidian";
  // EditCardModal 已改为全局方法，不再局部导入
  import { EmbeddableEditorManager } from "../../services/editor/EmbeddableEditorManager";

  import ColumnManager from "../ui/ColumnManager.svelte";
  import TablePagination from "../ui/TablePagination.svelte";
  import { DEFAULT_COLUMN_ORDER, type ColumnOrder, type ColumnKey } from "../tables/types/table-types";

  import { ICON_NAMES } from "../../icons/index.js";
  import { onMount, onDestroy, untrack, tick } from "svelte";
  import { waitForServiceReady } from "../../utils/service-ready-event";

  import { getCardContentBySide } from "../../utils/helpers";
  import { showNotification } from "../../utils/notifications";
  // 源文档路径筛选工具
  import { filterCardsBySourceDocument } from "../../utils/source-path-matcher";
  // 🆕 标签层级筛选工具
  import { matchesTagFilter } from "../../utils/tag-utils";
  // 旧的三位一体模板系统已完全移除
  import { Notice } from "obsidian";
  // 🆕 v2.2: 导入牌组获取工具和内容解析工具（Content-Only 架构）
  import { getCardMetadata, setCardProperties, getCardDeckIds, getCardDeckNames as getCardDeckNamesFromYaml, extractBodyContent, parseSourceInfo, parseYAMLFromContent } from "../../utils/yaml-utils";
  import { MAIN_SEPARATOR } from "../../constants/markdown-delimiters";
  import { cardsToCSV, groupCardsBySource, groupCardsByMonth, groupCardsByDeck, sanitizeFileName, type ExportGroupMode } from "../../utils/card-export-utils";
  import { showObsidianConfirm } from "../../utils/obsidian-confirm";
  import { detectCardQuestionType, getQuestionTypeDistribution } from "../../utils/card-type-utils";
  import { getErrorBookDistribution, getCardErrorLevel } from "../../utils/error-book-utils";
  import { CardType } from "../../data/types";
  import { applyTimeFilter } from "../../utils/time-filter-utils";
  import { batchUpdateCards, mergeUnmappedFields, deleteFields } from "../../services/batch-operation-service";
  // ✅ 卡片详情模态窗改用全局方法 plugin.openViewCardModal()
  // 🌍 导入国际化
  import { tr } from "../../utils/i18n";
  import { migrateCardsErrorTracking, getMigrationStats } from "../../utils/data-migration-utils";
  import { calculateTagCounts } from "../../utils/tag-utils";
  import { FilterManager } from "../../services/filter-manager";
  import { TFolder } from "obsidian";
  
  // 🆕 v2.1 YAML 元数据服务
  import { getCardMetadataService } from "../../services/CardMetadataService";
  import { invalidateCardCache } from "../../services/CardMetadataCache";
  import type { SavedFilter } from "../../types/filter-types";
  
  // 高级功能守卫
  import { PremiumFeatureGuard, PREMIUM_FEATURES } from "../../services/premium/PremiumFeatureGuard";
  import ActivationPrompt from "../premium/ActivationPrompt.svelte";
  
  // 🆕 题库数据存储
  import { QuestionBankStorage } from "../../services/question-bank/QuestionBankStorage";
  import type { QuestionTestStats } from "../../types/question-bank-types";
  
  
  // 🆕 移动端组件
  import MobileCardManagementHeader from "../study/MobileCardManagementHeader.svelte";
  // MobileCardManagementMenu 已移除 - 现在使用 Obsidian Menu API
  
  // 🆕 卡片搜索组件
  import CardSearchInput from "../search/CardSearchInput.svelte";
  import { parseSearchQuery, matchSearchQuery } from "../../utils/search-parser";
  import type { SearchQuery } from "../../utils/search-parser";
  import { getQuestionTypeLabelFromCard } from "../../utils/question-type-utils";
  
  // 🆕 增量阅读活动文档store（用于文档关联筛选）
  import { irActiveDocumentStore } from "../../stores/ir-active-document-store";
  // EPUB阅读器活动文档store（用于文档关联筛选）
  import { epubActiveDocumentStore } from "../../stores/epub-active-document-store";
  
  import { IRStorageService } from "../../services/incremental-reading/IRStorageService";
  import { IRPdfBookmarkTaskService, isPdfBookmarkTaskId } from "../../services/incremental-reading/IRPdfBookmarkTaskService";
  import type { IRPdfBookmarkTask } from "../../services/incremental-reading/IRPdfBookmarkTaskService";
  import type { IRBlock, IRDeck } from "../../types/ir-types";
  
  // 进度条模态窗
  import { executeBatchWithProgress } from "../../utils/progress-modal";
  import { SourceNavigationService } from "../../services/ui/SourceNavigationService";
  
  class ExportFolderPickerModal extends FuzzySuggestModal<string> {
    private folders: string[];
    private onChoose: (item: string) => void;
    constructor(app: import('obsidian').App, folders: string[], onChoose: (item: string) => void) {
      super(app);
      this.folders = folders;
      this.onChoose = onChoose;
    }
    getItems(): string[] { return this.folders; }
    getItemText(item: string): string { return item || '/  (Vault Root)'; }
    onChooseItem(item: string): void { this.onChoose(item); }
  }

  interface Props {
    dataStorage: WeaveDataStorage;
    plugin: WeavePlugin;
    fsrs: FSRS;
    currentLeaf?: WorkspaceLeaf;
  }

  let { dataStorage, plugin, currentLeaf }: Props = $props();

  // 🌍 响应式翻译函数
  let t = $derived($tr);

  // 基础状态管理
  let isMounted = $state(false);  // 🔥 组件挂载状态（onMount设置）
  let isViewVisible = $state(true); // 🔥 视图可见性（组件被渲染即可见）
  let isLoading = $state(true);
  let isViewSwitching = $state(false); // 视图切换加载状态
  let isViewDestroyed = false;  // 🔥 添加视图销毁状态（非响应式，用于清理）
  let cards = $state<Card[]>([]);
  let selectedCards = $state(new Set<string>()); // Set<uuid>
  let searchQuery = $state("");
  let parsedSearchQuery = $state<SearchQuery | null>(null);
  
  // 🆕 视图状态（从 plugin.settings 初始化）
  type GridCardAttributeType =
    | 'none'
    | 'uuid'
    | 'source'
    | 'priority'
    | 'retention'
    | 'modified'
    | 'accuracy'
    | 'question_type'
    | 'ir_state'
    | 'ir_priority';
  type GridLayoutMode = 'fixed' | 'masonry' | 'timeline';
  
  const viewPrefs = plugin.settings.cardManagementViewPreferences || {
    currentView: 'table',
    gridLayout: 'fixed',
    gridCardAttribute: 'uuid',
    kanbanLayoutMode: 'comfortable',
    tableViewMode: 'basic',
    enableCardLocationJump: false
  };
  
  // 🔒 高级功能守卫实例（优先初始化）
  const premiumGuard = PremiumFeatureGuard.getInstance();
  
  // 🔒 视图权限检查和降级
  function getInitialView(): 'table' | 'grid' | 'kanban' {
    const savedView = viewPrefs.currentView;
    // 如果保存的是网格视图但没有权限，降级到表格视图
    if (savedView === 'grid' && !premiumGuard.canUseFeature(PREMIUM_FEATURES.GRID_VIEW)) {
      return 'table';
    }
    // 如果保存的是看板视图但没有权限，降级到表格视图
    if (savedView === 'kanban' && !premiumGuard.canUseFeature(PREMIUM_FEATURES.KANBAN_VIEW)) {
      return 'table';
    }
    // 只返回允许的视图类型
    if (savedView === 'table' || savedView === 'grid' || savedView === 'kanban') {
      return savedView;
    }
    return 'table';
  }
  
  let currentView = $state<'table' | 'grid' | 'kanban'>(getInitialView());
  let gridLayout = $state<GridLayoutMode>(
    viewPrefs.gridLayout === 'masonry' || viewPrefs.gridLayout === 'timeline'
      ? viewPrefs.gridLayout
      : 'fixed'
  );
  let kanbanGroupBy = $state<'status' | 'type' | 'priority' | 'deck' | 'createTime'>('status'); // 看板分组方式
  let kanbanLayoutMode = $state<'compact' | 'comfortable' | 'spacious'>(viewPrefs.kanbanLayoutMode);
  let tableViewMode = $state<'basic' | 'review' | 'questionBank' | 'irContent'>(viewPrefs.tableViewMode);
  let enableCardLocationJump = $state(viewPrefs.enableCardLocationJump);
  let gridCardAttribute = $state<GridCardAttributeType>(viewPrefs.gridCardAttribute);
  
  // 🆕 全局筛选状态（从FilterStateService同步）
  let globalSelectedDeckId = $state<string | null>(null);
  let globalSelectedCardTypes = $state<Set<CardType>>(new Set());
  let globalSelectedPriority = $state<number | null>(null);
  let globalSelectedTags = $state<Set<string>>(new Set());
  let globalSelectedTimeFilter = $state<TimeFilterType>(null);  // 🆕 时间筛选
  let globalShowOrphanCards = $state(false);  // 🆕 v2.0 孤儿卡片筛选
  
  // 🆕 自定义卡片筛选（用于显示特定卡片集合，如变体卡片）
  let customCardIdsFilter = $state<Set<string> | null>(null);
  let customFilterName = $state<string | null>(null);

  // isEditingCard 和 editingCard 已移除，统一使用嵌入式编辑器
  
  // 🆕 嵌入式编辑器管理器（方案A：永久隐藏Leaf）
  let editorPoolManager = $state<EmbeddableEditorManager | null>(null);
  
  // 🆕 题库数据存储和统计
  let questionBankStorage = $state<QuestionBankStorage | null>(null);
  let questionBankStats = $state<Map<string, QuestionTestStats>>(new Map());
  
  // 文档监听器清理函数
  let documentListenerCleanup: (() => void) | null = null;

  // 🆕 题库数据源
  let dataSource = $state<'memory' | 'questionBank' | 'incremental-reading'>('memory');  // 默认显示记忆学习数据
  let questionBankCards = $state<Card[]>([]);  // 题库数据
  let isLoadingQuestionBank = $state(false);  // 题库加载状态
  let questionBankDecks = $state<Deck[]>([]);
  
  // 🆕 v2.0 增量阅读数据源
  let irContentCards = $state<Card[]>([]);  // IR内容块转换为Card格式
  let irBlocks = $state<Record<string, IRBlock>>({});  // 原始IR块数据
  let irDecks = $state<Record<string, IRDeck>>({});  // IR牌组数据
  let isLoadingIR = $state(false);  // IR数据加载状态
  let irStorageService: IRStorageService | null = null;  // IR存储服务
  let irTypeFilter = $state<'all' | 'md' | 'pdf'>('all');  // IR类型筛选：全部/MD文件/PDF书签
  
  // 🆕 查看卡片模态窗状态 - 改用全局方法，不再需要本地状态
  

  // 🆕 字段管理器状态
  let showColumnManager = $state(false);
  let columnManagerAnchorEl = $state<HTMLElement | null>(null);
  let columnManagerPanelEl = $state<HTMLDivElement | null>(null);
  let columnManagerPopoverTop = $state(96);
  let columnManagerPopoverLeft = $state(24);
  let columnManagerPopoverPlacement = $state<'top' | 'bottom'>('bottom');
  
  async function saveViewPreferences() {
    try {
      if (!plugin.settings.cardManagementViewPreferences) {
        plugin.settings.cardManagementViewPreferences = {
          currentView: 'table',
          gridLayout: 'fixed',
          gridCardAttribute: 'uuid',
          kanbanLayoutMode: 'comfortable',
          tableViewMode: 'basic',
          enableCardLocationJump: false
        };
      }
      
      plugin.settings.cardManagementViewPreferences.currentView = currentView;
      plugin.settings.cardManagementViewPreferences.gridLayout = gridLayout;
      plugin.settings.cardManagementViewPreferences.gridCardAttribute = gridCardAttribute;
      plugin.settings.cardManagementViewPreferences.kanbanLayoutMode = kanbanLayoutMode;
      plugin.settings.cardManagementViewPreferences.tableViewMode = tableViewMode;
      plugin.settings.cardManagementViewPreferences.enableCardLocationJump = enableCardLocationJump;
      
      await plugin.saveSettings();
    } catch (error) {
      logger.error('保存视图偏好失败:', error);
    }
  }
  // showNewCardModal 已移除
  // showBatchTemplateModal 已删除（基于弃用的字段模板系统）
  // showBatchDeckModal、showBatchRemoveTagsModal、showBatchAddTagsModal 已移除（改用 Obsidian Menu API）
  
  // 🆕 v2.2 数据管理模态窗（含质量扫描）
  let showDataManagementModal = $state(false);
  let dataManagementModalInstance: DataManagementModalObsidian | null = null;
  // 🆕 v2.0 引用式牌组系统模态窗状态
  let showBuildDeckModal = $state(false);
  // 🆕 v2.0 增量阅读牌组模态窗状态
  let showBuildIRDeckModal = $state(false);
  let filterManager = $state<FilterManager | null>(null);
  let savedFilters = $state<SavedFilter[]>([]);

  // 文档过滤功能状态
  let documentFilterMode = $state<'all' | 'current'>('all'); // 过滤模式
  let currentActiveDocument = $state<string | null>(null); // 当前活动文档路径
  let lastExternalActiveDocument = $state<string | null>(null); // 最近一次真正激活的外部文档路径
  let lastExternalDocumentKind = $state<'file' | 'epub' | 'ir' | null>(null);
  
  // 🆕 侧边栏检测状态
  let isInSidebar = $state(false);
  
  // 🆕 移动端状态 - 使用多种检测方法确保准确性
  function detectMobileDevice(): boolean {
    // 1. Platform.isMobile - Obsidian 官方 API
    if (Platform.isMobile) return true;
    // 2. body classes
    if (typeof document !== 'undefined') {
      const body = document.body;
      if (body.classList.contains('is-mobile') || 
          body.classList.contains('is-phone') || 
          body.classList.contains('is-tablet')) {
        return true;
      }
    }
    // 3. 触摸屏检测
    if (typeof window !== 'undefined' && 'ontouchstart' in window) return true;
    // 4. 用户代理检测
    if (typeof navigator !== 'undefined' && /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)) return true;
    return false;
  }
  
  const isMobile = detectMobileDevice();
  let showMobileSearchInput = $state(false);

  // allFieldTemplates 已删除（新系统使用动态解析，无需预定义模板）
  let allDecks = $state<Deck[]>([]);
  
  let isPremium = $state(false);
  let showActivationPrompt = $state(false);
  let promptFeatureId = $state('');

  function promptPremiumFeature(featureId: string) {
    promptFeatureId = featureId;
    showActivationPrompt = true;
  }
  
  // 订阅高级版状态（添加挂载状态保护）
  $effect(() => {
    if (!isMounted) return;  // 🔥 只在组件挂载后订阅
    
    const unsubscribe = premiumGuard.isPremiumActive.subscribe(value => {
      if (isMounted) {  // 🔥 只在组件仍挂载时更新状态
        isPremium = value;
      }
    });
    return unsubscribe;
  });

  // 分页状态
  let currentPage = $state(1);
  let itemsPerPage = $state(25); // 🔧 性能优化：从50改为25，减少组件实例数量

  // 🔧 添加数据版本号，强制触发UI更新
  let dataVersion = $state(0);

  // 使用 $state + $effect 替代 $derived，避免 reconciliation 错误
  // ⚠️ 注意：$effect 必须正常追踪所有必要的依赖（包括 sortConfig），不能滥用 untrack
  let filteredAndSortedCards = $state<Card[]>([]);
  let totalFilteredItems = $state(0);
  let filteredCards = $state<Card[]>([]);
  
  // 🆕 判断是否有活动的全局筛选
  let hasActiveGlobalFilters = $derived(
    globalSelectedDeckId !== null ||
    globalSelectedCardTypes.size > 0 ||
    globalSelectedPriority !== null ||
    globalSelectedTags.size > 0 ||
    globalSelectedTimeFilter !== null ||
    globalShowOrphanCards ||  // 🆕 v2.0 孤儿卡片筛选
    (customCardIdsFilter !== null && customCardIdsFilter.size > 0)
  );

  // 使用 $effect 来更新筛选和排序后的卡片
  $effect(() => {
    // 🔧 添加dataVersion依赖，确保数据更新时触发重新计算
    void dataVersion;
    
    // 🔧 性能优化：只在组件挂载且未销毁时计算
    if (!isMounted || !isViewVisible) {
      // 🔥 组件未挂载或已销毁时，清空数据避免内存泄漏
      filteredAndSortedCards = [];
      return;
    }
    
    // 🔧 修复说明：移除了 untrack 包裹，让排序配置变化能够正常触发 $effect
    // 原注释误判了"循环依赖"问题，实际上排序逻辑是单向的：sortConfig → 排序 → filteredAndSortedCards
    // 没有任何代码会在排序过程中修改 sortConfig，因此不存在循环依赖
    const currentSortField = sortConfig.field;
    const currentSortDirection = sortConfig.direction;
    
    const sourceCards = currentSourceCards;
    
    if (!Array.isArray(sourceCards)) {
      filteredAndSortedCards = [];
      return;
    }

    const activeDecks = currentDataSourceDecks;
    const deckById = new Map(activeDecks.map(d => [d.id, d] as const));
    const deckIdsCache = new Map<string, ReturnType<typeof getCardDeckIds>>();
    const getCachedCardDeckIds = (card: Card) => {
      const key = card.uuid;
      const cached = deckIdsCache.get(key);
      if (cached) return cached;
      const computed = getCardDeckIds(card, activeDecks);
      deckIdsCache.set(key, computed);
      return computed;
    };

    let result = [...sourceCards];

    // 过滤渐进式挖空子卡片（管理界面只显示父卡片，子卡片仅在学习队列中出现）
    result = result.filter(card => card.type !== 'progressive-child');

    // 🆕 IR类型筛选：按 MD/PDF 过滤
    if (dataSource === 'incremental-reading' && irTypeFilter !== 'all') {
      result = result.filter(card => {
        const isPdf = !!(card as any).metadata?.irPdfBookmark;
        return irTypeFilter === 'pdf' ? isPdf : !isPdf;
      });
    }

    // 🆕 应用自定义卡片ID筛选（最高优先级，用于显示特定卡片集合）
    if (customCardIdsFilter && customCardIdsFilter.size > 0) {
      result = result.filter(card => {
        const id = card.uuid;
        return customCardIdsFilter!.has(id);
      });
    }

    // 🆕 应用文档筛选（在其他筛选之前）
    if (documentFilterMode === 'current' && currentActiveDocument) {
      result = filterCardsBySourceDocument(result, currentActiveDocument);
    }
    
    // 🆕 应用全局筛选器的筛选条件
    // 1. 牌组筛选（🆕 v2.0: 引用式牌组架构）
    if (globalSelectedDeckId) {
      const selectedDeck = deckById.get(globalSelectedDeckId);
      const selectedDeckUuidSet = selectedDeck?.cardUUIDs?.length
        ? new Set(selectedDeck.cardUUIDs)
        : null;
      result = result.filter(card => {
        // 优先使用 deck.cardUUIDs
        if (selectedDeckUuidSet) {
          return selectedDeckUuidSet.has(card.uuid);
        }
        // 🆕 v2.2: 优先从 content YAML 的 we_decks 获取牌组ID
        const { deckIds } = getCachedCardDeckIds(card);
        return deckIds.includes(globalSelectedDeckId!) || card.referencedByDecks?.includes(globalSelectedDeckId!) || card.deckId === globalSelectedDeckId;
      });
    }
    
    // 2. 题型筛选
    if (globalSelectedCardTypes.size > 0) {
      result = result.filter(card => {
        const cardType = detectCardQuestionType(card);
        return globalSelectedCardTypes.has(cardType as unknown as CardType);
      });
    }
    
    // 3. 优先级筛选
    if (globalSelectedPriority !== null) {
      result = result.filter(card => (card.priority || 0) === globalSelectedPriority);
    }
    
    // 4. 标签筛选（AND逻辑：卡片必须包含所有选中标签，支持层级筛选）
    // 🆕 v2.1: 使用 CardMetadataService 兼容新旧格式
    if (globalSelectedTags.size > 0) {
      const metadataSvc = getCardMetadataService();
      result = result.filter(card => {
        // AND逻辑：卡片必须匹配所有选中的标签
        const cardTags = metadataSvc.getCardTags(card);
        return Array.from(globalSelectedTags).every(selectedTag => 
          matchesTagFilter(cardTags, selectedTag)
        );
      });
    }
    
    // 🆕 5. 时间筛选
    if (globalSelectedTimeFilter) {
      result = applyTimeFilter(result, globalSelectedTimeFilter);
    }
    
    // 孤儿卡片筛选：当前数据源下没有任何牌组归属的卡片
    if (globalShowOrphanCards) {
      const activeDecks = getDecksForDataSource();
      result = result.filter((card) => {
        if (activeDecks.some(deck => deck.cardUUIDs?.includes(card.uuid))) {
          return false;
        }
        const { deckIds } = getCardDeckIds(card, activeDecks);
        return deckIds.length === 0;
      });
    }

    // 应用搜索筛选（使用卡片搜索解析器）
    if (searchQuery.trim() && parsedSearchQuery) {
      // 创建适配器函数
      const getContentAdapter = (card: any, side: 'front' | 'back') => {
        return getCardContentBySide(card, side, []);
      };
      
      result = result.filter(card => 
        matchSearchQuery(
          card, 
          parsedSearchQuery!, 
          getContentAdapter,
          getCardDeckNames,  // 🔧 修复：使用 getCardDeckNames 支持 v2.0 引用式牌组
          detectCardQuestionType
        )
      );
    }

    // 应用状态筛选
    if (filters.status.size > 0) {
      result = result.filter(card => {
        if (!card.fsrs) return false;
        const statusString = getCardStatusString(card.fsrs.state);
        return filters.status.has(statusString);
      });
    }

    // 应用牌组筛选（🆕 v2.0: 引用式牌组架构）
    if (filters.decks.size > 0) {
      const deckUuidSets = new Map<string, Set<string>>();
      for (const deckId of filters.decks) {
        const deck = deckById.get(deckId);
        if (deck?.cardUUIDs?.length) {
          deckUuidSets.set(deckId, new Set(deck.cardUUIDs));
        }
      }
      result = result.filter(card => {
        // 检查卡片是否属于任意筛选的牌组
        for (const deckId of filters.decks) {
          const uuidSet = deckUuidSets.get(deckId);
          if (uuidSet?.has(card.uuid)) {
            return true;
          }
          // 🆕 v2.2: 优先从 content YAML 的 we_decks 获取牌组ID
          const { deckIds: cardDeckIds } = getCachedCardDeckIds(card);
          if (cardDeckIds.includes(deckId) || card.referencedByDecks?.includes(deckId) || card.deckId === deckId) {
            return true;
          }
        }
        return false;
      });
    }

    // 应用标签筛选（支持层级筛选）
    // 🆕 v2.1: 使用 CardMetadataService 兼容新旧格式
    if (filters.tags.size > 0) {
      const metadataSvc = getCardMetadataService();
      result = result.filter(card => {
        // AND逻辑：卡片必须匹配所有选中的标签
        const cardTags = metadataSvc.getCardTags(card);
        return Array.from(filters.tags).every(selectedTag =>
          matchesTagFilter(cardTags, selectedTag)
        );
      });
    }

    // 🆕 应用题型筛选
    if (filters.questionTypes.size > 0) {
      result = result.filter(card => {
        const questionType = detectCardQuestionType(card);
        return filters.questionTypes.has(questionType);
      });
    }

    // 🆕 应用错题集筛选
    if (filters.errorBooks.size > 0) {
      result = result.filter(card => {
        const errorLevel = getCardErrorLevel(card);
        return errorLevel && filters.errorBooks.has(errorLevel);
      });
    }

    const getSortKey = (card: Card): string | number => {
      switch (currentSortField) {
        case "front":
          return (getCardContentBySide(card, 'front', []) || '').toLowerCase();
        case "back":
          return (getCardContentBySide(card, 'back', []) || '').toLowerCase();
        case "status":
          return getCardStatusString(card.fsrs?.state ?? 0);
        case "created": {
          const ts = new Date(card.created || 0).getTime();
          return Number.isFinite(ts) ? ts : 0;
        }
        case "modified": {
          const ts = new Date(card.modified || 0).getTime();
          return Number.isFinite(ts) ? ts : 0;
        }
        case "tags":
          return (card.tags || []).join(" ").toLowerCase();
        case "obsidian_block_link":
          return (card.fields?.obsidian_block_link || '').toLowerCase();
        case "source_document":
          return (card.fields?.source_document || '').toLowerCase();
        case "uuid":
          return (card.uuid || '').toLowerCase();
        case "deck":
          return getCardDeckNames(card).toLowerCase();
        // IR 专用字段排序
        case "ir_title":
          return ((card as any).ir_title || '').toLowerCase();
        case "ir_source_file":
          return ((card as any).ir_source_file || '').toLowerCase();
        case "ir_state":
          return ((card as any).ir_state || '').toLowerCase();
        case "ir_priority":
          return (card as any).ir_priority ?? 5;
        case "ir_tags":
          return ((card as any).ir_tags || []).join(' ').toLowerCase();
        case "ir_favorite":
          return (card as any).ir_favorite ? 1 : 0;
        case "ir_next_review": {
          const irTs = new Date((card as any).ir_next_review || 0).getTime();
          return Number.isFinite(irTs) ? irTs : 0;
        }
        case "ir_review_count":
          return (card as any).ir_review_count ?? 0;
        case "ir_reading_time":
          return (card as any).ir_reading_time ?? 0;
        case "ir_extracted_cards":
          return (card as any).ir_extracted_cards ?? 0;
        case "ir_created": {
          const irCreatedTs = new Date((card as any).ir_created || 0).getTime();
          return Number.isFinite(irCreatedTs) ? irCreatedTs : 0;
        }
        case "ir_decks":
          return ((card as any).ir_deck || '').toLowerCase();
        default:
          return '';
      }
    };

    const decorated = result.map(card => ({ card, key: getSortKey(card) }));
    decorated.sort((a, b) => {
      const aKey = a.key;
      const bKey = b.key;
      if (typeof aKey === 'number' && typeof bKey === 'number') {
        return currentSortDirection === 'asc' ? aKey - bKey : bKey - aKey;
      }
      if (aKey < bKey) return currentSortDirection === "asc" ? -1 : 1;
      if (aKey > bKey) return currentSortDirection === "asc" ? 1 : -1;
      return 0;
    });
    result = decorated.map(d => d.card);

    // 更新状态，创建新数组避免引用问题
    filteredAndSortedCards = result;
    
    // 🔓 排序完成后释放锁
    // ⚠️ 注意：这里的 untrack 是必要的，因为我们在 $effect 内部读取和修改 isSorting
    // 不使用 untrack 会导致修改 isSorting 时再次触发当前 $effect，造成无限循环
    // 这与上面 sortConfig 的使用不同：sortConfig 的变化应该触发 $effect（用户主动排序）
    untrack(() => {
      if (sortingLock && isSorting) {
        // 🧹 清除之前的定时器（防止多次触发）
        if (sortLockReleaseTimer !== null) {
          clearTimeout(sortLockReleaseTimer);
          sortLockReleaseTimer = null;
        }
        
        // 📝 捕获当前排序请求ID，用于验证
        const currentRequestId = sortRequestId;
        
        queueMicrotask(() => {
          const elapsed = Date.now() - sortStartTime;
          const minDisplayTime = 200; // 最小显示时间200ms
          const remainingTime = Math.max(0, minDisplayTime - elapsed);
          
          sortLockReleaseTimer = window.setTimeout(() => {
            // ✅ 验证这是当前的排序请求才释放锁（防止过时的定时器释放锁）
            if (currentRequestId === sortRequestId) {
              isSorting = false;
              sortingLock = false;
              sortLockReleaseTimer = null;
            } else {
            }
          }, remainingTime);
        });
      }
    });
  });

  // 使用 $effect 来更新总数和分页数据
  $effect(() => {
    // 🔧 性能优化：只在组件挂载且视图可见时更新
    if (!isMounted || !isViewVisible) return;
    
    // 追踪所有的依赖项
    const sortedCards = filteredAndSortedCards;
    const page = currentPage;
    const perPage = itemsPerPage;
    
    // 计算总数
    totalFilteredItems = sortedCards.length;

    // 计算当前页的起止索引
    const startIndex = (page - 1) * perPage;
    const endIndex = Math.min(sortedCards.length, startIndex + perPage);

    // 性能优化：直接使用 slice 结果，不需要额外的展开运算符
    // slice 已经返回新数组，不需要再用 [...] 创建副本
    const newFilteredCards = sortedCards.slice(startIndex, endIndex);
    
    // 🔧 修复：移除过于激进的优化检查，确保数据更新时 UI 能正确刷新
    // 原来的检查只比较长度和第一个元素的 UUID，但当标签/优先级等属性更新时，
    // 这些条件都不会变化，导致 filteredCards 不更新，UI 不刷新
    // 现在直接赋值，让 Svelte 的响应式系统自行判断是否需要更新 DOM
    filteredCards = newFilteredCards;
  });


  type ColumnManagerPresetId = 'minimal' | 'learning' | 'review' | 'exam' | 'reading' | 'all';

  interface ColumnManagerPreset {
    id: ColumnManagerPresetId;
    label: string;
    description: string;
  }

  function createDefaultColumnVisibilityForSource(source: 'memory' | 'questionBank' | 'incremental-reading') {
    const next = {
      front: true,
      back: true,
      status: true,
      deck: true,
      tags: true,
      priority: true,
      created: true,
      modified: false,
      next_review: false,
      retention: false,
      interval: false,
      difficulty: false,
      review_count: false,
      actions: true,
      uuid: false,
      obsidian_block_link: true,
      source_document: true,
      field_template: true,
      source_document_status: true,
      question_type: false,
      accuracy: false,
      test_attempts: false,
      last_test: false,
      error_level: false,
      ir_title: false,
      ir_source_file: false,
      ir_state: false,
      ir_priority: false,
      ir_tags: false,
      ir_favorite: false,
      ir_next_review: false,
      ir_review_count: false,
      ir_reading_time: false,
      ir_notes: false,
      ir_extracted_cards: false,
      ir_created: false,
      ir_decks: false,
    };

    if (source === 'questionBank') {
      next.question_type = true;
      next.accuracy = true;
      next.test_attempts = true;
      next.last_test = true;
      next.error_level = true;
      return next;
    }

    if (source === 'incremental-reading') {
      next.front = false;
      next.back = false;
      next.status = false;
      next.deck = false;
      next.tags = false;
      next.priority = false;
      next.created = false;
      next.obsidian_block_link = false;
      next.source_document = false;
      next.field_template = false;
      next.source_document_status = false;

      next.ir_title = true;
      next.ir_source_file = true;
      next.ir_state = true;
      next.ir_priority = true;
      next.ir_tags = true;
      next.ir_favorite = true;
      next.ir_next_review = true;
      next.ir_review_count = true;
      next.ir_extracted_cards = true;
      next.ir_created = true;
      next.ir_decks = true;
      return next;
    }

    return next;
  }

  const MEMORY_MINIMAL_COLUMNS: ColumnKey[] = ['front', 'status', 'deck', 'tags', 'priority', 'actions'];
  const MEMORY_LEARNING_COLUMNS: ColumnKey[] = ['front', 'back', 'status', 'deck', 'tags', 'priority', 'source_document', 'created', 'actions'];
  const MEMORY_REVIEW_COLUMNS: ColumnKey[] = ['front', 'back', 'status', 'next_review', 'retention', 'interval', 'difficulty', 'review_count', 'actions'];
  const QUESTION_BANK_MINIMAL_COLUMNS: ColumnKey[] = ['front', 'status', 'question_type', 'accuracy', 'error_level', 'actions'];
  const QUESTION_BANK_EXAM_COLUMNS: ColumnKey[] = ['front', 'back', 'status', 'deck', 'question_type', 'accuracy', 'test_attempts', 'last_test', 'error_level', 'actions'];
  const IR_MINIMAL_COLUMNS: ColumnKey[] = ['ir_title', 'ir_state', 'ir_priority', 'ir_tags', 'actions'];
  const IR_READING_COLUMNS: ColumnKey[] = ['ir_title', 'ir_source_file', 'ir_state', 'ir_priority', 'ir_tags', 'ir_favorite', 'ir_next_review', 'ir_review_count', 'ir_extracted_cards', 'ir_created', 'ir_decks', 'actions'];

  // 列可见性状态
  let columnVisibility = $state(createDefaultColumnVisibilityForSource('memory'));

  // 列顺序状态
  let columnOrder = $state<ColumnOrder>([...DEFAULT_COLUMN_ORDER]);

  function persistColumnVisibility(nextVisibility = columnVisibility) {
    try {
      vaultStorage.setItem('weave-column-visibility', JSON.stringify(nextVisibility));
    } catch (error) {
      logger.error('保存列设置失败:', error);
    }
  }

  function persistColumnOrder(nextOrder = columnOrder) {
    try {
      vaultStorage.setItem('weave-column-order', JSON.stringify(nextOrder));
    } catch (error) {
      logger.error('保存列顺序失败:', error);
    }
  }

  function handleVisibilityChange(key: keyof typeof columnVisibility, value: boolean) {
    columnVisibility[key] = value;
    persistColumnVisibility();
  }

  function handleOrderChange(newOrder: ColumnOrder) {
    columnOrder = newOrder;
    persistColumnOrder(newOrder);
  }

  function applyColumnVisibilitySet(visibleKeys: ColumnKey[]) {
    const visibleSet = new Set<ColumnKey>(visibleKeys);
    const nextVisibility = { ...columnVisibility };

    for (const key of Object.keys(nextVisibility) as ColumnKey[]) {
      nextVisibility[key] = visibleSet.has(key);
    }

    nextVisibility.actions = true;
    columnVisibility = nextVisibility;
    persistColumnVisibility(nextVisibility);
  }

  function getColumnManagerPresets(): ColumnManagerPreset[] {
    if (dataSource === 'questionBank') {
      return [
        { id: 'minimal', label: '极简', description: '保留考试最核心字段' },
        { id: 'exam', label: '考试', description: '显示考试分析常用字段' },
        { id: 'all', label: '全部', description: '显示当前数据源的全部字段' },
      ];
    }

    if (dataSource === 'incremental-reading') {
      return [
        { id: 'minimal', label: '极简', description: '保留阅读流程核心字段' },
        { id: 'reading', label: '阅读', description: '显示增量阅读常用字段' },
        { id: 'all', label: '全部', description: '显示当前数据源的全部字段' },
      ];
    }

    return [
      { id: 'minimal', label: '极简', description: '只保留卡片浏览最常用字段' },
      { id: 'learning', label: '学习', description: '显示卡片管理常用字段' },
      { id: 'review', label: '复习', description: '显示复习分析常用字段' },
      { id: 'all', label: '全部', description: '显示记忆牌组全部字段' },
    ];
  }

  function getPresetColumns(presetId: ColumnManagerPresetId): ColumnKey[] {
    if (dataSource === 'questionBank') {
      if (presetId === 'minimal') return QUESTION_BANK_MINIMAL_COLUMNS;
      if (presetId === 'exam') return QUESTION_BANK_EXAM_COLUMNS;
      return DEFAULT_COLUMN_ORDER.filter((key) => !key.startsWith('ir_'));
    }

    if (dataSource === 'incremental-reading') {
      if (presetId === 'minimal') return IR_MINIMAL_COLUMNS;
      if (presetId === 'reading') return IR_READING_COLUMNS;
      return DEFAULT_COLUMN_ORDER.filter((key) => key.startsWith('ir_') || key === 'actions');
    }

    if (presetId === 'minimal') return MEMORY_MINIMAL_COLUMNS;
    if (presetId === 'learning') return MEMORY_LEARNING_COLUMNS;
    if (presetId === 'review') return MEMORY_REVIEW_COLUMNS;

    return DEFAULT_COLUMN_ORDER.filter((key) => !key.startsWith('ir_') && !['question_type', 'accuracy', 'test_attempts', 'last_test', 'error_level'].includes(key));
  }

  function applyColumnManagerPreset(presetId: ColumnManagerPresetId) {
    applyColumnVisibilitySet(getPresetColumns(presetId));
  }

  function resolveCurrentColumnManagerPreset(): ColumnManagerPresetId | null {
    const currentVisibleKeys = (Object.keys(columnVisibility) as ColumnKey[])
      .filter((key) => columnVisibility[key]);

    for (const preset of getColumnManagerPresets()) {
      const presetKeys = [...new Set(getPresetColumns(preset.id))].sort();
      const normalizedCurrent = [...currentVisibleKeys].sort();

      if (
        presetKeys.length === normalizedCurrent.length &&
        presetKeys.every((key, index) => key === normalizedCurrent[index])
      ) {
        return preset.id;
      }
    }

    return null;
  }

  function resetColumnManagerConfig() {
    columnVisibility = createDefaultColumnVisibilityForSource(dataSource);
    columnOrder = [...DEFAULT_COLUMN_ORDER];
    persistColumnVisibility(columnVisibility);
    persistColumnOrder(columnOrder);
  }

  /**
   * 🔧 同步列可见性与数据源
   * 确保表格头部属性与当前数据源匹配
   */
  function syncColumnVisibilityWithDataSource(source: 'memory' | 'questionBank' | 'incremental-reading') {
    if (source === 'questionBank') {
      tableViewMode = 'questionBank';
    } else if (source === 'incremental-reading') {
      tableViewMode = 'irContent';
    } else {
      tableViewMode = 'basic';
    }

    columnVisibility = createDefaultColumnVisibilityForSource(source);
    persistColumnVisibility(columnVisibility);
  }

  // 筛选状态
  let filters = $state({
    status: new Set<string>(),
    decks: new Set<string>(),
    tags: new Set<string>(),
    questionTypes: new Set<string>(),     // 新增：题型筛选
    errorBooks: new Set<string>(),        // 新增：错题集筛选
    searchQuery: ""
  });

  // 排序状态
  let sortConfig = $state({
    field: "created",
    direction: "desc" as "asc" | "desc"
  });

  // 排序加载状态
  let isSorting = $state(false);
  let sortingField = $state<string | null>(null);
  let sortingDirection = $state<'asc' | 'desc' | null>(null);
  
  // 🔒 同步标志位：立即阻止重复点击（不依赖响应式系统）
  let sortingLock = false;
  
  // ⏱️ 排序开始时间（用于确保最小显示时间）
  let sortStartTime = 0;
  
  // 🎯 排序请求ID：用于追踪当前排序请求（防止多次 $effect 触发导致的混乱）
  let sortRequestId = 0;
  
  // 🔓 延迟释放锁的定时器引用（用于清理）
  let sortLockReleaseTimer: number | null = null;

  // 使用 $state + $effect 替代 $derived，避免 reconciliation 错误
  let statusCounts = $state<Record<string, number>>({});
  let availableDecks = $state<Array<{id: string, name: string, count: number}>>([]);
  let availableTags = $state<Array<{name: string, count: number}>>([]);
  let questionTypeCounts = $state<Record<string, number>>({});     // 新增：题型统计
  let errorBookCounts = $state<Record<string, number>>({});        // 新增：错题集统计
  
  const currentSourceCards = $derived.by(() => {
    return dataSource === 'questionBank'
      ? questionBankCards
      : dataSource === 'incremental-reading'
        ? irContentCards
        : cards;
  });

  function getDecksForDataSource(source: 'memory' | 'questionBank' | 'incremental-reading' = dataSource): Deck[] {
    if (source === 'questionBank') {
      return questionBankDecks;
    }
    if (source === 'incremental-reading') {
      return Object.values(irDecks).map(d => ({ id: d.id, name: d.name } as Deck));
    }
    return allDecks;
  }

  // 🆕 搜索组件需要的数据
  const searchSourceCards = $derived(currentSourceCards);

  const currentDataSourceDecks = $derived.by(() => getDecksForDataSource(dataSource));

  const searchAvailableDecks = $derived(currentDataSourceDecks);

  const searchAvailableTags = $derived.by(() => {
    // 使用与侧边栏标签树相同的 calculateTagCounts 逻辑，确保标签提取一致
    const cardsForTags = searchSourceCards.map(c => ({
      id: c.uuid,
      tags: c.tags,
      content: c.content
    }));
    const { allTags } = calculateTagCounts(cardsForTags);
    // 补充 IR 标签（增量阅读专用）
    if (dataSource === 'incremental-reading') {
      const tagSet = new Set(allTags);
      for (const c of searchSourceCards) {
        const irTags = (c as any).ir_tags as string[] | undefined;
        if (Array.isArray(irTags)) {
          for (const t of irTags) tagSet.add(t);
        }
      }
      return Array.from(tagSet).sort();
    }
    return allTags.sort();
  });

  let searchAvailablePriorities = $derived.by(() => {
    const priorities = new Set<number>();
    searchSourceCards.forEach(card => {
      const p = (card as any).priority;
      if (p !== undefined && p !== null) {
        priorities.add(p);
      }
    });
    return Array.from(priorities).sort((a, b) => b - a);
  });
  
  let searchAvailableQuestionTypes = $derived.by(() => {
    const types = new Set<string>();
    for (const c of searchSourceCards) {
      const t = detectCardQuestionType(c);
      if (t) types.add(String(t));
    }
    return Array.from(types);
  });
  
  let searchAvailableSources = $derived.by(() => {
    const sources = new Set<string>();
    searchSourceCards.forEach(card => {
      const source = (card as any).sourceFile;
      if (source) {
        sources.add(source);
      }
    });
    return Array.from(sources).sort();
  });

  const searchAvailableStatuses = $derived.by(() => {
    if (dataSource !== 'memory') return [];
    return ['new', 'learning', 'review', 'relearning'];
  });

  const searchAvailableIRStates = $derived.by(() => {
    if (dataSource !== 'incremental-reading') return [];
    const set = new Set<string>();
    for (const c of irContentCards) {
      const s = (c as any).ir_state;
      if (s) set.add(String(s));
    }
    return Array.from(set);
  });

  const searchAvailableAccuracies = $derived.by(() => {
    if (dataSource !== 'questionBank') return [];
    return ['high', 'medium', 'low', '80', '60'];
  });

  const searchAvailableAttemptThresholds = $derived.by(() => {
    if (dataSource !== 'questionBank') return [];
    return [1, 3, 5, 10];
  });

  const searchAvailableErrorLevels = $derived.by(() => {
    if (dataSource !== 'questionBank') return [];
    return ['high', 'common', 'light', 'none'];
  });

  const searchAvailableYamlKeys = $derived.by(() => {
    const keySet = new Set<string>();
    const sample = searchSourceCards.slice(0, 200);
    for (const card of sample) {
      if (typeof card.content === 'string' && card.content) {
        try {
          const yaml = parseYAMLFromContent(card.content);
          for (const key of Object.keys(yaml)) {
            if (!key.startsWith('we_')) keySet.add(key);
          }
        } catch { /* ignore */ }
      }
    }
    return Array.from(keySet).sort();
  });

  // 使用 $effect 来更新统计数据
  let statisticsUpdateTimer: number | null = null;
  $effect(() => {
    // 🔧 性能优化：只在组件挂载且视图可见时计算
    if (!isMounted || !isViewVisible) {
      // 清理定时器
      if (statisticsUpdateTimer !== null) {
        clearTimeout(statisticsUpdateTimer);
        statisticsUpdateTimer = null;
      }
      return;
    }
    
    // 🔧 根据数据源选择统计用的源数据
    const currentSource = dataSource;
    const statsCards = currentSourceCards;
    
    if (!Array.isArray(statsCards)) {
      statusCounts = {};
      availableDecks = [];
      availableTags = [];
      questionTypeCounts = {};
      errorBookCounts = {};
      return;
    }
    
    // 🔧 性能优化：根据数据量决定是否延迟计算
    const shouldDefer = statsCards.length > 100; // 大数据集才延迟
    
    const updateStatistics = () => {

      // 计算状态统计
    if (currentSource === 'incremental-reading') {
      // IR模式：统计阅读状态
      const irStatusMap: Record<string, number> = {};
      statsCards.forEach(card => {
        const state = (card as any).ir_state || 'new';
        irStatusMap[state] = (irStatusMap[state] || 0) + 1;
      });
      statusCounts = irStatusMap;
    } else {
      const newStatusCounts = statsCards.reduce((acc, card) => {
        if (!card.fsrs) return acc;
        const status = getCardStatusString(card.fsrs.state);
        acc[status] = (acc[status] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      statusCounts = newStatusCounts;
    }

    const statsDecks = getDecksForDataSource(currentSource);

    // 🆕 v2.0: 引用式牌组架构 - 计算牌组统计
    const deckMap = new Map<string, number>();
    
    if (currentSource === 'incremental-reading') {
      // IR模式：从 ir_deck_ids 或 ir_deck 统计
      statsCards.forEach(card => {
        const deckIds = (card as any).ir_deck_ids as string[] | undefined;
        if (deckIds && deckIds.length > 0) {
          deckIds.forEach((did: string) => {
            deckMap.set(did, (deckMap.get(did) || 0) + 1);
          });
        } else {
          const deckName = (card as any).ir_deck || '未分配';
          deckMap.set(deckName, (deckMap.get(deckName) || 0) + 1);
        }
      });
      
      // IR 牌组名称解析
      availableDecks = Array.from(deckMap.entries()).map(([id, count]) => {
        return { id, name: getIRDeckName(id, id), count };
      });
    } else {
      const cardUUIDSet = new Set(statsCards.map(c => c.uuid));
      
      // 方式1：通过 deck.cardUUIDs 统计（优先）
      statsDecks.forEach(deck => {
        if (deck.cardUUIDs && deck.cardUUIDs.length > 0) {
          const count = deck.cardUUIDs.filter(uuid => cardUUIDSet.has(uuid)).length;
          if (count > 0) {
            deckMap.set(deck.id, count);
          }
        }
      });
      
      // 方式2：对于没有 cardUUIDs 的牌组，通过 we_decks/referencedByDecks/deckId 统计
      // 🆕 v2.2: 优先从 content YAML 的 we_decks 获取牌组ID
      statsCards.forEach(card => {
        const { deckIds: cardDeckIds } = getCardDeckIds(card, statsDecks);
        if (cardDeckIds.length > 0) {
          cardDeckIds.forEach((deckId: string) => {
            const deck = statsDecks.find(d => d.id === deckId);
            if (!deck?.cardUUIDs?.length) {
              deckMap.set(deckId, (deckMap.get(deckId) || 0) + 1);
            }
          });
        } else if (card.referencedByDecks && card.referencedByDecks.length > 0) {
          card.referencedByDecks.forEach((deckId: string) => {
            const deck = statsDecks.find(d => d.id === deckId);
            if (!deck?.cardUUIDs?.length) {
              deckMap.set(deckId, (deckMap.get(deckId) || 0) + 1);
            }
          });
        } else if (card.deckId) {
          const deck = statsDecks.find(d => d.id === card.deckId);
          if (!deck?.cardUUIDs?.length) {
            deckMap.set(card.deckId, (deckMap.get(card.deckId) || 0) + 1);
          }
        }
      });
      
      availableDecks = Array.from(deckMap.entries()).map(([id, count]) => ({
        id,
        name: getDeckName(id, statsDecks),
        count
      }));
    }

    // 计算标签统计
    const tagMap = new Map<string, number>();
    if (currentSource === 'incremental-reading') {
      // IR模式：从 ir_tags 和 card.tags 合并统计
      statsCards.forEach(card => {
        const irTags = (card as any).ir_tags as string[] | undefined;
        const cardTags = card.tags || [];
        const allCardTags = new Set([...(irTags || []), ...cardTags]);
        allCardTags.forEach(tag => {
          tagMap.set(tag, (tagMap.get(tag) || 0) + 1);
        });
      });
    } else {
      // 🆕 v2.1: 使用 CardMetadataService 兼容新旧格式
      const metadataService = getCardMetadataService();
      statsCards.forEach(card => {
        const cardTags = metadataService.getCardTags(card);
        cardTags.forEach(tag => {
          tagMap.set(tag, (tagMap.get(tag) || 0) + 1);
        });
      });
    }
    availableTags = Array.from(tagMap.entries()).map(([name, count]) => ({
      name,
      count
    })).sort((a, b) => b.count - a.count);

    // 🆕 计算题型统计
    questionTypeCounts = getQuestionTypeDistribution(statsCards);

      // 🆕 计算错题集统计
      errorBookCounts = getErrorBookDistribution(statsCards);
      
    };
    
    if (shouldDefer) {
      // 大数据集：延迟计算，避免阻塞主线程
      if (statisticsUpdateTimer !== null) {
        clearTimeout(statisticsUpdateTimer);
      }
      statisticsUpdateTimer = window.setTimeout(() => {
        updateStatistics();
        statisticsUpdateTimer = null;
      }, 150);
    } else {
      // 小数据集：立即更新，避免数据不一致
      updateStatistics();
    }
  });

  // 🚀 性能优化：缓存VIEW_TYPE_WEAVE常量，避免重复动态导入
  let VIEW_TYPE_WEAVE_CACHED: string | null = null;
  
  /**
   * 检测当前视图是否在侧边栏
   * 使用Obsidian官方API进行精确检测
   */
  async function detectSidebarContext() {
    if (!plugin?.app?.workspace) {
      isInSidebar = false; // 🔧 降级：无法检测时隐藏按钮
      return;
    }
    
    try {
      // 🚀 性能优化：只在第一次时动态导入，之后使用缓存
      if (!VIEW_TYPE_WEAVE_CACHED) {
        const module = await import('../../views/WeaveView');
        VIEW_TYPE_WEAVE_CACHED = module.VIEW_TYPE_WEAVE;
      }
      
      const leaves = plugin.app.workspace.getLeavesOfType(VIEW_TYPE_WEAVE_CACHED);
      
      if (leaves.length === 0) {
        isInSidebar = false; // 🔧 降级：找不到leaf时隐藏按钮（等待leaf创建）
        return;
      }
      
      const leaf = leaves[0];
      const leafRoot = leaf.getRoot();
      const workspace = plugin.app.workspace;
      
      // 精确判断：leaf不在主编辑区 = 在侧边栏
      const isInMainArea = leafRoot === workspace.rootSplit;
      const newState = !isInMainArea;
      
      // 仅在状态真正改变时更新（触发Svelte响应式更新）
      if (isInSidebar !== newState) {
        isInSidebar = newState;
      }
      
    } catch (error) {
      logger.error('侧边栏检测失败:', error);
      // 降级策略：检测失败时隐藏按钮（保守策略）
      if (isInSidebar !== false) {
        isInSidebar = false;
      }
    }
  }

  /**
   * 获取文件名（不含路径）
   */
  function getFileName(filePath: string): string {
    const parts = filePath.split('/');
    return parts[parts.length - 1].replace(/\.md$/i, '');
  }

  const EPUB_VIEW_TYPES = new Set(['weave-epub-reader', 'weave-epub-sidebar']);
  const IR_VIEW_TYPES = new Set(['weave-ir-calendar-view']);
  const INTERNAL_WEAVE_VIEW_TYPES = new Set([
    'weave-view',
    'weave-study-view',
    'weave-question-bank-view'
  ]);

  function getLeafFilePath(leaf?: WorkspaceLeaf | null): string | null {
    const view = leaf?.view as any;
    const directPath = view?.file?.path;
    if (typeof directPath === 'string' && directPath.trim()) {
      return directPath;
    }

    const viewState = view?.getState?.();
    const serializedPath = viewState?.filePath || viewState?.file;
    if (typeof serializedPath === 'string' && serializedPath.trim()) {
      return serializedPath;
    }

    return null;
  }

  function rememberExternalDocument(path: string | null, kind: 'file' | 'epub' | 'ir'): string | null {
    if (path) {
      lastExternalActiveDocument = path;
      lastExternalDocumentKind = kind;
    }
    return path;
  }

  function resolveCurrentActiveDocument(activeLeaf?: WorkspaceLeaf | null): string | null {
    const leaf = activeLeaf ?? plugin?.app?.workspace?.activeLeaf;
    if (!leaf) {
      return lastExternalActiveDocument;
    }

    if (currentLeaf && leaf === currentLeaf) {
      if (lastExternalDocumentKind === 'epub') {
        return epubActiveDocumentStore.getActiveDocument() ?? lastExternalActiveDocument;
      }
      if (lastExternalDocumentKind === 'ir') {
        return irActiveDocumentStore.getActiveDocument() ?? lastExternalActiveDocument;
      }
      return lastExternalActiveDocument;
    }

    const activeViewType = leaf?.view?.getViewType?.() ?? '';
    const leafFilePath = getLeafFilePath(leaf);

    if (leafFilePath) {
      return rememberExternalDocument(leafFilePath, 'file');
    }

    if (EPUB_VIEW_TYPES.has(activeViewType)) {
      const epubPath = epubActiveDocumentStore.getActiveDocument() ?? null;
      return epubPath ? rememberExternalDocument(epubPath, 'epub') : lastExternalActiveDocument;
    }

    if (IR_VIEW_TYPES.has(activeViewType)) {
      const irPath = irActiveDocumentStore.getActiveDocument() ?? null;
      return irPath ? rememberExternalDocument(irPath, 'ir') : lastExternalActiveDocument;
    }

    if (INTERNAL_WEAVE_VIEW_TYPES.has(activeViewType)) {
      return lastExternalActiveDocument;
    }

    const activeFile = plugin?.app?.workspace?.getActiveFile();
    return rememberExternalDocument(activeFile?.path ?? null, 'file');
  }

  // 监听活动文档变化
  function setupActiveDocumentListener() {
    if (!plugin?.app?.workspace) return;

    // 获取当前活动文档
    function updateActiveDocument() {
      currentActiveDocument = resolveCurrentActiveDocument(plugin.app.workspace.activeLeaf);
    }

    // 初始化当前活动文档
    updateActiveDocument();

    // 监听活动文档变化
    plugin.app.workspace.on('active-leaf-change', updateActiveDocument);
    plugin.app.workspace.on('file-open', updateActiveDocument);

    // 清理函数
    return () => {
      plugin.app.workspace.off('active-leaf-change', updateActiveDocument);
      plugin.app.workspace.off('file-open', updateActiveDocument);
    };
  }

  // 文档过滤切换函数
  function toggleDocumentFilter() {
    documentFilterMode = documentFilterMode === 'all' ? 'current' : 'all';
    // ✅ 修复：不再持久化过滤模式，避免自动触发过滤
    // 用户需要主动点击按钮才会应用文档过滤
  }

  // 异步初始化函数
  async function initializeAsync() {
    // 🔥 关键修复：等待所有核心服务就绪（包括 cardFileService）
    // 视图可能在 workspace 恢复时创建，此时 cardFileService 还未初始化
    // 必须等待 allCoreServices 而不是 dataStorage，因为 getCards() 依赖 cardFileService
    await waitForServiceReady('allCoreServices', 15000);
    
    // Load initial data
    allDecks = await dataStorage.getDecks();
    await loadCards();

    // 🆕 初始化嵌入式编辑器管理器（方案A：永久隐藏Leaf）
    editorPoolManager = new EmbeddableEditorManager(plugin.app);
    
    // 🆕 初始化题库数据存储
    questionBankStorage = new QuestionBankStorage(plugin.app);
    await questionBankStorage.initialize();
  }

  // 生命周期
  onMount(() => {
    isMounted = true;
    
    // 🆕 订阅全局筛选状态（从FilterStateService）
    const filterUnsubscribe = plugin.filterStateService?.subscribe((state) => {
      
      // 同步全局筛选状态到本地
      globalSelectedDeckId = state.selectedDeckId;
      globalSelectedCardTypes = new Set(state.selectedCardTypes);
      globalSelectedPriority = state.selectedPriority;
      globalSelectedTags = new Set(state.selectedTags);
      globalSelectedTimeFilter = state.selectedTimeFilter;
      globalShowOrphanCards = state.showOrphanCards;  // 🆕 v2.0 同步孤儿卡片筛选
    });
    
    // 🆕 订阅数据同步服务（卡片变更）
    let cardsUnsubscribe: (() => void) | undefined;
    if (plugin.dataSyncService) {
      cardsUnsubscribe = plugin.dataSyncService.subscribe(
        'cards',
        async (event) => {
          await loadCards();
        },
        { debounce: 300 }
      );
    }
    
    // 🆕 订阅数据同步服务（牌组变更）
    let decksUnsubscribe: (() => void) | undefined;
    if (plugin.dataSyncService) {
      decksUnsubscribe = plugin.dataSyncService.subscribe(
        'decks',
        async (event) => {
          allDecks = await dataStorage.getDecks();
        },
        { debounce: 300 }
      );
    }
    
    // 初始化 FilterManager
    filterManager = new FilterManager();
    savedFilters = filterManager.getAllFilters();
    
    // 🆕 延迟初始化侧边栏检测（确保leaf已创建）
    setTimeout(async () => {
      await detectSidebarContext();  // 🚀 使用缓存的动态导入
    }, 200);
    
    // 🆕 监听窗口大小变化
    const handleResize = async () => {
      await detectSidebarContext();  // 🚀 使用缓存的动态导入
    };
    window.addEventListener('resize', handleResize);
    
    // 🆕 工具栏模式检测（使用 ResizeObserver + MutationObserver）
    // 🔧 修复：监听 workspace-leaf-content 而不是组件内部容器
    let resizeObserver: ResizeObserver | null = null;
    let mutationObserver: MutationObserver | null = null;
    
    // 🔧 使用 tick().then() 确保 DOM 已渲染
    tick().then(() => {
      // 查找最近的 workspace-leaf-content（这是 Obsidian 控制宽度的容器）
      const rootContainer = document.querySelector('.weave-card-management-page');
      const leafContent = rootContainer?.closest('.workspace-leaf-content');
      const observeTarget = leafContent || rootContainer;
      
      if (observeTarget) {
        // ResizeObserver 监听宽度变化
        resizeObserver = new ResizeObserver(() => {
        });
        resizeObserver.observe(observeTarget);
        
        // MutationObserver 监听 DOM 结构变化（视图移动到侧边栏）
        const workspace = document.querySelector('.workspace');
        if (workspace) {
          mutationObserver = new MutationObserver(() => {
            // DOM 结构变化时重新检测
          });
          mutationObserver.observe(workspace, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class']
          });
        }
        
      }
    });
    
    // 监听布局变化（视图拖动时触发）
    const layoutChangeHandler = () => {
      // 延迟执行，等待布局稳定
      setTimeout(async () => {
        await detectSidebarContext();  
      }, 150);
    };
    plugin.app.workspace.on('layout-change', layoutChangeHandler);
    
    // 🔧 修复：移除错误的active-leaf-change检测
    // 原逻辑检查 getViewType() !== 'weave-card-management'，但实际视图类型是 'weave-view'
    // 导致isViewVisible永远为false，数据被清空
    // 
    // 正确的逻辑：组件被Svelte渲染 = 可见，组件被销毁 = 不可见
    // 使用onDestroy来清理资源，而不是依赖active-leaf-change
    
    // 🆕 监听按卡片ID筛选事件（来自其他组件，如CardInfoTab）
    const handleFilterByCards = (e: CustomEvent<{ cardIds: string[], filterName: string, parentCardPreview?: string }>) => {
      const { cardIds, filterName, parentCardPreview } = e.detail;
      // Received filter request
      if (customCardIdsFilter === null || customCardIdsFilter.size === 0) {
        // First filter, create new set
        customCardIdsFilter = new Set(cardIds);
      } else {
        // Already filtered, append to set
        cardIds.forEach(id => customCardIdsFilter!.add(id));
      }
      
      customFilterName = filterName;
      
      // Notify user
      const filterMessage = parentCardPreview 
        ? t('cards.management.filterFromSource', { count: cardIds.length, source: parentCardPreview })
        : t('cards.management.filtered', { count: cardIds.length });
      new Notice(filterMessage);
    };
    window.addEventListener('Weave:filter-by-cards', handleFilterByCards as EventListener);
    
    // 🆕 监听侧边栏视图切换事件
    const handleSidebarViewChange = (e: CustomEvent<string>) => {
      const view = e.detail as 'table' | 'grid' | 'kanban';
      switchView(view);
    };
    window.addEventListener('Weave:sidebar-view-change', handleSidebarViewChange as EventListener);
    
    // 🆕 监听彩色圆点的数据源切换事件
    const handleCardDataSourceChange = async (e: Event) => {
      const source = (e as CustomEvent<string>).detail as 'memory' | 'questionBank' | 'incremental-reading';
      await switchDataSource(source);
    };
    window.addEventListener('Weave:card-data-source-change', handleCardDataSourceChange);

    const handleCardManagementSearchChange = (e: Event) => {
      const value = (e as CustomEvent<{ value?: string }>).detail?.value ?? '';
      handleSearch(value);
    };
    window.addEventListener('Weave:card-management-search-change', handleCardManagementSearchChange as EventListener);

    const handleIRRealtimeRefresh = async () => {
      if (dataSource !== 'incremental-reading') return;
      await loadIRContentCards({ silent: true });
    };
    window.addEventListener('Weave:ir-timer-updated', handleIRRealtimeRefresh);
    window.addEventListener('Weave:ir-data-updated', handleIRRealtimeRefresh);

    const handleCardManagementToolbarAction = (e: Event) => {
      const detail = (e as CustomEvent<{ action?: string; anchor?: HTMLElement | null }>).detail;
      const action = detail?.action;
      const anchor = detail?.anchor ?? null;

      switch (action) {
        case 'create-card':
          handleCreateCard();
          break;
        case 'toggle-document-filter':
          if (currentActiveDocument) {
            toggleDocumentFilter();
          }
          break;
        case 'toggle-card-location-jump':
          void toggleCardLocationJump();
          break;
        case 'table-view-basic':
          void handleTableViewModeChange('basic');
          break;
        case 'table-view-review':
          void handleTableViewModeChange('review');
          break;
        case 'ir-type-md':
          irTypeFilter = irTypeFilter === 'md' ? 'all' : 'md';
          void saveViewPreferences();
          break;
        case 'ir-type-pdf':
          irTypeFilter = irTypeFilter === 'pdf' ? 'all' : 'pdf';
          void saveViewPreferences();
          break;
        case 'grid-layout-fixed':
          void handleLayoutModeChange('fixed');
          break;
        case 'grid-layout-masonry':
          void handleLayoutModeChange('masonry');
          break;
        case 'grid-layout-timeline':
          void handleLayoutModeChange('timeline');
          break;
        case 'kanban-layout-compact':
          void handleKanbanLayoutModeChange('compact');
          break;
        case 'kanban-layout-comfortable':
          void handleKanbanLayoutModeChange('comfortable');
          break;
        case 'kanban-layout-spacious':
          void handleKanbanLayoutModeChange('spacious');
          break;
        case 'open-data-management':
          openDataManagementModal('data');
          break;
        case 'open-column-manager':
          toggleColumnManager(anchor);
          break;
        case 'open-kanban-column-settings':
          window.dispatchEvent(new CustomEvent('Weave:open-kanban-column-settings-menu'));
          break;
        case 'open-grid-attribute-menu':
          openGridAttributeMenu(anchor);
          break;
      }
    };
    window.addEventListener('Weave:card-management-toolbar-action', handleCardManagementToolbarAction as EventListener);
    
    // 🆕 初始化时通知父组件当前视图状态
    window.dispatchEvent(new CustomEvent('Weave:card-view-change', { detail: currentView }));
    
    // 立即订阅当前活动文档变化
    const updateActiveDocumentNow = () => {
      const nextActiveDocument = resolveCurrentActiveDocument(plugin.app.workspace.activeLeaf);
      currentActiveDocument = nextActiveDocument;
      logger.debug('[卡片管理] 当前活动文档更新:', currentActiveDocument, {
        activeLeafType: plugin.app.workspace.activeLeaf?.view?.getViewType?.() ?? 'unknown'
      });
    };
    
    // 调用一次，确保初始化
    updateActiveDocumentNow();
    
    // 🆕 订阅增量阅读活动文档变化
    const irUnsubscribe = irActiveDocumentStore.subscribe((filePath) => {
      currentActiveDocument = resolveCurrentActiveDocument(plugin.app.workspace.activeLeaf);
    });
    
    // 订阅EPUB阅读器活动文档变化
    const epubUnsubscribe = epubActiveDocumentStore.subscribe((filePath) => {
      currentActiveDocument = resolveCurrentActiveDocument(plugin.app.workspace.activeLeaf);
    });
    
    // 监听文档切换事件
    const eventRef = plugin.app.workspace.on('active-leaf-change', (leaf) => {
      currentActiveDocument = resolveCurrentActiveDocument((leaf as WorkspaceLeaf | null) ?? plugin.app.workspace.activeLeaf);
    });
    const fileOpenRef = plugin.app.workspace.on('file-open', () => {
      currentActiveDocument = resolveCurrentActiveDocument(plugin.app.workspace.activeLeaf);
    });
    
    // 保存清理函数
    documentListenerCleanup = () => {
      plugin.app.workspace.offref(eventRef);
      plugin.app.workspace.offref(fileOpenRef);
      irUnsubscribe();
      epubUnsubscribe();
    };
    
    // 异步初始化
    initializeAsync();

    // ✅ 修复：不再从 localStorage 恢复文档过滤模式
    // 保持初始值为 'all'，用户需要主动点击才会应用过滤
    // 这避免了自动触发文档过滤的问题

    // 加载列可见性设置
    const savedColumnVisibility = vaultStorage.getItem('weave-column-visibility');
    if (savedColumnVisibility) {
      try {
        const parsed = JSON.parse(savedColumnVisibility);
        // 合并保存的设置和默认设置（确保新增字段有默认值）
        columnVisibility = { ...columnVisibility, ...parsed };
        // 列设置加载成功
      } catch (error) {
        logger.error('解析列设置失败:', error);
      }
    }
    
    // 🔧 关键修复：同步列可见性与当前数据源，防止表头与数据源错乱
    syncColumnVisibilityWithDataSource(dataSource);

    // 加载列顺序设置
    const savedColumnOrder = vaultStorage.getItem('weave-column-order');
    if (savedColumnOrder) {
      try {
        const parsed = JSON.parse(savedColumnOrder);
        // 🔄 合并保存的顺序和默认顺序（确保新增列被包含）
        const defaultOrder = [...DEFAULT_COLUMN_ORDER];
        // 🔧 防御性检查：确保parsed是有效数组
        if (!Array.isArray(parsed) || parsed.length === 0) {
          logger.warn('[ColumnOrder] 保存的列顺序无效，使用默认值');
          columnOrder = [...DEFAULT_COLUMN_ORDER];
        } else {
          const mergedOrder = [
            ...parsed.filter((key: ColumnKey) => defaultOrder.includes(key)),
            ...defaultOrder.filter((key: ColumnKey) => !parsed.includes(key))
          ];
          columnOrder = mergedOrder;
          // 列顺序设置加载成功
        }
      } catch (error) {
        logger.error('解析列设置失败:', error);
      }
    }

    isLoading = false;

    // 清理函数
    const cleanupResources = () => {
      // 关闭活动的编辑器
      if (editorPoolManager) {
        try {
          // 编辑器管理器会在组件销毁时自动清理
          logger.debug('[cleanupResources] 编辑器管理器存在，将自动清理');
        } catch (error) {
          logger.debug('[cleanupResources] 清理编辑器失败:', error);
        }
      }
      
      isViewDestroyed = true;
      
      // 清理所有间隔
      if (refreshInterval) {
        clearInterval(refreshInterval);
        refreshInterval = null;
      }
      
      // 清理导航超时
      if (navigationTimeout !== null) {
        clearTimeout(navigationTimeout);
        navigationTimeout = null;
      }
      
      // 🚀 清理内容缓存，防止内存泄漏
      // 但如果正在导航，保留缓存以避免返回时重新计算
      if (!isNavigatingToSource) {
        contentCache.clear();
      }
      
      // 清理订阅
      if (filterUnsubscribe) {
        filterUnsubscribe();
      }
      
      // 清理数据同步服务
      if (cardsUnsubscribe) {
        cardsUnsubscribe();
        // 数据订阅已取消
      }
      
      // 清理排序定时器
      if (sortLockReleaseTimer !== null) {
        clearTimeout(sortLockReleaseTimer);
        sortLockReleaseTimer = null;
        // 排序定时器已清理
        tableDataTimer = null;
      }
      
      // 🔧 清理统计数据更新定时器
      if (statisticsUpdateTimer !== null) {
        clearTimeout(statisticsUpdateTimer);
        statisticsUpdateTimer = null;
      }
      
      // 重置排序状态
      isSorting = false;
      sortingField = null;
      sortingDirection = null;
      
      // Clean up active document listener
      if (documentListenerCleanup) {
        documentListenerCleanup();
      }
      
      // Remove event listeners
      // 注：这些事件监听器未使用，已移除
      
      // 🔧 性能优化：清理缓存以释放内存
      contentCache.clear();
      cachedTransformedCards = [];
      
      isMounted = false;  // 🔥 标记组件已卸载
      
      window.removeEventListener('resize', handleResize);
      plugin.app.workspace.off('layout-change', layoutChangeHandler);
      window.removeEventListener('Weave:filter-by-cards', handleFilterByCards as EventListener);
      window.removeEventListener('Weave:sidebar-view-change', handleSidebarViewChange as EventListener);
      window.removeEventListener('Weave:card-data-source-change', handleCardDataSourceChange);
      window.removeEventListener('Weave:card-management-search-change', handleCardManagementSearchChange as EventListener);
      window.removeEventListener('Weave:card-management-toolbar-action', handleCardManagementToolbarAction as EventListener);
      window.removeEventListener('Weave:ir-timer-updated', handleIRRealtimeRefresh);
      window.removeEventListener('Weave:ir-data-updated', handleIRRealtimeRefresh);
      if (resizeObserver) resizeObserver.disconnect();
      if (mutationObserver) mutationObserver.disconnect();
    };
    
    // 返回清理函数
    return cleanupResources;
  });
  
  // 🔧 修复：添加onDestroy，确保组件销毁时清理资源
  onDestroy(() => {
    logger.debug('[卡片管理] 🗑️ 组件销毁，清理资源');
    dataManagementModalInstance?.close();
    dataManagementModalInstance = null;
    isViewVisible = false;  // 标记视图不可见
    isViewDestroyed = true; // 标记视图已销毁
  });

  // 🗑️ 已移除旧的 CustomEvent 监听器（Weave:refresh-cards）
  // 现在使用 DataSyncService 统一管理数据刷新

  // loadFieldTemplates 已删除（新系统使用动态解析，无需预加载模板）

  async function loadCards() {
    try {
      logger.debug('🔄 [卡片管理] 开始加载卡片数据...');
      
      // 等待所有核心服务就绪（包括 cardFileService）
      await waitForServiceReady('allCoreServices', 15000);
      
      // 🆕 v2.0: 完全引用式架构 - 从统一存储获取所有卡片
      let allCards: Card[] = await dataStorage.getCards();
      
      // 🆕 同时加载牌组数据
      allDecks = await dataStorage.getDecks();
      logger.debug(`✅ [卡片管理] 从统一存储加载 ${allCards.length} 张卡片`);

      // Data migration: auto-migrate old error tracking data
      const migrationStats = getMigrationStats(allCards);
      if (migrationStats.needsMigration > 0) {
        logger.debug(`🔄 检测到 ${migrationStats.needsMigration} 张卡片需要迁移错题集数据`);
        allCards = migrateCardsErrorTracking(allCards);
        logger.debug('✅ 错题集数据迁移完成');
      }

      // ✅ 确保是新引用，触发Svelte响应式更新
      cards = [...allCards];

      // 卡片加载完成
    } catch (error) {
      logger.error('❌ 加载卡片失败:', error);
      cards = [];
      new Notice(t('cards.management.loadFailed', { error: error instanceof Error ? error.message : 'Unknown error' }), 5000);
    }
  }


  // 安全创建Date对象
  function createSafeDate(dateValue: any): Date | null {
    if (!dateValue) return null;
    
    try {
      const date = new Date(dateValue);
      // 检查是否是有效的Date对象
      if (isNaN(date.getTime())) {
        return null;
      }
      return date;
    } catch (error) {
      return null;
    }
  }

  // 获取牌组名称
  function getDeckName(deckId: string, decksForLookup: Array<{ id: string; name: string }> = getDecksForDataSource()): string {
    const deck = decksForLookup.find(d => d.id === deckId);
    return deck?.name || deckId;
  }

  function getIRDeckName(deckId?: string | null, fallback: string = '未分配'): string {
    if (!deckId) return fallback;
    return getDeckName(deckId, getDecksForDataSource('incremental-reading')) || fallback;
  }
  
  // 🆕 v2.2: 获取卡片所属的所有牌组名称（Content-Only 架构）
  // 优先从 content YAML 的 we_decks 获取，回退到 referencedByDecks/deckId
  function getCardDeckNames(card: Card): string {
    if (dataSource === 'incremental-reading') {
      const names: string[] = [];
      const seen = new Set<string>();
      const ids = (card as any).ir_deck_ids || (card as any).metadata?.deckIds || [];
      if (Array.isArray(ids)) {
        for (const id of ids) {
          const name = getIRDeckName(id, String(id));
          if (name && !seen.has(name)) {
            seen.add(name);
            names.push(name);
          }
        }
      }
      const singleName = (card as any).ir_deck;
      if (typeof singleName === 'string' && singleName && singleName !== '未分配' && !seen.has(singleName)) {
        names.push(singleName);
      }
      if (names.length > 0) return names.join(', ');
    }

    // 直接使用 yaml-utils 工具函数，内部已实现完整回退链：
    // 1. content YAML 的 we_decks（牌组名称）← 权威数据源
    // 2. card.referencedByDecks（牌组ID列表）
    // 3. card.deckId（单个牌组ID）
    const decksForLookup = getDecksForDataSource(dataSource);
    const names = getCardDeckNamesFromYaml(card, decksForLookup, '-');
    return names.join(', ');
  }

  function buildIRTableFields(params: {
    title: string;
    sourceFile: string;
    deckName?: string;
    deckIds?: string[];
    state?: string;
    priority?: number;
    tags?: string[];
    favorite?: boolean;
    nextReview?: string | null;
    reviewCount?: number;
    readingTime?: number;
    notes?: string;
    extractedCards?: number;
    created?: string;
  }) {
    return {
      ir_title: params.title,
      ir_source_file: params.sourceFile,
      ir_deck: params.deckName || '未分配',
      ir_deck_ids: params.deckIds || [],
      ir_state: params.state,
      ir_priority: params.priority,
      ir_tags: params.tags || [],
      ir_favorite: params.favorite || false,
      ir_next_review: params.nextReview || null,
      ir_review_count: params.reviewCount || 0,
      ir_reading_time: params.readingTime || 0,
      ir_notes: params.notes || '',
      ir_extracted_cards: params.extractedCards || 0,
      ir_created: params.created
    };
  }

  function buildIRSessionTotalsByBlockId(sessions: Array<{ blockId?: string; duration?: number }> | undefined | null): Map<string, number> {
    const totals = new Map<string, number>();
    for (const session of sessions || []) {
      const blockId = String(session?.blockId || '');
      const duration = Number(session?.duration || 0);
      if (!blockId || duration <= 0) continue;
      totals.set(blockId, (totals.get(blockId) || 0) + duration);
    }
    return totals;
  }

  function getIRReadingSeconds(
    id: string,
    readingSecondsById: Map<string, number>,
    fallback: number | null | undefined
  ): number {
    if (readingSecondsById.has(id)) {
      return readingSecondsById.get(id) || 0;
    }
    return Math.max(0, Number(fallback || 0));
  }

  function buildIRCardBase(params: {
    id: string;
    deckId?: string;
    templateId: string;
    type: string;
    content: string;
    front: string;
    back: string;
    sourceFile: string;
    sourcePosition?: { startLine: number; endLine: number; contentHash: string };
    created: string;
    modified: string;
    totalReviews?: number;
    totalTime?: number;
    averageTime?: number;
    fsrsState: number;
    stability?: number;
    due?: string;
    lastReview?: string;
    reps?: number;
    scheduledDays?: number;
    tags?: string[];
    priority?: number;
    suspended?: boolean;
    metadata?: Record<string, any>;
  }): Card & Record<string, any> {
    return {
      id: params.id,
      uuid: params.id,
      deckId: params.deckId || '',
      templateId: params.templateId as any,
      type: params.type as any,
      content: params.content,
      fields: {
        front: params.front,
        back: params.back
      },
      sourceFile: params.sourceFile,
      sourcePosition: params.sourcePosition || {
        startLine: 0,
        endLine: 0,
        contentHash: ''
      },
      created: params.created,
      modified: params.modified,
      stats: {
        totalReviews: params.totalReviews || 0,
        totalTime: params.totalTime || 0,
        averageTime: params.averageTime || 0
      },
      fsrs: {
        state: params.fsrsState as any,
        difficulty: 0.3,
        stability: params.stability || 0,
        due: params.due || new Date().toISOString(),
        lastReview: params.lastReview || undefined,
        reps: params.reps || 0,
        lapses: 0,
        elapsedDays: 0,
        scheduledDays: params.scheduledDays || 0,
        retrievability: 1
      },
      tags: params.tags || [],
      priority: params.priority || 2,
      suspended: params.suspended || false,
      metadata: params.metadata || {}
    };
  }

  // 将 Card 转换为表格显示格式
  // 添加缓存优化（使用computed状态）
  // 性能优化：添加内容缓存
  const contentCache = new Map<string, { front: string; back: string }>();
  
  // 🚀 性能优化：跟踪导航状态，避免缓存清理
  let isNavigatingToSource = $state(false);
  let navigationTimeout: number | null = null;
  let refreshInterval: number | null = null;  // 🔧 添加 refreshInterval 定义
  
  // 🚀 性能优化：添加转换结果缓存
  let lastFilteredCardsKey: string = '';
  let cachedTransformedCards: any[] = [];
  
  // 生成卡片数组的缓存键（基于内容而非引用）
  function generateCacheKey(cards: Card[]): string {
    if (!cards || cards.length === 0) return 'empty';
    // 🔧 修复：包含标签、优先级、收藏状态信息，确保这些属性变化时缓存失效
    // 使用前10张卡片的UUID + 标签 + 优先级 + 收藏 + 总数量 + 修改时间
    const first10 = cards.slice(0, 10).map(c => 
      `${c.uuid}:${(c.tags || []).join('|')}:${c.priority || 0}:${c.metadata?.favorite || false}`
    ).join(',');
    const count = cards.length;
    const firstMod = cards[0]?.modified || '';
    const lastMod = cards[cards.length - 1]?.modified || '';
    // 🔧 修复：添加所有卡片的属性哈希，确保任何变化都能检测到
    // 🔧 修复：使用 [...] 复制数组后再排序，避免 state_unsafe_mutation 错误
    const propsHash = cards.map(c => 
      `${[...(c.tags || [])].sort().join('|')}:${c.priority || 0}:${c.metadata?.favorite || false}:${c.ir_priority || 0}:${c.ir_favorite || false}`
    ).join(';');
    return `${count}:${first10}:${firstMod}:${lastMod}:${propsHash.length}`;
  }
  
  // 🚀 性能优化：延迟计算标志
  let isTableDataReady = $state(false);
  let tableDataTimer: number | null = null;
  let lastViewSwitch = 0;  // 记录上次视图切换时间
  
  // 监听视图切换，延迟初始化表格数据
  $effect(() => {
    if (currentView === 'table') {
      const now = Date.now();
      // 如果距离上次切换不到500ms，说明是标签切换导致的，使用更长的延迟
      const delay = (now - lastViewSwitch < 500) ? 300 : 100;
      lastViewSwitch = now;
      
      // 切换到表格视图时，延迟后才开始转换数据
      if (tableDataTimer) clearTimeout(tableDataTimer);
      tableDataTimer = window.setTimeout(() => {
        isTableDataReady = true;
        tableDataTimer = null;
      }, delay);
    } else {
      // 切换到其他视图时，保持表格数据状态但不重新计算
      lastViewSwitch = Date.now();
      if (tableDataTimer) {
        clearTimeout(tableDataTimer);
        tableDataTimer = null;
      }
      // 不立即设置 isTableDataReady = false，保留缓存
    }
  });
  
  // 🚀 性能优化：使用 $derived 缓存转换结果，避免每次渲染时重新计算
  let transformedCards = $derived.by(() => {
    // 🔧 添加dataVersion依赖，确保数据更新时触发重新计算
    void dataVersion;
    
    // 🔧 性能优化：如果不在表格视图或组件未挂载或视图不可见，直接返回空数组
    if (!isMounted || !isViewVisible || currentView !== 'table') {
      return [];
    }
    
    // 只在表格视图可见且数据准备好时才进行转换
    if (!isTableDataReady) {
      return cachedTransformedCards.length > 0 ? cachedTransformedCards : [];
    }
    
    // 生成当前数组的缓存键（包含dataVersion以确保缓存失效）
    const currentKey = generateCacheKey(filteredCards) + `-v${dataVersion}`;
    
    // 检查内容是否真的变化了（基于内容的缓存键比较）
    if (currentKey === lastFilteredCardsKey && cachedTransformedCards.length > 0) {
      return cachedTransformedCards; // 直接返回缓存
    }
    
    const startTime = performance.now();
    const result = transformCardsForTable(filteredCards);
    const elapsed = performance.now() - startTime;
    
    // 🔍 性能监控：记录所有转换
    logger.debug(`[性能优化] 卡片转换耗时: ${elapsed.toFixed(2)}ms, 卡片数量: ${filteredCards.length}, 每页: ${itemsPerPage}`);
    
    // 更新缓存
    lastFilteredCardsKey = currentKey;
    cachedTransformedCards = result;
    
    return result;
  });
  
  function transformCardsForTable(cards: Card[]): any[] {
    return cards.map(card => {
      // 安全获取修改时间
      const modifiedTime = createSafeDate(card.modified || card.created);
      
      // 安全获取FSRS数据
      const nextReview = card.fsrs?.due ? createSafeDate(card.fsrs.due) : null;
      const retention = card.fsrs?.retrievability ?? 0;
      const interval = card.fsrs?.scheduledDays ?? 0;
      // 将difficulty从number转换为字符串类型
      const difficultyNum = card.fsrs?.difficulty ?? 5;
      const difficulty: "easy" | "medium" | "hard" | undefined = 
        difficultyNum < 4 ? "easy" : difficultyNum < 7 ? "medium" : "hard";
      const reviewCount = card.reviewHistory?.length ?? 0;
      
      // 🆕 获取题库统计数据
      const testStats = questionBankStats.get(card.uuid);
      
      // 🚀 性能优化：使用缓存避免重复解析
      const cacheKey = `${card.uuid}_${card.modified || ''}`;
      
      let content = contentCache.get(cacheKey);
      
      if (!content) {
        // 🚀 性能优化：只在表格视图真正需要时才计算内容
        // 延迟计算：使用占位符，真正显示时才计算
        if (currentView !== 'table') {
          content = { front: '', back: '' };
        } else {
          // 🔧 修复：从 content 解析正反面（使用 ---div--- 分割符）
          let front = '';
          let back = '';
          
          if (card.content && card.content.trim()) {
            // 1. 先剥离 YAML frontmatter
            const bodyContent = extractBodyContent(card.content).trim();
            
            // 2. 使用 ---div--- 分割正反面
            const dividerIndex = bodyContent.indexOf(MAIN_SEPARATOR);
            
            if (dividerIndex >= 0) {
              front = bodyContent.substring(0, dividerIndex).trim();
              back = bodyContent.substring(dividerIndex + MAIN_SEPARATOR.length).trim();
            } else {
              // 无分割符：整个内容作为正面
              front = bodyContent;
            }
          } else {
            // 回退到 fields（兼容 Anki 同步格式）
            front = card.fields?.front || card.fields?.question || '';
            back = card.fields?.back || card.fields?.answer || '';
          }
          
          content = { front, back };
        }
        contentCache.set(cacheKey, content);
        
        // 限制缓存大小，防止内存泄漏
        if (contentCache.size > 1000) { // 增加缓存大小
          // 批量删除旧缓存
          const keysToDelete = [];
          let count = 0;
          for (const key of contentCache.keys()) {
            keysToDelete.push(key);
            if (++count >= 100) break; // 批量删除100个
          }
          keysToDelete.forEach(key => contentCache.delete(key));
        }
      }
      
      return {
        ...card,
        // 🔧 修复：确保tags是新数组引用，触发TagsCell响应式更新
        tags: card.tags ? [...card.tags] : [],
        front: content.front,
        back: content.back,
        status: getCardStatusString(card.fsrs?.state ?? 0),
        deck: getCardDeckNames(card), // 🆕 v2.0: 支持多牌组引用显示
        nextReview: card.fsrs?.due,
        sourceDocumentStatus: getSourceDocumentStatus(card),
        // 🔧 修复：添加块引用字段映射
        obsidian_block_link: card.sourceBlock || '-',
        source_document: card.sourceFile || '-',
        // 添加复习历史相关数据（保持字符串类型以兼容Card接口）
        modified: modifiedTime ? modifiedTime.toISOString() : new Date().toISOString(),
        next_review: nextReview,
        retention: retention,
        interval: interval,
        difficulty: difficulty,
        review_count: reviewCount,
        // 🆕 添加题库专用数据
        question_type: getQuestionTypeLabelFromCard(card, 'emoji', '❓ 未知'),
        accuracy: formatAccuracy(card),
        accuracy_class: getAccuracyColorClass(card),
        test_attempts: testStats?.totalAttempts ?? 0,
        last_test: testStats?.lastTestDate ? formatRelativeTime(testStats.lastTestDate) : '-',
        error_level: formatErrorLevel(card),
      };
    });
  }

  // 获取卡片状态字符串
  function getCardStatusString(state: number): string {
    switch (state) {
      case 0: return "new";
      case 1: return "learning";
      case 2: return "review";
      case 3: return "relearning";
      default: return "unknown";
    }
  }

  // 获取源文档状态
  // ✅ 遵循卡片数据结构规范 v1.0：使用专用字段 card.sourceFile
  // 🔧 v2.1.1: 使用 metadataCache 支持仅文件名格式
  function getSourceDocumentStatus(card: Card): string {
    const contextPath = plugin.app.workspace.getActiveFile()?.path ?? '';
    // 优先使用专用字段 card.sourceFile
    if (card.sourceFile) {
      const linkText = card.sourceFile.replace(/\.md$/, '');
      const file = plugin.app.metadataCache.getFirstLinkpathDest(linkText, contextPath);
      if (file) {
        return "存在";
      } else {
        return "已删除";
      }
    }
    
    // 向后兼容：检查旧的customFields字段
    if (card.customFields?.obsidianFilePath) {
      const filePath = card.customFields.obsidianFilePath as string;
      if (filePath && typeof filePath === 'string') {
        const linkText = filePath.replace(/\.md$/, '');
        const file = plugin.app.metadataCache.getFirstLinkpathDest(linkText, contextPath);
        if (file) return "存在";
      }
      return "已删除";
    }

    // 没有源文档信息的卡片（如导入的卡片）
    return "无源文档";
  }
  
  // 获取源文档显示文本（用于表格显示）
  function getSourceDocumentText(card: Card): string {
    // 优先使用专用字段
    if (card.sourceFile) {
      // 提取文件名（不含路径）
      const fileName = card.sourceFile.split('/').pop() || card.sourceFile;
      return fileName;
    }
    
    // 向后兼容：使用customFields
    if (card.customFields?.obsidianFilePath) {
      const filePath = card.customFields.obsidianFilePath as string;
      const fileName = filePath.split('/').pop() || filePath;
      return fileName;
    }
    
    return '';
  }
  
  // 点击源文档跳转到文件并高亮显示
  // 🔧 v2.1.3: 使用 parseSourceInfo 从 card.content 解析源文件信息，与卡片详情模态窗保持一致
  async function jumpToSourceDocument(card: Card) {
    try {
      // 🚀 设置导航状态，防止缓存被清理
      isNavigatingToSource = true;
      
      // 清理之前的导航超时
      if (navigationTimeout !== null) {
        clearTimeout(navigationTimeout);
      }
      
      // 设置导航超时，3秒后重置状态
      navigationTimeout = window.setTimeout(() => {
        isNavigatingToSource = false;
        navigationTimeout = null;
      }, 3000);

      const contextPath = plugin.app.workspace.getActiveFile()?.path ?? '';
      
      let filePath: string | undefined;
      let blockId: string | undefined;

      if (card.content) {
        const yaml = parseYAMLFromContent(card.content);
        const sourceValue = Array.isArray((yaml as any).we_source) ? (yaml as any).we_source[0] : (yaml as any).we_source;
        if (typeof sourceValue === 'string') {
          const start = sourceValue.indexOf('[[');
          const end = sourceValue.lastIndexOf(']]');
          if (start !== -1 && end !== -1 && end > start + 2) {
            let linkText = sourceValue.slice(start + 2, end).trim();
            const aliasIndex = linkText.indexOf('|');
            if (aliasIndex !== -1) {
              linkText = linkText.slice(0, aliasIndex).trim();
            }
            const pathOnly = linkText.split('#')[0].replace(/\.md$/, '');
            if (pathOnly) {
              const file = plugin.app.metadataCache.getFirstLinkpathDest(pathOnly, contextPath);
              if (file) {
                // EPUB文件：拦截到插件内置阅读器，避免系统外部阅读器打开
                if (pathOnly.toLowerCase().endsWith('.epub')) {
                  const hashPart = linkText.includes('#') ? linkText.slice(linkText.indexOf('#')) : '';
                  const { EpubLinkService } = await import('../../services/epub/EpubLinkService');
                  const parsed = EpubLinkService.parseEpubLink(hashPart);
                  const linkService = new EpubLinkService(plugin.app);
                  await linkService.navigateToEpubLocation(file.path, parsed?.cfi || '', parsed?.text || '');
                  new Notice(parsed?.cfi ? '已跳转到EPUB源位置' : '已打开EPUB源文档');
                  return;
                }

                // Canvas 文件需要走后面的专用定位分支
                if (!pathOnly.toLowerCase().endsWith('.canvas')) {
                  await plugin.app.workspace.openLinkText(linkText, contextPath, false);
                  if (linkText.includes('#^')) {
                    new Notice('已跳转到源文档块');
                  } else {
                    new Notice('已打开源文档');
                  }
                  return;
                }
              }
            }
          }
        }
      }
      
      // 🔧 v2.1.3: 优先从 card.content YAML 解析源文件信息（与卡片详情模态窗保持一致）
      if (card.content) {
        const sourceInfo = parseSourceInfo(card.content);
        if (sourceInfo.sourceFile) {
          filePath = sourceInfo.sourceFile;
          blockId = sourceInfo.sourceBlock?.replace(/^\^/, ''); // 移除^前缀
        }
      }
      
      // 向后兼容：如果 content 解析失败，使用派生字段
      if (!filePath && card.sourceFile) {
        filePath = card.sourceFile;
        blockId = card.sourceBlock?.replace(/^\^/, '');
      }
      
      // 向后兼容：customFields
      if (!filePath && card.customFields?.obsidianFilePath) {
        filePath = card.customFields.obsidianFilePath as string;
        blockId = card.customFields.blockId as string;
      }
      
      if (!filePath) {
        new Notice('此卡片没有关联的源文档');
        return;
      }
      
      // EPUB文件：使用插件内置EPUB阅读器打开
      if (filePath.toLowerCase().endsWith('.epub')) {
        let epubCfi = '';
        let epubText = '';
        // 从卡片内容中提取CFI和文本（用于精确定位）
        if (card.content) {
          const epubLinkMatch = card.content.match(/obsidian:\/\/weave-epub\?[^)\s]*/);
          if (epubLinkMatch) {
            try {
              const url = new URL(epubLinkMatch[0]);
              epubCfi = url.searchParams.get('cfi') || '';
              epubText = url.searchParams.get('text') || '';
            } catch {
              const cfiMatch = epubLinkMatch[0].match(/[?&]cfi=([^&]*)/);
              const textMatch = epubLinkMatch[0].match(/[?&]text=([^&]*)/);
              if (cfiMatch) {
                try { epubCfi = decodeURIComponent(cfiMatch[1]); } catch { epubCfi = cfiMatch[1]; }
              }
              if (textMatch) {
                try { epubText = decodeURIComponent(textMatch[1]); } catch { epubText = textMatch[1]; }
              }
            }
          }
        }
        const { EpubLinkService } = await import('../../services/epub/EpubLinkService');
        const linkService = new EpubLinkService(plugin.app);
        await linkService.navigateToEpubLocation(filePath, epubCfi, epubText);
        new Notice(epubCfi ? '已跳转到EPUB源位置' : '已打开EPUB源文档');
        return;
      }

      // Canvas 文件：使用专门的节点定位服务，而不是仅打开文件
      if (filePath.toLowerCase().endsWith('.canvas')) {
        const normalizedBlockId = blockId?.replace(/^canvas:/, '').replace(/^\^/, '').split('?')[0];
        const sourceNavigationService = new SourceNavigationService(plugin.app);
        const targetRect = getCanvasSourceNodeRect(card);
        const textCandidates = getCanvasTextCandidates(card);

        const openedLeaf = await sourceNavigationService.openCanvasAndLocate(
          filePath,
          textCandidates,
          normalizedBlockId,
          {
            label: '定位到溯源位置',
            icon: 'map-pinned',
            focus: true,
            openInNewTab: true,
            delayMs: 500,
            nodeRect: targetRect ?? undefined
          }
        );

        if (!openedLeaf) {
          new Notice('源 Canvas 不存在');
          return;
        }

        new Notice(normalizedBlockId || textCandidates.length > 0 || targetRect
          ? '已定位到 Canvas 溯源节点'
          : '已打开源 Canvas');
        return;
      }
      
      // Markdown文件：使用Obsidian原生跳转
      const docName = filePath.replace(/\.md$/, '');
      const linktext = blockId ? `${docName}#^${blockId}` : docName;
      await plugin.app.workspace.openLinkText(linktext, contextPath, false);
      
      if (blockId) {
        new Notice('已跳转到源文档块');
      } else {
        new Notice('已打开源文档');
      }
    } catch (error) {
      logger.error('跳转到源文档失败:', error);
      new Notice('跳转失败');
    } finally {
      // 确保导航状态被重置
      isNavigatingToSource = false;
    }
  }

  function getCanvasSourceNodeRect(card: Card): { x: number; y: number; width?: number; height?: number } | null {
    const content = card?.content;
    if (!content) return null;

    const yaml = parseYAMLFromContent(content);
    const weSource = Array.isArray(yaml.we_source) ? yaml.we_source[0] : yaml.we_source;
    if (typeof weSource !== 'string') return null;

    const queryIndex = weSource.indexOf('?');
    if (queryIndex === -1) return null;

    const queryEnd = weSource.lastIndexOf(']]');
    const query = weSource.slice(queryIndex + 1, queryEnd > queryIndex ? queryEnd : undefined);
    const params = new URLSearchParams(query);
    const x = Number(params.get('x'));
    const y = Number(params.get('y'));
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

    const width = Number(params.get('w'));
    const height = Number(params.get('h'));

    return {
      x,
      y,
      width: Number.isFinite(width) ? width : undefined,
      height: Number.isFinite(height) ? height : undefined
    };
  }

  function getCanvasTextCandidates(card: Card): string[] {
    const body = extractBodyContent(card?.content || '');
    if (!body) return [];

    const lines = body
      .split(/\r?\n/)
      .map((line) => line.replace(/^>\s?/, '').trim())
      .filter((line) => line.length >= 12);

    const uniqueCandidates = new Set<string>();
    for (const line of lines) {
      const normalized = line.replace(/\s+/g, ' ').trim();
      if (normalized.length >= 12) {
        uniqueCandidates.add(normalized.slice(0, 120));
      }
      if (uniqueCandidates.size >= 3) break;
    }

    return Array.from(uniqueCandidates);
  }

  // 🆕 清除所有全局筛选
  function clearGlobalFilters() {
    plugin.filterStateService?.clearAll();
    // 🆕 清除自定义卡片ID筛选
    customCardIdsFilter = null;
    customFilterName = '';
    new Notice('已清除所有筛选');
  }

  // 批量更新源文档状态
  async function updateSourceDocumentStatus() {
    try {
      const updatedCards = await Promise.all(
        cards.map(async (card: Card) => {
          const status = getSourceDocumentStatus(card);
          const exists = status === "存在";

          // 更新卡片的 sourceDocumentExists 属性
          const updatedCard = {
            ...card,
            sourceDocumentExists: exists
          };

          // 保存到数据库
          await plugin.dataStorage.saveCard(updatedCard);
          return updatedCard;
        })
      );

      // 重新加载卡片数据
      await loadCards();
      
      // 🗑️ 已移除旧的 CustomEvent 触发（Weave:refresh-decks）
      // 现在通过 DataSyncService 在 saveCard 时自动通知

      new Notice(`已更新 ${updatedCards.length} 张卡片的源文档状态`);
    } catch (error) {
      logger.error('更新源文档状态失败:', error);
      new Notice('更新源文档状态失败');
    }
  }
  // 孤儿卡片扫描（只在表格工具栏点击时触发）
  async function handleScanOrphanCards() {
    const files = plugin.app.vault.getMarkdownFiles();

    function findFileByName(name: string) {
      return files.find((f: any) => f.basename === name || f.name === name || f.name === `${name}.md`);
    }

    async function checkCard(card: Card): Promise<'存在' | '缺失' | '无源文档'> {
      try {
        const fields = (card as any).fields || {};
        const link: string | undefined = fields.obsidian_block_link;
        let filePath: string | undefined;
        let blockId: string | undefined;

        if (typeof link === 'string' && link.includes('#^')) {
          const m = link.match(/\[\[([^#\]]+)#\^([^\]]+)\]\]/);
          if (m) {
            const fileName = m[1];
            blockId = m[2];
            const f = findFileByName(fileName);
            filePath = f?.path;
          }
        } else if (typeof link === 'string' && link.startsWith('^')) {
          blockId = link.replace(/^\^/, '');
          const fileName = typeof fields.source_document === 'string' ? fields.source_document : undefined;
          if (fileName) filePath = findFileByName(fileName)?.path;
          if (!filePath && typeof fields.source_file === 'string') filePath = fields.source_file;
        }

        if (!filePath) return '无源文档';
        if (!blockId) return '缺失';

        const f = plugin.app.vault.getAbstractFileByPath(filePath);
        if (!f) return '缺失';
        const content = await plugin.app.vault.read(f as any);
        const re = new RegExp(`\\^${blockId}(?![A-Za-z0-9_-])`);
        return re.test(content) ? '存在' : '缺失';
      } catch (e) {
        logger.warn('[Scan] 检查卡片失败', e);
        return '缺失';
      }
    }

    let exist = 0, missing = 0, none = 0;
    for (let i = 0; i < cards.length; i++) {
      const status = await checkCard(cards[i]);
      (cards[i] as any).sourceDocumentStatus = status;
      if (status === '存在') exist++; else if (status === '缺失') missing++; else none++;
    }

    // 触发渲染
    cards = [...cards];

    try {
      new Notice(`扫描完成：存在 ${exist}，缺失 ${missing}，无源文档 ${none}`);
    } catch {
      logger.debug(`扫描完成：存在 ${exist}，缺失 ${missing}，无源文档 ${none}`);
    }
  }


  // 搜索功能
  function handleSearch(query: string) {
    searchQuery = query;
    // 解析搜索查询
    parsedSearchQuery = parseSearchQuery(query);
    currentPage = 1;
  }
  
  // 清除搜索
  function handleClearSearch() {
    searchQuery = "";
    parsedSearchQuery = null;
    currentPage = 1;
  }
  
  // 🆕 导航回调函数（用于 SidebarNavHeader）
  function handleNavigate(pageId: string) {
    // 触发页面切换事件
    window.dispatchEvent(new CustomEvent('Weave:navigate', { 
      detail: pageId 
    }));
  }
  
  function emitToolbarState() {
    window.dispatchEvent(new CustomEvent('Weave:card-management-toolbar-state', {
      detail: {
        tableViewMode,
        gridLayout,
        kanbanLayoutMode,
        irTypeFilter,
        searchQuery,
        documentFilterMode,
        currentActiveDocument,
        enableCardLocationJump,
        dataSource,
        availableDecks: searchAvailableDecks,
        availableTags: searchAvailableTags,
        availablePriorities: searchAvailablePriorities,
        availableQuestionTypes: searchAvailableQuestionTypes,
        availableSources: searchAvailableSources,
        availableStatuses: searchAvailableStatuses,
        availableStates: searchAvailableIRStates,
        availableAccuracies: searchAvailableAccuracies,
        availableAttemptThresholds: searchAvailableAttemptThresholds,
        availableErrorLevels: searchAvailableErrorLevels,
        availableYamlKeys: searchAvailableYamlKeys,
        matchCount: searchQuery ? totalFilteredItems : -1,
        totalCount: searchSourceCards.length,
        sortField: sortConfig.field,
        sortDirection: sortConfig.direction
      }
    }));
  }

  $effect(() => {
    if (!isMounted) return;
    emitToolbarState();
  });

  // 筛选功能
  function handleFilterChange(data: { type: string; value: string; checked: boolean }) {
    const { type, value, checked } = data;

    // 🔧 支持所有筛选类型
    if (type === 'status' || type === 'decks' || type === 'tags' || type === 'questionTypes' || type === 'errorBooks') {
      if (checked) {
        filters[type].add(value);
      } else {
        filters[type].delete(value);
      }
      filters = { ...filters }; // 触发响应式更新
      currentPage = 1;
    }
  }

  function handleClearFilters() {
    filters.status = new Set();
    filters.decks = new Set();
    filters.tags = new Set();
    filters.questionTypes = new Set();
    filters.errorBooks = new Set();
  }

  function handleDeleteSavedFilter(filterId: string) {
    if (!filterManager) return;
    
    filterManager.deleteFilter(filterId);
    savedFilters = filterManager.getAllFilters();
    showNotification('筛选器已删除', 'success');
  }

  function handleUpdateSavedFilter(filter: SavedFilter) {
    if (!filterManager) return;
    
    filterManager.updateFilter(filter.id, filter);
    savedFilters = filterManager.getAllFilters();
    showNotification('筛选器已更新', 'success');
  }
  
  /**
   * 清理空父文件夹
   * @param filePath 已删除文件的路径
   */
  async function cleanEmptyParentFolders(filePath: string): Promise<void> {
    // 获取父文件夹路径
    const parentPath = filePath.substring(0, filePath.lastIndexOf('/'));
    if (!parentPath || parentPath === 'incremental-reading/files/chunks') {
      return; // 不删除根目录
    }
    
    // 尝试删除当前文件夹
    const deleted = await cleanEmptyFolder(parentPath);
    
    // 如果成功删除，继续检查上级文件夹
    if (deleted) {
      const grandParentPath = parentPath.substring(0, parentPath.lastIndexOf('/'));
      if (grandParentPath && grandParentPath.includes('chunks')) {
        await cleanEmptyFolder(grandParentPath);
      }
    }
  }
  
  /**
   * 检查并删除空文件夹
   * @param folderPath 文件夹路径
   * @returns 是否成功删除
   */
  async function cleanEmptyFolder(folderPath: string): Promise<boolean> {
    try {
      const folder = plugin.app.vault.getAbstractFileByPath(folderPath);
      if (!folder || !(folder instanceof TFolder)) {
        return false;
      }
      
      // 检查文件夹是否为空
      if (folder.children.length === 0) {
        await plugin.app.fileManager.trashFile(folder);
        logger.info(`[卡片管理] 删除空文件夹: ${folderPath}`);
        return true;
      }
      return false;
    } catch (error) {
      logger.warn(`[卡片管理] 删除空文件夹失败: ${folderPath}`, error);
      return false;
    }
  }

  // 排序功能
  function handleSort(field: string) {
    // 🔒 第一层保护：同步标志位立即阻止
    if (sortingLock) {
      // 排序锁定中
      return;
    }

    // 🔒 第二层保护：响应式状态检查
    if (isSorting) {
      // 排序进行中
      return;
    }

    // 🧹 清除之前的定时器（如果存在）
    if (sortLockReleaseTimer !== null) {
      clearTimeout(sortLockReleaseTimer);
      sortLockReleaseTimer = null;
    }

    // 🔐 立即启用同步锁
    sortingLock = true;

    // 🎬 启用加载状态（UI更新）
    isSorting = true;
    
    // ⏱️ 记录排序开始时间
    sortStartTime = Date.now();
    
    // 🎯 生成新的排序请求ID
    sortRequestId++;

    // 排序开始

    // 更新排序配置
    if (sortConfig.field === field) {
      sortConfig.direction = sortConfig.direction === "asc" ? "desc" : "asc";
    } else {
      sortConfig.field = field;
      sortConfig.direction = "desc";
    }
    
    // 注意：锁的释放现在在 $effect 中排序完成后执行
  }
  
  // 🆕 显示排序菜单
  function handleShowSortMenu(e: MouseEvent) {
    const menu = new Menu();
    
    const sortFields = [
      { field: 'created', label: '创建时间', icon: ICON_NAMES.CLOCK },
      { field: 'modified', label: '修改时间', icon: ICON_NAMES.CLOCK },
      { field: 'front', label: '正面内容', icon: ICON_NAMES.FILE_TEXT },
      { field: 'back', label: '背面内容', icon: ICON_NAMES.FILE_TEXT },
      { field: 'deck', label: '牌组', icon: ICON_NAMES.FOLDER },
      { field: 'tags', label: '标签', icon: ICON_NAMES.TAG },
      { field: 'status', label: '状态', icon: ICON_NAMES.CHECK_CIRCLE },
    ];
    
    sortFields.forEach(({ field, label, icon }) => {
      menu.addItem((item) => {
        item.setTitle(label);
        item.setIcon(icon);
        
        // 显示当前排序状态
        if (sortConfig.field === field) {
          item.setChecked(true);
          if (sortConfig.direction === 'asc') {
            item.setTitle(`${label} ↑`);
          } else {
            item.setTitle(`${label} ↓`);
          }
        }
        
        item.onClick(() => {
          handleSort(field);
        });
      });
    });
    
    const target = e.target as HTMLElement;
    const rect = target.getBoundingClientRect();
    menu.showAtPosition({ x: rect.left, y: rect.bottom + 4 });
  }


  // 选择功能
  function handleCardSelect(cardUuid: string, selected: boolean) {
    const newSelectedCards = new Set(selectedCards);
    if (selected) {
      newSelectedCards.add(cardUuid);
    } else {
      newSelectedCards.delete(cardUuid);
    }
    selectedCards = newSelectedCards; // 创建新的 Set 实例
  }

  function handleSelectAll(selected: boolean) {
    if (selected) {
      // 创建 filteredCards 的稳定副本，避免在状态变化过程中访问
      const currentFilteredCards = [...filteredCards];
      const visibleCardUuids = currentFilteredCards.map(card => card.uuid);
      selectedCards = new Set(visibleCardUuids);
    } else {
      selectedCards = new Set();
    }
  }

  function handleClearSelection() {
    selectedCards = new Set();
  }

  // 分页事件处理
  function handlePageChange(page: number) {
    currentPage = page;
    // 响应式系统会自动更新 filteredCards
  }

  function handleItemsPerPageChange(size: number) {
    itemsPerPage = size;
    currentPage = 1;
    // 响应式系统会自动更新 filteredCards，无需防抖
  }


  // 批量操作事件处理 - 使用 Obsidian Menu API
  let lastBatchDeckMenuPosition: { x: number; y: number } | null = null;

  function handleBatchChangeDeck(event?: MouseEvent) {
    const selectedCardIds = Array.from(selectedCards);
    logger.debug("更换牌组:", selectedCardIds);
    const memoryDecks = getDecksForDataSource('memory');

    if (selectedCardIds.length === 0) {
      new Notice("请先选择要更换牌组的卡片");
      return;
    }

    if (event) {
      const rect = (event.target as HTMLElement).getBoundingClientRect();
      lastBatchDeckMenuPosition = { x: rect.left, y: rect.top - 8 };
    } else {
      lastBatchDeckMenuPosition = { x: window.innerWidth / 2, y: window.innerHeight - 100 };
    }

    // 使用分组菜单：记忆牌组 / 考试牌组
    const menu = new Menu();
    (menu as any).app = plugin.app;

    // 记忆牌组子菜单
    menu.addItem((item) => {
      item.setTitle('记忆牌组').setIcon('graduation-cap');
      const submenu = (item as any).setSubmenu();

      const selectedSet = new Set(selectedCardIds);
      memoryDecks.forEach((deck) => {
        const deckCardUUIDs = new Set(deck.cardUUIDs || []);
        let anyInDeck = false;
        let allInDeck = true;
        for (const uuid of selectedSet) {
          if (deckCardUUIDs.has(uuid)) { anyInDeck = true; } else { allInDeck = false; }
        }
        const indentLevel = deck.level || 0;
        const prefix = indentLevel > 0 ? '  '.repeat(indentLevel) + '└ ' : '';

        submenu.addItem((subItem: any) => {
          subItem.setTitle(prefix + deck.name);
          if (allInDeck) { subItem.setIcon('check-square'); }
          else { subItem.setIcon(anyInDeck ? 'minus-square' : 'square'); }
          subItem.onClick(async () => {
            await handleBatchToggleDeckReference(deck, { allInDeck }, selectedCardIds);
          });
        });
      });
    });

    if (premiumGuard.shouldShowFeatureEntry(PREMIUM_FEATURES.QUESTION_BANK)) {
      menu.addItem((item) => {
        const questionBankLocked = premiumGuard.isFeatureRestricted(PREMIUM_FEATURES.QUESTION_BANK);
        item
          .setTitle(questionBankLocked ? '考试牌组 (高级)' : '考试牌组')
          .setIcon('clipboard-list');
        const submenu = (item as any).setSubmenu();

        if (questionBankLocked) {
          submenu.addItem((subItem: any) => {
            subItem
              .setTitle('激活后使用')
              .setIcon('lock')
              .onClick(() => {
                promptPremiumFeature(PREMIUM_FEATURES.QUESTION_BANK);
              });
          });
          return;
        }

        if (questionBankStorage && plugin.questionBankService) {
          const banks = plugin.questionBankService.getAllQuestionBanks();
          if (banks.length > 0) {
            banks.forEach((bank) => {
              submenu.addItem((subItem: any) => {
                subItem.setTitle(bank.name).setIcon('edit-3');
                subItem.onClick(async () => {
                  await handleBatchAddToExamDeck(bank.id, selectedCardIds);
                });
              });
            });
          } else {
            submenu.addItem((subItem: any) => {
              subItem.setTitle('暂无考试牌组').setDisabled(true);
            });
          }
        } else {
          submenu.addItem((subItem: any) => {
            subItem.setTitle('考试牌组服务未初始化').setDisabled(true);
          });
        }
      });
    }

    menu.showAtPosition(lastBatchDeckMenuPosition!);
  }

  // 批量将选择题卡片添加到考试牌组
  async function handleBatchAddToExamDeck(bankId: string, selectedCardIds: string[]) {
    try {
      if (premiumGuard.isFeatureRestricted(PREMIUM_FEATURES.QUESTION_BANK)) {
        promptPremiumFeature(PREMIUM_FEATURES.QUESTION_BANK);
        return;
      }

      if (!plugin.questionBankService) {
        showNotification('考试牌组服务未初始化', 'error');
        return;
      }

      // 从选中的卡片中筛选出选择题类型
      const sourceCards = currentSourceCards;
      const selectedCardData = sourceCards.filter(c => selectedCardIds.includes(c.uuid));
      const choiceCards = selectedCardData.filter(c => {
        const questionType = detectCardQuestionType(c);
        return questionType === 'single-choice' || questionType === 'multiple-choice';
      });

      if (choiceCards.length === 0) {
        showNotification('选中的卡片中没有选择题类型的卡片', 'warning');
        return;
      }

      // 获取考试牌组信息
      const bank = plugin.questionBankService.getQuestionBank(bankId);
      if (!bank) {
        showNotification('考试牌组不存在', 'error');
        return;
      }

      // 将选择题卡片的 UUID 引用添加到考试牌组
      const existingUUIDs = new Set(bank.cardUUIDs || []);
      let addedCount = 0;
      for (const card of choiceCards) {
        if (!existingUUIDs.has(card.uuid)) {
          existingUUIDs.add(card.uuid);
          addedCount++;
        }
      }

      if (addedCount === 0) {
        showNotification('选中的选择题卡片已在该考试牌组中', 'info');
        return;
      }

      bank.cardUUIDs = Array.from(existingUUIDs);
      bank.modified = new Date().toISOString();
      await questionBankStorage!.saveBanks(plugin.questionBankService.getAllQuestionBanks());

      showNotification(`已将 ${addedCount} 张选择题添加到考试牌组"${bank.name}"`, 'success');
    } catch (error) {
      logger.error('添加到考试牌组失败:', error);
      showNotification('操作失败', 'error');
    }
  }

  function showBatchDeckMultiSelectMenu(selectedCardIds: string[]) {
    if (!lastBatchDeckMenuPosition) {
      lastBatchDeckMenuPosition = { x: window.innerWidth / 2, y: window.innerHeight - 100 };
    }

    const menu = new Menu();
    (menu as any).app = plugin.app;

    menu.addItem((item) => {
      item.setTitle(`设置 ${selectedCardIds.length} 张卡片所属牌组`);
      item.setDisabled(true);
    });

    menu.addSeparator();

    const selectedSet = new Set(selectedCardIds);

    const memoryDecks = getDecksForDataSource('memory');
    memoryDecks.forEach((deck) => {
      const deckCardUUIDs = new Set(deck.cardUUIDs || []);

      let anyInDeck = false;
      let allInDeck = true;

      for (const uuid of selectedSet) {
        if (deckCardUUIDs.has(uuid)) {
          anyInDeck = true;
        } else {
          allInDeck = false;
        }
      }

      const indentLevel = deck.level || 0;
      const prefix = indentLevel > 0 ? '  '.repeat(indentLevel) + '└ ' : '';

      menu.addItem((item) => {
        item.setTitle(prefix + deck.name);

        if (allInDeck) {
          item.setIcon('check-square');
        } else {
          item.setIcon(anyInDeck ? 'minus-square' : 'square');
        }

        item.onClick(async () => {
          await handleBatchToggleDeckReference(deck, { allInDeck }, selectedCardIds);

          if (lastBatchDeckMenuPosition) {
            setTimeout(() => {
              showBatchDeckMultiSelectMenu(selectedCardIds);
            }, 0);
          }
        });
      });
    });

    menu.showAtPosition(lastBatchDeckMenuPosition);
  }

  async function handleBatchToggleDeckReference(
    deck: Deck,
    current: { allInDeck: boolean },
    cardUUIDs: string[]
  ) {
    const referenceDeckService = plugin.referenceDeckService;
    if (!referenceDeckService) {
      showNotification("ReferenceDeckService 未初始化", "error");
      return;
    }

    try {
      const now = new Date().toISOString();

      if (current.allInDeck) {
        await referenceDeckService.removeCardsFromDeck(deck.id, cardUUIDs);

        const removeSet = new Set(cardUUIDs);
        allDecks = allDecks.map((d) => {
          if (d.id !== deck.id) return d;
          const next = (d.cardUUIDs || []).filter((uuid) => !removeSet.has(uuid));
          return { ...d, cardUUIDs: next, modified: now };
        });

        cards = cards.map((c) => {
          if (!removeSet.has(c.uuid)) return c;
          const metadata = getCardMetadata(c.content || '');
          const weDecks = new Set(metadata.we_decks || []);
          weDecks.delete(deck.name);
          weDecks.delete(deck.id);

          const nextRefs = new Set(c.referencedByDecks || []);
          nextRefs.delete(deck.id);

          return {
            ...c,
            referencedByDecks: Array.from(nextRefs),
            content: setCardProperties(c.content || '', {
              we_decks: weDecks.size > 0 ? Array.from(weDecks) : undefined
            }),
            modified: now
          };
        });
      } else {
        await referenceDeckService.addCardsToDeck(deck.id, cardUUIDs);

        const addSet = new Set(cardUUIDs);
        allDecks = allDecks.map((d) => {
          if (d.id !== deck.id) return d;
          const next = new Set([...(d.cardUUIDs || []), ...cardUUIDs]);
          return { ...d, cardUUIDs: Array.from(next), modified: now };
        });

        cards = cards.map((c) => {
          if (!addSet.has(c.uuid)) return c;
          const metadata = getCardMetadata(c.content || '');
          const weDecks = new Set(metadata.we_decks || []);
          weDecks.delete(deck.id);
          weDecks.add(deck.name);

          const nextRefs = new Set(c.referencedByDecks || []);
          nextRefs.add(deck.id);

          return {
            ...c,
            referencedByDecks: Array.from(nextRefs),
            content: setCardProperties(c.content || '', { we_decks: Array.from(weDecks) }),
            modified: now
          };
        });
      }

      dataVersion++;
    } catch (error) {
      logger.error('[WeaveCardManagement] 批量更换牌组失败:', error);
      showNotification("批量更换牌组失败", "error");
    }
  }

  function handleBatchCopy() {
    const selectedCardIds = Array.from(selectedCards);
    logger.debug("批量复制:", selectedCardIds);

    if (selectedCardIds.length === 0) {
      new Notice("请先选择要复制的卡片");
      return;
    }

    // 获取选中的卡片数据
    const selectedCardData = filteredCards.filter(card => selectedCardIds.includes(card.uuid));

    // 创建复制的文本内容
    // 🆕 v2.2: 优先从 content YAML 的 we_decks 获取牌组ID
    const copyText = selectedCardData.map(card => {
      const { primaryDeckId } = getCardDeckIds(card, currentDataSourceDecks);
      const deck = currentDataSourceDecks.find(d => d.id === (primaryDeckId || card.deckId));
      return `正面: ${card.fields?.front || card.fields?.question || ''}
背面: ${card.fields?.back || card.fields?.answer || ''}
标签: ${card.tags?.join(', ') || '无'}
牌组: ${deck?.name || '默认'}
---`;
    }).join('\n');

    // 复制到剪贴板
    navigator.clipboard.writeText(copyText).then(() => {
      new Notice(`已复制 ${selectedCardIds.length} 张卡片到剪贴板`);
    }).catch(() => {
      new Notice("复制失败，请重试");
    });
  }

  // 导出笔记（MD + CSV，支持多种分组方式）
  type ExportFormat = 'md' | 'csv';
  type ExportMode = 'single' | 'bySource' | 'byMonth' | 'byDeck';

  // 显示文件夹选择器
  function showExportFolderPicker(mode: ExportMode, format: ExportFormat, cardsToExport: Card[]) {
    const allFolders: string[] = [''];
    function collectFolders(folder: TFolder) {
      if (folder.path) allFolders.push(folder.path);
      for (const child of folder.children) {
        if (child instanceof TFolder) collectFolders(child);
      }
    }
    collectFolders(plugin.app.vault.getRoot());
    allFolders.sort((a, b) => a.localeCompare(b, 'zh-CN'));

    const modal = new ExportFolderPickerModal(plugin.app, allFolders, (item) => executeExport(mode, format, cardsToExport, item));
    modal.setPlaceholder(t('cardManagement.batchToolbar.exportSelectFolder'));
    modal.open();
  }

  // 执行导出（统一入口）
  async function executeExport(mode: ExportMode, format: ExportFormat, cardsToExport: Card[], folderPath: string) {
    try {
      if (format === 'csv') {
        await executeCSVExport(mode, cardsToExport, folderPath);
      } else {
        await executeMDExport(mode, cardsToExport, folderPath);
      }
    } catch (error: any) {
      logger.error('导出失败:', error);
      new Notice(t('cardManagement.batchToolbar.exportFailed').replace('{error}', error.message || String(error)));
    }
  }

  // MD 导出（含分组）
  async function executeMDExport(mode: ExportMode, cardsToExport: Card[], folderPath: string) {
    if (mode === 'single') {
      await exportAsSingleFile(cardsToExport, folderPath);
    } else {
      const groups = getExportGroups(mode, cardsToExport);
      await exportGroupedMD(groups, folderPath);
    }
  }

  // CSV 导出（含分组）
  async function executeCSVExport(mode: ExportMode, cardsToExport: Card[], folderPath: string) {
    if (mode === 'single') {
      const timestamp = new Date().toISOString().slice(0, 10);
      const fileName = `Weave Export ${timestamp}.csv`;
      const filePath = folderPath ? `${folderPath}/${fileName}` : fileName;
      const csvContent = cardsToCSV(cardsToExport, currentDataSourceDecks);
      const finalPath = await getUniqueFilePath(filePath);
      await plugin.app.vault.create(finalPath, csvContent);
      new Notice(`已导出 ${cardsToExport.length} 张卡片到 ${finalPath}`);
    } else {
      const groups = getExportGroups(mode, cardsToExport);
      let totalExported = 0;
      let fileCount = 0;
      for (const [groupKey, groupCards] of groups) {
        const baseName = sanitizeFileName(groupKey === '__no_source__' || groupKey === '__no_deck__' || groupKey === '__unknown__'
          ? `Weave Export - Ungrouped`
          : `Weave Export - ${groupKey}`);
        const filePath = folderPath ? `${folderPath}/${baseName}.csv` : `${baseName}.csv`;
        const csvContent = cardsToCSV(groupCards, currentDataSourceDecks);
        const finalPath = await getUniqueFilePath(filePath);
        await plugin.app.vault.create(finalPath, csvContent);
        totalExported += groupCards.length;
        fileCount++;
      }
      new Notice(`已导出 ${totalExported} 张卡片到 ${fileCount} 个 CSV 文件`);
    }
  }

  // 获取分组结果
  function getExportGroups(mode: ExportMode, cardsToExport: Card[]): Map<string, Card[]> {
    switch (mode) {
      case 'bySource': return groupCardsBySource(cardsToExport);
      case 'byMonth': return groupCardsByMonth(cardsToExport);
      case 'byDeck': return groupCardsByDeck(cardsToExport, currentDataSourceDecks);
      default: {
        const m = new Map<string, Card[]>();
        m.set('all', cardsToExport);
        return m;
      }
    }
  }

  // MD 分组导出
  async function exportGroupedMD(groups: Map<string, Card[]>, folderPath: string) {
    let totalExported = 0;
    let fileCount = 0;
    for (const [groupKey, groupCards] of groups) {
      const baseName = sanitizeFileName(groupKey === '__no_source__' || groupKey === '__no_deck__' || groupKey === '__unknown__'
        ? 'Weave Export - Ungrouped'
        : `Weave Export - ${groupKey}`);
      const filePath = folderPath ? `${folderPath}/${baseName}.md` : `${baseName}.md`;
      const sections = groupCards.map(card => formatCardForExport(card));
      const content = sections.join('\n\n---\n\n') + '\n';
      const finalPath = await getUniqueFilePath(filePath);
      await plugin.app.vault.create(finalPath, content);
      totalExported += groupCards.length;
      fileCount++;
    }
    new Notice(
      t('cardManagement.batchToolbar.exportSuccessMultiple')
        .replace('{count}', String(totalExported))
        .replace('{fileCount}', String(fileCount))
    );
  }

  // 获取卡片的来源链接文本
  function getCardSourceLink(card: Card): string {
    // 优先从content YAML获取来源信息
    const sourceInfo = parseSourceInfo(card.content || '');
    if (sourceInfo.sourceFile) {
      const docName = sourceInfo.sourceFile.replace(/\.md$/, '');
      if (sourceInfo.sourceBlock) {
        return `[[${docName}#^${sourceInfo.sourceBlock}]]`;
      }
      return `[[${docName}]]`;
    }
    // 回退到卡片的sourceFile字段
    if (card.sourceFile) {
      const docName = card.sourceFile.replace(/\.md$/, '');
      if (card.sourceBlock) {
        return `[[${docName}#^${card.sourceBlock}]]`;
      }
      return `[[${docName}]]`;
    }
    return '';
  }

  // 获取卡片的来源文档标识（用于分组）
  function getCardSourceKey(card: Card): string {
    const sourceInfo = parseSourceInfo(card.content || '');
    if (sourceInfo.sourceFile) {
      return sourceInfo.sourceFile;
    }
    if (card.sourceFile) {
      return card.sourceFile;
    }
    return '__no_source__';
  }

  // 格式化单张卡片为MD内容
  function formatCardForExport(card: Card): string {
    let bodyContent = extractBodyContent(card.content || '').trim();

    // 将内部分隔符 ---div--- 替换为标准 Markdown 水平线
    bodyContent = bodyContent.replace(/^\s*---div---\s*$/gm, '---');

    const sourceLink = getCardSourceLink(card);

    let result = bodyContent;
    // 仅当来源是有效的 wikilink 时才添加 Source 行（排除内部ID）
    if (sourceLink && sourceLink.includes('[[')) {
      result += `\n\n> Source: ${sourceLink}`;
    }
    return result;
  }

  // 导出为单个文件
  async function exportAsSingleFile(cardsToExport: Card[], folderPath: string) {
    const timestamp = new Date().toISOString().slice(0, 10);
    const fileName = `Weave Export ${timestamp}.md`;
    const filePath = folderPath ? `${folderPath}/${fileName}` : fileName;

    const sections: string[] = [];
    for (const card of cardsToExport) {
      sections.push(formatCardForExport(card));
    }

    const content = sections.join('\n\n---\n\n') + '\n';

    // 检查文件是否已存在，若存在则加数字后缀
    const finalPath = await getUniqueFilePath(filePath);
    await plugin.app.vault.create(finalPath, content);

    new Notice(
      t('cardManagement.batchToolbar.exportSuccess')
        .replace('{count}', String(cardsToExport.length))
        .replace('{path}', finalPath)
    );
  }

  // 按来源文档分别导出
  async function exportBySource(cardsToExport: Card[], folderPath: string) {
    // 按来源文档分组（保持排序顺序）
    const groups = new Map<string, Card[]>();
    for (const card of cardsToExport) {
      const key = getCardSourceKey(card);
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(card);
    }

    let totalExported = 0;
    let fileCount = 0;

    for (const [sourceKey, groupCards] of groups) {
      // 生成文件名
      let baseName: string;
      if (sourceKey === '__no_source__') {
        baseName = 'Weave Export - No Source';
      } else {
        baseName = `Weave Export - ${sourceKey.replace(/\.md$/, '').replace(/[\\/:*?"<>|]/g, '_')}`;
      }
      const fileName = `${baseName}.md`;
      const filePath = folderPath ? `${folderPath}/${fileName}` : fileName;

      const sections: string[] = [];
      for (const card of groupCards) {
        sections.push(formatCardForExport(card));
      }

      const content = sections.join('\n\n---\n\n') + '\n';

      const finalPath = await getUniqueFilePath(filePath);
      await plugin.app.vault.create(finalPath, content);

      totalExported += groupCards.length;
      fileCount++;
    }

    new Notice(
      t('cardManagement.batchToolbar.exportSuccessMultiple')
        .replace('{count}', String(totalExported))
        .replace('{fileCount}', String(fileCount))
    );
  }

  // 获取唯一文件路径（避免覆盖已有文件，支持 .md 和 .csv）
  async function getUniqueFilePath(filePath: string): Promise<string> {
    const extMatch = filePath.match(/\.(md|csv)$/);
    const ext = extMatch ? extMatch[0] : '.md';
    const basePath = filePath.replace(/\.(md|csv)$/, '');
    let candidate = filePath;
    let counter = 1;
    while (plugin.app.vault.getAbstractFileByPath(candidate)) {
      candidate = `${basePath} ${counter}${ext}`;
      counter++;
    }
    return candidate;
  }

  // 🆕 标签操作菜单（合并增加标签和移除标签）
  function handleBatchTagsMenu(event?: MouseEvent) {
    const selectedCardIds = Array.from(selectedCards);
    if (selectedCardIds.length === 0) {
      new Notice("请先选择卡片");
      return;
    }

    const menu = new Menu();
    (menu as any).app = plugin.app;

    // 增加标签子菜单
    menu.addItem((item) => {
      item.setTitle('增加标签').setIcon('plus');
      const submenu = (item as any).setSubmenu();

      const sourceCards = currentSourceCards;
      const selectedCardData = sourceCards.filter(c => selectedCardIds.includes(c.uuid));
      const existingTagsInSelection = new Set<string>();
      selectedCardData.forEach(card => {
        card.tags?.forEach(tag => existingTagsInSelection.add(tag));
      });

      const tagsToShow = availableTags
        .filter(t => !existingTagsInSelection.has(t.name))
        .slice(0, 20);

      if (tagsToShow.length > 0) {
        tagsToShow.forEach((tag) => {
          submenu.addItem((subItem: any) => {
            subItem.setTitle(tag.name).setIcon('tag');
            subItem.onClick(() => { handleBatchAddTags([tag.name]); });
          });
        });
      } else {
        submenu.addItem((subItem: any) => {
          subItem.setTitle('没有可添加的标签').setDisabled(true);
        });
      }
    });

    // 移除标签子菜单
    menu.addItem((item) => {
      item.setTitle('移除标签').setIcon('minus');
      const submenu = (item as any).setSubmenu();

      const sourceCards = currentSourceCards;
      const selectedCardData = sourceCards.filter(c => selectedCardIds.includes(c.uuid));
      const tagCounts = new Map<string, number>();
      selectedCardData.forEach(card => {
        card.tags?.forEach(tag => {
          tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
        });
      });

      if (tagCounts.size > 0) {
        const sortedTags = Array.from(tagCounts.entries()).sort((a, b) => b[1] - a[1]);
        sortedTags.forEach(([tag, count]) => {
          submenu.addItem((subItem: any) => {
            subItem.setTitle(`${tag} (${count})`).setIcon('tag');
            subItem.onClick(() => { handleBatchRemoveTagsConfirm([tag]); });
          });
        });
        if (sortedTags.length > 1) {
          submenu.addSeparator();
          submenu.addItem((subItem: any) => {
            subItem.setTitle(`删除全部 ${sortedTags.length} 个标签`).setIcon('trash-2');
            subItem.onClick(() => { handleBatchRemoveTagsConfirm(sortedTags.map(([tag]) => tag)); });
          });
        }
      } else {
        submenu.addItem((subItem: any) => {
          subItem.setTitle('选中卡片没有标签').setDisabled(true);
        });
      }
    });

    if (event) {
      const rect = (event.target as HTMLElement).getBoundingClientRect();
      menu.showAtPosition({ x: rect.left, y: rect.top - 8 });
    } else {
      menu.showAtPosition({ x: window.innerWidth / 2, y: window.innerHeight - 100 });
    }
  }

  // 🆕 v2.0 组建牌组
  function handleBuildDeck() {
    const selectedCardIds = Array.from(selectedCards);
    logger.debug("组建牌组:", selectedCardIds);

    if (selectedCardIds.length === 0) {
      new Notice("请先选择要组建牌组的卡片");
      return;
    }

    // 打开组建牌组模态窗
    showBuildDeckModal = true;
  }


  // 🆕 v2.0 组建牌组完成回调
  function handleBuildDeckCreated(deck: Deck) {
    logger.info("牌组创建成功:", deck.name);
    // 清除选择
    selectedCards = new Set();
    // 刷新数据
    loadCards();
  }

  async function handleBatchDelete() {
    const selectedCardIds = Array.from(selectedCards);
    logger.debug("批量删除:", selectedCardIds, "数据源:", dataSource);

    if (selectedCardIds.length === 0) {
      new Notice("请先选择要删除的卡片");
      return;
    }

    // ✅ 使用 Obsidian Modal 代替 confirm()，避免焦点劫持问题
    const modal = new Modal(plugin.app);
    modal.titleEl.setText('确认删除');
    modal.contentEl.setText(`确定要删除选中的 ${selectedCardIds.length} 张卡片吗？\n\n此操作不可撤销！`);
    
    const buttonContainer = modal.contentEl.createDiv({ cls: 'confirm-buttons' });
    buttonContainer.style.display = 'flex';
    buttonContainer.style.justifyContent = 'flex-end';
    buttonContainer.style.gap = '10px';
    buttonContainer.style.marginTop = '16px';
    
    let shouldDelete = false;
    
    const cancelButton = buttonContainer.createEl('button', { text: '取消' });
    cancelButton.onclick = () => modal.close();
    
    const deleteButton = buttonContainer.createEl('button', { 
      text: '确认删除',
      cls: 'mod-warning'
    });
    deleteButton.onclick = () => {
      shouldDelete = true;
      modal.close();
    };
    modal.onClose = async () => {
      if (!shouldDelete) return;
      
      let ok = 0, fail = 0;
      
      if (dataSource === 'incremental-reading') {
        // 🎯 增量阅读模式：从IR存储中删除内容块
        logger.debug("使用IR存储删除内容块");
        
        if (!irStorageService) {
          irStorageService = new IRStorageService(plugin.app);
          await irStorageService.initialize();
        }

        const affectedSourceIds = new Set<string>();
        const foldersToCheck = new Set<string>(); // 收集需要检查的文件夹
        
        for (const id of selectedCardIds) {
          try {
            // 🔧 v5.7: 根据卡片类型区分删除 blocks.json 或 chunks.json
            const card = irContentCards.find(c => c.uuid === id);
            const isChunkType = card?.templateId === CardType.IRChunk || card?.type === CardType.IRChunk;
            
            if (isChunkType) {
              const chunk = await irStorageService.getChunkData(id);
              if (chunk) {
                affectedSourceIds.add(chunk.sourceId);
                const file = plugin.app.vault.getAbstractFileByPath(chunk.filePath);
                if (file instanceof TFile) {
                  await plugin.app.fileManager.trashFile(file);
                  // 记录父文件夹路径
                  const parentPath = chunk.filePath.substring(0, chunk.filePath.lastIndexOf('/'));
                  if (parentPath) {
                    foldersToCheck.add(parentPath);
                  }
                } else {
                  const adapter = plugin.app.vault.adapter;
                  if (await adapter.exists(chunk.filePath)) {
                    await adapter.remove(chunk.filePath);
                    // 记录父文件夹路径
                    const parentPath = chunk.filePath.substring(0, chunk.filePath.lastIndexOf('/'));
                    if (parentPath) {
                      foldersToCheck.add(parentPath);
                    }
                  }
                }
              }
              await irStorageService.deleteChunkData(id);
              logger.debug(`成功删除IR chunk: ${id}`);
            } else {
              // 旧版 blocks.json 数据：从牌组移除引用 + 删除 block
              const irDeckMap = await irStorageService.getAllDecks();
              for (const deck of Object.values(irDeckMap)) {
                if (deck.blockIds?.includes(id)) {
                  await irStorageService.removeBlocksFromDeck(deck.id, [id]);
                }
              }
              await irStorageService.deleteBlock(id);
              logger.debug(`成功删除IR block: ${id}`);
            }
            ok++;
          } catch (error) {
            logger.error(`删除IR内容块失败: ${id}`, error);
            fail++;
          }
        }

        if (affectedSourceIds.size > 0) {
          const chunks = await irStorageService.getAllChunkData();
          const sources = await irStorageService.getAllSources();
          for (const sourceId of affectedSourceIds) {
            const source = sources[sourceId];
            if (!source) continue;

            const remainingChunkIds = (source.chunkIds || []).filter(chunkId => !!chunks[chunkId]);
            if (remainingChunkIds.length === 0) {
              try {
                if (source.indexFilePath) {
                  const indexFile = plugin.app.vault.getAbstractFileByPath(source.indexFilePath);
                  if (indexFile instanceof TFile) {
                    await plugin.app.fileManager.trashFile(indexFile);
                    // 记录索引文件的父文件夹
                    const parentPath = source.indexFilePath.substring(0, source.indexFilePath.lastIndexOf('/'));
                    if (parentPath) {
                      foldersToCheck.add(parentPath);
                    }
                  }
                }
              } catch (error) {
                logger.warn(`[IR] 删除源索引文件失败: ${source.indexFilePath}`, error);
              }

              try {
                await irStorageService.deleteSource(sourceId);
              } catch (error) {
                logger.warn(`[IR] 删除源材料元数据失败: ${sourceId}`, error);
              }
            } else if (remainingChunkIds.length !== (source.chunkIds || []).length) {
              try {
                source.chunkIds = remainingChunkIds;
                source.updatedAt = Date.now();
                await irStorageService.saveSource(source);
              } catch (error) {
                logger.warn(`[IR] 更新源材料元数据失败: ${sourceId}`, error);
              }
            }
          }
        }
        
        // 清理空文件夹
        for (const folderPath of foldersToCheck) {
          await cleanEmptyParentFolders(folderPath);
        }
        
        // 重新加载IR数据
        await loadIRContentCards();
      } else if (dataSource === 'questionBank') {
        // 🎯 考试牌组模式：从题库中删除题目
        logger.debug("使用题库存储删除卡片");
        
        if (!questionBankStorage) {
          new Notice("题库存储服务未初始化");
          return;
        }
        
        // 按题库分组待删除的卡片
        const cardsByBank = new Map<string, Card[]>();
        for (const id of selectedCardIds) {
          const card = questionBankCards.find(c => c.uuid === id);
          if (!card) { 
            logger.warn(`未找到题库卡片: ${id}`);
            fail++; 
            continue; 
          }
          
          // 🆕 v2.2: 优先从 content YAML 的 we_decks 获取题库ID
          const { primaryDeckId } = getCardDeckIds(card, questionBankDecks);
          const bankId = primaryDeckId || card.deckId || '';
          if (!cardsByBank.has(bankId)) {
            cardsByBank.set(bankId, []);
          }
          cardsByBank.get(bankId)!.push(card);
        }
        
        // 对每个题库执行删除操作
        for (const [bankId, cardsToDelete] of cardsByBank) {
          try {
            if (!plugin.questionBankService) {
              throw new Error('题库服务未初始化');
            }

            for (const c of cardsToDelete) {
              await plugin.questionBankService.deleteQuestion(bankId, c.uuid);
            }
            
            logger.debug(`成功从题库 ${bankId} 删除 ${cardsToDelete.length} 张卡片`);
            ok += cardsToDelete.length;
          } catch (error) {
            logger.error(`删除题库 ${bankId} 中的卡片失败:`, error);
            fail += cardsToDelete.length;
          }
        }
        
        // 重新加载题库数据
        await loadQuestionBankCards();
      } else {
        // 🎯 记忆牌组模式：高效批量删除
        logger.debug("使用记忆存储删除卡片");
        
        const { ProgressModal } = await import('../../utils/progress-modal');
        const progress = new ProgressModal(plugin.app, {
          title: '删除卡片',
          description: `正在删除 ${selectedCardIds.length} 张卡片...`,
          total: 3,
          cancellable: false
        });
        progress.open();
        
        // 阶段 1/3: 级联清理 - 从所有牌组中批量移除被删卡片的引用
        progress.updateProgress(0, '清理牌组引用...');
        const cardUUIDSet = new Set(selectedCardIds);
        const allDecksForCleanup = await dataStorage.getDecks();
        for (const d of allDecksForCleanup) {
          const before = d.cardUUIDs?.length || 0;
          if (before === 0) continue;
          d.cardUUIDs = (d.cardUUIDs || []).filter(uuid => !cardUUIDSet.has(uuid));
          if (d.cardUUIDs.length !== before) {
            d.modified = new Date().toISOString();
            await dataStorage.saveDeck(d);
          }
        }
        progress.increment('引用清理完成');
        
        // 阶段 2/3: 批量删除卡片数据
        progress.updateProgress(1, '删除卡片数据...');
        if (plugin.cardFileService) {
          const batchResult = await plugin.cardFileService.deleteCardsBatch(selectedCardIds);
          ok = batchResult.deleted.length;
          fail = batchResult.notFound.length;
          logger.info(`[CardMgmt] 批量删除: 成功${ok}, 未找到${fail}`);
        } else {
          // 回退到逐卡删除
          for (const id of selectedCardIds) {
            try {
              const res = await dataStorage.deleteCard(id);
              if (res.success && res.data) ok++; else fail++;
            } catch { fail++; }
          }
        }
        progress.increment('卡片数据已删除');
        
        // 阶段 3/3: 清理缓存
        progress.updateProgress(2, '清理缓存...');
        if (plugin.cardMetadataCache) {
          for (const id of selectedCardIds) plugin.cardMetadataCache.invalidate(id);
        }
        if (plugin.cardIndexService) {
          for (const id of selectedCardIds) plugin.cardIndexService.removeCardIndex(id);
        }
        for (const id of selectedCardIds) {
          plugin.app.workspace.trigger('Weave:card-deleted', id);
        }
        progress.increment('清理完成');
        
        progress.setComplete(`已删除 ${ok} 张卡片`);
        
        // 重新加载记忆牌组数据
        await loadCards();
      }

      new Notice(`已删除 ${ok} 张卡片${fail ? `，失败 ${fail}` : ''}`);

      // 通知全局侧边栏刷新
      plugin.app.workspace.trigger('Weave:data-changed');

      // 清除选择状态
      handleClearSelection();
    };
    
    modal.open();
  }



  // 🆕 加载考试牌组卡片数据
  async function loadQuestionBankCards(): Promise<void> {
    if (!questionBankStorage) {
      logger.error('[QuestionBank] Storage未初始化');
      return;
    }
    
    isLoadingQuestionBank = true;
    
    try {
      // 1. 加载所有题库牌组
      const banks = await questionBankStorage.loadBanks();
      logger.debug(`[QuestionBank] 加载了${banks.length}个题库`);
      questionBankDecks = banks;
      
      // 2. 加载所有题库的题目（真实数据源）
      const allQuestionsMap = new Map<string, Card>();
      for (const bank of banks) {
        const questions = plugin.questionBankService
          ? await plugin.questionBankService.getQuestionsByBank(bank.id)
          : [];
        for (const question of questions) {
          allQuestionsMap.set(question.uuid, question);
        }
      }
      logger.debug(`[QuestionBank] 加载了${allQuestionsMap.size}张实际存在的题目`);

      const statsMap = new Map<string, QuestionTestStats>();
      for (const q of allQuestionsMap.values()) {
        const testStats = q.stats?.testStats;
        if (testStats) {
          statsMap.set(q.uuid, testStats);
        }
      }

      // 3. 更新状态（只包含实际存在的题目）
      questionBankCards = Array.from(allQuestionsMap.values());
      questionBankStats = statsMap;
      
      logger.debug(`[QuestionBank] 最终加载了${questionBankCards.length}张题目卡片`);
      showNotification(`已加载 ${questionBankCards.length} 张题目卡片`, 'success');
      
    } catch (error) {
      logger.error('[QuestionBank] 加载失败:', error);
      showNotification('加载考试数据失败', 'error');
    } finally {
      isLoadingQuestionBank = false;
    }
  }
  
  // 统一数据源切换函数（供彩色圆点调用）
  async function switchDataSource(newSource: 'memory' | 'questionBank' | 'incremental-reading'): Promise<void> {
    // 如果已经是当前数据源，不做处理
    if (dataSource === newSource) return;
    
    if (newSource === 'questionBank' && premiumGuard.isFeatureRestricted(PREMIUM_FEATURES.QUESTION_BANK)) {
      promptFeatureId = PREMIUM_FEATURES.QUESTION_BANK;
      showActivationPrompt = true;
      return;
    }

    // 增量阅读高级功能门控
    if (newSource === 'incremental-reading' && premiumGuard.isFeatureRestricted(PREMIUM_FEATURES.INCREMENTAL_READING)) {
      new Notice('增量阅读是高级功能，请激活许可证后使用');
      return;
    }
    
    // 根据目标数据源加载数据
    if (newSource === 'questionBank' && questionBankCards.length === 0) {
      await loadQuestionBankCards();
    } else if (newSource === 'incremental-reading' && irContentCards.length === 0) {
      await loadIRContentCards();
    }
    
    dataSource = newSource;
    
    // 切换离开IR时重置类型筛选
    if (newSource !== 'incremental-reading') {
      irTypeFilter = 'all';
    }
    
    // 同步数据源到全局筛选状态服务
    plugin.filterStateService.updateFilter({ dataSource: newSource });
    
    // 🔧 使用统一的列可见性同步函数
    syncColumnVisibilityWithDataSource(newSource);
    
    // 清空选中状态
    selectedCards.clear();
    
    // 显示切换提示
    const sourceNames: Record<string, string> = {
      'memory': '记忆牌组',
      'questionBank': '考试牌组',
      'incremental-reading': '增量阅读'
    };
    showNotification(`切换到${sourceNames[newSource]}数据`, 'success');
  }
  
  // 加载增量阅读卡片，同时兼容旧版 blocks.json 与新版 chunks.json
  async function loadIRContentCards(options?: { silent?: boolean }): Promise<void> {
    if (isLoadingIR) return;
    
    isLoadingIR = true;
    try {
      // 初始化IR存储服务
      if (!irStorageService) {
        irStorageService = new IRStorageService(plugin.app);
        await irStorageService.initialize();
      }
      
      // 先执行数据完整性检查，清理已失效的块数据
      const { resolveIRImportFolder } = await import('../../config/paths');
      const scanRoot = resolveIRImportFolder(
        plugin.settings?.incrementalReading?.importFolder,
        plugin.settings?.weaveParentFolder
      );
      const integrityResult = await irStorageService.performIntegrityCheck(scanRoot);
      if (integrityResult.chunksRemoved > 0 || integrityResult.blocksRemoved > 0) {
        logger.info(`[IR] 数据完整性检查: 清理了 ${integrityResult.chunksRemoved} 个无效块, ${integrityResult.blocksRemoved} 个无效旧版块`);
      }
      
      // 加载IR数据
      irBlocks = await irStorageService.getAllBlocks();
      irDecks = await irStorageService.getAllDecks();
      const history = await irStorageService.getHistory();
      const readingSecondsById = buildIRSessionTotalsByBlockId(history.sessions);
      
      // 加载文件化 chunk 数据与来源信息
      const chunkData = await irStorageService.getAllChunkData();
      const sourcesData = await irStorageService.getAllSources();
      
      logger.info(`[IR] 加载数据: blocks=${Object.keys(irBlocks).length}, decks=${Object.keys(irDecks).length}, chunks=${Object.keys(chunkData).length}, sources=${Object.keys(sourcesData).length}`);
      
      const convertedCards: Card[] = [];
      
      // 同一内容如果同时存在于 blocks/chunks，优先使用 chunks
      const chunkIds = new Set(Object.keys(chunkData));
      
      // 1. 转换旧版 IRBlock (blocks.json)
      for (const block of Object.values(irBlocks)) {
        if (chunkIds.has(block.id)) {
          continue;
        }
        // 查找块所属的牌组
        const deckIds: string[] = [];
        for (const deck of Object.values(irDecks)) {
          if (deck.blockIds?.includes(block.id)) {
            deckIds.push(deck.id);
          }
        }
        
        // 转换为Card格式（包含IR专用字段）
        // 防御性处理：确保 headingPath 是数组
        const headingPath = Array.isArray(block.headingPath) ? block.headingPath : [];
        const displayContent = `# ${block.headingText || '无标题'}\n\n${headingPath.length > 1 ? `${headingPath.join(' > ')}\n\n` : ''}来源: ${block.filePath}`;
        
        const readingSeconds = getIRReadingSeconds(block.id, readingSecondsById, block.totalReadingTime);

        const card: Card & Record<string, any> = {
          ...buildIRCardBase({
            id: block.id,
            deckId: deckIds[0] || '',
            templateId: CardType.IRBlock,
            type: CardType.IRBlock,
            content: displayContent,
            front: block.headingText || '无标题',
            back: headingPath.join(' > '),
            sourceFile: block.filePath,
            sourcePosition: {
              startLine: block.startLine,
              endLine: block.startLine,
              contentHash: ''
            },
            created: block.createdAt,
            modified: block.updatedAt,
            totalReviews: block.reviewCount || 0,
            totalTime: readingSeconds,
            averageTime: block.reviewCount ? Math.floor(readingSeconds / block.reviewCount) : 0,
            fsrsState: block.state === 'new' ? 0 : block.state === 'learning' ? 1 : 2,
            stability: block.interval,
            due: block.nextReview || new Date().toISOString(),
            lastReview: block.lastReview || undefined,
            reps: block.reviewCount,
            scheduledDays: block.interval || 0,
            tags: block.tags || [],
            priority: block.priority || 2,
            suspended: block.state === 'suspended',
            metadata: {
              irBlock: true,
              headingLevel: block.headingLevel,
              headingPath: block.headingPath,
              totalReadingTime: readingSeconds,
              favorite: block.favorite,
              extractedCards: block.extractedCards,
              deckIds: deckIds
            }
          }),
          ...buildIRTableFields({
            title: headingPath.join(' > ') || block.headingText || '无标题',
            sourceFile: block.filePath,
            deckName: deckIds.length > 0 ? getIRDeckName(deckIds[0]) : '未分配',
            deckIds,
            state: block.state,
            priority: block.priority,
            tags: block.tags || [],
            favorite: block.favorite,
            nextReview: block.nextReview,
            reviewCount: block.reviewCount,
            readingTime: readingSeconds,
            notes: block.notes || '',
            extractedCards: block.extractedCards?.length || 0,
            created: block.createdAt
          }),
        };
        convertedCards.push(card);
      }
      
      // 2. 转换新版 IRChunkFileData (chunks.json)
      for (const chunk of Object.values(chunkData)) {
        // 从文件路径提取标题
        const fileName = chunk.filePath.replace(/^.*\//, '').replace(/\.md$/, '');
        const title = fileName.replace(/^\d+_/, ''); // 移除序号前缀
        
        // 查找源文件信息
        const source = sourcesData[chunk.sourceId];
        const sourceTitle = source?.title || '未知来源';
        
        // 读取块文件的YAML和内容以提取标签
        let tags: string[] = [];
        let extractedCardsCount = 0;
        try {
          const chunkFile = plugin.app.vault.getAbstractFileByPath(chunk.filePath);
          if (chunkFile instanceof TFile) {
            const content = await plugin.app.vault.read(chunkFile);
            
            // 提取YAML中的tags
            const yamlMatch = content.match(/^---\n([\s\S]*?)\n---/);
            if (yamlMatch) {
              const yamlContent = yamlMatch[1];
              const tagsMatch = yamlContent.match(/tags:\s*\[([^\]]+)\]/) || yamlContent.match(/tags:\s*\n((?:\s+-\s+.+\n)+)/);
              if (tagsMatch) {
                if (tagsMatch[1].includes('-')) {
                  // 列表格式
                  tags = tagsMatch[1].split('\n')
                    .map(line => line.trim().replace(/^-\s+/, ''))
                    .filter(tag => tag.length > 0);
                } else {
                  // 单行格式
                  tags = tagsMatch[1].split(',').map(tag => tag.trim()).filter(tag => tag.length > 0);
                }
              }
            }
            
            // 从内容中提取#标签（排除Markdown标题：行首#后跟空格）
            const bodyContent = content.replace(/^---\n[\s\S]*?\n---/, '');
            const contentTags = bodyContent.match(/(?<![#\w])#([\w\u4e00-\u9fa5-]+)/g) || [];
            const filteredTags = contentTags
              .map(t => t.substring(1))
              .filter(t => !/^\d+$/.test(t));
            tags = [...new Set([...tags, ...filteredTags])];
            
            // 统计制卡数：从 stats 中获取
            extractedCardsCount = chunk.stats?.cardsCreated || 0;
          }
        } catch (error) {
          logger.warn(`[读取块文件失败] ${chunk.filePath}:`, error);
        }
        
        // 转换为Card格式
        const displayContent = `# ${title}\n\n来源: ${sourceTitle}\n文件: ${chunk.filePath}`;
        
        const readingSeconds = getIRReadingSeconds(chunk.chunkId, readingSecondsById, chunk.stats?.totalReadingTimeSec);

        const card: Card & Record<string, any> = {
          ...buildIRCardBase({
            id: chunk.chunkId,
            deckId: '',
            templateId: CardType.IRChunk,
            type: CardType.IRChunk,
            content: displayContent,
            front: title,
            back: sourceTitle,
            sourceFile: chunk.filePath,
            sourcePosition: {
              startLine: 0,
              endLine: 0,
              contentHash: ''
            },
            created: typeof chunk.createdAt === 'number' ? new Date(chunk.createdAt).toISOString() : chunk.createdAt,
            modified: typeof chunk.updatedAt === 'number' ? new Date(chunk.updatedAt).toISOString() : chunk.updatedAt,
            totalReviews: chunk.stats?.impressions || 0,
            totalTime: readingSeconds,
            averageTime: chunk.stats?.impressions ? Math.floor(readingSeconds / chunk.stats.impressions) : 0,
            fsrsState: chunk.scheduleStatus === 'new' ? 0 : chunk.scheduleStatus === 'active' ? 1 : 2,
            stability: chunk.intervalDays,
            due: chunk.nextRepDate ? new Date(chunk.nextRepDate).toISOString() : new Date().toISOString(),
            lastReview: undefined,
            reps: chunk.stats?.impressions || 0,
            scheduledDays: chunk.intervalDays || 0,
            tags,
            priority: chunk.priorityEff <= 3 ? 1 : chunk.priorityEff <= 7 ? 2 : 3,
            suspended: chunk.scheduleStatus === 'suspended',
            metadata: {
              irChunk: true,
              sourceId: chunk.sourceId,
              sourceTitle: sourceTitle,
              deckTag: chunk.deckTag,
              deckIds: chunk.deckIds || []
            }
          }),
          ...buildIRTableFields({
            title,
            sourceFile: chunk.filePath,
            deckName: chunk.deckIds?.length ? getIRDeckName(chunk.deckIds[0]) : (chunk.deckTag ? chunk.deckTag.replace('#IR_deck_', '') : '未分配'),
            deckIds: chunk.deckIds || [],
            state: chunk.scheduleStatus,
            priority: chunk.priorityEff <= 3 ? 1 : chunk.priorityEff <= 7 ? 2 : 3,
            tags,
            favorite: false,
            nextReview: chunk.nextRepDate ? new Date(chunk.nextRepDate).toISOString() : null,
            reviewCount: chunk.stats?.impressions || 0,
            readingTime: readingSeconds,
            notes: '',
            extractedCards: extractedCardsCount,
            created: typeof chunk.createdAt === 'number' ? new Date(chunk.createdAt).toISOString() : chunk.createdAt,
          }),
        };
        convertedCards.push(card);
      }
      
      // 3. 转换 PDF 书签任务 (pdf-bookmark-tasks.json)
      let pdfTaskCount = 0;
      try {
        const pdfService = new IRPdfBookmarkTaskService(plugin.app);
        await pdfService.initialize();
        const pdfTasks = await pdfService.getAllTasks();
        
        for (const task of pdfTasks) {
          // 跳过已完成/已移除的任务
          if (task.status === 'done' || task.status === 'removed') continue;
          
          // 查找所属牌组名称
          const deckName = getIRDeckName(task.deckId);
          
          const displayContent = `# ${task.title}\n\nPDF: ${task.pdfPath}\n链接: ${task.link}`;
          
          // 将 priorityEff(1-10) 映射为显示用的 1(高)/2(中)/3(低)
          const displayPriority = task.priorityEff <= 3 ? 1 : task.priorityEff <= 7 ? 2 : 3;
          
          const readingSeconds = getIRReadingSeconds(task.id, readingSecondsById, task.stats?.totalReadingTimeSec);

          const card: Card & Record<string, any> = {
            ...buildIRCardBase({
              id: task.id,
              deckId: task.deckId || '',
              templateId: CardType.IRChunk,
              type: CardType.IRChunk,
              content: displayContent,
              front: task.title,
              back: task.pdfPath,
              sourceFile: task.pdfPath,
              sourcePosition: { startLine: 0, endLine: 0, contentHash: '' },
              created: new Date(task.createdAt).toISOString(),
              modified: new Date(task.updatedAt).toISOString(),
              totalReviews: task.stats?.impressions || 0,
              totalTime: readingSeconds,
              averageTime: task.stats?.impressions ? Math.floor(readingSeconds / task.stats.impressions) : 0,
              fsrsState: task.status === 'new' ? 0 : task.status === 'active' || task.status === 'queued' ? 1 : 2,
              stability: task.intervalDays,
              due: task.nextRepDate ? new Date(task.nextRepDate).toISOString() : new Date().toISOString(),
              lastReview: undefined,
              reps: task.stats?.impressions || 0,
              scheduledDays: task.intervalDays || 0,
              tags: task.tags || [],
              priority: displayPriority,
              suspended: task.status === 'suspended',
              metadata: {
                irPdfBookmark: true,
                pdfPath: task.pdfPath,
                link: task.link,
                annotationId: task.annotationId,
                deckIds: [task.deckId]
              }
            }),
            ...buildIRTableFields({
              title: task.title,
              sourceFile: task.pdfPath,
              deckName,
              deckIds: task.deckId ? [task.deckId] : [],
              state: task.status,
              priority: displayPriority,
              tags: task.tags || [],
              favorite: false,
              nextReview: task.nextRepDate ? new Date(task.nextRepDate).toISOString() : null,
              reviewCount: task.stats?.impressions || 0,
              readingTime: readingSeconds,
              notes: '',
              extractedCards: task.stats?.cardsCreated || 0,
              created: new Date(task.createdAt).toISOString(),
            }),
          };
          convertedCards.push(card);
          pdfTaskCount++;
        }
        
        if (pdfTaskCount > 0) {
          logger.info(`[IR] 加载了 ${pdfTaskCount} 个PDF书签任务`);
        }
      } catch (error) {
        logger.warn('[IR] PDF书签任务加载失败（继续使用其他数据）:', error);
      }
      
      irContentCards = convertedCards;
      const legacyCount = Object.keys(irBlocks).length;
      const chunkCount = Object.keys(chunkData).length;
      logger.debug(`[IR] 加载了 ${irContentCards.length} 个内容块 (旧版: ${legacyCount}, 新版: ${chunkCount}, PDF书签: ${pdfTaskCount})`);
      if (!options?.silent) {
        showNotification(`已加载 ${irContentCards.length} 个增量阅读内容块`, 'success');
      }
      
    } catch (error) {
      logger.error('[IR] 加载失败:', error);
      showNotification('加载增量阅读数据失败', 'error');
    } finally {
      isLoadingIR = false;
    }
  }

  // 🆕 v2.0 IR批量操作：组建增量牌组
  function handleBuildIRDeck(): void {
    const selectedIds = Array.from(selectedCards);
    if (selectedIds.length === 0) {
      showNotification('请先选择要添加到牌组的内容块', 'warning');
      return;
    }
    
    // 打开组建增量牌组模态窗
    showBuildIRDeckModal = true;
  }

  // 🆕 v2.0 IR组建牌组完成回调
  async function handleBuildIRDeckCreated(deck: IRDeck): Promise<void> {
    logger.info('[IR] 增量牌组创建成功:', deck.name);
    // 清除选择
    selectedCards = new Set();
    // 刷新数据
    await loadIRContentCards();
    showNotification(`增量牌组"${deck.name}"创建成功`, 'success');
  }

  // 🆕 v2.0 IR批量操作：切换收藏状态
  async function handleIRBatchToggleFavorite(): Promise<void> {
    const selectedIds = Array.from(selectedCards);
    if (selectedIds.length === 0) {
      showNotification('请先选择内容块', 'warning');
      return;
    }
    
    try {
      if (!irStorageService) {
        irStorageService = new IRStorageService(plugin.app);
        await irStorageService.initialize();
      }
      
      // 获取最新的块数据（避免使用闭包中的旧数据）
      const latestBlocks = await irStorageService.getAllBlocks();
      
      let toggledCount = 0;
      for (const id of selectedIds) {
        const block = latestBlocks[id];
        if (block) {
          const updatedBlock = { ...block, favorite: !block.favorite };
          await irStorageService.saveBlock(updatedBlock);
          toggledCount++;
        }
      }
      
      // 重新加载数据（保持选中状态）
      await loadIRContentCards();
      showNotification(`已切换 ${toggledCount} 个内容块的收藏状态`, 'success');
      
    } catch (error) {
      logger.error('[IR] 切换收藏失败:', error);
      showNotification('切换收藏失败', 'error');
    }
  }

  // 🆕 v5.5 IR批量操作：更换牌组（使用正式牌组列表，支持多牌组）
  async function handleIRBatchChangeDeck(event: MouseEvent): Promise<void> {
    const selectedIds = Array.from(selectedCards);
    if (selectedIds.length === 0) {
      showNotification('请先选择内容块', 'warning');
      return;
    }
    
    if (!irStorageService) {
      irStorageService = new IRStorageService(plugin.app);
      await irStorageService.initialize();
    }
    
    // v5.5: 获取正式牌组列表（从 decks.json）
    const validDecks = await irStorageService.getValidDeckList();
    
    const menu = new Menu();
    
    // 添加到牌组（支持多牌组）
    if (validDecks.length > 0) {
      menu.addItem((item) => {
        item.setTitle('添加到牌组');
        item.setIcon('folder-plus');
        const subMenu = (item as any).setSubmenu();
        
        for (const deck of validDecks) {
          subMenu.addItem((subItem: any) => {
            subItem.setTitle(deck.name);
            subItem.setIcon('folder');
            subItem.onClick(async () => {
              try {
                // v5.5: 使用 addDeckToChunk 添加牌组（支持多牌组）
                for (const chunkId of selectedIds) {
                  await irStorageService!.addDeckToChunk(chunkId, deck.id);
                }
                await loadIRContentCards();
                showNotification(`已将 ${selectedIds.length} 个内容块添加到"${deck.name}"`, 'success');
              } catch (error) {
                logger.error('[IR] 添加到牌组失败:', error);
                showNotification('添加到牌组失败', 'error');
              }
            });
          });
        }
      });
      
      // 移动到牌组（替换现有牌组）
      menu.addItem((item) => {
        item.setTitle('移动到牌组（替换）');
        item.setIcon('folder-input');
        const subMenu = (item as any).setSubmenu();
        
        for (const deck of validDecks) {
          subMenu.addItem((subItem: any) => {
            subItem.setTitle(deck.name);
            subItem.setIcon('folder');
            subItem.onClick(async () => {
              try {
                // v5.5: 使用 updateChunkDecks 替换牌组
                for (const chunkId of selectedIds) {
                  await irStorageService!.updateChunkDecks(chunkId, [deck.id]);
                }
                await loadIRContentCards();
                showNotification(`已将 ${selectedIds.length} 个内容块移动到"${deck.name}"`, 'success');
              } catch (error) {
                logger.error('[IR] 移动到牌组失败:', error);
                showNotification('移动到牌组失败', 'error');
              }
            });
          });
        }
      });
      
      // 从牌组移除
      menu.addItem((item) => {
        item.setTitle('从牌组移除');
        item.setIcon('folder-minus');
        const subMenu = (item as any).setSubmenu();
        
        for (const deck of validDecks) {
          subMenu.addItem((subItem: any) => {
            subItem.setTitle(deck.name);
            subItem.setIcon('folder');
            subItem.onClick(async () => {
              try {
                for (const chunkId of selectedIds) {
                  await irStorageService!.removeDeckFromChunk(chunkId, deck.id);
                }
                await loadIRContentCards();
                showNotification(`已从"${deck.name}"移除 ${selectedIds.length} 个内容块`, 'success');
              } catch (error) {
                logger.error('[IR] 从牌组移除失败:', error);
                showNotification('从牌组移除失败', 'error');
              }
            });
          });
        }
      });
    } else {
      menu.addItem((item) => {
        item.setTitle('暂无牌组（请先在增量阅读界面创建）');
        item.setIcon('info');
        item.setDisabled(true);
      });
    }
    
    // 清空所有牌组
    menu.addSeparator();
    menu.addItem((item) => {
      item.setTitle('清空所有牌组');
      item.setIcon('x');
      item.onClick(async () => {
        try {
          for (const chunkId of selectedIds) {
            await irStorageService!.updateChunkDecks(chunkId, []);
          }
          await loadIRContentCards();
          showNotification(`已清空 ${selectedIds.length} 个内容块的牌组`, 'success');
        } catch (error) {
          logger.error('[IR] 清空牌组失败:', error);
          showNotification('操作失败', 'error');
        }
      });
    });
    
    menu.showAtMouseEvent(event);
  }

  // 🆕 格式化正确率显示
  function formatAccuracy(card: Card): string {
    const stats = questionBankStats.get(card.uuid);
    if (!stats) return '-';
    
    const percent = Math.round(stats.accuracy * 100);
    return `${percent}%`;
  }
  
  // 🆕 获取正确率颜色类
  function getAccuracyColorClass(card: Card): string {
    const stats = questionBankStats.get(card.uuid);
    if (!stats) return '';
    
    const percent = Math.round(stats.accuracy * 100);
    if (percent >= 80) return 'accuracy-high';
    if (percent >= 60) return 'accuracy-medium';
    return 'accuracy-low';
  }
  
  // 🆕 格式化错题等级
  function formatErrorLevel(card: Card): string {
    const stats = questionBankStats.get(card.uuid);
    if (!stats || !stats.isInErrorBook) return '-';
    
    const incorrectCount = stats.incorrectAttempts;
    if (incorrectCount >= 5) return '🔴 高频';
    if (incorrectCount >= 3) return '🟡 常见';
    return '🟢 轻度';
  }
  
  // 🆕 格式化相对时间
  function formatRelativeTime(dateString: string): string {
    const date = new Date(dateString);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) return `${days}天前`;
    if (hours > 0) return `${hours}小时前`;
    if (minutes > 0) return `${minutes}分钟前`;
    return '刚刚';
  }

  // 新建卡片
  function handleCreateCard() {
    plugin.openCreateCardModal(); // 使用复用的CardEditModal
  }


  // 编辑卡片 - 使用全局编辑器
  function handleEditCard(cardUuid: string) {
    handleTempFileEditCard(cardUuid);
  }

  // 删除卡片（并清理源文档中的 Weave 元数据与块锚点）
  async function handleDeleteCard(cardUuid: string) {
    logger.debug('[WeaveCardManagement] 删除单个卡片:', cardUuid, '数据源:', dataSource);
    
    // 🎯 根据数据源选择正确的卡片数据
    const sourceCards = currentSourceCards;
    const cardToDelete = sourceCards.find(c => c.uuid === cardUuid);
    if (!cardToDelete) {
      logger.error('[WeaveCardManagement] 未找到要删除的卡片:', cardUuid, '数据源:', dataSource);
      return;
    }

    const frontContent = getCardContentBySide(cardToDelete, 'front', [], " / ");
    // ✅ 使用 Obsidian Modal 代替 confirm()，避免焦点劫持问题
    const confirmed = await showObsidianConfirm(
      plugin.app,
      `确定要删除卡片 "${frontContent}" 吗？`,
      { title: '确认删除', confirmText: '删除' }
    );
    if (!confirmed) return;

    try {
      if (dataSource === 'questionBank') {
        // 🎯 考试牌组模式：从题库中删除单个题目
        if (!questionBankStorage) {
          showNotification("题库存储服务未初始化", "error");
          return;
        }

        const bankId = cardToDelete.deckId || '';
        if (!plugin.questionBankService) {
          showNotification("题库服务未初始化", "error");
          return;
        }

        await plugin.questionBankService.deleteQuestion(bankId, cardUuid);
        
        // 4. 重新加载题库数据
        await loadQuestionBankCards();
        
        logger.debug(`成功从题库 ${bankId} 删除卡片 ${cardUuid}`);
      } else if (dataSource === 'incremental-reading') {
        // 🎯 增量阅读模式：从IR存储中删除
        irContentCards = irContentCards.filter(c => c.uuid !== cardUuid);
        
        if (!irStorageService) {
          irStorageService = new IRStorageService(plugin.app);
          await irStorageService.initialize();
        }
        
        if (isPdfBookmarkTaskId(cardUuid)) {
          // PDF书签任务：从 pdf-bookmark-tasks.json 删除
          const pdfService = new IRPdfBookmarkTaskService(plugin.app);
          await pdfService.initialize();
          await pdfService.deleteTask(cardUuid);
          logger.debug(`[IR] 已删除PDF书签任务: ${cardUuid}`);
        } else if (cardToDelete.metadata?.irChunk) {
          // 新版 chunk：从 chunks.json 删除
          await irStorageService.deleteChunkData(cardUuid);
          logger.debug(`[IR] 已删除chunk: ${cardUuid}`);
        } else if (cardToDelete.metadata?.irBlock) {
          // 旧版 block：从 blocks.json 删除
          await irStorageService.deleteBlock(cardUuid);
          logger.debug(`[IR] 已删除旧版block: ${cardUuid}`);
        }
        
        // 后台重新加载确保一致性
        loadIRContentCards().catch(err => {
          logger.error('[IR] 重新加载失败:', err);
        });
      } else {
        // 记忆牌组模式：使用记忆存储删除
        // 1️⃣ 立即从UI中移除（乐观更新）
        cards = cards.filter(c => c.uuid !== cardUuid);
        
        // 修复：移除 tick()，避免强制同步刷新导致 reconciliation 错误
        // 乐观更新后让 Svelte 自然处理 DOM 更新即可
        
        // 2️⃣ 删除卡片数据
        await dataStorage.deleteCard(cardUuid);
        
        // 4️⃣ 后台重新加载（确保数据一致性）
        loadCards().catch(err => {
          logger.error('重新加载卡片失败:', err);
        });
      }
      
      // 通知全局侧边栏刷新
      plugin.app.workspace.trigger('Weave:data-changed');
      
      showNotification('卡片已删除', 'success');
      
    } catch (error) {
      // 删除失败，重新加载数据恢复状态
      logger.error('删除卡片失败:', error);
      if (dataSource === 'questionBank') {
        await loadQuestionBankCards();
      } else {
        await loadCards();
      }
      showNotification('删除失败，请重试', 'error');
    }
  }

  // handleCloseCardEditor 已移除，统一使用临时文件编辑器

  // 临时文件编辑卡片 - 改为使用全局方法
  function handleTempFileEditCard(cardId: string) {
    logger.debug('[WeaveCardManagementPage] 开始全局编辑:', cardId, '数据源:', dataSource);

    // 🚀 性能优化：清理该卡片的缓存，确保编辑后显示最新内容
    for (const [key] of contentCache) {
      if (key.startsWith(cardId)) {
        contentCache.delete(key);
      }
    }

    // 🎯 根据数据源选择正确的卡片数据
    const sourceCards = currentSourceCards;
    const cardToEdit = sourceCards.find(c => c.uuid === cardId);
    
    if (cardToEdit) {
      // 🆕 IR内容块特殊处理：跳转到源文件进行编辑
      if (dataSource === 'incremental-reading') {
        // PDF 书签：打开 PDF 链接
        if (cardToEdit.metadata?.irPdfBookmark) {
          const link = cardToEdit.metadata.link as string;
          const pdfPath = cardToEdit.metadata.pdfPath as string;
          if (link) {
            const contextPath = plugin.app.workspace.getActiveFile()?.path ?? '';
            plugin.app.workspace.openLinkText(link, contextPath, false);
          } else if (pdfPath) {
            const contextPath = plugin.app.workspace.getActiveFile()?.path ?? '';
            plugin.app.workspace.openLinkText(pdfPath, contextPath, false);
          } else {
            showNotification('PDF书签链接不存在', 'error');
          }
          return;
        }
        
        // 新版 IRChunk：直接打开 chunk 对应的 md 文件
        if (cardToEdit.metadata?.irChunk && cardToEdit.sourceFile) {
          const file = plugin.app.vault.getAbstractFileByPath(cardToEdit.sourceFile);
          if (file && file instanceof TFile) {
            const contextPath = plugin.app.workspace.getActiveFile()?.path ?? '';
            plugin.app.workspace.openLinkText(cardToEdit.sourceFile, contextPath, false);
            return;
          } else {
            showNotification('源文件不存在', 'error');
            return;
          }
        }
        
        // 旧版 IRBlock：打开源文件并定位到对应行
        if (cardToEdit.metadata?.irBlock) {
          const block = irBlocks[cardId];
          if (block && block.filePath) {
            const file = plugin.app.vault.getAbstractFileByPath(block.filePath);
            if (file && file instanceof TFile) {
              const contextPath = plugin.app.workspace.getActiveFile()?.path ?? '';
              plugin.app.workspace.openLinkText(block.filePath, contextPath, false).then(() => {
                const leaf = plugin.app.workspace.getActiveViewOfType(MarkdownView);
                if (leaf && block.startLine) {
                  const editor = leaf.editor;
                  editor.setCursor({ line: block.startLine - 1, ch: 0 });
                  editor.scrollIntoView({ from: { line: block.startLine - 1, ch: 0 }, to: { line: block.startLine - 1, ch: 0 } }, true);
                }
              });
              return;
            } else {
              showNotification('源文件不存在', 'error');
              return;
            }
          }
        }
      }
      
      // ✅ 普通卡片：立即打开模态窗，不等待（乐观UI策略）
      plugin.openEditCardModal(cardToEdit, {
        onSave: handleTempFileEditSave,
        onCancel: () => {
          logger.debug('[WeaveCardManagementPage] 编辑取消');
        }
      });
    } else {
      logger.error('[WeaveCardManagementPage] 未找到要编辑的卡片:', cardId, '数据源:', dataSource);
    }
  }

  // 临时文件编辑保存完成
  async function handleTempFileEditSave(_updatedCard: Card) {
    try {
      // ✅ 立即显示成功通知
      showNotification("卡片保存成功", "success");
      
      // ✅ 数据重新加载在后台异步执行，不阻塞模态窗关闭（类似 Obsidian 的策略）
      // - 题库模式：需要手动加载（没有 dataSyncService 订阅）
      // - 记忆牌组：依赖 dataSyncService 自动同步，避免双重加载
      if (dataSource === 'questionBank') {
        // 不使用 await，让加载在后台执行
        loadQuestionBankCards().catch((error) => {
          logger.error('后台加载题库卡片失败:', error);
          showNotification("数据同步失败，请手动刷新", "error");
        });
      }
      // 记忆牌组模式：dataSyncService 会在 300ms 后自动触发 loadCards()
      
    } catch (error) {
      logger.error('临时文件编辑保存失败:', error);
      showNotification("保存失败", "error");
    }
  }

  // 🆕 查看卡片
  function handleViewCard(cardId: string) {
    logger.debug('[WeaveCardManagement] 查看卡片:', cardId, '数据源:', dataSource);
    
    // 🎯 根据数据源选择正确的卡片数据
    const sourceCards = currentSourceCards;
    const cardToView = sourceCards.find(c => c.uuid === cardId);
    
    if (cardToView) {
      // ✅ 使用全局模态窗，支持在其他标签页上方显示
      plugin.openViewCardModal(cardToView, {
        allDecks: currentDataSourceDecks
      });
    } else {
      logger.error('[WeaveCardManagement] 未找到要查看的卡片:', cardId, '数据源:', dataSource);
    }
  }

  // 🆕 处理标签更新
  async function handleTagsUpdate(cardId: string, tags: string[]) {
    logger.debug('[WeaveCardManagement] 更新卡片标签:', cardId, tags, '数据源:', dataSource);
    
    // 🎯 根据数据源选择正确的卡片数据
    const sourceCards = currentSourceCards;
    const cardToUpdate = sourceCards.find(c => c.uuid === cardId);
    
    if (!cardToUpdate) {
      logger.error('[WeaveCardManagement] 未找到要更新标签的卡片:', cardId, '数据源:', dataSource);
      showNotification("卡片数据不存在", "error");
      return;
    }

    try {
      if (dataSource === 'questionBank') {
        // 🎯 考试牌组模式：更新题库中的卡片标签
        if (!questionBankStorage) {
          showNotification("题库存储服务未初始化", "error");
          return;
        }

        const { setCardProperty } = await import('../../utils/yaml-utils');
        const updatedCard = {
          ...cardToUpdate,
          content: setCardProperty(cardToUpdate.content || '', 'tags', tags),
          tags,
          modified: new Date().toISOString(),
        };

        await dataStorage.updateCard(updatedCard);
        await loadQuestionBankCards();
        
        // 🔧 修复：递增数据版本号，强制触发UI更新
        dataVersion++;
        logger.debug('[WeaveCardManagement] 数据版本更新(题库):', dataVersion);
      } else if (dataSource === 'incremental-reading') {
        // 🎯 增量阅读模式：更新IR存储中的标签（不走dataStorage）
        if (!irStorageService) {
          irStorageService = new IRStorageService(plugin.app);
          await irStorageService.initialize();
        }
        
        if (isPdfBookmarkTaskId(cardId)) {
          const pdfService = new IRPdfBookmarkTaskService(plugin.app);
          await pdfService.initialize();
          await pdfService.updateTask(cardId, { tags });
        } else if (cardToUpdate.metadata?.irChunk) {
          // chunk：更新 chunks.json 中的标签（通过文件YAML）
          const chunkData = await irStorageService.getAllChunkData();
          const chunk = chunkData[cardId];
          if (chunk?.filePath) {
            const { setCardProperty } = await import('../../utils/yaml-utils');
            const adapter = plugin.app.vault.adapter;
            if (await adapter.exists(chunk.filePath)) {
              let content = await adapter.read(chunk.filePath);
              content = setCardProperty(content, 'tags', tags);
              await adapter.write(chunk.filePath, content);
            }
          }
        } else if (cardToUpdate.metadata?.irBlock) {
          const allBlocks = await irStorageService.getAllBlocks();
          const block = allBlocks[cardId];
          if (block) {
            block.tags = tags;
            await irStorageService.saveBlock(block);
          }
        }
        
        // 更新本地数组
        irContentCards = irContentCards.map(c => 
          c.uuid === cardId 
            ? { ...c, tags, ir_tags: tags, modified: new Date().toISOString() }
            : c
        );
        
        lastFilteredCardsKey = '';
        cachedTransformedCards = [];
        dataVersion++;
      } else {
        // 🎯 记忆牌组模式：更新卡片标签
        const { setCardProperty } = await import('../../utils/yaml-utils');
        const updatedCard = { 
          ...cardToUpdate, 
          content: setCardProperty(cardToUpdate.content || '', 'tags', tags),
          tags, 
          modified: new Date().toISOString() 
        };
        
        // 🔧 修复：先保存到数据库
        const result = await dataStorage.updateCard(updatedCard);
        
        logger.debug('[WeaveCardManagement] 数据库保存结果:', result.success);
        
        if (!result.success) {
          throw new Error(result.error || '保存失败');
        }
        
        // 🔧 修复：清理该卡片的缓存
        for (const [key] of contentCache) {
          if (key.startsWith(cardId)) {
            contentCache.delete(key);
          }
        }
        
        // 🔧 修复：清理元数据缓存，强制从新content重新提取标签
        invalidateCardCache(cardId);
        
        // 🔧 修复：清理transformedCards缓存，强制重新转换
        lastFilteredCardsKey = '';
        cachedTransformedCards = [];
        
        cards = cards.map(c => 
          c.uuid === cardId 
            ? { ...c, content: updatedCard.content, tags, modified: new Date().toISOString() }
            : c
        );
        
        // 🔧 修复：递增数据版本号，强制触发UI更新
        dataVersion++;
        logger.debug('[WeaveCardManagement] 数据版本更新:', dataVersion);
      }
      
      showNotification("标签更新成功", "success");
    } catch (error) {
      logger.error('[WeaveCardManagement] 标签更新失败:', error);
      showNotification("标签更新失败", "error");
    }
  }

  // 🆕 处理优先级更新
  async function handlePriorityUpdate(cardId: string, priority: number) {
    logger.debug('[WeaveCardManagement] 更新卡片优先级:', cardId, priority, '数据源:', dataSource);
    
    // 🎯 根据数据源选择正确的卡片数据
    const sourceCards = currentSourceCards;
    const cardToUpdate = sourceCards.find(c => c.uuid === cardId);
    
    if (!cardToUpdate) {
      logger.error('[WeaveCardManagement] 未找到要更新优先级的卡片:', cardId, '数据源:', dataSource);
      showNotification("卡片数据不存在", "error");
      return;
    }

    try {
      if (dataSource === 'questionBank') {
        // 🎯 考试牌组模式：更新题库中的卡片优先级
        if (!questionBankStorage) {
          showNotification("题库存储服务未初始化", "error");
          return;
        }

        const updatedCard = {
          ...cardToUpdate,
          priority,
          modified: new Date().toISOString(),
        };

        await dataStorage.updateCard(updatedCard);
        await loadQuestionBankCards();
      } else if (dataSource === 'incremental-reading') {
        // 🎯 增量阅读模式：更新IR存储中的优先级（不走dataStorage）
        if (!irStorageService) {
          irStorageService = new IRStorageService(plugin.app);
          await irStorageService.initialize();
        }
        
        if (isPdfBookmarkTaskId(cardId)) {
          const pdfService = new IRPdfBookmarkTaskService(plugin.app);
          await pdfService.initialize();
          await pdfService.updateTask(cardId, { priorityUi: priority, priorityEff: priority });
        } else if (cardToUpdate.metadata?.irChunk) {
          // chunk：更新 chunks.json 中的优先级
          const chunkData = await irStorageService.getAllChunkData();
          const chunk = chunkData[cardId];
          if (chunk) {
            chunk.priorityEff = priority;
            await irStorageService.saveChunkData(chunk);
          }
        } else if (cardToUpdate.metadata?.irBlock) {
          const allBlocks = await irStorageService.getAllBlocks();
          const block = allBlocks[cardId];
          if (block) {
            block.priority = priority as 1 | 2 | 3;
            await irStorageService.saveBlock(block);
          }
        }
        
        // 更新本地数组
        irContentCards = irContentCards.map(c => 
          c.uuid === cardId 
            ? { ...c, priority, ir_priority: priority, modified: new Date().toISOString() }
            : c
        );
        
        lastFilteredCardsKey = '';
        cachedTransformedCards = [];
        dataVersion++;
      } else {
        // 🎯 记忆牌组模式：更新卡片优先级
        const updatedCard = { 
          ...cardToUpdate, 
          priority, 
          modified: new Date().toISOString() 
        };
        
        await dataStorage.updateCard(updatedCard);
        
        // 🔧 修复：清理transformedCards缓存，强制重新转换
        lastFilteredCardsKey = '';
        cachedTransformedCards = [];
        
        cards = cards.map(c => 
          c.uuid === cardId 
            ? { ...c, priority, modified: new Date().toISOString() }
            : c
        );
        
        // 🔧 修复：递增数据版本号，强制触发UI更新
        dataVersion++;
      }
      
      showNotification("优先级更新成功", "success");
    } catch (error) {
      logger.error('[WeaveCardManagement] 优先级更新失败:', error);
      showNotification("优先级更新失败", "error");
    }
  }

  // 🆕 关闭查看卡片模态窗（全局方法）
  function handleCloseViewCardModal() {
    // 通过plugin关闭当前的查看卡片模态窗
    if ((plugin as any).currentViewCardModal) {
      const modal = (plugin as any).currentViewCardModal;
      modal.close?.();
    }
  }

  // 🆕 从查看模态窗跳转到编辑
  function handleViewCardEdit(card: Card) {
    // 关闭查看模态窗
    handleCloseViewCardModal();
    // 打开编辑模态窗
    handleTempFileEditCard(card.uuid);
  }

  // 🆕 从查看模态窗删除卡片
  async function handleViewCardDelete(cardId: string) {
    // 关闭查看模态窗
    handleCloseViewCardModal();
    // 执行删除
    await handleDeleteCard(cardId);
  }

  // 新建卡片相关方法已移除

  // handleBatchTemplateChangeConfirm 已删除（基于弃用的字段模板系统）


  // handleBatchDeckChangeCancel 已移除（改用 Obsidian Menu API）

  // 处理批量添加标签确认
  async function handleBatchAddTags(tagsToAdd: string[]) {
    const selectedCardIds = Array.from(selectedCards);
    
    try {
      logger.debug('开始批量添加标签:', {
        tags: tagsToAdd,
        cardCount: selectedCardIds.length,
        dataSource
      });

      // 根据数据源获取要更新的卡片
      const sourceCards = currentSourceCards;
      const cardsToUpdate = sourceCards.filter(c => selectedCardIds.includes(c.uuid));

      if (dataSource === 'incremental-reading') {
        // 🎯 增量阅读模式：更新IR内容块的标签
        if (!irStorageService) {
          irStorageService = new IRStorageService(plugin.app);
          await irStorageService.initialize();
        }

        let success = 0, failed = 0;
        for (const id of selectedCardIds) {
          try {
            const block = irBlocks[id];
            if (block) {
              const currentTags = block.tags || [];
              const newTags = [...new Set([...currentTags, ...tagsToAdd])];
              const updatedBlock = { ...block, tags: newTags, updatedAt: new Date().toISOString() };
              await irStorageService.saveBlock(updatedBlock);
              success++;
            }
          } catch (error) {
            logger.error(`更新IR内容块 ${id} 标签失败:`, error);
            failed++;
          }
        }

        await loadIRContentCards();
        if (failed === 0) {
          showNotification(`✅ 成功为 ${success} 个内容块添加标签`, "success");
        } else {
          showNotification(`⚠️ 添加完成：成功 ${success} 个，失败 ${failed} 个`, "warning");
        }
      } else if (dataSource === 'questionBank') {
        // 考试牌组模式：手动更新每个题库
        if (!questionBankStorage) {
          showNotification("题库存储服务未初始化", "error");
          return;
        }

        let success = 0, failed = 0;
        const cardsByBank = new Map<string, Card[]>();
        
        // 按题库分组
        // 🆕 v2.2: 优先从 content YAML 的 we_decks 获取题库ID
        for (const card of cardsToUpdate) {
          const { primaryDeckId } = getCardDeckIds(card, questionBankDecks);
          const bankId = primaryDeckId || card.deckId || '';
          if (!cardsByBank.has(bankId)) {
            cardsByBank.set(bankId, []);
          }
          cardsByBank.get(bankId)!.push(card);
        }

        const { setCardProperty } = await import('../../utils/yaml-utils');

        for (const bankCards of cardsByBank.values()) {
          for (const c of bankCards) {
            try {
              const currentTags = c.tags || [];
              const newTags = [...new Set([...currentTags, ...tagsToAdd])];
              const updatedCard = {
                ...c,
                content: setCardProperty(c.content || '', 'tags', newTags),
                tags: newTags,
                modified: new Date().toISOString(),
              };
              await dataStorage.updateCard(updatedCard);
              success++;
            } catch (error) {
              logger.error(`更新题库卡片 ${c.uuid} 失败:`, error);
              failed++;
            }
          }
        }

        // 重新加载题库数据
        await loadQuestionBankCards();

        // 显示结果
        if (failed === 0) {
          showNotification(`✅ 成功为 ${success} 张卡片添加标签`, "success");
        } else {
          showNotification(`⚠️ 添加完成：成功 ${success} 张，失败 ${failed} 张`, "warning");
        }
      } else {
        // 🎯 记忆牌组模式：使用批量操作服务
        // 🔧 v2.1 修复：直接修改 content YAML，而不是派生字段
        const { setCardProperty } = await import('../../utils/yaml-utils');
        
        const operationResult = await batchUpdateCards(
          cardsToUpdate,
          (card) => {
            // 合并标签（去重）
            const currentTags = card.tags || [];
            const newTags = [...new Set([...currentTags, ...tagsToAdd])];
            
            // ✅ 修改 content YAML（权威数据源）
            const newContent = setCardProperty(card.content || '', 'tags', newTags);
            
            return {
              ...card,
              content: newContent,
              modified: new Date().toISOString()
            };
          },
          dataStorage
        );

        // 刷新数据
        await loadCards();

        // 显示结果通知
        if (operationResult.failed === 0) {
          showNotification(
            `✅ 成功为 ${operationResult.success} 张卡片添加标签`,
            "success"
          );
        } else {
          showNotification(
            `⚠️ 添加完成：成功 ${operationResult.success} 张，失败 ${operationResult.failed} 张`,
            "warning"
          );
          logger.error('[BatchAddTags] 失败详情:', operationResult.errors);
        }
      }

    } catch (error) {
      logger.error('批量添加标签失败:', error);
      showNotification("❌ 批量添加标签失败", "error");
    }
  }

  // handleBatchAddTagsCancel 已移除（改用 Obsidian Menu API）

  // 处理批量删除标签确认
  async function handleBatchRemoveTagsConfirm(tagsToRemove: string[]) {
    const selectedCardIds = Array.from(selectedCards);

    try {
      logger.debug('🔄 开始批量删除标签:', {
        tags: tagsToRemove,
        cardCount: selectedCardIds.length,
        dataSource
      });

      // 🎯 根据数据源获取要更新的卡片
      const sourceCards = currentSourceCards;
      const cardsToUpdate = sourceCards.filter(c => selectedCardIds.includes(c.uuid));

      if (dataSource === 'incremental-reading') {
        // 🎯 增量阅读模式：更新IR内容块的标签
        if (!irStorageService) {
          irStorageService = new IRStorageService(plugin.app);
          await irStorageService.initialize();
        }

        let success = 0, failed = 0;
        for (const id of selectedCardIds) {
          try {
            const block = irBlocks[id];
            if (block) {
              const currentTags = block.tags || [];
              const newTags = currentTags.filter(tag => !tagsToRemove.includes(tag));
              const updatedBlock = { ...block, tags: newTags, updatedAt: new Date().toISOString() };
              await irStorageService.saveBlock(updatedBlock);
              success++;
            }
          } catch (error) {
            logger.error(`更新IR内容块 ${id} 标签失败:`, error);
            failed++;
          }
        }

        await loadIRContentCards();
        if (failed === 0) {
          showNotification(`✅ 成功从 ${success} 个内容块中删除标签`, "success");
        } else {
          showNotification(`⚠️ 删除完成：成功 ${success} 个，失败 ${failed} 个`, "warning");
        }
      } else if (dataSource === 'questionBank') {
        // 🎯 考试牌组模式：手动更新每个题库
        if (!questionBankStorage) {
          showNotification("题库存储服务未初始化", "error");
          return;
        }

        let success = 0, failed = 0;
        const cardsByBank = new Map<string, Card[]>();
        
        // 按题库分组
        // 🆕 v2.2: 优先从 content YAML 的 we_decks 获取题库ID
        for (const card of cardsToUpdate) {
          const { primaryDeckId } = getCardDeckIds(card, questionBankDecks);
          const bankId = primaryDeckId || card.deckId || '';
          if (!cardsByBank.has(bankId)) {
            cardsByBank.set(bankId, []);
          }
          cardsByBank.get(bankId)!.push(card);
        }

        const { setCardProperty } = await import('../../utils/yaml-utils');

        for (const bankCards of cardsByBank.values()) {
          for (const c of bankCards) {
            try {
              const currentTags = c.tags || [];
              const newTags = currentTags.filter(tag => !tagsToRemove.includes(tag));
              const updatedCard = {
                ...c,
                content: setCardProperty(c.content || '', 'tags', newTags),
                tags: newTags,
                modified: new Date().toISOString(),
              };
              await dataStorage.updateCard(updatedCard);
              success++;
            } catch (error) {
              logger.error(`更新题库卡片 ${c.uuid} 失败:`, error);
              failed++;
            }
          }
        }

        // 重新加载题库数据
        await loadQuestionBankCards();

        // 显示结果
        if (failed === 0) {
          showNotification(`✅ 成功从 ${success} 张卡片中删除标签`, "success");
        } else {
          showNotification(`⚠️ 删除完成：成功 ${success} 张，失败 ${failed} 张`, "warning");
        }
      } else {
        // 🎯 记忆牌组模式：使用批量操作服务
        // 🔧 v2.1 修复：直接修改 content YAML，而不是派生字段
        const { setCardProperty } = await import('../../utils/yaml-utils');
        
        const operationResult = await batchUpdateCards(
          cardsToUpdate,
          (card) => {
            // 过滤掉要删除的标签
            const currentTags = card.tags || [];
            const newTags = currentTags.filter(tag => !tagsToRemove.includes(tag));
            
            // ✅ 修改 content YAML（权威数据源）
            const newContent = setCardProperty(card.content || '', 'tags', newTags);
            
            return {
              ...card,
              content: newContent,
              modified: new Date().toISOString()
            };
          },
          dataStorage
        );

        // 刷新数据
        await loadCards();

        // 显示结果通知
        if (operationResult.failed === 0) {
          showNotification(
            `✅ 成功从 ${operationResult.success} 张卡片中删除标签`,
            "success"
          );
        } else {
          showNotification(
            `⚠️ 删除完成：成功 ${operationResult.success} 张，失败 ${operationResult.failed} 张`,
            "warning"
          );
          logger.error('[BatchRemoveTags] 失败详情:', operationResult.errors);
        }
      }

    } catch (error) {
      logger.error('批量删除标签失败:', error);
      showNotification("❌ 批量删除标签失败", "error");
    }
  }

  // handleBatchRemoveTagsCancel 已移除（改用 Obsidian Menu API）

  function openDataManagementModal(tab: 'data' | 'quality' = 'data') {
    dataManagementModalInstance?.close();

    showDataManagementModal = true;
    dataManagementModalInstance = new DataManagementModalObsidian(plugin.app, {
      plugin,
      cards: filteredCards,
      allCards: cards,
      initialTab: tab,
      onClose: () => {
        showDataManagementModal = false;
        dataManagementModalInstance = null;
      }
    });
    dataManagementModalInstance.open();
  }

  function closeColumnManager() {
    showColumnManager = false;
  }

  async function positionColumnManagerPopover() {
    if (!showColumnManager || isMobile) return;

    await tick();

    if (!columnManagerPanelEl) return;

    const panelWidth = Math.min(columnManagerPanelEl.offsetWidth || 560, window.innerWidth - 24);
    const panelHeight = Math.min(columnManagerPanelEl.offsetHeight || 520, window.innerHeight - 24);
    const margin = 12;
    const gap = 10;

    if (!columnManagerAnchorEl) {
      columnManagerPopoverLeft = Math.max(margin, Math.round((window.innerWidth - panelWidth) / 2));
      columnManagerPopoverTop = Math.max(72, Math.round((window.innerHeight - panelHeight) / 2));
      columnManagerPopoverPlacement = 'bottom';
      return;
    }

    const rect = columnManagerAnchorEl.getBoundingClientRect();
    const fitsBelow = rect.bottom + gap + panelHeight <= window.innerHeight - margin;

    columnManagerPopoverPlacement = fitsBelow ? 'bottom' : 'top';
    columnManagerPopoverTop = Math.round(
      fitsBelow
        ? rect.bottom + gap
        : Math.max(margin, rect.top - panelHeight - gap)
    );

    const preferredLeft = rect.right - panelWidth;
    columnManagerPopoverLeft = Math.round(
      Math.min(
        Math.max(margin, preferredLeft),
        window.innerWidth - panelWidth - margin
      )
    );
  }

  function toggleColumnManager(anchor?: HTMLElement | null) {
    if (showColumnManager) {
      closeColumnManager();
      return;
    }

    void openColumnManager(anchor);
  }

  async function openColumnManager(anchor?: HTMLElement | null) {
    columnManagerAnchorEl = anchor ?? null;
    showColumnManager = true;
    await positionColumnManagerPopover();
    columnManagerPanelEl?.focus();
  }

  // 视图切换
  async function switchView(view: 'table' | 'grid' | 'kanban') {
    if (currentView === view) {
      return;
    }

    // 检查高级功能权限
    if (view === 'grid' && !premiumGuard.canUseFeature(PREMIUM_FEATURES.GRID_VIEW)) {
      promptFeatureId = PREMIUM_FEATURES.GRID_VIEW;
      showActivationPrompt = true;
      return;
    }
    
    if (view === 'kanban' && !premiumGuard.canUseFeature(PREMIUM_FEATURES.KANBAN_VIEW)) {
      promptFeatureId = PREMIUM_FEATURES.KANBAN_VIEW;
      showActivationPrompt = true;
      return;
    }
    
    // 显示加载状态
    isViewSwitching = true;
    const startTime = Date.now();
    
    // 切换视图
    currentView = view;
    await saveViewPreferences(); // 保存视图偏好
    
    // 🆕 通知父组件状态变化（用于侧边栏导航同步）
    window.dispatchEvent(new CustomEvent('Weave:card-view-change', { detail: view }));
    
    // 等待下一帧，确保DOM已更新
    await new Promise(resolve => requestAnimationFrame(resolve));
    
    // 确保加载进度条至少显示800ms，让用户看到反馈
    const elapsed = Date.now() - startTime;
    const minDisplayTime = 800;
    if (elapsed < minDisplayTime) {
      await new Promise(resolve => setTimeout(resolve, minDisplayTime - elapsed));
    }
    
    // 隐藏加载状态
    isViewSwitching = false;
    
    // 视图切换完成
  }
  
  // 处理激活提示关闭
  function handleActivationPromptClose() {
    showActivationPrompt = false;
  }

  const modalActive = $derived(
    showBuildDeckModal ||
        showBuildIRDeckModal ||
      showDataManagementModal ||
      showActivationPrompt
  );

  $effect(() => {
    if (!showColumnManager) return;

    void positionColumnManagerPopover();

    const handleViewportChange = () => {
      void positionColumnManagerPopover();
    };

    const handleOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (columnManagerPanelEl?.contains(target)) return;
      if (columnManagerAnchorEl?.contains(target)) return;
      closeColumnManager();
    };

    const handleEscapeKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeColumnManager();
      }
    };

    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);
    window.addEventListener('pointerdown', handleOutsidePointerDown, true);
    window.addEventListener('keydown', handleEscapeKey);

    return () => {
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
      window.removeEventListener('pointerdown', handleOutsidePointerDown, true);
      window.removeEventListener('keydown', handleEscapeKey);
    };
  });

  $effect(() => {
    if (showColumnManager && currentView !== 'table') {
      closeColumnManager();
    }
  });

  // 布局切换处理
  async function handleLayoutModeChange(layout: GridLayoutMode) {
    gridLayout = layout;
    await saveViewPreferences(); // 保存视图偏好
  }

  // 表格视图模式切换处理
  async function handleTableViewModeChange(mode: 'basic' | 'review') {
    tableViewMode = mode;
    logger.debug('[TableViewMode] 模式已切换为:', mode);
    await saveViewPreferences(); // 保存视图偏好
  }

  // 🆕 移动端菜单项点击处理 - 使用 Obsidian Menu API
  function showMobileCardManagementMenu(evt: MouseEvent) {
    const menu = new Menu();
    
    // 功能切换分组
    menu.addItem((item) => {
      item
        .setTitle('牌组学习')
        .setIcon('graduation-cap')
        .onClick(() => {
          // 🔧 修复：使用 window.dispatchEvent 与 WeaveApp.svelte 的监听器匹配
          window.dispatchEvent(new CustomEvent('Weave:navigate', { 
            detail: 'deck-study' 
          }));
        });
    });
    
    menu.addItem((item) => {
      item
        .setTitle('卡片管理')
        .setIcon('list')
        .setChecked(true)
        .onClick(() => {
          // 当前页面，无需操作
        });
    });
    
    menu.addItem((item) => {
      item
        .setTitle('AI助手')
        .setIcon('bot')
        .onClick(() => {
          // 🔧 修复：使用 window.dispatchEvent 与 WeaveApp.svelte 的监听器匹配
          window.dispatchEvent(new CustomEvent('Weave:navigate', { 
            detail: 'ai-assistant' 
          }));
        });
    });
    
    menu.addSeparator();
    
    // 🆕 数据源切换子菜单（移动端）
    menu.addItem((item) => {
      item
        .setTitle('数据源切换')
        .setIcon('database');
      const submenu = (item as any).setSubmenu();
      
      submenu.addItem((subItem: any) => {
        subItem
          .setTitle('记忆牌组')
          .setIcon('brain')
          .setChecked(dataSource === 'memory')
          .onClick(async () => {
            await switchDataSource('memory');
          });
      });
      
      if (premiumGuard.shouldShowFeatureEntry(PREMIUM_FEATURES.INCREMENTAL_READING)) {
        submenu.addItem((subItem: any) => {
          const irLocked = premiumGuard.isFeatureRestricted(PREMIUM_FEATURES.INCREMENTAL_READING);
          subItem
            .setTitle(irLocked ? '增量阅读 (高级)' : '增量阅读')
            .setIcon('book-open')
            .setChecked(dataSource === 'incremental-reading')
            .onClick(async () => {
              await switchDataSource('incremental-reading');
            });
        });
      }
      
      if (premiumGuard.shouldShowFeatureEntry(PREMIUM_FEATURES.QUESTION_BANK)) {
        submenu.addItem((subItem: any) => {
          const questionBankLocked = premiumGuard.isFeatureRestricted(PREMIUM_FEATURES.QUESTION_BANK);
          subItem
            .setTitle(questionBankLocked ? '考试牌组 (高级)' : '考试牌组')
            .setIcon('edit-3')
            .setChecked(dataSource === 'questionBank')
            .onClick(async () => {
              await switchDataSource('questionBank');
            });
        });
      }
    });
    
    // 🆕 IR类型筛选子菜单（仅增量阅读数据源时显示）
    if (dataSource === 'incremental-reading') {
      menu.addItem((item) => {
        item
          .setTitle('内容类型')
          .setIcon('filter');
        const submenu = (item as any).setSubmenu();
        submenu.addItem((subItem: any) => {
          subItem
            .setTitle('MD文件')
            .setIcon('file-text')
            .setChecked(irTypeFilter === 'md')
            .onClick(() => { irTypeFilter = irTypeFilter === 'md' ? 'all' : 'md'; });
        });
        submenu.addItem((subItem: any) => {
          subItem
            .setTitle('PDF书签')
            .setIcon('file')
            .setChecked(irTypeFilter === 'pdf')
            .onClick(() => { irTypeFilter = irTypeFilter === 'pdf' ? 'all' : 'pdf'; });
        });
      });
    }
    
    menu.addSeparator();
    
    // 📱 表格视图专用功能（仅在表格视图下显示）
    if (currentView === 'table') {
      // 表格视图模式切换子菜单
      menu.addItem((item) => {
        item
          .setTitle('基础信息模式')
          .setIcon('table')
          .setChecked(tableViewMode === 'basic')
          .onClick(async () => {
            tableViewMode = 'basic';
            await saveViewPreferences();
          });
      });
      
      menu.addItem((item) => {
        item
          .setTitle('复习历史模式')
          .setIcon('history')
          .setChecked(tableViewMode === 'review')
          .onClick(async () => {
            tableViewMode = 'review';
            await saveViewPreferences();
          });
      });
      
      menu.addItem((item) => {
        item
          .setTitle('考试牌组模式')
          .setIcon('edit-3')
          .setChecked(tableViewMode === 'questionBank')
          .onClick(async () => {
            tableViewMode = 'questionBank';
            await saveViewPreferences();
          });
      });
      
      menu.addSeparator();
      
      menu.addItem((item) => {
        item
          .setTitle('字段管理')
          .setIcon('columns')
          .onClick(() => {
            openColumnManager();
          });
      });
    }
    
    // 📱 网格视图专用功能（仅在网格视图下显示）
    if (currentView === 'grid') {
      menu.addItem((item) => {
        item
          .setTitle('固定布局')
          .setIcon('grid')
          .setChecked(gridLayout === 'fixed')
          .onClick(async () => {
            gridLayout = 'fixed';
            await saveViewPreferences();
          });
      });
      
      menu.addItem((item) => {
        item
          .setTitle('瀑布流布局')
          .setIcon('layout-grid')
          .setChecked(gridLayout === 'masonry')
          .onClick(async () => {
            await handleLayoutModeChange('masonry');
          });
      });

      menu.addItem((item) => {
        item
          .setTitle('时间线布局')
          .setIcon('history')
          .setChecked(gridLayout === 'timeline')
          .onClick(async () => {
            await handleLayoutModeChange('timeline');
          });
      });
      
      menu.addSeparator();
      
      // 🆕 卡片属性显示选项 - 使用子菜单
      menu.addItem((item) => {
        const currentAttrLabel = gridCardAttribute === 'none' ? '不显示' :
          gridCardAttribute === 'uuid' ? 'UUID' :
          gridCardAttribute === 'source' ? '来源' :
          gridCardAttribute === 'priority' ? '优先级' :
          gridCardAttribute === 'retention' ? '记忆率' :
          gridCardAttribute === 'modified' ? '修改时间' : '未知';
        
        item
          .setTitle(`卡片属性：${currentAttrLabel}`)
          .setIcon('tag');
        
        const submenu = (item as any).setSubmenu();
        
        submenu.addItem((subItem: any) => {
          subItem
            .setTitle('不显示')
            .setIcon('eye-off')
            .setChecked(gridCardAttribute === 'none')
            .onClick(async () => {
              setGridCardAttribute('none');
            });
        });
        
        submenu.addItem((subItem: any) => {
          subItem
            .setTitle('UUID')
            .setIcon('hash')
            .setChecked(gridCardAttribute === 'uuid')
            .onClick(async () => {
              setGridCardAttribute('uuid');
            });
        });
        
        submenu.addItem((subItem: any) => {
          subItem
            .setTitle('来源')
            .setIcon('file-text')
            .setChecked(gridCardAttribute === 'source')
            .onClick(async () => {
              setGridCardAttribute('source');
            });
        });
        
        submenu.addItem((subItem: any) => {
          subItem
            .setTitle('优先级')
            .setIcon('flag')
            .setChecked(gridCardAttribute === 'priority')
            .onClick(async () => {
              setGridCardAttribute('priority');
            });
        });
        
        submenu.addItem((subItem: any) => {
          subItem
            .setTitle('记忆率')
            .setIcon('activity')
            .setChecked(gridCardAttribute === 'retention')
            .onClick(async () => {
              setGridCardAttribute('retention');
            });
        });
        
        submenu.addItem((subItem: any) => {
          subItem
            .setTitle('修改时间')
            .setIcon('clock')
            .setChecked(gridCardAttribute === 'modified')
            .onClick(async () => {
              setGridCardAttribute('modified');
            });
        });
      });
      
      // 📱 侧边栏专用功能：关联当前活动文档、定位跳转模式
      if (isInSidebar) {
        menu.addSeparator();
        
        menu.addItem((item) => {
          item
            .setTitle('关联当前活动文档')
            .setIcon(documentFilterMode === 'current' ? 'file-text' : 'file')
            .setChecked(documentFilterMode === 'current')
            .setDisabled(!currentActiveDocument)
            .onClick(() => {
              toggleDocumentFilter();
            });
        });
        
        menu.addItem((item) => {
          item
            .setTitle('定位跳转模式')
            .setIcon('bullseye')
            .setChecked(enableCardLocationJump)
            .onClick(async () => {
              await toggleCardLocationJump();
            });
        });
      }
    }
    
    // 📱 看板视图专用功能（仅在看板视图下显示）
    if (currentView === 'kanban') {
      menu.addItem((item) => {
        item
          .setTitle('紧凑模式')
          .setIcon('minimize-2')
          .setChecked(kanbanLayoutMode === 'compact')
          .onClick(async () => {
            await handleKanbanLayoutModeChange('compact');
          });
      });
      
      menu.addItem((item) => {
        item
          .setTitle('舒适模式')
          .setIcon('maximize-2')
          .setChecked(kanbanLayoutMode === 'comfortable')
          .onClick(async () => {
            await handleKanbanLayoutModeChange('comfortable');
          });
      });
      
      menu.addItem((item) => {
        item
          .setTitle('宽松模式')
          .setIcon('expand')
          .setChecked(kanbanLayoutMode === 'spacious')
          .onClick(async () => {
            await handleKanbanLayoutModeChange('spacious');
          });
      });
      
      menu.addSeparator();
      
      // 🆕 列属性设置入口（所有位置都显示）
      menu.addItem((item) => {
        item
          .setTitle('列属性设置')
          .setIcon('sliders')
          .onClick(() => {
            // 触发看板视图的列设置
            const kanbanView = document.querySelector('.weave-kanban-view');
            if (kanbanView) {
              const columnButton = kanbanView.querySelector('[title="列设置"]') as HTMLButtonElement;
              if (columnButton) {
                columnButton.click();
              }
            }
          });
      });
      
      // 📱 侧边栏专用功能：关联当前活动文档、定位跳转模式
      if (isInSidebar) {
        menu.addSeparator();
        
        menu.addItem((item) => {
          item
            .setTitle('关联当前活动文档')
            .setIcon(documentFilterMode === 'current' ? 'file-text' : 'file')
            .setChecked(documentFilterMode === 'current')
            .setDisabled(!currentActiveDocument)
            .onClick(() => {
              toggleDocumentFilter();
            });
        });
        
        menu.addItem((item) => {
          item
            .setTitle('定位跳转模式')
            .setIcon('bullseye')
            .setChecked(enableCardLocationJump)
            .onClick(async () => {
              await toggleCardLocationJump();
            });
        });
      }
    }
    
    menu.addSeparator();
    
    // 工具分组
    menu.addItem((item) => {
      item
        .setTitle('数据管理')
        .setIcon('database')
        .onClick(() => {
          openDataManagementModal('data');
        });
    });
    
    menu.addItem((item) => {
      item
        .setTitle('质量扫描')
        .setIcon('search')
        .onClick(() => {
          openDataManagementModal('quality');
        });
    });
    
    menu.showAtMouseEvent(evt);
  }

  // 🆕 移动端搜索按钮点击处理
  function handleMobileSearchClick() {
    showMobileSearchInput = !showMobileSearchInput;
  }

  // 看板显示密度切换处理
  async function handleKanbanLayoutModeChange(layout: "compact" | "comfortable" | "spacious") {
    kanbanLayoutMode = layout;
    await saveViewPreferences(); // 保存视图偏好
  }
  
  // 网格视图卡片点击处理（切换选中状态）
  function handleGridCardClick(card: Card) {
    // 如果启用了定位跳转模式，点击卡片跳转到源文档
    if (enableCardLocationJump) {
      jumpToSourceDocument(card);
      return;
    }
    
    // 否则执行选中/取消选中逻辑
    const newSelectedCards = new Set(selectedCards);
    if (newSelectedCards.has(card.uuid)) {
      // 已选中 - 取消选中
      newSelectedCards.delete(card.uuid);
    } else {
      // 未选中 - 选中
      newSelectedCards.add(card.uuid);
    }
    selectedCards = newSelectedCards;
  }
  
  // 🆕 网格视图卡片长按处理（移动端多选）
  function handleGridCardLongPress(card: Card) {
    // 长按触发多选：切换卡片选中状态
    const newSelectedCards = new Set(selectedCards);
    if (newSelectedCards.has(card.uuid)) {
      newSelectedCards.delete(card.uuid);
    } else {
      newSelectedCards.add(card.uuid);
    }
    selectedCards = newSelectedCards;
  }
  
  // 切换卡片定位跳转模式
  async function toggleCardLocationJump() {
    enableCardLocationJump = !enableCardLocationJump;
    await saveViewPreferences(); // 保存视图偏好
    
    // 切换到跳转模式时，清空已选中的卡片
    if (enableCardLocationJump && selectedCards.size > 0) {
      selectedCards = new Set();
      showNotification('✅ 已启用定位跳转模式\n点击卡片将跳转到源文档', 'success');
    } else if (enableCardLocationJump) {
      showNotification('✅ 已启用定位跳转模式\n点击卡片将跳转到源文档', 'success');
    } else {
      showNotification('❌ 已禁用定位跳转模式\n恢复单击选中、双击编辑功能', 'info');
    }
  }

  function openGridAttributeMenu(anchor?: HTMLElement | null) {
    const menu = new Menu();

    menu.addItem((item) => {
      item
        .setTitle('不显示')
        .setIcon('eye-off')
        .setChecked(gridCardAttribute === 'none')
        .onClick(() => {
          void setGridCardAttribute('none');
        });
    });

    menu.addItem((item) => {
      item
        .setTitle('UUID')
        .setIcon('hash')
        .setChecked(gridCardAttribute === 'uuid')
        .onClick(() => {
          void setGridCardAttribute('uuid');
        });
    });

    menu.addItem((item) => {
      item
        .setTitle('来源')
        .setIcon('file-text')
        .setChecked(gridCardAttribute === 'source')
        .onClick(() => {
          void setGridCardAttribute('source');
        });
    });

    menu.addItem((item) => {
      item
        .setTitle('优先级')
        .setIcon('flag')
        .setChecked(gridCardAttribute === 'priority')
        .onClick(() => {
          void setGridCardAttribute('priority');
        });
    });

    menu.addItem((item) => {
      item
        .setTitle('记忆率')
        .setIcon('activity')
        .setChecked(gridCardAttribute === 'retention')
        .onClick(() => {
          void setGridCardAttribute('retention');
        });
    });

    menu.addItem((item) => {
      item
        .setTitle('修改时间')
        .setIcon('clock')
        .setChecked(gridCardAttribute === 'modified')
        .onClick(() => {
          void setGridCardAttribute('modified');
        });
    });

    if (anchor) {
      const rect = anchor.getBoundingClientRect();
      menu.showAtPosition({ x: rect.left, y: rect.bottom + 4 });
      return;
    }

    menu.showAtPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
  }
  
  async function setGridCardAttribute(attr: GridCardAttributeType) {
    gridCardAttribute = attr;
    await saveViewPreferences(); // 保存视图偏好
  }
  
  // 网格视图卡片编辑处理
  function handleGridCardEdit(card: Card) {
    handleTempFileEditCard(card.uuid);
  }
  
  // 网格视图卡片删除处理
  function handleGridCardDelete(card: Card) {
    handleDeleteCard(card.uuid);
  }
  
  // 网格视图卡片查看处理
  function handleGridCardView(card: Card) {
    handleViewCard(card.uuid);
  }

  // 看板视图处理函数
  function handleKanbanCardSelect(card: Card) {
    // 打开卡片编辑器
    handleEditCard(card.uuid);
  }

  function handleKanbanStartStudy(cards: Card[]) {
    // 这里可以集成学习功能，暂时显示通知
    showNotification(`开始学习 ${cards.length} 张卡片`, "info");
  }

  // 看板视图卡片更新（包括新增和跨牌组移动）
  async function handleKanbanCardUpdate(updatedCard: Card) {
    try {
      // 🆕 v2.2: 优先从 content YAML 的 we_decks 获取牌组ID
      const currentDecks = getDecksForDataSource(dataSource);
      const existingCard = currentSourceCards.find(c => c.uuid === updatedCard.uuid);
      const { primaryDeckId: existingDeckId } = existingCard
        ? getCardDeckIds(existingCard, currentDecks)
        : { primaryDeckId: undefined };
      const { primaryDeckId: updatedDeckId } = getCardDeckIds(updatedCard, currentDecks);
      const oldDeckId = existingDeckId || existingCard?.deckId;
      const newDeckId = updatedDeckId || updatedCard.deckId;
      const isMove = existingCard && oldDeckId !== newDeckId;
      
      let result;
      if (isMove) {
        // 🔧 验证：跨牌组移动必须有有效的源和目标牌组
        if (!oldDeckId || !newDeckId) {
          showNotification('无法移动：卡片必须属于一个有效的牌组', 'error');
          logger.warn(`[KanbanCardUpdate] 跨牌组移动失败: 源=${oldDeckId}, 目标=${newDeckId}`);
          return;
        }
        
        // 🔧 使用安全的跨牌组移动方法
        result = await dataStorage.moveCardToDeck(
          updatedCard.uuid,
          oldDeckId,
          newDeckId
        );
        if (result.success) {
          showNotification('卡片已移动到新牌组', 'success');
        }
      } else {
        // 普通保存（优先级等属性更新）
        // 🔧 确保卡片有有效的deckId
        if (!updatedCard.deckId) {
          showNotification('无法保存：卡片必须属于一个牌组', 'error');
          return;
        }
        result = await dataStorage.saveCard(updatedCard);
        if (result.success) {
          const index = cards.findIndex(c => c.uuid === updatedCard.uuid);
          if (index !== -1) {
            showNotification('卡片已更新', 'success');
          } else {
            showNotification('卡片已创建', 'success');
          }
        }
      }
      
      if (!result.success) {
        throw new Error(result.error || '保存失败');
      }
      
      // 更新本地状态
      const index = cards.findIndex(c => c.uuid === updatedCard.uuid);
      if (index !== -1) {
        cards[index] = result.data || updatedCard;
        cards = [...cards];
      } else {
        cards = [...cards, result.data || updatedCard];
      }
    } catch (error) {
      logger.error('保存卡片失败:', error);
      showNotification(`保存卡片失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
      // 重新加载数据以恢复状态
      await loadCards();
    }
  }

  // 看板视图卡片删除
  async function handleKanbanCardDelete(cardId: string) {
    try {
      // 确认删除
      const cardToDelete = cards.find(c => c.uuid === cardId);
      if (!cardToDelete) return;
      
      const frontContent = getCardContentBySide(cardToDelete, 'front', [], " / ");
      // ✅ 使用 Obsidian Modal 代替 confirm()，避免焦点劫持问题
      const confirmed = await showObsidianConfirm(
        plugin.app,
        `确定要删除卡片 "${frontContent}" 吗？`,
        { title: '确认删除', confirmText: '删除' }
      );
      if (!confirmed) return;
      
      // 删除卡片
      await dataStorage.deleteCard(cardId);
      
      // 更新本地状态
      cards = cards.filter(c => c.uuid !== cardId);
      
      // 通知全局侧边栏刷新
      plugin.app.workspace.trigger('Weave:data-changed');
      
      // 延迟显示通知，避免覆盖清理通知
      setTimeout(() => {
        showNotification('卡片已删除', 'success');
      }, 1000);
    } catch (error) {
      logger.error('删除卡片失败:', error);
      showNotification('删除卡片失败', 'error');
      // 重新加载数据以恢复状态
      await loadCards();
    }
  }


</script>

<div class="weave-card-management-page" class:is-table-view={currentView === 'table'}>
  
  <!-- 加载动画 - 全屏显示 -->
  {#if isLoading || isViewSwitching}
    <div class="initial-loading-overlay">
      <BouncingBallsLoader 
        message={isLoading 
          ? "正在加载卡片数据..." 
          : currentView === 'grid' 
            ? (gridLayout === 'timeline' ? '正在加载时间线视图...' : '正在加载网格视图...') 
            : currentView === 'kanban' 
              ? '正在加载看板视图...' 
              : '正在加载表格视图...'
        } 
      />
    </div>
  {:else}
    <!-- 🆕 移动端头部（仅在移动端显示） -->
    <MobileCardManagementHeader
      {currentView}
      onMenuClick={showMobileCardManagementMenu}
      onSearchClick={handleMobileSearchClick}
      onViewChange={switchView}
    />
    
    <!-- 📱 移动端导航菜单已改用 Obsidian Menu API，不再使用 MobileCardManagementMenu 组件 -->
    
    <!-- 🆕 移动端搜索输入框 -->
    {#if showMobileSearchInput}
      <div class="mobile-search-container">
        <CardSearchInput
          bind:value={searchQuery}
          placeholder="搜索卡片..."
          onSearch={handleSearch}
          onClear={() => {
            handleClearSearch();
            showMobileSearchInput = false;
          }}
          onSort={handleSort}
          app={plugin.app}
          dataSource={dataSource}
          availableDecks={searchAvailableDecks}
          availableTags={searchAvailableTags}
          availablePriorities={searchAvailablePriorities}
          availableQuestionTypes={searchAvailableQuestionTypes}
          availableSources={searchAvailableSources}
          availableStatuses={searchAvailableStatuses}
          availableStates={searchAvailableIRStates}
          availableAccuracies={searchAvailableAccuracies}
          availableAttemptThresholds={searchAvailableAttemptThresholds}
          availableErrorLevels={searchAvailableErrorLevels}
          availableYamlKeys={searchAvailableYamlKeys}
          matchCount={searchQuery ? totalFilteredItems : -1}
          totalCount={searchSourceCards.length}
          sortField={sortConfig.field}
          sortDirection={sortConfig.direction}
        />
      </div>
    {/if}
    
  <!-- 批量操作工具栏 -->
  <WeaveBatchToolbar
    selectedCount={selectedCards.size}
    visible={selectedCards.size > 0 && !modalActive}
    app={plugin.app}
    {dataSource}
    onBatchChangeDeck={dataSource === 'memory' ? handleBatchChangeDeck : undefined}
    onBatchTagsMenu={handleBatchTagsMenu}
    onBatchDelete={handleBatchDelete}
    onClearSelection={handleClearSelection}
    onBuildDeck={dataSource === 'memory' ? handleBuildDeck : undefined}
    onBuildIRDeck={dataSource === 'incremental-reading' ? handleBuildIRDeck : undefined}
    onIRChangeDeck={dataSource === 'incremental-reading' ? handleIRBatchChangeDeck : undefined}
    onIRToggleFavorite={dataSource === 'incremental-reading' ? handleIRBatchToggleFavorite : undefined}
    {isMobile}
  />

    <!-- 主体容器 -->
    <div class="content-container">
      <!-- 主内容区域 -->
      <main class="main-content">
        <!-- 🆕 文档筛选状态指示器 -->
        {#if documentFilterMode === 'current' && currentActiveDocument}
          <div class="filter-status-bar" class:mobile={isMobile}>
            <div class="status-content">
              <span class="doc-name">{getFileName(currentActiveDocument)}</span>
            </div>
            <button 
              class="clear-filter-btn"
              onclick={() => documentFilterMode = 'all'}
              title="显示全部"
              aria-label="显示全部"
            >
              <EnhancedIcon name="x" size={14} />
            </button>
          </div>
        {/if}
      
      <!-- 🆕 全局筛选清除按钮 - 移动端简化显示 -->
      {#if hasActiveGlobalFilters}
        <div class="filter-status-bar global-filters" class:mobile={isMobile}>
          <div class="status-content">
            {#if isMobile}
              <!-- 📱 移动端：仅显示筛选图标和数量 -->
              <EnhancedIcon name="filter" size={14} />
              {#if customCardIdsFilter && customCardIdsFilter.size > 0}
                <span class="filter-count">{customCardIdsFilter.size}</span>
              {:else}
                {@const filterCount = (globalSelectedDeckId ? 1 : 0) + 
                  (globalSelectedCardTypes.size > 0 ? 1 : 0) + 
                  (globalSelectedPriority !== null ? 1 : 0) + 
                  (globalSelectedTags.size > 0 ? 1 : 0) + 
                  (globalSelectedTimeFilter ? 1 : 0)}
                <span class="filter-count">{filterCount}</span>
              {/if}
            {:else}
              <!-- 🖥️ 桌面端：显示详细筛选条件 -->
              {#if customCardIdsFilter && customCardIdsFilter.size > 0}
                <span class="filter-title">{customFilterName}</span>
              {:else}
                <span>已应用筛选条件</span>
              {/if}
              {#if globalSelectedDeckId}
                <span class="filter-badge">牌组</span>
              {/if}
              {#if globalSelectedCardTypes.size > 0}
                <span class="filter-badge">题型 ({globalSelectedCardTypes.size})</span>
              {/if}
              {#if globalSelectedPriority !== null}
                <span class="filter-badge">优先级</span>
              {/if}
              {#if globalSelectedTags.size > 0}
                <span class="filter-badge">标签 ({globalSelectedTags.size})</span>
              {/if}
              {#if globalSelectedTimeFilter}
                <span class="filter-badge">时间</span>
              {/if}
              {#if customCardIdsFilter && customCardIdsFilter.size > 0}
                <span class="filter-badge custom-id-filter">
                  <EnhancedIcon name="grid" size={12} />
                  {customCardIdsFilter.size} 张卡片
                </span>
              {/if}
            {/if}
          </div>
          <button 
            class="clear-filter-btn"
            onclick={clearGlobalFilters}
            title="清除所有筛选"
            aria-label="清除筛选"
          >
            <EnhancedIcon name="x" size={14} />
            {#if !isMobile}
              清除筛选
            {/if}
          </button>
          </div>
        {/if}
        
        {#if currentView === "table"}
        <div class="table-view-wrapper">
          <WeaveCardTable
            cards={transformedCards}
            {selectedCards}
            columnVisibility={columnVisibility}
            columnOrder={columnOrder}
            tableViewMode={tableViewMode}
            onCardSelect={(cardId, selected) => handleCardSelect(cardId, selected)}
            onSelectAll={handleSelectAll}
            onSort={(field) => handleSort(field)}
            onEdit={handleEditCard}
            onDelete={handleDeleteCard}
            onTagsUpdate={handleTagsUpdate}
            onPriorityUpdate={handlePriorityUpdate}
            onTempFileEdit={handleTempFileEditCard}
            onView={handleViewCard}
            onJumpToSource={jumpToSourceDocument}
            {sortConfig}
            {isSorting}
            loading={isLoading}
            fieldTemplates={[]}
            availableTags={availableTags.map(t => t.name)}
            {plugin}
            decks={currentDataSourceDecks}
            isVisible={isViewVisible}
          />
          
          <!-- 排序加载遮罩 -->
          <TableSortingOverlay show={isSorting} />
        </div>
        <TablePagination
          {currentPage}
          totalItems={totalFilteredItems}
          {itemsPerPage}
          onPageChange={handlePageChange}
          onItemsPerPageChange={handleItemsPerPageChange}
        />
      {:else if currentView === "grid"}
        <!-- 网格视图 -->
        {#if gridLayout === "masonry"}
          <MasonryGridView
            cards={filteredAndSortedCards}
            {selectedCards}
            {plugin}
            attributeType={gridCardAttribute}
            {isMobile}
            onCardClick={handleGridCardClick}
            onCardEdit={handleGridCardEdit}
            onCardDelete={handleGridCardDelete}
            onCardView={handleGridCardView}
            onSourceJump={jumpToSourceDocument}
            onCardLongPress={handleGridCardLongPress}
            loading={isLoading}
          />
        {:else if gridLayout === "timeline"}
          <GridTimelineView
            cards={filteredAndSortedCards}
            {selectedCards}
            {plugin}
            attributeType={gridCardAttribute}
            {isMobile}
            documentFilterMode={documentFilterMode}
            activeDocumentName={currentActiveDocument ? getFileName(currentActiveDocument) : null}
            onCardClick={handleGridCardClick}
            onCardEdit={handleGridCardEdit}
            onCardDelete={handleGridCardDelete}
            onCardView={handleGridCardView}
            onSourceJump={jumpToSourceDocument}
            onCardLongPress={handleGridCardLongPress}
            loading={isLoading}
          />
        {:else}
          <GridView
            cards={filteredAndSortedCards}
            {selectedCards}
            {plugin}
            layoutMode={gridLayout}
            attributeType={gridCardAttribute}
            {isMobile}
            onCardClick={handleGridCardClick}
            onCardEdit={handleGridCardEdit}
            onCardDelete={handleGridCardDelete}
            onCardView={handleGridCardView}
            onSourceJump={jumpToSourceDocument}
            onCardLongPress={handleGridCardLongPress}
            loading={isLoading}
          />
        {/if}
      {:else if currentView === "kanban"}
        <!-- 看板视图 -->
        <KanbanView
          cards={filteredAndSortedCards}
          {dataStorage}
          {plugin}
          decks={currentDataSourceDecks}
          {isMobile}
          onCardSelect={handleKanbanCardSelect}
          onCardUpdate={handleKanbanCardUpdate}
          onCardDelete={handleKanbanCardDelete}
          onCardView={handleViewCard}
          onStartStudy={handleKanbanStartStudy}
          groupBy={kanbanGroupBy}
          showStats={true}
          layoutMode={kanbanLayoutMode}
          attributeType={gridCardAttribute}
        />
      {/if}
      </main>
    </div>
  {/if}
</div>

  <!-- v2.0 组建牌组模态窗 -->
  {#if showBuildDeckModal}
    <BuildDeckModal
      open={showBuildDeckModal}
      {plugin}
      selectedCardUUIDs={Array.from(selectedCards)}
      pairedMemoryDeckId={globalSelectedDeckId}
      onClose={() => showBuildDeckModal = false}
      onCreated={handleBuildDeckCreated}
    />
  {/if}

  <!-- v2.0 组建增量牌组模态窗 -->
  {#if showBuildIRDeckModal}
    <BuildIRDeckModal
      open={showBuildIRDeckModal}
      {plugin}
      selectedBlockIds={Array.from(selectedCards)}
      onClose={() => showBuildIRDeckModal = false}
      onCreated={handleBuildIRDeckCreated}
    />
  {/if}
  <!-- 字段管理器（全局，支持侧边栏和完整模式） -->
  {#if showColumnManager}
    <div
      class="column-manager-popover-root"
      class:is-mobile-sheet={isMobile || !columnManagerAnchorEl}
      aria-hidden="true"
    >
      <div
        bind:this={columnManagerPanelEl}
        class="column-manager-wrapper"
        class:is-mobile-sheet={isMobile || !columnManagerAnchorEl}
        class:placement-top={columnManagerPopoverPlacement === 'top'}
        role="dialog"
        aria-label="字段管理器"
        tabindex="-1"
        style={isMobile || !columnManagerAnchorEl ? '' : `top: ${columnManagerPopoverTop}px; left: ${columnManagerPopoverLeft}px;`}
      >
        <ColumnManager
          visibility={columnVisibility}
          columnOrder={columnOrder}
          onVisibilityChange={handleVisibilityChange}
          onOrderChange={handleOrderChange}
          quickPresets={getColumnManagerPresets()}
          activePresetId={resolveCurrentColumnManagerPreset()}
          onApplyPreset={(presetId) => applyColumnManagerPreset(presetId as ColumnManagerPresetId)}
          onResetToDefaults={resetColumnManagerConfig}
        />
        <button 
          class="column-manager-close"
          onclick={() => {
            logger.debug('[字段管理] 点击关闭按钮');
            closeColumnManager();
          }}
          aria-label="关闭"
        >
          <EnhancedIcon name="x" size={20} />
        </button>
      </div>
    </div>
  {/if}
  
  <!-- 高级功能激活提示 -->
  <ActivationPrompt
    featureId={promptFeatureId}
    visible={showActivationPrompt}
    onClose={handleActivationPromptClose}
  />
  
<style>
  .weave-card-management-page {
    --weave-card-management-page-bg: var(--background-primary);
    --weave-card-management-surface-bg: var(--background-secondary);
    flex: 1;
    display: flex;
    flex-direction: column;
    background: var(--weave-card-management-page-bg);
    overflow: hidden;
    position: relative;
    height: 100%;
    min-height: 0;
  }

  .weave-card-management-page.is-table-view {
    --weave-card-management-page-bg: var(--weave-surface-background, var(--weave-surface, var(--background-primary)));
    --weave-card-management-surface-bg: var(--weave-elevated-background, var(--weave-surface-secondary, var(--background-secondary)));
  }

  /* 🔧 桌面端彩色圆点视图切换栏样式已移除 - 现在由 WeaveApp 中的 SidebarNavHeader 统一处理 */

  /* 初始加载全屏覆盖层 */
  .initial-loading-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: var(--weave-card-management-page-bg);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: var(--weave-z-top);
    animation: fadeIn 0.3s ease-in-out;
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  /* 内容区域全高度布局 */
  .content-container {
    flex: 1;
    display: flex;
    overflow: hidden;
    min-height: 0;
  }

  .main-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-height: 0;
  }

  .column-manager-popover-root {
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: var(--weave-z-overlay);
    animation: fadeIn 0.18s ease;
  }

  .column-manager-popover-root.is-mobile-sheet {
    display: flex;
    align-items: flex-end;
    justify-content: center;
    padding: 12px;
    padding-bottom: calc(12px + env(safe-area-inset-bottom, 0));
  }

  /* 字段管理器包装器 */
  .column-manager-wrapper {
    position: fixed;
    pointer-events: auto;
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 16px;
    box-shadow:
      0 24px 48px rgba(15, 23, 42, 0.18),
      0 8px 20px rgba(15, 23, 42, 0.12);
    width: min(640px, calc(100vw - 24px));
    max-height: min(76vh, 720px);
    overflow: auto;
    padding: 18px 18px 16px;
  }

  .column-manager-wrapper::before {
    content: '';
    position: absolute;
    top: -6px;
    right: 28px;
    width: 12px;
    height: 12px;
    background: var(--background-primary);
    border-top: 1px solid var(--background-modifier-border);
    border-left: 1px solid var(--background-modifier-border);
    transform: rotate(45deg);
  }

  .column-manager-wrapper.placement-top::before {
    top: auto;
    bottom: -6px;
    border-top: none;
    border-left: none;
    border-right: 1px solid var(--background-modifier-border);
    border-bottom: 1px solid var(--background-modifier-border);
  }

  .column-manager-wrapper.is-mobile-sheet {
    position: relative;
    width: min(680px, 100%);
    max-height: min(82vh, 720px);
    border-radius: 18px;
    padding: 18px 16px 16px;
  }

  .column-manager-wrapper.is-mobile-sheet::before {
    display: none;
  }
  
  /* 📱 移动端字段管理器适配 */
  @media (max-width: 600px) {
    .column-manager-popover-root {
      align-items: flex-end;
      padding: 12px;
      padding-bottom: calc(12px + env(safe-area-inset-bottom, 0));
    }

    .column-manager-wrapper {
      width: calc(100vw - 24px);
      max-height: 82vh;
    }
  }

  /* 字段管理器关闭按钮 */
  .column-manager-close {
    position: absolute;
    top: 14px;
    right: 14px;
    width: 30px;
    height: 30px;
    padding: 0;
    background: transparent;
    border: none;
    border-radius: 6px;
    color: var(--text-muted);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background-color 0.15s ease, color 0.15s ease, transform 0.15s ease;
    z-index: calc(var(--weave-z-overlay) + 1);
  }

  .column-manager-close:hover {
    background: var(--background-modifier-hover);
    color: var(--text-normal);
  }

  .column-manager-close:active {
    transform: scale(0.95);
  }

  /* 重复的样式已在上面定义 */

  /* 加载动画 */
  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
  
  /* ========== 🆕 题库专用列样式 ========== */
  
  /* 正确率颜色样式 */
  :global(.accuracy-high) {
    color: #22c55e;
    font-weight: 600;
  }
  
  :global(.accuracy-medium) {
    color: #f59e0b;
    font-weight: 600;
  }
  
  :global(.accuracy-low) {
    color: #ef4444;
    font-weight: 600;
  }

  /* 调整表格容器的边框半径 */
  :global(.weave-table-container) {
    border-radius: 0 0 var(--radius-m) var(--radius-m) !important;
    border-top: none !important;
  }

  /* ========== 🆕 文档筛选功能样式 ========== */

  /* 文档筛选控制 */
  /* 筛选状态栏 - 无底色差异 */
  .filter-status-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    background: transparent;
    font-size: var(--weave-font-size-sm);
    color: var(--weave-text-secondary);
  }

  /* 📱 移动端筛选状态栏 - 更紧凑 */
  .filter-status-bar.mobile {
    padding: 6px 12px;
    gap: 8px;
  }

  .status-content {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .doc-name {
    color: var(--weave-accent-color);
    font-weight: 500;
    font-size: 13px;
  }

  /* 📱 移动端筛选数量显示 */
  .filter-count {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    border-radius: 9px;
    font-size: 11px;
    font-weight: 600;
  }

  .clear-filter-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    background: transparent;
    border: none;
    border-radius: var(--weave-radius-sm);
    color: var(--weave-text-secondary);
    cursor: pointer;
    transition: all 0.15s ease;
    font-size: var(--weave-font-size-xs);
  }

  .clear-filter-btn:hover {
    background: var(--background-modifier-hover);
    color: var(--weave-text-primary);
  }

  .clear-filter-btn:active {
    background: var(--background-modifier-active-hover);
  }

  /* 📱 移动端清除按钮 - 仅图标 */
  .filter-status-bar.mobile .clear-filter-btn {
    padding: 6px;
    border-radius: 50%;
  }
  
  /* 🆕 筛选标记 */
  .filter-badge {
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    border-radius: 10px;
    font-size: 11px;
    font-weight: 500;
    white-space: nowrap;
  }

  /* 🆕 自定义ID筛选徽章 */
  .filter-badge.custom-id-filter {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: linear-gradient(135deg, var(--interactive-accent) 0%, var(--interactive-accent-hover) 100%);
    font-weight: 600;
  }

  /* 🆕 筛选标题（用于自定义筛选） */
  .filter-title {
    font-weight: 600;
    color: var(--interactive-accent);
  }

  /* @deprecated 当前模式指示器已移除 */
  
  .filter-status-bar.global-filters {
    background: transparent;
  }

  /* 响应式调整 */
  @media (max-width: 768px) {
    .filter-status-bar:not(.mobile) {
      flex-direction: column;
      align-items: flex-start;
      gap: var(--weave-space-xs);
    }
  }

  /* ============================================
     表格视图容器（用于排序遮罩）
     ============================================ */
  .table-view-wrapper {
    position: relative;
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--weave-card-management-page-bg);
  }

  /* ============================================
     🆕 移动端样式
     ============================================ */
  
  /* 移动端搜索容器 */
  .mobile-search-container {
    display: none;
  }

  :global(body.is-mobile) .mobile-search-container {
    display: block;
    padding: 8px 12px;
    background: var(--background-secondary);
    border-bottom: 1px solid var(--background-modifier-border);
  }

  /* 移动端内容区域底部间距 */
  :global(body.is-mobile) .weave-card-management-page .content-container {
    padding-bottom: var(--weave-mobile-content-bottom-padding, 60px);
  }

</style>


