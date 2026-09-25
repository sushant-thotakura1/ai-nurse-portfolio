import { BotFlowRegistry } from '../../../../src/messaging/bot-flows/bot-flow-registry';
import { BotFlow, BotFlowResult } from '../../../../src/messaging/bot-flows/bot-flow.interface';

function makeMockFlow(name: string, triggers: string[], active = false): BotFlow {
  return {
    name,
    triggerPhrases: triggers,
    isActive: jest.fn().mockReturnValue(active),
    handle: jest.fn().mockResolvedValue({ handled: true, done: true } as BotFlowResult),
  };
}

describe('BotFlowRegistry', () => {
  let registry: BotFlowRegistry;

  beforeEach(() => {
    registry = new BotFlowRegistry();
  });

  describe('shouldHandle', () => {
    it('returns true when message matches a trigger phrase (case-insensitive)', () => {
      registry.register(makeMockFlow('test', ['set health condition']));
      const session = { flowState: null };
      expect(registry.shouldHandle(session, 'Set Health Condition')).toBe(true);
      expect(registry.shouldHandle(session, '  set health condition  ')).toBe(true);
      expect(registry.shouldHandle(session, 'SET HEALTH CONDITION')).toBe(true);
    });

    it('returns false when message does not match any trigger', () => {
      registry.register(makeMockFlow('test', ['set health condition']));
      const session = { flowState: null };
      expect(registry.shouldHandle(session, 'hello')).toBe(false);
    });

    it('returns true when a flow is active in session', () => {
      const activeFlow = makeMockFlow('test', ['trigger'], true);
      registry.register(activeFlow);
      const session = { flowState: { flow: 'test' } };
      expect(registry.shouldHandle(session, 'some random text')).toBe(true);
    });

    it('returns false with no registered flows', () => {
      expect(registry.shouldHandle({ flowState: null }, 'anything')).toBe(false);
    });
  });

  describe('handle', () => {
    it('calls the active flow handle method', async () => {
      const flow = makeMockFlow('test', ['trigger'], true);
      registry.register(flow);

      const session = { flowState: { flow: 'test' } };
      const inbound = { text: 'some text', senderId: '+91123', channel: 'whatsapp' as any, timestamp: new Date(), rawPayload: {} };
      const patient = { id: 'p1' };

      await registry.handle(session, inbound, patient, 'tenant-1', {} as any, {} as any, {} as any);

      expect(flow.handle).toHaveBeenCalledWith(session, 'some text', patient, 'tenant-1', expect.anything(), expect.anything(), expect.anything());
    });

    it('calls the trigger-matched flow when no flow is active', async () => {
      const flow = makeMockFlow('test', ['set health condition'], false);
      registry.register(flow);

      const session = { flowState: null };
      const inbound = { text: 'Set Health Condition', senderId: '+91123', channel: 'whatsapp' as any, timestamp: new Date(), rawPayload: {} };

      await registry.handle(session, inbound, { id: 'p1' }, 'tenant-1', {} as any, {} as any, {} as any);

      expect(flow.handle).toHaveBeenCalled();
    });
  });
});
