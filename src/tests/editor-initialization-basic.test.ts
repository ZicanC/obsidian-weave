/**
 * 缂栬緫鍣ㄥ垵濮嬪寲鍩虹娴嬭瘯
 * 楠岃瘉EditorInitializationManager鐨勫熀鏈姛鑳? */
import { getEditorInitializationManager, InitializationState } from '../utils/editor-initialization-manager';

describe('缂栬緫鍣ㄥ垵濮嬪寲绠＄悊鍣ㄥ熀纭€娴嬭瘯', () => {
  let initManager: ReturnType<typeof getEditorInitializationManager>;

  beforeEach(() => {
    initManager = getEditorInitializationManager();
    initManager.cleanup();
  });

  test('搴旇鑳藉垱寤哄垵濮嬪寲绠＄悊鍣ㄥ疄渚?, () => {
    expect(initManager).toBeDefined();
    expect(typeof initManager.safeInitialize).toBe('function');
    expect(typeof initManager.abortInitialization).toBe('function');
    expect(typeof initManager.getInitializationState).toBe('function');
  });

  test('搴旇杩斿洖姝ｇ‘鐨勫垵濮嬬姸鎬?, () => {
    const editorId = 'test-editor';
    const state = initManager.getInitializationState(editorId);
    expect(state).toBe(InitializationState.IDLE);
  });

  test('搴旇鑳芥垚鍔熷垵濮嬪寲缂栬緫鍣?, async () => {
    const editorId = 'test-editor';
    let initCalled = false;

    const mockInitFn = async (_signal: AbortSignal) => {
      initCalled = true;
      // 绠€鍗曠殑鍒濆鍖栭€昏緫
      await new Promise(resolve => setTimeout(resolve, 10));
    };

    const result = await initManager.safeInitialize(editorId, mockInitFn);

    expect(result.success).toBe(true);
    expect(initCalled).toBe(true);
    expect(result.duration).toBeGreaterThan(0);
  });

  test('搴旇鑳藉鐞嗗垵濮嬪寲澶辫触', async () => {
    const editorId = 'test-editor';

    const mockInitFn = async (_signal: AbortSignal) => {
      throw new Error('妯℃嫙鍒濆鍖栧け璐?);
    };

    const result = await initManager.safeInitialize(editorId, mockInitFn, {
      maxRetries: 0 // 涓嶉噸璇?    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('妯℃嫙鍒濆鍖栧け璐?);
  });

  test('搴旇鑳戒腑姝㈠垵濮嬪寲', async () => {
    const editorId = 'test-editor';
    let initStarted = false;

    const mockInitFn = async (signal: AbortSignal) => {
      initStarted = true;

      // 妯℃嫙闀挎椂闂村垵濮嬪寲
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 1000);

        signal.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new Error('鍒濆鍖栬涓'));
        });
      });
    };

    // 鍚姩鍒濆鍖?    const initPromise = initManager.safeInitialize(editorId, mockInitFn);

    // 绛夊緟鍒濆鍖栧紑濮?    await new Promise(resolve => setTimeout(resolve, 50));
    expect(initStarted).toBe(true);

    // 涓鍒濆鍖?    const aborted = initManager.abortInitialization(editorId);
    expect(aborted).toBe(true);

    // 绛夊緟鍒濆鍖栧畬鎴?    const result = await initPromise;
    expect(result.success).toBe(false);
  });
});
