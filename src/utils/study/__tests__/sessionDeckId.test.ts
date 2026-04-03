import { CardType, type Card, type Deck } from '../../../data/types';
import { describe, expect, it } from 'vitest';
import { resolveStudySessionDeckId } from '../sessionDeckId';

function createDeck(overrides: Partial<Deck> = {}): Deck {
  return {
    id: 'deck-target',
    name: '目标牌组',
    description: '',
    created: '2026-03-01T00:00:00.000Z',
    modified: '2026-03-01T00:00:00.000Z',
    ...overrides
  } as Deck;
}

function createCard(overrides: Partial<Card> = {}): Card {
  return {
    uuid: 'card-1',
    deckId: 'source-deck',
    type: CardType.Basic,
    content: '---\nwe_decks:\n  - 目标牌组\n---\n正面',
    tags: [],
    fsrs: {
      due: '2026-03-31T00:00:00.000Z',
      stability: 0,
      difficulty: 0,
      elapsedDays: 0,
      scheduledDays: 0,
      reps: 0,
      lapses: 0,
      state: 0,
      retrievability: 1
    },
    reviewHistory: [],
    stats: {
      totalReviews: 0,
      totalTime: 0,
      averageTime: 0
    },
    created: '2026-03-31T00:00:00.000Z',
    modified: '2026-03-31T00:00:00.000Z',
    ...overrides
  } as Card;
}

describe('resolveStudySessionDeckId', () => {
  it('prefers the current study deck over the card source deck', () => {
    const resolved = resolveStudySessionDeckId({
      currentDeckId: 'memory-deck',
      firstCard: createCard(),
      decks: [createDeck({ id: 'memory-deck', name: '记忆牌组' })]
    });

    expect(resolved).toBe('memory-deck');
  });

  it('falls back to the card yaml deck when current deck is absent', () => {
    const resolved = resolveStudySessionDeckId({
      firstCard: createCard(),
      decks: [createDeck()]
    });

    expect(resolved).toBe('deck-target');
  });

  it('falls back to card.deckId when yaml deck cannot be resolved', () => {
    const resolved = resolveStudySessionDeckId({
      firstCard: createCard({ content: '没有 YAML 牌组', deckId: 'legacy-deck' }),
      decks: []
    });

    expect(resolved).toBe('legacy-deck');
  });
});
