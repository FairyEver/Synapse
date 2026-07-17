import { createHash, randomUUID } from "node:crypto"
import { constants } from "node:fs"
import { lstat, open } from "node:fs/promises"
import path from "node:path"
import { BrowserWindow, dialog } from "electron"
import { z } from "zod"
import type { IpcModule } from "../../runtime/ipc/types"
import type { AuditSink, PermissionAction, PermissionGuard } from "../../runtime/security"
import {
  workflowReadError,
  type WorkflowDefaultProviderModel,
  type WorkflowService,
} from "../../services/workflow/workflow-service"
import type { WorkflowParamPresetService } from "../../services/workflow/workflow-param-preset-service"
import type { WorkflowPackageService } from "../../services/workflow/workflow-package-service"
import type { WorkflowEngine } from "../../services/workflow/workflow-engine"
import type { RunSnapshotService } from "../../services/workflow/run-snapshot-service"
import type { WorkflowWindowManager } from "../../services/workflow/window-manager"
import type { EventBus } from "../../runtime/event-bus"
import { configuredWorkflowProjectIdsFromConfig, validateWorkflow, validateWorkflowWithResourceDefaults, type WorkflowValidationOptions } from "../../services/workflow/workflow-validator"
import { normalizeWorkflowRunParams } from "../../services/workflow/workflow-param-normalizer"
import { migrateWorkflowDocument } from "../../services/workflow/workflow-document-migration"
import { WORKFLOW_MULTI_RESOURCE_PARAM_MAX_ITEMS } from "../../../config"
import { truncateWithEllipsis } from "../../services/workflow/workflow-utils"
import type { NodeRunResult, WorkflowDefinition, WorkflowEvent, WorkflowRunListItem, WorkflowRunStatus, WorkflowRunSnapshot } from "../../../src/types/workflow"
import type { SynapseWorkflowPackage, WorkflowImportOptions, WorkflowModelMapping } from "../../../src/types/workflow-package"
import { createMainLogger } from "../../services/log-store"
import { configStore } from "../../services/config-store"
import { sanitizeError } from "../../services/error-sanitize"
import { hasSameFileSnapshot } from "../../services/fs-utils"
import { isSafeWorkflowId, isSafeWorkflowNodeId, isSafeWorkflowRunId } from "../../services/workflow/workflow-id"
import { sanitizeNodeResultsForSnapshot, sanitizeWorkflowDefinitionForSnapshot, sanitizeWorkflowEventForRenderer, sanitizeWorkflowOutputForHistory, sanitizeWorkflowRunSnapshot, sanitizeWorkflowRunStatus } from "../../services/workflow/run-snapshot-sanitize"
import { checkCapabilityPermission } from "../../capabilities/permission-audit"
import { rendererBaseUrl } from "../shared/renderer-base-url"

const logger = createMainLogger("workflow.ipc")
const DELETE_ABORT_WAIT_MS = 5_000
const ACTIVE_RUN_ABORT_TIMEOUT_MESSAGE = "旧运行仍在后台执行，请等待取消完成后再重新运行"
const DELETE_ACTIVE_RUN_ABORT_TIMEOUT_MESSAGE = "旧运行仍在后台执行，请等待取消完成后再删除工作流"
const WORKFLOW_PACKAGE_MAX_BYTES = 1024 * 1024
const runCompletions = new Map<string, Promise<unknown>>()
const deletedWorkflows = new Set<string>()
const REDACTED_WORKFLOW_CONFIG_VALUE = "[redacted]"
const REDACTED_WORKFLOW_SENSITIVE_KEY_PATTERN = /^(authorization|cookie|set-cookie|.*(?:secret|token|password|credential|api[-_]?key|session[-_]?key).*)$/i

/**
 * Maximum number of terminal (completed/failed/cancelled) run statuses to keep
 * per workflow in the in-memory map. Older entries are pruned to prevent
 * unbounded memory growth during long sessions.
 */
const MAX_TERMINAL_STATUSES_PER_WORKFLOW = 5

/**
 * Prune old terminal run statuses for a given workflow, keeping only the most
 * recent MAX_TERMINAL_STATUSES_PER_WORKFLOW entries. Running entries are never pruned.
 */
function pruneTerminalStatuses(runStatuses: Map<string, WorkflowRunStatus>, workflowId: string): void {
  const terminalEntries: Array<{ runId: string; endedAt: number }> = []
  for (const [runId, status] of runStatuses) {
    if (status.workflowId === workflowId && status.status !== "running") {
      terminalEntries.push({ runId, endedAt: status.endedAt ?? status.startedAt })
    }
  }
  if (terminalEntries.length <= MAX_TERMINAL_STATUSES_PER_WORKFLOW) return
  // Sort oldest first, prune excess
  terminalEntries.sort((a, b) => a.endedAt - b.endedAt)
  const toRemove = terminalEntries.slice(0, terminalEntries.length - MAX_TERMINAL_STATUSES_PER_WORKFLOW)
  for (const { runId } of toRemove) {
    runStatuses.delete(runId)
  }
  logger.info("pruned stale run statuses", { workflowId, removed: toRemove.length, remaining: terminalEntries.length - toRemove.length })
}

function engineRejectionDiagnostic(error: unknown): {
  readonly errorName: string
  readonly errorLength: number
  readonly stackLength?: number
} {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorLength: error.message.length,
      stackLength: error.stack?.length,
    }
  }
  const text = String(error)
  return {
    errorName: typeof error,
    errorLength: text.length,
  }
}

function visibleEngineRejectionError(error: unknown): string {
  const errorName = error instanceof Error ? error.name : typeof error
  const rawMessage = error instanceof Error ? error.message : String(error)
  const sanitized = sanitizeError(rawMessage)
  const brief = truncateWithEllipsis(sanitized, 120)
  return `引擎异常（${errorName}）：${brief}`
}

function sanitizeWorkflowRunStatusForRenderer(status: WorkflowRunStatus): WorkflowRunStatus {
  return sanitizeWorkflowRunStatus(status)
}

function runStatusToListItem(status: WorkflowRunStatus): WorkflowRunListItem {
  const sanitized = sanitizeWorkflowRunStatusForRenderer(status)
  return {
    runId: sanitized.runId,
    workflowId: sanitized.workflowId,
    status: sanitized.status,
    nodeResults: sanitized.nodeResults,
    startedAt: sanitized.startedAt,
    endedAt: sanitized.endedAt,
    durationMs: sanitized.durationMs,
    error: sanitized.error,
    params: sanitized.params,
    definition: sanitized.definition,
    definitionMigration: sanitized.definitionMigration,
  }
}

function snapshotToListItem(snapshot: WorkflowRunSnapshot): WorkflowRunListItem {
  return {
    runId: snapshot.runId,
    workflowId: snapshot.workflowId,
    status: snapshot.status,
    nodeResults: snapshot.nodeResults,
    startedAt: snapshot.startedAt,
    endedAt: snapshot.endedAt,
    durationMs: snapshot.endedAt ? snapshot.endedAt - snapshot.startedAt : undefined,
    error: snapshot.error,
    params: snapshot.params,
    definition: snapshot.definition,
    definitionMigration: snapshot.definitionMigration,
  }
}

function hasRedactedCodexConfigOverrides(definition: WorkflowDefinition): boolean {
  return definition.nodes.some((node) => {
    if (node.type !== "codex") return false
    const configOverrides = node.config.configOverrides
    if (!Array.isArray(configOverrides)) return false
    return configOverrides.some((entry) =>
      typeof entry === "object"
      && entry !== null
      && (entry as { value?: unknown }).value === REDACTED_WORKFLOW_CONFIG_VALUE
    )
  })
}

function getRedactedWorkflowConfigKind(definition: WorkflowDefinition): "codex" | "workflow" | null {
  if (hasRedactedCodexConfigOverrides(definition)) return "codex"
  if (hasRedactedHttpOrScriptConfig(definition)) return "workflow"
  return null
}

function hasRedactedHttpOrScriptConfig(definition: WorkflowDefinition): boolean {
  return definition.nodes.some((node) => {
    if (node.type === "script") {
      const env = node.config.env
      return typeof env === "object"
        && env !== null
        && Object.values(env).some((value) => value === REDACTED_WORKFLOW_CONFIG_VALUE)
    }
    if (node.type === "http_request") {
      return hasRedactedSensitiveConfigValue(node.config)
    }
    return false
  })
}

function hasRedactedSensitiveConfigValue(value: unknown, key = ""): boolean {
  if (typeof value === "string") {
    return value === REDACTED_WORKFLOW_CONFIG_VALUE
      && REDACTED_WORKFLOW_SENSITIVE_KEY_PATTERN.test(key)
  }
  if (value === null || value === undefined || typeof value !== "object") return false
  if (Array.isArray(value)) {
    return value.some((item) => hasRedactedSensitiveConfigValue(item, key))
  }
  return Object.entries(value).some(([entryKey, entryValue]) => {
    if (
      entryKey === "body"
      && typeof entryValue === "string"
      && entryValue.includes(REDACTED_WORKFLOW_CONFIG_VALUE)
    ) {
      return true
    }
    return hasRedactedSensitiveConfigValue(entryValue, entryKey)
  })
}

function listActiveRunItems(runStatuses: Map<string, WorkflowRunStatus>, workflowId?: string): WorkflowRunListItem[] {
  return [...runStatuses.values()]
    .filter((status) => status.status === "running")
    .filter((status) => workflowId === undefined || status.workflowId === workflowId)
    .map(runStatusToListItem)
    .sort(compareRunListItems)
}

function listHistoryMemoryRunItems(runStatuses: Map<string, WorkflowRunStatus>, workflowId: string): WorkflowRunListItem[] {
  return [...runStatuses.values()]
    .filter((status) => status.workflowId === workflowId)
    .filter((status) => status.status === "running" || status.status === "completed" || status.status === "failed" || status.status === "cancelled")
    .map(runStatusToListItem)
    .sort(compareRunListItems)
}

function mergeRunHistoryItems(
  memoryItems: readonly WorkflowRunListItem[],
  snapshotItems: readonly WorkflowRunListItem[],
): WorkflowRunListItem[] {
  const byRunId = new Map<string, WorkflowRunListItem>()
  for (const item of memoryItems) byRunId.set(item.runId, item)
  for (const item of snapshotItems) byRunId.set(item.runId, item)
  return [...byRunId.values()].sort(compareRunListItems)
}

function compareRunListItems(a: WorkflowRunListItem, b: WorkflowRunListItem): number {
  if (a.status === "running" && b.status !== "running") return -1
  if (a.status !== "running" && b.status === "running") return 1
  return b.startedAt - a.startedAt
}

function focusedWindow(): Electron.BrowserWindow | undefined {
  return BrowserWindow.getFocusedWindow()
    ?? BrowserWindow.getAllWindows().find((window) => window.isVisible() && !window.isDestroyed())
    ?? undefined
}

async function checkFilePermission(options: {
  readonly ctx: Parameters<IpcModule["methods"][string]["handler"]>[0]
  readonly action: PermissionAction
  readonly resource: string
  readonly source: string
}): Promise<AuditSink> {
  const permissionGuard = options.ctx.resolve<PermissionGuard>("core.permission-guard")
  const auditSink = options.ctx.resolve<AuditSink>("core.audit-sink")
  const permission = await permissionGuard.check({
    action: options.action,
    actor: { kind: "user" },
    resource: options.resource,
    context: { source: options.source },
  })
  if (!permission.allowed) {
    auditSink.record({
      action: options.action,
      actor: { kind: "user" },
      resource: options.resource,
      outcome: "denied",
      metadata: {
        source: options.source,
        reason: permission.reason,
        policyId: permission.policyId,
      },
    })
    throw new Error(permission.reason)
  }
  auditSink.record({
    action: options.action,
    actor: { kind: "user" },
    resource: options.resource,
    outcome: "allowed",
    metadata: { source: options.source },
  })
  return auditSink
}

function recordFilePermissionFailure(options: {
  readonly auditSink: AuditSink
  readonly action: PermissionAction
  readonly resource: string
  readonly source: string
  readonly error: unknown
}): void {
  const message = options.error instanceof Error ? options.error.message : String(options.error)
  options.auditSink.record({
    action: options.action,
    actor: { kind: "user" },
    resource: options.resource,
    outcome: "failed",
    metadata: {
      source: options.source,
      errorName: options.error instanceof Error ? options.error.name : typeof options.error,
      errorLength: message.length,
    },
  })
}

type WorkflowImportMutationAudit = {
  readonly auditSink: AuditSink
  readonly actor: { readonly kind: "user" }
  readonly resource: "workflow:import"
  readonly metadata: {
    readonly source: "workflow.importPackage"
    readonly workflowAction: "workflow.importPackage"
    readonly boundary: "workflow.ipc"
  }
}

async function authorizeWorkflowImportMutation(
  ctx: Parameters<IpcModule["methods"][string]["handler"]>[0],
): Promise<WorkflowImportMutationAudit> {
  const permissionGuard = ctx.resolve<PermissionGuard>("core.permission-guard")
  const auditSink = ctx.resolve<AuditSink>("core.audit-sink")
  const audit: WorkflowImportMutationAudit = {
    auditSink,
    actor: { kind: "user" },
    resource: "workflow:import",
    metadata: {
      source: "workflow.importPackage",
      workflowAction: "workflow.importPackage",
      boundary: "workflow.ipc",
    },
  }
  const permission = await checkCapabilityPermission({
    permissionGuard,
    auditSink,
    action: "workflow.mutate",
    actor: audit.actor,
    resource: audit.resource,
    context: audit.metadata,
  })
  if (permission && !permission.allowed) {
    auditSink.record({
      action: "workflow.mutate",
      actor: audit.actor,
      resource: audit.resource,
      outcome: "denied",
      metadata: {
        ...audit.metadata,
        reason: permission.reason,
        policyId: permission.policyId,
      },
    })
    throw new Error(permission.reason)
  }
  return audit
}

function recordWorkflowImportMutation(
  audit: WorkflowImportMutationAudit,
  outcome: "allowed" | "failed",
  metadata: Record<string, unknown>,
): void {
  audit.auditSink.record({
    action: "workflow.mutate",
    actor: audit.actor,
    resource: audit.resource,
    outcome,
    metadata: {
      ...audit.metadata,
      ...metadata,
    },
  })
}

function parseWorkflowPackageOrFail(options: {
  readonly raw: unknown
  readonly auditSink: AuditSink
  readonly action: PermissionAction
  readonly resource: string
  readonly source: "workflow.inspectImportPackage" | "workflow.importPackage"
  readonly fileBase: string
  readonly mappingCount?: number
}): SynapseWorkflowPackage {
  try {
    return workflowPackageSchema.parse(options.raw) as SynapseWorkflowPackage
  } catch (error) {
    recordFilePermissionFailure({
      auditSink: options.auditSink,
      action: options.action,
      resource: options.resource,
      source: options.source,
      error,
    })
    logger.warn(`${options.source.replace("workflow.", "workflow:")} schema validation failed`, {
      fileBase: options.fileBase,
      ...(options.mappingCount === undefined ? {} : { mappingCount: options.mappingCount }),
      errorName: error instanceof Error ? error.name : typeof error,
      errorLength: (error instanceof Error ? error.message : String(error)).length,
    })
    throw new Error("工作流包格式无效。", { cause: error })
  }
}

async function readWorkflowPackageFile(packagePath: string): Promise<{ raw: unknown; digest: string }> {
  const expected = await lstat(packagePath, { bigint: true })
  if (expected.isSymbolicLink()) {
    throw new Error("工作流包不能是符号链接。")
  }
  if (!expected.isFile()) {
    throw new Error("工作流包必须是普通文件。")
  }
  if (expected.size > BigInt(WORKFLOW_PACKAGE_MAX_BYTES)) {
    throw new Error("工作流包文件过大。")
  }

  const noFollowFlag = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0
  const nonBlockingFlag = typeof constants.O_NONBLOCK === "number" ? constants.O_NONBLOCK : 0
  const handle = await open(packagePath, constants.O_RDONLY | noFollowFlag | nonBlockingFlag)
  let text: string
  try {
    const opened = await handle.stat({ bigint: true })
    if (!opened.isFile() || !hasSameFileSnapshot(expected, opened)) {
      throw new Error("工作流包在读取前发生变化，请重新选择文件。")
    }

    const buffer = Buffer.alloc(Number(opened.size))
    let offset = 0
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset)
      if (bytesRead === 0) break
      offset += bytesRead
    }
    text = buffer.subarray(0, offset).toString("utf8")

    const [afterRead, pathAfterRead] = await Promise.all([
      handle.stat({ bigint: true }),
      lstat(packagePath, { bigint: true }),
    ])
    if (
      pathAfterRead.isSymbolicLink()
      || !pathAfterRead.isFile()
      || !hasSameFileSnapshot(expected, afterRead)
      || !hasSameFileSnapshot(expected, pathAfterRead)
    ) {
      throw new Error("工作流包在读取期间发生变化，请重新选择文件。")
    }
  } finally {
    await handle.close()
  }

  if (Buffer.byteLength(text, "utf8") > WORKFLOW_PACKAGE_MAX_BYTES) {
    throw new Error("工作流包文件过大。")
  }
  return {
    raw: JSON.parse(text),
    digest: `sha256:${createHash("sha256").update(text).digest("hex")}`,
  }
}

function saveRunSnapshot(
  snapshots: RunSnapshotService,
  snapshot: Parameters<RunSnapshotService["save"]>[0],
  eventBus?: EventBus,
): void {
  // If the workflow has been deleted (tombstone is set), skip snapshot writes
  // to prevent a late-finishing engine run from re-creating the deleted
  // workflow-runs directory via RunSnapshotService.save() → mkdir().
  if (deletedWorkflows.has(snapshot.workflowId)) return
  const sanitizedSnapshot = sanitizeWorkflowRunSnapshot(snapshot)
  void snapshots.save(sanitizedSnapshot).catch((error) => {
    logger.warn("workflow snapshot save failed", {
      runId: sanitizedSnapshot.runId,
      workflowId: sanitizedSnapshot.workflowId,
      status: sanitizedSnapshot.status,
      ...engineRejectionDiagnostic(error),
    })
    eventBus?.emit(
      {
        domain: "workflow",
        type: "workflow:snapshot-save-failed",
        payload: { type: "workflow:snapshot-save-failed", runId: sanitizedSnapshot.runId, workflowId: sanitizedSnapshot.workflowId, status: sanitizedSnapshot.status },
        timestamp: new Date().toISOString(),
      },
      { backpressure: "block" },
    )
  })
}

const workflowIdSchema = z.string().refine(isSafeWorkflowId, "Invalid workflow id")
const workflowRunIdSchema = z.string().refine(isSafeWorkflowRunId, "Invalid workflow run id")
const workflowNodeIdSchema = z.string().refine(isSafeWorkflowNodeId, "Invalid workflow node id")
const workflowResourceEntryTypeSchema = z.enum(["file", "directory"])
const workflowResourceRefSchema = z.union([
  z.object({ kind: z.literal("local_path"), entryType: workflowResourceEntryTypeSchema, path: z.string() }),
  z.object({ kind: z.literal("drive"), entryType: workflowResourceEntryTypeSchema, id: z.string(), versionId: z.string().optional() }),
  z.object({ kind: z.literal("staged"), entryType: workflowResourceEntryTypeSchema, id: z.string() }),
  z.object({ kind: z.literal("inline_file"), entryType: z.literal("file"), name: z.string(), mimeType: z.string().optional(), base64: z.string() }),
])
const workflowResourceRefListSchema = z.array(workflowResourceRefSchema).min(1).max(WORKFLOW_MULTI_RESOURCE_PARAM_MAX_ITEMS)

const workflowParamSchema = z.object({
  name: z.string(),
  type: z.enum(["text", "number", "file", "directory", "option"]),
  default: z.union([z.string(), z.number(), workflowResourceRefSchema, workflowResourceRefListSchema, z.null()]),
  description: z.string().optional(),
  options: z.array(z.string()).optional(),
  allowCustomOption: z.boolean().optional(),
  allowMultiple: z.boolean().optional(),
}).passthrough()

const workflowDefinitionSchema = z.object({
  id: workflowIdSchema, name: z.string(), description: z.string().optional(),
  version: z.string(), createdAt: z.number(), updatedAt: z.number(),
  meta: z.object({ schemaVersion: z.string() }).passthrough().optional(),
  defaultProjectId: z.string().optional(),
  defaultProviderId: z.string().optional(),
  defaultModelTier: z.enum(["default", "haiku", "sonnet", "opus"]).optional(),
  defaultNodeTimeoutMins: z.number().int().min(1).optional(),
  params: z.array(workflowParamSchema),
  nodes: z.array(z.object({ id: workflowNodeIdSchema, name: z.string(), type: z.string(), position: z.object({ x: z.number(), y: z.number() }).passthrough(), config: z.record(z.string(), z.unknown()) }).passthrough()),
  edges: z.array(z.object({ id: z.string(), from: z.string(), to: z.string(), branch: z.string().optional() }).passthrough()),
}).passthrough()

const workflowParamPresetSchema = z.object({
  id: z.string(),
  workflowId: workflowIdSchema,
  name: z.string(),
  values: z.record(z.string(), z.union([
    z.string(),
    z.array(z.string().min(1)).min(1).max(WORKFLOW_MULTI_RESOURCE_PARAM_MAX_ITEMS),
  ])),
  resourceEntryTypes: z.record(z.string(), z.enum(["file", "directory", "mixed", "unavailable"])),
  createdAt: z.number(),
  updatedAt: z.number(),
})

const saveWorkflowParamPresetSchema = z.object({
  workflowId: workflowIdSchema,
  name: z.string(),
  values: z.record(z.string(), z.union([
    z.string(),
    z.array(z.string().min(1)).min(1).max(WORKFLOW_MULTI_RESOURCE_PARAM_MAX_ITEMS),
  ])),
  overwritePresetId: z.string().optional(),
})

const modelTierSchema = z.enum(["default", "haiku", "sonnet", "opus"])

const workflowModelOccurrenceSchema = z.union([
  z.object({ kind: z.literal("workflowDefault") }),
  z.object({
    kind: z.literal("node"),
    nodeId: z.string(),
    nodeName: z.string(),
    nodeType: z.string(),
    inherited: z.boolean(),
  }),
])

const workflowModelReferenceSchema = z.object({
  id: z.string(),
  sourceProviderId: z.string().optional(),
  sourceProviderName: z.string().optional(),
  sourceModelTier: modelTierSchema,
  sourceModelName: z.string().optional(),
  missingOnExporter: z.boolean().optional(),
  occurrences: z.array(workflowModelOccurrenceSchema),
})

const workflowPackageSchema = z.object({
  format: z.union([
    z.literal("synapse-workflow-package-v1"),
    z.literal("synapse-workflow-package-v2"),
    z.literal("synapse-workflow-package"),
  ]),
  formatVersion: z.string().optional(),
  exportedAt: z.string(),
  workflow: z.unknown(),
  modelReferences: z.array(workflowModelReferenceSchema),
}).passthrough()

const workflowModelMappingSchema = z.object({
  sourceRefId: z.string(),
  targetProviderId: z.string(),
  targetModelTier: modelTierSchema,
})

const workflowImportOptionsSchema = z.object({
  targetProjectId: z.string().optional(),
}).optional()

const workflowImportPreviewSchema = z.object({
  packagePath: z.string(),
  packageDigest: z.string(),
  workflow: z.object({
    id: workflowIdSchema,
    name: z.string(),
    nodeCount: z.number(),
    modelReferenceCount: z.number(),
    requiresProjectMapping: z.boolean(),
  }),
  modelReferences: z.array(workflowModelReferenceSchema),
  providerOptions: z.array(z.object({
    providerId: z.string(),
    providerName: z.string(),
    active: z.boolean().optional(),
    models: z.record(modelTierSchema, z.string().optional()),
  })),
  suggestedMappings: z.array(workflowModelMappingSchema),
})

const workflowUsageCostBreakdownCnySchema = z.object({
  input: z.number(),
  output: z.number(),
  cacheRead: z.number(),
  cacheWrite: z.number(),
  reasoning: z.number(),
})

const workflowNodeUsageCostSchema = z.object({
  modelName: z.string().optional(),
  costCny: z.number().optional(),
  costBreakdownCny: workflowUsageCostBreakdownCnySchema.optional(),
  costCurrency: z.literal("CNY").optional(),
  priceKnown: z.boolean().optional(),
  estimatedCost: z.boolean().optional(),
})

const nodeRunResultSchema: z.ZodType<NodeRunResult> = z.object({
  nodeId: z.string(),
  status: z.enum(["pending", "running", "success", "failed", "cancelled", "skipped"]),
  input: z.object({
    variables: z.record(z.string(), z.string()),
    prompt: z.string().optional(),
  }),
  output: z.string().optional(),
  outputs: z.record(z.string(), z.unknown()).optional(),
  activeBranch: z.string().optional(),
  error: z.string().optional(),
  startedAt: z.number().optional(),
  endedAt: z.number().optional(),
  durationMs: z.number().optional(),
  progressLabel: z.string().optional(),
  usage: z.record(z.string(), z.unknown()).optional(),
  costUsd: z.number().optional(),
  costCny: z.number().optional(),
  costCurrency: z.literal("CNY").optional(),
  usageCost: workflowNodeUsageCostSchema.optional(),
})

const workflowRunStatusSchema: z.ZodType<WorkflowRunStatus> = z.object({
  runId: z.string(),
  workflowId: z.string(),
  status: z.enum(["running", "completed", "failed", "cancelled"]),
  nodeResults: z.record(z.string(), nodeRunResultSchema),
  startedAt: z.number(),
  endedAt: z.number().optional(),
  durationMs: z.number().optional(),
  error: z.string().optional(),
  params: z.record(z.string(), z.unknown()).optional(),
  definition: workflowDefinitionSchema.optional() as z.ZodType<WorkflowDefinition | undefined>,
  definitionMigration: z.object({
    kind: z.enum(["failed", "unsupported_future"]),
    sourceVersion: z.string().optional(),
    targetVersion: z.string().optional(),
  }).optional(),
})

const workflowRunListItemSchema: z.ZodType<WorkflowRunListItem> = z.object({
  runId: z.string(),
  workflowId: z.string(),
  status: z.enum(["running", "completed", "failed", "cancelled"]),
  nodeResults: z.record(z.string(), nodeRunResultSchema),
  startedAt: z.number(),
  endedAt: z.number().optional(),
  durationMs: z.number().optional(),
  error: z.string().optional(),
  params: z.record(z.string(), z.unknown()).optional(),
  definition: workflowDefinitionSchema.optional() as z.ZodType<WorkflowDefinition | undefined>,
  definitionMigration: z.object({
    kind: z.enum(["failed", "unsupported_future"]),
    sourceVersion: z.string().optional(),
    targetVersion: z.string().optional(),
  }).optional(),
})

const validationErrorSchema = z.object({
  type: z.string(),
  nodeId: z.string().optional(),
  nodeName: z.string().optional(),
  edgeId: z.string().optional(),
  field: z.string().optional(),
  message: z.string(),
  retryable: z.boolean().optional(),
  details: z.record(z.string(), z.unknown()).optional(),
})

const validationResultSchema = z.object({
  valid: z.boolean(),
  errors: z.array(validationErrorSchema),
  warnings: z.array(z.object({ type: z.string(), nodeId: z.string().optional(), message: z.string() })),
})

interface RunLifecycleOptions {
  readonly def: WorkflowDefinition
  readonly params: Record<string, unknown>
  readonly projectId: string | undefined
  readonly triggerSource: string
  readonly engine: WorkflowEngine
  readonly snapshots: RunSnapshotService
  readonly eventBus: EventBus
  readonly abortMap: Map<string, AbortController>
  readonly runStatuses: Map<string, WorkflowRunStatus>
}

function startRunWithLifecycle(options: RunLifecycleOptions): string {
  const { def, params, projectId, triggerSource, engine, snapshots, eventBus, abortMap, runStatuses } = options
  const ac = new AbortController()
  const runId = randomUUID()
  const startedAt = Date.now()
  abortMap.set(runId, ac)
  runStatuses.set(runId, { runId, workflowId: def.id, status: "running", nodeResults: {}, startedAt, params, definition: def })

  const completion = engine.run(def, params, runId, (event) => {
    handleRunEvent({
      event,
      def,
      params,
      runId,
      startedAt,
      snapshots,
      eventBus,
      abortMap,
      runStatuses,
    })
  }, ac.signal, projectId, triggerSource, { kind: "user", id: "local-user", display: "User" }).catch((err) => {
    handleEngineRejection({
      err,
      def,
      params,
      runId,
      startedAt,
      snapshots,
      eventBus,
      abortMap,
      runStatuses,
      triggerSource,
    })
  }).finally(() => {
    runCompletions.delete(runId)
  })
  runCompletions.set(runId, completion)
  return runId
}

function handleRunEvent(options: {
  readonly event: WorkflowEvent
  readonly def: WorkflowDefinition
  readonly params: Record<string, unknown>
  readonly runId: string
  readonly startedAt: number
  readonly snapshots: RunSnapshotService
  readonly eventBus: EventBus
  readonly abortMap: Map<string, AbortController>
  readonly runStatuses: Map<string, WorkflowRunStatus>
}): void {
  const { event, def, params, runId, startedAt, snapshots, eventBus, abortMap, runStatuses } = options
  const current = runStatuses.get(runId) ?? { runId, workflowId: def.id, status: "running" as const, nodeResults: {}, startedAt, params, definition: def }
  const nextNodeResults: Record<string, NodeRunResult> = { ...current.nodeResults }
  if (event.type === "node:started") {
    nextNodeResults[event.nodeId] = event.result ?? { ...(nextNodeResults[event.nodeId] ?? { nodeId: event.nodeId, input: { variables: {} } }), status: "running", startedAt: event.startedAt ?? Date.now() }
  } else if (event.type === "node:progress") {
    nextNodeResults[event.nodeId] = { ...(nextNodeResults[event.nodeId] ?? { nodeId: event.nodeId, input: { variables: {} }, status: "running" }), progressLabel: event.label }
  } else if (event.type === "node:agent-conversation") {
    const existing = nextNodeResults[event.nodeId] ?? { nodeId: event.nodeId, input: { variables: {} }, status: "running" as const }
    nextNodeResults[event.nodeId] = {
      ...existing,
      outputs: {
        ...(existing.outputs ?? {}),
        agentConversation: event.target,
      },
    }
  } else if (event.type === "node:completed" || event.type === "node:failed" || event.type === "node:skipped") {
    nextNodeResults[event.nodeId] = event.result ?? nextNodeResults[event.nodeId] ?? { nodeId: event.nodeId, status: event.type === "node:skipped" ? "skipped" : "failed", input: { variables: {} } }
  }
  const sanitizedNextNodeResults = sanitizeNodeResultsForSnapshot(nextNodeResults)
  runStatuses.set(runId, { ...current, nodeResults: sanitizedNextNodeResults })

  const isTerminal = event.type === "workflow:completed" || event.type === "workflow:failed" || event.type === "workflow:cancelled"
  const payload = sanitizeWorkflowEventForRenderer(isTerminal ? { ...event, workflowId: def.id } : event)
  eventBus.emit(
    { domain: "workflow", type: event.type, payload, timestamp: new Date().toISOString() },
    { backpressure: "block" },
  )
  if (!isTerminal) return

  abortMap.delete(runId)
  const status = event.type === "workflow:completed" ? "completed" : event.type === "workflow:cancelled" ? "cancelled" : "failed"
  const endedAt = Date.now()
  const nodeResults = event.result?.nodeResults ?? nextNodeResults
  const sanitizedNodeResults = sanitizeNodeResultsForSnapshot(nodeResults)
  const durationMs = event.result?.durationMs ?? endedAt - startedAt
  logger.info("workflow run finished", { workflowId: def.id, runId, status, durationMs })
  runStatuses.set(runId, {
    ...current,
    runId,
    workflowId: def.id,
    status,
    nodeResults: sanitizedNodeResults,
    startedAt,
    endedAt,
    durationMs,
    params: sanitizeWorkflowOutputForHistory(params),
    definition: sanitizeWorkflowDefinitionForSnapshot(def),
    ...(event.type === "workflow:failed" ? { error: sanitizeError(event.error) } : {}),
  })
  saveRunSnapshot(snapshots, {
    runId,
    workflowId: def.id,
    version: def.version,
    startedAt,
    endedAt,
    status,
    params,
    nodeResults: sanitizedNodeResults,
    definition: def,
    ...(event.type === "workflow:failed" ? { error: event.error } : {}),
  }, eventBus)
  pruneTerminalStatuses(runStatuses, def.id)
}

function handleEngineRejection(options: {
  readonly err: unknown
  readonly def: WorkflowDefinition
  readonly params: Record<string, unknown>
  readonly runId: string
  readonly startedAt: number
  readonly snapshots: RunSnapshotService
  readonly eventBus: EventBus
  readonly abortMap: Map<string, AbortController>
  readonly runStatuses: Map<string, WorkflowRunStatus>
  readonly triggerSource: string
}): void {
  const { err, def, params, runId, startedAt, snapshots, eventBus, abortMap, runStatuses } = options
  const diagnostic = engineRejectionDiagnostic(err)
  const visibleError = visibleEngineRejectionError(err)
  logger.error("workflow engine rejected unexpectedly", { workflowId: def.id, runId, ...diagnostic })
  abortMap.delete(runId)
  const current = runStatuses.get(runId)
  if (!current || current.status !== "running") return
  const endedAt = Date.now()
  const durationMs = endedAt - startedAt
  const sanitizedNodeResults = sanitizeNodeResultsForSnapshot(current.nodeResults)
  runStatuses.set(runId, {
    runId,
    workflowId: def.id,
    status: "failed",
    nodeResults: sanitizedNodeResults,
    startedAt,
    endedAt,
    durationMs,
    error: visibleError,
    params: sanitizeWorkflowOutputForHistory(params),
    definition: sanitizeWorkflowDefinitionForSnapshot(def),
  })
  eventBus.emit(
    { domain: "workflow", type: "workflow:failed", payload: { type: "workflow:failed", runId, workflowId: def.id, error: visibleError, result: { status: "failed", nodeResults: sanitizedNodeResults, durationMs } }, timestamp: new Date().toISOString() },
    { backpressure: "block" },
  )
  saveRunSnapshot(snapshots, { runId, workflowId: def.id, version: def.version, startedAt, endedAt, status: "failed", params, nodeResults: sanitizedNodeResults, definition: def, error: visibleError }, eventBus)
  pruneTerminalStatuses(runStatuses, def.id)
}

async function resolveDefaultWorkflowCreateOptions(): Promise<{
  defaultProjectId?: string
  defaultProviderModel?: WorkflowDefaultProviderModel
}> {
  const appConfig = await configStore.load()
  return {
    defaultProjectId: appConfig.global.projects[0]?.id,
    defaultProviderModel: appConfig.agent?.defaultProviderModel ?? undefined,
  }
}

async function resolveWorkflowProjectId(def: WorkflowDefinition): Promise<string | undefined> {
  const projectId = def.defaultProjectId?.trim()
  return projectId || undefined
}

async function loadWorkflowValidationOptions(workflowService?: Partial<Pick<WorkflowService, "list" | "get">>): Promise<WorkflowValidationOptions> {
  const appConfig = await configStore.load()
  const workflows = typeof workflowService?.list === "function" ? await workflowService.list() : undefined
  const readableWorkflows = workflows?.filter((workflow) => !workflow.loadError)
  const definitions = readableWorkflows && typeof workflowService?.get === "function"
    ? await Promise.all(readableWorkflows.map((workflow) => workflowService.get!(workflow.id)))
    : undefined
  return {
    configuredProjectIds: configuredWorkflowProjectIdsFromConfig(appConfig),
    availableWorkflowIds: readableWorkflows?.map((workflow) => workflow.id),
    workflowParamsById: definitions
      ? new Map(definitions.flatMap((definition) => definition ? [[definition.id, definition.params] as const] : []))
      : undefined,
  }
}

function resolveWorkflowValidationService(ctx: { resolve<T>(serviceId: string): T }): Partial<Pick<WorkflowService, "list" | "get">> | undefined {
  try {
    return ctx.resolve<WorkflowService>("core.workflow")
  } catch {
    return undefined
  }
}

function findActiveRun(runStatuses: Map<string, WorkflowRunStatus>, workflowId: string): string | undefined {
  for (const [runId, status] of runStatuses) {
    if (status.workflowId === workflowId && status.status === "running") return runId
  }
  return undefined
}

type RunCompletionWaitResult = "completed" | "timeout"

async function waitForRunCompletion(runId: string): Promise<RunCompletionWaitResult> {
  const completion = runCompletions.get(runId)
  if (!completion) return "completed"
  let timeout: NodeJS.Timeout | undefined
  const result = await Promise.race([
    completion.then(() => "completed" as const, () => "completed" as const),
    new Promise<"timeout">((resolve) => {
      timeout = setTimeout(() => resolve("timeout"), DELETE_ABORT_WAIT_MS)
    }),
  ])
  if (timeout) clearTimeout(timeout)
  return result
}

async function chooseWorkflowParamPaths(options: {
  readonly title: string
  readonly properties: Electron.OpenDialogOptions["properties"]
}): Promise<string[]> {
  const parentWindow = focusedWindow()
  const dialogOptions: Electron.OpenDialogOptions = {
    title: options.title,
    properties: options.properties,
  }
  const result = parentWindow
    ? await dialog.showOpenDialog(parentWindow, dialogOptions)
    : await dialog.showOpenDialog(dialogOptions)
  if (result.canceled) return []
  return result.filePaths
}

async function chooseWorkflowParamPath(options: {
  readonly title: string
  readonly properties: Electron.OpenDialogOptions["properties"]
}): Promise<string | null> {
  const [selectedPath] = await chooseWorkflowParamPaths(options)
  return selectedPath ?? null
}

async function abortActiveRunsForWorkflow(options: {
  readonly workflowId: string
  readonly runStatuses: Map<string, WorkflowRunStatus>
  readonly abortMap: Map<string, AbortController>
  readonly source: string
}): Promise<{ abortedRunIds: string[]; timedOutRunId?: string }> {
  const abortedRunIds: string[] = []
  for (const [existingRunId, status] of options.runStatuses) {
    if (status.workflowId === options.workflowId && status.status === "running") {
      logger.info(`${options.source} — cancelling active run`, { workflowId: options.workflowId, activeRunId: existingRunId })
      options.abortMap.get(existingRunId)?.abort()
      abortedRunIds.push(existingRunId)
    }
  }
  for (const runId of abortedRunIds) {
    const result = await waitForRunCompletion(runId)
    if (result === "timeout") {
      logger.warn(`${options.source} — active run did not stop before timeout`, { workflowId: options.workflowId, activeRunId: runId, waitMs: DELETE_ABORT_WAIT_MS })
      return { abortedRunIds, timedOutRunId: runId }
    }
  }
  return { abortedRunIds }
}

export const workflowIpcModule: IpcModule = {
  id: "workflow",
  methods: {
    exportPackage: {
      channel: "synapse:workflow:export-package", kind: "invoke",
      request: z.object({ workflowId: workflowIdSchema, workflowName: z.string().optional() }),
      response: z.object({
        path: z.string(),
        kind: z.enum(["package", "future-raw"]),
      }).nullable(),
      handler: async (ctx, { workflowId, workflowName }: { workflowId: string; workflowName?: string }) => {
        return ctx.resolve<WorkflowPackageService>("core.workflow.package").exportToFile({
          workflowId,
          workflowName,
          chooseDestination: async ({ title, defaultPath }) => {
            const parentWindow = focusedWindow()
            const dialogOptions: Electron.SaveDialogOptions = {
              title,
              defaultPath,
              filters: [{ name: "Synapse Workflow", extensions: ["json"] }],
            }
            const result = parentWindow
              ? await dialog.showSaveDialog(parentWindow, dialogOptions)
              : await dialog.showSaveDialog(dialogOptions)
            return result.canceled || !result.filePath ? null : result.filePath
          },
        })
      },
    },
    inspectImportPackage: {
      channel: "synapse:workflow:inspect-import-package", kind: "invoke",
      request: z.void().optional(),
      response: workflowImportPreviewSchema.nullable(),
      handler: async (ctx) => {
        const parentWindow = focusedWindow()
        const result = parentWindow
          ? await dialog.showOpenDialog(parentWindow, {
            title: "导入工作流",
            filters: [{ name: "Synapse Workflow", extensions: ["json"] }],
            properties: ["openFile"],
          })
          : await dialog.showOpenDialog({
            title: "导入工作流",
            filters: [{ name: "Synapse Workflow", extensions: ["json"] }],
            properties: ["openFile"],
          })
        if (result.canceled || result.filePaths.length === 0) return null
        const packagePath = result.filePaths[0]
        const action: PermissionAction = "fs.read.outside-userdata"
        const source = "workflow.inspectImportPackage"
        const auditSink = await checkFilePermission({ ctx, action, resource: packagePath, source })
        let packageFile: { raw: unknown; digest: string }
        try {
          packageFile = await readWorkflowPackageFile(packagePath)
        } catch (error) {
          recordFilePermissionFailure({ auditSink, action, resource: packagePath, source, error })
          logger.warn("workflow:inspectImportPackage read failed", {
            fileBase: path.basename(packagePath),
            errorName: error instanceof Error ? error.name : typeof error,
            errorLength: (error instanceof Error ? error.message : String(error)).length,
          })
          throw error
        }
        const packageData = parseWorkflowPackageOrFail({
          raw: packageFile.raw,
          auditSink,
          action,
          resource: packagePath,
          source,
          fileBase: path.basename(packagePath),
        })
        logger.info("workflow:inspectImportPackage requested", {
          fileBase: path.basename(packagePath),
          modelReferenceCount: packageData.modelReferences.length,
        })
        const preview = await ctx.resolve<WorkflowPackageService>("core.workflow.package").buildImportPreview(packagePath, packageData, packageFile.digest)
        logger.info("workflow:inspectImportPackage succeeded", {
          fileBase: path.basename(packagePath),
          workflowId: preview.workflow.id,
          providerOptionCount: preview.providerOptions.length,
        })
        return preview
      },
    },
    importPackage: {
      channel: "synapse:workflow:import-package", kind: "invoke",
      request: z.object({
        packagePath: z.string(),
        packageDigest: z.string().optional(),
        mappings: z.array(workflowModelMappingSchema),
        options: workflowImportOptionsSchema,
      }),
      response: z.union([
        z.object({ workflowId: workflowIdSchema, versionHash: z.string() }),
        z.object({ errors: z.array(validationErrorSchema) }),
      ]),
      handler: async (ctx, { packagePath, packageDigest, mappings, options }: { packagePath: string; packageDigest?: string; mappings: WorkflowModelMapping[]; options?: WorkflowImportOptions }) => {
        const action: PermissionAction = "fs.read.outside-userdata"
        const source = "workflow.importPackage"
        const auditSink = await checkFilePermission({ ctx, action, resource: packagePath, source })
        let packageFile: { raw: unknown; digest: string }
        try {
          packageFile = await readWorkflowPackageFile(packagePath)
        } catch (error) {
          recordFilePermissionFailure({ auditSink, action, resource: packagePath, source, error })
          logger.warn("workflow:importPackage read failed", {
            fileBase: path.basename(packagePath),
            mappingCount: mappings.length,
            errorName: error instanceof Error ? error.name : typeof error,
            errorLength: (error instanceof Error ? error.message : String(error)).length,
          })
          throw error
        }
        if (packageDigest !== undefined && packageDigest !== packageFile.digest) {
          logger.warn("workflow:importPackage digest mismatch", {
            fileBase: path.basename(packagePath),
            mappingCount: mappings.length,
          })
          throw new Error("工作流包已变化，请重新选择文件。")
        }
        const packageData = parseWorkflowPackageOrFail({
          raw: packageFile.raw,
          auditSink,
          action,
          resource: packagePath,
          source,
          fileBase: path.basename(packagePath),
          mappingCount: mappings.length,
        })
        logger.info("workflow:importPackage requested", {
          fileBase: path.basename(packagePath),
          mappingCount: mappings.length,
        })
        const mutationAudit = await authorizeWorkflowImportMutation(ctx)
        try {
          const result = await ctx.resolve<WorkflowPackageService>("core.workflow.package").importPackage(packageData, mappings, options ?? {})
          if ("errors" in result) {
            recordWorkflowImportMutation(mutationAudit, "failed", {
              reason: "validation-error",
              errorCount: result.errors.length,
            })
            logger.warn("workflow:importPackage blocked by validation", {
              fileBase: path.basename(packagePath),
              errorCount: result.errors.length,
            })
          } else {
            recordWorkflowImportMutation(mutationAudit, "allowed", {
              workflowId: result.workflowId,
            })
            logger.info("workflow:importPackage succeeded", {
              fileBase: path.basename(packagePath),
              workflowId: result.workflowId,
              versionHash: result.versionHash,
            })
          }
          return result
        } catch (error) {
          recordWorkflowImportMutation(mutationAudit, "failed", {
            errorName: error instanceof Error ? error.name : typeof error,
            errorLength: (error instanceof Error ? error.message : String(error)).length,
          })
          logger.warn("workflow:importPackage failed", {
            fileBase: path.basename(packagePath),
            mappingCount: mappings.length,
            errorName: error instanceof Error ? error.name : typeof error,
            errorLength: (error instanceof Error ? error.message : String(error)).length,
          })
          throw error
        }
      },
    },
    chooseParamFile: {
      channel: "synapse:workflow:param-file:choose", kind: "invoke", request: z.void().optional(), response: z.string().nullable(),
      handler: async () => chooseWorkflowParamPath({ title: "选择文件", properties: ["openFile"] }),
    },
    chooseParamDirectory: {
      channel: "synapse:workflow:param-directory:choose", kind: "invoke", request: z.void().optional(), response: z.string().nullable(),
      handler: async () => chooseWorkflowParamPath({ title: "选择文件夹", properties: ["openDirectory"] }),
    },
    chooseParamFiles: {
      channel: "synapse:workflow:param-files:choose", kind: "invoke", request: z.void().optional(), response: z.array(z.string()),
      handler: async () => chooseWorkflowParamPaths({ title: "选择文件", properties: ["openFile", "multiSelections"] }),
    },
    chooseParamDirectories: {
      channel: "synapse:workflow:param-directories:choose", kind: "invoke", request: z.void().optional(), response: z.array(z.string()),
      handler: async () => chooseWorkflowParamPaths({ title: "选择文件夹", properties: ["openDirectory", "multiSelections"] }),
    },
    paramPresetsList: {
      channel: "synapse:workflow:param-presets:list", kind: "invoke",
      request: z.object({ workflowId: workflowIdSchema }),
      response: z.array(workflowParamPresetSchema),
      handler: async (ctx, { workflowId }: { workflowId: string }) => {
        logger.info("workflow:paramPresets:list", { workflowId })
        return ctx.resolve<WorkflowParamPresetService>("core.workflow.param-presets").list(workflowId)
      },
    },
    paramPresetsSave: {
      channel: "synapse:workflow:param-presets:save", kind: "invoke",
      request: saveWorkflowParamPresetSchema,
      response: workflowParamPresetSchema,
      handler: async (ctx, input: z.infer<typeof saveWorkflowParamPresetSchema>) => {
        logger.info("workflow:paramPresets:save", {
          workflowId: input.workflowId,
          nameLength: input.name.length,
          valueKeyCount: Object.keys(input.values).length,
          overwrite: Boolean(input.overwritePresetId),
        })
        const workflow = await ctx.resolve<WorkflowService>("core.workflow").get(input.workflowId)
        if (!workflow) throw new Error(`Workflow ${input.workflowId} not found`)
        const normalizedParams = await normalizeWorkflowRunParams(workflow, input.values)
        if (normalizedParams.errors.length > 0) {
          throw new Error(normalizedParams.errors.map((error) => error.message).join("；"))
        }
        return ctx.resolve<WorkflowParamPresetService>("core.workflow.param-presets").save(input)
      },
    },
    paramPresetsDelete: {
      channel: "synapse:workflow:param-presets:delete", kind: "invoke",
      request: z.object({ id: z.string() }),
      response: z.void(),
      handler: async (ctx, { id }: { id: string }) => {
        logger.info("workflow:paramPresets:delete", { presetId: id })
        await ctx.resolve<WorkflowParamPresetService>("core.workflow.param-presets").delete(id)
      },
    },
    list: {
      channel: "synapse:workflow:list", kind: "invoke", request: z.void().optional(),
      response: z.array(z.object({ id: z.string(), name: z.string(), description: z.string().optional(), version: z.string(), loadError: z.string().optional(), rawExportAvailable: z.boolean().optional(), nodeCount: z.number(), createdAt: z.number(), updatedAt: z.number() })),
      handler: async (ctx) => {
        const result = await ctx.resolve<WorkflowService>("core.workflow").list()
        logger.info("workflow:list", { count: result.length })
        return result
      },
    },
    get: {
      channel: "synapse:workflow:get", kind: "invoke", request: z.object({ id: workflowIdSchema }),
      response: workflowDefinitionSchema.nullable(),
      handler: async (ctx, { id }: { id: string }) => {
        logger.info("workflow:get", { id })
        const result = await ctx.resolve<WorkflowService>("core.workflow").get(id)
        if (!result) logger.info("workflow:get not found", { id })
        return result
      },
    },
    create: {
      channel: "synapse:workflow:create", kind: "invoke", request: z.void().optional(),
      response: z.union([
        z.object({ id: z.string(), versionHash: z.string() }),
        z.object({ errors: z.array(validationErrorSchema) }),
      ]),
      handler: async (ctx) => {
        logger.info("workflow:create requested")
        const { defaultProjectId, defaultProviderModel } = await resolveDefaultWorkflowCreateOptions()
        const result = await ctx.resolve<WorkflowService>("core.workflow").create(defaultProjectId, defaultProviderModel)
        if ("errors" in result) {
          logger.warn("workflow:create failed", { errors: result.errors })
        } else {
          logger.info("workflow:create succeeded", { id: result.id, versionHash: result.versionHash })
        }
        return result
      },
    },
    save: {
      channel: "synapse:workflow:save", kind: "invoke", request: workflowDefinitionSchema,
      response: z.union([z.object({ versionHash: z.string() }), z.object({ errors: z.array(validationErrorSchema) })]),
      handler: async (ctx, def) => {
        const d = def as { id: string; name: string; nodes: unknown[] }
        logger.info("workflow:save requested", { id: d.id, name: d.name, nodeCount: d.nodes.length })
        // Validation is performed inside WorkflowService.save() — no need to validate here.
        const result = await ctx.resolve<WorkflowService>("core.workflow").save(def as never)
        if ("errors" in result) {
          logger.warn("workflow:save blocked by validation", { id: d.id, errors: result.errors })
        } else {
          logger.info("workflow:save succeeded", { id: d.id, versionHash: result.versionHash })
          const eventBus = ctx.resolve<EventBus>("core.event-bus")
          eventBus.emit({
            domain: "workflow",
            type: "workflow:definition-updated",
            payload: { workflowId: d.id, versionHash: result.versionHash, source: "save" },
            timestamp: new Date().toISOString(),
          })
        }
        return result
      },
    },
    delete: {
      channel: "synapse:workflow:delete", kind: "invoke", request: z.object({ id: workflowIdSchema }), response: z.void(),
      handler: async (ctx, { id }: { id: string }) => {
        logger.info("workflow:delete requested", { id })
        // Mark the workflow as deleted before any cleanup to prevent
        // late-finishing engine runs from re-creating snapshot files
        // (saveRunSnapshot checks this tombstone and skips writes).
        deletedWorkflows.add(id)
        try {
          // Abort any running runs for this workflow before deleting to prevent
          // orphaned engine processes (which would otherwise continue running,
          // leak abort controllers / run statuses in memory, and write ghost
          // snapshot files to the deleted workflow directory on completion).
          const runStatuses = ctx.resolve<Map<string, WorkflowRunStatus>>("core.workflow.run-statuses")
          const abortMap = ctx.resolve<Map<string, AbortController>>("core.workflow.run-aborts")
          const prunedRunIds: string[] = []
          for (const [runId, status] of runStatuses) {
            if (status.workflowId === id && status.status !== "running") {
              prunedRunIds.push(runId)
            }
          }
          const abortResult = await abortActiveRunsForWorkflow({
            workflowId: id,
            runStatuses,
            abortMap,
            source: "workflow:delete",
          })
          if (abortResult.timedOutRunId) {
            throw new Error(DELETE_ACTIVE_RUN_ABORT_TIMEOUT_MESSAGE)
          }
          for (const runId of abortResult.abortedRunIds) {
            abortMap.delete(runId)
            runStatuses.delete(runId)
          }
          for (const runId of prunedRunIds) {
            runStatuses.delete(runId)
          }
          if (abortResult.abortedRunIds.length > 0 || prunedRunIds.length > 0) {
            logger.info("workflow:delete cleaned up run statuses", { workflowId: id, abortedCount: abortResult.abortedRunIds.length, prunedCount: prunedRunIds.length })
          }
          const snapshots = ctx.resolve<RunSnapshotService>("core.workflow.snapshots")
          const windowManager = ctx.resolve<WorkflowWindowManager>("core.workflow.window-manager")
          const eventBus = ctx.resolve<EventBus>("core.event-bus")
          await ctx.resolve<WorkflowService>("core.workflow").delete(id)
          try {
            await snapshots.deleteWorkflow(id)
          } catch {
            logger.error("workflow:delete — snapshot cleanup failed", { id })
            // Snapshot cleanup failure is non-fatal: the workflow definition has
            // already been deleted, so proceeding with window close and event
            // emission ensures the UI stays in a consistent state.
          }
          windowManager.forceCloseAll(id)
          eventBus.emit({
            domain: "workflow",
            type: "workflow:definition-updated",
            payload: { workflowId: id, source: "workflow-delete" },
            timestamp: new Date().toISOString(),
          })
          logger.info("workflow:delete done", { id })
        } finally {
          deletedWorkflows.delete(id)
        }
      },
    },
    validate: {
      channel: "synapse:workflow:validate", kind: "invoke", request: workflowDefinitionSchema, response: validationResultSchema,
      handler: async (ctx, def) => {
        const d = def as { id: string; nodes: unknown[] }
        logger.info("workflow:validate requested", { id: d.id, nodeCount: d.nodes.length })
        const workflowService = resolveWorkflowValidationService(ctx)
        const result = await validateWorkflowWithResourceDefaults(def as never, await loadWorkflowValidationOptions(workflowService))
        logger.info("workflow:validate result", { id: d.id, valid: result.valid, errorCount: result.errors.length, warnCount: result.warnings.length })
        if (!result.valid) logger.warn("workflow:validate errors", { id: d.id, errors: result.errors })
        return result
      },
    },
    run: {
      channel: "synapse:workflow:run", kind: "invoke",
      request: z.object({ id: workflowIdSchema, params: z.record(z.string(), z.unknown()) }),
      response: z.union([
        z.object({ runId: z.string() }),
        z.object({ errors: z.array(validationErrorSchema) }),
      ]),
      handler: async (ctx, { id, params }: { id: string; params: Record<string, unknown> }) => {
        logger.info("workflow:run requested", { workflowId: id, paramKeys: Object.keys(params) })
        const svc = ctx.resolve<WorkflowService>("core.workflow")
        const engine = ctx.resolve<WorkflowEngine>("core.workflow.engine")
        const snapshots = ctx.resolve<RunSnapshotService>("core.workflow.snapshots")
        const eventBus = ctx.resolve<EventBus>("core.event-bus")
        const abortMap = ctx.resolve<Map<string, AbortController>>("core.workflow.run-aborts")
        const runStatuses = ctx.resolve<Map<string, WorkflowRunStatus>>("core.workflow.run-statuses")

        const def = await svc.get(id)
        if (!def) {
          logger.error("workflow:run failed - not found", { workflowId: id })
          throw new Error(`Workflow ${id} not found`)
        }

        // Validate before running — prevents invalid workflows from executing
        // when triggered from paths that skip editor-side validation (e.g. list page "Run" button)
        const validation = validateWorkflow(def, await loadWorkflowValidationOptions(svc))
        if (!validation.valid) {
          logger.warn("workflow:run blocked by validation", { workflowId: id, errors: validation.errors })
          return { errors: validation.errors }
        }
        const normalizedParams = await normalizeWorkflowRunParams(def, params)
        if (normalizedParams.errors.length > 0) {
          logger.warn("workflow:run blocked by invalid params", { workflowId: id, errors: normalizedParams.errors })
          return { errors: normalizedParams.errors }
        }
        const effectiveParams = normalizedParams.params

        const activeRunId = findActiveRun(runStatuses, id)
        if (activeRunId) {
          logger.info("workflow:run conflict", { workflowId: id, activeRunId })
          return { errors: [{ type: "invalid_config", message: "已有运行中的实例，请先取消或等待完成" }] }
        }

        const projectId = await resolveWorkflowProjectId(def)
        const runId = startRunWithLifecycle({
          def,
          params: effectiveParams,
          projectId,
          triggerSource: "renderer",
          engine,
          snapshots,
          eventBus,
          abortMap,
          runStatuses,
        })

        logger.info("workflow:run started", { workflowId: id, runId, workflowName: def.name, nodeCount: def.nodes.length, projectId })

        return { runId }
      },
    },
    runDefinition: {
      channel: "synapse:workflow:run-definition", kind: "invoke",
      request: z.object({ definition: workflowDefinitionSchema, params: z.record(z.string(), z.unknown()), force: z.boolean().optional() }),
      response: z.union([
        z.object({ runId: z.string() }),
        z.object({ errors: z.array(validationErrorSchema) }),
        z.object({ conflict: z.literal(true), activeRunId: z.string() }),
      ]),
      handler: async (ctx, { definition: rawDef, params, force }: { definition: unknown; params: Record<string, unknown>; force?: boolean }) => {
        const requestedDef = rawDef as import("../../../src/types/workflow").WorkflowDefinition
        logger.info("workflow:runDefinition requested", { workflowId: requestedDef.id, paramKeys: Object.keys(params) })
        const migration = migrateWorkflowDocument(rawDef)
        if (migration.kind !== "current") {
          const error = workflowReadError(migration)
          logger.warn("workflow:runDefinition blocked by migration", {
            workflowId: requestedDef.id,
            migrationKind: migration.kind,
            sourceVersion: migration.sourceVersion,
          })
          return { errors: [{ type: "invalid_config" as const, message: error.message }] }
        }
        const def = migration.document
        const engine = ctx.resolve<WorkflowEngine>("core.workflow.engine")
        const snapshots = ctx.resolve<RunSnapshotService>("core.workflow.snapshots")
        const workflowService = resolveWorkflowValidationService(ctx)
        const eventBus = ctx.resolve<EventBus>("core.event-bus")
        const abortMap = ctx.resolve<Map<string, AbortController>>("core.workflow.run-aborts")
        const runStatuses = ctx.resolve<Map<string, WorkflowRunStatus>>("core.workflow.run-statuses")

        const validation = validateWorkflow(def, await loadWorkflowValidationOptions(workflowService))
        if (!validation.valid) {
          logger.warn("workflow:runDefinition blocked by validation", { workflowId: def.id, errors: validation.errors })
          return { errors: validation.errors }
        }
        const normalizedParams = await normalizeWorkflowRunParams(def, params)
        if (normalizedParams.errors.length > 0) {
          logger.warn("workflow:runDefinition blocked by invalid params", { workflowId: def.id, errors: normalizedParams.errors })
          return { errors: normalizedParams.errors }
        }
        const effectiveParams = normalizedParams.params

        if (!force) {
          const activeRunId = findActiveRun(runStatuses, def.id)
          if (activeRunId) {
            logger.info("workflow:runDefinition conflict", { workflowId: def.id, activeRunId })
            return { conflict: true as const, activeRunId }
          }
        } else {
          const abortResult = await abortActiveRunsForWorkflow({
            workflowId: def.id,
            runStatuses,
            abortMap,
            source: "workflow:runDefinition force",
          })
          if (abortResult.timedOutRunId) {
            return { errors: [{ type: "invalid_config", message: ACTIVE_RUN_ABORT_TIMEOUT_MESSAGE }] }
          }
        }

        const projectId = await resolveWorkflowProjectId(def)
        const runId = startRunWithLifecycle({
          def,
          params: effectiveParams,
          projectId,
          triggerSource: "editor-run-definition",
          engine,
          snapshots,
          eventBus,
          abortMap,
          runStatuses,
        })

        logger.info("workflow:runDefinition started", { workflowId: def.id, runId, nodeCount: def.nodes.length })

        return { runId }
      },
    },
    rerun: {
      channel: "synapse:workflow:rerun", kind: "invoke",
      request: z.object({ previousRunId: workflowRunIdSchema, workflowId: workflowIdSchema.optional(), params: z.record(z.string(), z.unknown()), force: z.boolean().optional() }),
      response: z.union([
        z.object({ runId: z.string() }),
        z.object({ errors: z.array(validationErrorSchema) }),
        z.object({ conflict: z.literal(true), activeRunId: z.string() }),
      ]),
      handler: async (ctx, { previousRunId, workflowId: requestedWorkflowId, params, force }: { previousRunId: string; workflowId?: string; params: Record<string, unknown>; force?: boolean }) => {
        logger.info("workflow:rerun requested", { previousRunId })
        const runStatuses = ctx.resolve<Map<string, WorkflowRunStatus>>("core.workflow.run-statuses")
        const snapshots = ctx.resolve<RunSnapshotService>("core.workflow.snapshots")

        let def: import("../../../src/types/workflow").WorkflowDefinition | undefined
        let workflowId: string | undefined
        let previousParams: Record<string, unknown> | undefined
        let definitionMigration: import("../../../src/types/workflow").WorkflowRunDefinitionMigration | undefined

        const memoryStatus = runStatuses.get(previousRunId)
        if (memoryStatus) {
          def = memoryStatus.definition
          workflowId = memoryStatus.workflowId
          previousParams = memoryStatus.params
          definitionMigration = memoryStatus.definitionMigration
        } else {
          const snapshot = requestedWorkflowId
            ? await snapshots.get(previousRunId, requestedWorkflowId)
            : await snapshots.findByRunId(previousRunId)
          if (snapshot) {
            def = snapshot.definition
            workflowId = snapshot.workflowId
            previousParams = snapshot.params
            definitionMigration = snapshot.definitionMigration
          }
        }

        if (definitionMigration) {
          logger.warn("workflow:rerun blocked by unreadable history definition", {
            previousRunId,
            workflowId,
            migrationKind: definitionMigration.kind,
            sourceVersion: definitionMigration.sourceVersion,
          })
          return {
            errors: [{
              type: "invalid_config",
              message: definitionMigration.kind === "unsupported_future"
                ? "该运行记录由较新版本创建，当前版本无法重新运行"
                : "该运行记录的工作流结构读取失败，无法重新运行",
            }],
          }
        }

        if (!def || !workflowId) {
          logger.error("workflow:rerun — cannot find definition for previous run", { previousRunId })
          return { errors: [{ type: "invalid_config", message: "无法找到上次运行使用的工作流定义" }] }
        }
        const redactedConfigKind = getRedactedWorkflowConfigKind(def)
        if (redactedConfigKind) {
          const currentDefinition = await ctx.resolve<WorkflowService>("core.workflow").get(workflowId)
          if (currentDefinition && !getRedactedWorkflowConfigKind(currentDefinition)) {
            def = currentDefinition
            logger.info("workflow:rerun using current definition because history definition is redacted", { previousRunId, workflowId })
          } else {
            logger.warn("workflow:rerun blocked by redacted workflow config", { previousRunId, workflowId })
            return {
              errors: [{
                type: "invalid_config",
                message: redactedConfigKind === "codex"
                  ? "历史运行记录中的 Code X 配置已脱敏，无法直接重新运行。请从当前工作流重新运行，或恢复原始配置后再试。"
                  : "历史运行记录中的工作流配置已脱敏，无法直接重新运行。请从当前工作流重新运行，或恢复原始配置后再试。",
              }],
            }
          }
        }

        // Use previous run's params as fallback when caller passes empty params
        const callerHasParams = Object.keys(params).length > 0
        const effectiveParams = callerHasParams ? params : (previousParams ?? {})
        if (!callerHasParams && previousParams) {
          logger.info("workflow:rerun using previous run params", { previousRunId, paramKeys: Object.keys(previousParams) })
        }

        const engine = ctx.resolve<WorkflowEngine>("core.workflow.engine")
        const snapshotSvc = ctx.resolve<RunSnapshotService>("core.workflow.snapshots")
        const eventBus = ctx.resolve<EventBus>("core.event-bus")
        const abortMap = ctx.resolve<Map<string, AbortController>>("core.workflow.run-aborts")

        const workflowService = resolveWorkflowValidationService(ctx)
        const validation = validateWorkflow(def, await loadWorkflowValidationOptions(workflowService))
        if (!validation.valid) return { errors: validation.errors }
        const normalizedParams = await normalizeWorkflowRunParams(def, effectiveParams)
        if (normalizedParams.errors.length > 0) {
          logger.warn("workflow:rerun blocked by invalid params", { workflowId, errors: normalizedParams.errors })
          return { errors: normalizedParams.errors }
        }
        const validatedParams = normalizedParams.params

        // Check for conflicting active runs before auto-aborting
        if (!force) {
          for (const [existingRunId, status] of runStatuses) {
            if (status.workflowId === workflowId && status.status === "running") {
              logger.info("workflow:rerun conflict", { workflowId, activeRunId: existingRunId })
              return { conflict: true as const, activeRunId: existingRunId }
            }
          }
        }

        const abortResult = await abortActiveRunsForWorkflow({
          workflowId,
          runStatuses,
          abortMap,
          source: "workflow:rerun force",
        })
        if (abortResult.timedOutRunId) {
          return { errors: [{ type: "invalid_config", message: ACTIVE_RUN_ABORT_TIMEOUT_MESSAGE }] }
        }

        const projectId = await resolveWorkflowProjectId(def)
        const runId = startRunWithLifecycle({
          def,
          params: validatedParams,
          projectId,
          triggerSource: "rerun",
          engine,
          snapshots: snapshotSvc,
          eventBus,
          abortMap,
          runStatuses,
        })

        logger.info("workflow:rerun started", { previousRunId, workflowId, runId, nodeCount: def.nodes.length })

        return { runId }
      },
    },
    openRunner: {
      channel: "synapse:workflow:open-runner", kind: "invoke",
      request: z.object({ workflowId: workflowIdSchema, runId: workflowRunIdSchema }),
      response: z.void(),
      handler: async (ctx, { workflowId, runId }: { workflowId: string; runId: string }) => {
        logger.info("workflow:openRunner", { workflowId, runId })
        const baseUrl = rendererBaseUrl()
        await ctx.resolve<WorkflowWindowManager>("core.workflow.window-manager").openRunner(workflowId, runId, baseUrl)
      },
    },
    cancel: {
      channel: "synapse:workflow:cancel", kind: "invoke", request: z.object({ runId: workflowRunIdSchema }), response: z.void(),
      handler: (ctx, { runId }: { runId: string }) => {
        logger.info("workflow:cancel requested", { runId })
        const controller = ctx.resolve<Map<string, AbortController>>("core.workflow.run-aborts").get(runId)
        if (controller) {
          controller.abort()
          logger.info("workflow:cancel signal sent", { runId })
        } else {
          logger.warn("workflow:cancel — no active run to cancel", { runId })
        }
      },
    },
    activeRuns: {
      channel: "synapse:workflow:active-runs", kind: "invoke", request: z.void(), response: z.array(workflowRunListItemSchema),
      handler: (ctx) => {
        const runStatuses = ctx.resolve<Map<string, WorkflowRunStatus>>("core.workflow.run-statuses")
        return listActiveRunItems(runStatuses)
      },
    },
    runHistory: {
      channel: "synapse:workflow:run-history", kind: "invoke", request: z.object({ workflowId: workflowIdSchema }), response: z.array(workflowRunListItemSchema),
      handler: async (ctx, { workflowId }: { workflowId: string }) => {
        const runStatuses = ctx.resolve<Map<string, WorkflowRunStatus>>("core.workflow.run-statuses")
        const snapshots = await ctx.resolve<RunSnapshotService>("core.workflow.snapshots").list(workflowId, 20)
        const activeItems = listActiveRunItems(runStatuses, workflowId)
        const memoryItems = listHistoryMemoryRunItems(runStatuses, workflowId)
        const snapshotItems = snapshots.map(snapshotToListItem)
        const history = mergeRunHistoryItems(memoryItems, snapshotItems)
        logger.info("workflow:runHistory", {
          workflowId,
          count: history.length,
          activeCount: activeItems.length,
          snapshotCount: snapshotItems.length,
        })
        return history
      },
    },
    runStatus: {
      channel: "synapse:workflow:run-status", kind: "invoke", request: z.object({ runId: workflowRunIdSchema, workflowId: workflowIdSchema.optional() }), response: workflowRunStatusSchema.nullable(),
      handler: async (ctx, { runId, workflowId }: { runId: string; workflowId?: string }) => {
        const live = ctx.resolve<Map<string, WorkflowRunStatus>>("core.workflow.run-statuses").get(runId)
        if (live) {
          logger.info("run-status served from memory", { runId, workflowId: live.workflowId, status: live.status })
          return sanitizeWorkflowRunStatusForRenderer(live)
        }
        // Fallback: terminal runs pruned from the in-memory map (MAX_TERMINAL_STATUSES_PER_WORKFLOW = 5)
        // are still on disk (up to MAX = 20 snapshots per workflow). Without this, opening an
        // older run from the history dialog would render an empty runner (no definition,
        // no node results, stuck at "running"). Hydrate from the snapshot store instead.
        const snapshots = ctx.resolve<RunSnapshotService>("core.workflow.snapshots")
        const snap = workflowId ? await snapshots.get(runId, workflowId) : await snapshots.findByRunId(runId)
        if (snap) {
          // Prefer the snapshot's own error field (now persisted on new snapshots),
          // then fall back to reconstructing from the first failed node's result
          // for old snapshots saved before the field was added.
          let error: string | undefined
          let recoveredErrorFromNodeResults = false
          if (snap.status === "failed") {
            error = snap.error
            if (!error) {
              const failedNode = Object.values(snap.nodeResults).find((nr) => nr.status === "failed" && nr.error)
              if (failedNode?.error) {
                error = failedNode.error
                recoveredErrorFromNodeResults = true
              }
            }
          }

          const hydrated: WorkflowRunStatus = {
            runId: snap.runId,
            workflowId: snap.workflowId,
            status: snap.status,
            nodeResults: snap.nodeResults,
            startedAt: snap.startedAt,
            endedAt: snap.endedAt,
            durationMs: snap.endedAt ? snap.endedAt - snap.startedAt : undefined,
            params: snap.params,
            definition: snap.definition,
            definitionMigration: snap.definitionMigration,
            ...(error ? { error } : {}),
          }
          logger.info("run-status hydrated from snapshot", {
            runId, workflowId: snap.workflowId, status: snap.status,
            nodeCount: Object.keys(snap.nodeResults).length,
            hasDefinition: !!snap.definition,
            ...(snap.definitionMigration ? { definitionMigration: snap.definitionMigration.kind } : {}),
            ...(recoveredErrorFromNodeResults ? { recoveredErrorFromNodeResults: true } : {}),
          })
          return hydrated
        }
        logger.warn("run-status not found in memory or snapshots", { runId })
        return null
      },
    },
    openEditor: {
      channel: "synapse:workflow:open-editor", kind: "invoke", request: z.object({ id: workflowIdSchema, runId: workflowRunIdSchema.optional() }), response: z.void(),
      handler: async (ctx, { id, runId }: { id: string; runId?: string }) => {
        logger.info("workflow:openEditor", { workflowId: id, runId })
        const baseUrl = rendererBaseUrl()
        await ctx.resolve<WorkflowWindowManager>("core.workflow.window-manager").open(id, baseUrl, runId)
      },
    },
    editorState: {
      channel: "synapse:workflow:editor-state", kind: "invoke", request: z.void().optional(),
      response: z.object({ openEditors: z.array(z.string()) }),
      handler: (ctx) => ({ openEditors: ctx.resolve<WorkflowWindowManager>("core.workflow.window-manager").getOpenEditorIds() }),
    },
    checkCanSync: {
      channel: "synapse:workflow:check-can-sync", kind: "invoke", request: z.void().optional(),
      response: z.object({ canSync: z.boolean(), blockers: z.array(z.string()) }),
      handler: (ctx) => ctx.resolve<WorkflowWindowManager>("core.workflow.window-manager").checkCanSync(),
    },
  },
  events: {
    event: {
      kind: "event", channel: "synapse:workflow:event",
      payload: z.object({ domain: z.literal("workflow"), type: z.string(), payload: z.unknown(), timestamp: z.string() }),
    },
  },
}
