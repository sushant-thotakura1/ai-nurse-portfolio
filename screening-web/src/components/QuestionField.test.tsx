// screening-web/src/components/QuestionField.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QuestionField } from './QuestionField';

describe('QuestionField', () => {
  it('renders Yes/No buttons for a yes_no question and reports the answer', () => {
    const onAnswer = vi.fn();
    render(
      <QuestionField
        question={{ id: 'q1', prompt: 'Any allergies?', type: 'yes_no' }}
        onAnswer={onAnswer}
      />,
    );

    fireEvent.click(screen.getByText('Yes'));
    expect(onAnswer).toHaveBeenCalledWith('q1', true);
  });

  it('renders options for a single_select question', () => {
    const onAnswer = vi.fn();
    render(
      <QuestionField
        question={{
          id: 'sex',
          prompt: 'Sex',
          type: 'single_select',
          options: [
            { value: 'male', label: 'Male' },
            { value: 'female', label: 'Female' },
          ],
        }}
        onAnswer={onAnswer}
      />,
    );

    fireEvent.click(screen.getByText('Female'));
    expect(onAnswer).toHaveBeenCalledWith('sex', 'female');
  });

  it('marks Yes as pressed when value={true}', () => {
    const onAnswer = vi.fn();
    render(
      <QuestionField
        question={{ id: 'q1', prompt: 'Any allergies?', type: 'yes_no' }}
        value={true}
        onAnswer={onAnswer}
      />,
    );

    expect(screen.getByText('Yes')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('No')).toHaveAttribute('aria-pressed', 'false');
  });

  it('derives multi_select checked state from the value prop, not internal state', () => {
    const onAnswer = vi.fn();
    const question = {
      id: 'symptoms',
      prompt: 'Symptoms',
      type: 'multi_select' as const,
      options: [
        { value: 'a', label: 'A' },
        { value: 'b', label: 'B' },
      ],
    };
    const { rerender } = render(
      <QuestionField question={question} value={['a']} onAnswer={onAnswer} />,
    );

    const [checkboxA, checkboxB] = screen.getAllByRole('checkbox');
    expect(checkboxA).toBeChecked();
    expect(checkboxB).not.toBeChecked();

    fireEvent.click(checkboxB);
    expect(onAnswer).toHaveBeenCalledWith('symptoms', ['a', 'b']);

    // Parent owns the array: it re-renders with the new value, and toggling `a`
    // off is computed from that prop (not any internal state).
    onAnswer.mockClear();
    rerender(<QuestionField question={question} value={['a', 'b']} onAnswer={onAnswer} />);
    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    expect(onAnswer).toHaveBeenCalledWith('symptoms', ['b']);
  });

  it('renders a controlled text input from the value prop', () => {
    const onAnswer = vi.fn();
    render(
      <QuestionField
        question={{ id: 'name', prompt: 'Name', type: 'text' }}
        value={'hi'}
        onAnswer={onAnswer}
      />,
    );

    expect(screen.getByRole('textbox')).toHaveValue('hi');
  });
});
