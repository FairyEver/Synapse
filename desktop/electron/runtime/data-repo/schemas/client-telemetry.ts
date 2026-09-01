import type { Migration, NamespaceSchema } from "../types"

export type ClientTelemetryCategory =
  | "lifecycle"
  | "navigation"
  | "interaction"
  | "operation"
  | "error"

export type ClientTelemetryOutcome = "success" | "failure" | "cancelled"

export interface ClientTelemetryOutboxEntryV1 extends Record<string, unknown> {
  id: string
  schemaVersion: 1
  accountUserId: string | null
  category: ClientTelemetryCategory
  eventKey: string
  component: string
  action: string
  outcome?: ClientTelemetryOutcome
  durationMs?: number
  moduleId?: string
  windowType: string
  clientInstanceId: string
  sessionId: string
  appVersion: string
  platform: string
  occurredAt: string
}

const noMigrations: readonly Migration[] = []

export const clientTelemetryOutboxSchema: NamespaceSchema<ClientTelemetryOutboxEntryV1> = {
  name: "telemetry.outbox",
  backend: "sqlite",
  currentVersion: 1,
  migrations: noMigrations,
  validate: isClientTelemetryOutboxEntryV1,
  encrypted: false,
}

function isClientTelemetryOutboxEntryV1(value: unknown): value is ClientTelemetryOutboxEntryV1 {
  if (!isRecord(value)) return false
  return value.schemaVersion === 1
    && isNonEmptyString(value.id)
    && (value.accountUserId === null || isNonEmptyString(value.accountUserId))
    && isCategory(value.category)
    && isNonEmptyString(value.eventKey)
    && isNonEmptyString(value.component)
    && isNonEmptyString(value.action)
    && (value.outcome === undefined || isOutcome(value.outcome))
    && (value.durationMs === undefined || isNonNegativeInteger(value.durationMs))
    && (value.moduleId === undefined || isNonEmptyString(value.moduleId))
    && isNonEmptyString(value.windowType)
    && isNonEmptyString(value.clientInstanceId)
    && isNonEmptyString(value.sessionId)
    && isNonEmptyString(value.appVersion)
    && isNonEmptyString(value.platform)
    && isIsoDateString(value.occurredAt)
}

function isCategory(value: unknown): value is ClientTelemetryCategory {
  return value === "lifecycle"
    || value === "navigation"
    || value === "interaction"
    || value === "operation"
    || value === "error"
}

function isOutcome(value: unknown): value is ClientTelemetryOutcome {
  return value === "success" || value === "failure" || value === "cancelled"
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function isIsoDateString(value: unknown): value is string {
  return isNonEmptyString(value) && !Number.isNaN(Date.parse(value))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
