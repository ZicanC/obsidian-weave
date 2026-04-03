import {
  buildKanbanSelectionKey,
  collectSelectedCardUUIDs,
  extractCardUuidFromSelectionKey,
  usesGroupScopedSelection
} from './kanban-selection';

describe('kanban-selection', () => {
  it('牌组分组使用列作用域选中键，避免多列重复卡片串选', () => {
    expect(buildKanbanSelectionKey('card-1', 'deck', 'deck-a')).toBe('deck-a::card-1');
    expect(buildKanbanSelectionKey('card-1', 'deck', 'deck-b')).toBe('deck-b::card-1');
  });

  it('非牌组分组继续按卡片本身选中', () => {
    expect(buildKanbanSelectionKey('card-1', 'priority', '4')).toBe('card-1');
    expect(usesGroupScopedSelection('priority')).toBe(false);
    expect(usesGroupScopedSelection('deck')).toBe(true);
  });

  it('执行批量动作时会把多列实例去重回真实卡片 UUID', () => {
    const selected = [
      'deck-a::card-1',
      'deck-b::card-1',
      'deck-b::card-2',
      'card-3'
    ];

    expect(extractCardUuidFromSelectionKey('deck-a::card-1')).toBe('card-1');
    expect(collectSelectedCardUUIDs(selected)).toEqual(['card-1', 'card-2', 'card-3']);
  });
});
