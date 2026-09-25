import { decrypt } from '../core/encryption';
import { logger } from '../core/logger';
import { MessagingProvider } from './interfaces';
import { WhatsAppAdapter } from './adapters/whatsapp.adapter';
import { TelegramAdapter } from './adapters/telegram.adapter';

/**
 * Creates a MessagingProvider from stored DB credentials.
 * Returns null — never throws — so callers in batch operations (reaper)
 * can handle a missing/broken credential without aborting other tenants.
 */
export async function createAdapter(
  tenantId: string,
  channel: 'whatsapp' | 'telegram',
  prisma: any,
): Promise<MessagingProvider | null> {
  try {
    const record = await (prisma as any).providerConfig?.findFirst?.({
      where: { tenantId, providerType: 'messaging', providerName: channel },
    });

    if (!record) {
      logger.warn('AdapterFactory: no provider config found', { tenantId, channel });
      return null;
    }

    const encryptedConfig = (record.config as any)?.encrypted ?? '';
    const creds = JSON.parse(decrypt(encryptedConfig));

    if (channel === 'whatsapp') {
      return new WhatsAppAdapter(
        {
          phoneNumberId: creds.phoneNumberId,
          accessToken:   creds.accessToken,
          verifyToken:   creds.verifyToken,
        },
        creds.appSecret ?? '',
      );
    }

    if (channel === 'telegram') {
      return new TelegramAdapter({ botToken: creds.botToken, secretToken: creds.secretToken });
    }

    return null;
  } catch (err: any) {
    logger.warn('AdapterFactory: failed to create adapter', {
      tenantId,
      channel,
      error: err?.message,
    });
    return null;
  }
}
