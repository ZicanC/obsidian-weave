<script lang="ts">
  import { onMount } from 'svelte';
  import type { Deck } from '../../../data/types';
  import type WeavePlugin from '../../../main';
  import type { TestAttempt } from '../../../types/question-bank-types';
  import { logger } from '../../../utils/logger';
  import { groupAttemptsByDate, loadQuestionBankAttempts } from '../../../utils/question-bank-analytics';
  import ObsidianIcon from '../../ui/ObsidianIcon.svelte';

  interface Props {
    questionBank: Deck;
    plugin: WeavePlugin;
  }

  type MonthInfo = {
    value: number;
    year: number;
    label: string;
    fullLabel: string;
  };

  type DateItem = {
    date: string;
    day: number;
    dayName: string;
    tests: TestAttempt[];
  };

  let { questionBank, plugin }: Props = $props();

  const monthNames = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];

  let attempts = $state<TestAttempt[]>([]);
  let testData = $state<Record<string, TestAttempt[]>>({});
  let centerMonthOffset = $state(0);
  let currentMonth = $state(new Date().getMonth() + 1);
  let currentYear = $state(new Date().getFullYear());
  let selectedDate = $state(new Date().toISOString().split('T')[0]);
  let windowWidth = $state(0);
  let dateSelectionContainer: HTMLElement;
  let isLoading = $state(true);

  function getAvailableMonths(): MonthInfo[] {
    const now = new Date();
    const months: MonthInfo[] = [];

    for (let offset = -1; offset <= 1; offset++) {
      const target = new Date(now.getFullYear(), now.getMonth() + centerMonthOffset + offset, 1);
      months.push({
        value: target.getMonth() + 1,
        year: target.getFullYear(),
        label: monthNames[target.getMonth()],
        fullLabel: `${target.getFullYear()}年${monthNames[target.getMonth()]}`
      });
    }

    return months;
  }

  const availableMonths = $derived(getAvailableMonths());

  function getCurrentMonthDates(): DateItem[] {
    const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();
    const items: DateItem[] = [];

    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(currentYear, currentMonth - 1, day);
      const dateStr = date.toISOString().split('T')[0];
      items.push({
        date: dateStr,
        day,
        dayName: date.toLocaleDateString('zh-CN', { weekday: 'short' }),
        tests: testData[dateStr] || []
      });
    }

    return items;
  }

  const dateList = $derived.by(() => {
    windowWidth;
    selectedDate;
    currentMonth;
    currentYear;
    testData;

    const allDates = getCurrentMonthDates();
    const selectedIndex = allDates.findIndex((item) => item.date === selectedDate);

    if (selectedIndex < 0) {
      return allDates;
    }

    const viewportWidth = typeof window !== 'undefined' ? window.innerWidth * 0.68 : 860;
    const visibleCount = Math.max(7, Math.floor(viewportWidth / 68));
    const startIndex = Math.max(0, selectedIndex - Math.floor(visibleCount / 2));
    const endIndex = Math.min(allDates.length, startIndex + visibleCount + 4);
    return allDates.slice(startIndex, endIndex);
  });

  function getTestsForDate(date: string): TestAttempt[] {
    return testData[date] || [];
  }

  const selectedTests = $derived(getTestsForDate(selectedDate));

  function formatTime(timestamp: string) {
    return new Date(timestamp).toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function formatDuration(timeSpent?: number) {
    if (!timeSpent) return '-';
    const minutes = Math.max(1, Math.round(timeSpent / 60000));
    return `${minutes}分钟`;
  }

  function getScoreLevel(score?: number) {
    if ((score ?? 0) >= 85) return 'high';
    if ((score ?? 0) >= 70) return 'medium';
    return 'low';
  }

  function getScoreLevelIcon(score?: number) {
    if ((score ?? 0) >= 85) return 'trophy';
    if ((score ?? 0) >= 70) return 'medal';
    return 'flag';
  }

  function getActivityDotClass(test: TestAttempt) {
    return `dot ${getScoreLevel(test.score)}-score`;
  }

  function syncDisplayedMonth(dateStr: string) {
    const date = new Date(dateStr);
    currentMonth = date.getMonth() + 1;
    currentYear = date.getFullYear();
  }

  function scrollToCenter(targetDate = selectedDate) {
    if (!dateSelectionContainer || typeof window === 'undefined') {
      return;
    }

    requestAnimationFrame(() => {
      const targetElement = dateSelectionContainer.querySelector(`[data-date="${targetDate}"]`) as HTMLElement | null;
      if (!targetElement) {
        return;
      }

      const containerRect = dateSelectionContainer.getBoundingClientRect();
      const elementRect = targetElement.getBoundingClientRect();
      const scrollOffset = elementRect.left - containerRect.left - containerRect.width / 2 + elementRect.width / 2;
      dateSelectionContainer.scrollBy({ left: scrollOffset, behavior: 'smooth' });
    });
  }

  function pickInitialDate(groupedData: Record<string, TestAttempt[]>) {
    const sortedDates = Object.keys(groupedData).sort();
    const latest = sortedDates.at(-1);
    selectedDate = latest ?? new Date().toISOString().split('T')[0];
    syncDisplayedMonth(selectedDate);
  }

  function selectDate(date: string) {
    selectedDate = date;
    syncDisplayedMonth(date);
    setTimeout(() => scrollToCenter(date), 80);
  }

  function changeMonth(direction: number) {
    centerMonthOffset += direction;
    const middleMonth = availableMonths[1];
    currentMonth = middleMonth.value;
    currentYear = middleMonth.year;

    const monthDates = getCurrentMonthDates();
    const firstDateWithData = monthDates.find((item) => item.tests.length > 0);
    selectedDate = firstDateWithData?.date ?? monthDates[0]?.date ?? selectedDate;

    setTimeout(() => scrollToCenter(selectedDate), 80);
  }

  function goToToday() {
    selectDate(new Date().toISOString().split('T')[0]);
  }

  function handleResize() {
    if (typeof window !== 'undefined') {
      windowWidth = window.innerWidth;
      setTimeout(() => scrollToCenter(), 120);
    }
  }

  onMount(() => {
    const loadData = async () => {
      try {
        attempts = await loadQuestionBankAttempts(plugin, questionBank.id);
        testData = groupAttemptsByDate(attempts);
        pickInitialDate(testData);
      } catch (error) {
        logger.error('[QuestionBankHistoryTab] 加载题库历史记录失败:', error);
        testData = {};
        pickInitialDate({});
      } finally {
        isLoading = false;
        setTimeout(() => scrollToCenter(), 180);
      }
    };

    void loadData();

    if (typeof window !== 'undefined') {
      windowWidth = window.innerWidth;
      window.addEventListener('resize', handleResize);
    }

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('resize', handleResize);
      }
    };
  });
</script>

<div class="history-tab">
  <div class="calendar-container">
    <div class="month-selector">
      <button class="month-nav prev" onclick={() => changeMonth(-1)}>
        <ObsidianIcon name="chevron-left" size={16} />
      </button>

      <div class="month-tabs">
        {#each availableMonths as month}
          <button
            class="month-tab"
            class:active={currentMonth === month.value && currentYear === month.year}
            onclick={() => {
              currentMonth = month.value;
              currentYear = month.year;
              const firstDateWithData = getCurrentMonthDates().find((item) => item.tests.length > 0);
              selectedDate = firstDateWithData?.date ?? getCurrentMonthDates()[0]?.date ?? selectedDate;
              setTimeout(() => scrollToCenter(selectedDate), 80);
            }}
          >
            {month.label}
          </button>
        {/each}
      </div>

      <button class="month-nav next" onclick={() => changeMonth(1)}>
        <ObsidianIcon name="chevron-right" size={16} />
      </button>
    </div>

    <div class="history-filter">
      <button class="today-btn" onclick={goToToday} title="跳转到今天">
        <ObsidianIcon name="calendar" size={14} />
        今天
      </button>
    </div>

    <div class="date-selector" bind:this={dateSelectionContainer}>
      {#each dateList as dateItem}
        <button
          class="date-item"
          class:active={selectedDate === dateItem.date}
          data-date={dateItem.date}
          onclick={() => selectDate(dateItem.date)}
        >
          <div class="date-number">{dateItem.day}</div>
          <div class="date-day">{dateItem.dayName}</div>
          <div class="activity-dots">
            {#each dateItem.tests as test}
              <div class={getActivityDotClass(test)}></div>
            {/each}
          </div>
        </button>
      {/each}
    </div>
  </div>

  <div class="test-records">
    <h4>{new Date(selectedDate).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })} 测试记录</h4>
    <div class="test-list">
      {#if isLoading}
        <div class="no-tests">正在加载测试记录</div>
      {:else}
        {#each selectedTests as test}
          <div class="test-item {getScoreLevel(test.score)}-score">
            <div class="test-info">
              <div class="test-date">{formatTime(test.timestamp)}</div>
              <div class="test-mode">考试模式</div>
            </div>
            <div class="test-stats">
              <div class="stat-item">
                <span class="stat-value">{test.score?.toFixed(1) || '-'}%</span>
                <span class="stat-label">得分</span>
              </div>
              <div class="stat-item">
                <span class="stat-value">{formatDuration(test.timeSpent)}</span>
                <span class="stat-label">用时</span>
              </div>
              <div class="stat-item">
                <span class="stat-value score-{getScoreLevel(test.score)}">
                  <i class="fas fa-{getScoreLevelIcon(test.score)}"></i>
                </span>
                <span class="stat-label">等级</span>
              </div>
            </div>
          </div>
        {:else}
          <div class="no-tests">该日期暂无真实测试记录</div>
        {/each}
      {/if}
    </div>
  </div>
</div>

<style>
  .history-tab {
    padding: 16px;
    height: 100%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .calendar-container {
    background: var(--background-secondary);
    border-radius: 10px;
    padding: 16px;
    border: 1px solid var(--background-modifier-border);
    margin-bottom: 16px;
    flex-shrink: 0;
  }

  .month-selector {
    display: flex;
    align-items: center;
    justify-content: stretch;
    margin-bottom: 10px;
    gap: 8px;
    flex-wrap: nowrap;
    min-width: 0;
  }

  .today-btn {
    background: var(--background-modifier-hover);
    border: 1px solid var(--background-modifier-border);
    color: var(--text-normal);
    padding: 6px 10px;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.2s;
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    white-space: nowrap;
  }

  .today-btn:hover {
    background: var(--background-modifier-border);
    border-color: var(--interactive-accent);
  }

  .month-nav {
    background: var(--background-modifier-hover);
    border: none;
    color: var(--text-muted);
    padding: 8px;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.2s;
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 32px;
    height: 32px;
    flex-shrink: 0;
  }

  .month-nav:hover {
    background: var(--background-modifier-border);
    color: var(--text-normal);
  }

  .month-tabs {
    flex: 1;
    min-width: 0;
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
  }

  .month-tab {
    background: transparent;
    border: none;
    color: var(--text-muted);
    padding: 8px 0;
    border-radius: 20px;
    cursor: pointer;
    font-size: 13px;
    font-weight: 500;
    transition: all 0.2s;
    text-align: center;
  }

  .history-filter {
    display: flex;
    justify-content: flex-end;
    margin-bottom: 12px;
  }

  .month-tab:hover {
    background: var(--background-modifier-hover);
    color: var(--text-normal);
  }

  .month-tab.active {
    background: var(--interactive-accent-hover);
    color: var(--interactive-accent);
    border: 1px solid var(--interactive-accent);
  }

  .date-selector {
    display: flex;
    gap: 6px;
    overflow-x: auto;
    overflow-y: hidden;
    padding: 0 4px;
    scrollbar-width: none;
    -ms-overflow-style: none;
  }

  .date-selector::-webkit-scrollbar {
    display: none;
  }

  .date-item {
    background: var(--background-modifier-hover);
    border-radius: 8px;
    padding: 10px 6px 8px;
    min-width: 68px;
    min-height: 54px;
    text-align: center;
    cursor: pointer;
    transition: transform 0.2s ease-out, background-color 0.2s ease-out, border-color 0.2s ease-out;
    border: 2px solid transparent;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
  }

  .date-item:hover {
    background: var(--background-modifier-border);
    transform: translateY(-1px);
  }

  .date-item.active {
    background: color-mix(in srgb, var(--interactive-accent) 18%, var(--background-modifier-hover));
    border-color: var(--interactive-accent);
    color: var(--interactive-accent);
  }

  .date-number {
    font-size: 15px;
    font-weight: 700;
    line-height: 1.15;
    min-height: 18px;
  }

  .date-day {
    font-size: 11px;
    color: var(--text-muted);
    line-height: 1.15;
  }

  .activity-dots {
    display: flex;
    gap: 3px;
    min-height: 8px;
    align-items: center;
  }

  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
  }

  .dot.high-score {
    background: var(--text-success);
  }

  .dot.medium-score {
    background: var(--text-warning);
  }

  .dot.low-score {
    background: var(--text-error);
  }

  .test-records {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .test-records h4 {
    margin: 0 0 16px 0;
    font-size: 1.1rem;
    color: var(--text-normal);
  }

  .test-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
    overflow: auto;
    min-height: 0;
  }

  .test-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 16px;
    background: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 10px;
    transition: all 0.2s ease;
  }

  .test-item:hover {
    background: var(--background-modifier-hover);
  }

  .test-info {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .test-date {
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--text-normal);
  }

  .test-mode {
    font-size: 12px;
    color: var(--text-muted);
  }

  .test-stats {
    display: flex;
    align-items: center;
    gap: 18px;
  }

  .stat-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    min-width: 64px;
  }

  .stat-value {
    font-size: 0.95rem;
    font-weight: 700;
    color: var(--text-normal);
  }

  .stat-label {
    font-size: 11px;
    color: var(--text-muted);
  }

  .score-high {
    color: var(--text-success);
  }

  .score-medium {
    color: var(--text-warning);
  }

  .score-low {
    color: var(--text-error);
  }

  .no-tests {
    flex: 1;
    min-height: 160px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
    background: var(--background-secondary);
    border: 1px dashed var(--background-modifier-border);
    border-radius: 10px;
  }

  @media (max-width: 768px) {
    .history-tab {
      padding: 12px;
    }

    .calendar-container {
      padding: 12px;
      margin-bottom: 12px;
    }

    .month-selector {
      gap: 6px;
      margin-bottom: 8px;
    }

    .month-nav {
      width: 32px;
      min-width: 32px;
      height: 32px;
      padding: 6px;
    }

    .month-tabs {
      gap: 6px;
    }

    .month-tab {
      padding: 8px 0;
      font-size: 14px;
    }

    .history-filter {
      margin-bottom: 10px;
    }

    .today-btn {
      padding: 6px 10px;
      font-size: 12px;
    }

    .date-selector {
      padding: 0 2px;
    }

    .date-item {
      min-width: 64px;
      min-height: 52px;
      padding: 8px 6px 7px;
    }

    .test-item {
      flex-direction: column;
      align-items: flex-start;
    }

    .test-stats {
      width: 100%;
      justify-content: space-between;
    }
  }
</style>
