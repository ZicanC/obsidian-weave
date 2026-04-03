import { get } from 'svelte/store';

import { i18n, trArray } from '../i18n';

describe('i18n runtime fallbacks', () => {
  beforeEach(() => {
    i18n.setLanguage('en-US');
  });

  it('prefers concrete translations for high-value keys', () => {
    expect(i18n.t('about.license.activation.activateLicense')).toBe('Activate license');
    expect(i18n.t('toolbar.aiAssistant')).toBe('AI Assistant');
    expect(i18n.t('study.view.title')).toBe('Study');
    expect(i18n.t('ankiConnect.connection.testingButton')).toBe('Testing...');
  });

  it('humanizes unresolved keys instead of exposing raw key paths', () => {
    expect(i18n.t('runtimeFallback.avgTime')).toBe('Avg Time');
    expect(i18n.t('runtimeFallback.openMenu')).toBe('Open Menu');
  });

  it('keeps list translations empty when no real translation exists', () => {
    const toArray = get(trArray);
    expect(toArray('runtimeFallback.avgTime')).toEqual([]);
  });
});
