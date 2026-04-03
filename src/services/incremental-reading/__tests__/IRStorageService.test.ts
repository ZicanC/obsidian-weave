import { TFile } from 'obsidian';
import { IRStorageService } from '../IRStorageService';

describe('IRStorageService.deleteChunkData', () => {
  it('删除最后一个同源阅读块时应清理源 Markdown 的增量阅读 frontmatter 并追加已删除标签', async () => {
    const frontmatter: Record<string, unknown> = {
      'weave-reading-id': 'rm-1',
      'weave-reading-category': 'later',
      'weave-reading-priority': 50,
      'weave-reading-ir-deck-id': 'deck-1',
      tags: ['已有标签']
    };

    const sourceFile = Object.assign(Object.create(TFile.prototype), {
      path: 'notes/source.md'
    }) as TFile;

    const app = {
      vault: {
        getAbstractFileByPath: vi.fn((filePath: string) => filePath === 'notes/source.md' ? sourceFile : null)
      },
      fileManager: {
        processFrontMatter: vi.fn(async (_file: TFile, updater: (fm: Record<string, unknown>) => void) => {
          updater(frontmatter);
        })
      }
    };

    const service = new IRStorageService(app as any);

    vi.spyOn(service as any, 'initialize').mockResolvedValue(undefined);
    vi.spyOn(service as any, 'getAllChunkData').mockResolvedValue({
      'chunk-1': {
        chunkId: 'chunk-1',
        sourceId: 'source-1',
        filePath: 'weave/incremental-reading/chunks/chunk-1.md',
        priorityEff: 5,
        intervalDays: 1,
        nextRepDate: 0,
        scheduleStatus: 'new'
      }
    });
    vi.spyOn(service as any, 'getAllSources').mockResolvedValue({
      'source-1': {
        sourceId: 'source-1',
        originalPath: 'notes/source.md',
        rawFilePath: '',
        indexFilePath: 'weave/incremental-reading/index/source-1.md',
        chunkIds: ['chunk-1'],
        title: 'source',
        tagGroup: 'default',
        createdAt: 0,
        updatedAt: 0
      }
    });
    vi.spyOn(service as any, 'getAllDecks').mockResolvedValue({
      'deck-1': {
        id: 'deck-1',
        name: '测试牌组',
        description: '',
        icon: 'book',
        color: '#fff',
        blockIds: ['chunk-1'],
        sourceFiles: ['notes/source.md'],
        settings: {} as any,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        archivedAt: null
      }
    });

    const writeFile = vi.spyOn(service as any, 'writeFile').mockResolvedValue(undefined);
    const saveDeck = vi.spyOn(service as any, 'saveDeck').mockResolvedValue(undefined);
    const deleteFileSyncState = vi.spyOn(service as any, 'deleteFileSyncState').mockResolvedValue(undefined);

    await service.deleteChunkData('chunk-1');

    expect(writeFile).toHaveBeenCalledTimes(2);
    expect(saveDeck).toHaveBeenCalledWith(expect.objectContaining({
      blockIds: [],
      sourceFiles: []
    }));
    expect(deleteFileSyncState).toHaveBeenCalledWith('notes/source.md');
    expect(frontmatter['weave-reading-id']).toBeUndefined();
    expect(frontmatter['weave-reading-category']).toBeUndefined();
    expect(frontmatter['weave-reading-priority']).toBeUndefined();
    expect(frontmatter['weave-reading-ir-deck-id']).toBeUndefined();
    expect(frontmatter.tags).toEqual(['已有标签', 'we_已删除']);
  });

  it('删除外部文档型阅读点时应直接清理当前 md 文件中的 IR frontmatter', async () => {
    const frontmatter: Record<string, unknown> = {
      'weave-reading-id': 'tk-ir-1774527568327',
      'weave-reading-category': 'later',
      'weave-reading-priority': 50,
      'weave-reading-ir-deck-id': 'deck-idzpvkcn',
      status: 'active',
      tags: ['旧标签']
    };

    const externalFile = Object.assign(Object.create(TFile.prototype), {
      path: 'notes/external-ir.md'
    }) as TFile;

    const app = {
      vault: {
        getAbstractFileByPath: vi.fn((filePath: string) => filePath === 'notes/external-ir.md' ? externalFile : null)
      },
      fileManager: {
        processFrontMatter: vi.fn(async (_file: TFile, updater: (fm: Record<string, unknown>) => void) => {
          updater(frontmatter);
        })
      }
    };

    const service = new IRStorageService(app as any);

    vi.spyOn(service as any, 'initialize').mockResolvedValue(undefined);
    vi.spyOn(service as any, 'getAllChunkData').mockResolvedValue({
      'chunk-external': {
        chunkId: 'chunk-external',
        sourceId: 'source-external',
        filePath: 'notes/external-ir.md',
        priorityEff: 5,
        intervalDays: 1,
        nextRepDate: 0,
        scheduleStatus: 'queued',
        meta: {
          externalDocument: true
        }
      }
    });
    vi.spyOn(service as any, 'getAllSources').mockResolvedValue({});
    vi.spyOn(service as any, 'getAllDecks').mockResolvedValue({
      'deck-1': {
        id: 'deck-1',
        name: '测试牌组',
        description: '',
        icon: 'book',
        color: '#fff',
        blockIds: ['chunk-external'],
        sourceFiles: ['notes/external-ir.md'],
        settings: {} as any,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        archivedAt: null
      }
    });

    const saveDeck = vi.spyOn(service as any, 'saveDeck').mockResolvedValue(undefined);
    const deleteFileSyncState = vi.spyOn(service as any, 'deleteFileSyncState').mockResolvedValue(undefined);
    vi.spyOn(service as any, 'writeFile').mockResolvedValue(undefined);

    await service.deleteChunkData('chunk-external');

    expect(saveDeck).toHaveBeenCalledWith(expect.objectContaining({
      blockIds: [],
      sourceFiles: []
    }));
    expect(deleteFileSyncState).toHaveBeenCalledWith('notes/external-ir.md');
    expect(frontmatter['weave-reading-id']).toBeUndefined();
    expect(frontmatter['weave-reading-category']).toBeUndefined();
    expect(frontmatter['weave-reading-priority']).toBeUndefined();
    expect(frontmatter['weave-reading-ir-deck-id']).toBeUndefined();
    expect(frontmatter.status).toBeUndefined();
    expect(frontmatter.tags).toEqual(['旧标签', 'we_已删除']);
  });
});
