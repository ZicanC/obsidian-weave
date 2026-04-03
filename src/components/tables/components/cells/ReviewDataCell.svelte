<script lang="ts">
  import type { Card } from '../../../../data/types';
  import type { ColumnKey } from '../../types/table-types';
  import {
    formatNextReview,
    getNextReviewColor,
    getRetentionColor,
    formatInterval,
    getDifficultyColor
  } from '../../../../utils/fsrs-display-utils';
  import { deriveReviewData } from '../../../../utils/card-review-data-utils';

  interface Props {
    card: Card;
    column: ColumnKey;
  }

  let { card, column }: Props = $props();

  const reviewData = $derived(deriveReviewData(card));

  const cellContent = $derived.by(() => {
    switch (column) {
      case 'next_review':
        return {
          text: formatNextReview(reviewData.nextReview),
          color: getNextReviewColor(reviewData.nextReview),
          tone: 'strong'
        };
      case 'retention':
        return {
          text: `${Math.round(reviewData.retention * 100)}%`,
          color: getRetentionColor(reviewData.retention),
          tone: 'strong'
        };
      case 'interval':
        return {
          text: formatInterval(reviewData.interval),
          color: 'var(--text-muted)',
          tone: 'soft'
        };
      case 'difficulty':
        return {
          text: reviewData.difficulty.toFixed(1),
          color: getDifficultyColor(reviewData.difficulty),
          tone: 'soft'
        };
      case 'review_count':
        return {
          text: `${reviewData.reviewCount}次`,
          color: 'var(--text-normal)',
          tone: 'count'
        };
      default:
        return { text: '-', color: 'var(--text-muted)', tone: 'soft' };
    }
  });
</script>

<td class="review-data-cell">
  <span class="review-data-text tone-{cellContent.tone}" style="color: {cellContent.color};">
    {cellContent.text}
  </span>
</td>

<style>
  .review-data-cell {
    padding: 10px 16px;
    font-variant-numeric: tabular-nums;
    border-right: 1px solid color-mix(in srgb, var(--background-modifier-border) 45%, transparent);
    vertical-align: middle;
  }

  .review-data-text {
    display: inline-block;
    line-height: 1.1;
  }

  .review-data-text.tone-strong {
    font-size: 12px;
    font-weight: 600;
  }

  .review-data-text.tone-soft {
    font-size: 11px;
    font-weight: 500;
  }

  .review-data-text.tone-count {
    font-size: 12px;
    font-weight: 700;
  }
</style>
