import { INTRON_LOCALES, intronLocale } from '../intron-locales';

describe('INTRON_LOCALES', () => {
  it('maps the four supported locales to the documented Intron strings', () => {
    expect(INTRON_LOCALES['ha-NG']).toEqual({
      displayName: 'Hausa', sttCode: 'ha', ttsLanguage: 'ha', ttsAccent: 'hausa',
    });
    expect(INTRON_LOCALES['ig-NG']).toEqual({
      displayName: 'Igbo', sttCode: 'ig', ttsLanguage: 'ig', ttsAccent: 'igbo',
    });
    expect(INTRON_LOCALES['sw-KE']).toEqual({
      displayName: 'Swahili', sttCode: 'sw', ttsLanguage: 'sw', ttsAccent: 'swahili',
    });
    expect(INTRON_LOCALES['en-NG']).toEqual({
      displayName: 'English (Nigerian accent)', sttCode: 'en', ttsLanguage: 'en', ttsAccent: 'yoruba',
    });
  });
});

describe('intronLocale', () => {
  it('returns the entry for a known BCP-47 locale', () => {
    expect(intronLocale('sw-KE')?.sttCode).toBe('sw');
  });

  it('returns null for an unknown locale', () => {
    expect(intronLocale('fr-FR')).toBeNull();
  });

  it('returns null for null / undefined / empty', () => {
    expect(intronLocale(null)).toBeNull();
    expect(intronLocale(undefined)).toBeNull();
    expect(intronLocale('')).toBeNull();
  });
});
