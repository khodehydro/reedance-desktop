/**
 * Language badges for lyric lines sung in another language than the song
 * (Android `LyricLine.kt`: `alternateLyricLanguage` + tertiary badge).
 */
export const LINE_LANGUAGE_CODES = [
  "en", "es", "ko", "tr", "fr", "de", "it", "pt", "ar", "ja", "zh", "ru", "fa", "hi", "la", "el", "he", "nl", "sv", "pl",
] as const;

const cache = new Map<string, string>();

/** Display name of an ISO code in the UI language ("انگلیسی" / "English"), falling back to the code. */
export function languageName(code: string, uiLang: "fa" | "en"): string {
  const key = `${uiLang}:${code}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let name = code.toUpperCase();
  try {
    const display = new Intl.DisplayNames([uiLang], { type: "language" }).of(code);
    if (display && display.toLowerCase() !== code.toLowerCase()) name = display;
  } catch {
    /* keep the code */
  }
  cache.set(key, name);
  return name;
}
