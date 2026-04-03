import { QACardParser } from './QACardParser';

describe('QACardParser', () => {
  it('removes legacy quote hint blocks from parsed front/back fields', () => {
    const parser = new QACardParser();

    const result = parser.parseMarkdownToFields(
      '问题正文\n\n---div---\n\n答案正文\n\nExplanation: 额外说明\n\n>hint: 第一条提示\n> 第二条提示',
      'basic-qa'
    );

    expect(result.success).toBe(true);
    expect(result.fields.front).toBe('问题正文');
    expect(result.fields.back).toBe('答案正文\n\nExplanation: 额外说明');
  });

  it('keeps backward compatibility with historical we_tip callout syntax', () => {
    const parser = new QACardParser();

    const result = parser.parseMarkdownToFields(
      '问题正文\n\n---div---\n\n答案正文\n\n> [!we_tip]\n>\n> 第一条提示\n> 第二条提示',
      'basic-qa'
    );

    expect(result.success).toBe(true);
    expect(result.fields.front).toBe('问题正文');
    expect(result.fields.back).toBe('答案正文');
  });
});
