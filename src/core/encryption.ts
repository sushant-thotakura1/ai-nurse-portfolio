import CryptoJS from 'crypto-js';
import { config } from './config';

/**
 * Encrypt sensitive data using AES-256
 * Uses random IV for each encryption to ensure different ciphertext
 */
export function encrypt(plaintext: string): string {
  // Convert key string to WordArray for proper AES encryption
  const key = CryptoJS.SHA256(config.security.encryptionKey);
  const iv = CryptoJS.lib.WordArray.random(16);

  const encrypted = CryptoJS.AES.encrypt(plaintext, key, {
    iv: iv,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  });

  // Combine IV + ciphertext for storage
  const combined = iv.toString() + ':' + encrypted.ciphertext.toString();
  return combined;
}

/**
 * Decrypt data encrypted with encrypt()
 */
export function decrypt(ciphertext: string): string {
  const parts = ciphertext.split(':');
  if (parts.length !== 2) {
    throw new Error('Invalid ciphertext format');
  }

  // Convert key string to WordArray (same way as encrypt)
  const key = CryptoJS.SHA256(config.security.encryptionKey);
  const iv = CryptoJS.enc.Hex.parse(parts[0]);
  const encryptedData = CryptoJS.enc.Hex.parse(parts[1]);

  const decrypted = CryptoJS.AES.decrypt(
    { ciphertext: encryptedData } as any,
    key,
    {
      iv: iv,
      mode: CryptoJS.mode.CBC,
      padding: CryptoJS.pad.Pkcs7,
    }
  );

  return decrypted.toString(CryptoJS.enc.Utf8);
}

/**
 * One-way hash using SHA-256 (for anonymizing patient IDs in logs)
 */
export function hash(input: string): string {
  return CryptoJS.SHA256(input).toString();
}

/**
 * Mask phone number for display (show last 4 digits only)
 */
export function maskPhone(phone: string): string {
  if (phone.length <= 4) return '****';
  return '*'.repeat(phone.length - 4) + phone.slice(-4);
}
