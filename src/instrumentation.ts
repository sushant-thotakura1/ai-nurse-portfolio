/**
 * Arize AX / OpenTelemetry tracing initialisation.
 *
 * This module MUST be loaded before the OpenAI SDK is imported so that
 * `manuallyInstrument` can patch the OpenAI client prototype in time.
 * It is loaded from `src/index.ts` using require() AFTER dotenv.config()
 * has populated process.env.
 *
 * If ARIZE_SPACE_ID or ARIZE_API_KEY are absent the module is a no-op,
 * so the server starts normally in environments where tracing is not configured.
 */

import { AsyncLocalStorage } from 'async_hooks';
import { NodeTracerProvider, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-node';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { trace, SpanStatusCode } from '@opentelemetry/api';
import OpenAI from 'openai';
import { OpenAIInstrumentation } from '@arizeai/openinference-instrumentation-openai';
import { logger } from './core/logger';

// ── Utilities ────────────────────────────────────────────────────────────────

/**
 * Returns a masked identifier suitable for Arize span attributes.
 * Keeps the last 4 digits of a phone number so conversations can be
 * filtered by patient without exposing PII in the observability platform.
 * e.g. "+919876543210" → "***3210"
 */
export function maskPhone(phone: string): string {
  if (!phone || phone.length < 4) return '***';
  return `***${phone.slice(-4)}`;
}

// ── Session propagation ──────────────────────────────────────────────────────
//
// Two independent stores with two independent responsibilities:
//
//  sessionStore   — carries session.id as a plain string.
//                   This is the ORIGINAL approach that Arize confirmed works
//                   for session grouping. Never changed.
//
//  attributeStore — carries patient metadata (condition, classification,
//                   phase, channel, masked.pid). A separate store means
//                   session.id propagation is never affected by attribute
//                   changes, eliminating the grouping breakage we saw when
//                   both were combined in a single richer object.

/** Plain-string store for session.id — original working approach. */
const sessionStore = new AsyncLocalStorage<string>();

/** Patient-attribute store for per-span metadata propagation. */
const attributeStore = new AsyncLocalStorage<Record<string, string | number | boolean>>();

/**
 * Set (or update) the request-level session context.
 *
 * Call once at request entry with just sessionId so every span in the
 * request gets session.id from that point forward.
 *
 * Call again after patient / clinical-context data is available to add
 * patient attributes — covers spans outside ConversationTracer.traceOperation
 * (formatForChannel, bot flows, session-closing extraction).
 */
export function enterSessionContext(
  sessionId: string,
  attributes: Record<string, string | number | boolean> = {},
): void {
  sessionStore.enterWith(sessionId);
  attributeStore.enterWith(attributes);
}

/**
 * Stamps session.id and patient attributes on every span while a session
 * context is active — including auto-instrumented OpenAI child spans.
 *
 * Two separate reads, two separate responsibilities. session.id is always
 * set from sessionStore regardless of what attributeStore contains.
 */
class SessionIdSpanProcessor {
  onStart(span: any): void {
    // session.id — plain string store, original working approach
    const sessionId = sessionStore.getStore();
    if (sessionId) span.setAttribute('session.id', sessionId);

    // patient attributes — separate store, does not affect session grouping
    const attrs = attributeStore.getStore();
    if (attrs) {
      for (const [key, value] of Object.entries(attrs)) {
        span.setAttribute(key, value);
      }
    }
  }
  onEnd(): void {}
  shutdown(): Promise<void> { return Promise.resolve(); }
  forceFlush(): Promise<void> { return Promise.resolve(); }
}

// ── Named-span wrapper ───────────────────────────────────────────────────────

/**
 * Wraps an LLM operation in a named parent span so Arize evaluators can
 * target specific operation types (ai_nurse.greeting, ai_nurse.turn, etc.).
 *
 * Propagation:
 * 1. Parent span — session.id and all metadata set explicitly.
 * 2. attributeStore.run(metadata, fn) — patient attributes are active for
 *    the duration of fn() so SpanProcessor stamps them on every
 *    auto-instrumented child span (e.g. openai.chat from OpenAIInstrumentation).
 *    sessionStore already covers the full request via enterSessionContext,
 *    so session.id propagates to child spans without an extra run() call.
 */
export class ConversationTracer {
  private tracer = trace.getTracer('ai-nurse-conversation');

  async traceOperation<T>(
    operationName: string,
    sessionId: string,
    metadata: Record<string, string | number | boolean>,
    fn: () => Promise<T>,
  ): Promise<T> {
    return this.tracer.startActiveSpan(operationName, async (span) => {
      try {
        // 1. Stamp parent span explicitly.
        span.setAttribute('session.id', sessionId);
        for (const [key, value] of Object.entries(metadata)) {
          span.setAttribute(key, value);
        }

        // 2. Run fn() with metadata in attributeStore so SpanProcessor
        //    stamps patient attributes on every auto-instrumented child span.
        const result = await attributeStore.run(metadata, fn);

        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (err: any) {
        span.recordException(err);
        span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
        throw err;
      } finally {
        span.end();
      }
    });
  }
}

const spaceId     = process.env.ARIZE_SPACE_ID;
const apiKey      = process.env.ARIZE_API_KEY;
const projectName = process.env.ARIZE_PROJECT_NAME ?? 'ai-nurse-poc';
const endpoint    = 'https://otlp.arize.com/v1/traces';

// Always log the resolved config so deployment issues are immediately visible
logger.info('Arize tracing config', {
  ARIZE_SPACE_ID:     spaceId  ? `${spaceId.slice(0, 6)}…`  : '(not set)',
  ARIZE_API_KEY:      apiKey   ? `${apiKey.slice(0, 8)}…`   : '(not set)',
  ARIZE_PROJECT_NAME: projectName,
  endpoint,
});

if (!spaceId || !apiKey) {
  logger.warn('Arize tracing DISABLED — ARIZE_SPACE_ID and/or ARIZE_API_KEY are missing');
} else {
  try {
    const provider = new NodeTracerProvider({
      resource: resourceFromAttributes({
        'openinference.project.name': projectName,
      }),
      spanProcessors: [
        new SimpleSpanProcessor(
          new OTLPTraceExporter({
            url: endpoint,
            headers: {
              space_id: spaceId,
              api_key:  apiKey,
            },
          }),
        ),
        new SessionIdSpanProcessor(),
      ],
    });

    const instrumentation = new OpenAIInstrumentation();
    instrumentation.manuallyInstrument(OpenAI);
    registerInstrumentations({ instrumentations: [instrumentation] });
    provider.register();

    logger.info('Arize tracing ENABLED', { project: projectName, endpoint });
  } catch (err: any) {
    logger.error('Arize tracing failed to initialise', { error: err.message });
  }
}
