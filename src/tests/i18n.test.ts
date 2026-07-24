import { afterEach, describe, expect, it } from 'vitest';
import {
  APP_LOCALE_STORAGE_KEY,
  detectInitialLocale,
  getLocale,
  setLocale,
  t
} from '../app/i18n';
import { localizedPresetDescription, localizedPresetName } from '../app/presetLocalization';
import { labPresets } from '../simulation/presets';

describe('app localization', () => {
  afterEach(() => {
    setLocale('en', false);
  });

  it('prefers a stored language over the browser language', () => {
    expect(detectInitialLocale('en', 'ja-JP')).toBe('en');
    expect(detectInitialLocale('ja', 'en-US')).toBe('ja');
  });

  it('uses Japanese only for Japanese browser locales when no preference exists', () => {
    expect(detectInitialLocale(null, 'ja-JP')).toBe('ja');
    expect(detectInitialLocale(null, 'en-US')).toBe('en');
    expect(detectInitialLocale(null, undefined)).toBe('en');
  });

  it('switches the active message dictionary', () => {
    setLocale('ja', false);
    expect(getLocale()).toBe('ja');
    expect(t('run')).toBe('実行');

    setLocale('en', false);
    expect(t('run')).toBe('Run');
  });

  it('uses a stable storage key', () => {
    expect(APP_LOCALE_STORAGE_KEY).toBe('phase-field-dendrite-lab.locale');
  });

  it('provides Japanese names and descriptions for every public paper preset', () => {
    setLocale('ja', false);
    for (const preset of labPresets) {
      expect(localizedPresetName(preset), preset.id).not.toBe(preset.name);
      expect(localizedPresetDescription(preset), preset.id).not.toBe(preset.description);
      expect(localizedPresetDescription(preset), preset.id).not.toHaveLength(0);
    }
  });
});
