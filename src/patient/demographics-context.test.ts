import { buildDemographicsContext } from './demographics-context';

describe('buildDemographicsContext', () => {
  const fixedNow = new Date('2026-06-23');

  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(fixedNow.getTime());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('emits age line when dob is provided', () => {
    // Born 1985-06-23 → 41 years on 2026-06-23
    const result = buildDemographicsContext('male', '1985-06-23');
    expect(result).toContain('Patient is 41 years old.');
  });

  it('does not emit age line when dob is absent', () => {
    const result = buildDemographicsContext('female', undefined);
    expect(result).not.toContain('years old');
  });

  it('floors partial years — birthday not yet reached', () => {
    // Born 1985-12-31 → still 40 on 2026-06-23
    const result = buildDemographicsContext('male', '1985-12-31');
    expect(result).toContain('Patient is 40 years old.');
  });

  it('returns male pronoun guidance for gender=male', () => {
    const result = buildDemographicsContext('male', undefined);
    expect(result).toContain('Patient is male.');
    expect(result).toContain('he/him');
  });

  it('returns female pronoun guidance for gender=female', () => {
    const result = buildDemographicsContext('female', undefined);
    expect(result).toContain('Patient is female.');
    expect(result).toContain('she/her');
  });

  it('returns neutral guidance for gender=prefer_not_to_say', () => {
    const result = buildDemographicsContext('prefer_not_to_say', undefined);
    expect(result).toContain('gender not specified');
    expect(result).toContain('they/them');
  });

  it('returns neutral guidance when gender is null', () => {
    const result = buildDemographicsContext(null, undefined);
    expect(result).toContain('gender not specified');
  });

  it('returns neutral guidance when gender is undefined', () => {
    const result = buildDemographicsContext(undefined, undefined);
    expect(result).toContain('gender not specified');
  });

  it('combines age and gender in one string', () => {
    const result = buildDemographicsContext('female', '1990-01-01');
    expect(result).toContain('years old');
    expect(result).toContain('she/her');
  });

  it('returns no age line when dob is a corrupt string', () => {
    const result = buildDemographicsContext('male', 'not-a-date');
    expect(result).not.toContain('years old');
    expect(result).toContain('Patient is male.');
  });
});
