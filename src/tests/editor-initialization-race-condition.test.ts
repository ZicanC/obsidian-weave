import {
  getEditorInitializationManager,
  InitializationState
} from '../utils/editor-initialization-manager';

describe('EditorInitializationManager race-condition handling', () => {
  let initManager: ReturnType<typeof getEditorInitializationManager>;

  beforeEach(() => {
    initManager = getEditorInitializationManager();
    initManager.cleanup();
  });

  afterEach(() => {
    initManager.cleanup();
  });

  test('retries once and succeeds on the next attempt', async () => {
    let attemptCount = 0;

    const result = await initManager.safeInitialize(
      'retry-editor',
      async () => {
        attemptCount++;
        if (attemptCount === 1) {
          throw new Error('first attempt failed');
        }
      },
      { maxRetries: 1 }
    );

    expect(result.success).toBe(true);
    expect(result.retryCount).toBe(1);
    expect(attemptCount).toBe(2);
  });

  test('enforces the maximum number of concurrent initializations', async () => {
    const releaseInitializations: Array<() => void> = [];
    const initFn = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseInitializations.push(resolve);
        })
    );

    const activeInitializations = [
      initManager.safeInitialize('editor-1', initFn),
      initManager.safeInitialize('editor-2', initFn),
      initManager.safeInitialize('editor-3', initFn)
    ];

    await new Promise((resolve) => setTimeout(resolve, 10));

    const blockedResult = await initManager.safeInitialize('editor-4', initFn);

    releaseInitializations.forEach((resolve) => resolve());

    const settled = await Promise.all(activeInitializations);

    expect(settled.every((result) => result.success)).toBe(true);
    expect(blockedResult.success).toBe(false);
    expect(blockedResult.error).toContain('达到最大并发初始化限制');
    expect(initFn).toHaveBeenCalledTimes(3);
  });

  test('reports the initializing state while work is in progress', async () => {
    let releaseInitialization: (() => void) | null = null;

    const initPromise = initManager.safeInitialize('state-editor', async () => {
      await new Promise<void>((resolve) => {
        releaseInitialization = resolve;
      });
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(initManager.getInitializationState('state-editor')).toBe(
      InitializationState.INITIALIZING
    );

    releaseInitialization?.();

    const result = await initPromise;

    expect(result.success).toBe(true);
  });
});
