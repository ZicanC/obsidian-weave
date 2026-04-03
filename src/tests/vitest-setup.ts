import { logger } from '../utils/logger';
/**
 * Vitest测试环境配置
 *
 * 提供全局测试工具和DOM匹配器
 */

import '@testing-library/jest-dom';
import { afterEach, vi } from 'vitest';

type TestWindow = Window &
  typeof globalThis & {
    app?: Record<string, unknown>;
    __weaveThemeManagerCleanup?: (() => void) | null;
  };

// 全局测试工具
Object.defineProperty(globalThis, 'vi', {
  configurable: true,
  value: vi,
  writable: true
});

// Mock Obsidian全局对象（如果需要）
if (typeof window !== 'undefined') {
  // 确保测试环境中有基本的window对象
  const testWindow = window as TestWindow;
  testWindow.app ??= {};
}

// 清理函数：每个测试后清理
afterEach(() => {
  const testWindow = typeof window !== 'undefined' ? (window as TestWindow) : null;

  try {
    testWindow?.__weaveThemeManagerCleanup?.();
  } catch {
    // ignore theme manager cleanup issues in tests
  }

  vi.clearAllMocks();
});

logger.debug('✓ Vitest测试环境已初始化');
