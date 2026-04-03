import { getNativeTemplateByCardType } from './WeaveNativeTemplates';

describe('WeaveNativeTemplates', () => {
  it('maps legacy multiple card types to the native choice template', () => {
    expect(getNativeTemplateByCardType('multiple')?.id).toBe('weave-native-choice');
  });

  it('maps legacy cloze family card types to the native cloze template', () => {
    expect(getNativeTemplateByCardType('progressive-parent')?.id).toBe('weave-native-cloze');
  });

  it('uses clean choice markup that leaves correctness to the answer area', () => {
    const template = getNativeTemplateByCardType('multiple');

    expect(template?.frontTemplate).toContain('{{options}}');
    expect(template?.backTemplate).toContain('正确答案');
    expect(template?.css).toContain('.choice-option-label');
    expect(template?.css).not.toContain('.check-mark');
    expect(template?.css).not.toContain('.option-correct');
  });
});
