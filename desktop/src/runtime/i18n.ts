import {
  getLocaleFallbackChain,
  normalizeSynapseLocale,
} from "@/lib/locale"
import type { SynapseLocale } from "@/types/config"

export interface I18nProvider {
  readonly locale: SynapseLocale
  t(key: string, params?: Record<string, unknown>): string
  setLocale(locale: string): Promise<void>
  registerDictionary(locale: string, entries: Record<string, string>): void
}

export class InMemoryI18nProvider implements I18nProvider {
  private currentLocale: SynapseLocale = "auto"
  private readonly dictionaries = new Map<SynapseLocale, Map<string, string>>()

  constructor() {
    this.dictionaries.set("en", new Map())
  }

  get locale(): SynapseLocale {
    return this.currentLocale
  }

  async setLocale(locale: string): Promise<void> {
    this.currentLocale = normalizeSynapseLocale(locale)
  }

  registerDictionary(locale: string, entries: Record<string, string>): void {
    const normalizedLocale = normalizeSynapseLocale(locale)
    const dict = this.dictionaries.get(normalizedLocale) ?? new Map<string, string>()
    for (const [k, v] of Object.entries(entries)) dict.set(k, v)
    this.dictionaries.set(normalizedLocale, dict)
  }

  t(key: string, params?: Record<string, unknown>): string {
    let raw: string | undefined

    for (const locale of getLocaleFallbackChain(this.currentLocale)) {
      raw = this.dictionaries.get(locale)?.get(key)
      if (raw) {
        break
      }
    }

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

export async function setLocale(locale: string): Promise<void> {
  await defaultProvider.setLocale(locale)
}
