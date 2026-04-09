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

<div class="action-type-tab-bar weave-toolbar-tabs">
  <button
    class="tab-btn weave-toolbar-tab"
    class:active={activeType === 'format'}
    onclick={() => onTypeChange('format')}
  >
    <span>{t('study.actionTypeTab.aiFormat')}</span>
    <span class="count-badge">{formatCount}</span>
  </button>
  
  <button
    class="tab-btn weave-toolbar-tab"
    class:active={activeType === 'split'}
    onclick={() => onTypeChange('split')}
  >
    <span>{t('study.actionTypeTab.aiSplit')}</span>
    <span class="count-badge">{splitCount}</span>
  </button>
</div>

<style>
  .action-type-tab-bar {
    border-bottom: none;
    margin-bottom: 0;
    background: transparent;
  }
  
  .tab-btn {
    gap: 8px;
    min-width: fit-content;
    white-space: nowrap;
    margin-bottom: 0;
    font-weight: 500;
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
    background: color-mix(in srgb, var(--interactive-accent) 16%, var(--background-secondary));
    color: var(--text-accent);
  }
  
  .tab-btn:hover .count-badge {
    transform: scale(1.05);
  }

  @media (max-width: 768px) {
    .tab-btn {
      min-height: 40px;
      padding: 8px 10px;
    }
  }
</style>
