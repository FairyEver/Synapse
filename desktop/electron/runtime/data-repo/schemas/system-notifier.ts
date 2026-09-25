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
 * v1 的通知设置只有一颗总开关，它同时管「这台电脑弹通知」和「发到账号」。
 *
 * v2 把它拆成 `enabled`（本机）与 `syncToAccount`（账号），升级时补
 * `syncToAccount: data.enabled` —— 那正是老记录当时的有效行为：关掉过通知的用户不会因为
 * 一次升级突然开始收到消息，而开着的人立刻拿到跨端投递。
 */
export interface SystemNotifierSettingsEntryV1 extends Record<string, unknown> {
  schemaVersion: 1
  enabled: boolean
  silent: boolean
}

export interface SystemNotifierSettingsEntryV2 extends Record<string, unknown> {
  schemaVersion: 2
  enabled: boolean
  silent: boolean
  syncToAccount: boolean
}

export interface SystemNotifierSettingsEntryV3
  extends SystemNotifierSettings, Record<string, unknown> {}

const systemNotifierSettingsEntryV1Schema = z.object({
  schemaVersion: z.literal(1),
  enabled: z.boolean(),
  silent: z.boolean(),
}).strict()

const systemNotifierSettingsEntryV2Schema = z.object({
  schemaVersion: z.literal(2),
  enabled: z.boolean(),
  silent: z.boolean(),
  syncToAccount: z.boolean(),
}).strict()

function isSystemNotifierSettingsEntryV1(
  value: unknown,
): value is SystemNotifierSettingsEntryV1 {
  return systemNotifierSettingsEntryV1Schema.safeParse(value).success
}

function isSystemNotifierSettingsEntryV2(
  value: unknown,
): value is SystemNotifierSettingsEntryV2 {
  return systemNotifierSettingsEntryV2Schema.safeParse(value).success
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

/**
 * v2 → v3 只是改名：字段名原来叫 `enabled` / `syncToAccount`，读起来像「总开关」和
 * 「顺带同步」，而它们实际门控的是「这台电脑弹不弹」和「发不发」。值原样搬过去。
 */
function migrateSystemNotifierSettingsEntryV2ToV3(
  data: SystemNotifierSettingsEntryV2,
): SystemNotifierSettingsEntryV3 {
  return {
    schemaVersion: 3,
    sendEnabled: data.syncToAccount,
    localEnabled: data.enabled,
    silent: data.silent,
  }
}

const systemNotifierSettingsMigrations: readonly Migration[] = [
  migration<SystemNotifierSettingsEntryV1, SystemNotifierSettingsEntryV2>(
    1,
    2,
    migrateSystemNotifierSettingsEntryV1ToV2,
  ),
  migration<SystemNotifierSettingsEntryV2, SystemNotifierSettingsEntryV3>(
    2,
    3,
    migrateSystemNotifierSettingsEntryV2ToV3,
  ),
]

export const systemNotifierSettingsSchemaDefinition: NamespaceSchema<SystemNotifierSettingsEntryV3> = {
  name: SYSTEM_NOTIFIER_SETTINGS_NAMESPACE,
  backend: "json",
  currentVersion: 3,
  migrations: systemNotifierSettingsMigrations,
  validate: (value): value is SystemNotifierSettingsEntryV3 =>
    systemNotifierSettingsSchema.safeParse(value).success,
  encrypted: false,
}

/**
 * 老文件的读取升级。
 *
 * 这个命名空间没有 revive 入口时，`JsonNamespace` 只做信封形状检查，落盘的东西直接交给
 * `validate`（`literal(3)` + `.strict()`）—— 那样一台机器上存过 v1 或 v2 设置的文件会让
 * `getSingleton()` 抛 `InvalidNamespaceDataError`，读设置没有兜底，通知能力会一起失效。
 */
export function reviveSystemNotifierSettingsEnvelope(
  raw: unknown,
): JsonFileEnvelope<SystemNotifierSettingsEntryV3> | null {
  if (!isEnvelopeShape<Record<string, unknown>>(raw)) return null
  if (raw.schemaVersion === 3) return raw as JsonFileEnvelope<SystemNotifierSettingsEntryV3>

  if (raw.schemaVersion === 2) {
    const singleton = raw.singleton
    if (singleton !== null && !isSystemNotifierSettingsEntryV2(singleton)) return null
    return {
      schemaVersion: 3,
      singleton: singleton
        ? migrateSystemNotifierSettingsEntryV2ToV3(singleton)
        : null,
      items: {},
    }
  }

  if (raw.schemaVersion === 1) {
    const singleton = raw.singleton
    if (singleton !== null && !isSystemNotifierSettingsEntryV1(singleton)) return null
    return {
      schemaVersion: 3,
      singleton: singleton
        ? migrateSystemNotifierSettingsEntryV2ToV3(
            migrateSystemNotifierSettingsEntryV1ToV2(singleton),
          )
        : null,
      items: {},
    }
  }

  return null
}
