import { languageDirective, localeDisplayName } from '../locale-language';

describe('languageDirective', () => {
  it('names the four Intron locales correctly (not the bare code)', () => {
    expect(localeDisplayName('ha-NG')).toBe('Hausa');
    expect(localeDisplayName('ig-NG')).toBe('Igbo');
    expect(localeDisplayName('sw-KE')).toBe('Swahili');
    expect(localeDisplayName('en-NG')).toBe('English');
  });

  it('keeps the existing Indian locales', () => {
    expect(localeDisplayName('hi-IN')).toBe('Hindi');
    expect(localeDisplayName('te-IN')).toBe('Telugu');
    expect(localeDisplayName('en-IN')).toBe('English');
  });

  it('carries a mix-nothing instruction for non-English languages', () => {
    expect(languageDirective('ha-NG').instruction).toMatch(/ONLY in Hausa/);
    expect(languageDirective('sw-KE').instruction).toMatch(/ONLY in Swahili/);
  });

  it('falls back to English for unknown or missing locales', () => {
    expect(localeDisplayName('fr-FR')).toBe('English');
    expect(localeDisplayName(null)).toBe('English');
    expect(localeDisplayName(undefined)).toBe('English');
    expect(localeDisplayName('')).toBe('English');
    expect(languageDirective('zz-ZZ')).toEqual(languageDirective('en-US'));
  });

  it('every directive has all three fields populated', () => {
    for (const loc of ['hi-IN', 'te-IN', 'ha-NG', 'ig-NG', 'sw-KE', 'en-NG', 'en-IN']) {
      const d = languageDirective(loc);
      expect(d.name.length).toBeGreaterThan(0);
      expect(d.instruction.length).toBeGreaterThan(0);
      expect(d.example.length).toBeGreaterThan(0);
    }
  });
});
