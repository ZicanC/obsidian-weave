import { getPluginPaths, getV2Paths } from '../../../config/paths';
import {
  DEFAULT_BATCH_FIX_TYPES,
  DataManagementService,
} from '../DataManagementService';

function normalizeTestPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '');
}

function parentPath(path: string): string {
  const normalized = normalizeTestPath(path);
  const idx = normalized.lastIndexOf('/');
  return idx > 0 ? normalized.slice(0, idx) : '';
}

function createMemoryPlugin(initialFiles: Record<string, string> = {}) {
  const files = new Map<string, string>();
  const folders = new Set<string>(['', '.obsidian', '.obsidian/plugins', '.obsidian/plugins/weave']);

  const ensureDir = (dir: string) => {
    const normalized = normalizeTestPath(dir);
    if (!normalized) return;
    const parts = normalized.split('/');
    let current = '';
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      folders.add(current);
    }
  };

  const writeText = (path: string, content: string) => {
    const normalized = normalizeTestPath(path);
    ensureDir(parentPath(normalized));
    files.set(normalized, content);
  };

  for (const [path, content] of Object.entries(initialFiles)) {
    writeText(path, content);
  }

  const adapter = {
    basePath: 'C:/vault',
    exists: async (path: string) => {
      const normalized = normalizeTestPath(path);
      return files.has(normalized) || folders.has(normalized);
    },
    mkdir: async (path: string) => {
      ensureDir(path);
    },
    list: async (dir: string) => {
      const normalized = normalizeTestPath(dir);
      const prefix = normalized ? `${normalized}/` : '';
      const childFolders = new Set<string>();
      const childFiles: string[] = [];

      for (const folder of folders) {
        if (!folder || folder === normalized || !folder.startsWith(prefix)) continue;
        const rest = folder.slice(prefix.length);
        if (!rest || rest.includes('/')) continue;
        childFolders.add(folder);
      }

      for (const file of files.keys()) {
        if (!file.startsWith(prefix)) continue;
        const rest = file.slice(prefix.length);
        if (!rest || rest.includes('/')) continue;
        childFiles.push(file);
      }

      return {
        files: childFiles.sort(),
        folders: Array.from(childFolders).sort(),
      };
    },
    read: async (path: string) => {
      const normalized = normalizeTestPath(path);
      const value = files.get(normalized);
      if (value === undefined) throw new Error(`File not found: ${normalized}`);
      return value;
    },
    write: async (path: string, content: string) => {
      writeText(path, content);
    },
    remove: async (path: string) => {
      const normalized = normalizeTestPath(path);
      if (files.has(normalized)) {
        files.delete(normalized);
        return;
      }
      folders.delete(normalized);
    },
    rmdir: async (dir: string, recursive = false) => {
      const normalized = normalizeTestPath(dir);
      if (recursive) {
        for (const file of Array.from(files.keys())) {
          if (file === normalized || file.startsWith(`${normalized}/`)) {
            files.delete(file);
          }
        }
        for (const folder of Array.from(folders)) {
          if (folder === normalized || folder.startsWith(`${normalized}/`)) {
            folders.delete(folder);
          }
        }
        return;
      }

      const listing = await adapter.list(normalized);
      if (listing.files.length === 0 && listing.folders.length === 0) {
        folders.delete(normalized);
      }
    },
  };

  const clearCache = vi.fn();
  const plugin = {
    app: {
      vault: {
        configDir: '.obsidian',
        adapter,
        getAbstractFileByPath: (path: string) => {
          const normalized = normalizeTestPath(path);
          return files.has(normalized) || folders.has(normalized)
            ? { path: normalized }
            : null;
        },
      },
    },
    settings: {
      weaveParentFolder: '',
      incrementalReading: {},
    },
    dataStorage: {
      getCards: vi.fn().mockResolvedValue([]),
      getDecks: vi.fn().mockResolvedValue([]),
      saveCard: vi.fn().mockResolvedValue({ success: true }),
    },
    cardFileService: {
      clearCache,
    },
    saveSettings: vi.fn().mockResolvedValue(undefined),
  } as any;

  return {
    plugin,
    files,
    clearCache,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('DataManagementService', () => {
  it('fixAll only executes the default safe fix set', async () => {
    const { plugin, clearCache } = createMemoryPlugin();
    const service = new DataManagementService(plugin);
    const fixSpy = vi
      .spyOn(service, 'fix')
      .mockImplementation(async (type: any) => ({
        type,
        success: 1,
        failed: 0,
        errors: [],
      }));

    vi.useFakeTimers();
    const promise = service.fixAll();
    await vi.runAllTimersAsync();
    const results = await promise;

    expect(fixSpy.mock.calls.map(([type]) => type)).toEqual(DEFAULT_BATCH_FIX_TYPES);
    expect(results.map((result) => result.type)).toEqual(DEFAULT_BATCH_FIX_TYPES);
    expect(clearCache).toHaveBeenCalledTimes(DEFAULT_BATCH_FIX_TYPES.length);
  });

  it('blocks legacy cleanup when no verified migration report exists', async () => {
    const { plugin } = createMemoryPlugin();
    const service = new DataManagementService(plugin);
    const recoverSpy = vi.spyOn(service, 'recoverMigrationConflictData');
    vi.spyOn(service, 'getLatestMigrationReport').mockResolvedValue(null);

    const result = await service.cleanupLegacyDirectories({ allowHighRisk: true });

    expect(result.type).toBe('legacy_cleanup');
    expect(result.success).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.errors[0]?.error).toContain('迁移报告');
    expect(recoverSpy).not.toHaveBeenCalled();
  });

  it('restores a sync conflict copy as the canonical file when the original is missing', async () => {
    const v2Paths = getV2Paths('');
    const conflictPath = `${v2Paths.memory.cards}/default 2.json`;
    const content = JSON.stringify({
      cards: [{ uuid: 'card-1', content: 'restored' }],
    });
    const { plugin, files } = createMemoryPlugin({
      [conflictPath]: content,
    });
    const service = new DataManagementService(plugin);

    const result = await (service as any).fixSyncConflictFiles();

    expect(result.success).toBe(1);
    expect(result.failed).toBe(0);
    expect(files.get(`${v2Paths.memory.cards}/default.json`)).toBe(content);
    expect(files.has(conflictPath)).toBe(false);
  });

  it('archives unmergeable sync conflicts instead of deleting them', async () => {
    const v2Paths = getV2Paths('');
    const pluginPaths = getPluginPaths({
      vault: { configDir: '.obsidian' },
    } as any);
    const originalPath = `${v2Paths.ir.root}/sources.json`;
    const conflictPath = `${v2Paths.ir.root}/sources 2.json`;
    const originalContent = '{"sources":[{"id":"current"}]}';
    const conflictContent = '{"sources":[{"id":"conflict"}]}';
    const { plugin, files } = createMemoryPlugin({
      [originalPath]: originalContent,
      [conflictPath]: conflictContent,
    });
    const service = new DataManagementService(plugin);

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-24T00:00:00.000Z'));

    const result = await (service as any).fixSyncConflictFiles();
    const expectedArchivePath =
      `${pluginPaths.backups}/sync-conflicts/2026-03-24T00-00-00-000Z/` +
      `${conflictPath.replace(/[\\/:]/g, '__')}`;

    expect(result.success).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.errors[0]?.error).toContain(expectedArchivePath);
    expect(files.get(originalPath)).toBe(originalContent);
    expect(files.get(expectedArchivePath)).toBe(conflictContent);
    expect(files.has(conflictPath)).toBe(false);
  });

  it('imports migration conflicts through dataStorage.saveCardsBatch and marks the deck index for rebuild', async () => {
    const v2Paths = getV2Paths('');
    const conflictDir = `${v2Paths.root}/_migration_conflicts`;
    const importedAt = '2026-03-30T00:00:00.000Z';
    const importedDeck = {
      id: 'deck-import',
      name: 'Imported Deck',
      description: '',
      category: '',
      path: 'Imported Deck',
      level: 0,
      order: 0,
      inheritSettings: false,
      created: importedAt,
      modified: importedAt,
      includeSubdecks: false,
      stats: {
        totalCards: 1,
        newCards: 0,
        learningCards: 0,
        reviewCards: 0,
        todayNew: 0,
        todayReview: 0,
        todayTime: 0,
        totalReviews: 0,
        totalTime: 0,
        memoryRate: 0,
        averageEase: 0,
        forecastDays: {},
      },
      tags: [],
      metadata: {},
      cardUUIDs: ['card-1'],
    };

    const { plugin } = createMemoryPlugin({
      [`${conflictDir}/weave_memory_decks.json-1`]: JSON.stringify({ decks: [importedDeck] }),
      [`${conflictDir}/weave_memory_cards_default.json-1`]: JSON.stringify({
        cards: [
          {
            uuid: 'card-1',
            content: 'Imported content',
            deckId: 'deck-import',
          },
        ],
      }),
    });
    const saveCardsBatch = vi.fn().mockResolvedValue(undefined);
    const fallbackSaveCardsBatch = vi.fn().mockResolvedValue(true);
    const markFullRebuildRequired = vi.fn().mockResolvedValue(undefined);
    plugin.dataStorage.saveCardsBatch = saveCardsBatch;
    plugin.cardFileService.saveCardsBatch = fallbackSaveCardsBatch;
    plugin.deckMembershipIndexService = { markFullRebuildRequired };

    const service = new DataManagementService(plugin);

    const result = await (service as any).importMigrationConflicts(v2Paths);

    expect(result.importedCards).toBe(1);
    expect(result.importedDecks).toBe(1);
    expect(saveCardsBatch).toHaveBeenCalledTimes(1);
    expect(fallbackSaveCardsBatch).not.toHaveBeenCalled();
    expect(markFullRebuildRequired).toHaveBeenCalledTimes(1);
    expect(saveCardsBatch).toHaveBeenCalledWith([
      expect.objectContaining({
        uuid: 'card-1',
        deckId: 'deck-import',
        content: expect.stringContaining('Imported Deck'),
      }),
    ]);
  });
});
