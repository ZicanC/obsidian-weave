<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import { Platform } from 'obsidian';
  import type { Deck } from '../../../data/types';
  import type WeavePlugin from '../../../main';
  import type { TestAttempt } from '../../../types/question-bank-types';
  import echarts, { type EChartsType } from '../../../utils/echarts-loader';
  import { getThemeColors, createGradient } from '../../../utils/echarts-theme';
  import { logger } from '../../../utils/logger';
  import { buildQuestionBankEwmaSeries, loadQuestionBankAttempts } from '../../../utils/question-bank-analytics';

  interface Props {
    questionBank: Deck;
    plugin: WeavePlugin;
  }

  let { questionBank, plugin }: Props = $props();

  let chartContainer: HTMLElement | null = $state(null);
  let chart: EChartsType | null = null;
  let attempts = $state<TestAttempt[]>([]);
  let isLoading = $state(true);
  const isMobile = Platform.isMobile;

  function initializeChart() {
    if (!chartContainer || attempts.length === 0) {
      return;
    }

    try {
      const colors = getThemeColors();
      const safeColors = {
        accent: colors.accent || '#4f94f4',
        success: colors.success || '#22c55e',
        warning: colors.warning || '#f59e0b',
        textMuted: colors.textMuted || '#94a3b8',
        backgroundSecondary: colors.backgroundSecondary || '#1f2937',
        border: colors.border || '#334155',
        text: colors.text || '#e5e7eb'
      };

      if (chart) {
        chart.dispose();
      }

      chart = echarts.init(chartContainer);
      const { dates, ewmaData, historicalData, confidenceData } = buildQuestionBankEwmaSeries(attempts);

      chart.setOption({
        backgroundColor: 'transparent',
        tooltip: {
          trigger: 'axis',
          backgroundColor: safeColors.backgroundSecondary,
          borderColor: safeColors.border,
          textStyle: { color: safeColors.text },
          formatter(params: Array<{ axisValue: string; color: string; seriesName: string; value: number }>) {
            let result = `<div style="font-weight:600;margin-bottom:4px;">${params[0]?.axisValue ?? ''}</div>`;
            for (const param of params) {
              const value = param.seriesName === '置信度'
                ? param.value.toFixed(2)
                : `${param.value.toFixed(1)}%`;
              result += `<div style="margin:2px 0;">
                <span style="display:inline-block;width:10px;height:10px;background:${param.color};border-radius:50%;margin-right:8px;"></span>
                ${param.seriesName}: <span style="font-weight:600;">${value}</span>
              </div>`;
            }
            return result;
          }
        },
        legend: {
          show: true,
          type: isMobile ? 'scroll' : 'plain',
          top: isMobile ? 8 : 10,
          left: isMobile ? 8 : 'center',
          right: isMobile ? 8 : undefined,
          textStyle: {
            color: safeColors.text,
            fontSize: isMobile ? 11 : 12
          },
          itemGap: isMobile ? 10 : 20,
          itemWidth: isMobile ? 14 : 18,
          itemHeight: isMobile ? 8 : 10,
          pageTextStyle: {
            color: safeColors.textMuted,
            fontSize: isMobile ? 10 : 11
          }
        },
        grid: {
          left: isMobile ? '6%' : '2%',
          right: isMobile ? '6%' : '3%',
          bottom: isMobile ? '16%' : '15%',
          top: isMobile ? 96 : '15%',
          containLabel: true
        },
        xAxis: {
          type: 'category',
          data: dates,
          axisLine: {
            show: true,
            lineStyle: { color: safeColors.border }
          },
          axisLabel: {
            color: safeColors.textMuted,
            fontSize: 11,
            rotate: 45
          },
          axisTick: { show: false }
        },
        yAxis: [
          {
            type: 'value',
            name: isMobile ? '' : '正确率 (%)',
            nameTextStyle: { color: safeColors.textMuted, fontSize: 12 },
            min: 0,
            max: 100,
            axisLine: {
              show: true,
              lineStyle: { color: safeColors.border }
            },
            axisLabel: {
              color: safeColors.textMuted,
              fontSize: 11,
              formatter: '{value}%'
            },
            splitLine: {
              lineStyle: { color: safeColors.border, type: 'dashed', opacity: 0.6 }
            }
          },
          {
            type: 'value',
            name: isMobile ? '' : '置信度',
            nameTextStyle: { color: safeColors.textMuted, fontSize: 12 },
            min: 0,
            max: 1,
            axisLine: {
              show: true,
              lineStyle: { color: safeColors.border }
            },
            axisLabel: {
              color: safeColors.textMuted,
              fontSize: 11
            },
            splitLine: { show: false }
          }
        ],
        series: [
          {
            name: 'EWMA 当前掌握度',
            type: 'line',
            data: ewmaData,
            smooth: true,
            lineStyle: { color: safeColors.accent, width: 3 },
            itemStyle: { color: safeColors.accent, borderWidth: 2 },
            symbolSize: 6,
            areaStyle: {
              color: createGradient(safeColors.accent, 0.15, 0.03)
            }
          },
          {
            name: '历史平均',
            type: 'line',
            data: historicalData,
            smooth: true,
            lineStyle: { color: safeColors.textMuted, width: 2, type: 'dashed' },
            itemStyle: { color: safeColors.textMuted },
            symbolSize: 4
          },
          {
            name: '目标线',
            type: 'line',
            data: dates.map(() => 80),
            lineStyle: { color: safeColors.success, width: 2, type: 'solid' },
            itemStyle: { color: safeColors.success },
            symbol: 'none'
          },
          {
            name: '置信度',
            type: 'line',
            yAxisIndex: 1,
            data: confidenceData,
            smooth: true,
            lineStyle: { color: safeColors.warning, width: 2 },
            itemStyle: { color: safeColors.warning },
            symbolSize: 4
          }
        ]
      });
    } catch (error) {
      logger.error('[QuestionBankEWMATab] 初始化图表失败:', error);
      if (chart) {
        chart.dispose();
        chart = null;
      }
    }
  }

  onMount(() => {
    let resizeObserver: ResizeObserver | null = null;

    const loadData = async () => {
      isLoading = true;
      attempts = await loadQuestionBankAttempts(plugin, questionBank.id);
      isLoading = false;
      await tick();
      initializeChart();

      if (chartContainer) {
        resizeObserver = new ResizeObserver(() => {
          chart?.resize();
        });
        resizeObserver.observe(chartContainer);
      }
    };

    void loadData();

    return () => {
      resizeObserver?.disconnect();
    };
  });

  onDestroy(() => {
    chart?.dispose();
    chart = null;
  });
</script>

<div class="ewma-tab">
  {#if isLoading}
    <div class="empty-state">正在加载题库分析数据...</div>
  {:else if attempts.length === 0}
    <div class="empty-state">暂无可用的真实答题数据</div>
  {:else}
    <div class="chart-container">
      <div bind:this={chartContainer} class="chart"></div>
    </div>
  {/if}
</div>

<style>
  .ewma-tab {
    padding: 16px;
    height: 100%;
    display: flex;
    flex-direction: column;
  }

  .chart-container {
    background: var(--background-secondary);
    border-radius: 10px;
    padding: 12px 6px 12px 2px;
    border: 1px solid var(--background-modifier-border);
    flex: 1;
    min-height: 500px;
    display: flex;
    flex-direction: column;
  }

  .chart {
    width: 100%;
    flex: 1;
    min-height: 450px;
  }

  .empty-state {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
    border: 1px dashed var(--background-modifier-border);
    border-radius: 10px;
    background: var(--background-secondary);
    min-height: 320px;
  }

  @media (max-width: 768px) {
    .ewma-tab {
      padding: 12px 10px 14px;
    }

    .chart-container {
      min-height: 420px;
      padding: 8px 4px 8px 0;
    }

    .chart {
      min-height: 380px;
    }
  }
</style>
