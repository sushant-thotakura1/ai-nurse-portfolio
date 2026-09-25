import { encrypt, decrypt, hash, maskPhone } from '../../../src/core/encryption';

describe('Encryption', () => {
  describe('encrypt and decrypt', () => {
    it('should encrypt and decrypt text correctly', () => {
      const plaintext = 'Sensitive patient data';
      const encrypted = encrypt(plaintext);
      const decrypted = decrypt(encrypted);

      expect(encrypted).not.toBe(plaintext);
      expect(decrypted).toBe(plaintext);
    });

    it('should produce different ciphertext for same plaintext', () => {
      const plaintext = 'Test data';
      const encrypted1 = encrypt(plaintext);
      const encrypted2 = encrypt(plaintext);

      expect(encrypted1).not.toBe(encrypted2);
      expect(decrypt(encrypted1)).toBe(plaintext);
      expect(decrypt(encrypted2)).toBe(plaintext);
    });
  });

  describe('hash', () => {
    it('should produce consistent hash for same input', () => {
      const input = 'patient-id-123';
      const hash1 = hash(input);
      const hash2 = hash(input);

      expect(hash1).toBe(hash2);
    });

    it('should produce different hash for different input', () => {
      const hash1 = hash('input1');
      const hash2 = hash('input2');

      expect(hash1).not.toBe(hash2);
    });

    it('should be one-way (irreversible)', () => {
      const input = 'sensitive-data';
      const hashed = hash(input);

      expect(hashed).not.toBe(input);
      expect(hashed).toHaveLength(64); // SHA-256 produces 64 char hex
    });
  });

  describe('maskPhone', () => {
    it('should mask phone number showing last 4 digits', () => {
      const masked = maskPhone('9876543210');
      expect(masked).toBe('******3210');
    });

    it('should handle short phone numbers', () => {
      const masked = maskPhone('123');
      expect(masked).toBe('****');
    });
  });
});
