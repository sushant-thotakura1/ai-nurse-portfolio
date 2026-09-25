// screening-web/src/components/ResultScreen.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ResultScreen } from './ResultScreen';

describe('ResultScreen', () => {
  it('renders a stopped heading and message for a stop outcome', () => {
    render(
      <ResultScreen
        stopOutcome={{ outcome: 'stop', message: 'Cannot proceed without consent.' }}
      />,
    );

    expect(screen.getByRole('heading', { name: /stopped/i })).toBeInTheDocument();
    expect(screen.getByText('Cannot proceed without consent.')).toBeInTheDocument();
  });

  it('renders a later heading and message for a defer outcome', () => {
    render(
      <ResultScreen
        stopOutcome={{ outcome: 'defer', message: 'Please return after your follow-up visit.' }}
      />,
    );

    expect(screen.getByRole('heading', { name: /later/i })).toBeInTheDocument();
    expect(screen.getByText('Please return after your follow-up visit.')).toBeInTheDocument();
  });

  it('renders a humanized list of recommended vaccines', () => {
    render(<ResultScreen recommendation={{ vaccines: ['influenza', 'hepatitis_b'] }} />);

    expect(
      screen.getByRole('heading', { name: /recommended vaccinations/i }),
    ).toBeInTheDocument();
    expect(screen.getByText('Influenza')).toBeInTheDocument();
    expect(screen.getByText('Hepatitis B')).toBeInTheDocument();
  });

  it('renders correct clinical casing for known vaccine tokens', () => {
    render(
      <ResultScreen
        recommendation={{ vaccines: ['hepatitis_b', 'herpes_zoster', 'hib'] }}
      />,
    );

    expect(screen.getByText('Hepatitis B')).toBeInTheDocument();
    expect(screen.getByText('Herpes Zoster')).toBeInTheDocument();
    expect(screen.getByText('Hib')).toBeInTheDocument();
  });

  it('renders a no-vaccinations message when the list is empty', () => {
    render(<ResultScreen recommendation={{ vaccines: [] }} />);

    expect(
      screen.getByText('No vaccinations recommended at this time.'),
    ).toBeInTheDocument();
  });

  it('gives stopOutcome precedence over recommendation when both are passed', () => {
    render(
      <ResultScreen
        recommendation={{ vaccines: ['influenza'] }}
        stopOutcome={{ outcome: 'stop', message: 'Cannot proceed without consent.' }}
      />,
    );

    expect(screen.getByRole('heading', { name: /stopped/i })).toBeInTheDocument();
    expect(screen.queryByText('Influenza')).not.toBeInTheDocument();
  });
});
