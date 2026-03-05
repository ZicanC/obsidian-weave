/**
 * Vault-scoped localStorage wrapper
 * 
 * Uses Obsidian's App#saveLocalStorage / App#loadLocalStorage
 * to ensure data is unique to each vault.
 * 
 * Usage:
 *   import { vaultStorage } from '../utils/vault-local-storage';
 *   // Set app reference during plugin init:
 *   vaultStorage.setApp(this.app);
 *   // Then use like localStorage:
 *   vaultStorage.setItem('key', 'value');
 *   const val = vaultStorage.getItem('key');
 */

import type { App } from 'obsidian';

class VaultLocalStorage {
  private app: App | null = null;

  /**
   * Set the App reference (call once during plugin onload)
   */
  setApp(app: App): void {
    this.app = app;
  }

  getItem(key: string): string | null {
    if (this.app) {
      return (this.app as any).loadLocalStorage(key) ?? null;
    }
    return null;
  }

  setItem(key: string, value: string): void {
    if (this.app) {
      (this.app as any).saveLocalStorage(key, value);
    }
  }

  removeItem(key: string): void {
    if (this.app) {
      (this.app as any).saveLocalStorage(key, undefined);
    }
  }

  /**
   * Get all keys matching a prefix.
   * Falls back to scanning window.localStorage with vault-scoped prefix.
   */
  getKeysWithPrefix(prefix: string): string[] {
    const keys: string[] = [];
    try {
      for (let i = 0; i < window.localStorage.length; i++) {
        const rawKey = window.localStorage.key(i);
        if (rawKey && rawKey.includes(prefix)) {
          keys.push(prefix + rawKey.split(prefix).pop()!);
        }
      }
    } catch {
      // ignore
    }
    return keys;
  }
}

export const vaultStorage = new VaultLocalStorage();
