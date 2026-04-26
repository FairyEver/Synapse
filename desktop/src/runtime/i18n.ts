/**
 * Phase 0.6 — i18n placeholder.
 * SPEC §15.9.
 *
 * From the SPEC: "硬约束从 Phase 0.6 起：新增用户可见文案必须通过 t(key) 取值
 * （即使目前只有中文字典）". Phase 0 ships an in-memory provider with a single
 * built-in zh-CN dictionary; M5 swaps the dictionaries with real JSON imports
 * + a locale switcher.
 */

export interface I18nProvider {
  readonly locale: string
  t(key: string, params?: Record<string, unknown>): string
  setLocale(locale: string): Promise<void>
  registerDictionary(locale: string, entries: Record<string, string>): void
}

export class InMemoryI18nProvider implements I18nProvider {
  private currentLocale = "zh-CN"
  private readonly dictionaries = new Map<string, Map<string, string>>()

  constructor() {
    // Seed with empty dictionaries so consumers iterating the registry don't
    // need to special-case the initial state.
    this.dictionaries.set("zh-CN", new Map())
  }

  get locale(): string {
    return this.currentLocale
  }

  async setLocale(locale: string): Promise<void> {
    if (!this.dictionaries.has(locale)) {
      throw new Error(`No dictionary registered for locale "${locale}"`)
    }
    this.currentLocale = locale
  }

  registerDictionary(locale: string, entries: Record<string, string>): void {
    const dict = this.dictionaries.get(locale) ?? new Map<string, string>()
    for (const [k, v] of Object.entries(entries)) dict.set(k, v)
    this.dictionaries.set(locale, dict)
  }

  t(key: string, params?: Record<string, unknown>): string {
    const dict = this.dictionaries.get(this.currentLocale)
    const raw = dict?.get(key)
    if (!raw) return key
    if (!params) return raw
    return raw.replace(/\{(\w+)\}/g, (_, p) => {
      const value = params[p]
      return value === undefined ? `{${p}}` : String(value)
    })
  }
}

let defaultProvider: I18nProvider = new InMemoryI18nProvider()

export function setI18nProvider(provider: I18nProvider): void {
  defaultProvider = provider
}

export function t(key: string, params?: Record<string, unknown>): string {
  return defaultProvider.t(key, params)
}
