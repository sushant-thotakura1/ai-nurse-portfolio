import { EndCallFlow } from '../end-call.flow';

describe('EndCallFlow', () => {
  const session = { channel: 'whatsapp', senderId: '+911234567890', id: 'sess-1' };
  const prisma = {};
  const llm = {} as any;

  function makeClosingService(closeResult: any) {
    return {
      close: jest.fn().mockResolvedValue(closeResult),
      storeSummaryWamid: jest.fn(),
    } as any;
  }

  it('closes the session and sends the summary on the happy path', async () => {
    const closing = makeClosingService({ callSessionId: 'cs-1', summaryText: 'Summary text', outcome: 'REASSURE' });
    const sendMessage = jest.fn().mockResolvedValue('wamid-1');
    const adapter = { sendMessage } as any;
    const flow = new EndCallFlow(closing);

    const result = await flow.handle(session, 'end session', {}, 'tenant-1', prisma, adapter, llm);

    expect(closing.close).toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      content: [{ type: 'text', text: 'Summary text' }],
    }));
    expect(result).toEqual({ handled: true, done: true });
  });

  it('still closes the session and computes the assessment when the acknowledgment send fails', async () => {
    // Regression: EndCallFlow used to await the "Ending session, please wait…"
    // send with no try/catch. A channel failure there (proven to happen -- the
    // same WhatsApp token that 401'd on an earlier live-tested conversation)
    // threw before sessionClosingService.close() was ever called, so the
    // patient's "end session" request silently failed to end anything.
    const closing = makeClosingService({ callSessionId: 'cs-1', summaryText: 'Summary text', outcome: 'REASSURE' });
    const sendMessage = jest.fn()
      .mockRejectedValueOnce(new Error('Request failed with status code 401')) // the ack
      .mockResolvedValueOnce('wamid-2'); // the summary
    const adapter = { sendMessage } as any;
    const flow = new EndCallFlow(closing);

    const result = await flow.handle(session, 'end session', {}, 'tenant-1', prisma, adapter, llm);

    expect(closing.close).toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ handled: true, done: true });
  });

  it('does not crash when the summary send fails after the session has already closed', async () => {
    // Regression: a failure on the SECOND send (the summary, after close()
    // already ran and persisted the assessment) used to throw uncaught,
    // indistinguishable from "nothing happened" to anyone watching only the
    // session state -- the assessment exists in the DB but the patient never
    // receives it and no specific error is logged.
    const closing = makeClosingService({ callSessionId: 'cs-1', summaryText: 'Summary text', outcome: 'ESCALATE' });
    const sendMessage = jest.fn()
      .mockResolvedValueOnce('wamid-1') // the ack
      .mockRejectedValueOnce(new Error('Request failed with status code 401')); // the summary
    const adapter = { sendMessage } as any;
    const flow = new EndCallFlow(closing);

    const result = await flow.handle(session, 'end session', {}, 'tenant-1', prisma, adapter, llm);

    expect(closing.close).toHaveBeenCalled();
    expect(result).toEqual({ handled: true, done: true });
  });

  it('tells the patient the session was already closed when close() returns null (race)', async () => {
    const closing = makeClosingService(null);
    const sendMessage = jest.fn().mockResolvedValue('wamid-1');
    const adapter = { sendMessage } as any;
    const flow = new EndCallFlow(closing);

    const result = await flow.handle(session, 'end session', {}, 'tenant-1', prisma, adapter, llm);

    expect(sendMessage).toHaveBeenLastCalledWith(expect.objectContaining({
      content: [{ type: 'text', text: 'This session has already been closed.' }],
    }));
    expect(result).toEqual({ handled: true, done: true });
  });
});
