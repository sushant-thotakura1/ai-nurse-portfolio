// src/screening/schemas/vaccination.schema.ts
import { ScreeningSchema } from '../types';

const CONDITION_OPTIONS = [
  { value: 'diabetes', label: 'Diabetes' },
  { value: 'hypertension', label: 'Hypertension' },
  { value: 'chronic_respiratory_disease', label: 'Chronic respiratory disease' },
  { value: 'heart_disease', label: 'Heart disease' },
  { value: 'chronic_kidney_disease', label: 'Chronic kidney disease' },
  { value: 'liver_disease', label: 'Liver disease' },
  { value: 'cancer', label: 'Cancer' },
  { value: 'immunocompromised', label: 'Immunocompromised' },
  { value: 'post_transplant', label: 'Post-transplant' },
  { value: 'splenectomy', label: 'Splenectomy' },
];

export const vaccinationSchema: ScreeningSchema = {
  id: 'adult-vaccination',
  version: '1',
  steps: [
    {
      id: 'consent',
      title: 'Consent',
      questions: [
        {
          id: 'consent_given',
          // Placeholder copy — real wording pending KEMHRC's EDP/ethics answer.
          prompt: 'Do you consent to this screening?',
          type: 'yes_no',
        },
      ],
    },
    {
      id: 'demographics',
      title: 'Your details',
      questions: [
        { id: 'name', prompt: 'Full name', type: 'text' },
        { id: 'age', prompt: 'Age', type: 'number' },
        {
          id: 'sex',
          prompt: 'Sex',
          type: 'single_select',
          options: [
            { value: 'male', label: 'Male' },
            { value: 'female', label: 'Female' },
            { value: 'other', label: 'Other' },
          ],
        },
        { id: 'external_id', prompt: 'Patient ID', type: 'text', optional: true },
        { id: 'phone', prompt: 'Phone number', type: 'text', optional: true },
        { id: 'abha_id', prompt: 'ABHA number / address', type: 'text', optional: true },
      ],
    },
    {
      id: 'risk_factors',
      title: 'Risk factors',
      questions: [
        { id: 'has_chronic_conditions', prompt: 'Do you have any chronic conditions?', type: 'yes_no' },
        {
          id: 'chronic_conditions',
          prompt: 'Which conditions?',
          type: 'multi_select',
          options: CONDITION_OPTIONS,
          showIf: (a) => a.has_chronic_conditions === true,
        },
        { id: 'is_healthcare_worker', prompt: 'Are you a healthcare worker?', type: 'yes_no' },
      ],
    },
    {
      id: 'vaccination_history',
      title: 'Vaccination history',
      questions: [
        { id: 'vaccinated_last_10_years', prompt: 'Have you received vaccines in the last 10 years?', type: 'yes_no' },
        {
          id: 'vaccines_received',
          prompt: 'Which vaccines?',
          type: 'multi_select',
          options: [
            { value: 'tdap_td', label: 'Tdap/Td' },
            { value: 'influenza', label: 'Influenza' },
            { value: 'pneumococcal', label: 'Pneumococcal' },
            { value: 'hepatitis_b', label: 'Hepatitis B' },
          ],
          showIf: (a) => a.vaccinated_last_10_years === true,
        },
      ],
    },
    {
      id: 'eligibility',
      title: 'Eligibility',
      questions: [
        { id: 'severe_allergic_reaction', prompt: 'Any history of severe allergic reaction to vaccines?', type: 'yes_no' },
        { id: 'acute_illness', prompt: 'Are you currently unwell with acute illness?', type: 'yes_no' },
      ],
    },
    {
      id: 'acceptance',
      title: 'Acceptance',
      questions: [
        { id: 'willing_today', prompt: 'Are you willing to receive vaccines today?', type: 'yes_no' },
      ],
    },
  ],
  stopRules: [
    {
      id: 'no_consent',
      outcome: 'stop',
      message: 'Cannot proceed without consent.',
      when: (a) => a.consent_given === false,
    },
    {
      id: 'severe_allergy',
      outcome: 'stop',
      message: 'Stop — please alert the provider before proceeding.',
      when: (a) => a.severe_allergic_reaction === true,
    },
    {
      id: 'acute_illness',
      outcome: 'defer',
      message: 'Vaccination deferred — please schedule a follow-up visit.',
      when: (a) => a.acute_illness === true,
    },
  ],
  recommendationRules: [
    { ifTagsInclude: ['diabetes'], vaccines: ['influenza', 'pneumococcal', 'hepatitis_b', 'tdap'] },
    { ifTagsInclude: ['chronic_kidney_disease'], vaccines: ['hepatitis_b', 'pneumococcal', 'influenza', 'tdap'] },
    { ifTagsInclude: ['cancer'], vaccines: ['hib', 'pneumococcal', 'influenza', 'varicella'] },
    { ifTagsInclude: ['elderly'], vaccines: ['influenza', 'pneumococcal', 'herpes_zoster'] },
    {
      ifTagsInclude: ['healthcare_worker'],
      vaccines: ['tdap', 'influenza', 'hepatitis_b', 'varicella', 'mmr'],
    },
  ],
  deriveTags: (answers) => {
    const tags: string[] = Array.isArray(answers.chronic_conditions)
      ? [...(answers.chronic_conditions as string[])]
      : [];
    if (typeof answers.age === 'number' && answers.age >= 60) tags.push('elderly');
    if (answers.is_healthcare_worker === true) tags.push('healthcare_worker');
    return tags;
  },
};
