<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { Menu, Platform } from 'obsidian';
  import type AnkiObsidianPlugin from '../../main';
  import ObsidianIcon from '../ui/ObsidianIcon.svelte';
  import * as echarts from 'echarts/core';
  import {
    TooltipComponent,
    GridComponent,
    LegendComponent
  } from 'echarts/components';
  import { BarChart, LineChart, ScatterChart } from 'echarts/charts';
  import { CanvasRenderer } from 'echarts/renderers';
  import {
    IRAnalyticsService,
    type IRAnalyticsSnapshot,
    type IRAnalyticsSourceOption
  } from '../../services/incremental-reading/IRAnalyticsService';
  import { logger } from '../../utils/logger';

  echarts.use([
    TooltipComponent,
    GridComponent,
    LegendComponent,
    BarChart,
    LineChart,
    ScatterChart,
    CanvasRenderer
  ]);

  interface Props {
    plugin: AnkiObsidianPlugin;
  }

  let {
    plugin
  }: Props = $props();

  const quickRangeOptions = [
    { value: 7, label: '最近7天' },
    { value: 14, label: '最近14天' },
    { value: 30, label: '最近30天' },
    { value: 60, label: '最近60天' },
    { value: 90, label: '最近90天' }
  ];

  type AnalyticsTab = 'activity' | 'quantity' | 'timing' | 'difficulty' | 'forecast';

  let activeTab = $state<AnalyticsTab>('activity');
  let selectedDays = $state(30);
  let selectedSourceKey = $state('');
  let chartRef: HTMLDivElement | null = $state(null);
  let chart: echarts.ECharts | null = null;
  let analyticsService = $state<IRAnalyticsService | null>(null);
  let snapshot = $state<IRAnalyticsSnapshot | null>(null);
  let isLoading = $state(false);
  let loadError = $state('');
  let themeObserver: MutationObserver | null = null;
  let loadRequestId = 0;
  let wheelThrottle = false;
  const WHEEL_THROTTLE_MS = 180;

  const isMobile = Platform.isMobile;

  function getThemeColors() {
    const isDark = document.body.classList.contains('theme-dark');
    return {
      textColor: isDark ? '#e5e7eb' : '#24323f',
      subTextColor: isDark ? '#9ca3af' : '#6b7280',
      axisLineColor: isDark ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.18)',
      splitLineColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
      tooltipBg: isDark ? '#15191f' : '#ffffff',
      tooltipBorder: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)',
      series: ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#14b8a6']
    };
  }

  async function getAnalyticsService(): Promise<IRAnalyticsService> {
    if (!analyticsService) {
      analyticsService = new IRAnalyticsService(plugin.app);
      await analyticsService.initialize();
    }
    return analyticsService;
  }

  async function loadAnalytics(): Promise<void> {
    const requestId = ++loadRequestId;
    disposeChart();
    isLoading = true;
    loadError = '';
    try {
      const service = await getAnalyticsService();
      let nextSnapshot = await service.getSnapshot({
        sourceKey: selectedSourceKey || undefined,
        days: selectedDays
      });

      if (selectedSourceKey && !nextSnapshot.scopeKey) {
        selectedSourceKey = '';
        nextSnapshot = await service.getSnapshot({ days: selectedDays });
      }

      if (requestId !== loadRequestId) return;
      snapshot = nextSnapshot;
    } catch (error) {
      if (requestId !== loadRequestId) return;
      logger.error('[IRAnalyticsModal] 加载分析数据失败:', error);
      loadError = '分析数据加载失败';
      snapshot = null;
    } finally {
      if (requestId !== loadRequestId) return;
      isLoading = false;
    }
  }

  function disposeChart(): void {
    chart?.dispose();
    chart = null;
  }

  function ensureChart(): echarts.ECharts | null {
    if (!chartRef) return null;
    if (chart && chart.getDom() !== chartRef) {
      disposeChart();
    }
    if (!chart) {
      chart = echarts.init(chartRef);
    }
    return chart;
  }

  function buildActivityOption(data: IRAnalyticsSnapshot): echarts.EChartsCoreOption {
    const colors = getThemeColors();
    return {
      color: [colors.series[0], colors.series[1], colors.series[3]],
      tooltip: {
        trigger: 'axis',
        backgroundColor: colors.tooltipBg,
        borderColor: colors.tooltipBorder,
        borderWidth: 1,
        textStyle: { color: colors.textColor },
        confine: true
      },
      legend: {
        top: 6,
        left: 'center',
        textStyle: { color: colors.subTextColor }
      },
      grid: {
        left: isMobile ? 34 : 44,
        right: isMobile ? 12 : 20,
        top: 62,
        bottom: 28
      },
      xAxis: {
        type: 'category',
        data: data.activityTrend.map(point => point.label),
        axisLine: { lineStyle: { color: colors.axisLineColor } },
        axisLabel: { color: colors.subTextColor }
      },
      yAxis: {
        type: 'value',
        axisLine: { show: false },
        axisLabel: { color: colors.subTextColor },
        splitLine: { lineStyle: { color: colors.splitLineColor, type: 'dashed' } }
      },
      series: [
        {
          name: '新增材料',
          type: 'line',
          smooth: true,
          symbolSize: 6,
          data: data.activityTrend.map(point => point.createdCount)
        },
        {
          name: '发生交互',
          type: 'line',
          smooth: true,
          symbolSize: 6,
          data: data.activityTrend.map(point => point.interactedCount)
        },
        {
          name: '退出主队列',
          type: 'line',
          smooth: true,
          symbolSize: 6,
          data: data.activityTrend.map(point => point.completedCount)
        }
      ]
    };
  }

  function buildQuantityOption(data: IRAnalyticsSnapshot): echarts.EChartsCoreOption {
    const colors = getThemeColors();
    return {
      color: [colors.series[0], colors.series[1], colors.series[4]],
      tooltip: {
        trigger: 'axis',
        backgroundColor: colors.tooltipBg,
        borderColor: colors.tooltipBorder,
        borderWidth: 1,
        textStyle: { color: colors.textColor },
        confine: true
      },
      legend: {
        top: 6,
        left: 'center',
        textStyle: { color: colors.subTextColor }
      },
      grid: {
        left: isMobile ? 34 : 44,
        right: isMobile ? 12 : 20,
        top: 62,
        bottom: 28
      },
      xAxis: {
        type: 'category',
        data: data.quantityTrend.map(point => point.label),
        axisLine: { lineStyle: { color: colors.axisLineColor } },
        axisLabel: { color: colors.subTextColor }
      },
      yAxis: {
        type: 'value',
        axisLabel: { color: colors.subTextColor },
        splitLine: { lineStyle: { color: colors.splitLineColor, type: 'dashed' } }
      },
      series: [
        {
          name: '累计材料',
          type: 'line',
          smooth: true,
          data: data.quantityTrend.map(point => point.totalCount)
        },
        {
          name: '活跃材料',
          type: 'line',
          smooth: true,
          areaStyle: { opacity: 0.12 },
          data: data.quantityTrend.map(point => point.activeCount)
        },
        {
          name: '已退出主队列',
          type: 'line',
          smooth: true,
          data: data.quantityTrend.map(point => point.closedCount)
        }
      ]
    };
  }

  function buildTimingOption(data: IRAnalyticsSnapshot): echarts.EChartsCoreOption {
    const colors = getThemeColors();
    return {
      color: data.timingBuckets.map(bucket => {
        if (bucket.label.startsWith('已逾期')) return colors.series[3];
        if (bucket.label === '今日到期') return colors.series[2];
        if (bucket.label === '未排期') return colors.series[4];
        return colors.series[0];
      }),
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        backgroundColor: colors.tooltipBg,
        borderColor: colors.tooltipBorder,
        borderWidth: 1,
        textStyle: { color: colors.textColor },
        confine: true
      },
      grid: {
        left: isMobile ? 42 : 48,
        right: isMobile ? 10 : 20,
        top: 24,
        bottom: 76
      },
      xAxis: {
        type: 'category',
        data: data.timingBuckets.map(bucket => bucket.label),
        axisLabel: {
          color: colors.subTextColor,
          interval: 0,
          rotate: isMobile ? 32 : 20
        },
        axisLine: { lineStyle: { color: colors.axisLineColor } }
      },
      yAxis: {
        type: 'value',
        axisLabel: { color: colors.subTextColor },
        splitLine: { lineStyle: { color: colors.splitLineColor, type: 'dashed' } }
      },
      series: [
        {
          type: 'bar',
          barMaxWidth: 34,
          data: data.timingBuckets.map(bucket => bucket.count),
          itemStyle: {
            borderRadius: [6, 6, 0, 0]
          }
        }
      ]
    };
  }

  function buildDifficultyOption(data: IRAnalyticsSnapshot): echarts.EChartsCoreOption {
    const colors = getThemeColors();
    return {
      color: [colors.series[4]],
      tooltip: {
        trigger: 'item',
        backgroundColor: colors.tooltipBg,
        borderColor: colors.tooltipBorder,
        borderWidth: 1,
        textStyle: { color: colors.textColor },
        confine: true,
        formatter: (params: any) => {
          const point = params.data as {
            label: string;
            x: number;
            y: number;
            itemCount: number;
            readingHours: number;
            cardsCreated: number;
            extracts: number;
            notesWritten: number;
          };
          return [
            `<strong>${point.label}</strong>`,
            `平均优先级: ${point.x}`,
            `平均间隔: ${point.y} 天`,
            `材料数: ${point.itemCount}`,
            `阅读时长: ${point.readingHours} 小时`,
            `制卡: ${point.cardsCreated} / 摘录: ${point.extracts} / 笔记: ${point.notesWritten}`
          ].join('<br>');
        }
      },
      grid: {
        left: isMobile ? 40 : 52,
        right: isMobile ? 10 : 20,
        top: 24,
        bottom: 44
      },
      xAxis: {
        type: 'value',
        name: '平均优先级',
        min: 0,
        max: 10,
        nameTextStyle: { color: colors.subTextColor },
        axisLabel: { color: colors.subTextColor },
        splitLine: { lineStyle: { color: colors.splitLineColor, type: 'dashed' } }
      },
      yAxis: {
        type: 'value',
        name: '平均间隔(天)',
        nameTextStyle: { color: colors.subTextColor },
        axisLabel: { color: colors.subTextColor },
        splitLine: { lineStyle: { color: colors.splitLineColor, type: 'dashed' } }
      },
      series: [
        {
          type: 'scatter',
          symbolSize: (value: number[]) => value[2],
          label: {
            show: !isMobile,
            position: 'top',
            color: colors.subTextColor,
            fontSize: 11,
            formatter: (params: any) => params.data[3]
          },
          emphasis: {
            label: {
              show: true
            }
          },
          data: data.difficultyScatter.map(point => [
            point.x,
            point.y,
            point.size,
            point.label,
            point.itemCount,
            point.readingHours,
            point.cardsCreated,
            point.extracts,
            point.notesWritten
          ]),
          itemStyle: {
            opacity: 0.82
          }
        }
      ]
    };
  }

  function buildForecastOption(data: IRAnalyticsSnapshot): echarts.EChartsCoreOption {
    const colors = getThemeColors();
    return {
      color: [colors.series[0], colors.series[2]],
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        backgroundColor: colors.tooltipBg,
        borderColor: colors.tooltipBorder,
        borderWidth: 1,
        textStyle: { color: colors.textColor },
        confine: true
      },
      legend: {
        top: 6,
        left: 'center',
        textStyle: { color: colors.subTextColor }
      },
      grid: {
        left: isMobile ? 38 : 48,
        right: isMobile ? 34 : 52,
        top: 62,
        bottom: 30
      },
      xAxis: {
        type: 'category',
        data: data.forecast.map(point => point.label),
        axisLabel: { color: colors.subTextColor },
        axisLine: { lineStyle: { color: colors.axisLineColor } }
      },
      yAxis: [
        {
          type: 'value',
          name: '材料数',
          nameTextStyle: { color: colors.subTextColor },
          axisLabel: { color: colors.subTextColor },
          splitLine: { lineStyle: { color: colors.splitLineColor, type: 'dashed' } }
        },
        {
          type: 'value',
          name: '分钟',
          nameTextStyle: { color: colors.subTextColor },
          axisLabel: { color: colors.subTextColor }
        }
      ],
      series: [
        {
          name: '计划材料数',
          type: 'bar',
          barMaxWidth: 34,
          data: data.forecast.map(point => point.itemCount),
          itemStyle: { borderRadius: [6, 6, 0, 0] }
        },
        {
          name: '预计阅读分钟',
          type: 'line',
          yAxisIndex: 1,
          smooth: true,
          data: data.forecast.map(point => point.totalEstimatedMinutes)
        }
      ]
    };
  }

  function buildOption(data: IRAnalyticsSnapshot): echarts.EChartsCoreOption {
    if (activeTab === 'quantity') return buildQuantityOption(data);
    if (activeTab === 'timing') return buildTimingOption(data);
    if (activeTab === 'difficulty') return buildDifficultyOption(data);
    return buildForecastOption(data);
  }

  function renderChart(): void {
    if (!open || !snapshot || activeTab === 'activity') return;
    const instance = ensureChart();
    if (!instance) return;
    instance.setOption(buildOption(snapshot), true);
    instance.resize();
  }

  function switchTab(tab: AnalyticsTab): void {
    activeTab = tab;
    if (tab === 'activity') {
      unbindChartWheel();
      disposeChart();
      return;
    }
    setTimeout(() => renderChart(), 0);
  }

  function handleWheelScroll(event: WheelEvent): void {
    event.preventDefault();
    if (wheelThrottle || activeTab === 'activity') return;

    const currentIndex = quickRangeOptions.findIndex(option => option.value === selectedDays);
    if (currentIndex < 0) return;

    wheelThrottle = true;

    const delta = event.deltaY < 0 ? 1 : -1;
    const nextIndex = Math.max(0, Math.min(quickRangeOptions.length - 1, currentIndex + delta));
    if (nextIndex !== currentIndex) {
      selectedDays = quickRangeOptions[nextIndex].value;
      void loadAnalytics();
    }

    window.setTimeout(() => {
      wheelThrottle = false;
    }, WHEEL_THROTTLE_MS);
  }

  function bindChartWheel(): void {
    if (!chartRef || activeTab === 'activity') return;
    chartRef.removeEventListener('wheel', handleWheelScroll);
    chartRef.addEventListener('wheel', handleWheelScroll, { passive: false });
  }

  function unbindChartWheel(): void {
    chartRef?.removeEventListener('wheel', handleWheelScroll);
  }

  function handleResize(): void {
    chart?.resize();
  }

  function getCurrentSourceLabel(): string {
    if (!snapshot || !selectedSourceKey) return '总体数据源';
    const source = snapshot.sources.find(item => item.key === selectedSourceKey);
    if (!source) return '总体数据源';
    return `${getKindText(source.kind)} · ${source.label}`;
  }

  function showSourceMenu(event: MouseEvent): void {
    const menu = new Menu();

    menu.addItem((item) => {
      item
        .setTitle('总体数据源')
        .setIcon('globe')
        .setChecked(!selectedSourceKey)
        .onClick(() => {
          selectedSourceKey = '';
          void loadAnalytics();
        });
    });

    if (snapshot?.sources.length) {
      menu.addSeparator();
      for (const source of snapshot.sources) {
        menu.addItem((item) => {
          item
            .setTitle(`${getKindText(source.kind)} · ${source.label}`)
            .setIcon(source.kind === 'pdf' ? 'file-text' : source.kind === 'epub' ? 'book-open' : 'file')
            .setChecked(selectedSourceKey === source.key)
            .onClick(() => {
              selectedSourceKey = source.key;
              void loadAnalytics();
            });
        });
      }
    }

    menu.showAtMouseEvent(event);
  }

  function getKindText(kind: IRAnalyticsSourceOption['kind']): string {
    if (kind === 'pdf') return 'PDF';
    if (kind === 'epub') return 'EPUB';
    if (kind === 'document') return '文档';
    return '其它';
  }

  function formatMetric(value: number): string {
    if (!Number.isFinite(value)) return '0';
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
  }

  function formatMonitoringText(): string {
    if (!snapshot?.monitoringSummary) return '';
    const summary = snapshot.monitoringSummary;
    return `近7天日均已安排 ${summary.dailyScheduled} 项 · 日均完成 ${summary.dailyCompleted} 项 · 日均阅读 ${summary.dailyReadingMinutes} 分钟 · 决策闭环率 ${summary.linkedOutcomeRate}%`;
  }

  $effect(() => {
    void loadAnalytics();
  });

  $effect(() => {
    if (!chartRef) {
      unbindChartWheel();
      disposeChart();
      return;
    }
    if (activeTab !== 'activity') {
      bindChartWheel();
    } else {
      unbindChartWheel();
    }
    if (snapshot && activeTab !== 'activity') {
      setTimeout(() => renderChart(), 0);
    }
    return () => {
      unbindChartWheel();
    };
  });

  onMount(() => {
    window.addEventListener('resize', handleResize);

    const handleDataUpdated = () => {
      void loadAnalytics();
    };
    window.addEventListener('Weave:ir-data-updated', handleDataUpdated);

    themeObserver = new MutationObserver(() => {
      if (snapshot) {
        setTimeout(() => renderChart(), 60);
      }
    });
    themeObserver.observe(document.body, {
      attributes: true,
      attributeFilter: ['class']
    });

    return () => {
      window.removeEventListener('Weave:ir-data-updated', handleDataUpdated);
    };
  });

  onDestroy(() => {
    unbindChartWheel();
    disposeChart();
    themeObserver?.disconnect();
    window.removeEventListener('resize', handleResize);
  });
</script>

<div class="ir-analytics-modal">
      <div class="tabs-header" class:mobile={isMobile}>
        <div class="tabs-nav">
          <button type="button" class="tab-btn" class:active={activeTab === 'activity'} onclick={() => switchTab('activity')}>
            活跃趋势
          </button>
          <button type="button" class="tab-btn" class:active={activeTab === 'quantity'} onclick={() => switchTab('quantity')}>
            数量变化
          </button>
          <button type="button" class="tab-btn" class:active={activeTab === 'timing'} onclick={() => switchTab('timing')}>
            调度时机
          </button>
          <button type="button" class="tab-btn" class:active={activeTab === 'difficulty'} onclick={() => switchTab('difficulty')}>
            优先级矩阵
          </button>
          <button type="button" class="tab-btn" class:active={activeTab === 'forecast'} onclick={() => switchTab('forecast')}>
            未来负荷
          </button>
        </div>
      </div>

      <div class="toolbar" class:mobile={isMobile}>
        <div class="toolbar-row">
          <label class="source-select-wrap">
            <span class="toolbar-label">数据源</span>
            <button
              type="button"
              class="source-menu-trigger"
              onclick={(event) => showSourceMenu(event)}
              title="选择分析数据源"
            >
              <span class="source-menu-text">{getCurrentSourceLabel()}</span>
              <ObsidianIcon name="chevron-down" size={14} />
            </button>
          </label>

          <div class="quick-range-buttons">
            {#each quickRangeOptions as option}
              <button
                type="button"
                class="time-range-btn"
                class:active={selectedDays === option.value}
                onclick={() => {
                  selectedDays = option.value;
                  void loadAnalytics();
                }}
              >
                {option.label}
              </button>
            {/each}
          </div>
        </div>

        {#if activeTab === 'activity' && snapshot?.monitoringSummary}
          <div class="monitoring-note">{formatMonitoringText()}</div>
        {/if}
      </div>

      {#if isLoading}
        <div class="state-panel state-panel--loading">
          <div class="state-icon">
            <ObsidianIcon name="loader" size={20} />
          </div>
          <div>正在生成分析图表…</div>
        </div>
      {:else if loadError}
        <div class="state-panel error">{loadError}</div>
      {:else if snapshot}
        {#if activeTab === 'activity'}
          <div class="activity-overview-panel">
            <div class="scope-caption">
              <span class="scope-title">{snapshot.scopeLabel}</span>
              <span class="scope-subtitle">
                {#if snapshot.scopeKey}
                  共 {snapshot.overview.totalItems} 项材料，当前活跃 {snapshot.overview.activeItems} 项
                {:else}
                  当前汇总全部增量阅读数据源
                {/if}
              </span>
            </div>

            <div class="overview-grid">
              <div class="overview-card">
                <div class="overview-label">总材料</div>
                <div class="overview-value">{snapshot.overview.totalItems}</div>
              </div>
              <div class="overview-card">
                <div class="overview-label">活跃材料</div>
                <div class="overview-value">{snapshot.overview.activeItems}</div>
              </div>
              <div class="overview-card">
                <div class="overview-label">今日到期</div>
                <div class="overview-value">{snapshot.overview.dueToday}</div>
              </div>
              <div class="overview-card">
                <div class="overview-label">逾期项</div>
                <div class="overview-value">{snapshot.overview.overdueItems}</div>
              </div>
              <div class="overview-card">
                <div class="overview-label">阅读小时</div>
                <div class="overview-value">{formatMetric(snapshot.overview.totalReadingHours)}</div>
              </div>
              <div class="overview-card">
                <div class="overview-label">平均优先级</div>
                <div class="overview-value">P{formatMetric(snapshot.overview.avgPriority)}</div>
              </div>
              <div class="overview-card">
                <div class="overview-label">摘录</div>
                <div class="overview-value">{snapshot.overview.extracts}</div>
              </div>
              <div class="overview-card">
                <div class="overview-label">制卡</div>
                <div class="overview-value">{snapshot.overview.cardsCreated}</div>
              </div>
              <div class="overview-card">
                <div class="overview-label">笔记</div>
                <div class="overview-value">{snapshot.overview.notesWritten}</div>
              </div>
            </div>
          </div>
        {/if}

        {#if activeTab !== 'activity'}
          <div class="chart-stage">
            {#if (
            activeTab === 'quantity' && snapshot.quantityTrend.every(point => point.totalCount === 0 && point.activeCount === 0 && point.closedCount === 0)
          ) || (
            activeTab === 'timing' && snapshot.timingBuckets.every(point => point.count === 0)
          ) || (
            activeTab === 'difficulty' && snapshot.difficultyScatter.length === 0
          ) || (
            activeTab === 'forecast' && snapshot.forecast.every(point => point.itemCount === 0 && point.totalEstimatedMinutes === 0)
          )}
              <div class="state-panel state-panel--empty">
                <div class="state-icon">
                  <ObsidianIcon name="inbox" size={20} />
                </div>
                <div>当前范围下暂无可展示数据</div>
              </div>
            {:else}
              <div class="chart-container" bind:this={chartRef}></div>
            {/if}
          </div>
        {/if}
      {/if}
    </div>

<style>
  .ir-analytics-modal {
    display: flex;
    flex-direction: column;
    height: 100%;
    padding: 18px 18px 16px;
    background: linear-gradient(
      180deg,
      color-mix(in srgb, var(--background-primary) 94%, var(--background-secondary) 6%) 0%,
      var(--background-primary) 62%,
      color-mix(in srgb, var(--background-primary) 92%, var(--background-secondary) 8%) 100%
    );
    gap: 12px;
  }

  .tabs-header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 4px;
    border-radius: 12px;
    border: 1px solid color-mix(in srgb, var(--background-modifier-border) 86%, transparent);
    background: color-mix(in srgb, var(--background-secondary) 68%, transparent);
    backdrop-filter: blur(8px);
  }

  .tabs-nav {
    display: flex;
    gap: 4px;
    padding: 2px;
    border-radius: 9px;
    flex-wrap: wrap;
    width: 100%;
  }

  .tab-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0;
    padding: 7px 12px;
    border: 1px solid transparent;
    border-radius: 8px;
    background: transparent;
    color: var(--text-muted);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease;
    white-space: nowrap;
    min-height: 34px;
  }

  .tab-btn:hover {
    color: var(--text-normal);
    background: color-mix(in srgb, var(--background-modifier-hover) 72%, transparent);
    border-color: color-mix(in srgb, var(--background-modifier-border) 74%, transparent);
  }

  .tab-btn.active {
    color: var(--text-normal);
    background: color-mix(in srgb, var(--interactive-accent) 14%, var(--background-primary));
    border-color: color-mix(in srgb, var(--interactive-accent) 34%, var(--background-modifier-border));
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--interactive-accent) 22%, transparent);
  }

  .tab-btn:focus-visible {
    outline: 2px solid var(--background-modifier-border-focus);
    outline-offset: 1px;
  }

  .toolbar {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 14px 16px;
    border-radius: 12px;
    border: 1px solid color-mix(in srgb, var(--background-modifier-border) 88%, transparent);
    background: linear-gradient(
      180deg,
      color-mix(in srgb, var(--background-secondary) 90%, var(--background-primary) 10%),
      color-mix(in srgb, var(--background-secondary) 82%, var(--background-primary) 18%)
    );
  }

  .toolbar-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
  }

  .source-select-wrap {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 280px;
  }

  .toolbar-label {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-muted);
    flex-shrink: 0;
    white-space: nowrap;
  }

  .source-menu-trigger {
    min-width: 260px;
    display: inline-flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 7px 10px;
    min-height: 34px;
    border-radius: 9px;
    border: 1px solid color-mix(in srgb, var(--background-modifier-border) 86%, transparent);
    background: var(--background-primary);
    color: var(--text-normal);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease;
  }

  .source-menu-trigger:hover {
    border-color: color-mix(in srgb, var(--interactive-accent) 38%, var(--background-modifier-border));
    background: color-mix(in srgb, var(--background-modifier-hover) 74%, transparent);
  }

  .source-menu-trigger:focus-visible {
    outline: 2px solid var(--background-modifier-border-focus);
    outline-offset: 1px;
  }

  .source-menu-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .quick-range-buttons {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .time-range-btn {
    padding: 7px 11px;
    min-height: 34px;
    border: 1px solid color-mix(in srgb, var(--background-modifier-border) 84%, transparent);
    border-radius: 9px;
    background: var(--background-primary);
    color: var(--text-muted);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease;
  }

  .time-range-btn:hover {
    color: var(--text-normal);
    border-color: color-mix(in srgb, var(--interactive-accent) 38%, var(--background-modifier-border));
    background: color-mix(in srgb, var(--background-modifier-hover) 70%, transparent);
  }

  .time-range-btn.active {
    color: var(--text-on-accent);
    background: var(--interactive-accent);
    border-color: var(--interactive-accent);
  }

  .time-range-btn:focus-visible {
    outline: 2px solid var(--background-modifier-border-focus);
    outline-offset: 1px;
  }

  .monitoring-note {
    font-size: 12px;
    color: var(--text-muted);
    line-height: 1.5;
    padding: 8px 10px;
    border-radius: 10px;
    border: 1px solid color-mix(in srgb, var(--background-modifier-border) 82%, transparent);
    background: color-mix(in srgb, var(--background-primary) 72%, var(--background-secondary) 28%);
  }

  .activity-overview-panel {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .scope-caption {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 12px 14px;
    border-radius: 11px;
    border: 1px solid color-mix(in srgb, var(--background-modifier-border) 86%, transparent);
    background: color-mix(in srgb, var(--background-secondary) 66%, var(--background-primary) 34%);
  }

  .scope-title {
    font-size: 15px;
    font-weight: 700;
    color: var(--text-normal);
    line-height: 1.35;
  }

  .scope-subtitle {
    font-size: 12px;
    color: var(--text-muted);
  }

  .overview-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
  }

  .overview-card {
    padding: 12px 14px;
    border-radius: 11px;
    border: 1px solid color-mix(in srgb, var(--background-modifier-border) 84%, transparent);
    background: linear-gradient(
      180deg,
      color-mix(in srgb, var(--background-primary) 92%, var(--background-secondary) 8%),
      color-mix(in srgb, var(--background-primary) 98%, var(--background-secondary) 2%)
    );
    transition: border-color 0.15s ease, transform 0.15s ease;
  }

  .overview-card:hover {
    border-color: color-mix(in srgb, var(--interactive-accent) 30%, var(--background-modifier-border));
    transform: translateY(-1px);
  }

  .overview-label {
    font-size: 11px;
    color: var(--text-muted);
    margin-bottom: 6px;
    letter-spacing: 0.02em;
  }

  .overview-value {
    font-size: 21px;
    font-weight: 700;
    color: var(--text-normal);
    font-variant-numeric: tabular-nums;
    line-height: 1.1;
  }

  .chart-stage {
    flex: 1;
    min-height: 0;
    display: flex;
  }

  .chart-container {
    flex: 1;
    min-height: 420px;
    border-radius: 14px;
    border: 1px solid color-mix(in srgb, var(--background-modifier-border) 86%, transparent);
    background: linear-gradient(
      180deg,
      color-mix(in srgb, var(--background-secondary) 82%, var(--background-primary) 18%),
      color-mix(in srgb, var(--background-primary) 92%, var(--background-secondary) 8%)
    );
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--background-primary) 30%, transparent);
    padding: 12px 10px 10px 4px;
  }

  .state-panel {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    min-height: 220px;
    border-radius: 12px;
    border: 1px solid color-mix(in srgb, var(--background-modifier-border) 86%, transparent);
    color: var(--text-muted);
    background: color-mix(in srgb, var(--background-secondary) 78%, var(--background-primary) 22%);
    text-align: center;
    padding: 16px;
  }

  .state-panel--empty {
    border-style: dashed;
  }

  .state-panel--loading .state-icon {
    animation: ir-analytics-spin 1.1s linear infinite;
  }

  .state-panel.error {
    color: var(--text-error);
    border-color: color-mix(in srgb, var(--text-error) 38%, var(--background-modifier-border));
    background: color-mix(in srgb, var(--text-error) 10%, var(--background-primary));
  }

  .state-icon {
    opacity: 0.8;
  }

  @keyframes ir-analytics-spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }

  .tabs-header.mobile .tabs-nav {
    width: 100%;
    justify-content: flex-start;
    flex-wrap: nowrap;
    overflow-x: auto;
    scrollbar-width: thin;
    scrollbar-color: color-mix(in srgb, var(--text-muted) 26%, transparent) transparent;
  }

  .tabs-header.mobile .tab-btn {
    flex: 0 0 auto;
    min-width: 40px;
    padding: 8px 10px;
  }

  .toolbar.mobile .toolbar-row {
    flex-direction: column;
    align-items: stretch;
    gap: 10px;
  }

  .toolbar.mobile .source-select-wrap {
    min-width: 0;
    width: 100%;
    flex-direction: column;
    align-items: stretch;
    gap: 6px;
  }

  .toolbar.mobile .source-menu-trigger {
    min-width: 0;
    width: 100%;
  }

  .toolbar.mobile .quick-range-buttons {
    width: 100%;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    justify-content: stretch;
  }

  .toolbar.mobile .time-range-btn {
    width: 100%;
  }

  @media (max-width: 768px) {
    .ir-analytics-modal {
      padding: 10px 8px;
      gap: 10px;
    }

    .overview-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .overview-card {
      padding: 10px 12px;
    }

    .overview-value {
      font-size: 18px;
    }

    .scope-caption {
      padding: 10px 12px;
    }

    .chart-container {
      min-height: 320px;
      padding: 8px 8px 8px 2px;
    }

    .state-panel {
      min-height: 180px;
    }
  }

  @media (max-width: 520px) {
    .overview-grid {
      grid-template-columns: repeat(1, minmax(0, 1fr));
    }
  }
</style>
