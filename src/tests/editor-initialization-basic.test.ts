import {
  getEditorInitializationManager,
  InitializationState
} from '../utils/editor-initialization-manager';

describe('EditorInitializationManager basic behavior', () => {
  let initManager: ReturnType<typeof getEditorInitializationManager>;

  beforeEach(() => {
    initManager = getEditorInitializationManager();
    initManager.cleanup();
  });

  afterEach(() => {
    initManager.cleanup();
  });

  test('exposes the expected public API', () => {
    expect(initManager).toBeDefined();
    expect(typeof initManager.safeInitialize).toBe('function');
    expect(typeof initManager.abortInitialization).toBe('function');
    expect(typeof initManager.getInitializationState).toBe('function');
    expect(typeof initManager.cleanup).toBe('function');
  });

  test('returns idle for editors that have not started initialization', () => {
    expect(initManager.getInitializationState('unknown-editor')).toBe(InitializationState.IDLE);
  });

  test('deduplicates concurrent initialization requests for the same editor', async () => {
    const editorId = 'shared-editor';
    let callCount = 0;

    const initFn = vi.fn(async () => {
      callCount++;
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    const [first, second, third] = await Promise.all([
      initManager.safeInitialize(editorId, initFn),
      initManager.safeInitialize(editorId, initFn),
      initManager.safeInitialize(editorId, initFn)
    ]);

    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    expect(third.success).toBe(true);
    expect(callCount).toBe(1);
  });

  test('returns the original error when retries are exhausted', async () => {
    const result = await initManager.safeInitialize(
      'failing-editor',
      async () => {
        throw new Error('mock init failure');
      },
      { maxRetries: 0 }
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('mock init failure');
    expect(result.retryCount).toBe(1);
  });

  test('can abort an in-flight initialization', async () => {
    let started = false;

    const initPromise = initManager.safeInitialize(
      'abort-editor',
      async (signal: AbortSignal) => {
        started = true;
        await new Promise((resolve) => setTimeout(resolve, 30));

        if (signal.aborted) {
          throw new Error('aborted in test');
        }

        await new Promise((resolve) => setTimeout(resolve, 30));
      },
      { maxRetries: 0 }
    );

    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(started).toBe(true);
    expect(initManager.getInitializationState('abort-editor')).toBe(
      InitializationState.INITIALIZING
    );
    expect(initManager.abortInitialization('abort-editor')).toBe(true);

    const result = await initPromise;

    expect(result.success).toBe(false);
    expect(result.error).toContain('初始化被中止');
  });
});
