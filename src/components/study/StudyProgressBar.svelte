<script lang="ts">
  import { logger } from '../../utils/logger';

  import type { Card } from '../../data/types';
  import { CardState } from '../../data/types';
  import type { WeaveDataStorage } from '../../data/storage';
  
  //  导入国际化
  import { tr } from '../../utils/i18n';

  interface Props {
    deckId: string;
    dataStorage: WeaveDataStorage;
    refreshTrigger?: number; // 用于触发刷新的计数器
    className?: string;
    //  v2.3: 可选的卡片数组，作为备用数据源（当 deckId 无法获取卡片时使用）
    cards?: Card[];
  }

  let { deckId, dataStorage, refreshTrigger = 0, className = '', cards: propCards }: Props = $props();
  
  //  响应式翻译函数
  let t = $derived($tr);

  // 牌组所有卡片数据
  let allDeckCards = $state<Card[]>([]);
  let isLoading = $state(false);

  // 加载牌组所有卡片数据
  $effect(() => {
    //  显式读取 refreshTrigger，建立响应式依赖
    const trigger = refreshTrigger;
    
    //  v2.3: 优先使用传入的 cards，如果没有则从 dataStorage 加载
    if (propCards && propCards.length > 0) {
      allDeckCards = propCards;
      isLoading = false;
      logger.debug('StudyProgressBar - Using prop cards:', propCards.length);
      return;
    }
    
    if (deckId && dataStorage) {
      const loadCards = async () => {
        try {
          isLoading = true;
          const cards = await dataStorage.getCardsByDeck(deckId);
          allDeckCards = cards;
          logger.debug('StudyProgressBar - Loaded deck cards:', cards.length, 'Trigger:', trigger);
        } catch (error) {
          logger.error('StudyProgressBar - Failed to load deck cards:', error);
          allDeckCards = [];
        } finally {
          isLoading = false;
        }
      };
      loadCards();
    }
  });

  // 牌组卡片状态分布计算（扩展为四种状态）
  let progressData = $derived(() => {
    const total = allDeckCards.length;

    if (total === 0) {
      return { newCards: 0, learning: 0, review: 0, mastered: 0, total: 0 };
    }

    const now = new Date();
    let newCards = 0;    // 新卡片
    let learning = 0;    // 学习中
    let review = 0;      // 待复习（到期）
    let mastered = 0;    // 已掌握（未到期）

    allDeckCards.forEach(card => {
      // 确保卡片有fsrs数据
      if (!card.fsrs) {
        newCards++; // 没有FSRS数据的当作新卡片
        return;
      }

      const fsrs = card.fsrs;
      const dueDate = new Date(fsrs.due);

      switch (fsrs.state) {
        case CardState.New:
          newCards++;
          break;
        case CardState.Learning:
        case CardState.Relearning:
          learning++; // 学习中状态
          break;
        case CardState.Review:
          if (dueDate <= now) {
            review++; // 到期需要复习
          } else {
            mastered++; // 已掌握未到期
          }
          break;
        default:
          newCards++; // 未知状态当作新卡片
          break;
      }
    });

    return {
      newCards,
      learning,
      review,
      mastered,
      total
    };
  });

  // 计算百分比
  let percentages = $derived(() => {
    const data = progressData();
    const { newCards, learning, review, mastered, total } = data;
    if (total === 0) return { newCards: 0, learning: 0, review: 0, mastered: 0 };

    return {
      newCards: (newCards / total) * 100,
      learning: (learning / total) * 100,
      review: (review / total) * 100,
      mastered: (mastered / total) * 100
    };
  });

  // 工具提示文本
  let tooltips = $derived(() => {
    const data = progressData();
    return {
      newCards: t('studyInterface.progress.newCards').replace('{n}', String(data.newCards)),
      learning: t('studyInterface.progress.learning').replace('{n}', String(data.learning)),
      review: t('studyInterface.progress.review').replace('{n}', String(data.review)),
      mastered: t('studyInterface.progress.mastered').replace('{n}', String(data.mastered)),
      total: t('studyInterface.progress.total').replace('{n}', String(data.total))
    };
  });

  let hasData = $derived(() => progressData().total > 0);
</script>

<div class="study-progress-container {className}">
  <div
    class="study-progress-bar"
    class:loading={isLoading}
    class:empty={!hasData()}
    title={tooltips().total}
    role="progressbar"
    aria-label={t('studyInterface.progress.ariaLabel')}
    aria-valuetext={tooltips().total}
  >
    <!-- 已掌握区域 (绿色) -->
    <div
      class="progress-segment mastered"
      style="width: {percentages().mastered}%"
      title={tooltips().mastered}
    ></div>

    <!-- 学习中区域 (黄色) -->
    <div
      class="progress-segment learning"
      style="width: {percentages().learning}%"
      title={tooltips().learning}
    ></div>

    <!-- 新卡片区域 (蓝色) -->
    <div
      class="progress-segment new"
      style="width: {percentages().newCards}%"
      title={tooltips().newCards}
    ></div>

    <!-- 待复习区域 (红色) -->
    <div
      class="progress-segment review"
      style="width: {percentages().review}%"
      title={tooltips().review}
    ></div>
  </div>
</div>

<style>
  .study-progress-container {
    display: flex;
    align-items: center;
    min-width: 0;
  }

  .study-progress-bar {
    --segment-mastered: #2f9b72;
    --segment-learning: #d1a248;
    --segment-new: #4f7fcc;
    --segment-review: #c96a5f;
    position: relative;
    width: 212px;
    height: 10px;
    background: color-mix(in srgb, var(--background-modifier-form-field) 78%, var(--background-primary) 22%);
    border-radius: 999px;
    overflow: hidden;
    transition: box-shadow 0.22s ease, border-color 0.22s ease;
    display: flex;
    border: 1px solid color-mix(in srgb, var(--background-modifier-border) 82%, transparent);
    box-shadow:
      inset 0 1px 1px rgba(255, 255, 255, 0.22),
      inset 0 -1px 1px rgba(0, 0, 0, 0.04);
    isolation: isolate;
  }

  .study-progress-bar:hover {
    border-color: color-mix(in srgb, var(--text-accent) 24%, var(--background-modifier-border));
    box-shadow:
      inset 0 1px 1px rgba(255, 255, 255, 0.2),
      inset 0 -1px 1px rgba(0, 0, 0, 0.06),
      0 0 0 2px color-mix(in srgb, var(--text-accent) 10%, transparent);
  }

  .study-progress-bar.empty::before {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(
      90deg,
      transparent 0%,
      color-mix(in srgb, var(--background-modifier-border) 22%, transparent) 48%,
      transparent 100%
    );
    opacity: 0.65;
    pointer-events: none;
    z-index: 1;
  }

  /* 加载状态 */
  .study-progress-bar.loading {
    opacity: 0.82;
    pointer-events: none;
  }

  .study-progress-bar.loading::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(
      100deg,
      transparent 10%,
      rgba(255, 255, 255, 0.3) 45%,
      transparent 80%
    );
    animation: progress-loading-sheen 1.4s linear infinite;
    pointer-events: none;
    z-index: 2;
  }

  .progress-segment {
    height: 100%;
    transition: width 0.28s ease, filter 0.22s ease;
    position: relative;
    z-index: 0;
  }

  .progress-segment + .progress-segment {
    box-shadow: inset 1px 0 0 rgba(255, 255, 255, 0.16);
  }

  .study-progress-bar:hover .progress-segment {
    filter: saturate(1.06) brightness(1.02);
  }

  .progress-segment::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(
      180deg,
      rgba(255, 255, 255, 0.22) 0%,
      rgba(255, 255, 255, 0) 65%
    );
    pointer-events: none;
  }

  .progress-segment.mastered {
    background: linear-gradient(135deg, var(--segment-mastered), color-mix(in srgb, var(--segment-mastered) 76%, #ffffff 24%));
  }

  .progress-segment.learning {
    background: linear-gradient(135deg, var(--segment-learning), color-mix(in srgb, var(--segment-learning) 78%, #ffffff 22%));
  }

  .progress-segment.new {
    background: linear-gradient(135deg, var(--segment-new), color-mix(in srgb, var(--segment-new) 78%, #ffffff 22%));
  }

  .progress-segment.review {
    background: linear-gradient(135deg, var(--segment-review), color-mix(in srgb, var(--segment-review) 76%, #ffffff 24%));
  }

  /* 响应式设计 */
  @media (max-width: 768px) {
    .study-progress-bar {
      width: 172px;
      height: 8px;
    }
  }

  /* ==================== Obsidian 移动端适配 ==================== */
  
  /* 手机端：进度条自适应宽度 */
  :global(body.is-phone) .study-progress-container {
    flex: 1;
    min-width: 0;
  }

  :global(body.is-phone) .study-progress-bar {
    width: 100%;
    min-width: 96px;
    max-width: 180px;
    height: 6px;
  }

  /* 平板端 */
  :global(body.is-tablet) .study-progress-bar {
    width: 190px;
    height: 8px;
  }

  /* 无障碍支持 */
  .study-progress-bar:focus-visible {
    outline: 2px solid var(--text-accent);
    outline-offset: 2px;
  }

  @keyframes progress-loading-sheen {
    from {
      transform: translateX(-140%);
    }
    to {
      transform: translateX(160%);
    }
  }

  :global(body.theme-dark) .study-progress-bar {
    background: color-mix(in srgb, var(--background-modifier-form-field) 72%, #161616 28%);
    border-color: color-mix(in srgb, var(--background-modifier-border) 70%, #2b2b2b 30%);
    box-shadow:
      inset 0 1px 1px rgba(255, 255, 255, 0.1),
      inset 0 -1px 1px rgba(0, 0, 0, 0.26);
  }

  :global(body.theme-dark) .study-progress-bar:hover {
    box-shadow:
      inset 0 1px 1px rgba(255, 255, 255, 0.08),
      inset 0 -1px 1px rgba(0, 0, 0, 0.28),
      0 0 0 2px color-mix(in srgb, var(--text-accent) 18%, transparent);
  }
</style>
