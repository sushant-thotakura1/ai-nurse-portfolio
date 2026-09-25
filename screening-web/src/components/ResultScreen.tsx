// screening-web/src/components/ResultScreen.tsx

interface ResultScreenProps {
  recommendation?: { vaccines: string[] } | null;
  stopOutcome?: { outcome: 'stop' | 'defer'; message: string } | null;
}

const VACCINE_LABELS: Record<string, string> = {
  hepatitis_a: 'Hepatitis A',
  hepatitis_b: 'Hepatitis B',
  influenza: 'Influenza',
  tdap: 'Tdap',
  mmr: 'MMR',
  varicella: 'Varicella',
  pneumococcal: 'Pneumococcal',
  hpv: 'HPV',
  herpes_zoster: 'Herpes Zoster',
  hib: 'Hib',
  meningococcal: 'Meningococcal',
};

function humanize(token: string): string {
  if (VACCINE_LABELS[token]) return VACCINE_LABELS[token];
  const spaced = token.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function ResultScreen({ recommendation, stopOutcome }: ResultScreenProps) {
  if (stopOutcome) {
    return (
      <section>
        <h2>{stopOutcome.outcome === 'stop' ? 'Screening stopped' : 'Come back later'}</h2>
        <p>{stopOutcome.message}</p>
      </section>
    );
  }

  if (recommendation) {
    return (
      <section>
        <h2>Recommended vaccinations</h2>
        {recommendation.vaccines.length > 0 ? (
          <ul>
            {recommendation.vaccines.map((vaccine) => (
              <li key={vaccine}>{humanize(vaccine)}</li>
            ))}
          </ul>
        ) : (
          <p>No vaccinations recommended at this time.</p>
        )}
      </section>
    );
  }

  return (
    <section>
      <p>No result yet.</p>
    </section>
  );
}
