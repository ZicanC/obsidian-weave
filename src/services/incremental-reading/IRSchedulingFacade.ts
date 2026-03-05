/**
 * 增量阅读调度服务外观 v3.0
 * 
 * 统一入口，整合以下组件：
 * - IRSchedulerV3: 核心调度算法
 * - IRTagGroupService: 标签组管理
 * - IRQueueGenerator: 队列生成
 * - IRStorageService: 数据存储
 * 
 * v5.0 扩展：
 * - IRChunkScheduleAdapter: 文件化块调度适配器（新方案）
 * - 支持从 chunks.json 获取调度数据
 * - 旧的 blocks.json 方法标记为废弃
 * 
 * @module services/incremental-reading/IRSchedulingFacade
 * @version 3.0.0 (v5.0 扩展)
 */

import type { App } from 'obsidian';
import { IRStorageService } from './IRStorageService';
import { IRSchedulerV3, type ReadingCompletionData } from './IRSchedulerV3';
import { IRTagGroupService } from './IRTagGroupService';
import { IRQueueGenerator, type QueueGenerationResult, type PostponeResult } from './IRQueueGenerator';
import { IRChunkScheduleAdapter } from './IRChunkScheduleAdapter';
import type { IRChunkFileData } from '../../types/ir-types';
import type { 
  IRBlock, 
  IRScheduleStrategy,
  IRAdvancedScheduleSettings,
  IRTagGroup,
  IRTagGroupProfile
} from '../../types/ir-types';
import {
  PROCESSING_STRATEGY,
  READING_LIST_STRATEGY,
  DEFAULT_ADVANCED_SCHEDULE_SETTINGS
} from '../../types/ir-types';
import { logger } from '../../utils/logger';
import { resolveIRImportFolder } from '../../config/paths';

// ============================================
// 类型定义
// ============================================

/**
 * 调度服务配置
 */
export interface IRSchedulingFacadeConfig {
  strategy?: 'processing' | 'reading-list';
  advancedSettings?: Partial<IRAdvancedScheduleSettings>;
  /** 🔧 优化：可选传入已初始化的存储服务，避免重复创建 */
  storageService?: IRStorageService;
  /** v5.0+: 文件化块根目录（默认使用 DEFAULT_IR_IMPORT_FOLDER） */
  chunkRoot?: string;
}

/**
 * 学习队列结果（扩展）
 */
export interface StudyQueueResult extends QueueGenerationResult {
  deckId: string;
  strategy: IRScheduleStrategy;
  overloadInfo?: {
    isOverloaded: boolean;
    overloadRatio: number;
  };
}

/**
 * 完成阅读的结果
 */
export interface CompleteBlockResult {
  block: IRBlock;
  groupProfile: IRTagGroupProfile;
  nextInQueue: IRBlock | null;
}

// ============================================
// IRSchedulingFacade 类
// ============================================

export class IRSchedulingFacade {
  private app: App;
  private storage: IRStorageService;
  private scheduler: IRSchedulerV3;
  private queueGenerator: IRQueueGenerator;
  private tagGroupService: IRTagGroupService;
  private chunkAdapter?: IRChunkScheduleAdapter;
  private chunkRoot: string;
  
  private strategy: IRScheduleStrategy;
  private advancedSettings: IRAdvancedScheduleSettings;
  
  private initialized = false;
  
  constructor(app: App, config?: IRSchedulingFacadeConfig) {
    this.app = app;
    const passedStorageService = config?.storageService;
    logger.debug(`[IRSchedulingFacade] 构造函数: storageService 传入=${!!passedStorageService}`);
    this.storage = passedStorageService || new IRStorageService(app);
    const plugin: any = (app as any)?.plugins?.getPlugin?.('weave');
    const parentFolder = plugin?.settings?.weaveParentFolder;
    this.chunkRoot = resolveIRImportFolder(config?.chunkRoot, parentFolder);
    
    // 解析策略
    this.strategy = config?.strategy === 'reading-list' 
      ? READING_LIST_STRATEGY 
      : PROCESSING_STRATEGY;
    
    this.advancedSettings = {
      ...DEFAULT_ADVANCED_SCHEDULE_SETTINGS,
      ...config?.advancedSettings
    };
    
    // 初始化组件
    this.scheduler = new IRSchedulerV3(this.storage, {
      strategy: this.strategy,
      advancedSettings: this.advancedSettings
    }, app);
    
    this.tagGroupService = new IRTagGroupService(app);
    
    this.queueGenerator = new IRQueueGenerator(
      this.strategy,
      this.advancedSettings
    );
  }
  
  /**
   * 初始化服务
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    // 🔧 修复：始终调用 storage.initialize()，它内部会处理重复初始化
    await this.storage.initialize();
    await this.tagGroupService.initialize();
    
    this.initialized = true;
    logger.info('[IRSchedulingFacade] 初始化完成');
  }
  
  // ============================================
  // v5.0 文件化块调度方法
  // ============================================
  
  /**
   * 获取文件化块调度适配器（延迟初始化）
   */
  getChunkAdapter(): IRChunkScheduleAdapter {
    if (!this.chunkAdapter) {
      this.chunkAdapter = new IRChunkScheduleAdapter(this.app, this.storage, this.chunkRoot);
    }
    return this.chunkAdapter;
  }
  
  /**
   * 获取文件化块学习队列
   * v5.0 新方案：从 chunks.json 获取调度数据
   */
  async getChunkStudyQueue(): Promise<IRChunkFileData[]> {
    await this.initialize();
    const adapter = this.getChunkAdapter();
    return adapter.getTodayDueChunks();
  }
  
  /**
   * 标记文件化块为完成
   */
  async markChunkComplete(chunkId: string): Promise<void> {
    await this.initialize();
    const adapter = this.getChunkAdapter();
    await adapter.markChunkDone(chunkId);
  }
  
  /**
   * 同步所有块文件的 YAML 状态到调度数据
   */
  async syncChunksFromYAML(): Promise<number> {
    await this.initialize();
    const adapter = this.getChunkAdapter();
    return adapter.syncAllFromYAML();
  }
  
  // ============================================
  // 策略与设置
  // ============================================
  
  /**
   * 切换调度策略
   */
  setStrategy(strategyType: 'processing' | 'reading-list'): void {
    this.strategy = strategyType === 'processing' 
      ? PROCESSING_STRATEGY 
      : READING_LIST_STRATEGY;
    
    this.scheduler.setStrategy(strategyType);
    this.queueGenerator.setStrategy(this.strategy);
    
    logger.info(`[IRSchedulingFacade] 切换策略: ${strategyType}`);
  }
  
  /**
   * 获取当前策略
   */
  getStrategy(): IRScheduleStrategy {
    return this.strategy;
  }
  
  /**
   * 更新高级设置
   */
  updateAdvancedSettings(settings: Partial<IRAdvancedScheduleSettings>): void {
    this.advancedSettings = { ...this.advancedSettings, ...settings };
    this.scheduler.updateAdvancedSettings(this.advancedSettings);
    this.queueGenerator.setAdvancedSettings(this.advancedSettings);
  }
  
  /**
   * 获取高级设置
   */
  getAdvancedSettings(): IRAdvancedScheduleSettings {
    return this.advancedSettings;
  }
  
  // ============================================
  // 队列生成
  // ============================================
  
  /**
   * 获取学习队列（主入口）
   * 
   * @param deckId 牌组 ID
   * @returns 学习队列结果
   */
  async getStudyQueue(deckId: string): Promise<StudyQueueResult> {
    await this.initialize();
    
    logger.info(`[IRSchedulingFacade] getStudyQueue 开始: deckId=${deckId}`);
    logger.debug(`[IRSchedulingFacade] storage实例: initialized=${(this.storage as any).initialized}`);
    
    // 1. 获取牌组的所有内容块
    const blocks = await this.storage.getBlocksByDeck(deckId, false, 'IRSchedulingFacade');
    logger.info(`[IRSchedulingFacade] 获取到块数: ${blocks.length}`);
    
    // 🔍 调试：如果块数为0，检查所有牌组和块
    if (blocks.length === 0) {
      const allDecks = await this.storage.getAllDecks();
      const allBlocks = await this.storage['getAllBlocks']();
      logger.warn(`[IRSchedulingFacade] 块数为0! 所有牌组: ${Object.keys(allDecks).join(', ')}`);
      logger.warn(`[IRSchedulingFacade] 所有块数: ${Object.keys(allBlocks).length}`);
      
      // 检查是否有匹配的牌组
      const matchingDeck = Object.values(allDecks).find((d: any) => d.id === deckId || d.path === deckId);
      if (matchingDeck) {
        logger.warn(`[IRSchedulingFacade] 找到匹配牌组: id=${(matchingDeck as any).id}, path=${(matchingDeck as any).path}, blockIds=${(matchingDeck as any).blockIds?.length || 0}`);
      } else {
        logger.warn(`[IRSchedulingFacade] 未找到匹配的牌组! deckId=${deckId}`);
      }
    }
    
    // 调试：打印前3个块的状态
    if (blocks.length > 0) {
      const sample = blocks.slice(0, 3).map(b => ({
        id: b.id.slice(0, 8),
        state: b.state,
        nextReview: b.nextReview,
        dailyAppearances: b.dailyAppearances
      }));
      logger.debug(`[IRSchedulingFacade] 块样本:`, JSON.stringify(sample));
    }
    
    // 2. 构建文档到组的映射
    const groupMapping: Record<string, string> = {};
    for (const block of blocks) {
      if (!groupMapping[block.filePath]) {
        groupMapping[block.filePath] = await this.tagGroupService.matchGroupForDocument(block.filePath);
      }
    }
    
    // 3. 检查过载情况
    const overloadStats = this.queueGenerator.getOverloadStats(blocks, groupMapping);
    
    // 4. 如果过载且启用自动后推，先执行后推
    if (overloadStats.isOverloaded && this.advancedSettings.autoPostponeStrategy !== 'off') {
      const today = new Date().toISOString().split('T')[0];
      const dueBlocks = blocks.filter(b => 
        b.state !== 'suspended' && 
        (b.state === 'new' || !b.nextReview || b.nextReview.split('T')[0] <= today)
      );
      
      const postponeResult = this.queueGenerator.autoPostpone(dueBlocks);
      
      // 保存后推的块
      if (postponeResult.postponedBlocks.length > 0) {
        await this.storage.saveBlocks(postponeResult.postponedBlocks);
        logger.info(`[IRSchedulingFacade] 自动后推 ${postponeResult.postponedCount} 块`);
      }
    }
    
    // 5. 重新获取块（可能已更新）
    const updatedBlocks = await this.storage.getBlocksByDeck(deckId);
    
    // 6. 生成队列
    const queueResult = this.queueGenerator.generateQueue(updatedBlocks, groupMapping);
    
    return {
      ...queueResult,
      deckId,
      strategy: this.strategy,
      overloadInfo: {
        isOverloaded: overloadStats.isOverloaded,
        overloadRatio: overloadStats.overloadRatio
      }
    };
  }
  
  // ============================================
  // 内容块操作
  // ============================================
  
  /**
   * 完成内容块阅读
   * 
   * @param block 内容块
   * @param data 阅读完成数据
   * @param deckId 牌组 ID
   * @returns 完成结果
   */
  async completeBlock(
    block: IRBlock,
    data: ReadingCompletionData,
    deckId: string = ''
  ): Promise<CompleteBlockResult> {
    await this.initialize();
    
    // 1. 获取标签组参数
    const groupProfile = await this.tagGroupService.getProfileForDocument(block.filePath);
    
    // 2. 完成阅读
    const updatedBlock = await this.scheduler.completeBlock(block, data, deckId, groupProfile);
    
    // 3. 如果启用组参数学习，更新组参数
    if (this.advancedSettings.tagGroupLearningSpeed !== 'off') {
      const { calculateLoadSignal } = await import('./IRSchedulerV3');
      const loadSignal = calculateLoadSignal(
        data.readingTimeSeconds,
        data.createdCardCount,
        data.createdExtractCount,
        data.createdNoteCount
      );
      
      const priorityWeight = Math.max(
        this.advancedSettings.priorityWeightClamp[0],
        Math.min(
          this.advancedSettings.priorityWeightClamp[1],
          0.5 + (updatedBlock.priorityEff ?? 5) / 10
        )
      );
      
      await this.tagGroupService.updateGroupProfile(
        groupProfile.groupId,
        loadSignal,
        priorityWeight,
        this.advancedSettings
      );
    }
    
    // 4. 获取队列中的下一个（如果有）
    const queueResult = await this.getStudyQueue(deckId);
    const nextInQueue = queueResult.queue.find(b => b.id !== updatedBlock.id) ?? null;
    
    return {
      block: updatedBlock,
      groupProfile,
      nextInQueue
    };
  }
  
  /**
   * 更新内容块优先级
   */
  async updatePriority(block: IRBlock, priorityUi: number): Promise<IRBlock> {
    await this.initialize();
    return this.scheduler.updatePriority(block, priorityUi);
  }
  
  /**
   * 暂停内容块
   */
  async suspendBlock(block: IRBlock, deckId: string = ''): Promise<IRBlock> {
    await this.initialize();
    return this.scheduler.suspendBlock(block, deckId);
  }
  
  /**
   * 恢复内容块
   */
  async unsuspendBlock(block: IRBlock): Promise<IRBlock> {
    await this.initialize();
    return this.scheduler.unsuspendBlock(block);
  }
  
  /**
   * 跳过内容块
   */
  async skipBlock(block: IRBlock, deckId: string = ''): Promise<void> {
    await this.initialize();
    return this.scheduler.skipBlock(block, deckId);
  }
  
  // ============================================
  // 后推操作
  // ============================================
  
  /**
   * 批量后推
   */
  async postponeBlocks(blocks: IRBlock[], days: number): Promise<IRBlock[]> {
    await this.initialize();
    const postponedBlocks = this.queueGenerator.manualPostpone(blocks, days);
    await this.storage.saveBlocks(postponedBlocks);
    return postponedBlocks;
  }
  
  /**
   * 按组后推
   */
  async postponeByGroup(
    deckId: string,
    groupId: string,
    days: number
  ): Promise<IRBlock[]> {
    await this.initialize();
    
    const blocks = await this.storage.getBlocksByDeck(deckId);
    const groupMapping: Record<string, string> = {};
    
    for (const block of blocks) {
      if (!groupMapping[block.filePath]) {
        groupMapping[block.filePath] = await this.tagGroupService.matchGroupForDocument(block.filePath);
      }
    }
    
    const postponedBlocks = this.queueGenerator.postponeByGroup(blocks, groupId, groupMapping, days);
    await this.storage.saveBlocks(postponedBlocks);
    
    return postponedBlocks;
  }
  
  /**
   * 按优先级后推
   */
  async postponeByPriority(
    deckId: string,
    maxPriority: number,
    days: number
  ): Promise<IRBlock[]> {
    await this.initialize();
    
    const blocks = await this.storage.getBlocksByDeck(deckId);
    const postponedBlocks = this.queueGenerator.postponeByPriority(blocks, maxPriority, days);
    await this.storage.saveBlocks(postponedBlocks);
    
    return postponedBlocks;
  }
  
  // ============================================
  // 标签组管理
  // ============================================
  
  /**
   * 获取所有标签组
   */
  async getAllTagGroups(): Promise<IRTagGroup[]> {
    await this.initialize();
    return this.tagGroupService.getAllGroups();
  }
  
  /**
   * 创建标签组
   */
  async createTagGroup(
    name: string,
    matchAnyTags: string[],
    description?: string
  ): Promise<IRTagGroup> {
    await this.initialize();
    return this.tagGroupService.createGroup(name, matchAnyTags, description);
  }
  
  /**
   * 删除标签组
   */
  async deleteTagGroup(id: string): Promise<void> {
    await this.initialize();
    return this.tagGroupService.deleteGroup(id);
  }
  
  /**
   * 获取标签组统计
   */
  async getTagGroupStats(): Promise<Array<{
    group: IRTagGroup;
    profile: IRTagGroupProfile;
    documentCount: number;
  }>> {
    await this.initialize();
    return this.tagGroupService.getGroupStats();
  }
  
  // ============================================
  // 统计与监控
  // ============================================
  
  /**
   * 获取调度统计
   */
  async getScheduleStats(deckId: string): Promise<{
    newCount: number;
    learningCount: number;
    reviewCount: number;
    suspendedCount: number;
    dueToday: number;
    overdue: number;
    upcoming7Days: number;
    reachedDailyLimit: number;
  }> {
    await this.initialize();
    return this.scheduler.getScheduleStats(deckId);
  }
  
  /**
   * 获取过载信息
   */
  async getOverloadInfo(deckId: string): Promise<{
    isOverloaded: boolean;
    dueCount: number;
    budgetCount: number;
    overloadRatio: number;
    groupOverload: Record<string, { due: number; ratio: number }>;
  }> {
    await this.initialize();
    
    const blocks = await this.storage.getBlocksByDeck(deckId);
    const groupMapping: Record<string, string> = {};
    
    for (const block of blocks) {
      if (!groupMapping[block.filePath]) {
        groupMapping[block.filePath] = await this.tagGroupService.matchGroupForDocument(block.filePath);
      }
    }
    
    return this.queueGenerator.getOverloadStats(blocks, groupMapping);
  }
  
  // ============================================
  // 子服务访问
  // ============================================
  
  /**
   * 获取存储服务（高级用途）
   */
  getStorage(): IRStorageService {
    return this.storage;
  }
  
  /**
   * 获取调度器（高级用途）
   */
  getScheduler(): IRSchedulerV3 {
    return this.scheduler;
  }
  
  /**
   * 获取标签组服务（高级用途）
   */
  getTagGroupService(): IRTagGroupService {
    return this.tagGroupService;
  }
  
  /**
   * 获取队列生成器（高级用途）
   */
  getQueueGenerator(): IRQueueGenerator {
    return this.queueGenerator;
  }
}

/**
 * 工厂函数
 */
export function createIRSchedulingFacade(
  app: App,
  config?: IRSchedulingFacadeConfig
): IRSchedulingFacade {
  return new IRSchedulingFacade(app, config);
}
