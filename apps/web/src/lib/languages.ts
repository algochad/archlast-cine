// Languages offered for subtitle / audio preferences (ISO 639-1 → display name).

export const LANGUAGE_OPTIONS: { code: string; label: string }[] = [
  { code: "en", label: "English" },
  { code: "es", label: "Spanish" },
  { code: "pt", label: "Portuguese" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "it", label: "Italian" },
  { code: "nl", label: "Dutch" },
  { code: "pl", label: "Polish" },
  { code: "ru", label: "Russian" },
  { code: "uk", label: "Ukrainian" },
  { code: "tr", label: "Turkish" },
  { code: "ar", label: "Arabic" },
  { code: "hi", label: "Hindi" },
  { code: "bn", label: "Bengali" },
  { code: "id", label: "Indonesian" },
  { code: "vi", label: "Vietnamese" },
  { code: "th", label: "Thai" },
  { code: "tl", label: "Filipino" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
  { code: "zh", label: "Chinese" },
  { code: "bg", label: "Bulgarian" },
  { code: "cs", label: "Czech" },
  { code: "da", label: "Danish" },
  { code: "el", label: "Greek" },
  { code: "et", label: "Estonian" },
  { code: "fa", label: "Persian" },
  { code: "fi", label: "Finnish" },
  { code: "he", label: "Hebrew" },
  { code: "hr", label: "Croatian" },
  { code: "hu", label: "Hungarian" },
  { code: "hy", label: "Armenian" },
  { code: "is", label: "Icelandic" },
  { code: "ka", label: "Georgian" },
  { code: "kk", label: "Kazakh" },
  { code: "lt", label: "Lithuanian" },
  { code: "lv", label: "Latvian" },
  { code: "mk", label: "Macedonian" },
  { code: "ml", label: "Malayalam" },
  { code: "ms", label: "Malay" },
  { code: "nb", label: "Norwegian" },
  { code: "no", label: "Norwegian" },
  { code: "ro", label: "Romanian" },
  { code: "si", label: "Sinhala" },
  { code: "sk", label: "Slovak" },
  { code: "sl", label: "Slovenian" },
  { code: "sq", label: "Albanian" },
  { code: "sr", label: "Serbian" },
  { code: "sv", label: "Swedish" },
  { code: "ta", label: "Tamil" },
  { code: "te", label: "Telugu" },
  { code: "ur", label: "Urdu" },
];

const BY_CODE = new Map(LANGUAGE_OPTIONS.map((l) => [l.code, l.label]));

/** "en" / "en-US" / "eng" → "English"; unknown codes fall back to the upper-cased code. */
export function languageLabel(code: string | undefined | null): string {
  const base = (code ?? "").trim().toLowerCase().split(/[-_]/)[0];
  if (!base) return "Unknown";
  return BY_CODE.get(base) ?? base.toUpperCase();
}

/** True when `languageLabel` knows this code (so callers can prefer a better source for unknown ones). */
export function isKnownLanguage(code: string | undefined | null): boolean {
  const base = (code ?? "").trim().toLowerCase().split(/[-_]/)[0];
  return BY_CODE.has(base);
}

/**
 * A plain language name out of a track name: "Bulgarian", "Bulgarian 2",
 * "Bulgarian (SDH)", "Bulgarian (Forced)" → "Bulgarian". "" when the name
 * isn't just a language word.
 */
export function plainLanguageName(name: string | undefined | null): string {
  const cleaned = (name ?? "")
    .replace(/\((?:sdh|forced|cc|hi)\)/gi, "")
    .replace(/\s+\d+\s*$/, "")
    .trim();
  return /^[A-Za-z][A-Za-z' -]{1,30}$/.test(cleaned) ? cleaned : "";
}
