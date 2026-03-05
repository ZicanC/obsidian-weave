/**
 * 增量阅读队列生成器 v4.0
 * 
 * 对齐《增量阅读-算法实施权威规范.md》Section 6
 * 
 * 核心特性：
 * - DRR 时间赤字版（Section 6.3）
 * - 成本估计（Section 6.2）
 * - 尾部碎片处理（允许轻微超出）
 * - 候选块选择分数（Section 7）
 * 
 * @module services/incremental-reading/IRQueueGeneratorV4
 * @version 4.0.0
 */

import type { IRBlockV4, IRBlockStatus } from '../../types/ir-types';
import { 
  calculateSelectionScore, 
  estimateBlockCost,
  calculateAgeBoost,
  SPEED_AVG
} from './IRCoreAlgorithmsV4';
import { logger } from '../../utils/logger';

// ============================================
// 类型定义
// ============================================

/**
 * 队列项（带元数据）
 */
export interface QueueItemV4 {
  block: IRBlockV4;
  groupId: string;
  estimatedCost: number;  // 分钟
  score: number;
}

/**
 * 组状态（用于 DRR）
 */
interface GroupState {
  groupId: string;
  deficit: number;
  items: QueueItemV4[];
  weight: number;  // 组目标时间占比
}

/**
 * 队列生成结果
 */
export interface QueueGenerationResultV4 {
  /** 生成的队列 */
  queue: IRBlockV4[];
  /** 预估总时间（分钟） */
  totalEstimatedMinutes: number;
  /** 统计信息 */
  stats: {
    /** 候选池总数 */
    candidateCount: number;
    /** 实际入队数 */
    scheduledCount: number;
    /** 组分布 */
    groupDistribution: Record<string, number>;
    /** 是否超出预算 */
    overBudget: boolean;
    /** 超出比例 */
    overBudgetRatio: number;
  };
}

/**
 * 组权重配置
 */
export interface GroupWeights {
  [groupId: string]: number;  // 权重，需要满足 ΣW_i = 1
}

// ============================================
// IRQueueGeneratorV4 类
// ============================================

export class IRQueueGeneratorV4 {
  private defaultTimeBudget: number = 40;  // 分钟
  private tailThreshold: number = 0.8;     // 尾部碎片阈值
  private agingStrength: 'low' | 'medium' | 'high' = 'low';
  
  constructor(timeBudget?: number, agingStrength?: 'low' | 'medium' | 'high') {
    if (timeBudget) {
      this.defaultTimeBudget = timeBudget;
    }
    if (agingStrength) {
      this.agingStrength = agingStrength;
    }
  }
  
  /**
   * 设置时间预算
   */
  setTimeBudget(minutes: number): void {
    this.defaultTimeBudget = minutes;
  }
  
  /**
   * 设置 aging 强度
   */
  setAgingStrength(strength: 'low' | 'medium' | 'high'): void {
    this.agingStrength = strength;
  }
  
  /**
   * 生成会话队列（主入口）
   * 
   * @param candidatePool scheduled 状态的候选块
   * @param groupMapping 块ID到组ID的映射
   * @param groupWeights 组权重配置（可选，默认均分）
   * @param timeBudget 时间预算（分钟）
   * @param currentSourcePath 当前展示的源文件路径（用于切换惩罚）
   * @returns 队列生成结果
   */
  generateQueue(
    candidatePool: IRBlockV4[],
    groupMapping: Record<string, string>,
    groupWeights?: GroupWeights,
    timeBudget: number = this.defaultTimeBudget,
    currentSourcePath: string | null = null
  ): QueueGenerationResultV4 {
    // 1. 过滤：只处理 scheduled 状态的块
    const scheduled = candidatePool.filter(b => b.status === 'scheduled');
    
    if (scheduled.length === 0) {
      return this.emptyResult();
    }
    
    // 2. 构建队列项
    const items = this.buildQueueItems(scheduled, groupMapping, currentSourcePath);
    
    // 3. 按组分桶
    const groups = this.groupByTagGroup(items, groupWeights, timeBudget);
    
    // 4. DRR 时间赤字版
    const { queue, totalMinutes } = this.deficitRoundRobin(groups, timeBudget);
    
    // 5. 统计组分布
    const groupDistribution: Record<string, number> = {};
    for (const block of queue) {
      const groupId = groupMapping[block.id] || 'default';
      groupDistribution[groupId] = (groupDistribution[groupId] || 0) + 1;
    }
    
    const overBudgetRatio = totalMinutes / timeBudget;
    
    logger.info(
      `[IRQueueGeneratorV4] 队列生成完成: ` +
      `候选=${scheduled.length}, 入队=${queue.length}, ` +
      `预估时间=${totalMinutes.toFixed(1)}min/${timeBudget}min`
    );
    
    return {
      queue,
      totalEstimatedMinutes: totalMinutes,
      stats: {
        candidateCount: scheduled.length,
        scheduledCount: queue.length,
        groupDistribution,
        overBudget: totalMinutes > timeBudget,
        overBudgetRatio
      }
    };
  }
  
  /**
   * 构建队列项
   */
  private buildQueueItems(
    blocks: IRBlockV4[],
    groupMapping: Record<string, string>,
    currentSourcePath: string | null
  ): QueueItemV4[] {
    return blocks.map(block => {
      const groupId = groupMapping[block.id] || 'default';
      const estimatedCost = estimateBlockCost(block);
      const score = calculateSelectionScore(block, currentSourcePath, 0.5, this.agingStrength);
      
      return {
        block,
        groupId,
        estimatedCost,
        score
      };
    });
  }
  
  /**
   * 按标签组分桶
   */
  private groupByTagGroup(
    items: QueueItemV4[],
    groupWeights: GroupWeights | undefined,
    timeBudget: number
  ): Map<string, GroupState> {
    const groups = new Map<string, GroupState>();
    
    // 收集所有组
    const groupIds = new Set<string>();
    for (const item of items) {
      groupIds.add(item.groupId);
    }
    
    // 计算权重（默认均分）
    const defaultWeight = 1 / groupIds.size;
    
    // 初始化组状态
    for (const groupId of groupIds) {
      const weight = groupWeights?.[groupId] ?? defaultWeight;
      groups.set(groupId, {
        groupId,
        deficit: timeBudget * weight,  // 初始赤字 = T_budget × W_i
        items: [],
        weight
      });
    }
    
    // 分配项目到组
    for (const item of items) {
      const group = groups.get(item.groupId);
      if (group) {
        group.items.push(item);
      }
    }
    
    // 按分数排序每组内的项
    for (const group of groups.values()) {
      group.items.sort((a, b) => b.score - a.score);
    }
    
    return groups;
  }
  
  /**
   * DRR 时间赤字版（权威规范 Section 6.3）
   */
  private deficitRoundRobin(
    groups: Map<string, GroupState>,
    timeBudget: number
  ): { queue: IRBlockV4[]; totalMinutes: number } {
    const queue: IRBlockV4[] = [];
    let tSum = 0;
    
    // 转为数组便于操作
    const groupList = Array.from(groups.values()).filter(g => g.items.length > 0);
    
    if (groupList.length === 0) {
      return { queue: [], totalMinutes: 0 };
    }
    
    while (tSum < timeBudget && this.hasAvailableItems(groupList)) {
      // 1. 取赤字最大的非空组
      const gMax = this.getMaxDeficitGroup(groupList);
      if (!gMax || gMax.items.length === 0) {
        break;
      }
      
      // 2. 组内选择最高分项
      const item = gMax.items[0];
      const cost = item.estimatedCost;
      
      // 3. 预算检查（尾部碎片处理）
      if (tSum + cost > timeBudget) {
        if (tSum === 0) {
          queue.push(item.block);
          tSum += cost;
          gMax.items.shift();
          gMax.deficit -= cost;
          continue;
        }
        // 如果已达到 80% 预算，允许轻微超出
        if (tSum / timeBudget >= this.tailThreshold) {
          queue.push(item.block);
          tSum += cost;
          gMax.items.shift();
          gMax.deficit -= cost;
          logger.debug(
            `[IRQueueGeneratorV4] 尾部碎片: 允许轻微超出, ` +
            `block=${item.block.id}, cost=${cost.toFixed(1)}min`
          );
        } else {
          // 尝试同组下一个更小块
          const smallerItem = this.findSmallerItem(gMax, timeBudget - tSum);
          if (smallerItem) {
            queue.push(smallerItem.block);
            tSum += smallerItem.estimatedCost;
            const idx = gMax.items.indexOf(smallerItem);
            if (idx >= 0) gMax.items.splice(idx, 1);
            gMax.deficit -= smallerItem.estimatedCost;
          } else {
            // 无合适块，跳过该组
            gMax.items.shift();
          }
        }
        continue;
      }
      
      // 4. 正常加入
      queue.push(item.block);
      tSum += cost;
      gMax.items.shift();
      gMax.deficit -= cost;
    }
    
    logger.debug(
      `[IRQueueGeneratorV4] DRR 完成: ${queue.length} 块, ` +
      `总时间=${tSum.toFixed(1)}min`
    );
    
    return { queue, totalMinutes: tSum };
  }
  
  /**
   * 检查是否还有可用项
   */
  private hasAvailableItems(groups: GroupState[]): boolean {
    return groups.some(g => g.items.length > 0);
  }
  
  /**
   * 获取赤字最大的组
   */
  private getMaxDeficitGroup(groups: GroupState[]): GroupState | null {
    let maxGroup: GroupState | null = null;
    let maxDeficit = -Infinity;
    
    for (const group of groups) {
      if (group.items.length > 0 && group.deficit > maxDeficit) {
        maxDeficit = group.deficit;
        maxGroup = group;
      }
    }
    
    return maxGroup;
  }
  
  /**
   * 在组内找一个更小的块
   */
  private findSmallerItem(group: GroupState, maxCost: number): QueueItemV4 | null {
    for (const item of group.items) {
      if (item.estimatedCost <= maxCost) {
        return item;
      }
    }
    return null;
  }
  
  /**
   * 返回空结果
   */
  private emptyResult(): QueueGenerationResultV4 {
    return {
      queue: [],
      totalEstimatedMinutes: 0,
      stats: {
        candidateCount: 0,
        scheduledCount: 0,
        groupDistribution: {},
        overBudget: false,
        overBudgetRatio: 0
      }
    };
  }
  
  /**
   * 获取队列预览（不修改状态）
   */
  previewQueue(
    candidatePool: IRBlockV4[],
    groupMapping: Record<string, string>,
    timeBudget: number = this.defaultTimeBudget
  ): { blocks: IRBlockV4[]; totalMinutes: number } {
    const result = this.generateQueue(candidatePool, groupMapping, undefined, timeBudget);
    return {
      blocks: result.queue,
      totalMinutes: result.totalEstimatedMinutes
    };
  }
  
  /**
   * 计算过载统计
   */
  getOverloadStats(
    candidatePool: IRBlockV4[],
    groupMapping: Record<string, string>,
    timeBudget: number = this.defaultTimeBudget
  ): {
    isOverloaded: boolean;
    totalCandidateCost: number;
    budgetMinutes: number;
    overloadRatio: number;
    groupOverload: Record<string, { count: number; cost: number; ratio: number }>;
  } {
    const scheduled = candidatePool.filter(b => b.status === 'scheduled');
    
    // 计算总成本
    let totalCost = 0;
    const groupCosts: Record<string, { count: number; cost: number }> = {};
    
    for (const block of scheduled) {
      const cost = estimateBlockCost(block);
      totalCost += cost;
      
      const groupId = groupMapping[block.id] || 'default';
      if (!groupCosts[groupId]) {
        groupCosts[groupId] = { count: 0, cost: 0 };
      }
      groupCosts[groupId].count++;
      groupCosts[groupId].cost += cost;
    }
    
    const overloadRatio = totalCost / timeBudget;
    const isOverloaded = overloadRatio > 1.5;
    
    // 计算各组过载
    const groupCount = Object.keys(groupCosts).length || 1;
    const fairShare = timeBudget / groupCount;
    
    const groupOverload: Record<string, { count: number; cost: number; ratio: number }> = {};
    for (const [groupId, data] of Object.entries(groupCosts)) {
      groupOverload[groupId] = {
        count: data.count,
        cost: data.cost,
        ratio: data.cost / fairShare
      };
    }
    
    return {
      isOverloaded,
      totalCandidateCost: totalCost,
      budgetMinutes: timeBudget,
      overloadRatio,
      groupOverload
    };
  }
}

/**
 * 导出工厂函数
 */
export function createQueueGenerator(timeBudget?: number): IRQueueGeneratorV4 {
  return new IRQueueGeneratorV4(timeBudget);
}
