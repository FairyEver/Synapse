import { describe, expect, it, vi } from "vitest"

import type { DataNamespace } from "../../../../electron/runtime/data-repo"
import type { VoiceSettingsEntryV1 } from "../../../../electron/runtime/data-repo/schemas/voice"
import { defaultVoiceSettingsEntry } from "../../../../electron/runtime/data-repo/schemas/voice"
import {
  createVoiceService,
  VoiceNotConfiguredError,
  type VoiceSecretPort,
} from "../service"

const SECRET_KEY_NAME = "TENCENT_ASR_SECRET_KEY"

function createSettings(initial: VoiceSettingsEntryV1 | null = null) {
  let stored = initial
  return {
    getSingleton: async () => stored,
    setSingleton: vi.fn(async (value: VoiceSettingsEntryV1) => { stored = value }),
    read: () => stored,
  } as unknown as DataNamespace<VoiceSettingsEntryV1> & { read: () => VoiceSettingsEntryV1 | null }
}

function createSecretPort(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial))
  const port: VoiceSecretPort = {
    read: async (name) => values.get(name),
    write: async (name, value) => { values.set(name, value) },
    clear: async (name) => { values.delete(name) },
  }
  return { port, values }
}

const logger = { info: vi.fn(), warn: vi.fn() }

const configured = {
  schemaVersion: 1 as const,
  appId: "1252371654",
  secretId: "AKIDzzzz",
  engineModelType: "16k_zh_en_2.0",
  hotwordList: "Synapse|11",
  domain: 1,
}

function createService(settingsEntry: VoiceSettingsEntryV1 | null, secrets: Record<string, string>) {
  const settings = createSettings(settingsEntry)
  const { port } = createSecretPort(secrets)
  const service = createVoiceService({
    settings,
    secrets: port,
    secretKeyName: SECRET_KEY_NAME,
    logger,
  })
  return { service, settings }
}

describe("voice service", () => {
  it("没配凭据时 status 报告未配置，且不下发密钥", async () => {
    const { service } = createService(null, {})
    const settings = await service.getSettings()
    expect(settings.configured).toBe(false)
    expect(settings.hasSecretKey).toBe(false)
    expect(settings.engineModelType).toBe(defaultVoiceSettingsEntry.engineModelType)
    expect(settings).not.toHaveProperty("secretKey")
  })

  it("只差 secretKey 也算未配置", async () => {
    const { service } = createService({ ...configured }, {})
    expect((await service.getSettings()).configured).toBe(false)
  })

  it("三项齐了才算配置好", async () => {
    const { service } = createService({ ...configured }, { [SECRET_KEY_NAME]: "sk" })
    const settings = await service.getSettings()
    expect(settings.configured).toBe(true)
    expect(settings.hasSecretKey).toBe(true)
    // 密钥值本身永远不出现在视图里。
    expect(JSON.stringify(settings)).not.toContain("sk\"")
  })

  it("未配置时签名抛 VoiceNotConfiguredError，而不是签出坏 URL", async () => {
    const { service } = createService(null, {})
    await expect(service.signSession({})).rejects.toBeInstanceOf(VoiceNotConfiguredError)
  })

  /**
   * 手机拿不到"这台电脑配没配"，只能从这次失败的 code 里知道。`classifyError` 认
   * 的就是 error 上的字符串 `code`，所以这个值本身是一份对外契约 —— 改了它，手机
   * 那边就会退化成一句"操作没有完成"。
   */
  it("未配置的错误带一个手机认得出来的 code", async () => {
    const { service } = createService(null, {})
    const error = await service.signSession({}).catch((cause: unknown) => cause)
    expect(error).toBeInstanceOf(VoiceNotConfiguredError)
    expect((error as VoiceNotConfiguredError).code).toBe("voice_not_configured")
    // 文案也要能直接给用户看，不能是给开发者看的。
    expect((error as Error).message).toContain("语音识别")
  })

  it("签名用的是设置里的引擎与热词", async () => {
    const { service } = createService({ ...configured }, { [SECRET_KEY_NAME]: "secret" })
    const signed = await service.signSession({ voiceId: "voice-1" })
    const params = new URL(signed.url).searchParams
    expect(params.get("engine_model_type")).toBe("16k_zh_en_2.0")
    expect(params.get("hotword_list")).toBe("Synapse|11")
    expect(params.get("domain")).toBe("1")
    expect(params.get("secretid")).toBe("AKIDzzzz")
    expect(signed.voiceId).toBe("voice-1")
  })

  it("调用方可以覆盖引擎，便于实测切换", async () => {
    const { service } = createService({ ...configured }, { [SECRET_KEY_NAME]: "secret" })
    const signed = await service.signSession({ engineModelType: "Hy-ASR-3.0-preview" })
    expect(new URL(signed.url).searchParams.get("engine_model_type")).toBe("Hy-ASR-3.0-preview")
  })

  it("不传 voiceId 时每次生成新的", async () => {
    const { service } = createService({ ...configured }, { [SECRET_KEY_NAME]: "secret" })
    const first = await service.signSession({})
    const second = await service.signSession({})
    expect(first.voiceId).not.toBe(second.voiceId)
  })

  it("签出的 URL 里没有原始密钥，只有 secretid", async () => {
    const { service } = createService({ ...configured }, { [SECRET_KEY_NAME]: "top-secret-value" })
    const signed = await service.signSession({})
    expect(signed.url).not.toContain("top-secret-value")
    expect(signed.url).toContain("secretid=AKIDzzzz")
  })

  it("保存设置时写 secretKey，写空串则清掉而不是留一条空条目", async () => {
    const { service, settings } = createService(null, {})
    await service.updateSettings({ appId: "1", secretId: "2", secretKey: "key-1" })
    expect((await service.getSettings()).configured).toBe(true)
    expect(settings.read()?.appId).toBe("1")

    await service.updateSettings({ secretKey: "" })
    const after = await service.getSettings()
    expect(after.hasSecretKey).toBe(false)
    expect(after.configured).toBe(false)
  })

  it("保存设置不回传 secretKey", async () => {
    const { service } = createService(null, {})
    const view = await service.updateSettings({ appId: "1", secretId: "2", secretKey: "key-1" })
    expect(JSON.stringify(view)).not.toContain("key-1")
  })
})
