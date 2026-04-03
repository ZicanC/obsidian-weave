import {
  getRegexSecurityAdvice,
  validateRegex,
  validateRegexSync
} from '../utils/regex-validator';

describe('regex security validation', () => {
  test('rejects dangerous nested quantifier patterns', () => {
    for (const pattern of ['a++', '(a+)+', '(a*)*']) {
      const result = validateRegexSync(pattern);

      expect(result.isValid).toBe(false);
      expect(result.riskLevel).toBe('critical');
      expect((result.criticalIssues?.length ?? 0) > 0).toBe(true);
    }
  });

  test('accepts simple safe patterns', () => {
    const result = validateRegexSync('^[a-zA-Z0-9]+$');

    expect(result.isValid).toBe(true);
    expect(['low', 'medium']).toContain(result.riskLevel);
  });

  test('rejects disallowed lookarounds and backreferences', () => {
    expect(validateRegexSync('(?=test)').error).toContain('前瞻断言');
    expect(validateRegexSync('(?<=test)').error).toContain('后瞻断言');
    expect(validateRegexSync('(a)\\1').error).toContain('反向引用');
  });

  test('returns actionable advice for risky expressions', () => {
    const advice = getRegexSecurityAdvice('(a*)*');

    expect(advice.length).toBeGreaterThan(0);
    expect(advice.some((item) => item.includes('量词'))).toBe(true);
  });

  test('includes performance metrics for async validation of safe patterns', async () => {
    const result = await validateRegex('^[a-zA-Z0-9]+$');

    expect(result.isValid).toBe(true);
    expect(result.performanceMetrics).toBeDefined();
    expect(result.performanceMetrics?.maxExecutionTime).toBeGreaterThanOrEqual(0.001);
    expect(result.performanceMetrics?.averageTime).toBeGreaterThanOrEqual(0.001);
    expect(result.performanceMetrics?.failedTests).toEqual([]);
  });
});
