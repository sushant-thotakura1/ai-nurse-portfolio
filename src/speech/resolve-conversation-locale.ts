/**
 * Decides which locale a messaging conversation runs in.
 *
 * When the tenant's `language_selection` capability is on AND the patient has
 * explicitly chosen a language (stored on `patient.preferredLocale`), that
 * choice PINS the conversation: STT is told the language, and TTS + the LLM
 * prompt + channel formatting all use it, ignoring STT-side detection.
 *
 * Otherwise this reproduces the legacy fallback chain exactly, so tenants
 * without the capability are unaffected.
 */
export interface ConversationLocaleInput {
  capabilityEnabled: boolean;
  patientPreferredLocale: string | null;
  sessionLocale: string | null;
  /** From the STT transcript; null before STT runs and for text-only messages. */
  detectedLocale: string | null;
}

export interface ConversationLocale {
  /** BCP-47, always non-empty. */
  locale: string;
  /** true → the patient's explicit choice; overrides STT detection everywhere. */
  pinned: boolean;
}

export function resolveConversationLocale(input: ConversationLocaleInput): ConversationLocale {
  if (input.capabilityEnabled && input.patientPreferredLocale) {
    return { locale: input.patientPreferredLocale, pinned: true };
  }
  return {
    locale:
      input.detectedLocale
      ?? input.sessionLocale
      ?? input.patientPreferredLocale
      ?? 'en-IN',
    pinned: false,
  };
}
