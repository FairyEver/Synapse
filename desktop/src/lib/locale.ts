import type { SynapseLocale } from "../types/config"

const LOCALE_ALIASES: Record<string, SynapseLocale> = {
  "": "auto",
  auto: "auto",
  en: "en",
  english: "en",
  zh: "zh",
  cn: "zh",
  chinese: "zh",
  "zh-cn": "zh",
  zh_cn: "zh",
  "zh-tw": "zh-TW",
  zh_tw: "zh-TW",
  zhtw: "zh-TW",
  ja: "ja",
  jp: "ja",
  japanese: "ja",
  es: "es",
  spanish: "es",
}

const SPANISH_HINTS = new Set(["ñ", "Ñ", "¿", "¡", "á", "é", "í", "ó", "ú", "ü"])

export function normalizeSynapseLocale(value: unknown, fallback: SynapseLocale = "auto"): SynapseLocale {
  if (typeof value !== "string") {
    return fallback
  }

  return LOCALE_ALIASES[value.trim().toLowerCase()] ?? fallback
}

export function isChineseCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0x4E00 && codePoint <= 0x9FFF)
    || (codePoint >= 0x3400 && codePoint <= 0x4DBF)
    || (codePoint >= 0x20000 && codePoint <= 0x2A6DF)
    || (codePoint >= 0x2A700 && codePoint <= 0x2B73F)
    || (codePoint >= 0x2B740 && codePoint <= 0x2B81F)
    || (codePoint >= 0x2B820 && codePoint <= 0x2CEAF)
    || (codePoint >= 0xF900 && codePoint <= 0xFAFF)
    || (codePoint >= 0x2F800 && codePoint <= 0x2FA1F)
  )
}

export function isJapaneseCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0x3040 && codePoint <= 0x309F)
    || (codePoint >= 0x30A0 && codePoint <= 0x30FF)
    || (codePoint >= 0x31F0 && codePoint <= 0x31FF)
    || (codePoint >= 0xFF65 && codePoint <= 0xFF9F)
  )
}

export function detectSynapseLocale(text: string): Exclude<SynapseLocale, "auto"> {
  for (const char of text) {
    const codePoint = char.codePointAt(0)
    if (codePoint !== undefined && isJapaneseCodePoint(codePoint)) {
      return "ja"
    }
  }

  for (const char of text) {
    const codePoint = char.codePointAt(0)
    if (codePoint !== undefined && isChineseCodePoint(codePoint)) {
      return "zh"
    }
  }

  for (const char of text) {
    if (SPANISH_HINTS.has(char)) {
      return "es"
    }
  }

  return "en"
}

export function resolveSynapseLocale(
  locale: SynapseLocale,
  detectedLocale?: Exclude<SynapseLocale, "auto"> | null,
): Exclude<SynapseLocale, "auto"> {
  if (locale === "auto") {
    return detectedLocale ?? "en"
  }

  return locale
}

export function getLocaleFallbackChain(locale: SynapseLocale): Array<Exclude<SynapseLocale, "auto">> {
  const resolved = resolveSynapseLocale(locale)

  if (resolved === "zh-TW") {
    return ["zh-TW", "zh", "en"]
  }

  if (resolved === "en") {
    return ["en"]
  }

  return [resolved, "en"]
}

export function getLocaleDisplayName(locale: SynapseLocale): string {
  switch (locale) {
    case "en":
      return "English"
    case "zh":
      return "中文"
    case "zh-TW":
      return "繁體中文"
    case "ja":
      return "日本語"
    case "es":
      return "Español"
    case "auto":
      return "Auto"
  }

  return "Auto"
}
