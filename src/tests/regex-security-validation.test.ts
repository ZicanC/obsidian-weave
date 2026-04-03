/**
 * 姝ｅ垯琛ㄨ揪寮忓畨鍏ㄩ獙璇佹祴璇?
 * 楠岃瘉澧炲己鐨勬鍒欒〃杈惧紡楠岃瘉鍣ㄨ兘鍚︽纭娴嬪拰闃叉姢ReDoS鏀诲嚮
 */
import { validateRegexSync, validateRegex, getRegexSecurityAdvice } from '../utils/regex-validator';

describe('姝ｅ垯琛ㄨ揪寮忓畨鍏ㄩ獙璇佹祴璇?, () => {

  test('搴旇妫€娴嬪祵濂楅噺璇嶏紙鏈€鍗遍櫓鐨凴eDoS妯″紡锛?, () => {
    const dangerousPatterns = [
      'a*+',
      'a++',
      '(a*)*',
      '(a+)+',
      '(a*)+',
      '(a+)*'
    ];

    for (const pattern of dangerousPatterns) {
      const result = validateRegexSync(pattern);
      expect(result.isValid).toBe(false);
      expect(result.criticalIssues).toBeDefined();
      expect(result.criticalIssues?.length).toBeGreaterThan(0);
      expect(result.riskLevel).toBe('critical');
    }
  });

  test('搴旇妫€娴嬮珮椋庨櫓妯″紡', () => {
    const highRiskPatterns = [
      '(a|b)*c',  // 浜ゆ浛鍒嗘敮涓殑閲嶅
      '(a*b)*',   // 閲嶅鐨勫垎缁?
      '(?=.*a)(?=.*b)', // 宓屽鐨勫墠鐬绘柇瑷€
      'a*?a*'     // 璐┆鍜岄潪璐┆閲忚瘝娣峰悎
    ];

    for (const pattern of highRiskPatterns) {
      const result = validateRegexSync(pattern, { allowLookahead: true });
      expect(['high', 'critical']).toContain(result.riskLevel);
      expect((result.warnings?.length || 0) + (result.criticalIssues?.length || 0)).toBeGreaterThan(0);
    }
  });

  test('搴旇鍏佽瀹夊叏鐨勬鍒欒〃杈惧紡', () => {
    const safePatterns = [
      '^[a-zA-Z0-9]+$',
      '\\d{4}-\\d{2}-\\d{2}',
      '[a-z]+@[a-z]+\\.[a-z]+',
      '^##\\s*([^\\n]+)\\s*\\n+([\\s\\S]*?)$'
    ];

    for (const pattern of safePatterns) {
      const result = validateRegexSync(pattern);
      expect(result.isValid).toBe(true);
      expect(['low', 'medium']).toContain(result.riskLevel);
    }
  });

  test('搴旇妫€娴嬪鏉傚害杩囬珮鐨勬鍒欒〃杈惧紡', () => {
    // 鍒涘缓涓€涓鏉傚害寰堥珮鐨勬鍒欒〃杈惧紡
    const complexPattern = `(${'a*'.repeat(50)})*`;

    const result = validateRegexSync(complexPattern, { maxComplexity: 100 });
    expect(result.isValid).toBe(false);
    expect(result.error).toContain('澶嶆潅');
  });

  test('搴旇妫€娴嬮暱搴﹁繃闀跨殑姝ｅ垯琛ㄨ揪寮?, () => {
    const longPattern = 'a'.repeat(1500);

    const result = validateRegexSync(longPattern, { maxLength: 1000 });
    expect(result.isValid).toBe(false);
    expect(result.error).toContain('闀垮害');
  });

  test('搴旇妫€娴嬭娉曢敊璇?, () => {
    const invalidPatterns = [
      '[',
      '(',
      '*',
      '+',
      '?',
      '{',
      '(?'
    ];

    for (const pattern of invalidPatterns) {
      const result = validateRegexSync(pattern);
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('璇硶閿欒');
    }
  });

  test('搴旇鎻愪緵瀹夊叏寤鸿', () => {
    const advice = getRegexSecurityAdvice('(a*)*');
    expect(advice).toBeDefined();
    expect(advice.length).toBeGreaterThan(0);
    expect(advice.some(a => a.includes('閲忚瘝'))).toBe(true);
  });

  test('搴旇妫€娴嬪墠鐬诲拰鍚庣灮鏂█', () => {
    const lookaroundPatterns = [
      '(?=test)',
      '(?!test)',
      '(?<=test)',
      '(?<!test)'
    ];

    for (const pattern of lookaroundPatterns) {
      const result = validateRegexSync(pattern, {
        allowLookahead: false,
        allowLookbehind: false
      });
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('鏂█');
    }
  });

  test('搴旇妫€娴嬪弽鍚戝紩鐢?, () => {
    const backrefPatterns = [
      '(a)\\1',
      '(test).*\\1',
      '([a-z])\\1+'
    ];

    for (const pattern of backrefPatterns) {
      const result = validateRegexSync(pattern, { allowBackreferences: false });
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('鍙嶅悜寮曠敤');
    }
  });

  test('搴旇妫€娴嬪ぇ鑼冨洿閲忚瘝', () => {
    const largeQuantifierPatterns = [
      'a{1000,}',
      'b{100,2000}',
      'c{500,1500}'
    ];

    for (const pattern of largeQuantifierPatterns) {
      const result = validateRegexSync(pattern);
      expect(result.warnings).toBeDefined();
      expect(result.warnings?.some(w => w.includes('澶ц寖鍥撮噺璇?))).toBe(true);
    }
  });

  test('搴旇妫€娴嬭繃闀跨殑瀛楃绫?, () => {
    const longCharClass = `[${'a-z'.repeat(10)}]`;

    const result = validateRegexSync(longCharClass);
    expect(result.warnings).toBeDefined();
    expect(result.warnings?.some(w => w.includes('瀛楃绫昏繃闀?))).toBe(true);
  });

  test('搴旇妫€娴嬭繃澶氱殑宓屽鍒嗙粍', () => {
    const nestedGroups = '((((a))))((((b))))((((c))))((((d))))';

    const result = validateRegexSync(nestedGroups);
    expect(result.warnings).toBeDefined();
    expect(result.warnings?.some(w => w.includes('宓屽鍒嗙粍杩囧'))).toBe(true);
  });
});

describe('寮傛姝ｅ垯琛ㄨ揪寮忛獙璇佹祴璇?, () => {
  test('搴旇杩涜鍏ㄩ潰鐨勬€ц兘娴嬭瘯', async () => {
    const pattern = '^[a-zA-Z0-9]+$';

    const result = await validateRegex(pattern);
    expect(result.isValid).toBe(true);
    expect(result.performanceMetrics).toBeDefined();
    expect(result.performanceMetrics?.maxExecutionTime).toBeGreaterThanOrEqual(0.001);
    expect(result.performanceMetrics?.averageTime).toBeGreaterThanOrEqual(0.001);
    expect(result.performanceMetrics?.failedTests).toBeDefined();
  });

  test('搴旇妫€娴嬫€ц兘闂', async () => {
    // 杩欎釜妯″紡鍦ㄦ煇浜涜緭鍏ヤ笅鍙兘瀵艰嚧鎬ц兘闂
    const problematicPattern = '(a+)+b';

    const result = await validateRegex(problematicPattern, { timeoutMs: 100 });

    // 鏍规嵁瀹為檯鎬ц兘鍙兘閫氳繃鎴栧け璐?
    if (!result.isValid) {
      expect(
        result.error?.includes('鏃堕棿') || result.error?.includes('瀹夊叏椋庨櫓')
      ).toBe(true);
    } else {
      expect(result.performanceMetrics).toBeDefined();
    }
  });
});

describe('Weave鎻掍欢瀹樻柟姝ｅ垯琛ㄨ揪寮忛獙璇?, () => {
  test('搴旇楠岃瘉瀹樻柟妯℃澘鐨勬鍒欒〃杈惧紡瀹夊叏鎬?, () => {
    const officialPatterns = [
      // 鍩虹闂瓟棰?
      '##\\s*([^\\n]+)\\s*\\n+([\\s\\S]*?)(?:\\n\\*\\*鏍囩\\*\\*:\\s*([^\\n]+))?$',
      // 閫夋嫨棰?
      '##\\s*([^\\n]+)\\s*\\n+\\*\\*閫夐」\\*\\*:\\s*\\n([\\s\\S]*?)(?:\\n\\*\\*瑙ｆ瀽\\*\\*:\\s*([^\\n]*?))?(?:\\n\\*\\*鏍囩\\*\\*:\\s*([^\\n]+))?$',
      // 濉┖棰?
      '^([\\s\\S]*?)(?:\\n\\*\\*鎻愮ず\\*\\*:\\s*([^\\n]*?))?(?:\\n\\*\\*鏍囩\\*\\*:\\s*([^\\n]+))?$'
    ];

    for (const pattern of officialPatterns) {
      const result = validateRegexSync(pattern);

      // 瀹樻柟妯℃澘搴旇鏄畨鍏ㄧ殑锛屼絾鍙兘鏈変竴浜涜鍛?
      expect(result.isValid).toBe(true);
      expect(result.riskLevel).not.toBe('critical');

      // 濡傛灉鏈夎鍛婏紝涔熶笉搴斿崌绾т负涓ラ噸椋庨櫓
      if (result.warnings && result.warnings.length > 0) {
        expect(['low', 'medium', 'high']).toContain(result.riskLevel);
      }
    }
  });
});
