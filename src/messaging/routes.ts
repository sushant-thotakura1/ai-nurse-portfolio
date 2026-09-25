import { Router, Request, Response, NextFunction } from 'express';
import NodeCache from 'node-cache';
import { prisma, systemPrisma } from '../core/database';
import { decrypt } from '../core/encryption';
import { logger } from '../core/logger';
import { WhatsAppAdapter } from './adapters/whatsapp.adapter';
import { TelegramAdapter } from './adapters/telegram.adapter';
import { MessagingOrchestrator } from './messaging-orchestrator';
import { config } from '../core/config';
import { OpenAIAdapter } from '../ai-agent/adapters/openai.adapter';

// ── Inbound message deduplication ────────────────────────────────────────────
//
// Meta may deliver the same webhook more than once (retry on network failure or
// timeout).  Without an appSecret configured, HMAC verification is skipped, so
// there is no cryptographic guard against replays.  We therefore track the
// WhatsApp message-ID (wamid) of every successfully processed inbound message
// in a short-lived in-memory cache.  If the same wamid arrives again within the
// TTL window the event is silently dropped — the 200 was already sent on the
// first delivery, so Meta will not retry again.
//
// TTL: 5 minutes — well beyond Meta's retry window (~20 s with 3 retries).

const processedWamids = new NodeCache({ stdTTL: 300, checkperiod: 60 });

// ── Credential helpers ────────────────────────────────────────────────────────
//
// These functions use `systemPrisma` (no tenant middleware) so the tenantId
// in the WHERE clause is the single, authoritative filter.  Using the
// tenant-middleware `prisma` here risks a cross-tenant credential leak: if the
// AsyncLocalStorage store holds a stale or incorrect tenant context when the
// Prisma middleware reads it, the AND-injected tenantId could conflict with the
// explicit one and cause the query to return no record — or, in rare concurrent
// edge cases, return credentials belonging to a different tenant.

async function getWhatsAppCredentials(tenantId: string) {
  const record = await systemPrisma.providerConfig.findFirst({
    where: { tenantId, providerName: 'whatsapp', isActive: true },
  });
  if (!record) {
    throw new Error(`No active WhatsApp configuration found for tenant`);
  }
  return JSON.parse(decrypt((record.config as any).encrypted)) as {
    phoneNumberId: string; accessToken: string; verifyToken: string; appSecret: string;
  };
}

async function getTelegramCredentials(tenantId: string) {
  const record = await systemPrisma.providerConfig.findFirst({
    where: { tenantId, providerName: 'telegram', isActive: true },
  });
  if (!record) {
    throw new Error(`No active Telegram configuration found for tenant`);
  }
  return JSON.parse(decrypt((record.config as any).encrypted)) as {
    botToken: string; secretToken: string;
  };
}

// ── LLM provider ──────────────────────────────────────────────────────────────

function getLLMProvider(): OpenAIAdapter {
  return new OpenAIAdapter({ apiKey: config.providers.openai.apiKey });
}

// ── WhatsApp phone-number-ID guard ────────────────────────────────────────────
//
// Meta fans out every webhook event to ALL registered endpoint URLs, so each
// tenant's endpoint receives messages intended for every other tenant that shares
// the same Meta App.  This middleware compares the `phone_number_id` embedded in
// the Meta payload with the one stored in the DB for this tenant.  If they don't
// match we respond 200 immediately (so Meta doesn't retry) and skip processing.
//
// Credentials are also stashed on `req.whatsAppCredentials` so the route handler
// can reuse them without a second DB round-trip.

async function whatsAppPhoneGuard(req: Request, res: Response, next: NextFunction): Promise<void> {
  const tenantId: string = (req as any).tenantContext?.tenantId ?? req.params.tenantId;

  let creds: { phoneNumberId: string; accessToken: string; verifyToken: string; appSecret: string };
  try {
    creds = await getWhatsAppCredentials(tenantId);
  } catch (err: any) {
    // No credentials configured for this tenant — nothing to process.
    logger.warn('WhatsApp phone guard: no credentials for tenant, skipping', { tenantId });
    res.status(200).json({ status: 'ok' });
    return;
  }

  // Stash credentials so the route handler does not need to fetch them again.
  (req as any).whatsAppCredentials = creds;

  // phone_number_id is present only on message/status events, not on challenge GETs.
  const payloadPhoneNumberId: string | undefined =
    (req.body as any)?.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id;

  // Determine whether this is an inbound message event.
  const hasInboundMessage: boolean =
    !!(req.body as any)?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

  if (hasInboundMessage) {
    // For message events, phone_number_id MUST be present and match this tenant's
    // configured ID.  An absent phone_number_id means we cannot determine ownership;
    // blocking here (fail-closed) prevents cross-tenant response leakage when multiple
    // tenant endpoints share the same Meta App.
    if (!payloadPhoneNumberId || payloadPhoneNumberId !== creds.phoneNumberId) {
      const reason = !payloadPhoneNumberId
        ? 'missing phone_number_id in payload metadata'
        : 'phone_number_id mismatch (cross-tenant delivery)';
      logger.info(`WhatsApp phone guard: ${reason} — ignoring`, {
        tenantId,
        payloadPhoneNumberId: payloadPhoneNumberId ?? '(absent)',
      });
      res.status(200).json({ status: 'ok' });
      return;
    }
  } else if (payloadPhoneNumberId && payloadPhoneNumberId !== creds.phoneNumberId) {
    // For non-message events (e.g. status updates): still block mismatched phone IDs.
    logger.info('WhatsApp phone guard: phone_number_id mismatch (non-message event) — ignoring', {
      tenantId,
      payloadPhoneNumberId,
    });
    res.status(200).json({ status: 'ok' });
    return;
  }

  next();
}

// ── Feedback intercept ────────────────────────────────────────────────────────

export async function tryHandleFeedback(
  contextMessageId: string,
  senderText: string,
  senderId: string,
  tenantId: string,
  adapter: { sendMessage: (msg: any) => Promise<any> },
  prisma: any,
): Promise<boolean> {
  const callSession = await prisma.callSession.findFirst({
    where: { summaryWamid: contextMessageId, tenantId },
  });

  if (!callSession) return false;

  if (!callSession.feedbackText) {
    try {
      await prisma.callSession.update({
        where: { id: callSession.id },
        data:  { feedbackText: senderText },
      });
    } catch (err: any) {
      logger.error('WhatsApp feedback: failed to store feedback text', {
        tenantId, sessionId: callSession.id, error: err.message,
      });
    }
    try {
      await adapter.sendMessage({
        channel:     'whatsapp',
        recipientId: senderId,
        content:     [{ type: 'text', text: 'Thank you for your feedback!' }],
      });
    } catch (err: any) {
      logger.error('WhatsApp feedback: failed to send thank-you', {
        tenantId, error: err.message,
      });
    }
  }

  return true;
}

// ── WhatsApp routes ───────────────────────────────────────────────────────────

export function whatsappRoutes(): Router {
  const router = Router();

  // Meta webhook verification challenge — validates hub.verify_token before echoing challenge
  router.get('/', async (req: Request, res: Response) => {
    const tenantId: string = (req as any).tenantContext?.tenantId ?? req.params.tenantId;
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode !== 'subscribe' || !challenge) {
      return res.status(400).json({ error: 'Missing required query params' });
    }

    try {
      const creds = await getWhatsAppCredentials(tenantId);
      if (token !== creds.verifyToken) {
        logger.warn('WhatsApp verify_token mismatch', { tenantId });
        return res.status(403).json({ error: 'Forbidden' });
      }
      return res.status(200).send(String(challenge));
    } catch (err: any) {
      logger.error('WhatsApp verification challenge error', { tenantId, error: err.message });
      return res.status(500).json({ error: 'Internal error' });
    }
  });

  // Inbound messages
  router.post('/', whatsAppPhoneGuard, async (req: Request, res: Response) => {
    const tenantId: string = (req as any).tenantContext?.tenantId ?? req.params.tenantId;

    try {
      // Credentials were already fetched (and phone_number_id validated) by whatsAppPhoneGuard.
      const creds = (req as any).whatsAppCredentials as { phoneNumberId: string; accessToken: string; verifyToken: string; appSecret: string };
      const adapter = new WhatsAppAdapter(
        { phoneNumberId: creds.phoneNumberId, accessToken: creds.accessToken, verifyToken: creds.verifyToken },
        creds.appSecret,
      );

      if (!adapter.verifyWebhook(req)) {
        logger.warn('WhatsApp webhook signature invalid', { tenantId });
        return res.status(401).json({ error: 'Unauthorized' });
      }

      // Respond 200 after signature check — Meta marks delivery successful
      res.status(200).json({ status: 'ok' });

      // Deduplicate by wamid — Meta retries if it suspects non-delivery, so the
      // same message-ID can arrive more than once.  Drop silently if already seen.
      const wamid: string | undefined =
        (req.body as any)?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.id;
      if (wamid) {
        if (processedWamids.has(wamid)) {
          logger.warn('WhatsApp duplicate webhook delivery — already processed, skipping', {
            wamid,
            tenantId,
          });
          return;
        }
        processedWamids.set(wamid, true);
      }

      const inbound = await adapter.parseWebhook(req.body, tenantId, prisma as any);
      if (!inbound) return; // status update or unsupported message type

      if (inbound.contextMessageId) {
        const handled = await tryHandleFeedback(
          inbound.contextMessageId,
          inbound.text,
          inbound.senderId,
          tenantId,
          adapter,
          prisma as any,
        );
        if (handled) return;
      }

      const orchestrator = new MessagingOrchestrator(adapter, getLLMProvider(), prisma as any);
      await orchestrator.handleInbound(inbound, tenantId);
    } catch (err: any) {
      logger.error('WhatsApp webhook handler error', { tenantId, error: err.message });
    }
  });

  return router;
}

// ── Telegram routes ───────────────────────────────────────────────────────────

export function telegramRoutes(): Router {
  const router = Router();

  router.post('/', async (req: Request, res: Response) => {
    const tenantId: string = (req as any).tenantContext?.tenantId ?? req.params.tenantId;

    try {
      const creds = await getTelegramCredentials(tenantId);
      const adapter = new TelegramAdapter(creds);

      if (!adapter.verifyWebhook(req)) {
        logger.warn('Telegram webhook secret token invalid', { tenantId });
        return res.status(401).json({ error: 'Unauthorized' });
      }

      res.status(200).json({ status: 'ok' });

      const inbound = await adapter.parseWebhook(req.body, tenantId, prisma as any);
      if (!inbound) return;

      const orchestrator = new MessagingOrchestrator(adapter, getLLMProvider(), prisma as any);
      await orchestrator.handleInbound(inbound, tenantId);
    } catch (err: any) {
      logger.error('Telegram webhook handler error', { tenantId, error: err.message });
    }
  });

  return router;
}
