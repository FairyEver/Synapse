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
} from "../../../../app-capabilities/terminal/shared/contract-schema"
import type { NamespaceSchema } from "../types"

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
  blockIds: z.array(z.string().uuid()),
  createdAt: z.string().datetime(),
}).strict()

export type TerminalDeleteIntentEntry = z.infer<typeof terminalDeleteIntentEntrySchema>

const noMigrations = [] as const

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
