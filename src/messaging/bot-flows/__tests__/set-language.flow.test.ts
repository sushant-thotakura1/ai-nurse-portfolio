import { SetLanguageFlow } from '../set-language.flow';

jest.mock('../../../core/tenant-features', () => ({ getTenantFeatures: jest.fn() }));
jest.mock('../../../core/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn() } }));
import { getTenantFeatures } from '../../../core/tenant-features';
const mockFeatures = getTenantFeatures as jest.Mock;

function makeAdapter() {
  return { sendMessage: jest.fn().mockResolvedValue('wamid-1') } as any;
}

function makePrisma(activePacks: Array<{ localeCode: string; displayName: string }>) {
  return {
    languagePack: { findMany: jest.fn().mockResolvedValue(activePacks) },
    messageSession: { update: jest.fn().mockResolvedValue({}) },
    patient: { update: jest.fn().mockResolvedValue({}) },
  };
}

const session = { id: 'sess-1', channel: 'whatsapp', senderId: '+234800', flowState: null as any };
const patient = { id: 'pat-1' };
const llm = {} as any;

const ALL_PACKS = [
  { localeCode: 'en-NG', displayName: 'English (Nigerian accent)' },
  { localeCode: 'ha-NG', displayName: 'Hausa' },
  { localeCode: 'sw-KE', displayName: 'Swahili' },
];

describe('SetLanguageFlow', () => {
  let flow: SetLanguageFlow;
  beforeEach(() => {
    jest.clearAllMocks();
    flow = new SetLanguageFlow();
  });

  it('has trigger phrases', () => {
    expect(flow.triggerPhrases).toContain('set my language');
  });

  it('replies "not available" and does nothing when the capability is off', async () => {
    mockFeatures.mockResolvedValue({ enabledCapabilities: [], languageOptions: [] });
    const adapter = makeAdapter();
    const prisma = makePrisma(ALL_PACKS);

    const res = await flow.handle({ ...session }, 'set my language', patient, 't-1', prisma, adapter, llm);

    expect(res).toEqual({ handled: true, done: true });
    expect(adapter.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        content: [{ type: 'text', text: expect.stringMatching(/isn't available/i) }],
      }),
    );
    expect(prisma.languagePack.findMany).not.toHaveBeenCalled();
  });

  it('clears in-flight flowState when the capability is off and the flow was active', async () => {
    mockFeatures.mockResolvedValue({ enabledCapabilities: [], languageOptions: [] });
    const adapter = makeAdapter();
    const prisma = makePrisma(ALL_PACKS);
    const activeSession = {
      ...session,
      flowState: { flow: 'set_language', step: 'awaiting_selection', options: [] },
    };

    await flow.handle(activeSession, 'sw-KE', patient, 't-1', prisma, adapter, llm);

    expect(prisma.messageSession.update).toHaveBeenCalledWith({
      where: { id: 'sess-1' }, data: { flowState: null },
    });
  });

  it('shows only the configured languageOptions, in configured order', async () => {
    mockFeatures.mockResolvedValue({
      enabledCapabilities: ['language_selection'],
      languageOptions: ['sw-KE', 'ha-NG'],
    });
    const adapter = makeAdapter();
    const prisma = makePrisma(ALL_PACKS);

    await flow.handle({ ...session }, 'set my language', patient, 't-1', prisma, adapter, llm);

    const sent = adapter.sendMessage.mock.calls[0][0];
    const rows = sent.content[0].interactive.sections[0].rows;
    expect(rows.map((r: any) => r.id)).toEqual(['sw-KE', 'ha-NG']);
    expect(prisma.messageSession.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { flowState: { flow: 'set_language', step: 'awaiting_selection', options: [
          { localeCode: 'sw-KE', displayName: 'Swahili' },
          { localeCode: 'ha-NG', displayName: 'Hausa' },
        ] } },
      }),
    );
  });

  it('shows all active packs when languageOptions is empty', async () => {
    mockFeatures.mockResolvedValue({ enabledCapabilities: ['language_selection'], languageOptions: [] });
    const adapter = makeAdapter();
    const prisma = makePrisma(ALL_PACKS);

    await flow.handle({ ...session }, 'set my language', patient, 't-1', prisma, adapter, llm);

    const rows = adapter.sendMessage.mock.calls[0][0].content[0].interactive.sections[0].rows;
    expect(rows.map((r: any) => r.id)).toEqual(['en-NG', 'ha-NG', 'sw-KE']);
  });

  it('replies "no languages configured" when nothing resolves', async () => {
    mockFeatures.mockResolvedValue({ enabledCapabilities: ['language_selection'], languageOptions: [] });
    const adapter = makeAdapter();
    const prisma = makePrisma([]);

    const res = await flow.handle({ ...session }, 'set my language', patient, 't-1', prisma, adapter, llm);

    expect(res).toEqual({ handled: true, done: true });
    expect(adapter.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ content: [{ type: 'text', text: expect.stringMatching(/no languages/i) }] }),
    );
  });

  it('persists a valid selection to patient + session and confirms', async () => {
    mockFeatures.mockResolvedValue({ enabledCapabilities: ['language_selection'], languageOptions: [] });
    const adapter = makeAdapter();
    const prisma = makePrisma(ALL_PACKS);
    const activeSession = {
      ...session,
      flowState: { flow: 'set_language', step: 'awaiting_selection', options: [
        { localeCode: 'sw-KE', displayName: 'Swahili' },
      ] },
    };

    const res = await flow.handle(activeSession, 'sw-KE', patient, 't-1', prisma, adapter, llm);

    expect(prisma.patient.update).toHaveBeenCalledWith({ where: { id: 'pat-1' }, data: { preferredLocale: 'sw-KE' } });
    expect(prisma.messageSession.update).toHaveBeenCalledWith({
      where: { id: 'sess-1' }, data: { locale: 'sw-KE', flowState: null },
    });
    expect(adapter.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ content: [{ type: 'text', text: expect.stringContaining('Swahili') }] }),
    );
    expect(res).toEqual({ handled: true, done: true });
  });

  it('re-shows the list on an invalid selection without writing', async () => {
    mockFeatures.mockResolvedValue({ enabledCapabilities: ['language_selection'], languageOptions: [] });
    const adapter = makeAdapter();
    const prisma = makePrisma(ALL_PACKS);
    const activeSession = {
      ...session,
      flowState: { flow: 'set_language', step: 'awaiting_selection', options: [
        { localeCode: 'sw-KE', displayName: 'Swahili' },
      ] },
    };

    const res = await flow.handle(activeSession, 'zz-ZZ', patient, 't-1', prisma, adapter, llm);

    expect(prisma.patient.update).not.toHaveBeenCalled();
    expect(res).toEqual({ handled: true, done: false });
    expect(adapter.sendMessage.mock.calls[0][0].content[0].interactive.type).toBe('list');
  });

  it('isActive is true only when flowState.flow matches', () => {
    expect(flow.isActive({ flowState: { flow: 'set_language' } })).toBe(true);
    expect(flow.isActive({ flowState: { flow: 'other' } })).toBe(false);
    expect(flow.isActive({ flowState: null })).toBe(false);
  });
});
