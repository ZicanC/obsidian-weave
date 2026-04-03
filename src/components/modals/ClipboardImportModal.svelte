<!--
  粘贴卡片批量导入模态窗
  职责：从剪贴板粘贴文本，解析为卡片并批量导入
  交互：两步向导（填写内容 -> 预览导入）
-->
<script lang="ts">
  import { logger } from '../../utils/logger';
  import { onMount } from 'svelte';
  import { Menu, Notice, type TFile } from 'obsidian';
  import EnhancedModal from '../ui/EnhancedModal.svelte';
  import ObsidianIcon from '../ui/ObsidianIcon.svelte';
  import type { WeavePlugin } from '../../main';
  import type { WeaveDataStorage } from '../../data/storage';
  import type { Deck, Card } from '../../data/types';
  import { CardType } from '../../data/types';
  import { generateCardUUID } from '../../services/identifier/WeaveIDGenerator';
  import { buildContentWithYAML } from '../../utils/yaml-utils';

  interface Props {
    open: boolean;
    plugin: WeavePlugin;
    dataStorage: WeaveDataStorage;
    onClose: () => void;
    onImportComplete?: (deckId: string, cardCount: number) => void;
    useObsidianModal?: boolean;
  }

  interface ParsedCardPreview {
    index: number;
    front: string;
    back: string;
    hasBack: boolean;
    type: CardType;
    typeName: string;
    note: string | null;
  }

  let {
    open = $bindable(),
    plugin,
    dataStorage,
    onClose,
    onImportComplete,
    useObsidianModal = false,
  }: Props = $props();

  let currentStep = $state<1 | 2>(1);

  let pasteText = $state('');
  let sourceFilePath = $state('');
  let targetDeckId = $state('');
  let isImporting = $state(false);
  let importProgress = $state(0);

  let decks = $state<Deck[]>([]);
  let parsedCards = $state<ParsedCardPreview[]>([]);
  let currentPreviewIndex = $state(0);
  let sourceFiles = $state<TFile[]>([]);
  let sourcePickerOpen = $state(false);
  let sourcePickerQuery = $state('');
  let sourcePickerButtonEl = $state<HTMLButtonElement | null>(null);
  let sourcePickerPanelEl = $state<HTMLDivElement | null>(null);
  let sourcePickerSearchEl = $state<HTMLInputElement | null>(null);
  let deckMenuButtonEl = $state<HTMLButtonElement | null>(null);
  let activeSummaryHint = $state<'stats' | 'deck' | 'source' | null>(null);

  const sourcePickerHintText = '参考 AI 制卡顶部文件列表，点击按钮后在列表中选择文件。';
  const deckPickerHintText = '点击下拉按钮，使用 Obsidian 菜单 API 选择目标牌组。';

  let detectStats = $derived.by(() => {
    if (!pasteText.trim()) {
      return { total: 0, basic: 0, choice: 0, cloze: 0 };
    }

    const cards = splitCards(pasteText);
    let basic = 0;
    let choice = 0;
    let cloze = 0;

    for (const card of cards) {
      const type = detectCardType(card);
      if (type === CardType.Basic) basic++;
      else if (type === CardType.Multiple) choice++;
      else if (type === CardType.Cloze) cloze++;
    }

    return { total: cards.length, basic, choice, cloze };
  });

  let sourceLink = $derived.by(() => {
    if (!sourceFilePath.trim()) return '';
    return `![[${sourceFilePath.replace(/\.md$/i, '')}]]`;
  });

  let filteredSourceFiles = $derived.by(() => {
    const query = sourcePickerQuery.trim().toLowerCase();
    if (!query) return sourceFiles.slice(0, 300);
    return sourceFiles
      .filter((file) => file.path.toLowerCase().includes(query))
      .slice(0, 300);
  });

  let selectedDeck = $derived.by(() => decks.find(deck => deck.id === targetDeckId) ?? null);
  let selectedDeckName = $derived.by(() => selectedDeck?.name || '未选择');
  let selectedSourceFileName = $derived.by(() => {
    if (!sourceFilePath.trim()) return '未选择文件';
    const hit = sourceFiles.find((file) => file.path === sourceFilePath);
    return hit?.name || sourceFilePath.split('/').pop() || sourceFilePath;
  });

  let canGoNext = $derived.by(() => {
    if (detectStats.total === 0) return false;
    return Boolean(targetDeckId);
  });

  let summaryStatsHintText = $derived.by(
    () => `问答 ${detectStats.basic} / 选择 ${detectStats.choice} / 挖空 ${detectStats.cloze}`
  );
  const summaryDeckHintText = '导入到已有牌组';
  const summarySourceHintText = '可选，用于后续回溯原文';

  let previewWarningCount = $derived.by(() =>
    parsedCards.filter(card => card.note !== null).length
  );

  let activePreviewCard = $derived.by(() => parsedCards[currentPreviewIndex] ?? null);
  let canPreviewPrev = $derived.by(() => parsedCards.length > 1 && currentPreviewIndex > 0);
  let canPreviewNext = $derived.by(() =>
    parsedCards.length > 1 && currentPreviewIndex < parsedCards.length - 1
  );

  $effect(() => {
    if (parsedCards.length === 0) {
      if (currentPreviewIndex !== 0) {
        currentPreviewIndex = 0;
      }
      return;
    }

    if (currentPreviewIndex < 0) {
      currentPreviewIndex = 0;
      return;
    }

    if (currentPreviewIndex >= parsedCards.length) {
      currentPreviewIndex = parsedCards.length - 1;
    }
  });

  function refreshSourceFiles() {
    sourceFiles = plugin.app.vault.getMarkdownFiles();
  }

  function formatFileSize(size: number): string {
    if (!Number.isFinite(size) || size <= 0) return '0 B';
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`;
    return `${(size / (1024 * 1024)).toFixed(size < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  }

  function toggleSourcePicker() {
    if (sourcePickerOpen) {
      sourcePickerOpen = false;
      return;
    }
    refreshSourceFiles();
    sourcePickerOpen = true;
    sourcePickerQuery = '';
    queueMicrotask(() => sourcePickerSearchEl?.focus());
  }

  function closeSourcePicker() {
    sourcePickerOpen = false;
    sourcePickerQuery = '';
  }

  function pickSourceFile(file: TFile) {
    sourceFilePath = file.path;
    closeSourcePicker();
  }

  function clearSourceFile() {
    sourceFilePath = '';
    closeSourcePicker();
  }

  function showDeckMenu(event: MouseEvent | KeyboardEvent) {
    if (!decks.length) return;

    const rect = deckMenuButtonEl?.getBoundingClientRect();
    const menu = new Menu();

    for (const deck of decks) {
      menu.addItem((item) => {
        item
          .setTitle(deck.name)
          .setIcon(deck.id === targetDeckId ? 'check-square' : 'square')
          .onClick(() => {
            targetDeckId = deck.id;
          });
      });
    }

    if (rect) {
      menu.showAtPosition({ x: rect.left, y: rect.bottom + 4 });
      return;
    }
    if ('clientX' in event && 'clientY' in event) {
      menu.showAtPosition({ x: event.clientX, y: event.clientY });
      return;
    }
    menu.showAtPosition({
      x: Math.round(Math.max(24, window.innerWidth / 2 - 120)),
      y: 84,
    });
  }

  onMount(async () => {
    try {
      decks = await dataStorage.getAllDecks();
      if (decks.length > 0) {
        targetDeckId = decks[0].id;
      }
      refreshSourceFiles();
    } catch (e) {
      logger.error('[ClipboardImport] 初始化失败:', e);
    }
  });

  $effect(() => {
    if (!sourcePickerOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (sourcePickerPanelEl?.contains(target)) return;
      if (sourcePickerButtonEl?.contains(target)) return;
      closeSourcePicker();
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeSourcePicker();
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('keydown', handleEscape, true);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('keydown', handleEscape, true);
    };
  });

  function splitCards(text: string): string[] {
    const lines = text.split('\n');
    const cards: string[] = [];
    let currentCard: string[] = [];

    for (const line of lines) {
      if (line.trim() === '<->') {
        const content = currentCard.join('\n').trim();
        if (content) {
          cards.push(content);
        }
        currentCard = [];
      } else {
        currentCard.push(line);
      }
    }

    const lastContent = currentCard.join('\n').trim();
    if (lastContent) {
      cards.push(lastContent);
    }

    return cards;
  }

  function detectCardType(content: string): CardType {
    const obsidianCloze = /==[^=]+==/g;
    const ankiCloze = /\{\{c\d+::.+?\}\}/g;
    if (obsidianCloze.test(content) || ankiCloze.test(content)) {
      return CardType.Cloze;
    }

    const labeledOptions = content.match(/^[A-Z][\.\)．）、]\s*.+$/gmi);
    if (labeledOptions && labeledOptions.length >= 2) {
      return CardType.Multiple;
    }

    return CardType.Basic;
  }

  function getCardTypeName(type: CardType): string {
    switch (type) {
      case CardType.Basic:
        return '问答';
      case CardType.Multiple:
        return '选择';
      case CardType.Cloze:
        return '挖空';
      default:
        return '未知';
    }
  }

  function splitCardFaces(content: string): { front: string; back: string; hasBack: boolean } {
    const parts = content.split(/---div---/i);
    const front = (parts[0] || '').trim();
    const back = parts.slice(1).join('\n').trim();

    return {
      front: front || content.trim(),
      back,
      hasBack: back.length > 0,
    };
  }

  function buildPreviewCard(content: string, index: number): ParsedCardPreview {
    const type = detectCardType(content);
    const faces = splitCardFaces(content);

    let note: string | null = null;
    if (!faces.hasBack && type === CardType.Cloze) {
      note = '挖空卡片会按单段内容导入。';
    } else if (!faces.hasBack) {
      note = '未检测到 ---div---，导入时会保留整段原文。';
    }

    return {
      index,
      front: faces.front,
      back: faces.back,
      hasBack: faces.hasBack,
      type,
      typeName: getCardTypeName(type),
      note,
    };
  }

  function goToPreview() {
    if (isImporting) return;

    if (detectStats.total === 0) {
      new Notice('请先粘贴可解析的卡片内容');
      return;
    }

    if (!targetDeckId) {
      new Notice('请选择目标牌组');
      return;
    }

    parsedCards = splitCards(pasteText).map((content, index) => buildPreviewCard(content, index + 1));
    currentPreviewIndex = 0;
    currentStep = 2;
  }

  function goBack() {
    if (isImporting) return;
    currentStep = 1;
  }

  function setCurrentPreviewIndex(index: number) {
    if (!Number.isFinite(index) || parsedCards.length === 0) return;
    currentPreviewIndex = Math.max(0, Math.min(parsedCards.length - 1, index));
  }

  function toggleSummaryHint(type: 'stats' | 'deck' | 'source') {
    activeSummaryHint = activeSummaryHint === type ? null : type;
  }

  function showPrevPreviewCard() {
    if (!canPreviewPrev) return;
    setCurrentPreviewIndex(currentPreviewIndex - 1);
  }

  function showNextPreviewCard() {
    if (!canPreviewNext) return;
    setCurrentPreviewIndex(currentPreviewIndex + 1);
  }

  async function executeImport() {
    if (isImporting) return;
    if (detectStats.total === 0) {
      new Notice('没有检测到可导入的卡片');
      return;
    }

    isImporting = true;
    importProgress = 0;

    try {
      if (!targetDeckId) {
        new Notice('请选择目标牌组');
        isImporting = false;
        return;
      }
      const deckId = targetDeckId;
      const deck = decks.find((item) => item.id === targetDeckId);
      if (!deck) {
        new Notice('目标牌组不存在，请重新选择');
        isImporting = false;
        return;
      }
      const deckName = deck.name;
      const cardTexts = splitCards(pasteText);
      const allCards: Card[] = [];
      const importBatchId = `clipboard-${Date.now()}`;

      for (let i = 0; i < cardTexts.length; i++) {
        const cardContent = cardTexts[i];
        const cardType = detectCardType(cardContent);

        const yamlMetadata: Record<string, any> = {
          we_type: cardType === CardType.Basic
            ? 'basic'
            : cardType === CardType.Multiple
              ? 'multiple'
              : 'cloze',
          we_created: new Date().toISOString(),
        };

        if (deckName) {
          yamlMetadata.we_decks = [deckName];
        }

        if (sourceLink.trim()) {
          yamlMetadata.we_source = sourceLink.trim();
        }

        const contentWithMeta = buildContentWithYAML(yamlMetadata, cardContent);

        const card: Card = {
          uuid: generateCardUUID(),
          deckId,
          type: cardType,
          content: contentWithMeta,
          fsrs: {
            due: new Date().toISOString(),
            stability: 0,
            difficulty: 0,
            elapsedDays: 0,
            scheduledDays: 0,
            reps: 0,
            lapses: 0,
            state: 0,
            lastReview: undefined as any,
            retrievability: 1,
          },
          reviewHistory: [],
          stats: {
            totalReviews: 0,
            totalTime: 0,
            averageTime: 0,
            memoryRate: 0,
          },
          source: 'weave' as const,
          tags: [],
          created: new Date().toISOString(),
          modified: new Date().toISOString(),
          metadata: {
            importBatchId,
          },
        };

        allCards.push(card);
      }

      importProgress = 10;
      await dataStorage.saveCardsBatch(allCards);
      importProgress = 100;

      new Notice(`粘贴导入完成: ${allCards.length} 张卡片已导入到 "${deckName}"`);
      logger.info('[ClipboardImport] 导入完成:', { count: allCards.length, deckName, deckId });

      onImportComplete?.(deckId, allCards.length);
      handleClose();
    } catch (err) {
      logger.error('[ClipboardImport] 导入失败:', err);
      new Notice('导入失败: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      isImporting = false;
    }
  }

  function handleClose() {
    if (isImporting) return;
    open = false;
    onClose();
  }
</script>

{#snippet wizardContent()}
  <div class="clip-import-wizard">
    <div class="clip-steps">
      <div class="clip-step" class:active={currentStep === 1} class:done={currentStep > 1}>
        <span class="clip-step-num">{currentStep > 1 ? '>' : '1'}</span>
        <span class="clip-step-label">填写内容</span>
      </div>
      <div class="clip-step-line" class:done={currentStep > 1}></div>
      <div class="clip-step" class:active={currentStep === 2}>
        <span class="clip-step-num">2</span>
        <span class="clip-step-label">预览导入</span>
      </div>
    </div>

    <div class="clip-step-body">
      {#if currentStep === 1}
        <div class="clip-step-content clip-entry-layout">
          <div class="clip-toolbar-grid">
            <div class="clip-toolbar-card clip-source-card">
              <div class="clip-card-title-row">
                <div class="clip-section-title">来源文档（可选）</div>
                <span class="clip-hint-dot" title={sourcePickerHintText} aria-label={sourcePickerHintText}>
                  <ObsidianIcon name="info" size={12} />
                </span>
              </div>

              <div class="clip-source-trigger-wrap">
                <button
                  bind:this={sourcePickerButtonEl}
                  class="clip-source-trigger"
                  onclick={toggleSourcePicker}
                  type="button"
                  title={sourceFilePath || '选择来源文档'}
                >
                  <ObsidianIcon name="file-text" size={14} />
                  <span class="clip-source-trigger-text">{selectedSourceFileName}</span>
                  <ObsidianIcon name="chevron-down" size={12} />
                </button>

                {#if sourceFilePath}
                  <button
                    class="clip-source-clear"
                    onclick={clearSourceFile}
                    type="button"
                    title="清除来源文档"
                  >
                    <ObsidianIcon name="x" size={12} />
                  </button>
                {/if}
              </div>

              {#if sourcePickerOpen}
                <div class="clip-source-dropdown" bind:this={sourcePickerPanelEl}>
                  <div class="clip-source-search">
                    <ObsidianIcon name="search" size={14} />
                    <input
                      bind:this={sourcePickerSearchEl}
                      type="text"
                      placeholder="搜索文件名或路径..."
                      bind:value={sourcePickerQuery}
                    />
                  </div>

                  <div class="clip-source-list">
                    {#if filteredSourceFiles.length === 0}
                      <div class="clip-source-empty">没有找到匹配文件</div>
                    {:else}
                      {#each filteredSourceFiles as file}
                        <button
                          class="clip-source-item"
                          class:selected={file.path === sourceFilePath}
                          onclick={() => pickSourceFile(file)}
                          type="button"
                          title={file.path}
                        >
                          <span class="clip-source-item-name">{file.name}</span>
                          <span class="clip-source-item-size">{formatFileSize(file.stat.size)}</span>
                        </button>
                      {/each}
                    {/if}
                  </div>
                </div>
              {/if}

              {#if sourceFilePath}
                <div class="clip-inline-preview clip-inline-preview-ellipsis" title={`来源：${sourceLink}`}>
                  来源：{sourceLink}
                </div>
              {/if}
            </div>

            <div class="clip-toolbar-card">
              <div class="clip-card-title-row">
                <div class="clip-section-title">目标牌组</div>
                <span class="clip-hint-dot" title={deckPickerHintText} aria-label={deckPickerHintText}>
                  <ObsidianIcon name="info" size={12} />
                </span>
              </div>

              {#if decks.length > 0}
                <button
                  bind:this={deckMenuButtonEl}
                  class="clip-deck-picker-btn"
                  onclick={(e) => {
                    e.preventDefault();
                    showDeckMenu(e);
                  }}
                  onkeydown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      showDeckMenu(e);
                    }
                  }}
                  type="button"
                >
                  <ObsidianIcon name="folder" size={14} />
                  <span class="clip-deck-picker-text">{selectedDeckName}</span>
                  <ObsidianIcon name="chevron-down" size={12} />
                </button>
              {:else}
                <div class="clip-inline-preview">未检测到可用牌组，请先在插件中创建牌组。</div>
              {/if}
            </div>
          </div>

          <div class="clip-editor-panel">
            <div class="clip-editor-panel-head">
              <div>
                <div class="clip-section-title">粘贴卡片内容</div>
                <div class="clip-editor-hint">
                  卡片之间使用 `&lt;-&gt;` 分隔，正反面使用 `---div---` 分隔；如需学习提示，可在卡片内容中加入 `>hint:` 引用提示块。
                </div>
              </div>

              <div class="clip-editor-counter" class:is-empty={detectStats.total === 0}>
                {#if detectStats.total > 0}
                  已解析 {detectStats.total} 张
                {:else}
                  等待粘贴内容
                {/if}
              </div>
            </div>

            <textarea
              class="clip-textarea"
              bind:value={pasteText}
              placeholder={"Q: 什么是间隔重复？\n---div---\nA: 间隔重复是一种基于遗忘曲线的学习方法。\n\n<->\n\nQ: Java有哪些基本数据类型？\nA. int\nB. String\nC. boolean\nD. double\n---div---\nA, C, D。String是引用类型。\n\n<->\n\n==光合作用==是植物将==二氧化碳==转化为==葡萄糖==的过程。"}
            ></textarea>

            {#if detectStats.total > 0}
              <div class="clip-detect-bar">
                <div class="clip-detect-total">
                  检测到 <strong>{detectStats.total}</strong> 张卡片
                </div>
                <div class="clip-detect-types">
                  {#if detectStats.basic > 0}
                    <span class="clip-detect-tag clip-tag-basic">问答 {detectStats.basic}</span>
                  {/if}
                  {#if detectStats.choice > 0}
                    <span class="clip-detect-tag clip-tag-choice">选择 {detectStats.choice}</span>
                  {/if}
                  {#if detectStats.cloze > 0}
                    <span class="clip-detect-tag clip-tag-cloze">挖空 {detectStats.cloze}</span>
                  {/if}
                </div>
              </div>
            {:else}
              <div class="clip-empty-hint">
                粘贴完成后会自动统计卡片数量，并在下一步展示解析预览。
              </div>
            {/if}
          </div>
        </div>
      {:else}
        <div class="clip-step-content clip-preview-layout">
          <div class="clip-summary-grid">
            <div class="clip-summary-card">
              <div class="clip-summary-label-row">
                <div class="clip-summary-label">待导入卡片</div>
                <button
                  type="button"
                  class="clip-hint-toggle"
                  title={summaryStatsHintText}
                  aria-label="查看卡片类型统计"
                  aria-expanded={activeSummaryHint === 'stats'}
                  onclick={() => toggleSummaryHint('stats')}
                >
                  <ObsidianIcon name="info" size={12} />
                </button>
              </div>
              <div class="clip-summary-value">{detectStats.total}</div>
              {#if activeSummaryHint === 'stats'}
                <div class="clip-summary-hint-inline">{summaryStatsHintText}</div>
              {/if}
            </div>

            <div class="clip-summary-card">
              <div class="clip-summary-label-row">
                <div class="clip-summary-label">目标牌组</div>
                <button
                  type="button"
                  class="clip-hint-toggle"
                  title={summaryDeckHintText}
                  aria-label="查看目标牌组说明"
                  aria-expanded={activeSummaryHint === 'deck'}
                  onclick={() => toggleSummaryHint('deck')}
                >
                  <ObsidianIcon name="info" size={12} />
                </button>
              </div>
              <div class="clip-summary-value clip-summary-value-text">{selectedDeckName}</div>
              {#if activeSummaryHint === 'deck'}
                <div class="clip-summary-hint-inline">{summaryDeckHintText}</div>
              {/if}
            </div>

            <div class="clip-summary-card">
              <div class="clip-summary-label-row">
                <div class="clip-summary-label">来源文档</div>
                <button
                  type="button"
                  class="clip-hint-toggle"
                  title={summarySourceHintText}
                  aria-label="查看来源文档说明"
                  aria-expanded={activeSummaryHint === 'source'}
                  onclick={() => toggleSummaryHint('source')}
                >
                  <ObsidianIcon name="info" size={12} />
                </button>
              </div>
              <div
                class="clip-summary-value clip-summary-value-text clip-summary-value-ellipsis"
                title={sourceLink.trim() || '未设置'}
              >
                {sourceLink.trim() || '未设置'}
              </div>
              {#if activeSummaryHint === 'source'}
                <div class="clip-summary-hint-inline">{summarySourceHintText}</div>
              {/if}
            </div>

          </div>

          {#if previewWarningCount > 0}
            <div class="clip-warning">
              有 {previewWarningCount} 张卡片未检测到 `---div---` 分隔，导入时会保留整段原文。
            </div>
          {/if}

          <div class="clip-preview-carousel">
            <button
              class="clip-preview-nav"
              aria-label="上一张卡片"
              onclick={showPrevPreviewCard}
              disabled={!canPreviewPrev}
            >
              ‹
            </button>

            <div class="clip-preview-stage">
              {#if activePreviewCard}
                <div class="clip-preview-card clip-preview-card-focus">
                  <div class="clip-preview-card-header">
                    <div class="clip-preview-card-heading">
                      <div class="clip-preview-card-title">
                        卡片 {activePreviewCard.index} / {parsedCards.length}
                      </div>
                      <div class="clip-preview-card-subtitle">
                        {activePreviewCard.hasBack
                          ? '正反面已分离，可直接检查导入结果。'
                          : '单段内容卡片，会保留整段文本导入。'}
                      </div>
                    </div>

                    <span
                      class="clip-card-type-badge"
                      class:clip-card-type-basic={activePreviewCard.type === CardType.Basic}
                      class:clip-card-type-choice={activePreviewCard.type === CardType.Multiple}
                      class:clip-card-type-cloze={activePreviewCard.type === CardType.Cloze}
                    >
                      {activePreviewCard.typeName}
                    </span>
                  </div>

                  <div class="clip-preview-faces" class:single={!activePreviewCard.hasBack}>
                    <div class="clip-preview-face">
                      <div class="clip-preview-face-label">
                        {activePreviewCard.hasBack ? '正面' : '内容'}
                      </div>
                      <pre class="clip-preview-face-content">{activePreviewCard.front}</pre>
                    </div>

                    {#if activePreviewCard.hasBack}
                      <div class="clip-preview-face">
                        <div class="clip-preview-face-label">背面</div>
                        <pre class="clip-preview-face-content">{activePreviewCard.back}</pre>
                      </div>
                    {/if}
                  </div>

                  {#if activePreviewCard.note}
                    <div class="clip-preview-note">{activePreviewCard.note}</div>
                  {/if}
                </div>
              {/if}

              {#if parsedCards.length > 1}
                <div class="clip-preview-slider-row">
                  <button
                    class="clip-btn clip-btn-secondary clip-mini-nav"
                    onclick={showPrevPreviewCard}
                    disabled={!canPreviewPrev}
                  >
                    上一张
                  </button>

                  <input
                    type="range"
                    class="clip-preview-slider"
                    min="1"
                    max={parsedCards.length}
                    step="1"
                    value={currentPreviewIndex + 1}
                    oninput={(e) =>
                      setCurrentPreviewIndex(Number((e.target as HTMLInputElement).value) - 1)}
                  />

                  <button
                    class="clip-btn clip-btn-secondary clip-mini-nav"
                    onclick={showNextPreviewCard}
                    disabled={!canPreviewNext}
                  >
                    下一张
                  </button>
                </div>
              {/if}
            </div>

            <button
              class="clip-preview-nav"
              aria-label="下一张卡片"
              onclick={showNextPreviewCard}
              disabled={!canPreviewNext}
            >
              ›
            </button>
          </div>

          {#if isImporting}
            <div class="clip-progress-wrap">
              <div class="clip-progress-bar">
                <div class="clip-progress-fill" style="width: {importProgress}%"></div>
              </div>
              <div class="clip-progress-text">正在导入... {importProgress}%</div>
            </div>
          {/if}
        </div>
      {/if}
    </div>
  </div>
{/snippet}

{#snippet footerContent()}
  <div class="clip-footer">
    <div class="clip-footer-left">
      {#if currentStep > 1}
        <button class="clip-btn clip-btn-secondary" onclick={goBack} disabled={isImporting}>
          上一步
        </button>
      {/if}
    </div>

    <div class="clip-footer-right">
      <button class="clip-btn clip-btn-secondary" onclick={handleClose} disabled={isImporting}>
        取消
      </button>

      {#if currentStep === 1}
        <button
          class="clip-btn clip-btn-primary"
          onclick={goToPreview}
          disabled={!canGoNext || isImporting}
        >
          下一步
        </button>
      {:else}
        <button
          class="clip-btn clip-btn-primary"
          onclick={executeImport}
          disabled={isImporting || parsedCards.length === 0}
        >
          {isImporting ? '导入中...' : `导入 ${parsedCards.length} 张卡片`}
        </button>
      {/if}
    </div>
  </div>
{/snippet}

{#if useObsidianModal}
  {#if open}
    <div class="clip-native-layout">
      {@render wizardContent()}
      <div class="clip-native-footer">
        {@render footerContent()}
      </div>
    </div>
  {/if}
{:else}
  <EnhancedModal
    {open}
    onClose={handleClose}
    size="lg"
    title="粘贴卡片批量导入"
    accentColor="blue"
    maskClosable={!isImporting}
    keyboard={!isImporting}
  >
    {#snippet children()}
      {@render wizardContent()}
    {/snippet}

    {#snippet footer()}
      {@render footerContent()}
    {/snippet}
  </EnhancedModal>
{/if}

<style>
  .clip-native-layout {
    height: 100%;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .clip-import-wizard {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .clip-steps {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0;
    padding-top: 6px;
  }

  .clip-step {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 14px;
    border-radius: 999px;
    background: var(--background-secondary);
    color: var(--text-muted);
    font-size: 13px;
    transition: all 0.2s ease;
  }

  .clip-step.active {
    background: var(--interactive-accent);
    color: var(--text-on-accent);
  }

  .clip-step.done {
    background: var(--background-modifier-success);
    color: var(--text-on-accent);
  }

  .clip-step-num {
    width: 20px;
    height: 20px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    font-size: 12px;
    font-weight: 700;
  }

  .clip-step-label {
    font-weight: 600;
  }

  .clip-step-line {
    width: 42px;
    height: 2px;
    margin: 0 4px;
    background: var(--background-modifier-border);
    transition: background 0.2s ease;
  }

  .clip-step-line.done {
    background: var(--interactive-accent);
  }

  .clip-step-body {
    flex: 1;
    min-height: 0;
  }

  .clip-step-content {
    height: 100%;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 16px;
    overflow: auto;
    padding-right: 4px;
  }

  .clip-entry-layout,
  .clip-preview-layout {
    padding-right: 2px;
  }

  .clip-toolbar-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }

  .clip-toolbar-card {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
    padding: 12px 14px;
    border-radius: 14px;
    border: 1px solid var(--background-modifier-border);
    background: var(--background-secondary);
  }

  .clip-editor-panel {
    display: flex;
    flex-direction: column;
    gap: 12px;
    flex: 1;
    min-height: 0;
    padding: 16px;
    border-radius: 16px;
    border: 1px solid var(--background-modifier-border);
    background: var(--background-primary);
    box-shadow: 0 6px 18px rgba(15, 23, 42, 0.04);
  }

  .clip-editor-panel-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
  }

  .clip-editor-counter {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 6px 12px;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 600;
    background: rgba(16, 185, 129, 0.16);
    color: #0f9f6e;
    white-space: nowrap;
  }

  .clip-editor-counter.is-empty {
    background: var(--background-secondary);
    color: var(--text-muted);
    border: 1px dashed var(--background-modifier-border);
  }

  .clip-section-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-normal);
  }

  .clip-card-title-row,
  .clip-summary-label-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-width: 0;
  }

  .clip-hint-dot {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    border: 1px solid var(--background-modifier-border);
    background: var(--background-primary);
    color: var(--text-muted);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
  }

  .clip-hint-toggle {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    border: 1px solid var(--background-modifier-border);
    background: var(--background-primary);
    color: var(--text-muted);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
    cursor: pointer;
    padding: 0;
    transition: border-color 0.15s ease, color 0.15s ease;
  }

  .clip-hint-toggle:hover {
    border-color: var(--interactive-accent);
    color: var(--text-normal);
  }

  .clip-editor-hint,
  .clip-empty-hint,
  .clip-inline-preview,
  .clip-summary-hint-inline,
  .clip-preview-note,
  .clip-progress-text {
    font-size: 12px;
    color: var(--text-muted);
    line-height: 1.5;
  }

  .clip-inline-preview {
    padding: 8px 10px;
    border-radius: 10px;
    background: var(--background-primary);
    word-break: break-word;
  }

  .clip-inline-preview-ellipsis {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    word-break: normal;
  }

  .clip-source-card {
    position: relative;
    z-index: 4;
  }

  .clip-source-trigger-wrap {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .clip-source-trigger,
  .clip-deck-picker-btn {
    width: 100%;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-height: 36px;
    padding: 0 10px;
    border: 1px solid var(--background-modifier-border);
    border-radius: 10px;
    background: var(--background-primary);
    color: var(--text-normal);
    cursor: pointer;
    font-size: 13px;
    font-weight: 600;
    transition: border-color 0.2s ease, background 0.2s ease;
    text-align: left;
  }

  .clip-source-trigger:hover,
  .clip-deck-picker-btn:hover {
    border-color: var(--interactive-accent);
    background: var(--background-modifier-hover);
  }

  .clip-source-trigger-text,
  .clip-deck-picker-text {
    flex: 1;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .clip-source-clear {
    flex: 0 0 auto;
    width: 30px;
    height: 30px;
    border-radius: 8px;
    border: 1px solid var(--background-modifier-border);
    background: var(--background-primary);
    color: var(--text-muted);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
  }

  .clip-source-clear:hover {
    color: var(--text-normal);
    border-color: var(--interactive-accent);
  }

  .clip-source-dropdown {
    position: absolute;
    left: 14px;
    right: 14px;
    top: calc(100% - 10px);
    border-radius: 12px;
    border: 1px solid var(--background-modifier-border);
    background: var(--background-primary);
    box-shadow: 0 16px 36px rgba(0, 0, 0, 0.2);
    overflow: hidden;
    z-index: 24;
    display: flex;
    flex-direction: column;
    max-height: 320px;
  }

  .clip-source-search {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px;
    border-bottom: 1px solid var(--background-modifier-border);
    color: var(--text-muted);
  }

  .clip-source-search input {
    width: 100%;
    min-width: 0;
    height: 32px;
    padding: 0 8px;
    border: 1px solid var(--background-modifier-border);
    border-radius: 8px;
    background: var(--background-secondary);
    color: var(--text-normal);
    font-size: 12px;
    outline: none;
  }

  .clip-source-search input:focus,
  .clip-textarea:focus {
    outline: none;
    border-color: var(--interactive-accent);
    box-shadow: 0 0 0 1px var(--interactive-accent);
  }

  .clip-source-list {
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    padding: 4px 0;
  }

  .clip-source-item {
    width: 100%;
    min-height: 34px;
    padding: 8px 12px;
    border: none;
    border-radius: 0;
    background: transparent;
    color: var(--text-normal);
    text-align: left;
    display: flex;
    align-items: baseline;
    gap: 10px;
    cursor: pointer;
  }

  .clip-source-item:hover,
  .clip-source-item.selected {
    background: var(--background-modifier-hover);
  }

  .clip-source-item-name {
    flex: 1;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 12px;
  }

  .clip-source-item-size {
    flex: 0 0 auto;
    font-size: 11px;
    color: var(--text-muted);
  }

  .clip-source-empty {
    padding: 14px 10px;
    color: var(--text-muted);
    text-align: center;
    font-size: 12px;
  }

  .clip-detect-tag,
  .clip-card-type-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    font-weight: 600;
    border-radius: 999px;
  }

  .clip-textarea {
    width: 100%;
    min-height: 360px;
    flex: 1;
    padding: 14px;
    border: 1px solid var(--background-modifier-border);
    border-radius: 16px;
    background: var(--background-secondary);
    color: var(--text-normal);
    font-size: 13px;
    font-family: var(--font-monospace);
    line-height: 1.65;
    resize: vertical;
  }

  .clip-textarea::placeholder {
    color: var(--text-faint);
  }

  .clip-detect-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    padding: 12px 14px;
    border-radius: 14px;
    background: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
  }

  .clip-detect-total {
    font-size: 13px;
    color: var(--text-normal);
  }

  .clip-detect-types {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .clip-detect-tag {
    padding: 4px 10px;
  }

  .clip-tag-basic,
  .clip-card-type-basic {
    background: rgba(59, 130, 246, 0.15);
    color: #3b82f6;
  }

  .clip-tag-choice,
  .clip-card-type-choice {
    background: rgba(16, 185, 129, 0.16);
    color: #10b981;
  }

  .clip-tag-cloze,
  .clip-card-type-cloze {
    background: rgba(245, 158, 11, 0.18);
    color: #d97706;
  }

  .clip-empty-hint {
    padding: 12px 14px;
    border-radius: 14px;
    background: var(--background-secondary);
    border: 1px dashed var(--background-modifier-border);
  }

  .clip-summary-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 12px;
  }

  .clip-summary-card {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 12px 14px;
    border-radius: 14px;
    border: 1px solid var(--background-modifier-border);
    background: var(--background-secondary);
    min-width: 0;
  }

  .clip-summary-label {
    font-size: 12px;
    color: var(--text-muted);
    letter-spacing: 0.02em;
  }

  .clip-summary-value {
    font-size: 24px;
    font-weight: 700;
    color: var(--text-normal);
    line-height: 1.2;
  }

  .clip-summary-value-text {
    font-size: 15px;
    font-weight: 600;
  }

  .clip-summary-value-ellipsis {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .clip-warning {
    padding: 12px 14px;
    border-radius: 14px;
    border: 1px solid rgba(245, 158, 11, 0.28);
    background: rgba(245, 158, 11, 0.08);
    color: var(--text-normal);
    font-size: 13px;
  }

  .clip-preview-carousel {
    display: grid;
    grid-template-columns: 44px minmax(0, 1fr) 44px;
    gap: 12px;
    flex: 1;
    min-height: 0;
    align-items: stretch;
  }

  .clip-preview-nav {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 14px;
    border: 1px solid var(--background-modifier-border);
    background: var(--background-secondary);
    color: var(--text-normal);
    font-size: 28px;
    line-height: 1;
    cursor: pointer;
    transition: background 0.15s ease, border-color 0.15s ease;
  }

  .clip-preview-nav:hover:not(:disabled) {
    background: var(--background-modifier-hover);
    border-color: var(--interactive-accent);
  }

  .clip-preview-nav:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .clip-preview-stage {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-height: 0;
    min-width: 0;
  }

  .clip-preview-card {
    border: 1px solid var(--background-modifier-border);
    border-radius: 16px;
    background: var(--background-primary);
    overflow: hidden;
  }

  .clip-preview-card-focus {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }

  .clip-preview-card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 14px;
    background: var(--background-secondary);
    border-bottom: 1px solid var(--background-modifier-border);
  }

  .clip-preview-card-title {
    font-size: 13px;
    font-weight: 700;
    color: var(--text-normal);
  }

  .clip-preview-card-heading {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .clip-preview-card-subtitle {
    font-size: 12px;
    color: var(--text-muted);
    line-height: 1.45;
  }

  .clip-card-type-badge {
    padding: 4px 10px;
  }

  .clip-preview-faces {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
    padding: 14px;
  }

  .clip-preview-faces.single {
    grid-template-columns: minmax(0, 1fr);
  }

  .clip-preview-face {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
    padding: 12px;
    border-radius: 12px;
    background: var(--background-secondary);
  }

  .clip-preview-face-label {
    font-size: 11px;
    font-weight: 700;
    color: var(--text-faint);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .clip-preview-face-content {
    margin: 0;
    font-size: 13px;
    color: var(--text-normal);
    font-family: inherit;
    white-space: pre-wrap;
    word-break: break-word;
    line-height: 1.6;
    max-height: 300px;
    overflow: auto;
  }

  .clip-preview-note {
    padding: 0 14px 14px;
  }

  .clip-preview-slider-row {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 10px;
  }

  .clip-preview-slider {
    width: 100%;
    accent-color: var(--interactive-accent);
  }

  .clip-mini-nav {
    padding: 6px 12px;
    font-size: 12px;
    white-space: nowrap;
  }

  .clip-progress-wrap {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .clip-progress-bar {
    width: 100%;
    height: 6px;
    overflow: hidden;
    border-radius: 999px;
    background: var(--background-modifier-border);
  }

  .clip-progress-fill {
    height: 100%;
    background: var(--interactive-accent);
    transition: width 0.3s ease;
  }

  .clip-native-footer {
    padding-top: 14px;
    border-top: 1px solid var(--background-modifier-border);
  }

  .clip-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .clip-footer-left,
  .clip-footer-right {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .clip-btn {
    padding: 8px 16px;
    border-radius: 10px;
    border: 1px solid transparent;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .clip-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .clip-btn-primary {
    background: var(--interactive-accent);
    color: var(--text-on-accent);
  }

  .clip-btn-primary:hover:not(:disabled) {
    filter: brightness(1.08);
  }

  .clip-btn-secondary {
    background: var(--background-secondary);
    color: var(--text-normal);
    border-color: var(--background-modifier-border);
  }

  .clip-btn-secondary:hover:not(:disabled) {
    background: var(--background-modifier-hover);
  }

  @media (max-width: 1080px) {
    .clip-toolbar-grid,
    .clip-summary-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (max-width: 960px) {
    .clip-toolbar-grid,
    .clip-summary-grid,
    .clip-preview-faces {
      grid-template-columns: minmax(0, 1fr);
    }

    .clip-preview-carousel {
      grid-template-columns: minmax(0, 1fr);
    }

    .clip-preview-nav {
      display: none;
    }

    .clip-preview-slider-row {
      grid-template-columns: minmax(0, 1fr);
    }

    .clip-mini-nav {
      width: 100%;
    }

    .clip-textarea {
      min-height: 280px;
    }
  }

  @media (max-width: 720px) {
    .clip-steps {
      justify-content: flex-start;
      overflow-x: auto;
      padding-bottom: 2px;
    }

    .clip-toolbar-card,
    .clip-editor-panel {
      padding: 12px;
    }

    .clip-footer {
      flex-direction: column;
      align-items: stretch;
    }

    .clip-footer-left,
    .clip-footer-right {
      width: 100%;
      justify-content: flex-end;
    }

    .clip-footer-left:empty {
      display: none;
    }
  }
</style>
