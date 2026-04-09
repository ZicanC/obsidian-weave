<script lang="ts">
  import { Menu, Platform } from 'obsidian';
  import type { PriorityCellProps } from "../../types/table-types";

  let { card, onPriorityUpdate }: PriorityCellProps = $props();

  const isMobile = Platform.isMobile;

  const priorityConfig: Record<number, { label: string; short: string; tone: string }> = {
    1: { label: '低', short: 'P1', tone: 'gray' },
    2: { label: '中', short: 'P2', tone: 'blue' },
    3: { label: '高', short: 'P3', tone: 'orange' },
    4: { label: '紧急', short: 'P4', tone: 'red' },
  };

  let currentPriority = $derived(card.priority || 2);
  let config = $derived(priorityConfig[currentPriority] || priorityConfig[2]);

  function showPriorityMenu(event: MouseEvent) {
    if (!onPriorityUpdate) return;

    const menu = new Menu();
    [1, 2, 3, 4].forEach((priority) => {
      const itemConfig = priorityConfig[priority];
      menu.addItem((item) => {
        item
          .setTitle(`${itemConfig.short} · ${itemConfig.label}`)
          .setIcon(priority === currentPriority ? 'check' : 'circle')
          .onClick(() => onPriorityUpdate(card.uuid, priority));
      });
    });

    menu.showAtMouseEvent(event);
  }

  function handleDesktopClick() {
    if (!onPriorityUpdate) return;
    const nextPriority = currentPriority >= 4 ? 1 : currentPriority + 1;
    onPriorityUpdate(card.uuid, nextPriority);
  }
</script>

<td class="weave-priority-column">
  <button
    class="weave-priority-badge tone-{config.tone}"
    onclick={isMobile ? showPriorityMenu : handleDesktopClick}
    aria-label={`优先级 ${config.short} ${config.label}`}
    title={isMobile ? '点击选择优先级' : `优先级 ${config.label}，点击切换`}
    type="button"
  >
    <span class="priority-dot"></span>
    <span class="priority-text">{config.short}</span>
  </button>
</td>

<style>
  .weave-priority-column {
    width: 64px;
    min-width: 64px;
    max-width: 64px;
    text-align: center;
    padding: var(--weave-table-cell-padding-y, 6px) var(--weave-table-cell-padding-x, 16px);
    border-right: 1px solid var(--weave-table-grid-border-color, var(--background-modifier-border));
    border-bottom: 1px solid var(--weave-table-grid-border-color, var(--background-modifier-border));
    vertical-align: middle;
    box-sizing: border-box;
  }

  .weave-priority-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    min-width: 42px;
    min-height: var(--weave-table-pill-height, 22px);
    padding: 0 var(--weave-table-pill-padding-x, 8px);
    border: 1px solid transparent;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 700;
    cursor: pointer;
    transition: transform 0.16s ease, filter 0.16s ease, border-color 0.16s ease;
  }

  .priority-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
    opacity: 0.9;
  }

  .priority-text {
    line-height: 1;
  }

  .weave-priority-badge.tone-gray {
    background: color-mix(in srgb, var(--color-gray) 12%, transparent);
    color: var(--color-gray);
    border-color: color-mix(in srgb, var(--color-gray) 20%, transparent);
  }

  .weave-priority-badge.tone-blue {
    background: color-mix(in srgb, var(--color-blue) 12%, transparent);
    color: var(--color-blue);
    border-color: color-mix(in srgb, var(--color-blue) 20%, transparent);
  }

  .weave-priority-badge.tone-orange {
    background: color-mix(in srgb, var(--color-orange) 12%, transparent);
    color: var(--color-orange);
    border-color: color-mix(in srgb, var(--color-orange) 22%, transparent);
  }

  .weave-priority-badge.tone-red {
    background: color-mix(in srgb, var(--color-red) 12%, transparent);
    color: var(--color-red);
    border-color: color-mix(in srgb, var(--color-red) 22%, transparent);
  }

  .weave-priority-badge:hover {
    transform: translateY(-1px);
    filter: brightness(1.04);
  }

  .weave-priority-badge:active {
    transform: scale(0.97);
  }

  @media (max-width: 768px) {
    .weave-priority-column {
      width: 72px;
      min-width: 72px;
      max-width: 72px;
      padding: 6px 10px;
    }

    .weave-priority-badge {
      gap: 4px;
      min-width: 50px;
      min-height: 17px;
      padding: 0 7px;
      font-size: 11px;
      border-radius: 10px;
    }

    .priority-dot {
      width: 4px;
      height: 4px;
      opacity: 0.78;
    }
  }
</style>
