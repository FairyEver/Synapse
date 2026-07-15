import { createHash } from "node:crypto"
import {
  UnsupportedFutureVersionError,
  VersionedDataMigrator,
  type DataMigrationRegistry,
  type VersionedData,
} from "@synapse/shared/versioned-data-migrator"
import type { WorkflowDefinition } from "../../../src/types/workflow"
import { nodeTypeRegistry } from "../../../workflow-nodes/registry"
import { LOCAL_CLAUDE_CODE_PROVIDER_ID } from "../provider/types"

export const WORKFLOW_SCHEMA_VERSION = "1.0.0"
export const WORKFLOW_LEGACY_BASELINE_VERSION = "0.0.0"

type VersionedWorkflowDefinition = WorkflowDefinition & VersionedData & Record<string, unknown>

export type WorkflowDocumentMigrationResult =
  | {
      readonly kind: "current"
      readonly document: VersionedWorkflowDefinition
      readonly sourceVersion: string
      readonly migrated: boolean
    }
  | {
      readonly kind: "unsupported_future"
      readonly sourceVersion: string
      readonly targetVersion: string
      readonly error: Error
    }
  | {
      readonly kind: "failed"
      readonly sourceVersion?: string
      readonly error: Error
    }

const workflowMigrations: DataMigrationRegistry<VersionedWorkflowDefinition> = {
  "1.0.0": migrateLegacyWorkflowToV1,
}

export function migrateWorkflowDocument(source: unknown): WorkflowDocumentMigrationResult {
  let sourceVersion: string | undefined
  try {
    sourceVersion = VersionedDataMigrator.readSchemaVersion(
      source,
      WORKFLOW_LEGACY_BASELINE_VERSION,
    )
    const document = VersionedDataMigrator.migrate<VersionedWorkflowDefinition>({
      source: source as VersionedWorkflowDefinition,
      sourceVersion,
      targetVersion: WORKFLOW_SCHEMA_VERSION,
      migrations: workflowMigrations,
      legacyBaselineVersion: WORKFLOW_LEGACY_BASELINE_VERSION,
      validate: assertCurrentWorkflowDocument,
    })
    return {
      kind: "current",
      document,
      sourceVersion,
      migrated: sourceVersion !== WORKFLOW_SCHEMA_VERSION,
    }
  } catch (error) {
    const normalized = error instanceof Error ? error : new Error(String(error))
    if (normalized instanceof UnsupportedFutureVersionError) {
      return {
        kind: "unsupported_future",
        sourceVersion: normalized.sourceVersion,
        targetVersion: normalized.targetVersion,
        error: normalized,
      }
    }
    return { kind: "failed", sourceVersion, error: normalized }
  }
}

export function migrateWorkflowDocumentOrThrow(source: unknown): VersionedWorkflowDefinition {
  const result = migrateWorkflowDocument(source)
  if (result.kind === "current") return result.document
  throw result.error
}

export function workflowDocumentDigest(source: unknown): string {
  return createHash("sha256").update(JSON.stringify(source)).digest("hex")
}

export function workflowMigrationVersions(): readonly string[] {
  return Object.keys(workflowMigrations)
}

function migrateLegacyWorkflowToV1(source: VersionedWorkflowDefinition): VersionedWorkflowDefinition {
  const document = source as Record<string, unknown>
  delete document.schemaVersion
  delete document.loadError

  for (const key of ["description", "defaultProjectId", "defaultProviderId"]) {
    if (document[key] !== undefined && typeof document[key] !== "string") delete document[key]
  }
  if (
    document.defaultModelTier !== undefined
    && !["default", "haiku", "sonnet", "opus"].includes(String(document.defaultModelTier))
  ) {
    delete document.defaultModelTier
  }
  if (typeof document.defaultNodeTimeoutMins === "string" && /^[1-9]\d*$/.test(document.defaultNodeTimeoutMins.trim())) {
    document.defaultNodeTimeoutMins = Number(document.defaultNodeTimeoutMins.trim())
  } else if (
    document.defaultNodeTimeoutMins !== undefined
    && (!Number.isInteger(document.defaultNodeTimeoutMins) || Number(document.defaultNodeTimeoutMins) <= 0)
  ) {
    delete document.defaultNodeTimeoutMins
  }

  if (Array.isArray(document.params)) {
    for (const value of document.params) {
      if (isRecord(value) && value.default === undefined) value.default = null
    }
  }

  let migratedClaudeCodeAgent = false
  if (Array.isArray(document.nodes)) {
    for (const value of document.nodes) {
      if (!isRecord(value) || (value.type !== "prompt" && value.type !== "switch") || !isRecord(value.config)) {
        continue
      }
      if (!("agent" in value.config)) continue
      if (value.config.agent !== "claude-code") {
        throw new Error(`Unsupported legacy workflow agent on node "${String(value.id ?? "unknown")}".`)
      }
      delete value.config.agent
      migratedClaudeCodeAgent = true
    }
  }

  if (migratedClaudeCodeAgent) {
    if (typeof document.defaultProviderId !== "string" || !document.defaultProviderId) {
      document.defaultProviderId = LOCAL_CLAUDE_CODE_PROVIDER_ID
    }
    if (typeof document.defaultModelTier !== "string" || !document.defaultModelTier) {
      document.defaultModelTier = "default"
    }
  }
  return source
}

function assertCurrentWorkflowDocument(value: unknown): asserts value is VersionedWorkflowDefinition {
  if (!isRecord(value)) throw new Error("Workflow document must be an object.")
  if (!isRecord(value.meta) || value.meta.schemaVersion !== WORKFLOW_SCHEMA_VERSION) {
    throw new Error("Workflow document schema version is invalid.")
  }
  assertNonEmptyString(value.id, "id")
  assertString(value.name, "name")
  assertString(value.version, "version")
  assertNumber(value.createdAt, "createdAt")
  assertNumber(value.updatedAt, "updatedAt")
  assertOptionalString(value.description, "description")
  assertOptionalString(value.defaultProjectId, "defaultProjectId")
  assertOptionalString(value.defaultProviderId, "defaultProviderId")
  if (
    value.defaultModelTier !== undefined
    && !["default", "haiku", "sonnet", "opus"].includes(String(value.defaultModelTier))
  ) {
    throw new Error("Workflow field \"defaultModelTier\" has an invalid value.")
  }
  if (
    value.defaultNodeTimeoutMins !== undefined
    && (!Number.isInteger(value.defaultNodeTimeoutMins) || Number(value.defaultNodeTimeoutMins) <= 0)
  ) {
    throw new Error("Workflow field \"defaultNodeTimeoutMins\" must be a positive integer.")
  }
  if (!Array.isArray(value.params)) throw new Error("Workflow params must be an array.")
  if (!Array.isArray(value.nodes)) throw new Error("Workflow nodes must be an array.")
  if (!Array.isArray(value.edges)) throw new Error("Workflow edges must be an array.")

  for (const [index, param] of value.params.entries()) {
    if (!isRecord(param)) throw new Error(`Workflow param ${index} must be an object.`)
    assertString(param.name, `params[${index}].name`)
    if (!["text", "number", "file", "directory", "option"].includes(String(param.type))) {
      throw new Error(`Workflow param ${index} has an invalid type.`)
    }
    if (!("default" in param)) throw new Error(`Workflow param ${index} is missing default.`)
    if (!isWorkflowParamDefault(param.default)) {
      throw new Error(`Workflow param ${index} has an invalid default value.`)
    }
    assertOptionalString(param.description, `params[${index}].description`)
    if (param.options !== undefined && !isStringArray(param.options)) {
      throw new Error(`Workflow param ${index} options must be a string array.`)
    }
    assertOptionalBoolean(param.allowCustomOption, `params[${index}].allowCustomOption`)
    assertOptionalBoolean(param.allowMultiple, `params[${index}].allowMultiple`)
  }

  const knownNodeTypes = new Set(nodeTypeRegistry.listTypes())
  for (const [index, node] of value.nodes.entries()) {
    if (!isRecord(node)) throw new Error(`Workflow node ${index} must be an object.`)
    assertNonEmptyString(node.id, `nodes[${index}].id`)
    assertString(node.name, `nodes[${index}].name`)
    assertNonEmptyString(node.type, `nodes[${index}].type`)
    if (knownNodeTypes.size > 0 && !knownNodeTypes.has(node.type)) {
      throw new Error(`Unknown workflow node type "${node.type}".`)
    }
    if (!isRecord(node.position)) throw new Error(`Workflow node ${index} position is invalid.`)
    assertNumber(node.position.x, `nodes[${index}].position.x`)
    assertNumber(node.position.y, `nodes[${index}].position.y`)
    if (!isRecord(node.config)) throw new Error(`Workflow node ${index} config is invalid.`)
  }

  for (const [index, edge] of value.edges.entries()) {
    if (!isRecord(edge)) throw new Error(`Workflow edge ${index} must be an object.`)
    assertString(edge.id, `edges[${index}].id`)
    assertString(edge.from, `edges[${index}].from`)
    assertString(edge.to, `edges[${index}].to`)
    if (edge.branch !== undefined) assertString(edge.branch, `edges[${index}].branch`)
  }
}

function assertString(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string") throw new Error(`Workflow field "${field}" must be a string.`)
}

function assertNonEmptyString(value: unknown, field: string): asserts value is string {
  assertString(value, field)
  if (!value) throw new Error(`Workflow field "${field}" cannot be empty.`)
}

function assertNumber(value: unknown, field: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Workflow field "${field}" must be a finite number.`)
  }
}

function assertOptionalString(value: unknown, field: string): void {
  if (value !== undefined) assertString(value, field)
}

function assertOptionalBoolean(value: unknown, field: string): void {
  if (value !== undefined && typeof value !== "boolean") {
    throw new Error(`Workflow field "${field}" must be a boolean.`)
  }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
}

function isWorkflowParamDefault(value: unknown): boolean {
  if (value === null || typeof value === "string") return true
  if (typeof value === "number") return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(isWorkflowResourceRef)
  return isWorkflowResourceRef(value)
}

function isWorkflowResourceRef(value: unknown): boolean {
  if (!isRecord(value)) return false
  if (value.kind === "local_path") {
    return isResourceEntryType(value.entryType) && typeof value.path === "string"
  }
  if (value.kind === "drive") {
    return isResourceEntryType(value.entryType)
      && typeof value.id === "string"
      && (value.versionId === undefined || typeof value.versionId === "string")
  }
  if (value.kind === "staged") {
    return isResourceEntryType(value.entryType) && typeof value.id === "string"
  }
  if (value.kind === "inline_file") {
    return value.entryType === "file"
      && typeof value.name === "string"
      && typeof value.base64 === "string"
      && (value.mimeType === undefined || typeof value.mimeType === "string")
  }
  return false
}

function isResourceEntryType(value: unknown): boolean {
  return value === "file" || value === "directory"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
