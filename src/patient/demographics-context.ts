const MS_PER_YEAR = 1000 * 60 * 60 * 24 * 365.25;

export function calculateAge(dobString: string): number | null {
  const dob = new Date(dobString);
  if (isNaN(dob.getTime())) return null;
  const now = new Date(Date.now());
  let age = now.getFullYear() - dob.getFullYear();
  const monthDiff = now.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < dob.getDate())) {
    age--;
  }
  return age;
}

export function buildDemographicsContext(
  gender?: string | null,
  dob?: string | null,
): string {
  const lines: string[] = [];

  if (dob) {
    const age = calculateAge(dob);
    if (age !== null) lines.push(`Patient is ${age} years old.`);
  }

  if (gender === 'male') {
    lines.push(
      'Patient is male. Use he/him pronouns. Tailor clinical questions appropriately for male patients (e.g. include prostate, testicular health when relevant).',
    );
  } else if (gender === 'female') {
    lines.push(
      'Patient is female. Use she/her pronouns. Tailor clinical questions appropriately for female patients (e.g. include menstrual, reproductive health when relevant).',
    );
  } else {
    lines.push(
      "Patient gender not specified. Use gender-neutral language — refer to 'the patient' or use they/them pronouns.",
    );
  }

  return lines.join('\n');
}
