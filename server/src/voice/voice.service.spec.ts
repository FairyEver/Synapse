import { ServiceUnavailableException } from "@nestjs/common"
import { describe, expect, it } from "vitest"

import type { VoiceConfig } from "./voice.config"
import { VoiceService } from "./voice.service"

const baseConfig: VoiceConfig = {
  configured: true,
  appId: "1252371654",
  secretId: "AKIDzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz",
  secretKey: "SECRETKEYzzzzzzzzzzzzzzzzzzzzzzzz",
  engineModelType: "Hy-ASR-3.0-preview",
  hotwordList: "SynapseMobile|10,pnpm|10",
}

function createService(config: Partial<VoiceConfig> = {}): VoiceService {
  return new VoiceService({ ...baseConfig, ...config })
}

describe("VoiceService", () => {
  it("可用性跟着配置走", () => {
    expect(createService().availability()).toEqual({ available: true })
    expect(createService({ configured: false }).availability()).toEqual({ available: false })
  })

  it("签出的 URL 用的是服务端配的引擎与热词", () => {
    const signed = createService().createSession()
    const params = new URL(signed.url).searchParams
    expect(params.get("engine_model_type")).toBe("Hy-ASR-3.0-preview")
    expect(params.get("hotword_list")).toBe("SynapseMobile|10,pnpm|10")
    expect(params.get("secretid")).toBe(baseConfig.secretId)
  })

  it("密钥本身不进 URL，且每次都是新的 voiceId", () => {
    const service = createService()
    const first = service.createSession()
    const second = service.createSession()

    expect(first.url).not.toContain(baseConfig.secretKey)
    expect(first.url).toContain("signature=")
    expect(first.voiceId).not.toBe(second.voiceId)
    expect(first.expiredAt).toBeGreaterThan(0)
  })

  it("没配密钥时抛 503 并带 code，而不是签出一条坏 URL", () => {
    const service = createService({ configured: false, appId: undefined, secretId: undefined, secretKey: undefined })

    let caught: unknown
    try {
      service.createSession()
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(ServiceUnavailableException)
    expect((caught as ServiceUnavailableException).getResponse()).toMatchObject({
      code: "VOICE_ASR_NOT_CONFIGURED",
    })
  })

  it("少一项也算没配：不做部分启用", () => {
    // `configured` 是 env 层算出来的，但服务自己也要认三项，别信一个布尔值。
    for (const missing of ["appId", "secretId", "secretKey"] as const) {
      const service = createService({ [missing]: undefined })
      expect(() => service.createSession()).toThrow(ServiceUnavailableException)
    }
  })
})
