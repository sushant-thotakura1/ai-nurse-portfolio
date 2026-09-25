import { buildGreetingCopy } from '../../../../src/messaging/bot-flows/greeting-copy';

describe('buildGreetingCopy', () => {
  describe('chronic triggers', () => {
    it('returns chronic systemRole for enrollment_date', () => {
      const copy = buildGreetingCopy('enrollment_date', 'Sickle Cell Anemia', 30, '1 month');
      expect(copy.systemRole).toContain('chronic care programme');
      expect(copy.checkInLine).toContain('managing their condition');
    });

    it('returns chronic systemRole for diagnosis_date', () => {
      const copy = buildGreetingCopy('diagnosis_date', 'Sickle Cell Anemia', 14, '2 weeks');
      expect(copy.systemRole).toContain('chronic care programme');
    });

    it('includes contextLine with "enrolled" for enrollment_date when daysSinceStart > 0', () => {
      const copy = buildGreetingCopy('enrollment_date', 'Sickle Cell Anemia', 7, '1 week');
      expect(copy.contextLine).toBe(
        'It has been 1 week since the patient enrolled in the Sickle Cell Anemia care programme'
      );
    });

    it('includes contextLine with "was diagnosed with" for diagnosis_date when daysSinceStart > 0', () => {
      const copy = buildGreetingCopy('diagnosis_date', 'Sickle Cell Anemia', 14, '2 weeks');
      expect(copy.contextLine).toContain('was diagnosed with');
      expect(copy.contextLine).toBe(
        'It has been 2 weeks since the patient was diagnosed with Sickle Cell Anemia'
      );
    });

    it('sets contextLine to null when daysSinceStart is 0 (just-enrolled)', () => {
      const copy = buildGreetingCopy('enrollment_date', 'Sickle Cell Anemia', 0, '0 days');
      expect(copy.contextLine).toBeNull();
    });
  });

  describe('episodic triggers', () => {
    it('returns episodic systemRole for discharge_date', () => {
      const copy = buildGreetingCopy('discharge_date', 'Cardiac Surgery', 15, '2 weeks');
      expect(copy.systemRole).toContain('post-discharge');
      expect(copy.checkInLine).toContain('recovery');
    });

    it('returns episodic systemRole for surgery_date', () => {
      const copy = buildGreetingCopy('surgery_date', 'Cardiac Surgery', 3, '3 days');
      expect(copy.systemRole).toContain('post-discharge');
    });

    it.each(['discharge_date', 'surgery_date', 'transplant_date'])(
      'omits the surgery timeline for %s (the agenda asks it instead)',
      (triggerType) => {
        const copy = buildGreetingCopy(triggerType, 'Keratoplasty', 66, '9 weeks');
        expect(copy.contextLine).toBeNull();
      },
    );
  });
});
