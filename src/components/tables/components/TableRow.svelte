<script lang="ts">
  import type { Card } from '../../../data/types';
  import StatusBadge from "../../ui/StatusBadge.svelte";
  import { untrack } from "svelte";
  import EnhancedIcon from "../../ui/EnhancedIcon.svelte";
  import DraggableCheckboxWrapper from "./DraggableCheckboxWrapper.svelte";
  import { ICON_NAMES } from "../../../icons/index.js";
  import { truncateText, getFieldTemplateInfo, getSourceDocumentStatusInfo } from "../utils/table-utils";
  import TagsCell from "./cells/TagsCell.svelte";
  import PriorityCell from "./cells/PriorityCell.svelte";
  import ActionsCell from "./cells/ActionsCell.svelte";
  import ReviewDataCell from "./cells/ReviewDataCell.svelte";
  import ModifiedCell from "./cells/ModifiedCell.svelte";
  import type { FieldTemplateInfo, SourceDocumentStatusInfo, TableRowProps } from "../types/table-types";
  import { getCardBack, getCardFront } from "../../../utils/card-field-helper";
  import { getCardDeckNames as getNormalizedCardDeckNames } from "../../../utils/yaml-utils";

  let {
    card,
    selected,
    columnOrder,
    tableViewMode,
    callbacks,
    plugin,
    decks = [],
    fieldTemplates = [],
    availableTags = [],
    onSelect,
    onDragSelectStart,
    onDragSelectMove,
    isDragSelectActive,
    isVisible = true
  }: TableRowProps = $props();

  function getSourceFileName(card: any): string {
    if (card.sourceFile) {
      return card.sourceFile.split('/').pop() || card.sourceFile;
    }
    if (card.customFields?.obsidianFilePath) {
      const path = card.customFields.obsidianFilePath as string;
      return path.split('/').pop() || path;
    }
    return '';
  }

  function handleRowSelect(checked: boolean) {
    onSelect(card.uuid, checked);
  }

  function formatFixedTime(dateString: string | number | null | undefined): string {
    if (!dateString) return '-';

    try {
      let date: Date;
      if (typeof dateString === 'string' && /^\d+$/.test(dateString)) {
        date = new Date(Number(dateString));
      } else {
        date = new Date(dateString);
      }

      if (isNaN(date.getTime())) {
        return '-';
      }

      const now = new Date();
      const isToday = date.getFullYear() === now.getFullYear() &&
        date.getMonth() === now.getMonth() &&
        date.getDate() === now.getDate();

      if (isToday) {
        const hour = String(date.getHours()).padStart(2, '0');
        const minute = String(date.getMinutes()).padStart(2, '0');
        return `${hour}:${minute}`;
      }

      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    } catch (error) {
      return '-';
    }
  }

  const defaultTemplateInfo: FieldTemplateInfo = {
    name: '未设置',
    icon: ICON_NAMES.HELP,
    class: 'weave-template-unknown'
  };

  const defaultSourceStatusInfo: SourceDocumentStatusInfo = {
    text: '未知',
    icon: ICON_NAMES.HELP,
    class: 'weave-status-unknown',
    tooltip: '源文档状态未知'
  };

  // 只有行可见时才计算派生数据，减少大表格下的额外开销。
  let templateInfo = $state<FieldTemplateInfo>(
    untrack(() =>
      isVisible
        ? getFieldTemplateInfo(card.templateId || '', fieldTemplates, plugin)
        : defaultTemplateInfo
    )
  );
  let sourceStatusInfo = $state<SourceDocumentStatusInfo>(
    untrack(() =>
      isVisible
        ? getSourceDocumentStatusInfo((card as any).sourceDocumentStatus || '')
        : defaultSourceStatusInfo
    )
  );

  let cardDeckNames = $derived.by(() => {
    if (!isVisible) return [];
    return getNormalizedCardDeckNames(card, decks, '未分组');
  });

  let irCardDeckNames = $derived.by(() => {
    if (!isVisible) return [];

    const names: string[] = [];
    const seen = new Set<string>();
    const deckIds = (card as any).ir_deck_ids || (card as any).metadata?.deckIds || [];

    if (Array.isArray(deckIds)) {
      for (const deckId of deckIds) {
        const deck = decks.find(d => d.id === deckId);
        const deckName = deck?.name || String(deckId);
        if (deckName && !seen.has(deckName)) {
          seen.add(deckName);
          names.push(deckName);
        }
      }
    }

    const singleDeckName = (card as any).ir_deck;
    if (
      typeof singleDeckName === 'string' &&
      singleDeckName &&
      singleDeckName !== '未分配' &&
      !seen.has(singleDeckName)
    ) {
      names.push(singleDeckName);
    }

    return names;
  });

  $effect(() => {
    if (!isVisible) return;

    templateInfo = getFieldTemplateInfo(card.templateId || '', fieldTemplates, plugin);
    sourceStatusInfo = getSourceDocumentStatusInfo((card as any).sourceDocumentStatus || '');
  });

  // 继续沿用既有样式类，兼容 V3/V4 的增量阅读状态。
  function getIRStateClass(state: string | undefined): string {
    const s = state || 'new';
    if (s === 'queued' || s === 'active') return 'learning';
    if (s === 'scheduled') return 'review';
    if (s === 'done') return 'done';
    return s;
  }

  function getIRStateLabel(state: string | undefined): string {
    const s = state || 'new';
    if (s === 'new') return '新导入';
    if (s === 'learning' || s === 'queued' || s === 'active') return '阅读中';
    if (s === 'review' || s === 'scheduled') return '复习';
    if (s === 'suspended') return '已暂停';
    if (s === 'done') return '已完成';
    return '未知';
  }
</script>

<tr
  class="weave-table-row"
  class:selected={selected}
>
  <td class="weave-checkbox-column">
    <DraggableCheckboxWrapper
      checked={selected}
      onchange={handleRowSelect}
      ariaLabel="选择卡片"
      cardId={card.uuid}
      {onDragSelectStart}
      {onDragSelectMove}
      {isDragSelectActive}
    />
  </td>

  {#each columnOrder as columnKey (columnKey)}
    {#if columnKey === 'front'}
      <td class="weave-content-column weave-front-column">
        <div class="weave-cell-content">
          <span class="weave-text-content weave-text-content-primary">
            {truncateText((card as any).front || getCardFront(card))}
          </span>
        </div>
      </td>
    {:else if columnKey === 'back'}
      <td class="weave-content-column weave-back-column">
        <div class="weave-cell-content">
          <span class="weave-text-content weave-text-content-secondary">
            {truncateText((card as any).back || getCardBack(card))}
          </span>
        </div>
      </td>
    {:else if columnKey === 'status'}
      <td class="weave-status-column"><StatusBadge state={card.fsrs ? card.fsrs.state : 0} /></td>
    {:else if columnKey === 'deck'}
      <td class="weave-deck-column">
        <div class="weave-decks-container">
          {#if cardDeckNames.length > 0}
            {#each cardDeckNames.slice(0, 2) as deckName}
              <span class="weave-deck-badge weave-deck-badge--memory" title={deckName}>
                {truncateText(deckName, 12)}
              </span>
            {/each}
            {#if cardDeckNames.length > 2}
              <span class="weave-deck-more" title={cardDeckNames.join('\n')}>
                +{cardDeckNames.length - 2}
              </span>
            {/if}
          {:else}
            <span class="weave-text-muted">未分配</span>
          {/if}
        </div>
      </td>
    {:else if columnKey === 'tags'}
      <TagsCell {card} {availableTags} onTagsUpdate={callbacks.onTagsUpdate} />
    {:else if columnKey === 'priority'}
      <PriorityCell {card} onPriorityUpdate={callbacks.onPriorityUpdate} />
    {:else if columnKey === 'uuid'}
      <td class="weave-uuid-column">
        <div class="weave-cell-content">
          <span class="weave-uuid-text" title={card.uuid}>
            <EnhancedIcon name={ICON_NAMES.HASH} size={14} />
            {truncateText(card.uuid || 'N/A', 8)}
          </span>
        </div>
      </td>
    {:else if columnKey === 'created'}
      <td class="weave-date-column">
        <span class="weave-text-content weave-text-content-meta">{formatFixedTime(card.created)}</span>
      </td>
    {:else if columnKey === 'modified'}
      <ModifiedCell {card} />
    {:else if columnKey === 'next_review' || columnKey === 'retention' || columnKey === 'interval' || columnKey === 'difficulty' || columnKey === 'review_count'}
      <ReviewDataCell {card} column={columnKey} />
    {:else if columnKey === 'source_document'}
      <td class="weave-source-document-column">
        {#if card.sourceFile || card.customFields?.obsidianFilePath}
          <button
            class="weave-source-link"
            onclick={() => callbacks.onJumpToSource?.(card)}
            title={card.sourceBlock || (card.customFields?.blockId)
              ? '点击打开源文档并定位到块引用位置'
              : '点击打开源文档'}
          >
            <span>{truncateText(getSourceFileName(card), 20)}</span>
            {#if card.sourceBlock || (card.customFields?.blockId)}
              <EnhancedIcon name="link" size={12} class="weave-has-block-indicator" />
            {/if}
          </button>
        {:else}
          <span class="weave-text-muted">-</span>
        {/if}
      </td>
    {:else if columnKey === 'field_template'}
      <td class="weave-field-template-column">
        {#if templateInfo}
          <div class="weave-cell-content weave-field-template-chip {templateInfo.class}">
            <EnhancedIcon name={templateInfo.icon} size={12} />
            <span class="weave-field-template-text">{templateInfo.name}</span>
          </div>
        {:else}
          <span class="weave-text-muted">未设置</span>
        {/if}
      </td>
    {:else if columnKey === 'source_document_status'}
      <td class="weave-source-status-column">
        {#if card.sourceFile || card.customFields?.obsidianFilePath}
          <div class="weave-cell-content weave-source-status-badge {sourceStatusInfo.class}">
            <EnhancedIcon name={sourceStatusInfo.icon} size={12} />
            <span class="weave-source-status-text" title={sourceStatusInfo.tooltip}>
              {sourceStatusInfo.text}
            </span>
          </div>
        {:else}
          <span class="weave-text-muted">-</span>
        {/if}
      </td>
    {:else if columnKey === 'question_type'}
      <td class="weave-question-type-column">
        <span class="weave-inline-chip weave-inline-chip--soft">{(card as any).question_type || '-'}</span>
      </td>
    {:else if columnKey === 'accuracy'}
      <td class="weave-accuracy-column">
        <span class="weave-inline-chip weave-inline-chip--metric {(card as any).accuracy_class || ''}">
          {(card as any).accuracy || '-'}
        </span>
      </td>
    {:else if columnKey === 'test_attempts'}
      <td class="weave-test-attempts-column">
        <span class="weave-text-content weave-text-content-meta">{(card as any).test_attempts || 0}</span>
      </td>
    {:else if columnKey === 'last_test'}
      <td class="weave-last-test-column">
        <span class="weave-text-content weave-text-content-meta">{(card as any).last_test || '-'}</span>
      </td>
    {:else if columnKey === 'error_level'}
      <td class="weave-error-level-column">
        <span class="weave-inline-chip weave-inline-chip--soft">{(card as any).error_level || '-'}</span>
      </td>
    {:else if columnKey === 'ir_title'}
      <td class="weave-ir-title-column">
        <div class="weave-cell-content">
          <span class="weave-text-content" title={(card as any).ir_title || '-'}>
            {truncateText((card as any).ir_title || '-', 50)}
          </span>
        </div>
      </td>
    {:else if columnKey === 'ir_source_file'}
      <td class="weave-ir-source-file-column">
        <span class="weave-text-content" title={(card as any).ir_source_file || '-'}>
          {truncateText((card as any).ir_source_file?.split('/').pop() || '-', 25)}
        </span>
      </td>
    {:else if columnKey === 'ir_state'}
      <td class="weave-ir-state-column">
        <span class="weave-state-badge weave-state-{getIRStateClass((card as any).ir_state)}">
          {getIRStateLabel((card as any).ir_state)}
        </span>
      </td>
    {:else if columnKey === 'ir_priority'}
      <td class="weave-ir-priority-column">
        <span class="weave-priority-badge weave-priority-{(card as any).ir_priority || 2}">
          {(card as any).ir_priority === 1 ? '高' :
           (card as any).ir_priority === 2 ? '中' :
           (card as any).ir_priority === 3 ? '低' : '中'}
        </span>
      </td>
    {:else if columnKey === 'ir_tags'}
      <td class="weave-ir-tags-column">
        <div class="weave-tags-container">
          {#each ((card as any).ir_tags || []).slice(0, 3) as tag}
            <span class="weave-tag">{tag}</span>
          {/each}
          {#if ((card as any).ir_tags || []).length > 3}
            <span class="weave-tag-more">+{(card as any).ir_tags.length - 3}</span>
          {/if}
        </div>
      </td>
    {:else if columnKey === 'ir_favorite'}
      <td class="weave-ir-favorite-column">
        <EnhancedIcon
          name="star"
          size={16}
          variant={(card as any).ir_favorite ? 'warning' : 'muted'}
        />
      </td>
    {:else if columnKey === 'ir_next_review'}
      <td class="weave-ir-next-review-column">
        <span class="weave-text-content">
          {(card as any).ir_next_review ? formatFixedTime((card as any).ir_next_review) : '-'}
        </span>
      </td>
    {:else if columnKey === 'ir_review_count'}
      <td class="weave-ir-review-count-column">
        <span class="weave-text-content">{(card as any).ir_review_count || 0}</span>
      </td>
    {:else if columnKey === 'ir_reading_time'}
      <td class="weave-ir-reading-time-column">
        <span class="weave-text-content">
          {(() => {
            const totalSeconds = (card as any).ir_reading_time || 0;
            const hours = Math.floor(totalSeconds / 3600);
            const minutes = Math.floor((totalSeconds % 3600) / 60);
            if (hours > 0) {
              return `${hours}小时${minutes}分钟`;
            } else if (minutes > 0) {
              return `${minutes}分钟`;
            } else {
              return '0分钟';
            }
          })()}
        </span>
      </td>
    {:else if columnKey === 'ir_notes'}
      <td class="weave-ir-notes-column">
        <span class="weave-text-content" title={(card as any).ir_notes || ''}>
          {truncateText((card as any).ir_notes || '-', 30)}
        </span>
      </td>
    {:else if columnKey === 'ir_extracted_cards'}
      <td class="weave-ir-extracted-cards-column">
        <span class="weave-text-content">{(card as any).ir_extracted_cards || 0}张</span>
      </td>
    {:else if columnKey === 'ir_created'}
      <td class="weave-ir-created-column">
        <span class="weave-text-content">{formatFixedTime((card as any).ir_created)}</span>
      </td>
    {:else if columnKey === 'ir_decks'}
      <td class="weave-ir-decks-column">
        <div class="weave-decks-container">
          {#if irCardDeckNames.length > 0}
            {#each irCardDeckNames.slice(0, 3) as deckName}
              <span class="weave-deck-badge" title={deckName}>
                {truncateText(deckName, 12)}
              </span>
            {/each}
            {#if irCardDeckNames.length > 3}
              <span class="weave-deck-more" title={irCardDeckNames.join('\n')}>
                +{irCardDeckNames.length - 3}
              </span>
            {/if}
          {:else}
            <span class="weave-text-muted">未分配</span>
          {/if}
        </div>
      </td>
    {:else if columnKey === 'actions'}
      <td class="weave-actions-column">
        <ActionsCell
          {card}
          onView={callbacks.onView}
          onTempFileEdit={callbacks.onTempFileEdit}
          onEdit={callbacks.onEdit}
          onDelete={callbacks.onDelete}
        />
      </td>
    {/if}
  {/each}
</tr>

<style>
  @import '../styles/cell-common.css';

  .weave-table-row {
    transition: background-color 0.16s ease, box-shadow 0.16s ease, border-color 0.16s ease;
    position: relative;
  }

  .weave-table-row:hover {
    background: color-mix(in srgb, var(--background-modifier-hover) 58%, transparent);
    box-shadow: inset 0 1px 0 var(--weave-table-grid-hover-border-color, color-mix(in srgb, var(--background-modifier-border) 24%, transparent));
    z-index: 1;
  }

  .weave-table-row.selected {
    background: color-mix(in srgb, var(--interactive-accent) 10%, transparent);
  }

  .weave-table-row.selected:hover {
    background: color-mix(in srgb, var(--interactive-accent) 14%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--interactive-accent) 18%, transparent);
  }

  .weave-table-row td {
    padding: var(--weave-table-cell-padding-y, 6px) var(--weave-table-cell-padding-x, 16px);
    border-right: 1px solid var(--weave-table-grid-border-color, color-mix(in srgb, var(--background-modifier-border) 45%, transparent));
    border-bottom: 1px solid var(--weave-table-grid-border-color, var(--background-modifier-border));
    vertical-align: middle;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 0;
  }

  .weave-table-row:last-child td {
    border-bottom: none;
  }

  .weave-table-row .weave-checkbox-column {
    width: 48px;
    min-width: 48px;
    max-width: 48px;
    text-align: center;
    padding: var(--weave-table-cell-padding-y, 6px) var(--weave-table-cell-padding-x, 16px);
    text-overflow: clip;
    overflow: visible;
  }

  .weave-actions-column {
    width: 60px;
    min-width: 60px;
    max-width: 60px;
    text-align: center;
  }

  .weave-source-document-column {
    background: transparent;
  }

  .weave-source-document-column .weave-source-link {
    background: transparent !important;
    background-color: transparent !important;
    border: none !important;
    box-shadow: none !important;
    display: flex;
    align-items: center;
    gap: 4px;
    max-width: 100%;
    overflow: hidden;
    color: color-mix(in srgb, var(--text-normal) 72%, var(--text-muted));
    padding: 0;
  }

  .weave-source-document-column .weave-source-link span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    min-width: 0;
  }

  .weave-text-content {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-muted);
    font-size: 12px;
  }

  .weave-text-content-primary {
    color: var(--text-normal);
    font-size: 12px;
    font-weight: 600;
  }

  .weave-text-content-secondary {
    color: color-mix(in srgb, var(--text-normal) 72%, var(--text-muted));
    font-size: 12px;
  }

  .weave-text-content-meta {
    color: var(--text-faint);
    font-size: 11px;
    font-weight: 500;
  }

  .weave-inline-chip {
    display: inline-flex;
    align-items: center;
    min-height: var(--weave-table-pill-height, 22px);
    padding: 0 var(--weave-table-pill-padding-x, 8px);
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--background-modifier-border) 65%, transparent);
    background: color-mix(in srgb, var(--weave-table-surface-bg, var(--background-secondary)) 92%, transparent);
    color: var(--text-muted);
    font-size: 11px;
    font-weight: 600;
    white-space: nowrap;
  }

  .weave-inline-chip--soft {
    color: color-mix(in srgb, var(--text-normal) 72%, var(--text-muted));
  }

  .weave-inline-chip--metric {
    font-variant-numeric: tabular-nums;
    background: color-mix(in srgb, var(--interactive-accent) 8%, var(--weave-table-surface-bg, var(--background-secondary)));
    border-color: color-mix(in srgb, var(--interactive-accent) 16%, transparent);
  }

  .weave-field-template-chip,
  .weave-source-status-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: var(--weave-table-pill-height, 22px);
    padding: 0 var(--weave-table-pill-padding-x, 8px);
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--background-modifier-border) 65%, transparent);
    background: color-mix(in srgb, var(--weave-table-surface-bg, var(--background-secondary)) 92%, transparent);
  }

  .weave-field-template-text,
  .weave-source-status-text {
    line-height: 1;
    font-size: 11px;
    font-weight: 600;
    white-space: nowrap;
  }

  .weave-template-official {
    color: color-mix(in srgb, var(--color-green) 84%, var(--text-normal));
    border-color: color-mix(in srgb, var(--color-green) 22%, transparent);
    background: color-mix(in srgb, var(--color-green) 10%, var(--weave-table-surface-bg, var(--background-secondary)));
  }

  .weave-template-custom {
    color: color-mix(in srgb, var(--interactive-accent) 78%, var(--text-normal));
    border-color: color-mix(in srgb, var(--interactive-accent) 20%, transparent);
    background: color-mix(in srgb, var(--interactive-accent) 8%, var(--weave-table-surface-bg, var(--background-secondary)));
  }

  .weave-template-missing,
  .weave-template-unknown {
    color: var(--text-muted);
  }

  .weave-status-exists {
    color: color-mix(in srgb, var(--color-green) 84%, var(--text-normal));
    border-color: color-mix(in srgb, var(--color-green) 22%, transparent);
    background: color-mix(in srgb, var(--color-green) 10%, var(--weave-table-surface-bg, var(--background-secondary)));
  }

  .weave-status-deleted {
    color: color-mix(in srgb, var(--color-red) 82%, var(--text-normal));
    border-color: color-mix(in srgb, var(--color-red) 22%, transparent);
    background: color-mix(in srgb, var(--color-red) 10%, var(--weave-table-surface-bg, var(--background-secondary)));
  }

  .weave-status-none,
  .weave-status-unknown {
    color: var(--text-muted);
  }

  .weave-cell-content {
    display: flex;
    align-items: center;
    gap: 4px;
    max-width: 100%;
    overflow: hidden;
  }

  .weave-cell-content span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    min-width: 0;
  }

  .weave-decks-container {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    align-items: center;
  }

  .weave-deck-badge {
    display: inline-flex;
    align-items: center;
    min-height: var(--weave-table-pill-height, 22px);
    padding: 0 var(--weave-table-pill-padding-x, 8px);
    background: color-mix(in srgb, var(--weave-table-surface-bg, var(--background-secondary)) 88%, transparent);
    border: 1px solid color-mix(in srgb, var(--background-modifier-border) 70%, transparent);
    border-radius: 999px;
    font-size: 11px;
    font-weight: 600;
    color: color-mix(in srgb, var(--text-normal) 76%, var(--text-muted));
    max-width: 120px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    transition: transform 0.16s ease, border-color 0.16s ease, background-color 0.16s ease;
  }

  .weave-deck-badge--memory {
    background: color-mix(in srgb, var(--interactive-accent) 10%, var(--weave-table-surface-bg, var(--background-secondary)));
    border-color: color-mix(in srgb, var(--interactive-accent) 18%, transparent);
    color: color-mix(in srgb, var(--interactive-accent) 72%, var(--text-normal));
  }

  .weave-table-row:hover .weave-deck-badge {
    transform: translateY(-1px);
  }

  .weave-deck-more {
    display: inline-flex;
    align-items: center;
    min-height: var(--weave-table-pill-height, 22px);
    padding: 0 7px;
    background: color-mix(in srgb, var(--weave-table-surface-bg, var(--background-secondary)) 92%, transparent);
    color: var(--text-faint);
    border-radius: 999px;
    font-size: 10px;
    font-weight: 700;
  }

  .weave-state-badge {
    display: inline-flex;
    align-items: center;
    min-height: var(--weave-table-pill-height, 22px);
    padding: 0 var(--weave-table-pill-padding-x, 8px);
    border-radius: 4px;
    font-size: 0.75rem;
    font-weight: 500;
    white-space: nowrap;
  }

  .weave-state-new {
    background: color-mix(in srgb, var(--color-blue, var(--interactive-accent)) 15%, transparent);
    color: var(--color-blue, var(--interactive-accent));
  }

  .weave-state-learning {
    background: color-mix(in srgb, var(--color-orange, var(--interactive-accent)) 15%, transparent);
    color: var(--color-orange, var(--interactive-accent));
  }

  .weave-state-review {
    background: color-mix(in srgb, var(--color-green, var(--interactive-accent)) 15%, transparent);
    color: var(--color-green, var(--interactive-accent));
  }

  .weave-state-suspended {
    background: color-mix(in srgb, var(--color-gray, var(--text-muted)) 15%, transparent);
    color: var(--text-muted);
  }

  .weave-state-done {
    background: color-mix(in srgb, var(--color-purple, var(--interactive-accent)) 15%, transparent);
    color: var(--color-purple, var(--interactive-accent));
  }

  .weave-priority-badge {
    display: inline-flex;
    align-items: center;
    min-height: var(--weave-table-pill-height, 22px);
    padding: 0 var(--weave-table-pill-padding-x, 8px);
    border-radius: 4px;
    font-size: 0.75rem;
    font-weight: 500;
    white-space: nowrap;
  }

  .weave-priority-1 {
    background: color-mix(in srgb, var(--color-red, var(--text-error)) 15%, transparent);
    color: var(--color-red, var(--text-error));
  }

  .weave-priority-2 {
    background: color-mix(in srgb, var(--color-yellow, var(--interactive-accent)) 15%, transparent);
    color: var(--color-yellow, var(--interactive-accent));
  }

  .weave-priority-3 {
    background: color-mix(in srgb, var(--color-green, var(--interactive-accent)) 15%, transparent);
    color: var(--color-green, var(--interactive-accent));
  }

  .weave-tags-container {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    align-items: center;
    width: 100%;
    min-width: 0;
  }

  .weave-tag {
    display: inline-flex;
    align-items: center;
    padding: 2px 6px;
    background: var(--background-modifier-hover);
    border-radius: 4px;
    font-size: 0.7rem;
    color: var(--text-muted);
    flex-shrink: 0;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .weave-tag-more {
    display: inline-flex;
    align-items: center;
    padding: 2px 6px;
    background: var(--background-modifier-border);
    border-radius: 4px;
    font-size: 0.7rem;
    color: var(--text-muted);
  }

  @media (max-width: 768px) {
    .weave-table-row td {
      padding: 4px 10px;
    }

    .weave-table-row .weave-checkbox-column {
      width: 42px;
      min-width: 42px;
      max-width: 42px;
      padding: 4px 10px;
    }

    .weave-actions-column {
      width: 52px;
      min-width: 52px;
      max-width: 52px;
    }

    .weave-text-content-primary {
      font-size: 12px;
    }

    .weave-text-content-secondary,
    .weave-text-content {
      font-size: 11px;
    }

    .weave-text-content-meta,
    .weave-field-template-text,
    .weave-source-status-text {
      font-size: 10px;
    }

    .weave-inline-chip,
    .weave-field-template-chip,
    .weave-source-status-badge,
    .weave-deck-badge {
      min-height: 17px;
      padding: 0 5px;
    }

    .weave-inline-chip,
    .weave-deck-badge {
      font-size: 10px;
    }

    .weave-deck-more {
      padding: 2px 6px;
      font-size: 9px;
    }

    .weave-cell-content,
    .weave-decks-container,
    .weave-tags-container {
      gap: 3px;
    }

    .weave-source-document-column .weave-source-link {
      gap: 3px;
    }
  }
</style>
