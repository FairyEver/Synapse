import { describe, expect, it, vi } from "vitest"

import { createVoiceService, VoiceUnavailableError } from "../service"

const logger = { info: vi.fn(), warn: vi.fn() }

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

function createService(responses: readonly (Response | Error)[]) {
  const queue = [...responses]
  const fetchAuthenticated = vi.fn(async () => {
    const next = queue.shift()
    if (!next) throw new Error("unexpected request")
    if (next instanceof Error) throw next
    return next
  })
  return { service: createVoiceService({ fetchAuthenticated, logger }), fetchAuthenticated }
}

describe("desktop voice service", () => {
  it("可用性来自服务端，不是这台机器的设置", async () => {
    const { service, fetchAuthenticated } = createService([jsonResponse({ available: true })])
    await expect(service.getStatus()).resolves.toEqual({ available: true })
    expect(fetchAuthenticated).toHaveBeenCalledWith("/voice/asr", {}, expect.any(String))
  })

  it("服务端不可达时按不可用处理，而不是抛给界面", async () => {
    // 入口不出现，比出现一个点了必然失败的按钮好。
    const { service } = createService([new Error("offline")])
    await expect(service.getStatus()).resolves.toEqual({ available: false })
  })

  it("可用性有缓存，切对话不会每次都去问一遍", async () => {
    const { service, fetchAuthenticated } = createService([jsonResponse({ available: true })])
    await service.getStatus()
    await service.getStatus()
    await service.getStatus()
    expect(fetchAuthenticated).toHaveBeenCalledTimes(1)
  })

  it("读失败不进缓存：网络恢复后要能立刻拿到真话", async () => {
    const { service, fetchAuthenticated } = createService([new Error("offline"), jsonResponse({ available: true })])
    await expect(service.getStatus()).resolves.toEqual({ available: false })
    await expect(service.getStatus()).resolves.toEqual({ available: true })
    expect(fetchAuthenticated).toHaveBeenCalledTimes(2)
  })

  it("服务端返回的形状不对时也算不可用", async () => {
    const { service } = createService([jsonResponse({ available: "yes" })])
    await expect(service.getStatus()).resolves.toEqual({ available: false })
  })

  it("签名把服务端的响应原样交回去", async () => {
    const { service, fetchAuthenticated } = createService([
      jsonResponse({ url: "wss://asr.example/x", voiceId: "v1", expiredAt: 1_700_000_300 }),
    ])
    await expect(service.signSession()).resolves.toEqual({
      url: "wss://asr.example/x",
      voiceId: "v1",
      expiredAt: 1_700_000_300,
    })
    expect(fetchAuthenticated).toHaveBeenCalledWith(
      "/voice/asr/session",
      expect.objectContaining({ method: "POST" }),
      expect.any(String),
    )
  })

  it("服务端说平台没配时抛 VoiceUnavailableError，界面据此隐藏入口", async () => {
    const { service } = createService([
      jsonResponse({ code: "VOICE_ASR_NOT_CONFIGURED", message: "语音识别暂不可用。" }, 503),
    ])
    await expect(service.signSession()).rejects.toBeInstanceOf(VoiceUnavailableError)
  })

  it("响应缺字段时不返回半条会话", async () => {
    const { service } = createService([jsonResponse({ url: "wss://asr.example/x" })])
    await expect(service.signSession()).rejects.toBeInstanceOf(VoiceUnavailableError)
  })

  it("密钥不在桌面侧出现：返回的会话里只有 URL 和 voiceId", async () => {
    const { service } = createService([
      jsonResponse({ url: "wss://asr.example/x?signature=abc", voiceId: "v1", expiredAt: 1 }),
    ])
    const signed = await service.signSession()
    expect(Object.keys(signed).sort()).toEqual(["expiredAt", "url", "voiceId"])
  })
})
