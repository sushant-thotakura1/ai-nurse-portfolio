/**
 * Locale-keyed notice strings shown to the patient when TTS fails after all
 * retries and the reply falls back to text. Covers all locales supported by
 * the EdgeTTS adapter. Falls back to English for any unmapped locale.
 */
const FALLBACK_NOTICES: Record<string, string> = {
  // Indian languages
  'en-IN': 'Voice response is temporarily unavailable.',
  'hi-IN': 'वॉइस रिस्पॉन्स अभी उपलब्ध नहीं है।',
  'te-IN': 'వాయిస్ ప్రతిస్పందన తాత్కాలికంగా అందుబాటులో లేదు.',
  'ta-IN': 'குரல் பதில் தற்காலிகமாக கிடைக்கவில்லை.',
  'kn-IN': 'ಧ್ವನಿ ಪ್ರತಿಕ್ರಿಯೆ ತಾತ್ಕಾಲಿಕವಾಗಿ ಲಭ್ಯವಿಲ್ಲ.',
  'ml-IN': 'വോയ്‌സ് പ്രതികരണം താൽക്കാലികമായി ലഭ്യമല്ല.',
  'mr-IN': 'व्हॉइस रिस्पॉन्स तात्पुरत्या उपलब्ध नाही.',
  'gu-IN': 'વૉઇસ રિસ્પોન્સ અસ્થાયી રૂપે અનુપલબ્ધ છે.',
  'bn-IN': 'ভয়েস রেসপন্স সাময়িকভাবে অনুপলব্ধ।',
  'pa-IN': 'ਵੌਇਸ ਰਿਸਪਾਂਸ ਅਸਥਾਈ ਤੌਰ ਤੇ ਉਪਲਬਧ ਨਹੀਂ ਹੈ।',
  // African languages
  'sw-KE': 'Jibu la sauti halipatikani kwa sasa.',
  'sw-TZ': 'Jibu la sauti halipatikani kwa sasa.',
  'af-ZA': 'Stemreaksie is tydelik onbeskikbaar.',
  'am-ET': 'የድምፅ ምላሽ ለጊዜው አይገኝም።',
  'ha-NG': 'Amsar murya ba ta samuwa a yanzu.',
  'so-SO': 'Jawaabta codka si ku-meel-gaar ah ma heli karto.',
  'yo-NG': 'Idahun ohun ko si fun igba diẹ.',
  'zu-ZA': 'Impendulo yezwi ayitholakali okwesikhashana.',
};

const ENGLISH_NOTICE = FALLBACK_NOTICES['en-IN'];

/**
 * Returns the TTS fallback notice for the given locale.
 * Falls back to English if the locale is not in the map or not provided.
 */
export function getTtsFallbackNotice(locale?: string | null): string {
  if (!locale) return ENGLISH_NOTICE;
  return FALLBACK_NOTICES[locale] ?? ENGLISH_NOTICE;
}
