import { randomUUID } from "node:crypto"
import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { BrowserWindow, dialog } from "electron"
import { z } from "zod"
import type { IpcModule } from "../../runtime/ipc/types"
import type { AuditSink, PermissionAction, PermissionGuard } from "../../runtime/security"
import type { WorkflowDefaultProviderModel, WorkflowService } from "../../services/workflow/workflow-service"
import type { WorkflowPackageService } from "../../services/workflow/workflow-package-service"
import type { WorkflowEngine } from "../../services/workflow/workflow-engine"
import type { RunSnapshotService } from "../../services/workflow/run-snapshot-service"
import type { WorkflowWindowManager } from "../../services/workflow/window-manager"
import type { EventBus } from "../../runtime/event-bus"
import { buildEffectiveRunParams, validateWorkflow, validateRunParams } from "../../services/workflow/workflow-validator"
import { truncateWithEllipsis } from "../../services/workflow/workflow-utils"
import type { NodeRunResult, WorkflowDefinition, WorkflowEvent, WorkflowRunStatus, WorkflowRunSnapshot } from "../../../src/types/workflow"
import type { SynapseWorkflowPackageV1, WorkflowModelMapping } from "../../../src/types/workflow-package"
import { createMainLogger } from "../../services/log-store"
import { configStore } from "../../services/config-store"
import { sanitizeError } from "../../services/error-sanitize"
import { sanitizeNodeResultsForSnapshot } from "../../services/workflow/run-snapshot-sanitize"

const logger = createMainLogger("workflow.ipc")
const DELETE_ABORT_WAIT_MS = 5_000
const runCompletions = new Map<string, Promise<unknown>>()
const deletedWorkflows = new Set<string>()

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

function rendererBaseUrl(): string {
  return process.env.VITE_DEV_SERVER_URL ?? "app://-"
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

function saveRunSnapshot(
  snapshots: RunSnapshotService,
  snapshot: Parameters<RunSnapshotService["save"]>[0],
  eventBus?: EventBus,
): void {
  // If the workflow has been deleted (tombstone is set), skip snapshot writes
  // to prevent a late-finishing engine run from re-creating the deleted
  // workflow-runs directory via RunSnapshotService.save() → mkdir().
  if (deletedWorkflows.has(snapshot.workflowId)) return
  void snapshots.save(snapshot).catch((error) => {
    logger.warn("workflow snapshot save failed", {
      runId: snapshot.runId,
      workflowId: snapshot.workflowId,
      status: snapshot.status,
      ...engineRejectionDiagnostic(error),
    })
    eventBus?.emit(
      {
        domain: "workflow",
        type: "workflow:snapshot-save-failed",
        payload: { type: "workflow:snapshot-save-failed", runId: snapshot.runId, workflowId: snapshot.workflowId, status: snapshot.status },
        timestamp: new Date().toISOString(),
      },
      { backpressure: "block" },
    )
  })
}

const workflowDefinitionSchema = z.object({
  id: z.string(), name: z.string(), description: z.string().optional(),
  version: z.string(), createdAt: z.number(), updatedAt: z.number(),
  defaultProjectId: z.string().optional(),
  defaultProviderId: z.string().optional(),
  defaultModelTier: z.enum(["default", "haiku", "sonnet", "opus"]).optional(),
  defaultNodeTimeoutMins: z.number().int().min(1).optional(),
  params: z.array(z.object({ name: z.string(), type: z.enum(["text", "number"]), default: z.union([z.string(), z.number(), z.null()]), description: z.string().optional() })),
  nodes: z.array(z.object({ id: z.string(), name: z.string(), type: z.string(), position: z.object({ x: z.number(), y: z.number() }), config: z.record(z.string(), z.unknown()) })),
  edges: z.array(z.object({ id: z.string(), from: z.string(), to: z.string(), branch: z.string().optional() })),
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
  format: z.literal("synapse-workflow-package-v1"),
  exportedAt: z.string(),
  workflow: workflowDefinitionSchema,
  modelReferences: z.array(workflowModelReferenceSchema),
})

const workflowModelMappingSchema = z.object({
  sourceRefId: z.string(),
  targetProviderId: z.string(),
  targetModelTier: modelTierSchema,
})

const workflowImportPreviewSchema = z.object({
  packagePath: z.string(),
  workflow: z.object({
    id: z.string(),
    name: z.string(),
    nodeCount: z.number(),
    modelReferenceCount: z.number(),
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
})

const workflowRunSnapshotSchema: z.ZodType<WorkflowRunSnapshot> = z.object({
  runId: z.string(),
  workflowId: z.string(),
  version: z.string(),
  startedAt: z.number(),
  endedAt: z.number().optional(),
  status: z.enum(["completed", "failed", "cancelled"]),
  params: z.record(z.string(), z.unknown()),
  nodeResults: z.record(z.string(), nodeRunResultSchema),
  error: z.string().optional(),
  definition: workflowDefinitionSchema.optional() as z.ZodType<WorkflowDefinition | undefined>,
})

const validationResultSchema = z.object({
  valid: z.boolean(),
  errors: z.array(z.object({ type: z.string(), nodeId: z.string().optional(), edgeId: z.string().optional(), message: z.string() })),
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
  } else if (event.type === "node:completed" || event.type === "node:failed" || event.type === "node:skipped") {
    nextNodeResults[event.nodeId] = event.result ?? nextNodeResults[event.nodeId] ?? { nodeId: event.nodeId, status: event.type === "node:skipped" ? "skipped" : "failed", input: { variables: {} } }
  }
  runStatuses.set(runId, { ...current, nodeResults: nextNodeResults })

  const isTerminal = event.type === "workflow:completed" || event.type === "workflow:failed" || event.type === "workflow:cancelled"
  const payload = isTerminal ? { ...event, workflowId: def.id } : event
  eventBus.emit(
    { domain: "workflow", type: event.type, payload, timestamp: new Date().toISOString() },
    { backpressure: "block" },
  )
  if (!isTerminal) return

  abortMap.delete(runId)
  const status = event.type === "workflow:completed" ? "completed" : event.type === "workflow:cancelled" ? "cancelled" : "failed"
  const endedAt = Date.now()
  const nodeResults = event.result?.nodeResults ?? nextNodeResults
  const durationMs = event.result?.durationMs ?? endedAt - startedAt
  logger.info("workflow run finished", { workflowId: def.id, runId, status, durationMs })
  runStatuses.set(runId, {
    ...current,
    runId,
    workflowId: def.id,
    status,
    nodeResults,
    startedAt,
    endedAt,
    durationMs,
    params,
    definition: def,
    ...(event.type === "workflow:failed" ? { error: event.error } : {}),
  })
  saveRunSnapshot(snapshots, {
    runId,
    workflowId: def.id,
    version: def.version,
    startedAt,
    endedAt,
    status,
    params,
    nodeResults: sanitizeNodeResultsForSnapshot(nodeResults),
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
  const { err, def, params, runId, startedAt, snapshots, eventBus, abortMap, runStatuses, triggerSource } = options
  const diagnostic = engineRejectionDiagnostic(err)
  const visibleError = visibleEngineRejectionError(err)
  logger.error("workflow engine rejected unexpectedly", { workflowId: def.id, runId, ...diagnostic })
  abortMap.delete(runId)
  const current = runStatuses.get(runId)
  if (!current || current.status !== "running") return
  const endedAt = Date.now()
  const durationMs = endedAt - startedAt
  runStatuses.set(runId, { runId, workflowId: def.id, status: "failed", nodeResults: current.nodeResults, startedAt, endedAt, durationMs, error: visibleError, params, definition: def })
  eventBus.emit(
    { domain: "workflow", type: "workflow:failed", payload: { type: "workflow:failed", runId, workflowId: def.id, error: visibleError, result: { status: "failed", nodeResults: current.nodeResults, durationMs } }, timestamp: new Date().toISOString() },
    { backpressure: "block" },
  )
  saveRunSnapshot(snapshots, { runId, workflowId: def.id, version: def.version, startedAt, endedAt, status: "failed", params, nodeResults: sanitizeNodeResultsForSnapshot(current.nodeResults), definition: def, error: visibleError }, eventBus)
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

function findActiveRun(runStatuses: Map<string, WorkflowRunStatus>, workflowId: string): string | undefined {
  for (const [runId, status] of runStatuses) {
    if (status.workflowId === workflowId && status.status === "running") return runId
  }
  return undefined
}

async function waitForRunCompletion(runId: string): Promise<void> {
  const completion = runCompletions.get(runId)
  if (!completion) return
  await Promise.race([
    completion.then(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, DELETE_ABORT_WAIT_MS)),
  ])
}

export const workflowIpcModule: IpcModule = {
  id: "workflow",
  methods: {
    exportPackage: {
      channel: "synapse:workflow:export-package", kind: "invoke",
      request: z.object({ workflowId: z.string(), workflowName: z.string().optional() }),
      response: z.object({ path: z.string() }).nullable(),
      handler: async (ctx, { workflowId, workflowName }: { workflowId: string; workflowName?: string }) => {
        const pkg = await ctx.resolve<WorkflowPackageService>("core.workflow.package").buildExportPackage(workflowId)
        const safeName = (workflowName || pkg.workflow.name || "workflow").replace(/[\\/:*?"<>|]/g, "-")
        const parentWindow = focusedWindow()
        const result = parentWindow
          ? await dialog.showSaveDialog(parentWindow, {
            title: "导出工作流",
            defaultPath: `${safeName}.synapse-workflow.json`,
            filters: [{ name: "Synapse Workflow", extensions: ["json"] }],
          })
          : await dialog.showSaveDialog({
            title: "导出工作流",
            defaultPath: `${safeName}.synapse-workflow.json`,
            filters: [{ name: "Synapse Workflow", extensions: ["json"] }],
          })
        if (result.canceled || !result.filePath) return null
        const action: PermissionAction = "fs.write"
        const source = "workflow.exportPackage"
        const auditSink = await checkFilePermission({ ctx, action, resource: result.filePath, source })
        try {
          await writeFile(result.filePath, `${JSON.stringify(pkg, null, 2)}\n`, "utf-8")
        } catch (error) {
          recordFilePermissionFailure({ auditSink, action, resource: result.filePath, source, error })
          throw error
        }
        logger.info("workflow package exported", { workflowId, fileBase: path.basename(result.filePath) })
        return { path: result.filePath }
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
        let raw: unknown
        try {
          raw = JSON.parse(await readFile(packagePath, "utf-8"))
        } catch (error) {
          recordFilePermissionFailure({ auditSink, action, resource: packagePath, source, error })
          logger.warn("workflow:inspectImportPackage read failed", {
            fileBase: path.basename(packagePath),
            errorName: error instanceof Error ? error.name : typeof error,
            errorLength: (error instanceof Error ? error.message : String(error)).length,
          })
          throw error
        }
        const packageData = workflowPackageSchema.parse(raw) as SynapseWorkflowPackageV1
        logger.info("workflow:inspectImportPackage requested", {
          fileBase: path.basename(packagePath),
          workflowId: packageData.workflow.id,
          modelReferenceCount: packageData.modelReferences.length,
        })
        const preview = await ctx.resolve<WorkflowPackageService>("core.workflow.package").buildImportPreview(packagePath, packageData)
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
      request: z.object({ packagePath: z.string(), mappings: z.array(workflowModelMappingSchema) }),
      response: z.union([
        z.object({ workflowId: z.string(), versionHash: z.string() }),
        z.object({ errors: z.array(z.object({ type: z.string(), nodeId: z.string().optional(), edgeId: z.string().optional(), message: z.string() })) }),
      ]),
      handler: async (ctx, { packagePath, mappings }: { packagePath: string; mappings: WorkflowModelMapping[] }) => {
        const action: PermissionAction = "fs.read.outside-userdata"
        const source = "workflow.importPackage"
        const auditSink = await checkFilePermission({ ctx, action, resource: packagePath, source })
        let raw: unknown
        try {
          raw = JSON.parse(await readFile(packagePath, "utf-8"))
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
        const packageData = workflowPackageSchema.parse(raw) as SynapseWorkflowPackageV1
        logger.info("workflow:importPackage requested", {
          fileBase: path.basename(packagePath),
          mappingCount: mappings.length,
        })
        try {
          const result = await ctx.resolve<WorkflowPackageService>("core.workflow.package").importPackage(packageData, mappings)
          if ("errors" in result) {
            logger.warn("workflow:importPackage blocked by validation", {
              fileBase: path.basename(packagePath),
              errorCount: result.errors.length,
            })
          } else {
            logger.info("workflow:importPackage succeeded", {
              fileBase: path.basename(packagePath),
              workflowId: result.workflowId,
              versionHash: result.versionHash,
            })
          }
          return result
        } catch (error) {
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
    list: {
      channel: "synapse:workflow:list", kind: "invoke", request: z.void().optional(),
      response: z.array(z.object({ id: z.string(), name: z.string(), description: z.string().optional(), version: z.string(), nodeCount: z.number(), createdAt: z.number(), updatedAt: z.number() })),
      handler: async (ctx) => {
        const result = await ctx.resolve<WorkflowService>("core.workflow").list()
        logger.info("workflow:list", { count: result.length })
        return result
      },
    },
    get: {
      channel: "synapse:workflow:get", kind: "invoke", request: z.object({ id: z.string() }),
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
        z.object({ errors: z.array(z.object({ type: z.string(), nodeId: z.string().optional(), edgeId: z.string().optional(), message: z.string() })) }),
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
      response: z.union([z.object({ versionHash: z.string() }), z.object({ errors: z.array(z.object({ type: z.string(), nodeId: z.string().optional(), edgeId: z.string().optional(), message: z.string() })) })]),
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
      channel: "synapse:workflow:delete", kind: "invoke", request: z.object({ id: z.string() }), response: z.void(),
      handler: async (ctx, { id }: { id: string }) => {
        logger.info("workflow:delete requested", { id })
        // Mark the workflow as deleted before any cleanup to prevent
        // late-finishing engine runs from re-creating snapshot files
        // (saveRunSnapshot checks this tombstone and skips writes).
        deletedWorkflows.add(id)
        // Abort any running runs for this workflow before deleting to prevent
        // orphaned engine processes (which would otherwise continue running,
        // leak abort controllers / run statuses in memory, and write ghost
        // snapshot files to the deleted workflow directory on completion).
        const runStatuses = ctx.resolve<Map<string, WorkflowRunStatus>>("core.workflow.run-statuses")
        const abortMap = ctx.resolve<Map<string, AbortController>>("core.workflow.run-aborts")
        const runningRunIds: string[] = []
        let abortedCount = 0
        let prunedCount = 0
        for (const [runId, status] of runStatuses) {
          if (status.workflowId !== id) continue
          if (status.status === "running") {
            abortMap.get(runId)?.abort()
            runningRunIds.push(runId)
            abortedCount++
          } else {
            prunedCount++
            runStatuses.delete(runId)
          }
        }
        if (abortedCount > 0 || prunedCount > 0) {
          logger.info("workflow:delete cleaned up run statuses", { workflowId: id, abortedCount, prunedCount })
        }
        await Promise.all(runningRunIds.map(waitForRunCompletion))
        for (const runId of runningRunIds) {
          abortMap.delete(runId)
          runStatuses.delete(runId)
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
          payload: { workflowId: id },
          timestamp: new Date().toISOString(),
        })
        logger.info("workflow:delete done", { id })
        deletedWorkflows.delete(id)
      },
    },
    validate: {
      channel: "synapse:workflow:validate", kind: "invoke", request: workflowDefinitionSchema, response: validationResultSchema,
      handler: async (_ctx, def) => {
        const d = def as { id: string; nodes: unknown[] }
        logger.info("workflow:validate requested", { id: d.id, nodeCount: d.nodes.length })
        const result = validateWorkflow(def as never)
        logger.info("workflow:validate result", { id: d.id, valid: result.valid, errorCount: result.errors.length, warnCount: result.warnings.length })
        if (!result.valid) logger.warn("workflow:validate errors", { id: d.id, errors: result.errors })
        return result
      },
    },
    run: {
      channel: "synapse:workflow:run", kind: "invoke",
      request: z.object({ id: z.string(), params: z.record(z.string(), z.unknown()) }),
      response: z.union([
        z.object({ runId: z.string() }),
        z.object({ errors: z.array(z.object({ type: z.string(), nodeId: z.string().optional(), edgeId: z.string().optional(), message: z.string() })) }),
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
        const validation = validateWorkflow(def)
        if (!validation.valid) {
          logger.warn("workflow:run blocked by validation", { workflowId: id, errors: validation.errors })
          return { errors: validation.errors }
        }
        const paramErrors = validateRunParams(def, params)
        if (paramErrors.length > 0) {
          logger.warn("workflow:run blocked by missing params", { workflowId: id, errors: paramErrors })
          return { errors: paramErrors }
        }
        const effectiveParams = buildEffectiveRunParams(def, params)

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
        z.object({ errors: z.array(z.object({ type: z.string(), nodeId: z.string().optional(), edgeId: z.string().optional(), message: z.string() })) }),
        z.object({ conflict: z.literal(true), activeRunId: z.string() }),
      ]),
      handler: async (ctx, { definition: rawDef, params, force }: { definition: unknown; params: Record<string, unknown>; force?: boolean }) => {
        const def = rawDef as import("../../../src/types/workflow").WorkflowDefinition
        logger.info("workflow:runDefinition requested", { workflowId: def.id, paramKeys: Object.keys(params) })
        const engine = ctx.resolve<WorkflowEngine>("core.workflow.engine")
        const snapshots = ctx.resolve<RunSnapshotService>("core.workflow.snapshots")
        const eventBus = ctx.resolve<EventBus>("core.event-bus")
        const abortMap = ctx.resolve<Map<string, AbortController>>("core.workflow.run-aborts")
        const runStatuses = ctx.resolve<Map<string, WorkflowRunStatus>>("core.workflow.run-statuses")

        const validation = validateWorkflow(def)
        if (!validation.valid) {
          logger.warn("workflow:runDefinition blocked by validation", { workflowId: def.id, errors: validation.errors })
          return { errors: validation.errors }
        }
        const paramErrors = validateRunParams(def, params)
        if (paramErrors.length > 0) {
          logger.warn("workflow:runDefinition blocked by missing params", { workflowId: def.id, errors: paramErrors })
          return { errors: paramErrors }
        }
        const effectiveParams = buildEffectiveRunParams(def, params)

        if (!force) {
          const activeRunId = findActiveRun(runStatuses, def.id)
          if (activeRunId) {
            logger.info("workflow:runDefinition conflict", { workflowId: def.id, activeRunId })
            return { conflict: true as const, activeRunId }
          }
        } else {
          const abortedRunIds: string[] = []
          for (const [existingRunId, status] of runStatuses) {
            if (status.workflowId === def.id && status.status === "running") {
              logger.info("workflow:runDefinition force — cancelling active run", { activeRunId: existingRunId })
              abortMap.get(existingRunId)?.abort()
              abortedRunIds.push(existingRunId)
            }
          }
          await Promise.all(abortedRunIds.map(waitForRunCompletion))
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
      request: z.object({ previousRunId: z.string(), params: z.record(z.string(), z.unknown()), force: z.boolean().optional() }),
      response: z.union([
        z.object({ runId: z.string() }),
        z.object({ errors: z.array(z.object({ type: z.string(), nodeId: z.string().optional(), edgeId: z.string().optional(), message: z.string() })) }),
        z.object({ conflict: z.literal(true), activeRunId: z.string() }),
      ]),
      handler: async (ctx, { previousRunId, params, force }: { previousRunId: string; params: Record<string, unknown>; force?: boolean }) => {
        logger.info("workflow:rerun requested", { previousRunId })
        const runStatuses = ctx.resolve<Map<string, WorkflowRunStatus>>("core.workflow.run-statuses")
        const snapshots = ctx.resolve<RunSnapshotService>("core.workflow.snapshots")

        let def: import("../../../src/types/workflow").WorkflowDefinition | undefined
        let workflowId: string | undefined
        let previousParams: Record<string, unknown> | undefined

        const memoryStatus = runStatuses.get(previousRunId)
        if (memoryStatus?.definition) {
          def = memoryStatus.definition
          workflowId = memoryStatus.workflowId
          previousParams = memoryStatus.params
        } else {
          const snapshot = await snapshots.findByRunId(previousRunId)
          if (snapshot?.definition) {
            def = snapshot.definition
            workflowId = snapshot.workflowId
            previousParams = snapshot.params
          }
        }

        if (!def || !workflowId) {
          logger.error("workflow:rerun — cannot find definition for previous run", { previousRunId })
          return { errors: [{ type: "invalid_config", message: "无法找到上次运行使用的工作流定义" }] }
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

        const validation = validateWorkflow(def)
        if (!validation.valid) return { errors: validation.errors }
        const paramErrors = validateRunParams(def, effectiveParams)
        if (paramErrors.length > 0) {
          logger.warn("workflow:rerun blocked by missing params", { workflowId, errors: paramErrors })
          return { errors: paramErrors }
        }
        const validatedParams = buildEffectiveRunParams(def, effectiveParams)

        // Check for conflicting active runs before auto-aborting
        if (!force) {
          for (const [existingRunId, status] of runStatuses) {
            if (status.workflowId === workflowId && status.status === "running") {
              return { conflict: true as const, activeRunId: existingRunId }
            }
          }
        }

        const abortedRunIds: string[] = []
        for (const [existingRunId, status] of runStatuses) {
          if (status.workflowId === workflowId && status.status === "running") {
            abortMap.get(existingRunId)?.abort()
            abortedRunIds.push(existingRunId)
          }
        }
        await Promise.all(abortedRunIds.map(waitForRunCompletion))

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

        return { runId }
      },
    },
    openRunner: {
      channel: "synapse:workflow:open-runner", kind: "invoke",
      request: z.object({ workflowId: z.string(), runId: z.string() }),
      response: z.void(),
      handler: async (ctx, { workflowId, runId }: { workflowId: string; runId: string }) => {
        logger.info("workflow:openRunner", { workflowId, runId })
        const baseUrl = rendererBaseUrl()
        await ctx.resolve<WorkflowWindowManager>("core.workflow.window-manager").openRunner(workflowId, runId, baseUrl)
      },
    },
    cancel: {
      channel: "synapse:workflow:cancel", kind: "invoke", request: z.object({ runId: z.string() }), response: z.void(),
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
    runHistory: {
      channel: "synapse:workflow:run-history", kind: "invoke", request: z.object({ workflowId: z.string() }), response: z.array(workflowRunSnapshotSchema),
      handler: async (ctx, { workflowId }: { workflowId: string }) => ctx.resolve<RunSnapshotService>("core.workflow.snapshots").list(workflowId),
    },
    runStatus: {
      channel: "synapse:workflow:run-status", kind: "invoke", request: z.object({ runId: z.string() }), response: workflowRunStatusSchema.nullable(),
      handler: async (ctx, { runId }: { runId: string }) => {
        const live = ctx.resolve<Map<string, WorkflowRunStatus>>("core.workflow.run-statuses").get(runId)
        if (live) return live
        // Fallback: terminal runs pruned from the in-memory map (MAX_TERMINAL_STATUSES_PER_WORKFLOW = 5)
        // are still on disk (up to MAX = 20 snapshots per workflow). Without this, opening an
        // older run from the history dialog would render an empty runner (no definition,
        // no node results, stuck at "running"). Hydrate from the snapshot store instead.
        const snap = await ctx.resolve<RunSnapshotService>("core.workflow.snapshots").findByRunId(runId)
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
            ...(error ? { error } : {}),
          }
          logger.info("run-status hydrated from snapshot", {
            runId, workflowId: snap.workflowId, status: snap.status,
            nodeCount: Object.keys(snap.nodeResults).length,
            hasDefinition: !!snap.definition,
            ...(recoveredErrorFromNodeResults ? { recoveredErrorFromNodeResults: true } : {}),
          })
          return hydrated
        }
        logger.warn("run-status not found in memory or snapshots", { runId })
        return null
      },
    },
    openEditor: {
      channel: "synapse:workflow:open-editor", kind: "invoke", request: z.object({ id: z.string(), runId: z.string().optional() }), response: z.void(),
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
