import { resolveConversationLocale } from '../resolve-conversation-locale';

const base = {
  capabilityEnabled: false,
  patientPreferredLocale: null as string | null,
  sessionLocale: null as string | null,
  detectedLocale: null as string | null,
};

describe('resolveConversationLocale', () => {
  it('pins to patientPreferredLocale when the capability is on and a locale is set', () => {
    expect(resolveConversationLocale({
      ...base, capabilityEnabled: true, patientPreferredLocale: 'sw-KE', detectedLocale: 'en-NG',
    })).toEqual({ locale: 'sw-KE', pinned: true });
  });

  it('does NOT pin when the capability is on but no preferred locale is set', () => {
    expect(resolveConversationLocale({
      ...base, capabilityEnabled: true, detectedLocale: 'ha-NG',
    })).toEqual({ locale: 'ha-NG', pinned: false });
  });

  it('does NOT pin when the capability is off, even with a preferred locale', () => {
    expect(resolveConversationLocale({
      ...base, capabilityEnabled: false, patientPreferredLocale: 'sw-KE', detectedLocale: 'en-NG',
    })).toEqual({ locale: 'en-NG', pinned: false });
  });

  it('falls back through detected → session → preferred → en-IN', () => {
    expect(resolveConversationLocale({ ...base, detectedLocale: 'ta-IN', sessionLocale: 'hi-IN', patientPreferredLocale: 'kn-IN' }).locale).toBe('ta-IN');
    expect(resolveConversationLocale({ ...base, sessionLocale: 'hi-IN', patientPreferredLocale: 'kn-IN' }).locale).toBe('hi-IN');
    expect(resolveConversationLocale({ ...base, patientPreferredLocale: 'kn-IN' }).locale).toBe('kn-IN');
    expect(resolveConversationLocale({ ...base }).locale).toBe('en-IN');
  });
});
