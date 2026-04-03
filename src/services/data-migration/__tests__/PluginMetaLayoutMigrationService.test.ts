import { normalizePluginMetaLayout } from '../PluginMetaLayoutMigrationService';

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
  const folders = new Set<string>(['', '.obsidian']);

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

  return {
    app: {
      vault: {
        configDir: '.obsidian',
        adapter,
      },
    } as any,
    files,
    folders,
  };
}

describe('PluginMetaLayoutMigrationService', () => {
  it('normalizes legacy plugin meta files into the unified state/cache layout', async () => {
    const { app, files, folders } = createMemoryApp({
      '.obsidian/plugins/weave/indices/card-by-source.json': '{"v":1}',
      '.obsidian/plugins/weave/migration/migration-state.json': '{"status":"done"}',
      '.obsidian/plugins/weave/user-profile.json': '{"profile":{"name":"legacy"}}',
      '.obsidian/plugins/weave/importMappings.json': '{"version":"1.0","mappings":[]}',
      '.obsidian/plugins/weave/quality-inbox.json': '{"issues":[],"savedAt":"2026-03-27T00:00:00.000Z"}',
      '.obsidian/plugins/weave/state/ui-state.json': '{"deckView":"kanban","savedAt":"2026-03-27T00:00:00.000Z"}',
    });

    await normalizePluginMetaLayout(app);

    expect(files.get('.obsidian/plugins/weave/cache/indices/card-by-source.json')).toBe('{"v":1}');
    expect(files.get('.obsidian/plugins/weave/cache/migration/migration-state.json')).toBe('{"status":"done"}');
    expect(files.get('.obsidian/plugins/weave/state/user-profile.json')).toBe('{"profile":{"name":"legacy"}}');
    expect(files.get('.obsidian/plugins/weave/state/import-mappings.json')).toBe('{"version":"1.0","mappings":[]}');
    expect(files.get('.obsidian/plugins/weave/state/quality-inbox.json')).toBe('{"issues":[],"savedAt":"2026-03-27T00:00:00.000Z"}');
    expect(files.get('.obsidian/plugins/weave/state/local-storage.json')).toBe('{\n  "weave-deck-view": "kanban"\n}');

    expect(files.has('.obsidian/plugins/weave/user-profile.json')).toBe(false);
    expect(files.has('.obsidian/plugins/weave/importMappings.json')).toBe(false);
    expect(files.has('.obsidian/plugins/weave/quality-inbox.json')).toBe(false);
    expect(files.has('.obsidian/plugins/weave/state/ui-state.json')).toBe(false);
    expect(folders.has('.obsidian/plugins/weave/indices')).toBe(false);
    expect(folders.has('.obsidian/plugins/weave/migration')).toBe(false);
  });

  it('writes a conflict snapshot instead of silently dropping legacy state content', async () => {
    const { app, files } = createMemoryApp({
      '.obsidian/plugins/weave/user-profile.json': '{"profile":{"name":"legacy"}}',
      '.obsidian/plugins/weave/state/user-profile.json': '{"profile":{"name":"current"}}',
    });

    await normalizePluginMetaLayout(app);

    expect(files.get('.obsidian/plugins/weave/state/user-profile.json')).toBe('{"profile":{"name":"current"}}');
    expect(files.has('.obsidian/plugins/weave/user-profile.json')).toBe(false);

    const conflictSnapshots = Array.from(files.keys()).filter((path) =>
      path.startsWith('.obsidian/plugins/weave/cache/migration/legacy-meta-conflicts/'),
    );
    expect(conflictSnapshots.length).toBe(1);
    expect(files.get(conflictSnapshots[0]!)).toBe('{"profile":{"name":"legacy"}}');
  });
});
