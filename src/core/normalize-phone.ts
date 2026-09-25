/**
 * Normalise a phone number string to E.164 format (+<country><number>).
 *
 * Rules applied in order:
 *  1. Strip all spaces, dashes, parentheses, dots.
 *  2. If the result starts with '+', it's already E.164-prefixed — keep as-is.
 *  3. If the result is 10 digits (no country code), prepend +91 (India default).
 *  4. Otherwise, prepend + to make it E.164.
 *  5. Throw if the result contains any non-digit after the leading +.
 */
export function normalizeToE164(phone: string): string {
  // Step 1: strip formatting characters
  let cleaned = phone.replace(/[\s\-().]/g, '');

  // Step 2: if already has '+' prefix, use as-is
  if (!cleaned.startsWith('+')) {
    if (cleaned.length === 10) {
      // 10-digit number with no country code — assume India (+91)
      cleaned = '+91' + cleaned;
    } else {
      cleaned = '+' + cleaned;
    }
  }

  // Step 3: validate — after the leading +, only digits are allowed
  const digits = cleaned.slice(1);
  if (!/^\d{7,15}$/.test(digits)) {
    throw new Error(`Cannot normalize to E.164: "${phone}" — invalid format after cleaning`);
  }

  return cleaned;
}
