import { getPluginPaths } from '../../config/paths';
import { vaultStorage } from '../vault-local-storage';

function normalizeTestPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '');
}

function parentPath(path: string): string {
  const normalized = normalizeTestPath(path);
  const idx = normalized.lastIndexOf('/');
  return idx > 0 ? normalized.slice(0, idx) : '';
}

function createMemoryApp(initialFiles: Record<string, string> = {}) {
  const files = new Map<string, string>();
  const folders = new Set<string>(['', '.obsidian', '.obsidian/plugins', '.obsidian/plugins/weave']);
  const localStorageState = new Map<string, string>();

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
    exists: async (path: string) => {
      const normalized = normalizeTestPath(path);
      return files.has(normalized) || folders.has(normalized);
    },
    mkdir: async (path: string) => {
      ensureDir(path);
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
  };

  const app = {
    vault: {
      configDir: '.obsidian',
      adapter,
    },
    loadLocalStorage: (key: string) => localStorageState.get(key) ?? null,
    saveLocalStorage: (key: string, value: string | undefined) => {
      if (value === undefined) {
        localStorageState.delete(key);
        window.localStorage.removeItem(key);
        return;
      }
      localStorageState.set(key, value);
      window.localStorage.setItem(key, value);
    },
  } as any;

  return {
    app,
    files,
    localStorageState,
  };
}

afterEach(async () => {
  await vaultStorage.flush();
  vaultStorage.resetForTests();
  window.localStorage.clear();
});

describe('vaultStorage', () => {
  it('migrates managed legacy localStorage entries into state/local-storage.json', async () => {
    const { app, files, localStorageState } = createMemoryApp();
    const pluginPaths = getPluginPaths(app);

    app.saveLocalStorage('weave-deck-view', 'kanban');
    app.saveLocalStorage('weave-deck-filter', 'memory');

    await vaultStorage.initialize(app);

    expect(vaultStorage.getItem('weave-deck-view')).toBe('kanban');
    expect(vaultStorage.getItem('weave-deck-filter')).toBe('memory');
    expect(JSON.parse(files.get(normalizeTestPath(pluginPaths.state.localStorage)) || '{}')).toEqual({
      'weave-deck-filter': 'memory',
      'weave-deck-view': 'kanban',
    });
    expect(localStorageState.has('weave-deck-view')).toBe(false);
    expect(localStorageState.has('weave-deck-filter')).toBe(false);
  });

  it('persists managed keys to file while leaving non-plugin keys in Obsidian localStorage', async () => {
    const { app, files, localStorageState } = createMemoryApp();
    const pluginPaths = getPluginPaths(app);

    await vaultStorage.initialize(app);

    vaultStorage.setItem('weave-deck-filter', 'question-bank');
    vaultStorage.setItem('language', 'en');
    await vaultStorage.flush();

    expect(JSON.parse(files.get(normalizeTestPath(pluginPaths.state.localStorage)) || '{}')).toEqual({
      'weave-deck-filter': 'question-bank',
    });
    expect(localStorageState.get('language')).toBe('en');
    expect(localStorageState.has('weave-deck-filter')).toBe(false);

    vaultStorage.removeItem('weave-deck-filter');
    await vaultStorage.flush();

    expect(JSON.parse(files.get(normalizeTestPath(pluginPaths.state.localStorage)) || '{}')).toEqual({});
    expect(vaultStorage.getItem('weave-deck-filter')).toBeNull();
    expect(localStorageState.get('language')).toBe('en');
  });
});
