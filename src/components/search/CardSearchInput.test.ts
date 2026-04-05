import { fireEvent, render } from '@testing-library/svelte';
import { Menu } from 'obsidian';
import type { MenuItem as MockMenuItem } from '../../tests/mocks/obsidian';
import CardSearchInput from './CardSearchInput.svelte';

type TrackingMenuInstance = Menu & {
  getItems(): MockMenuItem[];
};

const menuInstances: TrackingMenuInstance[] = [];

vi.mock('obsidian', async () => {
  const actual = await vi.importActual<typeof import('../../tests/mocks/obsidian')>('../../tests/mocks/obsidian');

  class TrackingMenu extends actual.Menu {
    constructor() {
      super();
      menuInstances.push(this as unknown as TrackingMenuInstance);
    }
  }

  return {
    ...actual,
    Menu: TrackingMenu
  };
});

vi.mock('../../utils/vault-local-storage', () => ({
  vaultStorage: {
    getItem: vi.fn(() => null),
    setItem: vi.fn()
  }
}));

describe('CardSearchInput', () => {
  beforeEach(() => {
    menuInstances.length = 0;
    vi.clearAllMocks();
  });

  function getEnabledMenuTitles(menu: TrackingMenuInstance): string[] {
    return menu
      .getItems()
      .filter((item) => !item.isDisabled())
      .map((item) => item.getTitle());
  }

  it('tag: 建议会展示完整标签列表，不再截断到前 20 项', async () => {
    const tags = Array.from({ length: 25 }, (_, index) => `tag-${index + 1}`);
    const { container } = render(CardSearchInput, {
      props: {
        app: {} as any,
        availableTags: tags
      }
    });

    const input = container.querySelector('input') as HTMLInputElement;
    input.value = 'tag:';
    input.setSelectionRange(input.value.length, input.value.length);

    await fireEvent.input(input);

    const menu = menuInstances.at(-1);
    expect(menu).toBeTruthy();
    expect(getEnabledMenuTitles(menu!)).toHaveLength(25);
    expect(getEnabledMenuTitles(menu!)).toContain('tag-25');
  });

  it('tag: 后继续输入时会按已输入内容过滤标签建议', async () => {
    const { container } = render(CardSearchInput, {
      props: {
        app: {} as any,
        availableTags: ['alpha', 'beta', 'gamma', 'gamut']
      }
    });

    const input = container.querySelector('input') as HTMLInputElement;
    input.value = 'tag:ga';
    input.setSelectionRange(input.value.length, input.value.length);

    await fireEvent.input(input);

    const menu = menuInstances.at(-1);
    expect(menu).toBeTruthy();
    expect(getEnabledMenuTitles(menu!)).toEqual(['gamma', 'gamut']);
  });
});
