import {
  EditorResourceManager,
  getGlobalResourceManager
} from '../utils/resource-manager';

describe('EditorResourceManager basic behavior', () => {
  let resourceManager: EditorResourceManager;

  beforeEach(() => {
    const globalManager = getGlobalResourceManager();
    globalManager.cleanup();
    resourceManager = globalManager.getEditorManager('test-editor');
  });

  afterEach(() => {
    getGlobalResourceManager().cleanup();
  });

  test('exposes the expected registration API', () => {
    expect(resourceManager).toBeDefined();
    expect(typeof resourceManager.registerTimer).toBe('function');
    expect(typeof resourceManager.registerEventListener).toBe('function');
    expect(typeof resourceManager.registerPromise).toBe('function');
    expect(typeof resourceManager.registerComponent).toBe('function');
    expect(typeof resourceManager.registerCustomCleanup).toBe('function');
  });

  test('tracks timers and custom cleanups, then clears them on destroy', () => {
    let cleanupCalled = false;
    const timer = setTimeout(() => undefined, 1000);

    resourceManager.registerTimer(timer, 'timeout', 'test timer');
    resourceManager.registerCustomCleanup(() => {
      cleanupCalled = true;
    }, 'test cleanup');

    expect(resourceManager.getResourceStats()).toMatchObject({
      timers: 1,
      customCleanups: 1,
      total: 2
    });

    resourceManager.destroy();

    expect(cleanupCalled).toBe(true);
    expect(resourceManager.getResourceStats().total).toBe(0);
  });

  test('detects timer leaks when too many timers are registered', () => {
    for (let index = 0; index < 11; index++) {
      resourceManager.registerTimer(setTimeout(() => undefined, 1000), 'timeout', `timer-${index}`);
    }

    const leaks = resourceManager.checkForLeaks();

    expect(leaks.some((leak) => leak.includes('定时器过多'))).toBe(true);
  });
});

describe('GlobalResourceManager basic behavior', () => {
  beforeEach(() => {
    getGlobalResourceManager().cleanup();
  });

  afterEach(() => {
    getGlobalResourceManager().cleanup();
  });

  test('creates separate resource managers for different editors', () => {
    const globalManager = getGlobalResourceManager();
    const editorOne = globalManager.getEditorManager('editor-1');
    const editorTwo = globalManager.getEditorManager('editor-2');

    expect(editorOne).toBeDefined();
    expect(editorTwo).toBeDefined();
    expect(editorOne).not.toBe(editorTwo);
  });

  test('reports global stats for registered editor managers', () => {
    const globalManager = getGlobalResourceManager();
    const editorManager = globalManager.getEditorManager('editor-stats');

    editorManager.registerTimer(setTimeout(() => undefined, 1000), 'timeout', 'stats timer');

    const stats = globalManager.getGlobalStats();

    expect(stats['editor-stats']).toBeDefined();
    expect(stats['editor-stats'].timers).toBe(1);
  });
});
