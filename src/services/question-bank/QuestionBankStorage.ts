import { logger } from '../../utils/logger';
/**
 * 题库数据存储服务
 * 
 *  数据结构（v3.0.0 单文件合并）：
 * ```
 * weave/question-bank/
 * ├── banks.json                      (题库元数据列表)
 * ├── question-stats.json             (全局题目统计)
 * ├── test-history.json               (所有题库的历史分数)
 * ├── in-progress.json                (所有题库的进行中会话)
 * ├── session-archives.json           (所有题库的会话归档)
 * ├── error-book.json                 (所有题库的错题本)
 * └── banks/
 *     ├── {bankId-1}/
 *     │   └── questions.json          (该题库的题目引用)
 *     └── ...
 * ```
 * 
 * @module services/question-bank/QuestionBankStorage
 */

import { App } from 'obsidian';
import type { Deck, Card } from '../../data/types';
import { getV2PathsFromApp } from '../../config/paths';
import type { ErrorBookEntry, PersistedTestSession, TestHistoryEntry, QuestionRef, QuestionTestStats, TestSession } from '../../types/question-bank-types';
import { accuracyCalculator } from './AccuracyCalculator';

/**
 * 题库数据存储服务
 */
export class QuestionBankStorage {
  private app: App;
  private basePath: string;
  
  constructor(app: App) {
    if (!app || !app.vault) {
      throw new Error('QuestionBankStorage requires a valid App instance with vault');
    }
    this.app = app;
    // 根据当前数据源动态计算路径
    this.basePath = this.getQuestionBankPath();
    logger.debug('[QuestionBankStorage] Initialized with basePath:', this.basePath);
  }

  /**
   * 获取题库文件夹路径（基于当前数据源）
   */
  private getQuestionBankPath(): string {
    return getV2PathsFromApp(this.app).questionBank.root;
  }
  
  // ============================================================================
  // 初始化和路径管理
  // ============================================================================
  
  /**
   * 初始化存储目录结构
   */
  async initialize(): Promise<void> {
    const adapter = this.app.vault.adapter;

    if (!(await adapter.exists(this.basePath))) {
      await adapter.mkdir(this.basePath);
    }
    
    const banksDir = `${this.basePath}/banks`;
    if (!(await adapter.exists(banksDir))) {
      await adapter.mkdir(banksDir);
    }

    await this.migratePerFilesToConsolidated();
    await this.migrateLegacyTestSessionsToHistory();
    await this.migratePerBankQuestionStatsToGlobal();
  }

  private computeStatsFromAttempts(attempts: Array<{ isCorrect: boolean; timestamp: string; score?: number; timeSpent?: number }>): QuestionTestStats {
    const sorted = (attempts || [])
      .filter((a) => a && typeof a.timestamp === 'string')
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    const totalAttempts = sorted.length;
    const correctAttempts = sorted.filter((a) => a.isCorrect).length;
    const incorrectAttempts = totalAttempts - correctAttempts;

    let bestScore = 0;
    let lastScore = 0;
    let averageScore = 0;
    let fastestTime = 0;
    let averageResponseTime = 0;
    let totalTime = 0;
    let lastTestDate = new Date().toISOString();
    let lastIncorrectDate: string | undefined = undefined;

    let isInErrorBook = false;
    let consecutiveCorrect = 0;

    for (let i = 0; i < sorted.length; i++) {
      const it = sorted[i];
      const score = typeof it.score === 'number' ? it.score : it.isCorrect ? 100 : 0;
      const timeSpentMs = typeof it.timeSpent === 'number' ? it.timeSpent : 0;

      lastScore = score;
      bestScore = Math.max(bestScore, score);
      averageScore = ((averageScore * i) + score) / (i + 1);

      if (timeSpentMs > 0) {
        totalTime += timeSpentMs;
        averageResponseTime = totalTime / (i + 1);
        if (fastestTime === 0 || timeSpentMs < fastestTime) {
          fastestTime = timeSpentMs;
        }
      }

      lastTestDate = it.timestamp;

      if (it.isCorrect) {
        consecutiveCorrect++;
        if (isInErrorBook && consecutiveCorrect >= 3) {
          isInErrorBook = false;
        }
      } else {
        consecutiveCorrect = 0;
        isInErrorBook = true;
        lastIncorrectDate = it.timestamp;
      }
    }

    const history = sorted.map((a) => ({
      isCorrect: !!a.isCorrect,
      mode: 'exam' as any,
      timestamp: a.timestamp,
      score: typeof a.score === 'number' ? a.score : a.isCorrect ? 100 : 0,
      timeSpent: typeof a.timeSpent === 'number' ? a.timeSpent : 0,
    }));

    const masteryMetrics = accuracyCalculator.calculateMastery(history as any);

    return {
      totalAttempts,
      correctAttempts,
      incorrectAttempts,
      accuracy: masteryMetrics.historicalAccuracy / 100,
      masteryMetrics,
      bestScore,
      averageScore,
      lastScore,
      averageResponseTime,
      fastestTime,
      lastTestDate,
      isInErrorBook,
      consecutiveCorrect,
      lastIncorrectDate,
      attempts: history as any,
    };
  }

  private mergeQuestionTestStats(a?: QuestionTestStats, b?: QuestionTestStats): QuestionTestStats {
    if (!a) return b as QuestionTestStats;
    if (!b) return a;

    const attemptsA = (a.attempts || []) as any[];
    const attemptsB = (b.attempts || []) as any[];

    const uniq = new Map<string, any>();
    for (const it of [...attemptsA, ...attemptsB]) {
      if (!it?.timestamp) continue;
      uniq.set(it.timestamp, it);
    }
    const mergedAttempts = Array.from(uniq.values()).sort(
      (x, y) => new Date(x.timestamp).getTime() - new Date(y.timestamp).getTime()
    );

    if (mergedAttempts.length > 0) {
      const trimmed = mergedAttempts.length > 200 ? mergedAttempts.slice(-200) : mergedAttempts;
      return this.computeStatsFromAttempts(trimmed);
    }

    return (a.totalAttempts || 0) >= (b.totalAttempts || 0) ? a : b;
  }

  private async migratePerBankQuestionStatsToGlobal(): Promise<void> {
    try {
      const banks = await this.loadBanks();
      if (!banks || banks.length === 0) return;

      const adapter = this.app.vault.adapter;
      const globalStats = await this.loadGlobalQuestionStats();
      let changed = false;

      for (const bank of banks) {
        const filePath = this.getBankQuestionStatsFilePath(bank.id);
        const exists = await adapter.exists(filePath);
        if (!exists) continue;

        const perBank = await this.loadBankQuestionStats(bank.id);
        const uuids = Object.keys(perBank || {});
        if (uuids.length === 0) {
          try {
            await adapter.remove(filePath);
          } catch {
          }
          continue;
        }

        for (const uuid of uuids) {
          globalStats[uuid] = this.mergeQuestionTestStats(globalStats[uuid], perBank[uuid]);
          changed = true;
        }

        try {
          await adapter.remove(filePath);
        } catch {
        }
      }

      if (changed) {
        await this.saveGlobalQuestionStats(globalStats);
      }
    } catch (error) {
      logger.error('[QuestionBankStorage] 迁移题目统计到全局失败:', error);
    }
  }
  
  /**
   * 获取文件完整路径
   */
  private getFilePath(filename: string): string {
    return `${this.basePath}/${filename}`;
  }
  
  // ============================================================================
  // 题库牌组存储
  // ============================================================================
  
  /**
   * 保存题库牌组列表
   */
  async saveBanks(banks: Deck[]): Promise<void> {
    const filePath = this.getFilePath('banks.json');
    const data = JSON.stringify(banks);
    
    try {
      await this.app.vault.adapter.write(filePath, data);
      logger.debug('[QuestionBankStorage] saveBanks 保存成功，题库数:', banks.length);
    } catch (error) {
      logger.error('[QuestionBankStorage] 保存题库牌组失败:', error);
      throw new Error(`保存题库牌组失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async saveGlobalQuestionStats(statsByUuid: Record<string, QuestionTestStats>): Promise<void> {
    const filePath = this.getGlobalQuestionStatsFilePath();
    const payload = {
      _schemaVersion: '1.0.0',
      statsByUuid,
    };

    try {
      await this.app.vault.adapter.write(filePath, JSON.stringify(payload));
    } catch (error) {
      logger.error('[QuestionBankStorage] 保存全局题目统计失败:', error);
      throw new Error(`保存全局题目统计失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async loadGlobalQuestionStats(): Promise<Record<string, QuestionTestStats>> {
    const filePath = this.getGlobalQuestionStatsFilePath();

    try {
      const exists = await this.app.vault.adapter.exists(filePath);
      if (!exists) return {};
      const data = await this.app.vault.adapter.read(filePath);
      if (!data || data.trim().length === 0) return {};
      const parsed = JSON.parse(data);
      const stats = parsed.statsByUuid;
      return stats && typeof stats === 'object' ? (stats as Record<string, QuestionTestStats>) : {};
    } catch (error) {
      logger.error('[QuestionBankStorage] 加载全局题目统计失败:', error);
      return {};
    }
  }
  
  /**
   * 加载题库牌组列表
   */
  async loadBanks(): Promise<Deck[]> {
    const filePath = this.getFilePath('banks.json');
    
    try {
      const exists = await this.app.vault.adapter.exists(filePath);
      if (!exists) {
        logger.debug('[QuestionBankStorage] banks.json 不存在，返回空数组');
        return [];
      }
      
      const data = await this.app.vault.adapter.read(filePath);
      const parsed = JSON.parse(data);
      
      // 确保返回的是数组
      if (!Array.isArray(parsed)) {
        logger.error('[QuestionBankStorage] banks.json 格式错误，期望数组但得到:', typeof parsed);
        return [];
      }
      
      logger.debug('[QuestionBankStorage] loadBanks 加载完成，题库数:', parsed.length);
      return parsed as Deck[];
    } catch (error) {
      logger.error('[QuestionBankStorage] 加载题库牌组失败:', error);
      return [];
    }
  }
  
  // ============================================================================
  // 题目卡片存储（按题库分离）
  // ============================================================================

  private getBankDir(bankId: string): string {
    return `${this.basePath}/banks/${bankId}`;
  }

  private async ensureBankDir(bankId: string): Promise<void> {
    const adapter = this.app.vault.adapter;
    const banksDir = `${this.basePath}/banks`;
    if (!(await adapter.exists(banksDir))) {
      await adapter.mkdir(banksDir);
    }

    const bankDir = this.getBankDir(bankId);
    if (!(await adapter.exists(bankDir))) {
      await adapter.mkdir(bankDir);
    }
  }

  private getBankQuestionRefsFilePath(bankId: string): string {
    return `${this.getBankDir(bankId)}/questions.json`;
  }

  private getBankQuestionStatsFilePath(bankId: string): string {
    return `${this.getBankDir(bankId)}/question-stats.json`;
  }

  private getGlobalQuestionStatsFilePath(): string {
    return `${this.basePath}/question-stats.json`;
  }

  private async loadConsolidatedMap<T>(filePath: string): Promise<Record<string, T>> {
    try {
      const exists = await this.app.vault.adapter.exists(filePath);
      if (!exists) return {};
      const data = await this.app.vault.adapter.read(filePath);
      if (!data || data.trim().length === 0) return {};
      const parsed = JSON.parse(data);
      return parsed.byBank || {};
    } catch {
      return {};
    }
  }

  private async saveConsolidatedMap<T>(filePath: string, byBank: Record<string, T>): Promise<void> {
    const payload = { _schemaVersion: '2.0.0', byBank };
    await this.app.vault.adapter.write(filePath, JSON.stringify(payload));
  }

  async saveBankQuestionRefs(bankId: string, refs: QuestionRef[]): Promise<void> {
    if (!Array.isArray(refs)) {
      const errorMsg = `saveBankQuestionRefs 期望数组参数，但得到: ${typeof refs}`;
      logger.error(`[QuestionBankStorage] ${errorMsg}`);
      throw new Error(errorMsg);
    }

    await this.ensureBankDir(bankId);

    const filePath = this.getBankQuestionRefsFilePath(bankId);
    const payload = {
      _schemaVersion: '2.0.0',
      bankId,
      refs
    };

    try {
      await this.app.vault.adapter.write(filePath, JSON.stringify(payload));
      logger.debug(`[QuestionBankStorage] ✅ 已保存题库题目引用: ${bankId}, 数量: ${refs.length}`);
    } catch (error) {
      logger.error('[QuestionBankStorage] 保存题库题目引用失败:', error);
      throw new Error(`保存题库题目引用失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async loadBankQuestionRefs(bankId: string): Promise<QuestionRef[]> {
    const filePath = this.getBankQuestionRefsFilePath(bankId);

    try {
      const exists = await this.app.vault.adapter.exists(filePath);
      if (!exists) {
        return [];
      }

      const data = await this.app.vault.adapter.read(filePath);
      if (!data || data.trim().length === 0) {
        logger.warn(`[QuestionBankStorage] 题库题目文件为空: ${bankId}`);
        return [];
      }

      const parsed = JSON.parse(data);
      const items: unknown = parsed.refs ?? parsed.questions;
      if (!Array.isArray(items)) {
        logger.error(`[QuestionBankStorage] 题目数据格式错误，期望数组但得到: ${typeof items}`);
        return [];
      }

      const first = items[0] as any;
      if (first && typeof first === 'object' && typeof first.cardUuid === 'string') {
        return items as QuestionRef[];
      }

      // 旧格式：questions 为 Card[]，自动迁移为 refs + question-stats
      if (first && typeof first === 'object' && typeof first.uuid === 'string') {
        const now = new Date().toISOString();
        const legacyCards = items as Card[];
        const refs: QuestionRef[] = legacyCards
          .filter((c) => c && typeof c.uuid === 'string')
          .map((c) => ({ cardUuid: c.uuid, addedAt: c.created || now }));

        const statsByUuid: Record<string, QuestionTestStats> = {};
        for (const c of legacyCards) {
          const uuid = (c as any)?.uuid;
          const ts = (c as any)?.stats?.testStats;
          if (uuid && ts) {
            statsByUuid[uuid] = ts as QuestionTestStats;
          }
        }

        await this.saveBankQuestionRefs(bankId, refs);
        await this.saveBankQuestionStats(bankId, statsByUuid);
        return refs;
      }

      return [];
    } catch (error) {
      logger.error(`[QuestionBankStorage] 加载题库题目引用失败: ${bankId}`, error);
      return [];
    }
  }

  async saveBankQuestionStats(bankId: string, statsByUuid: Record<string, QuestionTestStats>): Promise<void> {
    await this.ensureBankDir(bankId);
    const filePath = this.getBankQuestionStatsFilePath(bankId);
    const payload = {
      _schemaVersion: '1.0.0',
      bankId,
      statsByUuid
    };

    try {
      await this.app.vault.adapter.write(filePath, JSON.stringify(payload));
    } catch (error) {
      logger.error('[QuestionBankStorage] 保存题库题目统计失败:', error);
      throw new Error(`保存题库题目统计失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async loadBankQuestionStats(bankId: string): Promise<Record<string, QuestionTestStats>> {
    const filePath = this.getBankQuestionStatsFilePath(bankId);

    try {
      const exists = await this.app.vault.adapter.exists(filePath);
      if (!exists) return {};
      const data = await this.app.vault.adapter.read(filePath);
      if (!data || data.trim().length === 0) return {};
      const parsed = JSON.parse(data);
      const stats = parsed.statsByUuid;
      return stats && typeof stats === 'object' ? (stats as Record<string, QuestionTestStats>) : {};
    } catch (error) {
      logger.error('[QuestionBankStorage] 加载题库题目统计失败:', error);
      return {};
    }
  }

  async saveSessionArchive(bankId: string, sessionId: string, archive: unknown): Promise<void> {
    const filePath = getV2PathsFromApp(this.app).questionBank.sessionArchives;
    const all = await this.loadConsolidatedMap<Record<string, unknown>>(filePath);
    if (!all[bankId]) all[bankId] = {};
    all[bankId][sessionId] = archive;
    try {
      await this.saveConsolidatedMap(filePath, all);
    } catch (error) {
      logger.error('[QuestionBankStorage] 保存会话归档失败:', error);
      throw new Error(`保存会话归档失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * 保存题库的题目列表（单文件存储）
   * 每个题库的所有题目存储在一个 questions.json 文件中
   * @param bankId 题库ID
   * @param questions 题目列表
   */
  async saveBankQuestions(bankId: string, questions: Card[]): Promise<void> {
    //  参数验证：确保传入的是数组
    if (!Array.isArray(questions)) {
      const errorMsg = `saveBankQuestions 期望数组参数，但得到: ${typeof questions}`;
      logger.error(`[QuestionBankStorage] ${errorMsg}`);
      throw new Error(errorMsg);
    }
    
    // 确保目录存在
    const bankDir = `${this.basePath}/banks/${bankId}`;
    if (!(await this.app.vault.adapter.exists(bankDir))) {
      await this.app.vault.adapter.mkdir(bankDir);
    }
    
    const filePath = `${bankDir}/questions.json`;
    const payload = {
      _schemaVersion: "1.0.0",
      bankId,
      questions
    };
    const data = JSON.stringify(payload);
    
    try {
      await this.app.vault.adapter.write(filePath, data);
      logger.debug(`[QuestionBankStorage] ✅ 已保存题库题目: ${bankId}, 题目数: ${questions.length}`);
    } catch (error) {
      logger.error('[QuestionBankStorage] 保存题库题目失败:', error);
      throw new Error(`保存题库题目失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * 加载题库的题目列表（单文件存储）
   * @param bankId 题库ID
   */
  async loadBankQuestions(bankId: string): Promise<Card[]> {
    const filePath = `${this.basePath}/banks/${bankId}/questions.json`;
    
    try {
      const exists = await this.app.vault.adapter.exists(filePath);
      if (!exists) {
        return [];
      }
      
      const data = await this.app.vault.adapter.read(filePath);
      
      //  增强错误处理：检查空文件和格式错误
      if (!data || data.trim().length === 0) {
        logger.warn(`[QuestionBankStorage] 题库题目文件为空: ${bankId}`);
        return [];
      }
      
      const parsed = JSON.parse(data);
      
      // 确保返回的是数组
      if (!Array.isArray(parsed.questions)) {
        logger.error(`[QuestionBankStorage] 题目数据格式错误，期望数组但得到: ${typeof parsed.questions}`);
        return [];
      }
      
      return parsed.questions as Card[];
    } catch (error) {
      logger.error(`[QuestionBankStorage] 加载题库题目失败: ${bankId}`, error);
      return [];
    }
  }
  
  // 按题库分离存储：每个题库一个文件夹，一个 questions.json 文件
  // 类似记忆牌组的 decks/{deckId}/cards.json 结构
  
  // ============================================================================
  // 测试会话存储
  // ============================================================================

  async saveInProgressSession(bankId: string, session: PersistedTestSession): Promise<void> {
    const filePath = getV2PathsFromApp(this.app).questionBank.inProgress;
    const all = await this.loadConsolidatedMap<PersistedTestSession>(filePath);
    all[bankId] = session;
    try {
      await this.saveConsolidatedMap(filePath, all);
    } catch (error) {
      logger.error('[QuestionBankStorage] 保存进行中会话失败:', error);
      throw new Error(`保存进行中会话失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async loadInProgressSession(bankId: string): Promise<PersistedTestSession | null> {
    const filePath = getV2PathsFromApp(this.app).questionBank.inProgress;
    const all = await this.loadConsolidatedMap<PersistedTestSession>(filePath);
    return all[bankId] || null;
  }

  async clearInProgressSession(bankId: string): Promise<void> {
    const filePath = getV2PathsFromApp(this.app).questionBank.inProgress;
    const all = await this.loadConsolidatedMap<PersistedTestSession>(filePath);
    if (bankId in all) {
      delete all[bankId];
      try {
        await this.saveConsolidatedMap(filePath, all);
      } catch (error) {
        logger.error('[QuestionBankStorage] 清理进行中会话失败:', error);
      }
    }
  }

  async loadTestHistory(bankId: string): Promise<TestHistoryEntry[]> {
    const filePath = getV2PathsFromApp(this.app).questionBank.testHistory;
    const all = await this.loadConsolidatedMap<TestHistoryEntry[]>(filePath);
    return all[bankId] || [];
  }

  async appendTestHistoryEntry(bankId: string, entry: TestHistoryEntry, maxEntries = 200): Promise<void> {
    const filePath = getV2PathsFromApp(this.app).questionBank.testHistory;
    const all = await this.loadConsolidatedMap<TestHistoryEntry[]>(filePath);
    const history = all[bankId] || [];

    const map = new Map<string, TestHistoryEntry>();
    for (const it of history) {
      if (it && it.sessionId) map.set(it.sessionId, it);
    }
    map.set(entry.sessionId, entry);

    const merged = Array.from(map.values()).sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    all[bankId] = merged.length > maxEntries ? merged.slice(-maxEntries) : merged;
    try {
      await this.saveConsolidatedMap(filePath, all);
    } catch (error) {
      logger.error('[QuestionBankStorage] 保存历史分数失败:', error);
      throw new Error(`保存历史分数失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  // ============================================================================
  // 错题本存储
  // ============================================================================
  
  /**
   * 保存错题本数据
   */
  async saveErrorBook(bankId: string, errors: ErrorBookEntry[]): Promise<void> {
    const filePath = getV2PathsFromApp(this.app).questionBank.errorBook;
    const all = await this.loadConsolidatedMap<ErrorBookEntry[]>(filePath);
    all[bankId] = errors;
    try {
      await this.saveConsolidatedMap(filePath, all);
    } catch (error) {
      logger.error('[QuestionBankStorage] 保存错题本失败:', error);
      throw new Error(`保存错题本失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  async loadErrorBook(bankId: string): Promise<ErrorBookEntry[]> {
    const filePath = getV2PathsFromApp(this.app).questionBank.errorBook;
    const all = await this.loadConsolidatedMap<ErrorBookEntry[]>(filePath);
    return all[bankId] || [];
  }
  
  async deleteErrorBook(bankId: string): Promise<void> {
    const filePath = getV2PathsFromApp(this.app).questionBank.errorBook;
    const all = await this.loadConsolidatedMap<ErrorBookEntry[]>(filePath);
    if (bankId in all) {
      delete all[bankId];
      try {
        await this.saveConsolidatedMap(filePath, all);
      } catch (error) {
        logger.error('[QuestionBankStorage] 删除错题本失败:', error);
      }
    }
  }
  
  /**
   * 删除题库的题目文件
   * @param bankId 题库ID
   */
  async deleteBankQuestions(bankId: string): Promise<void> {
    const filePath = `${this.basePath}/banks/${bankId}/questions.json`;
    const statsPath = `${this.basePath}/banks/${bankId}/question-stats.json`;
    
    try {
      const exists = await this.app.vault.adapter.exists(filePath);
      if (exists) {
        await this.app.vault.adapter.remove(filePath);
      }

	  const statsExists = await this.app.vault.adapter.exists(statsPath);
	  if (statsExists) {
		await this.app.vault.adapter.remove(statsPath);
	  }
      
      // 尝试删除题库目录（如果为空）
      const bankDir = `${this.basePath}/banks/${bankId}`;
      const dirExists = await this.app.vault.adapter.exists(bankDir);
      if (dirExists) {
        try {
          await this.app.vault.adapter.rmdir(bankDir, false);
        } catch {
          // 目录不为空，忽略错误
        }
      }
    } catch (error) {
      logger.error('[QuestionBankStorage] 删除题库题目失败:', error);
    }
  }
  
  // ============================================================================
  // 数据清理和维护
  // ============================================================================
  
  /**
   * 清理过期的测试会话（保留最近30天）
   */
  async cleanupOldSessions(daysToKeep = 30): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    let removed = 0;
    try {
      const filePath = getV2PathsFromApp(this.app).questionBank.testHistory;
      const all = await this.loadConsolidatedMap<TestHistoryEntry[]>(filePath);
      let changed = false;

      for (const bankId of Object.keys(all)) {
        const entries = all[bankId];
        if (!Array.isArray(entries)) continue;
        const beforeLen = entries.length;
        all[bankId] = entries.filter((e) => {
          const t = new Date(e.timestamp).getTime();
          return Number.isFinite(t) && t >= cutoffDate.getTime();
        });
        const diff = beforeLen - all[bankId].length;
        if (diff > 0) {
          removed += diff;
          changed = true;
        }
      }

      if (changed) {
        await this.saveConsolidatedMap(filePath, all);
      }
      logger.debug(`[QuestionBankStorage] 清理了 ${removed} 条过期历史分数`);
      return removed;
    } catch (error) {
      logger.error('[QuestionBankStorage] 清理历史分数失败:', error);
      return removed;
    }
  }
  
  /**
   * 获取存储统计信息
   */
  async getStorageStats(): Promise<{
    banks: number;
    questions: number;
    sessions: number;
    errorBooks: number;
  }> {
    const banks = await this.loadBanks();
    const sessions = await this.getAllTestHistoryCount();
    
    let totalQuestions = 0;
    for (const bank of banks) {
      try {
        const refs = await this.loadBankQuestionRefs(bank.id);
        totalQuestions += refs.length;
      } catch (error) {
        logger.error(`[QuestionBankStorage] 加载题库${bank.id}题目失败:`, error);
      }
    }
    
    const errorBookPath = getV2PathsFromApp(this.app).questionBank.errorBook;
    const errorAll = await this.loadConsolidatedMap<ErrorBookEntry[]>(errorBookPath);
    const errorBooks = Object.keys(errorAll).length;
    
    return {
      banks: banks.length,
      questions: totalQuestions,
      sessions,
      errorBooks,
    };
  }

  private async getAllTestHistoryCount(): Promise<number> {
    try {
      const filePath = getV2PathsFromApp(this.app).questionBank.testHistory;
      const all = await this.loadConsolidatedMap<TestHistoryEntry[]>(filePath);
      let total = 0;
      for (const entries of Object.values(all)) {
        if (Array.isArray(entries)) total += entries.length;
      }
      return total;
    } catch {
      return 0;
    }
  }

  private async migratePerFilesToConsolidated(): Promise<void> {
    const adapter = this.app.vault.adapter;
    const v2 = getV2PathsFromApp(this.app);

    const dirs: Array<{
      dirName: string;
      targetPath: string;
      nested: boolean;
    }> = [
      { dirName: 'test-history', targetPath: v2.questionBank.testHistory, nested: false },
      { dirName: 'in-progress', targetPath: v2.questionBank.inProgress, nested: false },
      { dirName: 'error-book', targetPath: v2.questionBank.errorBook, nested: false },
      { dirName: 'session-archives', targetPath: v2.questionBank.sessionArchives, nested: true },
    ];

    for (const { dirName, targetPath, nested } of dirs) {
      const dirPath = `${this.basePath}/${dirName}`;
      try {
        if (!(await adapter.exists(dirPath))) continue;
        const stat = await adapter.stat(dirPath);
        if (!stat || stat.type !== 'folder') continue;

        const listing = await adapter.list(dirPath);
        if (listing.files.length === 0 && listing.folders.length === 0) {
          try { await adapter.rmdir(dirPath, false); } catch {}
          continue;
        }

        if (nested) {
          const consolidated: Record<string, Record<string, unknown>> = {};
          for (const subFolder of listing.folders) {
            const bankId = subFolder.split('/').pop() || '';
            if (!bankId) continue;
            try {
              const subListing = await adapter.list(subFolder);
              for (const file of subListing.files) {
                if (!file.endsWith('.json')) continue;
                const sessionId = file.split('/').pop()?.replace('.json', '') || '';
                try {
                  const data = await adapter.read(file);
                  if (!consolidated[bankId]) consolidated[bankId] = {};
                  consolidated[bankId][sessionId] = JSON.parse(data);
                  await adapter.remove(file);
                } catch {}
              }
              try { await adapter.rmdir(subFolder, false); } catch {}
            } catch {}
          }
          if (Object.keys(consolidated).length > 0) {
            const existing = await this.loadConsolidatedMap<Record<string, unknown>>(targetPath);
            for (const [bk, sessions] of Object.entries(consolidated)) {
              existing[bk] = { ...(existing[bk] || {}), ...sessions };
            }
            await this.saveConsolidatedMap(targetPath, existing);
          }
        } else {
          const consolidated: Record<string, unknown> = {};
          for (const file of listing.files) {
            if (!file.endsWith('.json')) continue;
            const bankId = file.split('/').pop()?.replace('.json', '') || '';
            if (!bankId) continue;
            try {
              const data = await adapter.read(file);
              consolidated[bankId] = JSON.parse(data);
              await adapter.remove(file);
            } catch {}
          }
          if (Object.keys(consolidated).length > 0) {
            const existing = await this.loadConsolidatedMap<unknown>(targetPath);
            for (const [bk, val] of Object.entries(consolidated)) {
              if (!(bk in existing)) existing[bk] = val;
            }
            await this.saveConsolidatedMap(targetPath, existing);
          }
        }

        try {
          const afterListing = await adapter.list(dirPath);
          if ((afterListing.files?.length || 0) === 0 && (afterListing.folders?.length || 0) === 0) {
            await adapter.rmdir(dirPath, false);
          }
        } catch {}
      } catch (error) {
        logger.error(`[QuestionBankStorage] 迁移 ${dirName} 到合并文件失败:`, error);
      }
    }
  }

  private async migrateLegacyTestSessionsToHistory(): Promise<void> {
    const adapter = this.app.vault.adapter;
    const dirPath = `${this.basePath}/test-sessions`;

    try {
      const exists = await adapter.exists(dirPath);
      if (!exists) return;

      const files = await adapter.list(dirPath);
      const sessionFiles = files.files.filter((f) => f.endsWith('.json'));
      if (sessionFiles.length === 0) return;

      for (const file of sessionFiles) {
        try {
          const raw = await adapter.read(file);
          const session = JSON.parse(raw) as TestSession;
          if (!session || !session.id || !session.bankId) continue;

          if (session.status === 'completed') {
            const answered = (session.correctCount || 0) + (session.wrongCount || 0);
            const accuracy = answered > 0 ? ((session.correctCount || 0) / answered) * 100 : 0;
            const score = typeof session.score === 'number'
              ? session.score
              : (session.totalQuestions ? Math.round(((session.correctCount || 0) / session.totalQuestions) * 100) : 0);
            const durationSeconds = Math.round((session.totalTimeSpent || session.duration || 0) as number);

            await this.appendTestHistoryEntry(session.bankId, {
              sessionId: session.id,
              bankId: session.bankId,
              timestamp: session.startTime || new Date().toISOString(),
              mode: session.mode,
              score,
              accuracy,
              totalQuestions: session.totalQuestions || (session.questions?.length || 0),
              correctCount: session.correctCount || 0,
              durationSeconds,
            });

            await adapter.remove(file);
            continue;
          }

          if (session.status === 'in_progress') {
            const persisted: PersistedTestSession = {
              id: session.id,
              bankId: session.bankId,
              bankName: session.bankName,
              mode: session.mode,
              startTime: session.startTime,
              endTime: session.endTime,
              duration: session.duration,
              questions: (session.questions || []).map((q) => ({
                questionId: q.questionId,
                userAnswer: q.userAnswer,
                correctAnswer: q.correctAnswer,
                isCorrect: q.isCorrect,
                errorMessage: q.errorMessage,
                timeSpent: q.timeSpent,
                submittedAt: q.submittedAt,
              })),
              totalQuestions: session.totalQuestions,
              completedQuestions: session.completedQuestions,
              correctCount: session.correctCount,
              incorrectCount: session.incorrectCount,
              wrongCount: session.wrongCount,
              score: session.score,
              accuracy: session.accuracy,
              skippedCount: session.skippedCount,
              status: session.status,
              currentQuestionIndex: session.currentQuestionIndex,
              totalTimeSpent: session.totalTimeSpent,
              completed: session.completed,
              abandoned: session.abandoned,
              config: session.config,
            };

            await this.saveInProgressSession(session.bankId, persisted);
            await adapter.remove(file);
            continue;
          }

          if (session.status === 'cancelled') {
            await adapter.remove(file);
          }
        } catch (error) {
          logger.error(`[QuestionBankStorage] 聚合迁移 test-sessions 失败: ${file}`, error);
        }
      }

      // 迁移完成后，如果目录为空则尝试删除
      try {
        const after = await adapter.list(dirPath);
        if ((after.files?.length || 0) === 0 && (after.folders?.length || 0) === 0) {
          await adapter.rmdir(dirPath, false);
        }
      } catch {
      }
    } catch (error) {
      logger.error('[QuestionBankStorage] 聚合迁移 test-sessions 失败:', error);
    }
  }
}

