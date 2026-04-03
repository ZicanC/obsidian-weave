/**
 * 高级功能守卫服务
 * 单例模式，管理高级功能的访问控制
 */

import { writable, get, type Writable } from 'svelte/store';
import { licenseManager } from '../../utils/licenseManager';
import type { LicenseInfo } from '../../utils/licenseManager';

/**
 * 高级功能ID定义
 */
export const PREMIUM_FEATURES = {
  GRID_VIEW: 'grid-view',
  KANBAN_VIEW: 'kanban-view',
  AI_ASSISTANT: 'ai-assistant',
  INCREMENTAL_READING: 'incremental-reading',
  BATCH_PARSING: 'batch-parsing',
  QUESTION_BANK: 'question-bank',
  DECK_ANALYTICS: 'deck-analytics',
  PROGRESSIVE_CLOZE: 'progressive-cloze',
  CSV_IMPORT: 'csv-import',
  CLIPBOARD_IMPORT: 'clipboard-import',
  VIEW_SOURCE: 'view-source'
} as const;

/**
 * 功能元数据
 */
export const FEATURE_METADATA: Record<string, {
  name: string;
  description: string;
  icon?: string;
}> = {
  [PREMIUM_FEATURES.GRID_VIEW]: {
    name: '网格视图',
    description: '以卡片网格形式展示，让管理更直观',
    icon: 'th-large'
  },
  [PREMIUM_FEATURES.KANBAN_VIEW]: {
    name: '看板视图',
    description: '看板式管理，按状态分类显示',
    icon: 'columns'
  },
  [PREMIUM_FEATURES.AI_ASSISTANT]: {
    name: 'AI智能助手',
    description: '智能批量生成高质量记忆卡片',
    icon: 'robot'
  },
  [PREMIUM_FEATURES.INCREMENTAL_READING]: {
    name: '渐进性阅读',
    description: '支持增量阅读工作流',
    icon: 'book-reader'
  },
  [PREMIUM_FEATURES.BATCH_PARSING]: {
    name: '批量解析系统',
    description: '自动解析文档中的卡片，支持文件夹映射和智能触发',
    icon: 'sync-alt'
  },
  [PREMIUM_FEATURES.QUESTION_BANK]: {
    name: '题库系统',
    description: '专业的题库考试功能，支持考试、小测验等多种模式',
    icon: 'clipboard-list'
  },
  [PREMIUM_FEATURES.DECK_ANALYTICS]: {
    name: '牌组分析',
    description: '详细的牌组学习数据分析、记忆曲线和负荷预测',
    icon: 'chart-bar'
  },
  [PREMIUM_FEATURES.PROGRESSIVE_CLOZE]: {
    name: '渐进式挖空',
    description: '智能渐进式挖空学习，逐步掌握复杂知识点',
    icon: 'layers'
  },
  [PREMIUM_FEATURES.CSV_IMPORT]: {
    name: 'CSV 导入',
    description: '通过 CSV 文件批量导入卡片',
    icon: 'file-text'
  },
  [PREMIUM_FEATURES.CLIPBOARD_IMPORT]: {
    name: '剪贴板导入',
    description: '从剪贴板文本快速批量导入卡片',
    icon: 'clipboard-paste'
  },
  [PREMIUM_FEATURES.VIEW_SOURCE]: {
    name: '查看原文',
    description: '快速查看卡片来源文档和上下文',
    icon: 'file-text'
  }
};

/**
 * 高级功能守卫类
 * 单例模式，管理许可证验证和功能访问控制
 */
export class PremiumFeatureGuard {
  private static instance: PremiumFeatureGuard;
  
  /**
   * 高级版状态 Store
   * 用于响应式更新UI
   */
  public isPremiumActive: Writable<boolean>;

  /**
   * 是否显示高级功能预览入口
   * 兼容新版 UI 的公开分支降级实现
   */
  public premiumFeaturesPreviewEnabled: Writable<boolean>;
  
  /**
   * 验证缓存
   * 避免频繁验证许可证
   */
  private validationCache: {
    isValid: boolean;
    timestamp: number;
  } | null = null;
  
  /**
   * 缓存有效期：5分钟
   */
  private readonly CACHE_DURATION = 5 * 60 * 1000;

  /**
   * 私有构造函数，确保单例
   */
  private constructor() {
    this.isPremiumActive = writable(false);
    this.premiumFeaturesPreviewEnabled = writable(false);
  }

  /**
   * 获取单例实例
   */
  static getInstance(): PremiumFeatureGuard {
    if (!PremiumFeatureGuard.instance) {
      PremiumFeatureGuard.instance = new PremiumFeatureGuard();
    }
    return PremiumFeatureGuard.instance;
  }

  /**
   * 初始化守卫
   * @param licenseInfo 许可证信息
   */
  async initialize(licenseInfo: LicenseInfo | null): Promise<void> {
    const isValid = await this.validateLicense(licenseInfo);
    this.isPremiumActive.set(isValid);
  }

  /**
   * 更新许可证状态
   * @param licenseInfo 新的许可证信息
   */
  async updateLicense(licenseInfo: LicenseInfo | null): Promise<void> {
    // 清除缓存
    this.clearCache();
    
    // 验证新的许可证
    const isValid = await this.validateLicense(licenseInfo);
    this.isPremiumActive.set(isValid);
  }

  /**
   * 设置是否显示高级功能预览入口
   */
  setPremiumFeaturesPreview(enabled: boolean): void {
    this.premiumFeaturesPreviewEnabled.set(enabled);
  }

  /**
   * 判断一个功能是否属于高级功能
   */
  isPremiumFeature(featureId: string): boolean {
    if (featureId === PREMIUM_FEATURES.VIEW_SOURCE) {
      return false;
    }

    const premiumFeatureIds = Object.values(PREMIUM_FEATURES) as string[];
    return premiumFeatureIds.includes(featureId);
  }

  /**
   * 判断当前 UI 是否应该展示某个功能入口
   * 已激活用户始终展示；未激活用户仅在开启预览时展示高级功能入口。
   */
  shouldShowFeatureEntry(
    featureId: string,
    options?: {
      isPremium?: boolean;
      showPremiumPreview?: boolean;
    }
  ): boolean {
    if (!this.isPremiumFeature(featureId)) {
      return true;
    }

    const isPremium = options?.isPremium ?? get(this.isPremiumActive);
    if (isPremium) {
      return true;
    }

    const showPremiumPreview =
      options?.showPremiumPreview ?? get(this.premiumFeaturesPreviewEnabled);
    return showPremiumPreview;
  }

  /**
   * 验证许可证
   * 使用缓存优化性能
   */
  private async validateLicense(licenseInfo: LicenseInfo | null): Promise<boolean> {
    // 未激活直接返回false
    if (!licenseInfo?.isActivated) {
      return false;
    }

    // 检查缓存
    if (this.validationCache) {
      const now = Date.now();
      if (now - this.validationCache.timestamp < this.CACHE_DURATION) {
        return this.validationCache.isValid;
      }
    }

    // 验证许可证
    const validation = await licenseManager.validateCurrentLicense(licenseInfo);
    
    // 更新缓存
    this.validationCache = {
      isValid: validation.isValid,
      timestamp: Date.now()
    };

    return validation.isValid;
  }

  /**
   * 检查是否可以使用某个功能
   * @param featureId 功能ID
   * @returns true表示可以使用
   */
  canUseFeature(featureId: string): boolean {
    // 使用 get() 同步获取当前高级版状态
    const isPremium = get(this.isPremiumActive);

    // 查看原文功能完全免费，不受许可证限制
    if (featureId === PREMIUM_FEATURES.VIEW_SOURCE) {
      return true;
    }

    // 检查是否为高级功能
    if (this.isPremiumFeature(featureId)) {
      return isPremium;
    }

    // 非高级功能，所有人都可以使用
    return true;
  }

  /**
   * 检查功能是否受限（canUseFeature的反向）
   * @param featureId 功能ID
   * @returns true表示功能受限，不可使用
   */
  isFeatureRestricted(featureId: string): boolean {
    return !this.canUseFeature(featureId);
  }

  /**
   * 清除验证缓存
   */
  private clearCache(): void {
    this.validationCache = null;
  }
}

/**
 * 默认导出单例实例获取方法
 */
export default PremiumFeatureGuard;




