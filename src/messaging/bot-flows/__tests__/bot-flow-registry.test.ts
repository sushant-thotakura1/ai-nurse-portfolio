import { BotFlowRegistry } from '../bot-flow-registry';
import { BotFlow, BotFlowResult } from '../bot-flow.interface';

function makeFlow(overrides: Partial<BotFlow> = {}): BotFlow {
  return {
    name: 'test-flow',
    triggerPhrases: ['end session', 'bye', 'stop'],
    isActive: () => false,
    handle: jest.fn(async (): Promise<BotFlowResult> => ({ handled: true, done: true })),
    ...overrides,
  };
}

describe('BotFlowRegistry', () => {
  describe('shouldHandle', () => {
    it('matches a trigger phrase exactly', () => {
      const registry = new BotFlowRegistry();
      registry.register(makeFlow());

      expect(registry.shouldHandle({}, 'end session')).toBe(true);
    });

    it('matches a trigger phrase with trailing punctuation (the reported bug)', () => {
      const registry = new BotFlowRegistry();
      registry.register(makeFlow());

      expect(registry.shouldHandle({}, 'End session.')).toBe(true);
      expect(registry.shouldHandle({}, 'bye!')).toBe(true);
      expect(registry.shouldHandle({}, 'Stop.')).toBe(true);
    });

    it('does not match unrelated text', () => {
      const registry = new BotFlowRegistry();
      registry.register(makeFlow());

      expect(registry.shouldHandle({}, 'I have redness in my eye')).toBe(false);
    });
  });

  describe('handle', () => {
    it('dispatches to the matching flow when the message has trailing punctuation', async () => {
      const flow = makeFlow();
      const registry = new BotFlowRegistry();
      registry.register(flow);

      const inbound = { text: 'End session.', senderId: 's1', channel: 'whatsapp' } as any;
      await registry.handle({}, inbound, {}, 'tenant-1', {}, {} as any, {} as any);

      expect(flow.handle).toHaveBeenCalledTimes(1);
      // The flow receives the ORIGINAL message text, not the normalized
      // matching key -- normalization is only for trigger-phrase lookup.
      expect(flow.handle).toHaveBeenCalledWith({}, 'End session.', {}, 'tenant-1', {}, {}, {});
    });

    it('does not dispatch when no trigger phrase matches', async () => {
      const flow = makeFlow();
      const registry = new BotFlowRegistry();
      registry.register(flow);

      const inbound = { text: 'I have redness in my eye', senderId: 's1', channel: 'whatsapp' } as any;
      await registry.handle({}, inbound, {}, 'tenant-1', {}, {} as any, {} as any);

      expect(flow.handle).not.toHaveBeenCalled();
    });
  });
});
