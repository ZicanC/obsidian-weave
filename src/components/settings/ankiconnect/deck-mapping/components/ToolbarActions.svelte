<!--
  工具栏操作组件
  职责：获取Anki牌组、添加映射按钮等工具栏操作
-->
<script lang="ts">
  import type { AnkiDeckInfo } from '../../../../../types/ankiconnect-types';
  import type { AnkiModelInfo } from '../../../../../types/ankiconnect-types';
  import type { Deck } from '../../../../../data/types';
  import { tr } from '../../../../../utils/i18n';

  let t = $derived($tr);

  interface Props {
    ankiDecks: AnkiDeckInfo[];
    ankiModels: AnkiModelInfo[];
    weaveDecks: Deck[];
    isFetchingDecks: boolean;
    isFetchingModels: boolean;
    isConnected: boolean;
    showAddModal: boolean;
    onFetchDecks: () => Promise<void>;
    onFetchModels: () => Promise<void>;
    onToggleAddModal: () => void;
  }

  let { 
    ankiDecks, 
    ankiModels,
    weaveDecks, 
    isFetchingDecks, 
    isFetchingModels,
    isConnected,
    showAddModal,
    onFetchDecks,
    onFetchModels,
    onToggleAddModal
  }: Props = $props();
</script>

<div class="toolbar">
  <button
    class="btn btn-primary"
    onclick={onFetchDecks}
    disabled={isFetchingDecks}
  >
    {isFetchingDecks ? t('ankiConnect.toolbar.fetching') : t('ankiConnect.toolbar.fetchAnkiDecks')}
  </button>
  {#if ankiDecks.length > 0}
    <span class="deck-count">{t('ankiConnect.toolbar.deckCount', { count: ankiDecks.length })}</span>
    <button
      class="btn btn-secondary"
      onclick={onFetchModels}
      disabled={!isConnected || isFetchingModels}
      type="button"
    >
      {#if isFetchingModels}
        正在获取模板...
      {:else if ankiModels.length > 0}
        刷新模板 ({ankiModels.length})
      {:else}
        获取 Anki 模板
      {/if}
    </button>
  {/if}
  <button
    class="btn btn-success"
    onclick={onToggleAddModal}
    disabled={weaveDecks.length === 0 || ankiDecks.length === 0}
    title={weaveDecks.length === 0 ? t('ankiConnect.toolbar.createWeaveFirst') : ankiDecks.length === 0 ? t('ankiConnect.toolbar.fetchAnkiFirst') : ''}
  >
    {showAddModal ? t('ankiConnect.toolbar.cancelAdd') : t('ankiConnect.toolbar.addMapping')}
  </button>
</div>

<style>
  .toolbar {
    display: flex;
    gap: 12px;
    align-items: center;
    padding: 16px 0;
  }

  .deck-count {
    font-size: 13px;
    color: var(--text-muted);
    padding: 0 8px;
  }

  .btn {
    padding: 8px 16px;
    border: 1px solid transparent;
    border-radius: var(--weave-radius-sm);
    cursor: pointer;
    font-size: 14px;
    font-weight: 500;
    transition: all 0.2s ease;
  }

  .btn-primary {
    background: var(--interactive-accent);
    color: var(--text-on-accent);
  }

  .btn-success {
    background: var(--interactive-accent);
    color: var(--text-on-accent, #ffffff);
    border-color: color-mix(in srgb, var(--interactive-accent) 85%, black 8%);
  }

  .btn-secondary {
    background: var(--background-secondary);
    color: var(--text-normal);
    border: 1px solid var(--background-modifier-border);
  }

  .btn:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* 响应式设计 */
  @media (max-width: 768px) {
    .toolbar {
      flex-direction: column;
      align-items: stretch;
    }

    .deck-count {
      text-align: center;
    }

    .btn-secondary {
      width: 100%;
    }
  }
</style>


