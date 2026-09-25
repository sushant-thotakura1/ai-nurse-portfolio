// screening-web/src/components/QuestionField.tsx

export interface Option {
  value: string;
  label: string;
}

export interface Question {
  id: string;
  prompt: string;
  type: 'yes_no' | 'single_select' | 'multi_select' | 'text' | 'number';
  options?: Option[];
  optional?: boolean;
}

export function QuestionField({
  question,
  value,
  onAnswer,
}: {
  question: Question;
  value?: boolean | string | string[] | number;
  onAnswer: (questionId: string, value: boolean | string | string[] | number) => void;
}) {
  if (question.type === 'yes_no') {
    return (
      <fieldset className="choices">
        <legend>{question.prompt}</legend>
        <button
          type="button"
          aria-pressed={value === true}
          className={value === true ? 'selected' : undefined}
          onClick={() => onAnswer(question.id, true)}
        >
          Yes
        </button>
        <button
          type="button"
          aria-pressed={value === false}
          className={value === false ? 'selected' : undefined}
          onClick={() => onAnswer(question.id, false)}
        >
          No
        </button>
      </fieldset>
    );
  }

  if (question.type === 'single_select') {
    return (
      <fieldset className="choices">
        <legend>{question.prompt}</legend>
        {question.options?.map((opt) => (
          <button
            key={opt.value}
            type="button"
            aria-pressed={opt.value === value}
            className={opt.value === value ? 'selected' : undefined}
            onClick={() => onAnswer(question.id, opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </fieldset>
    );
  }

  if (question.type === 'multi_select') {
    const current = Array.isArray(value) ? value : [];
    const toggle = (optValue: string) => {
      const next = current.includes(optValue)
        ? current.filter((v) => v !== optValue)
        : [...current, optValue];
      onAnswer(question.id, next);
    };
    return (
      <fieldset className="choices">
        <legend>{question.prompt}</legend>
        {question.options?.map((opt) => (
          <label key={opt.value} className="choice">
            <input
              type="checkbox"
              checked={current.includes(opt.value)}
              onChange={() => toggle(opt.value)}
            />
            {opt.label}
          </label>
        ))}
      </fieldset>
    );
  }

  // text / number
  return (
    <label className="field">
      <span className="field-prompt">
        {question.prompt}
        {question.optional && <span className="field-hint">Optional</span>}
      </span>
      <input
        type={question.type === 'number' ? 'number' : 'text'}
        inputMode={question.type === 'number' ? 'numeric' : undefined}
        value={(value ?? '') as string | number}
        onChange={(e) =>
          onAnswer(question.id, question.type === 'number' ? Number(e.target.value) : e.target.value)
        }
      />
    </label>
  );
}
