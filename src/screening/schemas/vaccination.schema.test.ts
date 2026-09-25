// src/screening/schemas/vaccination.schema.test.ts
import { vaccinationSchema } from './vaccination.schema';
import { computeRecommendation, checkStopRules } from '../engine';

describe('vaccinationSchema recommendation rules', () => {
  it('recommends the diabetes vaccine set', () => {
    const result = computeRecommendation(vaccinationSchema, {
      chronic_conditions: ['diabetes'],
      age: 40,
      is_healthcare_worker: false,
    });
    expect(new Set(result.vaccines)).toEqual(
      new Set(['influenza', 'pneumococcal', 'hepatitis_b', 'tdap']),
    );
  });

  it('recommends the elderly vaccine set for age >= 60, independent of conditions', () => {
    const result = computeRecommendation(vaccinationSchema, {
      chronic_conditions: [],
      age: 61,
      is_healthcare_worker: false,
    });
    expect(new Set(result.vaccines)).toEqual(new Set(['influenza', 'pneumococcal', 'herpes_zoster']));
  });

  it('unions the healthcare-worker set on top of a condition-based set', () => {
    const result = computeRecommendation(vaccinationSchema, {
      chronic_conditions: ['diabetes'],
      age: 30,
      is_healthcare_worker: true,
    });
    expect(result.vaccines).toEqual(
      expect.arrayContaining(['mmr', 'varicella', 'influenza', 'hepatitis_b', 'tdap', 'pneumococcal']),
    );
  });
});

describe('vaccinationSchema demographics step', () => {
  const demographics = vaccinationSchema.steps.find((s) => s.id === 'demographics')!;

  it('has the expected ordered question ids including abha_id last', () => {
    expect(demographics.questions.map((q) => q.id)).toEqual([
      'name',
      'age',
      'sex',
      'external_id',
      'phone',
      'abha_id',
    ]);
  });

  it('exposes abha_id as an optional text question', () => {
    const abha = demographics.questions.find((q) => q.id === 'abha_id')!;
    expect(abha).toBeDefined();
    expect(abha.type).toBe('text');
  });

  it('marks the identifier questions optional but keeps name/age/sex required', () => {
    const byId = Object.fromEntries(demographics.questions.map((q) => [q.id, q]));
    expect(byId.external_id.optional).toBe(true);
    expect(byId.phone.optional).toBe(true);
    expect(byId.abha_id.optional).toBe(true);
    expect(byId.name.optional).toBeUndefined();
    expect(byId.age.optional).toBeUndefined();
    expect(byId.sex.optional).toBeUndefined();
  });
});

describe('vaccinationSchema stop rules', () => {
  it('stops on a severe allergic reaction', () => {
    expect(checkStopRules(vaccinationSchema, { severe_allergic_reaction: true })).toEqual({
      outcome: 'stop',
      message: expect.stringContaining('provider'),
    });
  });

  it('defers on acute illness', () => {
    expect(checkStopRules(vaccinationSchema, { acute_illness: true })).toEqual({
      outcome: 'defer',
      message: expect.stringContaining('follow-up'),
    });
  });

  it('does not stop or defer when both are false', () => {
    expect(
      checkStopRules(vaccinationSchema, { severe_allergic_reaction: false, acute_illness: false }),
    ).toBeNull();
  });

  it('stops if consent is not given', () => {
    expect(checkStopRules(vaccinationSchema, { consent_given: false })).toEqual({
      outcome: 'stop',
      message: expect.stringContaining('consent'),
    });
  });
});
