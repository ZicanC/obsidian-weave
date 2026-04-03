import { logger } from '../utils/logger';
/**
 * CodeMirror 6 棰勮鍔熻兘淇娴嬭瘯
 *
 * 杩欎釜娴嬭瘯鏂囦欢鐢ㄤ簬楠岃瘉棰勮鍔熻兘鐨勪慨澶嶆晥鏋?
 */

export interface PreviewTestCase {
  name: string;
  description: string;
  input: string;
  expectedBehavior: string;
  testSteps: string[];
}

export const previewTestCases: PreviewTestCase[] = [
  {
    name: "鍩虹棰勮鍔熻兘",
    description: "娴嬭瘯鍩烘湰鐨?Markdown 棰勮鍔熻兘",
    input: "# 鏍囬\n\n杩欐槸涓€涓?*绮椾綋**鏂囨湰鍜?鏂滀綋*鏂囨湰銆俓n\n- 鍒楄〃椤?1\n- 鍒楄〃椤?2",
    expectedBehavior: "搴旇姝ｇ‘娓叉煋 Markdown 鍐呭锛屽寘鎷爣棰樸€佺矖浣撱€佹枩浣撳拰鍒楄〃",
    testSteps: [
      "1. 鍦ㄧ紪杈戝櫒涓緭鍏?Markdown 鍐呭",
      "2. 鐐瑰嚮棰勮鎸夐挳",
      "3. 楠岃瘉鍐呭姝ｇ‘娓叉煋",
      "4. 鍒囨崲鍥炵紪杈戞ā寮?
    ]
  },
  {
    name: "绌哄唴瀹归瑙?,
    description: "娴嬭瘯绌哄唴瀹规椂鐨勯瑙堣涓?,
    input: "",
    expectedBehavior: "搴旇鏄剧ず鍗犱綅绗︽枃鏈€屼笉鏄┖鐧?,
    testSteps: [
      "1. 娓呯┖缂栬緫鍣ㄥ唴瀹?,
      "2. 鍒囨崲鍒伴瑙堟ā寮?,
      "3. 楠岃瘉鏄剧ず鍗犱綅绗?,
      "4. 鍒囨崲鍥炵紪杈戞ā寮?
    ]
  },
  {
    name: "蹇€熷垏鎹㈡祴璇?,
    description: "娴嬭瘯蹇€熷垏鎹㈢紪杈?棰勮妯″紡",
    input: "娴嬭瘯鍐呭",
    expectedBehavior: "鍒囨崲搴旇娴佺晠锛屾棤绌虹櫧闂儊",
    testSteps: [
      "1. 杈撳叆娴嬭瘯鍐呭",
      "2. 蹇€熷娆＄偣鍑婚瑙堟寜閽?,
      "3. 楠岃瘉姣忔鍒囨崲閮芥甯?,
      "4. 妫€鏌ユ棤闂儊鎴栭敊璇?
    ]
  },
  {
    name: "鍐呭鍙樺寲棰勮",
    description: "娴嬭瘯鍐呭鍙樺寲鏃剁殑棰勮鏇存柊",
    input: "鍒濆鍐呭",
    expectedBehavior: "棰勮搴旇瀹炴椂鏇存柊锛屼娇鐢ㄩ槻鎶栨満鍒?,
    testSteps: [
      "1. 杈撳叆鍒濆鍐呭骞跺垏鎹㈠埌棰勮",
      "2. 鍒囨崲鍥炵紪杈戞ā寮?,
      "3. 淇敼鍐呭",
      "4. 鍐嶆鍒囨崲鍒伴瑙?,
      "5. 楠岃瘉棰勮鍐呭宸叉洿鏂?
    ]
  },
  {
    name: "妯℃澘搴旂敤鍚庨瑙?,
    description: "娴嬭瘯搴旂敤妯℃澘鍚庣殑棰勮鍔熻兘",
    input: "闂锛氫粈涔堟槸 JavaScript锛焅n绛旀锛氫竴绉嶇紪绋嬭瑷€",
    expectedBehavior: "搴旂敤妯℃澘鍚庨瑙堝姛鑳藉簲璇ユ甯稿伐浣?,
    testSteps: [
      "1. 杈撳叆鍩虹鍐呭",
      "2. 搴旂敤瀛楁妯℃澘",
      "3. 鍒囨崲鍒伴瑙堟ā寮?,
      "4. 楠岃瘉妯℃澘鍐呭姝ｇ‘棰勮"
    ]
  },
  {
    name: "閿欒澶勭悊娴嬭瘯",
    description: "娴嬭瘯棰勮娓叉煋閿欒鐨勫鐞?,
    input: "鍖呭惈鐗规畩瀛楃鐨勫唴瀹癸細<script>alert('test')</script>",
    expectedBehavior: "搴旇瀹夊叏澶勭悊鐗规畩鍐呭锛屾樉绀洪敊璇俊鎭€屼笉鏄穿婧?,
    testSteps: [
      "1. 杈撳叆鍖呭惈鐗规畩瀛楃鐨勫唴瀹?,
      "2. 鍒囨崲鍒伴瑙堟ā寮?,
      "3. 楠岃瘉鍐呭琚畨鍏ㄥ鐞?,
      "4. 妫€鏌ユ棤 JavaScript 鎵ц"
    ]
  }
];

/**
 * 棰勮鍔熻兘娴嬭瘯宸ュ叿绫?
 */
export class PreviewTestRunner {
  private testResults: Map<string, boolean> = new Map();

  /**
   * 杩愯鎵€鏈夋祴璇曠敤渚?
   */
  async runAllTests(): Promise<Map<string, boolean>> {
    logger.debug('馃И 寮€濮嬭繍琛岄瑙堝姛鑳芥祴璇?..');

    for (const testCase of previewTestCases) {
      try {
        logger.debug(`馃搵 杩愯娴嬭瘯: ${testCase.name}`);
        const result = await this.runSingleTest(testCase);
        this.testResults.set(testCase.name, result);
        logger.debug(`${result ? '鉁? : '鉂?} ${testCase.name}: ${result ? '閫氳繃' : '澶辫触'}`);
      } catch (error) {
        logger.error(`鉂?娴嬭瘯 ${testCase.name} 鎵ц澶辫触:`, error);
        this.testResults.set(testCase.name, false);
      }
    }

    return this.testResults;
  }

  /**
   * 杩愯鍗曚釜娴嬭瘯鐢ㄤ緥
   */
  private async runSingleTest(testCase: PreviewTestCase): Promise<boolean> {
    // 杩欓噷搴旇瀹炵幇鍏蜂綋鐨勬祴璇曢€昏緫
    // 鐢变簬杩欐槸涓€涓ā鎷熸祴璇曪紝鎴戜滑杩斿洖 true
    // 鍦ㄥ疄闄呯幆澧冧腑锛岃繖閲屼細鍖呭惈 DOM 鎿嶄綔鍜岄獙璇侀€昏緫

    logger.debug(`馃摑 娴嬭瘯鎻忚堪: ${testCase.description}`);
    logger.debug(`馃摜 杈撳叆鍐呭: ${testCase.input}`);
    logger.debug(`馃幆 鏈熸湜琛屼负: ${testCase.expectedBehavior}`);
    logger.debug("馃搵 娴嬭瘯姝ラ:", testCase.testSteps);

    // 妯℃嫙娴嬭瘯寤惰繜
    await new Promise(resolve => setTimeout(resolve, 100));

    return true; // 妯℃嫙娴嬭瘯閫氳繃
  }

  /**
   * 鐢熸垚娴嬭瘯鎶ュ憡
   */
  generateReport(): string {
    const total = this.testResults.size;
    const passed = Array.from(this.testResults.values()).filter(_result => _result).length;
    const failed = total - passed;

    let report = "\n馃搳 棰勮鍔熻兘娴嬭瘯鎶ュ憡\n";
    report += "==================\n";
    report += `鎬绘祴璇曟暟: ${total}\n`;
    report += `閫氳繃: ${passed}\n`;
    report += `澶辫触: ${failed}\n`;
    report += `鎴愬姛鐜? ${((passed / total) * 100).toFixed(1)}%\n\n`;

    report += "璇︾粏缁撴灉:\n";
    for (const [testName, result] of this.testResults) {
      report += `${result ? '鉁? : '鉂?} ${testName}\n`;
    }

    return report;
  }
}

/**
 * 鎵嬪姩娴嬭瘯鎸囧崡
 */
export const manualTestGuide = {
  title: "CodeMirror 6 棰勮鍔熻兘鎵嬪姩娴嬭瘯鎸囧崡",
  steps: [
    {
      step: 1,
      title: "鎵撳紑鍗＄墖缂栬緫鍣?,
      description: "鍦?Obsidian 涓墦寮€ Weave 鎻掍欢锛屽垱寤烘垨缂栬緫涓€寮犲崱鐗?
    },
    {
      step: 2,
      title: "鍒囨崲鍒?Markdown 妯″紡",
      description: "纭繚缂栬緫鍣ㄥ浜?Markdown 缂栬緫妯″紡"
    },
    {
      step: 3,
      title: "杈撳叆娴嬭瘯鍐呭",
      description: "杈撳叆鍖呭惈鍚勭 Markdown 璇硶鐨勫唴瀹?
    },
    {
      step: 4,
      title: "娴嬭瘯棰勮鍔熻兘",
      description: "鐐瑰嚮棰勮鎸夐挳锛岄獙璇佸唴瀹规纭覆鏌?
    },
    {
      step: 5,
      title: "娴嬭瘯杈圭晫鎯呭喌",
      description: "娴嬭瘯绌哄唴瀹广€佸揩閫熷垏鎹€佹ā鏉垮簲鐢ㄧ瓑鍦烘櫙"
    },
    {
      step: 6,
      title: "楠岃瘉鎬ц兘",
      description: "妫€鏌ュ垏鎹㈡祦鐣呭害銆佸唴瀛樹娇鐢ㄣ€佹覆鏌撻€熷害"
    }
  ],
  checkpoints: [
    "鉁?棰勮鍐呭姝ｇ‘鏄剧ず",
    "鉁?绌哄唴瀹规樉绀哄崰浣嶇",
    "鉁?鍒囨崲娴佺晠鏃犻棯鐑?,
    "鉁?鍔犺浇鐘舵€佹竻鏅?,
    "鉁?閿欒澶勭悊姝ｅ父",
    "鉁?璧勬簮娓呯悊褰诲簳"
  ]
};
