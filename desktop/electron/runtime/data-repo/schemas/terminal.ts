import { z } from "zod"

import {
  terminalCommandBodyRecordSchema,
  terminalCommandRecordSchema,
  terminalDomainStateSchema,
  terminalGroupRecordSchema,
  terminalGroupLaunchBodyRecordSchema,
  terminalGlobalLaunchBodyRecordSchema,
  terminalGlobalLaunchRecordSchema,
  terminalIdempotencyRecordSchema,
  terminalLaunchBodyRecordSchema,
  terminalOperationSchema,
  terminalSessionRecordSchema,
  terminalWorkspaceRecordSchema,
  type TerminalCommandBodyRecord,
  type TerminalCommandRecord,
  type TerminalDomainState,
  type TerminalGroupRecord,
  type TerminalGroupLaunchBodyRecord,
  type TerminalGlobalLaunchBodyRecord,
  type TerminalGlobalLaunchRecord,
  type TerminalIdempotencyRecord,
  type TerminalLaunchBodyRecord,
  type TerminalOperation,
  type TerminalSessionRecord,
  type TerminalWorkspaceRecord,
} from "../../../../app-capabilities/terminal/shared/contract-schema"
import {
  TERMINAL_CUSTOM_TOOLBAR_ACTION_LIMIT,
  terminalAgentSessionRecordSchema,
  terminalCustomToolbarActionSchema,
  terminalAgentNotificationSettingsSchema,
  type TerminalAgentNotificationSettings,
  type TerminalAgentSessionRecord,
} from "../../../../app-capabilities/terminal/shared/schema"
import type { JsonFileEnvelope } from "../backends/json"
import { isEnvelopeShape } from "../envelope"
import { migration } from "../migrations"
import type { Migration, NamespaceSchema } from "../types"

const terminalBlockManifestEntrySchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().uuid(),
  blockId: z.string().uuid(),
  sessionId: z.string().uuid(),
  type: z.enum(["output", "checkpoint"]),
  firstOutputSeq: z.number().int().nonnegative(),
  nextOutputSeq: z.number().int().positive(),
  byteLength: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  createdAt: z.string().datetime(),
  encryptionSchemaVersion: z.literal(1),
}).strict()

export type TerminalBlockManifestEntry = z.infer<typeof terminalBlockManifestEntrySchema>

const terminalDeleteIntentEntrySchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().uuid(),
  groupIds: z.array(z.string().uuid()),
  commandIds: z.array(z.string().uuid()),
  sessionIds: z.array(z.string().uuid()),
  workspaceIds: z.array(z.string().uuid()).optional(),
  blockIds: z.array(z.string().uuid()),
  createdAt: z.string().datetime(),
}).strict()

export type TerminalDeleteIntentEntry = z.infer<typeof terminalDeleteIntentEntrySchema>

const terminalToolbarActionsEntrySchema = z.object({
  schemaVersion: z.literal(1),
  id: z.literal("default"),
  items: z.array(terminalCustomToolbarActionSchema).max(TERMINAL_CUSTOM_TOOLBAR_ACTION_LIMIT),
  updatedAt: z.string().datetime(),
}).strict()

export type TerminalToolbarActionsEntry = z.infer<typeof terminalToolbarActionsEntrySchema>

const noMigrations = [] as const

/**
 * v1 的通知设置：只有一颗总开关。
 *
 * v2 把它拆成「记录状态」与「弹系统通知」两颗，所以升级时补一个 `notify: true` —— 那正是
 * 老记录里「打开开关就会弹通知」的既有行为，用户不会因为一次升级发现通知不弹了。
 */
export interface TerminalAgentNotificationSettingsEntryV1 extends Record<string, unknown> {
  schemaVersion: 1
  id: "default"
  enabled: boolean
  revision: number
  updatedAt: string
}

export type TerminalAgentNotificationSettingsEntryV2 = TerminalAgentNotificationSettings

const terminalAgentNotificationSettingsEntryV1Schema = z.object({
  schemaVersion: z.literal(1),
  id: z.literal("default"),
  enabled: z.boolean(),
  revision: z.number().int().positive(),
  updatedAt: z.string().datetime(),
}).strict()

function isTerminalAgentNotificationSettingsEntryV1(
  value: unknown,
): value is TerminalAgentNotificationSettingsEntryV1 {
  return terminalAgentNotificationSettingsEntryV1Schema.safeParse(value).success
}

function migrateTerminalAgentNotificationSettingsEntryV1ToV2(
  data: TerminalAgentNotificationSettingsEntryV1,
): TerminalAgentNotificationSettingsEntryV2 {
  return {
    schemaVersion: 2,
    id: "default",
    enabled: data.enabled,
    notify: true,
    revision: data.revision,
    updatedAt: data.updatedAt,
  }
}

const terminalAgentNotificationSettingsMigrations: readonly Migration[] = [
  migration<TerminalAgentNotificationSettingsEntryV1, TerminalAgentNotificationSettingsEntryV2>(
    1,
    2,
    migrateTerminalAgentNotificationSettingsEntryV1ToV2,
  ),
]

/**
 * 老文件的读取升级。
 *
 * 这个命名空间没有 revive 入口时，`JsonNamespace` 只做信封形状检查，落盘的东西直接交给
 * `validate`（`literal(2)` + `.strict()`）—— 那样一台机器上曾经开过通知的 v1 文件会让
 * `getSingleton()` 抛 `InvalidNamespaceDataError`，而服务读设置没有兜底，等于把服务启动打挂。
 */
export function reviveTerminalAgentNotificationSettingsEnvelope(
  raw: unknown,
): JsonFileEnvelope<TerminalAgentNotificationSettingsEntryV2> | null {
  if (!isEnvelopeShape<Record<string, unknown>>(raw)) return null
  if (raw.schemaVersion === 2) return raw as JsonFileEnvelope<TerminalAgentNotificationSettingsEntryV2>

  if (raw.schemaVersion === 1) {
    const singleton = raw.singleton
    if (singleton !== null && !isTerminalAgentNotificationSettingsEntryV1(singleton)) return null
    return {
      schemaVersion: 2,
      singleton: singleton ? migrateTerminalAgentNotificationSettingsEntryV1ToV2(singleton) : null,
      items: {},
    }
  }

  return null
}

export const terminalAgentNotificationSettingsSchemaDefinition: NamespaceSchema<TerminalAgentNotificationSettings> = {
  name: "app.terminal.agent-notification-settings",
  backend: "json",
  currentVersion: 2,
  migrations: terminalAgentNotificationSettingsMigrations,
  encrypted: false,
  validate: (value): value is TerminalAgentNotificationSettings =>
    terminalAgentNotificationSettingsSchema.safeParse(value).success,
  defaults: () => ({
    schemaVersion: 2,
    id: "default",
    enabled: false,
    notify: true,
    revision: 1,
    updatedAt: new Date(0).toISOString(),
  }),
}

/**
 * Agent 会话档案的元数据。
 *
 * `sqlite` 而不是加密：这里面没有需要保护的东西——会话 id、状态、版本、时间戳，加上一条
 * transcript 的路径。终端输出的正文与检查点从来不走这里，它们只进 `encrypted-block-store`
 * 那一个有界加密块存储。
 */
export const terminalAgentSessionsSchemaDefinition: NamespaceSchema<TerminalAgentSessionRecord> = {
  name: "app.terminal.agent-sessions",
  backend: "sqlite",
  currentVersion: 1,
  migrations: noMigrations,
  encrypted: false,
  validate: (value): value is TerminalAgentSessionRecord =>
    terminalAgentSessionRecordSchema.safeParse(value).success,
}

export const terminalGlobalLaunchSchema: NamespaceSchema<TerminalGlobalLaunchRecord> = {
  name: "app.terminal.global-launch",
  backend: "sqlite",
  currentVersion: 1,
  migrations: noMigrations,
  validate: (value): value is TerminalGlobalLaunchRecord => terminalGlobalLaunchRecordSchema.safeParse(value).success,
}

export const terminalGlobalLaunchBodiesSchema: NamespaceSchema<TerminalGlobalLaunchBodyRecord> = {
  name: "app.terminal.global-launch-bodies",
  backend: "encrypted-json",
  currentVersion: 1,
  migrations: noMigrations,
  encrypted: true,
  validate: (value): value is TerminalGlobalLaunchBodyRecord => terminalGlobalLaunchBodyRecordSchema.safeParse(value).success,
}

export const terminalToolbarActionsSchema: NamespaceSchema<TerminalToolbarActionsEntry> = {
  name: "app.terminal.toolbar-actions",
  backend: "encrypted-json",
  currentVersion: 1,
  migrations: noMigrations,
  encrypted: true,
  validate: (value): value is TerminalToolbarActionsEntry => terminalToolbarActionsEntrySchema.safeParse(value).success,
  defaults: () => ({
    schemaVersion: 1,
    id: "default",
    items: [],
    updatedAt: new Date(0).toISOString(),
  }),
}

export const terminalGroupsSchema: NamespaceSchema<TerminalGroupRecord> = {
  name: "app.terminal.groups",
  backend: "sqlite",
  currentVersion: 2,
  migrations: noMigrations,
  validate: (value): value is TerminalGroupRecord => terminalGroupRecordSchema.safeParse(value).success,
}

export const terminalCommandsSchema: NamespaceSchema<TerminalCommandRecord> = {
  name: "app.terminal.commands",
  backend: "sqlite",
  currentVersion: 2,
  migrations: noMigrations,
  validate: (value): value is TerminalCommandRecord => terminalCommandRecordSchema.safeParse(value).success,
}

export const terminalGroupLaunchBodiesSchema: NamespaceSchema<TerminalGroupLaunchBodyRecord> = {
  name: "app.terminal.group-launch-bodies",
  backend: "encrypted-json",
  currentVersion: 1,
  migrations: noMigrations,
  encrypted: true,
  validate: (value): value is TerminalGroupLaunchBodyRecord => terminalGroupLaunchBodyRecordSchema.safeParse(value).success,
}

export const terminalCommandBodiesSchema: NamespaceSchema<TerminalCommandBodyRecord> = {
  name: "app.terminal.command-bodies",
  backend: "encrypted-json",
  currentVersion: 1,
  migrations: noMigrations,
  encrypted: true,
  validate: (value): value is TerminalCommandBodyRecord => terminalCommandBodyRecordSchema.safeParse(value).success,
}

export const terminalSessionsSchema: NamespaceSchema<TerminalSessionRecord> = {
  name: "app.terminal.sessions",
  backend: "sqlite",
  currentVersion: 2,
  migrations: noMigrations,
  validate: (value): value is TerminalSessionRecord => terminalSessionRecordSchema.safeParse(value).success,
}

export const terminalWorkspacesSchema: NamespaceSchema<TerminalWorkspaceRecord> = {
  name: "app.terminal.workspaces",
  backend: "sqlite",
  currentVersion: 2,
  migrations: noMigrations,
  validate: (value): value is TerminalWorkspaceRecord => terminalWorkspaceRecordSchema.safeParse(value).success,
}

export const terminalLaunchBodiesSchema: NamespaceSchema<TerminalLaunchBodyRecord> = {
  name: "app.terminal.launch-bodies",
  backend: "encrypted-json",
  currentVersion: 1,
  migrations: noMigrations,
  encrypted: true,
  validate: (value): value is TerminalLaunchBodyRecord => terminalLaunchBodyRecordSchema.safeParse(value).success,
}

export const terminalOperationsSchema: NamespaceSchema<TerminalOperation> = {
  name: "app.terminal.operations",
  backend: "sqlite",
  currentVersion: 2,
  migrations: noMigrations,
  validate: (value): value is TerminalOperation => terminalOperationSchema.safeParse(value).success,
}

export const terminalIdempotencySchema: NamespaceSchema<TerminalIdempotencyRecord> = {
  name: "app.terminal.idempotency",
  backend: "sqlite",
  currentVersion: 2,
  migrations: noMigrations,
  validate: (value): value is TerminalIdempotencyRecord => terminalIdempotencyRecordSchema.safeParse(value).success,
}

export const terminalBlocksSchema: NamespaceSchema<TerminalBlockManifestEntry> = {
  name: "app.terminal.blocks",
  backend: "sqlite",
  currentVersion: 1,
  migrations: noMigrations,
  validate: (value): value is TerminalBlockManifestEntry => terminalBlockManifestEntrySchema.safeParse(value).success,
}

export const terminalDeleteIntentsSchema: NamespaceSchema<TerminalDeleteIntentEntry> = {
  name: "app.terminal.delete-intents",
  backend: "sqlite",
  currentVersion: 1,
  migrations: noMigrations,
  validate: (value): value is TerminalDeleteIntentEntry => terminalDeleteIntentEntrySchema.safeParse(value).success,
}

export const terminalDomainStateSchemaDefinition: NamespaceSchema<TerminalDomainState> = {
  name: "app.terminal.domain-state",
  backend: "json",
  currentVersion: 2,
  migrations: noMigrations,
  validate: (value): value is TerminalDomainState => terminalDomainStateSchema.safeParse(value).success,
  defaults: () => ({
    schemaVersion: 2,
    terminalDomainRevision: 0,
    updatedAt: new Date(0).toISOString(),
  }),
}
