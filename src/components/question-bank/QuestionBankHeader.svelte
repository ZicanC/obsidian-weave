<script lang="ts">
  import { Platform } from "obsidian";
  import ObsidianIcon from "../ui/ObsidianIcon.svelte";
  import FlipClock from "./FlipClock.svelte";

  interface Props {
    bankName: string;
    currentIndex: number;
    totalQuestions: number;
    statsCollapsed: boolean;
    showSidebar: boolean;
    showSidebarToggle?: boolean;
    showNavigator?: boolean;
    showNavigatorToggle?: boolean;
    onToggleStats: () => void;
    onToggleSidebar: () => void;
    onToggleNavigator?: () => void;
    mode?: "exam";
    remainingTime?: number;
    isPaused?: boolean;
    isTimeWarning?: boolean;
    onTogglePause?: () => void;
  }

  let {
    bankName,
    currentIndex,
    totalQuestions,
    statsCollapsed,
    showSidebar,
    showSidebarToggle = true,
    showNavigator = true,
    showNavigatorToggle = true,
    onToggleStats,
    onToggleSidebar,
    onToggleNavigator,
    mode = "exam",
    remainingTime = 0,
    isPaused = false,
    isTimeWarning = false,
    onTogglePause
  }: Props = $props();

  const isMobile = Platform.isMobile;
</script>

{#if !isMobile}
  <div class="study-header">
    <div class="header-left">
      <h2 class="study-title">{bankName || "考试测试"}</h2>
      <div class="study-progress">
        <span class="progress-text" aria-label={`学习进度 ${currentIndex} / ${totalQuestions}`}>
          <span class="progress-current">{currentIndex}</span>
          <span class="progress-divider">/</span>
          <span class="progress-total">{totalQuestions}</span>
        </span>
      </div>

      {#if mode === "exam"}
        <div class="clock-container">
          <FlipClock
            remainingTime={Math.floor(remainingTime / 1000)}
            {isPaused}
            {isTimeWarning}
          />

          {#if onTogglePause}
            <button
              type="button"
              class="clickable-icon study-header-icon-btn pause-btn"
              onclick={onTogglePause}
              aria-label={isPaused ? "继续倒计时" : "暂停倒计时"}
              title={isPaused ? "继续" : "暂停"}
            >
              <ObsidianIcon name={isPaused ? "play" : "pause"} size={14} />
            </button>
          {/if}
        </div>
      {/if}
    </div>

    <div class="header-center">
      <div class="header-dots-container">
        <span class="header-dot" style="background: linear-gradient(135deg, #ef4444, #dc2626)" title="增量阅读"></span>
        <span class="header-dot" style="background: linear-gradient(135deg, #3b82f6, #2563eb)" title="记忆牌组"></span>
        <span class="header-dot" style="background: linear-gradient(135deg, #10b981, #059669)" title="考试题组"></span>
      </div>
    </div>

    <div class="header-right">
      {#if showNavigatorToggle && onToggleNavigator}
        <button
          type="button"
          class="clickable-icon study-header-icon-btn"
          class:active={showNavigator}
          onclick={onToggleNavigator}
          aria-label={showNavigator ? "隐藏题目导航" : "显示题目导航"}
          title={showNavigator ? "隐藏题目导航" : "显示题目导航"}
        >
          <ObsidianIcon name="panel-left" size={16} />
        </button>
      {/if}

      <button
        type="button"
        class="clickable-icon study-header-icon-btn"
        onclick={onToggleStats}
        aria-label={statsCollapsed ? "展开统计" : "收起统计"}
        title={statsCollapsed ? "展开统计" : "收起统计"}
      >
        <ObsidianIcon name={statsCollapsed ? "chevron-down" : "chevron-up"} size={16} />
      </button>

      {#if showSidebarToggle}
        <button
          type="button"
          class="clickable-icon study-header-icon-btn"
          class:active={showSidebar}
          onclick={onToggleSidebar}
          aria-label={showSidebar ? "隐藏侧边栏" : "显示侧边栏"}
          title={showSidebar ? "隐藏侧边栏" : "显示侧边栏"}
        >
          <ObsidianIcon name="panel-right" size={16} />
        </button>
      {/if}
    </div>
  </div>
{/if}

<style>
  .study-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem 1.5rem;
    border-bottom: 1px solid var(--background-modifier-border);
    background: var(--background-secondary);
    flex-shrink: 0;
    position: relative;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 1rem;
    flex: 1;
    min-width: 0;
  }

  .study-title {
    font-size: 1.125rem;
    font-weight: 700;
    color: var(--text-normal);
    margin: 0;
    white-space: nowrap;
  }

  .study-progress {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    padding: 0.22rem 0.5rem;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--background-modifier-border) 78%, transparent);
    background: color-mix(in srgb, var(--background-primary) 90%, var(--background-secondary) 10%);
    min-width: 0;
  }

  .progress-text {
    display: inline-flex;
    align-items: baseline;
    gap: 0.2rem;
    padding: 0.1rem 0.45rem;
    border-radius: 999px;
    font-size: 0.8125rem;
    color: var(--text-muted);
    font-weight: 600;
    min-width: 66px;
    background: color-mix(in srgb, var(--background-modifier-hover) 86%, transparent);
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.02em;
    justify-content: center;
  }

  .progress-current {
    color: var(--text-normal);
    font-weight: 700;
  }

  .progress-divider {
    color: var(--text-faint);
    font-weight: 500;
  }

  .progress-total {
    color: var(--text-muted);
  }

  .header-center {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    display: flex;
    justify-content: center;
    align-items: center;
    pointer-events: auto;
  }

  .header-dots-container {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 14px;
  }

  .header-dot {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
    transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .header-dot:hover {
    transform: scale(1.25);
    box-shadow: 0 3px 8px rgba(0, 0, 0, 0.3);
  }

  .header-right {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    flex-shrink: 0;
  }

  .study-header-icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    padding: 0;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--icon-color);
    cursor: pointer;
    transition: background-color 0.15s ease, color 0.15s ease;
    position: relative;
  }

  .study-header-icon-btn:hover:not(:disabled) {
    background: var(--background-modifier-hover);
    color: var(--icon-color-hover, var(--text-normal));
  }

  .study-header-icon-btn.active {
    background: color-mix(in srgb, var(--interactive-accent) 14%, transparent);
    color: var(--interactive-accent);
  }

  .study-header-icon-btn:active:not(:disabled) {
    background: var(--background-modifier-active-hover, var(--background-modifier-border));
  }

  .study-header-icon-btn:focus-visible {
    outline: 2px solid var(--interactive-accent);
    outline-offset: 2px;
  }

  .study-header-icon-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .clock-container {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-left: auto;
    margin-right: 1rem;
  }

  .pause-btn {
    color: var(--interactive-accent);
    background: color-mix(in srgb, var(--interactive-accent) 12%, transparent);
  }

  .pause-btn:hover:not(:disabled) {
    background: color-mix(in srgb, var(--interactive-accent) 20%, transparent);
    color: var(--interactive-accent);
  }
</style>
