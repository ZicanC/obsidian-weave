/**
 * 璧勬簮绠＄悊鍣ㄥ熀纭€鍔熻兘娴嬭瘯
 */
import { EditorResourceManager, getGlobalResourceManager } from '../utils/resource-manager';

describe('璧勬簮绠＄悊鍣ㄥ熀纭€娴嬭瘯', () => {
  let resourceManager: EditorResourceManager;
  const editorId = 'test-editor';

  beforeEach(() => {
    const globalManager = getGlobalResourceManager();
    resourceManager = globalManager.getEditorManager(editorId);
  });

  test('搴旇鑳藉垱寤鸿祫婧愮鐞嗗櫒瀹炰緥', () => {
    expect(resourceManager).toBeDefined();
    expect(typeof resourceManager.registerTimer).toBe('function');
    expect(typeof resourceManager.registerEventListener).toBe('function');
    expect(typeof resourceManager.registerPromise).toBe('function');
    expect(typeof resourceManager.registerComponent).toBe('function');
    expect(typeof resourceManager.registerCustomCleanup).toBe('function');
  });

  test('搴旇鑳借幏鍙栬祫婧愮粺璁?, () => {
    const stats = resourceManager.getResourceStats();
    expect(stats).toBeDefined();
    expect(typeof stats.timers).toBe('number');
    expect(typeof stats.eventListeners).toBe('number');
    expect(typeof stats.promises).toBe('number');
    expect(typeof stats.components).toBe('number');
    expect(typeof stats.customCleanups).toBe('number');
    expect(typeof stats.total).toBe('number');
  });

  test('搴旇鑳芥敞鍐屽畾鏃跺櫒', () => {
    const timerId = resourceManager.registerTimer(123 as any, 'timeout', '娴嬭瘯瀹氭椂鍣?);
    expect(timerId).toBeTruthy();
    expect(typeof timerId).toBe('string');

    const stats = resourceManager.getResourceStats();
    expect(stats.timers).toBe(1);
    expect(stats.total).toBe(1);
  });

  test('搴旇鑳芥敞鍐岃嚜瀹氫箟娓呯悊鍑芥暟', () => {
    let cleanupCalled = false;
    const cleanup = () => { cleanupCalled = true; };

    const cleanupId = resourceManager.registerCustomCleanup(cleanup, '娴嬭瘯娓呯悊');
    expect(cleanupId).toBeTruthy();

    const stats = resourceManager.getResourceStats();
    expect(stats.customCleanups).toBe(1);

    // 閿€姣佽祫婧愮鐞嗗櫒
    resourceManager.destroy();

    // 楠岃瘉娓呯悊鍑芥暟琚皟鐢?    expect(cleanupCalled).toBe(true);
  });

  test('搴旇鑳芥娴嬭祫婧愭硠婕?, () => {
    // 娉ㄥ唽澶ч噺瀹氭椂鍣?    for (let i = 0; i < 15; i++) {
      resourceManager.registerTimer(i as any, 'timeout', `瀹氭椂鍣?{i}`);
    }

    const leaks = resourceManager.checkForLeaks();
    expect(leaks.length).toBeGreaterThan(0);
    expect(leaks.some(leak => leak.includes('瀹氭椂鍣ㄨ繃澶?))).toBe(true);
  });

  test('搴旇鑳介攢姣佹墍鏈夎祫婧?, () => {
    // 娉ㄥ唽涓€浜涜祫婧?    resourceManager.registerTimer(123 as any, 'timeout', '娴嬭瘯瀹氭椂鍣?);
    resourceManager.registerCustomCleanup(() => {}, '娴嬭瘯娓呯悊');

    let stats = resourceManager.getResourceStats();
    expect(stats.total).toBeGreaterThan(0);

    // 閿€姣?    resourceManager.destroy();

    // 楠岃瘉璧勬簮琚竻鐞?    stats = resourceManager.getResourceStats();
    expect(stats.total).toBe(0);
  });
});

describe('鍏ㄥ眬璧勬簮绠＄悊鍣ㄥ熀纭€娴嬭瘯', () => {
  test('搴旇鑳借幏鍙栧叏灞€璧勬簮绠＄悊鍣ㄥ疄渚?, () => {
    const globalManager = getGlobalResourceManager();
    expect(globalManager).toBeDefined();
    expect(typeof globalManager.getEditorManager).toBe('function');
    expect(typeof globalManager.destroyEditorManager).toBe('function');
    expect(typeof globalManager.getGlobalStats).toBe('function');
    expect(typeof globalManager.checkGlobalLeaks).toBe('function');
    expect(typeof globalManager.cleanup).toBe('function');
  });

  test('搴旇鑳界鐞嗗涓紪杈戝櫒', () => {
    const globalManager = getGlobalResourceManager();

    const editor1 = globalManager.getEditorManager('editor-1');
    const editor2 = globalManager.getEditorManager('editor-2');

    expect(editor1).toBeDefined();
    expect(editor2).toBeDefined();
    expect(editor1).not.toBe(editor2);

    // 娓呯悊
    globalManager.destroyEditorManager('editor-1');
    globalManager.destroyEditorManager('editor-2');
  });

  test('搴旇鑳借幏鍙栧叏灞€缁熻', () => {
    const globalManager = getGlobalResourceManager();

    const editor1 = globalManager.getEditorManager('test-editor-1');
    editor1.registerTimer(123 as any, 'timeout', '娴嬭瘯瀹氭椂鍣?);

    const globalStats = globalManager.getGlobalStats();
    expect(globalStats).toBeDefined();
    expect(globalStats['test-editor-1']).toBeDefined();
    expect(globalStats['test-editor-1'].timers).toBe(1);

    // 娓呯悊
    globalManager.destroyEditorManager('test-editor-1');
  });
});
