import { logger } from '../utils/logger';
/**
 * 娴嬭瘯鍚姩鍣?
 * 杩愯鎵€鏈夋祴璇曠敤渚?
 */

import { testRunner } from '../utils/test-runner';

// 瀵煎叆鎵€鏈夋祴璇曟枃浠?
import './sync-manager.test';
import './sync-system.test';
// import './data-import.test'; // APKG瀵煎叆娴嬭瘯

/**
 * 杩愯鎵€鏈夋祴璇?
 */
export async function runAllTests(): Promise<boolean> {
  logger.debug('馃殌 鍚姩 Weave 鎻掍欢娴嬭瘯濂椾欢\n');

  try {
    const report = await testRunner.run();

    // 杩斿洖娴嬭瘯鏄惁鍏ㄩ儴閫氳繃
    return report.success;

  } catch (error) {
    logger.error('鉂?娴嬭瘯杩愯澶辫触:', error);
    return false;
  }
}

/**
 * 鍦ㄥ紑鍙戠幆澧冧腑杩愯娴嬭瘯
 */
export async function runDevTests(): Promise<void> {
  const success = await runAllTests();

  if (success) {
    logger.debug('\n鉁?鎵€鏈夋祴璇曢€氳繃锛佹彃浠跺姛鑳芥甯搞€?);
  } else {
    logger.debug('\n鉂?鏈夋祴璇曞け璐ワ紒璇锋鏌ヤ唬鐮併€?);
  }
}

// 榛樿涓嶈嚜鍔ㄦ墽琛屾祴璇曪紝閬垮厤鍦ㄩ潪棰勬湡鐜涓Е鍙?// 娴嬭瘯搴旈€氳繃鏄庣‘璋冪敤鏉ユ墽琛?// if (typeof window === 'undefined') {
//   // Node.js 鐜
//   runDevTests().catch(console.error);
// }

export default runAllTests;
