import { describe, expect, it } from "vitest"
import {
  detectSynapseLocale,
  getLocaleFallbackChain,
  normalizeSynapseLocale,
} from "../../src/lib/locale"
import {
  applySynapseConfigPatch,
  createDefaultConfig,
  sanitizeSynapseConfig,
} from "../../src/lib/config"

describe("locale settings", () => {
  it("normalizes CC Connect language aliases and empty auto language", () => {
    expect(normalizeSynapseLocale("")).toBe("auto")
    expect(normalizeSynapseLocale("auto")).toBe("auto")
    expect(normalizeSynapseLocale("english")).toBe("en")
    expect(normalizeSynapseLocale("cn")).toBe("zh")
    expect(normalizeSynapseLocale("zh_cn")).toBe("zh")
    expect(normalizeSynapseLocale("zh-tw")).toBe("zh-TW")
    expect(normalizeSynapseLocale("jp")).toBe("ja")
    expect(normalizeSynapseLocale("spanish")).toBe("es")
    expect(normalizeSynapseLocale("unknown", "en")).toBe("en")
  })

  it("detects language with CC Connect priority and unicode ranges", () => {
    expect(detectSynapseLocale("こんにちは")).toBe("ja")
    expect(detectSynapseLocale("カタカナ")).toBe("ja")
    expect(detectSynapseLocale("你好")).toBe("zh")
    expect(detectSynapseLocale("中文测试")).toBe("zh")
    expect(detectSynapseLocale("¿Cómo estás?")).toBe("es")
    expect(detectSynapseLocale("Niño español")).toBe("es")
    expect(detectSynapseLocale("Hello world")).toBe("en")
    expect(detectSynapseLocale("")).toBe("en")
  })

  it("uses zh-TW to zh to en fallback order", () => {
    expect(getLocaleFallbackChain("zh-TW")).toEqual(["zh-TW", "zh", "en"])
    expect(getLocaleFallbackChain("ja")).toEqual(["ja", "en"])
    expect(getLocaleFallbackChain("auto")).toEqual(["en"])
  })

  it("persists locale through the global config patch", () => {
    const config = createDefaultConfig()
    expect(config.global.locale).toBe("auto")

    const nextConfig = applySynapseConfigPatch(config, {
      global: {
        locale: "zh-TW",
      },
    })

    expect(nextConfig.global.locale).toBe("zh-TW")
  })

  it("sanitizes legacy language into global locale", () => {
    const config = sanitizeSynapseConfig({
      activeRepoUuid: null,
      repositories: [],
      global: {
        themeMode: "light",
        language: "zh",
        projects: [],
      },
    })

    expect(config.global.locale).toBe("zh")
  })
})
