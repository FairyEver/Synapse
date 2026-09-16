import { voiceSettingsSchema } from "../../../../app-capabilities/voice/shared/schema"
import {
  VOICE_DEFAULT_DOMAIN,
  VOICE_DEFAULT_ENGINE_MODEL_TYPE,
  VOICE_DEFAULT_HOTWORD_LIST,
} from "../../../../app-capabilities/voice/shared/capability"
import type { Migration, NamespaceSchema } from "../types"

const noMigrations: readonly Migration[] = []

export interface VoiceSettingsEntryV1 extends Record<string, unknown> {
  schemaVersion: 1
  appId: string
  secretId: string
  engineModelType: string
  hotwordList: string
  domain: number
}

export const voiceSettingsSchemaDefinition: NamespaceSchema<VoiceSettingsEntryV1> = {
  name: "app.voice.settings",
  backend: "json",
  currentVersion: 1,
  migrations: noMigrations,
  validate: isVoiceSettingsEntryV1,
  encrypted: false,
  defaults: () => defaultVoiceSettingsEntry,
}

/**
 * 凭据留空：腾讯云配置属于用户自己填的东西，装完就是个空表单，麦克风入口在填完
 * 之前不出现。
 */
export const defaultVoiceSettingsEntry: VoiceSettingsEntryV1 = {
  schemaVersion: 1,
  appId: "",
  secretId: "",
  engineModelType: VOICE_DEFAULT_ENGINE_MODEL_TYPE,
  hotwordList: VOICE_DEFAULT_HOTWORD_LIST,
  domain: VOICE_DEFAULT_DOMAIN,
}

function isVoiceSettingsEntryV1(value: unknown): value is VoiceSettingsEntryV1 {
  if (typeof value !== "object" || value === null) return false
  const record = value as Record<string, unknown>
  return record.schemaVersion === 1
    && typeof record.appId === "string"
    && typeof record.secretId === "string"
    && typeof record.engineModelType === "string"
    && typeof record.hotwordList === "string"
    && typeof record.domain === "number"
}

/** 已写盘的文件可能缺后续新增的字段，这里按 schema 补齐默认值。 */
export function normalizeVoiceSettingsEntry(value: unknown): VoiceSettingsEntryV1 {
  const record = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>
  const parsed = voiceSettingsSchema.safeParse({
    appId: typeof record.appId === "string" ? record.appId : "",
    secretId: typeof record.secretId === "string" ? record.secretId : "",
    engineModelType: typeof record.engineModelType === "string" && record.engineModelType.trim()
      ? record.engineModelType
      : VOICE_DEFAULT_ENGINE_MODEL_TYPE,
    hotwordList: typeof record.hotwordList === "string" ? record.hotwordList : VOICE_DEFAULT_HOTWORD_LIST,
    domain: typeof record.domain === "number" ? record.domain : VOICE_DEFAULT_DOMAIN,
  })
  const settings = parsed.success ? parsed.data : defaultVoiceSettingsEntry
  return { schemaVersion: 1, ...settings }
}
