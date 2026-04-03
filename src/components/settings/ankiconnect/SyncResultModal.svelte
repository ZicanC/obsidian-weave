<script lang="ts">
  import { fade } from 'svelte/transition';
  import type {
    ExportResult,
    ModelMismatchRepairResult,
    SyncFailureReason,
    SyncItemWarning,
    SyncWarningReason
  } from '../../../types/ankiconnect-types';

  interface Props {
    open: boolean;
    title: string;
    result: ExportResult | null;
    repairResult?: ModelMismatchRepairResult | null;
    repairedCardIds?: string[];
    isRepairing?: boolean;
    onRepairModelMismatch?: () => void | Promise<void>;
    onClose?: () => void;
  }

  let {
    open = false,
    title = '同步结果',
    result = null,
    repairResult = null,
    repairedCardIds = [],
    isRepairing = false,
    onRepairModelMismatch,
    onClose
  }: Props = $props();

  const failureLabels: Record<SyncFailureReason, string> = {
    empty_content: '内容为空',
    missing_primary_field: '缺少主字段',
    template_not_found: '模板缺失',
    model_creation_failed: '模型创建失败',
    model_unavailable: '模型不可用',
    model_mismatch: '模型不一致',
    lookup_failed: '索引查询失败',
    duplicate_content: '内容重复',
    upload_failed: '上传失败',
    unknown: '其它错误'
  };

  const warningLabels: Record<SyncWarningReason, string> = {
    missing_source_file: '缺少来源文件'
  };

  let repairedCardIdSet = $derived(new Set(repairedCardIds ?? []));
  let mismatchItems = $derived((result?.items ?? []).filter(item => item.reason === 'model_mismatch'));
  let pendingMismatchItems = $derived(
    mismatchItems.filter(item => !repairedCardIdSet.has(item.cardId))
  );
  let repairedMismatchItems = $derived(
    mismatchItems.filter(item => repairedCardIdSet.has(item.cardId))
  );
  let failedItems = $derived(
    (result?.items ?? [])
      .filter(
        item => item.outcome === 'failed' && !(item.reason === 'model_mismatch' && repairedCardIdSet.has(item.cardId))
      )
      .slice(0, 8)
  );
  let warningItems = $derived(
    (result?.items ?? [])
      .filter(item => (item.warnings?.length ?? 0) > 0)
      .slice(0, 8)
      .map(item => ({
        cardId: item.cardId,
        preview: item.preview,
        warnings: item.warnings ?? []
      }))
  );

  function closeModal() {
    onClose?.();
  }

  function getFailureLabel(reason: string): string {
    return failureLabels[reason as SyncFailureReason] ?? reason;
  }

  function getWarningLabel(reason: string): string {
    return warningLabels[reason as SyncWarningReason] ?? reason;
  }

  function getWarningSummary(warnings: SyncItemWarning[]): string {
    return warnings.map(warning => getWarningLabel(warning.reason)).join('、');
  }

  function getModelPair(item: NonNullable<ExportResult['items'][number]>): string {
    const from = item.existingModelName ?? '旧模型';
    const to = item.targetModelName ?? item.modelName ?? '目标模型';
    return `${from} → ${to}`;
  }

  function getRepairSummary(result: ModelMismatchRepairResult): string {
    const remaining = result.failedCards + result.archivedOnlyCards;
    if (remaining === 0) {
      return `已修复 ${result.fixedCards} 张错模型卡片。旧卡已移入 ${result.archiveDeckName} 并暂停，后续同步会继续按正确模板增量更新。`;
    }

    return `本次已修复 ${result.fixedCards} 张，另有 ${remaining} 张仍需重试。旧卡已归档的部分不会再阻塞后续同步。`;
  }

  function handleRepair() {
    void onRepairModelMismatch?.();
  }
</script>

{#if open && result}
  <div class="sync-result-modal-overlay" role="presentation" transition:fade={{ duration: 180 }}>
    <div class="sync-result-modal" role="dialog" aria-modal="true" aria-labelledby="sync-result-title">
      <div class="modal-header">
        <div>
          <h3 id="sync-result-title" class="modal-title">{title}</h3>
          <p class="modal-subtitle">同步完成后按真实结果分类汇总</p>
        </div>
        <button class="close-btn" type="button" onclick={closeModal}>关闭</button>
      </div>

      <div class="summary-grid">
        <div class="summary-card success">
          <div class="summary-label">新增</div>
          <div class="summary-value">{result.createdCards}</div>
        </div>
        <div class="summary-card accent">
          <div class="summary-label">增量更新</div>
          <div class="summary-value">{result.updatedCards}</div>
        </div>
        <div class="summary-card muted">
          <div class="summary-label">无变化跳过</div>
          <div class="summary-value">{result.unchangedCards}</div>
        </div>
        <div class="summary-card muted">
          <div class="summary-label">重复跳过</div>
          <div class="summary-value">{result.duplicateCards}</div>
        </div>
        <div class="summary-card danger">
          <div class="summary-label">失败</div>
          <div class="summary-value">{result.failedCards}</div>
        </div>
        <div class="summary-card warning">
          <div class="summary-label">警告</div>
          <div class="summary-value">{result.warningCards}</div>
        </div>
      </div>

      <div class="totals-row">
        <span>总卡片 {result.totalCards}</span>
        <span>实际写入 {result.exportedCards}</span>
        <span>跳过 {result.skippedCards}</span>
      </div>

      {#if Object.keys(result.summary.failureReasons).length > 0}
        <section class="details-section">
          <h4>失败分类</h4>
          <div class="reason-list">
            {#each Object.entries(result.summary.failureReasons) as [reason, count]}
              <div class="reason-item">
                <span>{getFailureLabel(reason)}</span>
                <strong>{count}</strong>
              </div>
            {/each}
          </div>
        </section>
      {/if}

      {#if Object.keys(result.summary.warningReasons).length > 0}
        <section class="details-section">
          <h4>警告分类</h4>
          <div class="reason-list">
            {#each Object.entries(result.summary.warningReasons) as [reason, count]}
              <div class="reason-item">
                <span>{getWarningLabel(reason)}</span>
                <strong>{count}</strong>
              </div>
            {/each}
          </div>
        </section>
      {/if}

      {#if mismatchItems.length > 0}
        <section class="details-section">
          <h4>错模型修复</h4>
          <div class="repair-card">
            <div class="repair-title">检测到 {mismatchItems.length} 张历史错模型卡片</div>
            <div class="repair-text">
              这些卡片过去已经同步进 Anki，但使用了错误的笔记类型。修复时会先把旧卡移入
              <strong>{repairResult?.archiveDeckName ?? 'Weave::模型迁移存档'}</strong>
              并暂停，再按正确模板重建新卡，尽量保留旧卡的历史记录。
            </div>

            <div class="repair-stats">
              <span class="repair-chip neutral">待修复 {pendingMismatchItems.length}</span>
              {#if repairedMismatchItems.length > 0}
                <span class="repair-chip success">已修复 {repairedMismatchItems.length}</span>
              {/if}
            </div>

            {#if repairResult}
              <div
                class="repair-feedback"
                class:repair-feedback-success={repairResult.success}
                class:repair-feedback-warning={!repairResult.success}
              >
                {getRepairSummary(repairResult)}
              </div>
            {/if}

            {#if pendingMismatchItems.length > 0}
              <button class="repair-btn" type="button" disabled={isRepairing} onclick={handleRepair}>
                {isRepairing ? '正在修复...' : `自动修复剩余 ${pendingMismatchItems.length} 张`}
              </button>
            {/if}

            <div class="item-list compact">
              {#each pendingMismatchItems.slice(0, 6) as item}
                <div class="item-row">
                  <div class="item-main">
                    <div class="item-preview">{item.preview}</div>
                    <div class="item-meta">{getModelPair(item)} · {item.message}</div>
                  </div>
                </div>
              {/each}
            </div>
          </div>
        </section>
      {/if}

      {#if failedItems.length > 0}
        <section class="details-section">
          <h4>最近失败卡片</h4>
          <div class="item-list">
            {#each failedItems as item}
              <div class="item-row">
                <div class="item-main">
                  <div class="item-preview">{item.preview}</div>
                  <div class="item-meta">{getFailureLabel(item.reason ?? 'unknown')} · {item.message}</div>
                </div>
              </div>
            {/each}
          </div>
        </section>
      {/if}

      {#if warningItems.length > 0}
        <section class="details-section">
          <h4>最近警告卡片</h4>
          <div class="item-list">
            {#each warningItems as item}
              <div class="item-row">
                <div class="item-main">
                  <div class="item-preview">{item.preview}</div>
                  <div class="item-meta">{getWarningSummary(item.warnings)}</div>
                </div>
              </div>
            {/each}
          </div>
        </section>
      {/if}
    </div>
  </div>
{/if}

<style>
  .sync-result-modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 24px;
    z-index: var(--layer-notice);
    backdrop-filter: blur(4px);
  }

  .sync-result-modal {
    width: min(860px, 100%);
    max-height: 85vh;
    overflow: auto;
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 16px;
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.22);
    padding: 20px;
  }

  .modal-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 18px;
  }

  .modal-title {
    margin: 0;
    font-size: 1.15rem;
    font-weight: 700;
  }

  .modal-subtitle {
    margin: 6px 0 0;
    color: var(--text-muted);
    font-size: 0.9rem;
  }

  .close-btn {
    border: 1px solid var(--background-modifier-border);
    background: var(--background-secondary);
    color: var(--text-normal);
    padding: 8px 14px;
    border-radius: 10px;
    cursor: pointer;
  }

  .summary-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 12px;
    margin-bottom: 14px;
  }

  .summary-card {
    border-radius: 14px;
    padding: 14px 16px;
    border: 1px solid transparent;
    background: var(--background-secondary);
  }

  .summary-card.success {
    background: color-mix(in srgb, var(--color-green, #2e8b57) 14%, var(--background-secondary));
    border-color: color-mix(in srgb, var(--color-green, #2e8b57) 30%, transparent);
  }

  .summary-card.accent {
    background: color-mix(in srgb, var(--interactive-accent) 16%, var(--background-secondary));
    border-color: color-mix(in srgb, var(--interactive-accent) 34%, transparent);
  }

  .summary-card.warning {
    background: color-mix(in srgb, var(--color-orange, #d97706) 18%, var(--background-secondary));
    border-color: color-mix(in srgb, var(--color-orange, #d97706) 32%, transparent);
  }

  .summary-card.danger {
    background: color-mix(in srgb, var(--color-red, #dc2626) 14%, var(--background-secondary));
    border-color: color-mix(in srgb, var(--color-red, #dc2626) 28%, transparent);
  }

  .summary-card.muted {
    border-color: var(--background-modifier-border);
  }

  .summary-label {
    color: var(--text-muted);
    font-size: 0.85rem;
  }

  .summary-value {
    margin-top: 8px;
    font-size: 1.6rem;
    font-weight: 700;
    line-height: 1;
  }

  .totals-row {
    display: flex;
    gap: 16px;
    flex-wrap: wrap;
    color: var(--text-muted);
    font-size: 0.9rem;
    margin-bottom: 18px;
  }

  .details-section + .details-section {
    margin-top: 18px;
  }

  .details-section h4 {
    margin: 0 0 10px;
    font-size: 0.95rem;
    font-weight: 700;
  }

  .repair-card {
    display: grid;
    gap: 12px;
    padding: 14px 16px;
    border-radius: 14px;
    background: color-mix(in srgb, var(--interactive-accent) 10%, var(--background-secondary));
    border: 1px solid color-mix(in srgb, var(--interactive-accent) 24%, transparent);
  }

  .repair-title {
    font-weight: 700;
    color: var(--text-normal);
  }

  .repair-text {
    color: var(--text-muted);
    font-size: 0.9rem;
    line-height: 1.55;
  }

  .repair-stats {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .repair-chip {
    display: inline-flex;
    align-items: center;
    border-radius: 999px;
    padding: 4px 10px;
    font-size: 0.82rem;
    font-weight: 600;
  }

  .repair-chip.neutral {
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
  }

  .repair-chip.success {
    background: color-mix(in srgb, var(--color-green, #2e8b57) 16%, var(--background-primary));
    border: 1px solid color-mix(in srgb, var(--color-green, #2e8b57) 28%, transparent);
  }

  .repair-feedback {
    padding: 10px 12px;
    border-radius: 12px;
    font-size: 0.88rem;
    line-height: 1.5;
  }

  .repair-feedback-success {
    background: color-mix(in srgb, var(--color-green, #2e8b57) 14%, var(--background-primary));
    border: 1px solid color-mix(in srgb, var(--color-green, #2e8b57) 28%, transparent);
  }

  .repair-feedback-warning {
    background: color-mix(in srgb, var(--color-orange, #d97706) 15%, var(--background-primary));
    border: 1px solid color-mix(in srgb, var(--color-orange, #d97706) 28%, transparent);
  }

  .repair-btn {
    justify-self: start;
    border: none;
    border-radius: 10px;
    padding: 10px 14px;
    font-weight: 700;
    cursor: pointer;
    color: white;
    background: linear-gradient(135deg, #1f7a59 0%, #2a9d69 100%);
  }

  .repair-btn:disabled {
    opacity: 0.72;
    cursor: wait;
  }

  .reason-list,
  .item-list {
    display: grid;
    gap: 10px;
  }

  .item-list.compact .item-row {
    padding: 8px 10px;
  }

  .reason-item,
  .item-row {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    align-items: center;
    padding: 10px 12px;
    border-radius: 12px;
    background: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
  }

  .item-main {
    min-width: 0;
  }

  .item-preview {
    font-weight: 600;
    color: var(--text-normal);
    word-break: break-word;
  }

  .item-meta {
    margin-top: 4px;
    color: var(--text-muted);
    font-size: 0.85rem;
    word-break: break-word;
  }

  @media (max-width: 720px) {
    .summary-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .sync-result-modal {
      padding: 16px;
    }
  }
</style>
