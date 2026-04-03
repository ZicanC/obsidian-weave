/**
 * IRAnnotationSignalService 单元测试
 */
import {
  IRAnnotationSignalService,
  createAnnotationSignalService,
  calculateAnnotationSignal,
  DEFAULT_ANNOTATION_SIGNAL_CONFIG,
  CALLOUT_TYPE_ALIASES,
  DEFAULT_CALLOUT_WEIGHTS
} from '../IRAnnotationSignalService';

describe('IRAnnotationSignalService', () => {
  let service: IRAnnotationSignalService;

  beforeEach(() => {
    service = new IRAnnotationSignalService();
  });

  describe('parseCallouts', () => {
    it('should parse a simple callout', () => {
      const content = `> [!question] 这是一个问题
> 问题内容在这里`;

      const callouts = service.parseCallouts(content);
      
      expect(callouts).toHaveLength(1);
      expect(callouts[0].rawType).toBe('question');
      expect(callouts[0].normalizedType).toBe('question');
      expect(callouts[0].content).toContain('问题内容');
    });

    it('should parse multiple callouts', () => {
      const content = `> [!question] 问题1
> 内容1

普通文本

> [!warning] 警告
> 警告内容

> [!quote] 引用
> 引用内容`;

      const callouts = service.parseCallouts(content);
      
      expect(callouts).toHaveLength(3);
      expect(callouts[0].normalizedType).toBe('question');
      expect(callouts[1].normalizedType).toBe('warning');
      expect(callouts[2].normalizedType).toBe('quote');
    });

    it('should normalize callout type aliases', () => {
      const content = `> [!help] 帮助
> 内容

> [!faq] FAQ
> 内容

> [!caution] 注意
> 内容`;

      const callouts = service.parseCallouts(content);
      
      expect(callouts).toHaveLength(3);
      expect(callouts[0].normalizedType).toBe('question'); // help -> question
      expect(callouts[1].normalizedType).toBe('question'); // faq -> question
      expect(callouts[2].normalizedType).toBe('warning');  // caution -> warning
    });

    it('should parse callouts with folding markers', () => {
      const content = `> [!question]+ 可展开
> 内容

> [!warning]- 默认折叠
> 内容`;

      const callouts = service.parseCallouts(content);
      
      expect(callouts).toHaveLength(2);
    });

    it('should handle empty callouts', () => {
      const content = `> [!note]`;

      const callouts = service.parseCallouts(content);
      
      expect(callouts).toHaveLength(1);
      expect(callouts[0].content).toBe('');
    });
  });

  describe('calculateSignal', () => {
    it('should return zero signal for content without callouts', () => {
      const content = `这是普通的 markdown 内容
没有任何 callout`;

      const result = service.calculateSignal(content);
      
      expect(result.signal).toBe(0);
      expect(result.totalCalloutCount).toBe(0);
      expect(result.effectiveCalloutCount).toBe(0);
    });

    it('should calculate signal for single callout', () => {
      const content = `> [!question] 问题
> 这是一个问题的详细内容`;

      const result = service.calculateSignal(content);
      
      expect(result.signal).toBeGreaterThan(0);
      expect(result.effectiveCalloutCount).toBe(1);
      expect(result.typeCounts['question']).toBe(1);
    });

    it('should apply saturation function to prevent gaming', () => {
      // 创建大量 callout
      let content = '';
      for (let i = 0; i < 20; i++) {
        content += `> [!question] 问题 ${i}
> 问题内容 ${i}

`;
      }

      const result = service.calculateSignal(content);
      
      // 信号应该接近 maxBoost 但不超过
      expect(result.signal).toBeLessThanOrEqual(DEFAULT_ANNOTATION_SIGNAL_CONFIG.maxBoost);
      // 由于饱和函数，20个 callout 的信号应该远小于 20 * 权重
      expect(result.rawScore).toBeGreaterThan(result.signal);
    });

    it('should filter out callouts not in whitelist', () => {
      const content = `> [!note] 笔记
> 笔记内容

> [!question] 问题
> 问题内容`;

      const result = service.calculateSignal(content);
      
      // note 不在默认白名单中，所以只有 question 计入
      expect(result.effectiveCalloutCount).toBe(1);
      expect(result.totalCalloutCount).toBe(2);
    });

    it('should filter out callouts with too short content', () => {
      const serviceWithMinLength = new IRAnnotationSignalService({
        minContentLength: 10
      });

      const content = `> [!question] 问题
> 短

> [!question] 另一个问题
> 这是一段足够长的内容，应该能通过最小长度检查`;

      const result = serviceWithMinLength.calculateSignal(content);
      
      // 第一个 callout 内容太短，应该被过滤
      expect(result.effectiveCalloutCount).toBe(1);
    });

    it('should calculate weighted contributions correctly', () => {
      const content = `> [!question] 问题
> 问题内容很详细

> [!quote] 引用
> 引用的内容`;

      const result = service.calculateSignal(content);
      
      // question 权重 2.5, quote 权重 1.5
      expect(result.typeContributions['question']).toBe(DEFAULT_CALLOUT_WEIGHTS['question']);
      expect(result.typeContributions['quote']).toBe(DEFAULT_CALLOUT_WEIGHTS['quote']);
      expect(result.rawScore).toBe(
        DEFAULT_CALLOUT_WEIGHTS['question'] + DEFAULT_CALLOUT_WEIGHTS['quote']
      );
    });
  });

  describe('applySignalToPriority', () => {
    it('should add signal to priority', () => {
      const pEff = 5;
      const signal = 1.5;
      
      const result = service.applySignalToPriority(pEff, signal);
      
      expect(result).toBe(6.5);
    });

    it('should clamp result to 0-10', () => {
      expect(service.applySignalToPriority(9, 2)).toBe(10);
      expect(service.applySignalToPriority(1, -2)).toBe(0);
    });
  });

  describe('calculateAdjustedPriority', () => {
    it('should calculate adjusted priority from content', () => {
      const content = `> [!question] 重要问题
> 这个问题非常重要，需要深入理解`;

      const { adjustedPriority, signalResult } = service.calculateAdjustedPriority(content, 5);
      
      expect(adjustedPriority).toBeGreaterThan(5);
      expect(signalResult.effectiveCalloutCount).toBe(1);
    });
  });

  describe('getSignalExplanation', () => {
    it('should generate readable explanation', () => {
      const content = `> [!question] 问题
> 问题内容`;

      const result = service.calculateSignal(content);
      const explanation = service.getSignalExplanation(result);
      
      expect(explanation).toContain('标注信号');
      expect(explanation).toContain('question');
    });

    it('should return message for no callouts', () => {
      const result = service.calculateSignal('普通文本');
      const explanation = service.getSignalExplanation(result);
      
      expect(explanation).toBe('无有效标注');
    });
  });

  describe('configuration', () => {
    it('should allow custom configuration', () => {
      const customService = createAnnotationSignalService({
        enabledTypes: ['note'],
        typeWeights: { 'note': 3.0 },
        maxBoost: 1.0
      });

      const content = `> [!note] 笔记
> 笔记内容`;

      const result = customService.calculateSignal(content);
      
      expect(result.effectiveCalloutCount).toBe(1);
      expect(result.signal).toBeLessThanOrEqual(1.0);
    });

    it('should update configuration', () => {
      service.updateConfig({
        maxBoost: 1.5
      });

      const config = service.getConfig();
      expect(config.maxBoost).toBe(1.5);
    });
  });

  describe('CALLOUT_TYPE_ALIASES', () => {
    it('should have expected aliases', () => {
      expect(CALLOUT_TYPE_ALIASES['help']).toBe('question');
      expect(CALLOUT_TYPE_ALIASES['faq']).toBe('question');
      expect(CALLOUT_TYPE_ALIASES['caution']).toBe('warning');
      expect(CALLOUT_TYPE_ALIASES['attention']).toBe('warning');
      expect(CALLOUT_TYPE_ALIASES['cite']).toBe('quote');
    });
  });
});
