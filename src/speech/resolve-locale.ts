import { logger } from '../core/logger';

/**
 * Resolves the best available TTS locale for a patient.
 *
 * Priority: detectedLocale (if active pack) → fallbackLocale (if active pack) → 'en-IN'
 *
 * LanguagePack is tenant-global — no tenantId filter needed.
 */
export async function resolveLocaleForTts(
  prisma: any,
  detectedLocale: string | null | undefined,
  fallbackLocale?: string | null,
): Promise<string> {
  const candidates = [detectedLocale, fallbackLocale].filter(Boolean) as string[];

  for (const locale of candidates) {
    const pack = await prisma.languagePack.findFirst({
      where: { localeCode: locale, isActive: true },
    });
    if (pack) {
      if (locale !== detectedLocale) {
        logger.warn('resolveLocaleForTts: detected locale has no active pack, using fallback', {
          detectedLocale,
          usingLocale: locale,
        });
      }
      return locale;
    }
  }

  logger.warn('resolveLocaleForTts: no active pack found for any candidate locale, using last resort', {
    detectedLocale,
    fallbackLocale,
    lastResort: 'en-IN',
  });
  return 'en-IN';
}
