<script lang="ts">
  import type { AIActionType } from '../../types/ai-types';
  import { tr } from '../../utils/i18n';
  
  interface Props {
    activeType: AIActionType;
    formatCount: number;
    splitCount: number;
    onTypeChange: (type: AIActionType) => void;
  }
  
  let { activeType, formatCount, splitCount, onTypeChange }: Props = $props();

  let t = $derived($tr);
</script>

<div class="action-type-tab-bar">
  <button
    class="tab-btn"
    class:active={activeType === 'format'}
    onclick={() => onTypeChange('format')}
  >
    <span>{t('study.actionTypeTab.aiFormat')}</span>
    <span class="count-badge">{formatCount}</span>
  </button>
  
  <button
    class="tab-btn"
    class:active={activeType === 'split'}
    onclick={() => onTypeChange('split')}
  >
    <span>{t('study.actionTypeTab.aiSplit')}</span>
    <span class="count-badge">{splitCount}</span>
  </button>
</div>

<style>
  .action-type-tab-bar {
    display: flex;
    gap: 6px;
    border-bottom: none;
    margin-bottom: 0;
    overflow-x: auto;
    background: transparent;
    scrollbar-width: none;
  }

  .action-type-tab-bar::-webkit-scrollbar {
    display: none;
  }
  
  .tab-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 9px 18px;
    min-width: fit-content;
    white-space: nowrap;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 999px;
    margin-bottom: 0;
    color: var(--text-muted);
    font-size: 0.875rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.18s ease;
    position: relative;
  }
  
  .tab-btn:hover {
    color: var(--text-normal);
    background: color-mix(in srgb, var(--background-modifier-hover) 86%, transparent);
  }
  
  .tab-btn.active {
    background: var(--background-primary);
    color: var(--text-normal);
    border-color: color-mix(in srgb, var(--background-modifier-border) 72%, transparent);
    box-shadow: 0 8px 20px rgba(15, 23, 42, 0.08), 0 1px 2px rgba(15, 23, 42, 0.06);
  }
  
  .tab-btn:focus-visible {
    outline: 2px solid var(--interactive-accent);
    outline-offset: 1px;
  }
  
  .count-badge {
    padding: 2px 7px;
    background: color-mix(in srgb, var(--background-modifier-border) 88%, transparent);
    color: var(--text-muted);
    font-size: 0.625rem;
    font-weight: 700;
    border-radius: 999px;
    transition: all 0.2s ease;
    min-width: fit-content;
  }
  
  .tab-btn.active .count-badge {
    background: color-mix(in srgb, var(--interactive-accent) 18%, var(--background-primary));
    color: var(--interactive-accent);
  }
  
  .tab-btn:hover .count-badge {
    transform: scale(1.05);
  }

  @media (max-width: 768px) {
    .tab-btn {
      border: none;
      box-shadow: none;
    }

    .tab-btn.active {
      border: none;
      box-shadow: none;
    }
  }
</style>
