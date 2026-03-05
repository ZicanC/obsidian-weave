import { logger } from '../../utils/logger';
/**
 * CardStore适配器
 * 
 * 桥接V2架构的ICardStore接口和现有的AnkiDataStorage
 * 
 * @module services/progressive-cloze/CardStoreAdapter
 * @version 2.0.0
 */

import type { Card } from '../../data/types';
import type { ICardStore } from './CardAccessor';
import type { WeaveDataStorage } from '../../data/storage';

/**
 * CardStore适配器
 * 
 * 将AnkiDataStorage适配为ICardStore接口
 */
export class CardStoreAdapter implements ICardStore {
  private cardsCache: Map<string, Card> = new Map();
  private cacheInitialized = false;
  
  constructor(private storage: WeaveDataStorage) {}
  
  /**
   * 初始化缓存
   * 从存储加载所有卡片到内存缓存
   */
  async initializeCache(): Promise<void> {
    if (this.cacheInitialized) return;
    
    try {
      const decks = await this.storage.getDecks();
      
      for (const deck of decks) {
        const cards = await this.storage.getCards({ deckId: deck.id });
        for (const card of cards) {
          this.cardsCache.set(card.uuid, card);
        }
      }
      
      this.cacheInitialized = true;
      logger.debug(`[CardStoreAdapter] 缓存初始化完成: ${this.cardsCache.size}张卡片`);
    } catch (error) {
      logger.error('[CardStoreAdapter] 缓存初始化失败:', error);
      throw error;
    }
  }
  
  /**
   * 获取单张卡片
   */
  getCard(uuid: string): Card | null {
    return this.cardsCache.get(uuid) || null;
  }
  
  /**
   * 批量获取卡片
   */
  getCards(uuids: string[]): Card[] {
    const cards: Card[] = [];
    
    for (const uuid of uuids) {
      const card = this.cardsCache.get(uuid);
      if (card) {
        cards.push(card);
      }
    }
    
    return cards;
  }
  
  /**
   * 保存卡片到缓存
   * 
   * 注意：这只更新缓存，需要调用storage.saveCard持久化
   */
  updateCache(card: Card): void {
    this.cardsCache.set(card.uuid, card);
  }
  
  /**
   * 从缓存删除卡片
   */
  removeFromCache(uuid: string): void {
    this.cardsCache.delete(uuid);
  }
  
  /**
   * 批量更新缓存
   */
  updateCacheBatch(cards: Card[]): void {
    for (const card of cards) {
      this.cardsCache.set(card.uuid, card);
    }
  }
  
  /**
   * 清空缓存
   */
  clearCache(): void {
    this.cardsCache.clear();
    this.cacheInitialized = false;
  }
  
  /**
   * 获取所有卡片
   */
  getAllCards(): Card[] {
    return Array.from(this.cardsCache.values());
  }
  
  /**
   * 获取缓存统计
   */
  getCacheStats(): {
    totalCards: number;
    initialized: boolean;
  } {
    return {
      totalCards: this.cardsCache.size,
      initialized: this.cacheInitialized
    };
  }
}
