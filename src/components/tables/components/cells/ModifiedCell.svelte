<script lang="ts">
  import type { Card } from '../../../../data/types';
  import { getCardModifiedTime } from '../../../../utils/card-review-data-utils';

  interface Props {
    card: Card;
  }

  let { card }: Props = $props();

  const modifiedTime = $derived(getCardModifiedTime(card));
  const formattedTime = $derived.by(() => {
    const now = new Date();
    const diff = now.getTime() - modifiedTime.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) return '今天';
    if (days === 1) return '昨天';
    if (days < 7) return `${days}天前`;
    if (days < 30) return `${Math.floor(days / 7)}周前`;
    if (days < 365) return `${Math.floor(days / 30)}个月前`;
    return `${Math.floor(days / 365)}年前`;
  });
</script>

<td class="modified-cell" title={modifiedTime.toLocaleString()}>
  <span class="modified-text">{formattedTime}</span>
</td>

<style>
  .modified-cell {
    padding: var(--weave-table-cell-padding-y, 6px) var(--weave-table-cell-padding-x, 16px);
    border-right: 1px solid var(--weave-table-grid-border-color, var(--background-modifier-border));
    border-bottom: 1px solid var(--weave-table-grid-border-color, var(--background-modifier-border));
    vertical-align: middle;
    font-variant-numeric: tabular-nums;
  }

  .modified-text {
    color: var(--text-faint);
    font-size: 11px;
    font-weight: 500;
  }
</style>
