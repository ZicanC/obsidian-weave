import { CardState, CardType, type Card } from '../../../data/types';
import {
  isDeckCompleteForToday,
  loadDeckCardsForStudy,
  selectNewCardsForStudyQueue
} from '../studyCompletionHelper';

function createCard(overrides: Partial<Card> = {}): Card {
  return {
    uuid: `card-${Math.random().toString(36).slice(2)}`,
    deckId: 'deck-target',
    type: CardType.Basic,
    content: '正面',
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
    tags: [],
    created: '2026-03-30T08:00:00.000Z',
    modified: '2026-03-30T08:00:00.000Z',
    stats: {
      totalReviews: 0,
      totalTime: 0,
      averageTime: 0
    },
    ...overrides
  } as Card;
}

describe('studyCompletionHelper', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-31T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows freshly added new cards into today queue even when backlog quota is exhausted', () => {
    const oldNewCard = createCard({
      uuid: 'old-new',
      created: '2026-03-29T08:00:00.000Z',
      modified: '2026-03-29T08:00:00.000Z'
    });
    const freshNewCard = createCard({
      uuid: 'fresh-new',
      created: '2026-03-31T09:30:00.000Z',
      modified: '2026-03-31T09:30:00.000Z'
    });

    const queue = selectNewCardsForStudyQueue([oldNewCard, freshNewCard], 1, 1);

    expect(queue.map(card => card.uuid)).toEqual(['fresh-new']);
  });

  it('does not mark the deck complete when only a freshly added new card remains', async () => {
    const freshNewCard = createCard({
      uuid: 'fresh-new',
      created: '2026-03-31T09:30:00.000Z',
      modified: '2026-03-31T09:30:00.000Z'
    });

    const isComplete = await isDeckCompleteForToday([freshNewCard], 1, 1);

    expect(isComplete).toBe(false);
  });

  it('loads freshly added new cards for study even when today new limit is already used', async () => {
    const oldNewCard = createCard({
      uuid: 'old-new',
      created: '2026-03-29T08:00:00.000Z',
      modified: '2026-03-29T08:00:00.000Z'
    });
    const freshNewCard = createCard({
      uuid: 'fresh-new',
      created: '2026-03-31T09:30:00.000Z',
      modified: '2026-03-31T09:30:00.000Z'
    });

    const dataStorage = {
      getDeckCards: vi.fn(async () => [oldNewCard, freshNewCard]),
      getStudySessions: vi.fn(async () => [
        {
          id: 'session-1',
          deckId: 'deck-target',
          startTime: new Date('2026-03-31T08:00:00.000Z'),
          cardsReviewed: 1,
          newCardsLearned: 1,
          correctAnswers: 1,
          totalTime: 30,
          cardReviews: []
        }
      ])
    } as any;

    const queue = await loadDeckCardsForStudy(
      dataStorage,
      'deck-target',
      1,
      20,
      false
    );

    expect(queue.map(card => card.uuid)).toEqual(['fresh-new']);
  });
});
