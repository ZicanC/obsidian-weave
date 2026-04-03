import { SingleCardParser } from '../SingleCardParser';

const baseConfig = {
  contentStructure: 'whole-file' as const,
  frontBackSeparator: '---div---',
  uuidLocation: 'frontmatter' as const,
  syncMethod: 'mtime-compare' as const,
  excludeTags: []
};

function createParserWithContent(content: string) {
  const app = {
    vault: {
      read: async () => content
    }
  };

  return new SingleCardParser(app as any);
}

function createFile(path = 'test.md') {
  return {
    path,
    stat: {
      mtime: 1710000000000
    }
  } as any;
}

describe('SingleCardParser', () => {
  it('单文件单卡片模式应导入 YAML 行内数组 tags', async () => {
    const parser = createParserWithContent(`---
tags: [英语, CET4]
---
正文内容`);

    const result = await parser.parseFile(createFile(), baseConfig, 'deck-1');

    expect(result.success).toBe(true);
    expect(result.card?.tags).toEqual(expect.arrayContaining(['英语', 'CET4']));
  });

  it('单文件单卡片模式应导入 YAML 多行列表 tags', async () => {
    const parser = createParserWithContent(`---
tags:
  - 历史
  - 时间线
---
正文内容`);

    const result = await parser.parseFile(createFile(), baseConfig, 'deck-1');

    expect(result.success).toBe(true);
    expect(result.card?.tags).toEqual(expect.arrayContaining(['历史', '时间线']));
  });
});
