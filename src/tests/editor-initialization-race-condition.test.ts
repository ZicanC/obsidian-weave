/**
 * 缂栬緫鍣ㄥ垵濮嬪寲绔炴€佹潯浠舵祴璇? * 楠岃瘉淇鍚庣殑UnifiedCodeMirrorEditor鏄惁鑳芥纭鐞嗗苟鍙戝垵濮嬪寲
 */
import { getEditorInitializationManager, InitializationState } from '../utils/editor-initialization-manager';

describe('缂栬緫鍣ㄥ垵濮嬪寲绔炴€佹潯浠舵祴璇?, () => {
  let initManager: ReturnType<typeof getEditorInitializationManager>;

  beforeEach(() => {
    initManager = getEditorInitializationManager();
    initManager.cleanup(); // 娓呯悊涔嬪墠鐨勭姸鎬?  });

  afterEach(() => {
    initManager.cleanup();
  });

  test('搴旇闃叉鍚屼竴缂栬緫鍣ㄧ殑閲嶅鍒濆鍖?, async () => {
    const editorId = 'test-editor-1';
    let initCallCount = 0;

    const mockInitFn = vi.fn(async (signal: AbortSignal) => {
      initCallCount++;
      await new Promise(resolve => setTimeout(resolve, 100)); // 妯℃嫙鍒濆鍖栧欢杩?
      if (signal.aborted) {
        throw new Error('鍒濆鍖栬涓');
      }
    });

    // 鍚屾椂鍚姩澶氫釜鍒濆鍖?    const promises = [
      initManager.safeInitialize(editorId, mockInitFn),
      initManager.safeInitialize(editorId, mockInitFn),
      initManager.safeInitialize(editorId, mockInitFn)
    ];

    const results = await Promise.all(promises);

    // 楠岃瘉缁撴灉
    expect(results).toHaveLength(3);
    expect(results.every(r => r.success)).toBe(true);
    expect(initCallCount).toBe(1); // 鍙簲璇ヨ皟鐢ㄤ竴娆″垵濮嬪寲鍑芥暟
  });

  test('搴旇姝ｇ‘澶勭悊鍒濆鍖栧け璐ョ殑閲嶈瘯', async () => {
    const editorId = 'test-editor-2';
    let attemptCount = 0;

    const mockInitFn = vi.fn(async (_signal: AbortSignal) => {
      attemptCount++;

      if (attemptCount < 2) {
        throw new Error('妯℃嫙鍒濆鍖栧け璐?);
      }

      // 绗簩娆″皾璇曟垚鍔?      await new Promise(resolve => setTimeout(resolve, 50));
    });

    const result = await initManager.safeInitialize(editorId, mockInitFn, {
      maxRetries: 2
    });

    expect(result.success).toBe(true);
    expect(attemptCount).toBe(2);
    expect(result.retryCount).toBe(1);
  });

  test('搴旇姝ｇ‘澶勭悊鍒濆鍖栦腑姝?, async () => {
    const editorId = 'test-editor-3';
    let initStarted = false;

    const mockInitFn = vi.fn(async (signal: AbortSignal) => {
      initStarted = true;

      // 妯℃嫙闀挎椂闂村垵濮嬪寲
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 1000);

        signal.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new Error('鍒濆鍖栬涓'));
        });
      });
    });

    // 鍚姩鍒濆鍖?    const initPromise = initManager.safeInitialize(editorId, mockInitFn);

    // 绛夊緟鍒濆鍖栧紑濮?    await new Promise(resolve => setTimeout(resolve, 50));
    expect(initStarted).toBe(true);

    // 涓鍒濆鍖?    const aborted = initManager.abortInitialization(editorId);
    expect(aborted).toBe(true);

    // 绛夊緟鍒濆鍖栧畬鎴?    const result = await initPromise;
    expect(result.success).toBe(false);
    expect(result.error).toContain('涓');
  });

  test('搴旇闄愬埗骞跺彂鍒濆鍖栨暟閲?, async () => {
    const maxConcurrent = 3;
    const editorIds = Array.from({ length: 5 }, (_, i) => `test-editor-${i}`);
    let concurrentCount = 0;
    let maxConcurrentReached = 0;

    const mockInitFn = vi.fn(async (_signal: AbortSignal) => {
      concurrentCount++;
      maxConcurrentReached = Math.max(maxConcurrentReached, concurrentCount);

      await new Promise(resolve => setTimeout(resolve, 100));

      concurrentCount--;
    });

    // 鍚屾椂鍚姩澶氫釜缂栬緫鍣ㄧ殑鍒濆鍖?    const promises = editorIds.map(id =>
      initManager.safeInitialize(id, mockInitFn)
    );

    const results = await Promise.all(promises);

    // 楠岃瘉骞跺彂闄愬埗
    expect(maxConcurrentReached).toBeLessThanOrEqual(maxConcurrent);

    // 楠岃瘉鏈変簺鍒濆鍖栬鎷掔粷
    const successCount = results.filter(r => r.success).length;
    const failedCount = results.filter(r => !r.success).length;

    expect(successCount).toBeLessThanOrEqual(maxConcurrent);
    expect(failedCount).toBeGreaterThan(0);
  });

  test('搴旇姝ｇ‘绠＄悊鍒濆鍖栫姸鎬?, async () => {
    const editorId = 'test-editor-4';

    // 鍒濆鐘舵€?    expect(initManager.getInitializationState(editorId)).toBe(InitializationState.IDLE);

    const mockInitFn = vi.fn(async (_signal: AbortSignal) => {
      // 鍦ㄥ垵濮嬪寲杩囩▼涓鏌ョ姸鎬?      expect(initManager.getInitializationState(editorId)).toBe(InitializationState.INITIALIZING);

      await new Promise(resolve => setTimeout(resolve, 100));
    });

    const resultPromise = initManager.safeInitialize(editorId, mockInitFn);

    // 绛夊緟鍒濆鍖栧紑濮?    await new Promise(resolve => setTimeout(resolve, 50));
    expect(initManager.getInitializationState(editorId)).toBe(InitializationState.INITIALIZING);

    const result = await resultPromise;
    expect(result.success).toBe(true);

    // 绛夊緟鐘舵€佹竻鐞?    await new Promise(resolve => setTimeout(resolve, 1100));
    expect(initManager.getInitializationState(editorId)).toBe(InitializationState.IDLE);
  });

  test('搴旇澶勭悊鍒濆鍖栬秴鏃?, async () => {
    const editorId = 'test-editor-5';

    const mockInitFn = vi.fn(async (_signal: AbortSignal) => {
      // 妯℃嫙瓒呮椂鐨勫垵濮嬪寲
      await new Promise(resolve => setTimeout(resolve, 2000));
    });

    const result = await initManager.safeInitialize(editorId, mockInitFn, {
      timeout: 500 // 500ms 瓒呮椂
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('瓒呮椂');
  });
});

/**
 * 闆嗘垚娴嬭瘯锛氭ā鎷熺湡瀹炵殑缂栬緫鍣ㄤ娇鐢ㄥ満鏅? */
describe('缂栬緫鍣ㄥ垵濮嬪寲闆嗘垚娴嬭瘯', () => {
  test('搴旇澶勭悊蹇€熸ā鎬佺獥鍙ｅ垏鎹㈠満鏅?, async () => {
    const initManager = getEditorInitializationManager();
    const editorId = 'modal-editor';

    let initCount = 0;
    const mockInitFn = async (signal: AbortSignal) => {
      initCount++;
      await new Promise(resolve => setTimeout(resolve, 200));

      if (signal.aborted) {
        throw new Error('鍒濆鍖栬涓');
      }
    };

    // 妯℃嫙蹇€熸墦寮€/鍏抽棴妯℃€佺獥鍙?    const init1 = initManager.safeInitialize(editorId, mockInitFn);

    // 50ms鍚庝腑姝紙妯℃嫙蹇€熷叧闂級
    setTimeout(() => {
      initManager.abortInitialization(editorId);
    }, 50);

    // 100ms鍚庨噸鏂板垵濮嬪寲锛堟ā鎷熼噸鏂版墦寮€锛?    setTimeout(async () => {
      await initManager.safeInitialize(editorId, mockInitFn);
    }, 100);

    const result1 = await init1;

    // 绗竴娆″垵濮嬪寲搴旇琚腑姝?    expect(result1.success).toBe(false);

    // 绛夊緟绗簩娆″垵濮嬪寲瀹屾垚
    await new Promise(resolve => setTimeout(resolve, 300));

    // 搴旇鍙湁涓€娆℃垚鍔熺殑鍒濆鍖?    expect(initCount).toBeLessThanOrEqual(2);
  });
});
