// tests/unit/core/normalize-phone.test.ts
import { normalizeToE164 } from '../../../src/core/normalize-phone';

describe('normalizeToE164', () => {
  it('leaves an already-E164 number unchanged', () => {
    expect(normalizeToE164('+919876543210')).toBe('+919876543210');
  });

  it('adds + prefix to a number missing it', () => {
    expect(normalizeToE164('919876543210')).toBe('+919876543210');
  });

  it('strips spaces', () => {
    expect(normalizeToE164('+91 98765 43210')).toBe('+919876543210');
  });

  it('strips dashes', () => {
    expect(normalizeToE164('+91-987-654-3210')).toBe('+919876543210');
  });

  it('strips parentheses', () => {
    expect(normalizeToE164('+1 (555) 123-4567')).toBe('+15551234567');
  });

  it('handles number with no country code prefix (10 digits — assumes +91)', () => {
    // 10-digit numbers without country code are treated as Indian numbers
    expect(normalizeToE164('9876543210')).toBe('+919876543210');
  });

  it('throws for clearly invalid input (letters)', () => {
    expect(() => normalizeToE164('not-a-phone')).toThrow();
  });
});
