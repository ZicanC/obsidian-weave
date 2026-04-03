import { CardState, CardType, type Card } from '../../../data/types';
import { UnifiedStudyProvider } from '../UnifiedStudyProvider';

function createCard(overrides: Partial<Card> = {}): Card {
  return {
    uuid: `card-${Math.random().toString(36).slice(2)}`,
    deckId: 'deck-target',
    type: CardType.Basic,
    content: '---\nwe_decks:\n  - 目标牌组\n---\n正面',
    fsrs: {
      due: '2026-03-15T00:00:00.000Z',
      stability: 3,
      difficulty: 5,
      elapsedDays: 2,
      scheduledDays: 5,
      reps: 1,
      lapses: 0,
      state: CardState.Review,
      retrievability: 0.9
    },
    tags: [],
    created: '2026-03-15T00:00:00.000Z',
    modified: '2026-03-15T00:00:00.000Z',
    stats: {
      totalReviews: 0,
      totalTime: 0,
      averageTime: 0
    },
    ...overrides
  } as Card;
}

describe('UnifiedStudyProvider', () => {
  it('builds queue from getDeckCards instead of rebuilding deck membership from all cards', async () => {
    const deckCard = createCard({
      uuid: 'card-yaml',
      content: '---\nwe_decks:\n  - 目标牌组\n---\nA'
    });

    const dataStorage = {
      getDeckCards: vi.fn(async (_deckId: string) => [deckCard]),
      getAllCards: vi.fn(async () => {
        throw new Error('should not call getAllCards');
      }),
      getDeck: vi.fn(async () => {
        throw new Error('should not call getDeck');
      }),
      getStudySessions: vi.fn(async () => [])
    } as any;

    const provider = new UnifiedStudyProvider(dataStorage);
    const result = await provider.getStudyData('deck-target', {
      newCardsPerDay: 20,
      reviewsPerDay: 20,
      filterSiblings: false,
      onlyDue: true
    });

    expect(dataStorage.getDeckCards).toHaveBeenCalledWith('deck-target');
    expect(dataStorage.getAllCards).not.toHaveBeenCalled();
    expect(dataStorage.getDeck).not.toHaveBeenCalled();
    expect(result.queue.map(card => card.uuid)).toEqual(['card-yaml']);
    expect(result.debug).toEqual(
      expect.objectContaining({
        totalCards: 1,
        afterRecycleFilter: 1
      })
    );
  });

  it('keeps freshly added new cards in the queue even after today quota is exhausted', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-31T12:00:00.000Z'));

    try {
      const oldNewCard = createCard({
        uuid: 'card-old-new',
        fsrs: {
          due: '2026-03-31T12:00:00.000Z',
          stability: 0,
          difficulty: 5,
          elapsedDays: 0,
          scheduledDays: 0,
          reps: 0,
          lapses: 0,
          state: CardState.New,
          retrievability: 1
        },
        created: '2026-03-29T08:00:00.000Z',
        modified: '2026-03-29T08:00:00.000Z'
      });

      const freshNewCard = createCard({
        uuid: 'card-fresh-new',
        fsrs: {
          due: '2026-03-31T12:00:00.000Z',
          stability: 0,
          difficulty: 5,
          elapsedDays: 0,
          scheduledDays: 0,
          reps: 0,
          lapses: 0,
          state: CardState.New,
          retrievability: 1
        },
        created: '2026-03-31T09:30:00.000Z',
        modified: '2026-03-31T09:30:00.000Z'
      });

      const dataStorage = {
        getStudySessions: vi.fn(async () => [])
      } as any;

      const provider = new UnifiedStudyProvider(dataStorage);
      const result = await provider.getStudyDataFromDeckCards(
        'deck-target',
        [oldNewCard, freshNewCard],
        {
          newCardsPerDay: 1,
          reviewsPerDay: 20,
          filterSiblings: false,
          onlyDue: true,
          learnedNewCardsToday: 1
        }
      );

      expect(result.queue.map(card => card.uuid)).toEqual(['card-fresh-new']);
      expect(result.stats.newCards).toBe(1);
      expect(dataStorage.getStudySessions).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('reuses preloaded deck cards and precomputed today counts without rereading sessions', async () => {
    const deckCard = createCard({
      uuid: 'card-preloaded',
      content: '---\nwe_decks:\n  - 目标牌组\n---\nB'
    });

    const dataStorage = {
      getDeckCards: vi.fn(async () => {
        throw new Error('should not call getDeckCards');
      }),
      getAllCards: vi.fn(async () => {
        throw new Error('should not call getAllCards');
      }),
      getStudySessions: vi.fn(async () => {
        throw new Error('should not call getStudySessions');
      })
    } as any;

    const provider = new UnifiedStudyProvider(dataStorage);
    const result = await provider.getStudyDataFromDeckCards('deck-target', [deckCard], {
      newCardsPerDay: 20,
      reviewsPerDay: 20,
      filterSiblings: false,
      onlyDue: true,
      learnedNewCardsToday: 3
    });

    expect(dataStorage.getDeckCards).not.toHaveBeenCalled();
    expect(dataStorage.getAllCards).not.toHaveBeenCalled();
    expect(dataStorage.getStudySessions).not.toHaveBeenCalled();
    expect(result.queue.map(card => card.uuid)).toEqual(['card-preloaded']);
    expect(result.stats.reviewCards).toBe(1);
  });
});
