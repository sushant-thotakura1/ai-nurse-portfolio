/**
 * Per-conversation Arize session ID tracking.
 *
 * The WhatsApp MessageSession persists for 24 hours, meaning all messages
 * from one patient in that window share the same MessageSession.id. Using
 * that ID directly as the Arize session ID groups 22+ hours of unrelated
 * conversations into a single Arize session.
 *
 * This module maintains a separate in-memory UUID per conversation round,
 * keyed by MessageSession.id:
 *  - First message of a conversation → fresh UUID generated and stored.
 *  - Subsequent messages in the same round → existing UUID reused.
 *  - Session closed (EndCallFlow / session reaper) → UUID cleared so the
 *    next conversation round generates a new one.
 *
 * The map is in-memory and resets on server restart, which is acceptable —
 * a restart simply starts a new Arize session for subsequent messages.
 */

import { randomUUID } from 'crypto';

const conversationIds = new Map<string, string>();

/**
 * Get the Arize session ID for a conversation round.
 * Creates a new UUID on first call per MessageSession; reuses it thereafter.
 */
export function getArizeSessionId(messageSessionId: string): string {
  let id = conversationIds.get(messageSessionId);
  if (!id) {
    id = randomUUID();
    conversationIds.set(messageSessionId, id);
  }
  return id;
}

/**
 * Clear the Arize session ID for a MessageSession after the conversation
 * closes. The next inbound message will generate a fresh UUID, creating a
 * new Arize session for the next conversation round.
 */
export function clearArizeSessionId(messageSessionId: string): void {
  conversationIds.delete(messageSessionId);
}
