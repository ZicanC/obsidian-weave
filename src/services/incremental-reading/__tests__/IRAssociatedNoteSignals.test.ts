import type { Card } from '../../../data/types';
import {
  buildAssociatedNoteSignalIndex,
  getAssociatedNoteSignal,
  resolveAssociatedNotePath
} from '../IRAssociatedNoteSignals';

function createCard(overrides: Partial<Card>): Card {
  return {
    uuid: overrides.uuid ?? crypto.randomUUID(),
    content: '',
    cardPurpose: 'memory',
    priority: 3,
    ...overrides
  } as Card;
}

describe('IRAssociatedNoteSignals', () => {
  test('只统计记忆卡，并把 md、无扩展名、块链接视为同一关联笔记', () => {
    const cards: Card[] = [
      createCard({
        uuid: 'memory-direct',
        priority: 4,
        sourceFile: 'Notes/Topic.md'
      }),
      createCard({
        uuid: 'memory-block-link',
        priority: 2,
        content: [
          '---',
          'we_source:',
          '  - "[[Notes/Topic#^block-123|Topic]]"',
          '---',
          '正文'
        ].join('\n')
      }),
      createCard({
        uuid: 'test-card',
        cardPurpose: 'test',
        priority: 4,
        sourceFile: 'Notes/Topic.md'
      }),
      createCard({
        uuid: 'other-note',
        priority: 3,
        sourceFile: 'Notes/Other.md'
      })
    ];

    const index = buildAssociatedNoteSignalIndex(cards);

    const topicSignal = getAssociatedNoteSignal(index, 'Notes/Topic.md');
    expect(topicSignal).toBeDefined();
    expect(topicSignal?.cardCount).toBe(2);
    expect(topicSignal?.averagePriority).toBe(3);
    expect(topicSignal?.maxPriority).toBe(4);
    expect(topicSignal?.prioritySignal).toBe(7.1);

    expect(getAssociatedNoteSignal(index, 'Notes/Topic')?.cardCount).toBe(2);
    expect(getAssociatedNoteSignal(index, 'notes/topic#^another-block')?.cardCount).toBe(2);
    expect(getAssociatedNoteSignal(index, 'Notes/Other.md')?.cardCount).toBe(1);
  });

  test('不会把非 Markdown 来源误统计为关联笔记信号', () => {
    const index = buildAssociatedNoteSignalIndex([
      createCard({
        uuid: 'pdf-card',
        priority: 4,
        sourceFile: 'Books/Deep-Work.pdf'
      }),
      createCard({
        uuid: 'epub-card',
        priority: 3,
        sourceFile: 'Books/Atomic-Habits.epub'
      })
    ]);

    expect(Array.from(index.values())).toHaveLength(0);
    expect(getAssociatedNoteSignal(index, 'Books/Deep-Work.pdf')).toBeUndefined();
    expect(getAssociatedNoteSignal(index, 'Books/Atomic-Habits.epub')).toBeUndefined();
  });

  test('resolveAssociatedNotePath 允许 Markdown 笔记路径并拒绝非 Markdown 路径', () => {
    expect(resolveAssociatedNotePath({ associatedNotePath: 'Folder/Linked-Note.md' })).toBe('Folder/Linked-Note.md');
    expect(resolveAssociatedNotePath({ associatedNotePath: 'Folder/Linked-Note' })).toBe('Folder/Linked-Note');
    expect(resolveAssociatedNotePath({ associatedNotePath: 'Folder/Reference.pdf' })).toBeUndefined();
    expect(resolveAssociatedNotePath(null)).toBeUndefined();
  });
});
