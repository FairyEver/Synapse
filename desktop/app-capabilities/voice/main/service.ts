import type { DataNamespace } from "../../../electron/runtime/data-repo"
import type { VoiceSettingsEntryV1 } from "../../../electron/runtime/data-repo/schemas/voice"
import { normalizeVoiceSettingsEntry } from "../../../electron/runtime/data-repo/schemas/voice"
import {
  newAsrVoiceId,
  signAsrSession,
  type AsrCredentials,
} from "../../../electron/services/voice/asr-signature"
import type {
  VoiceSessionSignInput,
  VoiceSettingsPatch,
  VoiceSettingsView,
  VoiceSignedSession,
} from "../shared/schema"

export type VoiceLogger = {
  info(message: string, meta?: Record<string, unknown>): void
  warn(message: string, meta?: Record<string, unknown>): void
}

/** 只暴露需要的几个动作，方便测试替身，也避免把整个密钥服务拖进来。 */
export type VoiceSecretPort = {
  read(name: string): Promise<string | undefined>
  write(name: string, value: string): Promise<void>
  clear(name: string): Promise<void>
}

export type VoiceServiceDeps = {
  readonly settings: DataNamespace<VoiceSettingsEntryV1>
  readonly secrets: VoiceSecretPort
  readonly secretKeyName: string
  readonly logger: VoiceLogger
}

/**
 * 未配置腾讯云密钥。渲染进程据此把麦克风入口藏起来，不弹错误框。
 *
 * 带 code 是因为它会经手机 intent 的结果回去：手机那边学不到"这台电脑配没配"，
 * 只能从这次失败里知道。没有 code 就会退化成一句"操作没有完成"，用户无从下手。
 */
export class VoiceNotConfiguredError extends Error {
  readonly code = "voice_not_configured"

  constructor() {
    super("电脑上还没有配置语音识别。")
    this.name = "VoiceNotConfiguredError"
  }
}

export function createVoiceService(deps: VoiceServiceDeps) {
  async function readSettings(): Promise<VoiceSettingsEntryV1> {
    const stored = await deps.settings.getSingleton()
    return normalizeVoiceSettingsEntry(stored ?? {})
  }

  async function getSettings(): Promise<VoiceSettingsView> {
    const settings = await readSettings()
    const secretKey = await deps.secrets.read(deps.secretKeyName)
    const hasSecretKey = Boolean(secretKey)
    return {
      appId: settings.appId,
      secretId: settings.secretId,
      engineModelType: settings.engineModelType,
      hotwordList: settings.hotwordList,
      domain: settings.domain,
      hasSecretKey,
      configured: Boolean(settings.appId && settings.secretId && hasSecretKey),
    }
  }

  async function updateSettings(patch: VoiceSettingsPatch): Promise<VoiceSettingsView> {
    const current = await readSettings()
    const { secretKey, ...settingsPatch } = patch
    if (Object.keys(settingsPatch).length > 0) {
      await deps.settings.setSingleton({ ...current, ...settingsPatch })
    }
    // 空串表示"清掉"，不留一条空密钥误导状态判断。
    if (secretKey !== undefined) {
      if (secretKey) await deps.secrets.write(deps.secretKeyName, secretKey)
      else await deps.secrets.clear(deps.secretKeyName)
    }
    return getSettings()
  }

  /**
   * 签一条可直接连接的 URL 给客户端。密钥只在这一步被读出来，算完就留在主进程。
   */
  async function signSession(input: VoiceSessionSignInput): Promise<VoiceSignedSession> {
    const settings = await readSettings()
    const secretKey = await deps.secrets.read(deps.secretKeyName)
    if (!settings.appId || !settings.secretId || !secretKey) throw new VoiceNotConfiguredError()
    const credentials: AsrCredentials = {
      appId: settings.appId,
      secretId: settings.secretId,
      secretKey,
    }
    return signAsrSession(credentials, {
      engineModelType: input.engineModelType ?? settings.engineModelType,
      voiceId: input.voiceId ?? newAsrVoiceId(),
      hotwordList: input.hotwordList ?? settings.hotwordList,
      domain: input.domain ?? settings.domain,
    })
  }

  return { getSettings, updateSettings, signSession }
}

export type VoiceService = ReturnType<typeof createVoiceService>
