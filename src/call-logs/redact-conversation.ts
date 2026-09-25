/**
 * Strips patient-identifying fields from a conversation export row before
 * it's written to a local file. Deliberately a pure function, not something
 * an LLM redacts ad hoc -- redaction of PHI needs to be reliable every time,
 * not a best-effort per-invocation judgment call.
 *
 * Redacts by known field name (patient.name, patient.phoneNumber) on today's
 * export shape (see src/call-logs/service.ts's getExportBundle). If the
 * export response shape gains a new PHI-bearing field later, this will not
 * catch it automatically -- it redacts named fields, not "whatever looks
 * like PHI."
 */
export interface RedactablePatient {
  name?: string | null;
  phoneNumber?: string | null;
  [key: string]: unknown;
}

export interface RedactableConversation {
  patient?: RedactablePatient | null;
  [key: string]: unknown;
}

const REDACTED = '[REDACTED]';

export function redactConversation(conversation: RedactableConversation): RedactableConversation {
  if (!conversation.patient) {
    return conversation;
  }

  return {
    ...conversation,
    patient: {
      ...conversation.patient,
      name: REDACTED,
      phoneNumber: REDACTED,
    },
  };
}
