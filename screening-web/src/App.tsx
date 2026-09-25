// screening-web/src/App.tsx
import { useEffect, useState } from 'react';
import { apiBase, startSession, submitAnswer, completeSession, getSessionState } from './api';
import { QuestionField, Question } from './components/QuestionField';
import { ResultScreen } from './components/ResultScreen';

export interface ScreeningStep {
  id: string;
  title: string;
  index: number;
  questions: Question[];
}

export interface ScreeningState {
  id: string;
  status: string;
  totalSteps: number;
  steps: ScreeningStep[];
  answers: Record<string, unknown>;
  recommendation: { vaccines: string[] } | null;
  stopOutcome: { outcome: 'stop' | 'defer'; message: string } | null;
}

type AnswerValue = boolean | string | string[] | number;

export function App() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [state, setState] = useState<ScreeningState | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [result, setResult] = useState<{ vaccines: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [noTenant, setNoTenant] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!apiBase()) {
      setNoTenant(true);
      return;
    }
    (async () => {
      try {
        const session = await startSession('patient');
        const next: ScreeningState = await getSessionState(session.id);
        if (cancelled) return;
        setSessionId(session.id);
        setState(next);
        setAnswers({ ...next.answers });
      } catch (err) {
        if (cancelled) return;
        const e = err as { status?: number; noTenant?: boolean };
        if (e?.noTenant || e?.status === 0) {
          setNoTenant(true);
        } else if (e?.status === 404) {
          setUnavailable(true);
        } else {
          setError('Could not start the screening. Please try again.');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleAnswer = async (questionId: string, value: AnswerValue) => {
    if (!sessionId) return;
    // Ignore taps while a submit/refetch is in flight so overlapping round-trips
    // can't land out of order and overwrite each other.
    if (busy) return;
    setAnswers((a) => ({ ...a, [questionId]: value }));
    setBusy(true);
    try {
      // Whether a stop rule fired (rec.status === 'completed' && rec.stopOutcome)
      // or a conditional question was revealed/hidden, the fresh state has what
      // we need — refetch and re-render from it.
      await submitAnswer(sessionId, questionId, value);
      const next: ScreeningState = await getSessionState(sessionId);
      setState(next);
      setSubmitError(null);
    } catch {
      // Non-destructive: keep the current step + all answers on screen and show
      // an inline banner rather than the full reload/error screen.
      setSubmitError("Couldn't save your answer. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const handleNext = async () => {
    if (!state) return;
    const isLast = stepIndex === state.totalSteps - 1;
    if (isLast) {
      setBusy(true);
      try {
        const rec = await completeSession(sessionId as string);
        setResult(rec.recommendation);
      } catch {
        setError('Could not finish the screening. Please try again.');
      } finally {
        setBusy(false);
      }
    } else {
      setStepIndex((i) => i + 1);
    }
  };

  if (noTenant) {
    return (
      <main>
        <p role="alert">
          This screening link is missing a clinic code. Please use the full link your clinic gave you.
        </p>
      </main>
    );
  }

  if (unavailable) {
    return (
      <main>
        <p role="alert">This screening is not available.</p>
      </main>
    );
  }

  if (error) {
    return (
      <main>
        <p role="alert">{error}</p>
        <button type="button" onClick={() => window.location.reload()}>
          Try again
        </button>
      </main>
    );
  }

  if (!sessionId || !state) return <p>Loading…</p>;

  if (state.status === 'completed' && state.stopOutcome) {
    return (
      <main>
        <ResultScreen stopOutcome={state.stopOutcome} />
      </main>
    );
  }

  if (result) {
    return (
      <main>
        <ResultScreen recommendation={result} />
      </main>
    );
  }

  const step = state.steps[stepIndex];
  const isLast = stepIndex === state.totalSteps - 1;
  const allAnswered = step.questions.every((q) => q.optional || q.id in answers);

  const pct = Math.round(((stepIndex + 1) / state.totalSteps) * 100);

  return (
    <main>
      <header className="wizard-head">
        <h1>{step.title}</h1>
        <div className="progress-track" aria-hidden="true">
          <span className="progress-bar" style={{ width: `${pct}%` }} />
        </div>
        <p className="progress">
          Step {stepIndex + 1} of {state.totalSteps}
        </p>
      </header>
      {step.questions.map((q) => (
        <QuestionField
          key={q.id}
          question={q}
          value={answers[q.id] as AnswerValue | undefined}
          onAnswer={handleAnswer}
        />
      ))}
      {submitError && (
        <p role="alert" className="submit-error">
          {submitError}
        </p>
      )}
      <div className="nav">
        <button
          type="button"
          className="secondary"
          disabled={stepIndex === 0}
          onClick={() => setStepIndex((i) => i - 1)}
        >
          Back
        </button>
        <button
          type="button"
          className="primary"
          disabled={!allAnswered || busy}
          onClick={handleNext}
        >
          {isLast ? 'Finish' : 'Next'}
        </button>
      </div>
    </main>
  );
}
