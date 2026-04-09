<script lang="ts">
  import { logger } from '../../utils/logger';
  import { vaultStorage } from '../../utils/vault-local-storage';

  import { Menu } from 'obsidian';
  import { get } from 'svelte/store';
  import type { Deck, DeckStats } from '../../data/types';
  import type { DeckTreeNode } from '../../services/deck/DeckHierarchyService';
  import type { StudySession } from '../../data/study-types';
  import type { WeavePlugin } from '../../main';
  import DeckGridCard from './DeckGridCard.svelte';
  import ChineseElegantDeckCard from './ChineseElegantDeckCard.svelte';
  import CategoryFilter, { type DeckFilter } from './CategoryFilter.svelte';
  import { getColorSchemeForDeck } from '../../config/card-color-schemes';
// 瀵煎叆棰樺簱缁勪欢
  import QuestionBankListView from '../question-bank/QuestionBankListView.svelte';
  import QuestionBankGridView from '../question-bank/QuestionBankGridView.svelte';
  import { tr } from '../../utils/i18n';
// 鐗岀粍鍗＄墖璁捐绫诲瀷
  import type { DeckCardStyle } from '../../types/plugin-settings.d';
  //  楂樼骇鍔熻兘闄愬埗
  import { PremiumFeatureGuard, PREMIUM_FEATURES } from '../../services/premium/PremiumFeatureGuard';
  import ActivationPrompt from '../premium/ActivationPrompt.svelte';
// 渚ц竟鏍忔娴?
  interface Props {
    deckTree: DeckTreeNode[];
    deckStats: Record<string, DeckStats>;
    studySessions: StudySession[];
    plugin: WeavePlugin;
    selectedFilter?: DeckFilter;
    onFilterSelect?: (filter: DeckFilter) => void;
    onStartStudy: (deckId: string) => void;
    onContinueStudy: () => void;
    // 鑿滃崟鎿嶄綔鍥炶皟
    onAdvanceStudy?: (deckId: string) => Promise<void>;
    onOpenDeckAnalytics?: (deckId: string) => void;
    onOpenLoadForecast?: (deckId: string) => void;
    onEditDeck?: (deckId: string) => void;
    onDeleteDeck?: (deckId: string) => void;
    onRefreshData?: () => Promise<void>;
    onOpenKnowledgeGraph?: (deckId: string) => void;
    onAssociateQuestionBank?: (deckId: string) => void | Promise<void>;
    onDissolveDeck?: (deckId: string) => void;
  }

  type GridActiveFilter = 'memory' | 'question-bank' | 'incremental-reading';

  function normalizeGridFilter(filter: DeckFilter | undefined): GridActiveFilter {
    if (filter === 'question-bank' || filter === 'incremental-reading') {
      return filter;
    }

    return 'memory';
  }

  let {
    deckTree,
    deckStats,
    studySessions,
    plugin,
// 绛涢€夊櫒鐘舵€侊紙鐢辩埗缁勪欢绠＄悊锛屾敮鎸佸弻鍚戠粦瀹氾級
    selectedFilter: externalFilter = undefined,
    onFilterSelect: externalOnFilterSelect = undefined,
    onStartStudy,
    onContinueStudy,
    onAdvanceStudy,
    onOpenDeckAnalytics,
    onOpenLoadForecast,
    onEditDeck,
    onDeleteDeck,
    onRefreshData,
    onOpenKnowledgeGraph,
    onAssociateQuestionBank,
    onDissolveDeck
  }: Props = $props();

  let t = $derived($tr);

  //  楂樼骇鍔熻兘瀹堝崼
  const premiumGuard = PremiumFeatureGuard.getInstance();
  let isPremium = $state(get(premiumGuard.isPremiumActive));
  let showPremiumFeaturesPreview = $state(get(premiumGuard.premiumFeaturesPreviewEnabled));
  let showActivationPrompt = $state(false);
  let promptFeatureId = $state('');

  $effect(() => {
    const unsubscribePremium = premiumGuard.isPremiumActive.subscribe(value => {
      isPremium = value;
    });
    const unsubscribePreview = premiumGuard.premiumFeaturesPreviewEnabled.subscribe(value => {
      showPremiumFeaturesPreview = value;
    });

    return () => {
      unsubscribePremium();
      unsubscribePreview();
    };
  });

// 鑾峰彇褰撳墠鐗岀粍鍗＄墖璁捐鏍峰紡
  const deckCardStyle = $derived<DeckCardStyle>(
    (plugin.settings.deckCardStyle as DeckCardStyle) || 'default'
  );

  let internalFilter = $state<GridActiveFilter>((() => {
    try {
      return normalizeGridFilter(vaultStorage.getItem('weave-deck-mode-filter') as DeckFilter | undefined);
    } catch {}
    return 'memory';
  })());
  
  const currentFilter = $derived(normalizeGridFilter(externalFilter ?? internalFilter));

  function handleFilterSelect(filter: DeckFilter) {
    const normalizedFilter = normalizeGridFilter(filter);

    if (externalOnFilterSelect) {
      externalOnFilterSelect(filter);
    } else {
      internalFilter = normalizedFilter;
      vaultStorage.setItem('weave-deck-mode-filter', normalizedFilter);
    }
    logger.debug('[GridCardView] 切换模式筛选器:', normalizedFilter);
  }

  // 鎵佸钩鍖栫墝缁勬爲锛堜繚鎸佸眰绾х粨鏋勶級
  function flattenDeckTree(nodes: DeckTreeNode[]): Deck[] {
    const result: Deck[] = [];
    for (const node of nodes) {
      result.push(node.deck);
      if (node.children.length > 0) {
        result.push(...flattenDeckTree(node.children));
      }
    }
    return result;
  }

  const allDecks = $derived(flattenDeckTree(deckTree));

// 鏍规嵁妯″紡绛涢€夌墝缁勶紙涓?DeckStudyPage 淇濇寔涓€鑷达級
  const filteredDecks = $derived(currentFilter === 'memory' ? allDecks : []);

  // 鏄剧ず鐗岀粍鑿滃崟锛堝畬鏁寸増锛屼笌DeckStudyPage淇濇寔涓€鑷达級
  function showDeckMenu(event: MouseEvent, deckId: string) {
    const menu = new Menu();

    const deck = allDecks.find(d => d.id === deckId);
    const isSubdeck = deck?.parentId != null;

// 鎻愬墠瀛︿範鍔熻兘
    menu.addItem((item) =>
      item
        .setTitle(t('decks.menu.advanceStudy'))
        .setIcon("fast-forward")
        .onClick(async () => await onAdvanceStudy?.(deckId))
    );

    //  鐗岀粍鍒嗘瀽锛堝寘鍚礋鑽烽娴嬶級- 楂樼骇鍔熻兘
    if (premiumGuard.shouldShowFeatureEntry(PREMIUM_FEATURES.DECK_ANALYTICS, {
      isPremium,
      showPremiumPreview: showPremiumFeaturesPreview
    })) {
      menu.addItem((item) => {
        const title = isPremium ? t('decks.menu.deckAnalytics') : t('decks.menu.deckAnalytics') + ' 馃敀';
        item
          .setTitle(title)
          .setIcon("bar-chart-2")
          .onClick(() => {
            if (!isPremium) {
              promptFeatureId = PREMIUM_FEATURES.DECK_ANALYTICS;
              showActivationPrompt = true;
              return;
            }
            onOpenDeckAnalytics?.(deckId);
          });
      });
    }

    menu.addSeparator();

    menu.addItem((item) =>
      item
        .setTitle(t('decks.menu.knowledgeGraph'))
        .setIcon("git-fork")
        .onClick(() => onOpenKnowledgeGraph?.(deckId))
    );

    if (onAssociateQuestionBank) {
      menu.addItem((item) =>
        item
          .setTitle(t('decks.menu.linkQuestionBank'))
          .setIcon('link-2')
          .onClick(async () => await onAssociateQuestionBank?.(deckId))
      );
    }

    // 鍒涘缓瀛愮墝缁勫拰绉诲姩鐗岀粍鍔熻兘宸茬Щ闄?- 涓嶅啀鏀寔鐖跺瓙鐗岀粍灞傜骇缁撴瀯

    // 鐗岀粍缂栬緫
    menu.addItem((item) =>
      item
        .setTitle(t('decks.menu.editDeck'))
        .setIcon("edit")
        .onClick(() => onEditDeck?.(deckId))
    );

    // 鍒犻櫎
    menu.addItem((item) =>
      item
        .setTitle(t('decks.menu.delete'))
        .setIcon("trash-2")
        .onClick(() => onDeleteDeck?.(deckId))
    );

// 瑙ｆ暎鐗岀粍
    if (onDissolveDeck) {
      menu.addItem((item) =>
        item
          .setTitle(t('decks.menu.dissolveDeck'))
          .setIcon("unlink")
          .onClick(() => onDissolveDeck?.(deckId))
      );
    }

    menu.addSeparator();

    menu.showAtMouseEvent(event);
  }

</script>

<div class="grid-card-view">
  <!--  妗岄潰绔僵鑹插渾鐐圭瓫閫夊櫒宸茬Щ闄?- 鐜板湪鐢?WeaveApp 涓殑 SidebarNavHeader 缁熶竴澶勭悊 -->
  <!-- 渚ц竟鏍忓拰涓诲唴瀹瑰尯閮戒娇鐢?SidebarNavHeader 鎻愪緵鐨勭瓫閫夊姛鑳?-->

<!-- 鏍规嵁妯″紡鏄剧ず涓嶅悓鍐呭 -->
  {#if currentFilter === 'memory'}
    <!-- 璁板繂鐗岀粍妯″紡 -->
    {#if filteredDecks.length > 0}
      <div class="cards-grid">
        {#each filteredDecks as deck, index (deck.id)}
          {@const stats = deckStats[deck.id] || {
            newCards: 0,
            learningCards: 0,
            reviewCards: 0,
            memoryRate: 0,
            totalCards: 0,
            todayNew: 0,
            todayReview: 0,
            todayTime: 0,
            totalReviews: 0,
            totalTime: 0,
            averageEase: 0,
            forecastDays: {}
          }}
          {@const colorScheme = getColorSchemeForDeck(deck.id)}
          {@const colorVariant = ((index % 4) + 1) as 1 | 2 | 3 | 4}
          <div class="deck-card-shell">
            {#if deckCardStyle === 'chinese-elegant'}
              <ChineseElegantDeckCard
                {deck}
                {stats}
                {colorVariant}
                onStudy={() => onStartStudy(deck.id)}
                onMenu={(e) => showDeckMenu(e, deck.id)}
              />
            {:else}
              <DeckGridCard
                {deck}
                {stats}
                {colorScheme}
                onStudy={() => onStartStudy(deck.id)}
                onMenu={(e) => showDeckMenu(e, deck.id)}
              />
            {/if}
          </div>
        {/each}
      </div>
    {:else}
      <!-- 绌虹姸鎬佸崰浣嶇 -->
      <div class="mode-placeholder">
        <div class="placeholder-icon">--</div>
        <h2 class="placeholder-title">{t('decks.grid.emptyText')}</h2>
        <p class="placeholder-desc">{t('decks.grid.emptyHint')}</p>
      </div>
    {/if}
  {:else if currentFilter === 'question-bank'}
    <!-- 棰樺簱鐗岀粍妯″紡 - 缃戞牸瑙嗗浘 -->
    <QuestionBankGridView {plugin} />
  {/if}
</div>

<!--  婵€娲绘彁绀烘ā鎬佺獥 -->
{#if showActivationPrompt}
  <ActivationPrompt
    visible={showActivationPrompt}
    featureId={promptFeatureId}
    onClose={() => showActivationPrompt = false}
  />
{/if}

<style>
  .grid-card-view {
    --weave-deck-card-min-width: 320px;
    --weave-deck-grid-gap: 20px;
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    padding: var(--weave-deck-page-content-gap, 1rem);
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    overscroll-behavior-y: contain;
    background: var(--weave-deck-page-bg, var(--weave-surface-background, var(--background-primary)));
    container-type: inline-size;
    container-name: deck-grid;
    scroll-padding-bottom: 24px;
  }

  /*  妗岄潰绔僵鑹插渾鐐圭瓫閫夊櫒宸茬Щ闄?- 鐜板湪鐢?WeaveApp 涓殑 SidebarNavHeader 缁熶竴澶勭悊 */

  .cards-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, var(--weave-deck-card-min-width)), 1fr));
    gap: var(--weave-deck-grid-gap);
    padding: 8px 0;
    container-type: inline-size;
  }

  .deck-card-shell {
    min-width: 0;
    container-type: inline-size;
    container-name: deck-card;
  }

/* 妯″紡鍗犱綅绗︽牱寮?*/
  .mode-placeholder {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 400px;
    padding: 3rem 2rem;
    text-align: center;
  }

  .placeholder-icon {
    font-size: 4rem;
    margin-bottom: 1.5rem;
    opacity: 0.6;
  }

  .placeholder-title {
    font-size: 1.5rem;
    font-weight: 600;
    color: var(--text-normal);
    margin-bottom: 0.5rem;
  }

  .placeholder-desc {
    font-size: 1rem;
    color: var(--text-muted);
    max-width: 500px;
  }

  /* 鍝嶅簲寮?*/
  @container deck-grid (max-width: 1100px) {
    .grid-card-view {
      --weave-deck-card-min-width: 280px;
      --weave-deck-grid-gap: 18px;
    }
  }

  @container deck-grid (max-width: 760px) {
    .grid-card-view {
      --weave-deck-card-min-width: 100%;
      --weave-deck-grid-gap: 12px;
      padding-left: max(6px, calc(var(--weave-deck-page-content-gap, 1rem) * 0.5));
      padding-right: max(6px, calc(var(--weave-deck-page-content-gap, 1rem) * 0.5));
    }

    .cards-grid {
      padding: 4px 0;
    }

    .mode-placeholder {
      min-height: 300px;
      padding: 2rem 1rem;
    }

    .placeholder-icon {
      font-size: 3rem;
    }

    .placeholder-title {
      font-size: 1.25rem;
    }
  }

  @container deck-grid (max-width: 420px) {
    .grid-card-view {
      --weave-deck-grid-gap: 8px;
      padding-left: 4px;
      padding-right: 4px;
    }

    .cards-grid {
      padding: 2px 0;
    }
  }

  /*  Obsidian 绉诲姩绔壒瀹氭牱寮?- 鍐呭鍖鸿创杈?*/
  :global(body.is-mobile) .grid-card-view {
    padding: 8px 2px calc(88px + env(safe-area-inset-bottom, 0px)); /* 涓哄簳閮ㄦ墜鍔垮尯/娴忚鍣ㄦ爮棰勭暀绌洪棿 */
    scroll-padding-bottom: calc(88px + env(safe-area-inset-bottom, 0px));
  }

  :global(body.is-mobile) .cards-grid {
    gap: 8px; /* 馃敡 鍑忓皯鍗＄墖涔嬮棿鐨勯棿璺?*/
    padding: 4px 0;
  }

  :global(body.is-phone) .grid-card-view {
    padding: 4px 1px calc(96px + env(safe-area-inset-bottom, 0px)); /* 鎵嬫満绔鍔犲簳閮ㄦ粴鍔ㄧ紦鍐诧紝閬垮厤鏈€鍚庝竴寮犲崱琚伄浣?*/
    scroll-padding-bottom: calc(96px + env(safe-area-inset-bottom, 0px));
  }

  :global(body.is-phone) .cards-grid {
    gap: 6px; /* 馃敡 鎵嬫満绔繘涓€姝ュ噺灏戝崱鐗囬棿璺?*/
  }

  :global(body.is-mobile) .grid-card-view {
    padding-left: var(--weave-deck-page-content-gap, 1rem);
    padding-right: var(--weave-deck-page-content-gap, 1rem);
    padding-bottom: calc(128px + env(safe-area-inset-bottom, 0px));
    scroll-padding-bottom: calc(128px + env(safe-area-inset-bottom, 0px));
  }

  :global(body.is-phone) .grid-card-view {
    padding-left: var(--weave-deck-page-content-gap, 1rem);
    padding-right: var(--weave-deck-page-content-gap, 1rem);
    padding-bottom: calc(144px + env(safe-area-inset-bottom, 0px));
    scroll-padding-bottom: calc(144px + env(safe-area-inset-bottom, 0px));
  }
</style>
