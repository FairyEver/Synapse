import { z } from "zod"
import {
  systemNotifierSettingsSchema,
  type SystemNotifierSettings,
} from "../../../../app-capabilities/system-notifier/shared/schema"
import { SYSTEM_NOTIFIER_SETTINGS_NAMESPACE } from "../../../../app-capabilities/system-notifier/shared/capability"
import type { JsonFileEnvelope } from "../backends/json"
import { isEnvelopeShape } from "../envelope"
import { migration } from "../migrations"
import type { Migration, NamespaceSchema } from "../types"

/**
 * v1 的通知设置只有一颗总开关，它同时管「这台电脑弹通知」和「同步到账号消息中心」。
 *
 * v2 把它拆成 `enabled`（本机）与 `syncToAccount`（账号同步）两颗，升级时补
 * `syncToAccount: data.enabled` —— 那正是老记录当时的有效行为：关掉过通知的用户不会因为
 * 一次升级突然开始在手机上收到消息，而开着的人立刻拿到跨端投递。
 */
export interface SystemNotifierSettingsEntryV1 extends Record<string, unknown> {
  schemaVersion: 1
  enabled: boolean
  silent: boolean
}

export interface SystemNotifierSettingsEntryV2
  extends SystemNotifierSettings, Record<string, unknown> {}

const systemNotifierSettingsEntryV1Schema = z.object({
  schemaVersion: z.literal(1),
  enabled: z.boolean(),
  silent: z.boolean(),
}).strict()

function isSystemNotifierSettingsEntryV1(
  value: unknown,
): value is SystemNotifierSettingsEntryV1 {
  return systemNotifierSettingsEntryV1Schema.safeParse(value).success
}

function migrateSystemNotifierSettingsEntryV1ToV2(
  data: SystemNotifierSettingsEntryV1,
): SystemNotifierSettingsEntryV2 {
  return {
    schemaVersion: 2,
    enabled: data.enabled,
    silent: data.silent,
    syncToAccount: data.enabled,
  }
}

const systemNotifierSettingsMigrations: readonly Migration[] = [
  migration<SystemNotifierSettingsEntryV1, SystemNotifierSettingsEntryV2>(
    1,
    2,
    migrateSystemNotifierSettingsEntryV1ToV2,
  ),
]

export const systemNotifierSettingsSchemaDefinition: NamespaceSchema<SystemNotifierSettingsEntryV2> = {
  name: SYSTEM_NOTIFIER_SETTINGS_NAMESPACE,
  backend: "json",
  currentVersion: 2,
  migrations: systemNotifierSettingsMigrations,
  validate: (value): value is SystemNotifierSettingsEntryV2 =>
    systemNotifierSettingsSchema.safeParse(value).success,
  encrypted: false,
}

/**
 * 老文件的读取升级。
 *
 * 这个命名空间没有 revive 入口时，`JsonNamespace` 只做信封形状检查，落盘的东西直接交给
 * `validate`（`literal(2)` + `.strict()`）—— 那样一台机器上存过 v1 设置的文件会让
 * `getSingleton()` 抛 `InvalidNamespaceDataError`，读设置没有兜底，通知能力会一起失效。
 */
export function reviveSystemNotifierSettingsEnvelope(
  raw: unknown,
): JsonFileEnvelope<SystemNotifierSettingsEntryV2> | null {
  if (!isEnvelopeShape<Record<string, unknown>>(raw)) return null
  if (raw.schemaVersion === 2) return raw as JsonFileEnvelope<SystemNotifierSettingsEntryV2>

  if (raw.schemaVersion === 1) {
    const singleton = raw.singleton
    if (singleton !== null && !isSystemNotifierSettingsEntryV1(singleton)) return null
    return {
      schemaVersion: 2,
      singleton: singleton ? migrateSystemNotifierSettingsEntryV1ToV2(singleton) : null,
      items: {},
    }
  }

  return null
}
