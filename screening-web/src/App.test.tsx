// screening-web/src/App.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { App, ScreeningState } from './App';
import * as api from './api';

function makeState(overrides: Partial<ScreeningState> = {}): ScreeningState {
  return {
    id: 'rec-1',
    status: 'in_progress',
    totalSteps: 6,
    steps: [
      {
        id: 'consent',
        title: 'Consent',
        index: 0,
        questions: [
          { id: 'consent_given', prompt: 'Do you consent to this screening?', type: 'yes_no' },
        ],
      },
      {
        id: 'about_you',
        title: 'About you',
        index: 1,
        questions: [{ id: 'age', prompt: 'How old are you?', type: 'number' }],
      },
      { id: 'step3', title: 'Medical history', index: 2, questions: [] },
      { id: 'step4', title: 'Lifestyle', index: 3, questions: [] },
      { id: 'step5', title: 'Travel', index: 4, questions: [] },
      { id: 'step6', title: 'Review', index: 5, questions: [] },
    ],
    answers: {},
    recommendation: null,
    stopOutcome: null,
    ...overrides,
  };
}

describe('App', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Give the page a tenant slug so the mount pre-check (apiBase()) passes.
    window.history.replaceState({}, '', '/t');
    vi.spyOn(api, 'startSession').mockResolvedValue({ id: 'rec-1', status: 'in_progress' });
    vi.spyOn(api, 'getSessionState').mockResolvedValue(makeState());
    vi.spyOn(api, 'submitAnswer').mockResolvedValue({
      id: 'rec-1',
      status: 'in_progress',
      answers: {},
    });
    vi.spyOn(api, 'completeSession').mockResolvedValue({
      id: 'rec-1',
      status: 'completed',
      recommendation: { vaccines: [] },
    });
  });

  afterEach(() => {
    window.history.replaceState({}, '', '/');
  });

  it('shows a "missing clinic code" message and never starts a session when the URL has no tenant', async () => {
    window.history.replaceState({}, '', '/');

    render(<App />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/missing a clinic code/i);
    expect(api.startSession).not.toHaveBeenCalled();
  });

  it('starts a session then fetches state and shows step 1', async () => {
    render(<App />);
    await waitFor(() => expect(api.startSession).toHaveBeenCalledWith('patient'));
    await waitFor(() => expect(api.getSessionState).toHaveBeenCalledWith('rec-1'));
    expect(await screen.findByRole('heading', { name: 'Consent' })).toBeInTheDocument();
    expect(screen.getByText('Step 1 of 6')).toBeInTheDocument();
    expect(screen.getByText(/Do you consent to this screening/i)).toBeInTheDocument();
  });

  it('keeps Next disabled until the consent question is answered', async () => {
    render(<App />);
    await screen.findByText(/Do you consent to this screening/i);

    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();

    fireEvent.click(screen.getByText('Yes'));

    await waitFor(() =>
      expect(api.submitAnswer).toHaveBeenCalledWith('rec-1', 'consent_given', true),
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Next' })).not.toBeDisabled(),
    );
  });

  it('advances to step 2 on Next and returns on Back', async () => {
    render(<App />);
    await screen.findByText(/Do you consent to this screening/i);
    fireEvent.click(screen.getByText('Yes'));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Next' })).not.toBeDisabled(),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    expect(await screen.findByRole('heading', { name: 'About you' })).toBeInTheDocument();
    expect(screen.getByText('Step 2 of 6')).toBeInTheDocument();
    expect(screen.getByText(/How old are you/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    expect(await screen.findByRole('heading', { name: 'Consent' })).toBeInTheDocument();
    expect(screen.getByText('Step 1 of 6')).toBeInTheDocument();
  });

  it('lets a "No" (false) answer satisfy the Next gate', async () => {
    render(<App />);
    await screen.findByText(/Do you consent to this screening/i);

    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();

    fireEvent.click(screen.getByText('No'));

    await waitFor(() =>
      expect(api.submitAnswer).toHaveBeenCalledWith('rec-1', 'consent_given', false),
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Next' })).not.toBeDisabled(),
    );
  });

  it('keeps answers when navigating Back, so Next stays enabled on step 1', async () => {
    render(<App />);
    await screen.findByText(/Do you consent to this screening/i);
    fireEvent.click(screen.getByText('Yes'));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Next' })).not.toBeDisabled(),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByText('Step 2 of 6');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await screen.findByText('Step 1 of 6');

    expect(screen.getByRole('button', { name: 'Next' })).not.toBeDisabled();
  });

  it('does not let a blank optional question block Next once the required question is answered', async () => {
    (api.getSessionState as any).mockResolvedValue(
      makeState({
        steps: [
          {
            id: 'demographics',
            title: 'Your details',
            index: 0,
            questions: [
              { id: 'name', prompt: 'Full name', type: 'text' },
              { id: 'abha_id', prompt: 'ABHA number (optional)', type: 'text', optional: true },
            ],
          },
          { id: 's2', title: 'Two', index: 1, questions: [] },
          { id: 's3', title: 'Three', index: 2, questions: [] },
          { id: 's4', title: 'Four', index: 3, questions: [] },
          { id: 's5', title: 'Five', index: 4, questions: [] },
          { id: 's6', title: 'Review', index: 5, questions: [] },
        ],
      }),
    );

    render(<App />);
    await screen.findByText(/Full name/i);

    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/Full name/i), { target: { value: 'Asha Verma' } });

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Next' })).not.toBeDisabled(),
    );
  });

  it('shows an inline banner (not the reload screen) when a mid-session submit fails, and clears it on retry', async () => {
    (api.submitAnswer as any).mockRejectedValueOnce(new Error('network'));

    render(<App />);
    await screen.findByText(/Do you consent to this screening/i);

    fireEvent.click(screen.getByText('Yes'));

    expect(await screen.findByText(/Couldn't save your answer/i)).toBeInTheDocument();
    // current step is still rendered — not the destructive error screen
    expect(screen.getByRole('heading', { name: 'Consent' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Yes'));

    await waitFor(() =>
      expect(screen.queryByText(/Couldn't save your answer/i)).not.toBeInTheDocument(),
    );
  });

  it('shows the stop result when an answer triggers a stop rule', async () => {
    const stopped = makeState({
      status: 'completed',
      stopOutcome: { outcome: 'stop', message: 'Cannot proceed without consent.' },
    });
    (api.getSessionState as any).mockResolvedValueOnce(makeState());
    (api.getSessionState as any).mockResolvedValue(stopped);
    (api.submitAnswer as any).mockResolvedValue({
      id: 'rec-1',
      status: 'completed',
      stopOutcome: { outcome: 'stop', message: 'Cannot proceed without consent.' },
    });

    render(<App />);
    await screen.findByText(/Do you consent to this screening/i);
    fireEvent.click(screen.getByText('No'));

    expect(await screen.findByRole('heading', { name: 'Screening stopped' })).toBeInTheDocument();
    expect(screen.getByText('Cannot proceed without consent.')).toBeInTheDocument();
  });

  it('completes the session on Finish and shows the recommendation', async () => {
    (api.getSessionState as any).mockResolvedValue(
      makeState({
        steps: [
          { id: 's1', title: 'Consent', index: 0, questions: [] },
          { id: 's2', title: 'Two', index: 1, questions: [] },
          { id: 's3', title: 'Three', index: 2, questions: [] },
          { id: 's4', title: 'Four', index: 3, questions: [] },
          { id: 's5', title: 'Five', index: 4, questions: [] },
          { id: 's6', title: 'Review', index: 5, questions: [] },
        ],
      }),
    );
    (api.completeSession as any).mockResolvedValue({
      id: 'rec-1',
      status: 'completed',
      recommendation: { vaccines: ['influenza', 'tdap'] },
    });

    render(<App />);
    await screen.findByText('Step 1 of 6');

    for (let i = 2; i <= 6; i++) {
      fireEvent.click(screen.getByRole('button', { name: 'Next' }));
      await screen.findByText(`Step ${i} of 6`);
    }

    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));

    expect(
      await screen.findByRole('heading', { name: 'Recommended vaccinations' }),
    ).toBeInTheDocument();
    expect(api.completeSession).toHaveBeenCalledWith('rec-1');
    expect(screen.getByText('Influenza')).toBeInTheDocument();
    expect(screen.getByText('Tdap')).toBeInTheDocument();
  });

  it('shows an error with a Try again button when startup fails', async () => {
    (api.startSession as any).mockRejectedValue(new Error('network'));

    render(<App />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not start/i);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('keeps the "Could not start" + Try again screen for a plain (statusless) mount error', async () => {
    (api.startSession as any).mockRejectedValue(new Error('network'));

    render(<App />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not start/i);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(
      screen.queryByText(/this screening is not available/i),
    ).not.toBeInTheDocument();
  });

  it('shows a "not available" message (no Try again) when startSession 404s on mount', async () => {
    (api.startSession as any).mockRejectedValue(
      Object.assign(new Error('nope'), { status: 404 }),
    );

    render(<App />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /this screening is not available/i,
    );
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });

  it('shows a "not available" message when getSessionState 404s on mount', async () => {
    (api.getSessionState as any).mockRejectedValue(
      Object.assign(new Error('nope'), { status: 404 }),
    );

    render(<App />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /this screening is not available/i,
    );
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });
});
