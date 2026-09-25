import { BotFlow, BotFlowResult } from './bot-flow.interface';
import { MessagingProvider } from '../interfaces';
import { LLMProvider } from '../../ai-agent/interfaces';
import { getTenantFeatures } from '../../core/tenant-features';
import { logger } from '../../core/logger';

const FLOW_NAME = 'set_language';

interface LangOption {
  localeCode: string;
  displayName: string;
}

/**
 * Patient-driven language selection. Triggered by phrase, gated on the tenant's
 * `language_selection` capability. On selection, persists the locale to BOTH
 * `patient.preferredLocale` (permanent, per-patient) and `session.locale`.
 *
 * Pure interjection — never touches MessageState, valid in any state.
 */
export class SetLanguageFlow implements BotFlow {
  readonly name = FLOW_NAME;
  readonly triggerPhrases = ['set my language', 'set language', 'change language'];

  isActive(session: any): boolean {
    return session?.flowState?.flow === FLOW_NAME;
  }

  async handle(
    session: any,
    message: string,
    patient: any,
    tenantId: string,
    prisma: any,
    adapter: MessagingProvider,
    _llm: LLMProvider,
  ): Promise<BotFlowResult> {
    const features = await getTenantFeatures(tenantId);
    if (!features.enabledCapabilities.includes('language_selection')) {
      // Clear any in-flight flow state so a patient who was mid-selection when
      // the capability was disabled is not soft-locked into this branch.
      if (session?.flowState?.flow === FLOW_NAME) {
        await prisma.messageSession.update({ where: { id: session.id }, data: { flowState: null } });
      }
      await this.sendText(session, adapter, "Language selection isn't available on this service.");
      return { handled: true, done: true };
    }

    const step: string | null = session?.flowState?.step ?? null;
    if (step === 'awaiting_selection') {
      return this.handleSelection(session, message.trim(), patient, prisma, adapter);
    }
    return this.showLanguageList(session, features.languageOptions, prisma, adapter);
  }

  // ── Step 1: present the interactive list ──────────────────────────────────

  private async showLanguageList(
    session: any,
    languageOptions: string[],
    prisma: any,
    adapter: MessagingProvider,
  ): Promise<BotFlowResult> {
    const options = await this.resolveOptions(prisma, languageOptions);

    if (options.length === 0) {
      logger.warn('SetLanguageFlow: no language options resolved');
      await prisma.messageSession.update({ where: { id: session.id }, data: { flowState: null } });
      await this.sendText(session, adapter, 'No languages are configured. Please contact your care team.');
      return { handled: true, done: true };
    }

    await prisma.messageSession.update({
      where: { id: session.id },
      data: { flowState: { flow: FLOW_NAME, step: 'awaiting_selection', options } },
    });

    await this.sendList(session, adapter, options);
    return { handled: true, done: false };
  }

  // ── Step 2: persist the selection ────────────────────────────────────────

  private async handleSelection(
    session: any,
    selectedLocale: string,
    patient: any,
    prisma: any,
    adapter: MessagingProvider,
  ): Promise<BotFlowResult> {
    const options: LangOption[] = session.flowState?.options ?? [];
    const selected = options.find((o) => o.localeCode === selectedLocale);

    if (!selected) {
      logger.info('SetLanguageFlow: invalid selection, re-showing list', { selectedLocale });
      await this.sendList(session, adapter, options);
      return { handled: true, done: false };
    }

    await prisma.messageSession.update({
      where: { id: session.id },
      data: { locale: selected.localeCode, flowState: null },
    });
    await prisma.patient.update({
      where: { id: patient.id },
      data: { preferredLocale: selected.localeCode },
    });

    logger.info('SetLanguageFlow: language set', { patientId: patient.id, locale: selected.localeCode });

    await this.sendText(session, adapter, `✓ Language set to ${selected.displayName}. Please continue.`);
    return { handled: true, done: true };
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  /** Active packs, intersected with the tenant's configured list (order preserved). */
  private async resolveOptions(prisma: any, languageOptions: string[]): Promise<LangOption[]> {
    const active: LangOption[] = await prisma.languagePack.findMany({
      where: { isActive: true },
      orderBy: { displayName: 'asc' },
      select: { localeCode: true, displayName: true },
    });

    if (languageOptions.length === 0) return active;

    const byCode = new Map(active.map((p) => [p.localeCode, p]));
    return languageOptions
      .map((code) => byCode.get(code))
      .filter((p): p is LangOption => Boolean(p));
  }

  private async sendList(session: any, adapter: MessagingProvider, options: LangOption[]): Promise<void> {
    await adapter.sendMessage({
      channel: session.channel,
      recipientId: session.senderId,
      content: [{
        type: 'interactive',
        interactive: {
          type: 'list',
          body: 'Please select your preferred language:',
          listButtonLabel: 'Select',
          sections: [{
            title: 'Available Languages',
            rows: options.map((o) => ({
              id: o.localeCode,
              title: o.displayName.length > 24 ? o.displayName.slice(0, 23) + '…' : o.displayName,
            })),
          }],
        },
      }],
    });
  }

  private async sendText(session: any, adapter: MessagingProvider, text: string): Promise<void> {
    await adapter.sendMessage({
      channel: session.channel,
      recipientId: session.senderId,
      content: [{ type: 'text', text }],
    });
  }
}
