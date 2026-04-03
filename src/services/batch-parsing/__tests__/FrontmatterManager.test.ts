import { FrontmatterManager, WEAVE_UUID_FIELD } from '../FrontmatterManager';

describe('FrontmatterManager', () => {
  it('setUUID 应保留源文件原有 frontmatter 字段', async () => {
    const processFrontMatter = vi.fn(async (_file, updater) => {
      const frontmatter: Record<string, unknown> & { tags: string[]; 专业: string } = {
        tags: ['标签组1', '不适用'],
        专业: '内科'
      };

      updater(frontmatter);

      expect(frontmatter.tags).toEqual(['标签组1', '不适用']);
      expect(frontmatter.专业).toBe('内科');
      expect(frontmatter[WEAVE_UUID_FIELD]).toBe('tk-testuuid001');
    });

    const app = {
      fileManager: { processFrontMatter },
      vault: {
        read: vi.fn(async () => `---\n${WEAVE_UUID_FIELD}: tk-testuuid001\n---\n正文`),
        modify: vi.fn()
      }
    };

    const manager = new FrontmatterManager(app as any);
    await manager.setUUID({ path: 'daily.md' } as any, 'tk-testuuid001');

    expect(processFrontMatter).toHaveBeenCalledTimes(1);
  });
});
