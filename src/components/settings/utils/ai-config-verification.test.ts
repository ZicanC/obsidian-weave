import {
  buildAIProviderVerificationFingerprint,
  buildAIProviderVerificationFingerprintMap,
  invalidateAIProviderVerification
} from './ai-config-verification';

describe('ai-config-verification', () => {
  it('builds the same fingerprint for equivalent trimmed values', () => {
    const left = buildAIProviderVerificationFingerprint({
      apiKey: ' sk-123 ',
      model: ' deepseek-chat ',
      baseUrl: ' https://api.deepseek.com '
    });
    const right = buildAIProviderVerificationFingerprint({
      apiKey: 'sk-123',
      model: 'deepseek-chat',
      baseUrl: 'https://api.deepseek.com'
    });

    expect(left).toBe(right);
  });

  it('invalidates verified state and clears lastVerified', () => {
    const config = {
      apiKey: 'sk-123',
      model: 'gpt-5-mini',
      verified: true,
      lastVerified: '2026-03-26T00:00:00.000Z'
    };

    const changed = invalidateAIProviderVerification(config);

    expect(changed).toBe(true);
    expect(config.verified).toBe(false);
    expect(config.lastVerified).toBeUndefined();
  });

  it('builds a fingerprint map for all providers', () => {
    const fingerprints = buildAIProviderVerificationFingerprintMap(
      ['openai', 'deepseek'],
      {
        openai: { apiKey: 'sk-openai', model: 'gpt-5-mini' },
        deepseek: { apiKey: 'sk-deepseek', model: 'deepseek-chat' }
      }
    );

    expect(fingerprints.openai).toContain('sk-openai');
    expect(fingerprints.deepseek).toContain('deepseek-chat');
  });
});
