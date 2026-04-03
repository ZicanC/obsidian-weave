import { ReferenceDeckService } from '../reference-deck/ReferenceDeckService';

describe('ReferenceDeckService cascadeDeleteCards', () => {
  it('removes card references in bulk and skips excluded decks', async () => {
    const deckA = {
      id: 'deck-a',
      name: '牌组A',
      cardUUIDs: ['card-1', 'card-2', 'card-keep'],
      modified: '2026-03-15T00:00:00.000Z'
    };
    const deckB = {
      id: 'deck-b',
      name: '牌组B',
      cardUUIDs: ['card-2', 'card-3'],
      modified: '2026-03-15T00:00:00.000Z'
    };
    const deckC = {
      id: 'deck-c',
      name: '牌组C',
      cardUUIDs: ['card-1', 'card-stay'],
      modified: '2026-03-15T00:00:00.000Z'
    };

    const getDecks = vi.fn(async () => [deckA, deckB, deckC]);
    const saveDeck = vi.fn(async () => ({
      success: true,
      timestamp: '2026-03-15T00:00:00.000Z'
    }));

    const plugin = {
      dataStorage: {
        getDecks,
        saveDeck
      }
    } as any;

    const service = new ReferenceDeckService(plugin);
    const result = await service.cascadeDeleteCards(['card-1', 'card-2'], {
      skipDeckIds: ['deck-c']
    });

    expect(result.success).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.totalAffectedDecks).toBe(2);
    expect(getDecks).toHaveBeenCalledTimes(1);
    expect(saveDeck).toHaveBeenCalledTimes(2);
    expect(deckA.cardUUIDs).toEqual(['card-keep']);
    expect(deckB.cardUUIDs).toEqual(['card-3']);
    expect(deckC.cardUUIDs).toEqual(['card-1', 'card-stay']);
    expect(saveDeck).toHaveBeenNthCalledWith(1, expect.objectContaining({ id: 'deck-a', cardUUIDs: ['card-keep'] }));
    expect(saveDeck).toHaveBeenNthCalledWith(2, expect.objectContaining({ id: 'deck-b', cardUUIDs: ['card-3'] }));
  });
});
