import { ClinicalTurnRenderer, assemble, looksLikeAQuestion } from './clinical-turn-renderer';

function llm(content: string) {
  const complete = jest.fn().mockResolvedValue({ content });
  return { r: new ClinicalTurnRenderer({ complete, stream: jest.fn() } as any), complete };
}

describe('assemble', () => {
  it('joins qaAnswer, acknowledgment and question; question is last', () => {
    const out = assemble('Your drops reduce swelling.', 'Thank you for asking.', 'Is the redness increasing?');
    expect(out).toBe('Your drops reduce swelling.\n\nThank you for asking.\n\nIs the redness increasing?');
  });

  it('strips an interrogative sentence from the acknowledgment', () => {
    const out = assemble(null, 'I see. Does that make sense? Let me continue.', 'Is the redness increasing?');
    expect(out).not.toContain('Does that make sense?');
    expect(out).toContain('I see.');
    expect(out).toContain('Let me continue.');
    expect((out.match(/\?/g) || []).length).toBe(1);
  });

  it('strips an interrogative sentence from the qa answer', () => {
    const out = assemble('It helps healing. Want more detail?', 'Okay.', 'Is it worse?');
    expect((out.match(/\?/g) || []).length).toBe(1);
    expect(out).toContain('It helps healing.');
  });

  it('handles the Devanagari danda and the Arabic question mark', () => {
    const out = assemble(null, 'ठीक है। क्या समझ आया؟ आगे बढ़ते हैं।', 'क्या दर्द बढ़ रहा है?');
    expect(out).not.toContain('क्या समझ आया');
    expect((out.match(/[?؟]/g) || []).length).toBe(1);
  });

  it('drops empty parts', () => {
    expect(assemble(null, '', 'Q?')).toBe('Q?');
    expect(assemble('', null, 'Q?')).toBe('Q?');
  });
});

describe('looksLikeAQuestion', () => {
  it('true for a ? and for a leading question word', () => {
    expect(looksLikeAQuestion('what does this do')).toBe(true);
    expect(looksLikeAQuestion('is it normal?')).toBe(true);
    expect(looksLikeAQuestion('kya yeh theek hai')).toBe(true);
  });
  it('false for a plain statement', () => {
    expect(looksLikeAQuestion('it is getting worse')).toBe(false);
    expect(looksLikeAQuestion('come and go')).toBe(false);
  });
});

describe('ClinicalTurnRenderer.renderTurn', () => {
  it('returns the structured pieces from the LLM', async () => {
    const { r } = llm('{"acknowledgment":"I understand.","qaAnswer":null,"question":"ब्या दर्द बढ़ रहा है?"}');
    const out = await r.renderTurn({ patientText: 'haan', locale: 'hi-IN', ragSnippets: null, questionEn: 'Is the pain increasing?' });
    expect(out).toEqual({ acknowledgment: 'I understand.', qaAnswer: null, question: 'ब्या दर्द बढ़ रहा है?' });
  });

  it('falls back to empty pieces + empty question on unparseable output (caller substitutes promptEn)', async () => {
    const { r } = llm('sorry, error');
    const out = await r.renderTurn({ patientText: 'x', locale: 'en-IN', ragSnippets: null, questionEn: 'Is it worse?' });
    expect(out).toEqual({ acknowledgment: '', qaAnswer: null, question: '' });
  });

  it('falls back on LLM throw', async () => {
    const complete = jest.fn().mockRejectedValue(new Error('down'));
    const r = new ClinicalTurnRenderer({ complete, stream: jest.fn() } as any);
    const out = await r.renderTurn({ patientText: 'x', locale: 'en-IN', ragSnippets: null, questionEn: 'Is it worse?' });
    expect(out).toEqual({ acknowledgment: '', qaAnswer: null, question: '' });
  });

  it('passes RAG snippets into the prompt when present', async () => {
    const { r, complete } = llm('{"acknowledgment":"ok","qaAnswer":"per the guidance, yes","question":"Is it worse?"}');
    await r.renderTurn({ patientText: 'is that normal?', locale: 'en-IN', ragSnippets: 'DOC: mild redness is common', questionEn: 'Is it worse?' });
    expect(complete.mock.calls[0][0][1].content).toContain('mild redness is common');
  });

  it('puts the language NAME in the prompt, not the bare BCP-47 code', async () => {
    const { r, complete } = llm('{"acknowledgment":"ok","qaAnswer":null,"question":"..."}');
    await r.renderTurn({ patientText: 'okay', locale: 'ha-NG', ragSnippets: null, questionEn: 'Is it worse?' });
    const prompt = complete.mock.calls[0][0][1].content as string;
    expect(prompt).toContain('Hausa');
    expect(prompt).toMatch(/ONLY in Hausa/);
    expect(prompt).not.toContain('ha-NG');
  });
});

describe('ClinicalTurnRenderer.translateNote', () => {
  it('returns the text unchanged for an English locale, without calling the LLM', async () => {
    const { r, complete } = llm('should not be used');
    const out = await r.translateNote('Call 080-66202020 to book an appointment.', 'en-IN');
    expect(out).toBe('Call 080-66202020 to book an appointment.');
    expect(complete).not.toHaveBeenCalled();
  });

  it('translates via the LLM for a non-English locale', async () => {
    const { r, complete } = llm('अपॉइंटमेंट बुक करने के लिए 080-66202020 पर कॉल करें।');
    const out = await r.translateNote('Call 080-66202020 to book an appointment.', 'hi-IN');
    expect(out).toBe('अपॉइंटमेंट बुक करने के लिए 080-66202020 पर कॉल करें।');
    expect(complete).toHaveBeenCalled();
  });

  it('puts the language NAME in the prompt and asks to preserve numbers/links exactly', async () => {
    const { r, complete } = llm('...');
    await r.translateNote('Call 080-66202020.', 'ha-NG');
    const prompt = complete.mock.calls[0][0][1].content as string;
    expect(prompt).toContain('Hausa');
    expect(prompt).toMatch(/exactly/i);
  });

  it('falls back to the original English text if the LLM call throws', async () => {
    const complete = jest.fn().mockRejectedValue(new Error('down'));
    const r = new ClinicalTurnRenderer({ complete, stream: jest.fn() } as any);
    const out = await r.translateNote('Call 080-66202020.', 'hi-IN');
    expect(out).toBe('Call 080-66202020.');
  });

  it('strips wrapping quotes the LLM may add', async () => {
    const { r } = llm('"अपॉइंटमेंट के लिए कॉल करें।"');
    const out = await r.translateNote('Call for an appointment.', 'hi-IN');
    expect(out).toBe('अपॉइंटमेंट के लिए कॉल करें।');
  });
});
