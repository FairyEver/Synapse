/**
 * Phase 0.1 — Bootstrap layer.
 *
 * The `runtime/` tree is pure infrastructure (no `services/` imports). The
 * bootstrap layer is the glue that wires existing module-level singletons into
 * the ServiceRegistry. Later phases will collapse these singletons; for now
 * each ServiceDescriptor returns the existing singleton from `services/`.
 *
 * SPEC §4 Step 2 mapping:
 *
 *   configStore.load()                   -> core.config        (fatal)
 *   logStore                             -> core.logging       (fatal)
 *   initializeAppIcon()                  -> core.app-icon      (degraded)
 *   initDatabase()                      -> core.database    (degraded)
 *   updateService.initialize()           -> core.update        (degraded)
 *   repositoryStore.watchRepository(*)   -> repo.watch         (degraded)
 *   repositoryMaintenanceService         -> repo.maintenance   (degraded)
 *   pendingPushesService                 -> repo.pending-pushes(degraded)
 *   createTray()                         -> ui.tray            (degraded)
 *
 * Phase 0.1 lands core.config + core.logging here (T1.5).
 * T1.6 adds core.database / core.update / core.app-icon.
 * T1.7 adds repo.* + ui.tray.
 */

import { app, safeStorage } from "electron"
import os from "node:os"
import path from "node:path"
import { randomUUID } from "node:crypto"

import type { ServiceDescriptor } from "../runtime/service-registry"
import { createZipArchive } from "../runtime/archive"
import { createSynapseActionRouter } from "../capabilities/action-router"
import { createContentCapabilityDispatcher } from "../capabilities/content-dispatcher"
import { createModelPriceCapabilityDispatcher } from "../capabilities/model-price-dispatcher"
import { createWorkflowDispatcher } from "../capabilities/workflow-dispatcher"
import { configStore } from "../services/config-store"
import { logStore, createMainLogger } from "../services/log-store"
import { initializeAppIcon } from "../services/app-icon-service"
import { updateService } from "../services/update-service"
import { KnowledgeBaseService } from "../services/knowledge-base"
import { convertFilesInWorker } from "../services/tools/file-conversion-runner"
import { toolWindowService, type ToolWindowService } from "../services/tools/tool-window-service"
import { initDatabase, shutdownDatabase } from "../database"
import { dispatchDatabaseAction } from "../database/dispatcher"
import { getActiveRepositoryConfig } from "../../src/lib/config"
import { repositoryStore } from "../services/repository-store"
import { repositoryMaintenanceService } from "../services/repository-maintenance-service"
import { repositoryLockManager } from "../services/repository-lock-manager"
import { pendingPushesService } from "../services/pending-pushes-service"
import { RepositorySyncCoordinator } from "../services/repository-sync-coordinator"
import { createTray, destroyTray } from "../services/tray-service"
import { createAgentRuntimeProjectService, AgentRuntimeService, AGENT_RUNTIME_SERVICE_ID } from "../services/agent-runtime"
import {
  createProviderProjectService,
  createProviderServiceFromDataRepository,
  PROVIDER_SERVICE_ID,
  type ProviderService,
} from "../services/provider"
import { ProviderReferenceScanner } from "../services/provider/provider-reference-scanner"
import type { ConversationEntryV1 } from "../runtime/data-repo"
import { BridgeAdapterService } from "../services/bridge-adapter"
import { SideChannelService } from "../services/side-channel"
import { ExecutionIsolationService } from "../services/execution-isolation"
import { AgentRelayService } from "../services/relay"
import { AutomationIngressService } from "../services/automation-ingress"
import { DiagnosticsService } from "../services/diagnostics-service"
import { createConfigBackupPayload } from "../services/config-backup-service"
import { contentService } from "../services/content-service"
import { contentSubmissionService } from "../services/content-submission-service"
import { prepareContentIconImageBytes } from "../services/content-icon-image-service"
import { readSkillDraftFromDirectory } from "../services/content-skill-source-service"
import { getUsageAnalysisDb } from "../services/usage-analysis"
import { userIdentityService } from "../services/user-identity-service"
import { clearDeprecatedStores } from "./deprecated-store-cleanup"
import {
  ScheduledTaskRepository,
  ScheduledTaskRunRepository,
  TaskSchedulerExecutionService,
  TaskSchedulerService,
  dispatchSchedulerAction,
} from "../services/task-scheduler"
import { createBuiltinMainActionRegistry } from "../action-runtime/builtin-actions"
import type { MainActionRegistry } from "../action-runtime/action-registry"
import type { WindowManager } from "../runtime/window"
import { createWindowManager } from "../runtime/window"
import type { EventBus } from "../runtime/event-bus"
import { createEventBus } from "../runtime/event-bus/bus"
import { WindowBroadcaster } from "../runtime/event-bus/broadcaster"
import type { DataRepository } from "../runtime/data-repo"
import { createFileBackedDataRepository } from "../runtime/data-repo"
import type { PermissionGuard, AuditSink } from "../runtime/security"
import { DataRepositoryAuditSink, createPermissionGuard, userInitiatedAllowPolicy, systemShellExecPolicy, systemAutomationPolicy } from "../runtime/security"
import type { ProcessRuntime } from "../runtime/process"
import {
  buildHostEnvironment,
  collectShellEnvironmentSnapshot,
  createControlledProcessRunner,
  createMainProcessRuntime,
  ensureNodeRuntimeShims,
  type ShellEnvironmentSnapshot,
} from "../runtime/process"
import type { NetworkServiceRegistry } from "../runtime/network"
import { createNetworkServiceRegistry, sendOutboundHttpRequest } from "../runtime/network"
import type { ProjectContainerRegistry } from "../runtime/project-container"
import { createProjectContainerRegistry } from "../runtime/project-container"
import { databaseService } from "../database/service"
import { getHttpPort } from "../database/http-server"
import { getMcpServers } from "../database/mcp-installer"
import { getMcpServerPort, getMcpServerUrl, isMcpServerRunning } from "../database/mcp-server"
import { collectOpsStatus } from "../modules/ops/status"
import { WorkflowService } from "../services/workflow/workflow-service"
import { WorkflowPackageService } from "../services/workflow/workflow-package-service"
import { WorkflowEngine } from "../services/workflow/workflow-engine"
import { RunSnapshotService } from "../services/workflow/run-snapshot-service"
import { buildEffectiveRunParams, validateWorkflow, validateRunParams } from "../services/workflow/workflow-validator"
import { sanitizeNodeResultsForSnapshot } from "../services/workflow/run-snapshot-sanitize"
import { WorkflowWindowManager } from "../services/workflow/window-manager"
import { createWorkflowFileConversionOutputWriter } from "../services/workflow/file-conversion-output-writer"
import { createDefaultFileConversionService } from "../services/file-conversion"
import { sanitizeError } from "../services/error-sanitize"
import type { WorkflowRunStatus, ValidationError } from "../../src/types/workflow"
import { agentTimeoutMinsToMs, DEFAULT_AGENT_TIMEOUT_MINS } from "../../workflow-nodes/agent-timeout"
import { nodeTypeRegistry } from "../../workflow-nodes/registry"
import "../../workflow-nodes/register.main"

type ProcessEnvironmentService = {
  readonly nodeRuntimeBinPath?: string
  readonly nodePath?: string
  readonly shell: ShellEnvironmentSnapshot
  readonly shimError?: string
}

/**
 * core.logging — wraps the existing `logStore` singleton.
 *
 * The singleton is constructed at module-load time. `create` simply returns
 * the existing handle so the rest of the bootstrap code can `registry.get`
 * it as `core.logging`. Real LogService setup (file rotation) happens lazily
 * on first write, so we have nothing extra to do at start time.
 *
 * Status: fatal — without logging the app can still technically run, but we
 * declare it fatal so any future fatal-only service can depend on it.
 */
export const coreLoggingDescriptor: ServiceDescriptor<typeof logStore> = {
  id: "core.logging",
  criticality: "fatal",
  create: () => logStore,
}

export const coreProcessEnvironmentDescriptor: ServiceDescriptor<ProcessEnvironmentService> = {
  id: "core.process-environment",
  criticality: "degraded",
  async create() {
    const runtimeBinPath = path.join(app.getPath("userData"), "runtime-bin")
    let nodePath: string | undefined
    let shimError: string | undefined
    try {
      const shims = await ensureNodeRuntimeShims({
        directoryPath: runtimeBinPath,
        runtimePath: app.getPath("exe"),
      })
      nodePath = shims.nodePath
      process.env.SYNAPSE_NODE_RUNTIME_BIN = shims.directoryPath
      process.env.SYNAPSE_NODE_BIN = shims.nodePath
    } catch (error) {
      shimError = error instanceof Error ? error.message : String(error)
    }

    const nextEnv = buildHostEnvironment({
      baseEnv: process.env,
      appendPathEntries: shimError ? [] : [runtimeBinPath],
    })
    Object.assign(process.env, nextEnv)

    return {
      nodeRuntimeBinPath: shimError ? undefined : runtimeBinPath,
      nodePath,
      shell: collectShellEnvironmentSnapshot({
        baseEnv: process.env,
        nodeRuntimeBinPath: shimError ? null : runtimeBinPath,
      }),
      shimError,
    }
  },
}

/**
 * core.config — wraps the existing `configStore` singleton and initializes the
 * DataRepository-backed config during start.
 *
 * Status: fatal — SPEC §4 mapping table.
 */
export const coreConfigDescriptor: ServiceDescriptor<typeof configStore> = {
  id: "core.config",
  criticality: "fatal",
  async create() {
    await configStore.initialize()
    await configStore.load()
    return configStore
  },
}

/**
 * core.app-icon — initializes the per-platform app icon. Wraps
 * `initializeAppIcon()` (which guards against re-init internally).
 *
 * Status: degraded — missing icon should not block startup.
 */
export const coreAppIconDescriptor: ServiceDescriptor<{ initialized: true }> = {
  id: "core.app-icon",
  criticality: "degraded",
  create() {
    initializeAppIcon()
    return { initialized: true }
  },
}

export const coreKnowledgeBaseDescriptor: ServiceDescriptor<KnowledgeBaseService> = {
  id: "knowledge-base.service",
  criticality: "degraded",
  create() {
    return new KnowledgeBaseService()
  },
}

export const coreToolsWindowDescriptor: ServiceDescriptor<ToolWindowService> = {
  id: "tools.window-service",
  criticality: "degraded",
  create() {
    return toolWindowService
  },
}

export const coreToolsFileConversionRunnerDescriptor: ServiceDescriptor<typeof convertFilesInWorker> = {
  id: "tools.file-conversion-runner",
  criticality: "degraded",
  create() {
    return convertFilesInWorker
  },
}

export const coreActionRuntimeDescriptor: ServiceDescriptor<MainActionRegistry> = {
  id: "core.action-runtime",
  criticality: "fatal",
  dependsOn: [
    "core.process-environment",
    "core.permission-guard",
    "core.audit-sink",
  ],
  create(ctx) {
    const permissionGuard = ctx.registry.get<PermissionGuard>("core.permission-guard")
    const auditSink = ctx.registry.get<AuditSink>("core.audit-sink")
    return createBuiltinMainActionRegistry({
      processRunner: createControlledProcessRunner({ permissionGuard, auditSink }),
      getAgentRuntime: async (projectId) => {
        const containers = ctx.registry.get<ProjectContainerRegistry>("core.project-containers")
        const existing = containers.peek(projectId)
        if (existing) {
          return existing.get<AgentRuntimeService>(AGENT_RUNTIME_SERVICE_ID)
        }
        const config = await configStore.load()
        const repo = config.repositories.find((r) => r.uuid === projectId)
        const proj = !repo ? config.global.projects.find((p) => p.id === projectId) : undefined
        const meta = repo
          ? { name: repo.name, workspacePath: repo.localPath }
          : proj
            ? { name: proj.name, workspacePath: proj.path }
            : undefined
        if (!meta) return undefined
        const container = await containers.open(projectId, meta)
        return container.get<AgentRuntimeService>(AGENT_RUNTIME_SERVICE_ID)
      },
    })
  },
}

export function createRunWorkflowHandler(deps: {
  workflowService: Pick<WorkflowService, "get">
  workflowEngine: WorkflowEngine
  snapshotService: Pick<RunSnapshotService, "save">
  eventBus: EventBus
  runAborts: Map<string, AbortController>
  runStatuses: Map<string, WorkflowRunStatus>
  runCompletions: Map<string, Promise<unknown>>
  capabilityLogger: ReturnType<typeof createMainLogger>
  isWorkflowDeleted?: (workflowId: string) => boolean
}) {
  return async (id: string, params: Record<string, unknown>): Promise<{ runId: string } | { errors: ValidationError[] }> => {
    const { workflowService, workflowEngine, snapshotService, eventBus, runAborts, runStatuses, runCompletions, capabilityLogger, isWorkflowDeleted } = deps
    const def = await workflowService.get(id)
    if (!def) return { errors: [{ type: "invalid_config" as const, message: "Workflow not found" }] }
    const validation = validateWorkflow(def)
    if (!validation.valid) return { errors: validation.errors }
    const paramErrors = validateRunParams(def, params)
    if (paramErrors.length > 0) return { errors: paramErrors }

    for (const [, status] of runStatuses) {
      if (status.workflowId === id && status.status === "running") {
        return { errors: [{ type: "invalid_config" as const, message: "已有运行中的实例，请先取消或等待完成" }] }
      }
    }

    const effectiveParams = buildEffectiveRunParams(def, params)
    const runId = randomUUID()
    const ac = new AbortController()
    const startedAt = Date.now()
    runAborts.set(runId, ac)
    runStatuses.set(runId, { runId, workflowId: id, status: "running", nodeResults: {}, startedAt, params: effectiveParams, definition: def })
    const appConfig = await configStore.load()
    const defaultProject = def.defaultProjectId
      ? appConfig.repositories.find((r) => r.uuid === def.defaultProjectId)
      : undefined
    const activeRepo = defaultProject ?? appConfig.repositories.find((r) => r.uuid === appConfig.activeRepoUuid) ?? appConfig.repositories[0]
    const projectId = activeRepo?.uuid
    const completion = workflowEngine.run(def, effectiveParams, runId, (event) => {
      const current = runStatuses.get(runId) ?? { runId, workflowId: id, status: "running" as const, nodeResults: {}, startedAt }
      const nextNodeResults = { ...current.nodeResults }
      if (event.type === "node:started") {
        nextNodeResults[event.nodeId] = { ...(nextNodeResults[event.nodeId] ?? { nodeId: event.nodeId, input: { variables: {} } }), status: "running", startedAt: event.startedAt ?? Date.now() }
      } else if (event.type === "node:agent-conversation") {
        const existing = nextNodeResults[event.nodeId] ?? { nodeId: event.nodeId, status: "running" as const, input: { variables: {} } }
        nextNodeResults[event.nodeId] = {
          ...existing,
          outputs: {
            ...(existing.outputs ?? {}),
            agentConversation: event.target,
          },
        }
      } else if (event.type === "node:completed" || event.type === "node:failed" || event.type === "node:skipped") {
        nextNodeResults[event.nodeId] = event.result ?? nextNodeResults[event.nodeId] ?? { nodeId: event.nodeId, status: "failed", input: { variables: {} } }
      }
      runStatuses.set(runId, { ...current, nodeResults: nextNodeResults })
      const isTerminalEvt = event.type === "workflow:completed" || event.type === "workflow:failed" || event.type === "workflow:cancelled"
      const emitPayload = isTerminalEvt ? { ...event, workflowId: id } : event
      eventBus.emit({ domain: "workflow", type: event.type, payload: emitPayload, timestamp: new Date().toISOString() }, { backpressure: "block" })
      if (isTerminalEvt) {
        runAborts.delete(runId)
        const endedAt = Date.now()
        const status = event.type === "workflow:completed" ? "completed" : event.type === "workflow:cancelled" ? "cancelled" : "failed"
        runStatuses.set(runId, { ...current, runId, workflowId: id, status, nodeResults: event.result?.nodeResults ?? nextNodeResults, startedAt, endedAt, durationMs: event.result?.durationMs ?? endedAt - startedAt, ...(event.type === "workflow:failed" ? { error: event.error } : {}) })
        if (!isWorkflowDeleted?.(id)) {
          Promise.resolve(snapshotService.save({ runId, workflowId: id, version: def.version, startedAt, endedAt, status, params: effectiveParams, nodeResults: sanitizeNodeResultsForSnapshot(event.result?.nodeResults ?? nextNodeResults), definition: def, ...(event.type === "workflow:failed" ? { error: event.error } : {}) })).catch((err) => {
            capabilityLogger.warn("failed to persist workflow run snapshot", { runId, workflowId: id, boundary: "workflow-snapshot", ...capabilityRejectionDiagnostic(err) })
            eventBus.emit({ domain: "workflow", type: "snapshot:failed", payload: { runId, workflowId: id, error: err instanceof Error ? err.message : String(err) }, timestamp: new Date().toISOString() }, { backpressure: "block" })
          })
        }
      }
    }, ac.signal, projectId, "mcp").catch((err) => {
      const diagnostic = capabilityRejectionDiagnostic(err)
      capabilityLogger.error("workflow engine rejected (mcp dispatch)", { workflowId: id, runId, ...diagnostic })
      runAborts.delete(runId)
      const current = runStatuses.get(runId)
      if (current && current.status === "running") {
        const endedAt = Date.now()
        const sanitizedNodeResults = sanitizeNodeResultsForSnapshot(current.nodeResults)
        runStatuses.set(runId, {
          ...current, runId, workflowId: id,
          status: "failed",
          error: "工作流引擎异常",
          nodeResults: sanitizedNodeResults,
          startedAt, endedAt,
          durationMs: endedAt - startedAt,
        })
        eventBus.emit({
          domain: "workflow",
          type: "workflow:failed",
          payload: {
            type: "workflow:failed",
            runId,
            workflowId: id,
            error: "工作流引擎异常",
            result: { status: "failed", nodeResults: sanitizedNodeResults, durationMs: endedAt - startedAt },
          },
          timestamp: new Date().toISOString(),
        }, { backpressure: "block" })
        if (!isWorkflowDeleted?.(id)) {
          Promise.resolve(snapshotService.save({
            runId, workflowId: id, version: def.version,
            startedAt, endedAt, status: "failed",
            params: effectiveParams,
            nodeResults: sanitizedNodeResults,
            definition: def,
            error: "工作流引擎异常",
          })).catch((err) => {
            capabilityLogger.warn("failed to persist workflow run snapshot", { runId, workflowId: id, boundary: "workflow-snapshot", ...capabilityRejectionDiagnostic(err) })
          })
        }
      }
    }).finally(() => {
      runCompletions.delete(runId)
    })
    runCompletions.set(runId, completion)
    return { runId }
  }
}

/**
 * core.database — opens SQLite, starts HTTP + MCP servers, registers IPC,
 * wires change dispatcher, attempts CLI install, attempts MCP registration.
 * Wraps `initDatabase()` and `shutdownDatabase()`.
 *
 * Status: degraded — SPEC §4 mapping. If the database fails the app still
 * runs without CLI/MCP.
 */
export const coreDatabaseDescriptor: ServiceDescriptor<{ initialized: true }> = {
  id: "core.database",
  criticality: "degraded",
  dependsOn: [
    "core.config",
    "core.event-bus",
    "core.task-scheduler",
    "core.action-runtime",
    "core.workflow",
    "core.workflow.snapshots",
    "core.workflow.run-aborts",
    "core.workflow.run-statuses",
    "core.workflow.engine",
    "core.permission-guard",
    "core.audit-sink",
    PROVIDER_SERVICE_ID,
  ],
  async create(ctx) {
    const eventBus = ctx.registry.get<EventBus>("core.event-bus")
    const taskScheduler = ctx.registry.get<TaskSchedulerService>("core.task-scheduler")
    const actionRuntime = ctx.registry.get<MainActionRegistry>("core.action-runtime")

    const workflowService = ctx.registry.get<WorkflowService>("core.workflow")
    const snapshotService = ctx.registry.get<RunSnapshotService>("core.workflow.snapshots")
    const runAborts = ctx.registry.get<Map<string, AbortController>>("core.workflow.run-aborts")
    const runStatuses = ctx.registry.get<Map<string, WorkflowRunStatus>>("core.workflow.run-statuses")
    const workflowEngine = ctx.registry.get<WorkflowEngine>("core.workflow.engine")
    const providerService = ctx.registry.get<ProviderService>(PROVIDER_SERVICE_ID)
    const permissionGuard = ctx.registry.get<PermissionGuard>("core.permission-guard")
    const auditSink = ctx.registry.get<AuditSink>("core.audit-sink")
    const capabilityLogger = createMainLogger("bootstrap.workflow-capability")
    const runCompletions = new Map<string, Promise<unknown>>()
    const deletedWorkflowIds = new Set<string>()

    const workflowDispatcher = createWorkflowDispatcher({
      workflowService,
      snapshotService,
      nodeTypeRegistry,
      eventBus,
      runWorkflow: createRunWorkflowHandler({
        workflowService,
        workflowEngine,
        snapshotService,
        eventBus,
        runAborts,
        runStatuses,
        runCompletions,
        capabilityLogger,
        isWorkflowDeleted: (workflowId) => deletedWorkflowIds.has(workflowId),
      }),
      cancelRun: (runId: string) => { runAborts.get(runId)?.abort(); runAborts.delete(runId) },
      cancelRunsForWorkflow: async (workflowId: string) => {
        deletedWorkflowIds.add(workflowId)
        const runningRunIds: string[] = []
        for (const [runId, status] of runStatuses) {
          if (status.workflowId === workflowId && status.status === "running") {
            runAborts.get(runId)?.abort()
            runningRunIds.push(runId)
          }
        }
        if (runningRunIds.length > 0) {
          const CANCEL_WAIT_MS = 3_000
          await Promise.all(runningRunIds.map((runId) => {
            const completion = runCompletions.get(runId)
            if (!completion) return
            return Promise.race([completion.then(() => undefined), new Promise<void>((r) => setTimeout(r, CANCEL_WAIT_MS))])
          }))
          for (const runId of runningRunIds) {
            runAborts.delete(runId)
            runStatuses.delete(runId)
          }
        }
      },
      getRunStatus: async (runId: string) => runStatuses.get(runId) ?? null,
      listProviders: () => providerService.listProviders(),
      permissionGuard,
      auditSink,
    })
    const contentDispatcher = createContentCapabilityDispatcher({
      contentReader: contentService,
      contentWriter: contentSubmissionService,
      eventBus,
      prepareIconImageBytes: prepareContentIconImageBytes,
      readSkillDraftFromDirectory,
      resolveCurrentIdentity: async () => {
        const config = await configStore.load()
        const repository = getActiveRepositoryConfig(config)
        if (!repository) {
          throw new Error("当前还没有选中的本地目录。")
        }
        return userIdentityService.requireReadyRepoProfile(repository.uuid)
      },
      security: {
        actor: { kind: "user", id: "synapse-mcp", display: "Synapse MCP" },
        auditSink,
        permissionGuard,
      },
    })
    const modelPriceDispatcher = createModelPriceCapabilityDispatcher({
      db: getUsageAnalysisDb(app.getPath("userData")),
    })

    const actionRouter = createSynapseActionRouter({
      contentDispatch: (action, params, context) => contentDispatcher.dispatch(action, params, context),
      databaseDispatch: dispatchDatabaseAction,
      modelPriceDispatch: (action, params, context) => modelPriceDispatcher.dispatch(action, params, context),
      schedulerDispatch: (action, params) => dispatchSchedulerAction(taskScheduler, actionRuntime, action, params),
      workflowDispatch: (action, params, context) => workflowDispatcher.dispatch(action, params, context),
    })
    await initDatabase(eventBus, actionRouter, { permissionGuard, auditSink })
    return { initialized: true }
  },
  async stop() {
    await shutdownDatabase()
  },
}

/**
 * core.update — initializes electron-updater + auto-check timer.
 * Wraps `updateService.initialize()` + `updateService.startAutoCheck()`.
 *
 * Status: degraded — auto-update failure must not block startup. UpdateService
 * does not expose a teardown hook; the auto-check timer is cleared automatically
 * when the process exits, which is the only time we'd care about stop().
 */
export const coreUpdateDescriptor: ServiceDescriptor<typeof updateService> = {
  id: "core.update",
  criticality: "degraded",
  dependsOn: ["core.config", "core.window-manager"],
  create(ctx) {
    const windowManager = ctx.registry.get<WindowManager>("core.window-manager")
    updateService.setWindowManager(windowManager)
    updateService.initialize()
    updateService.startAutoCheck()
    return updateService
  },
}

/**
 * repo.watch — sets up filesystem watchers for every configured repository,
 * mirroring `main.ts:213 repositoryStore.watchRepository(repository)` for each
 * configured entry. Status: degraded — a watch failure for one repo must not
 * tank startup.
 *
 * stop(): unwatchAll().
 */
export const repoWatchDescriptor: ServiceDescriptor<typeof repositoryStore> = {
  id: "repo.watch",
  criticality: "degraded",
  dependsOn: ["core.config", "core.event-bus"],
  async create(ctx) {
    const config = await configStore.load()
    const eventBus = ctx.registry.get<EventBus>("core.event-bus")

    for (const repository of config.repositories) {
      repositoryStore.watchRepository(repository)
    }

    repositoryStore.onRepositoryDisappeared((repositoryUuid) => {
      eventBus.emit({
        domain: "repository",
        type: "repository.updated",
        payload: {
          repositoryUuid,
          operation: "disappeared",
          completedAt: new Date().toISOString(),
          message: "仓库目录已不存在",
        },
        timestamp: new Date().toISOString(),
      })
    })

    return repositoryStore
  },
  stop() {
    repositoryStore.unwatchAll()
  },
}

/**
 * repo.maintenance — runs scheduled-due maintenance for each configured repo
 * at startup. It also depends on pending-push storage so scheduled Git work
 * enters the same per-repository queue as content saves and sync. Status:
 * degraded.
 *
 * IMPORTANT: maintenance runs `git fetch` per repo, which can hang for many
 * seconds on slow networks. The original main.ts:209 used
 * `void (async () => {...})()` to fire-and-forget so the main window could
 * appear immediately. We preserve that exact behaviour here: the descriptor
 * itself returns synchronously, and the actual maintenance work is launched
 * in the background. Errors are logged via ctx.logger.warn() and do NOT
 * surface as a startAll() failure.
 */
export const repoMaintenanceDescriptor: ServiceDescriptor<typeof repositoryMaintenanceService> = {
  id: "repo.maintenance",
  criticality: "degraded",
  dependsOn: ["repo.watch", "repo.pending-pushes"],
  create(ctx) {
    void (async () => {
      try {
        const config = await configStore.load()
        for (const repository of config.repositories) {
          try {
            const release = await repositoryLockManager.acquire(repository.uuid, "scheduled-maintenance")
            try {
              await repositoryMaintenanceService.runScheduledMaintenanceIfDue(repository)
            } finally {
              release()
            }
          } catch (error) {
            ctx.logger.warn("Scheduled repository maintenance failed.", {
              error,
              repositoryUuid: repository.uuid,
            })
          }
        }
      } catch (error) {
        ctx.logger.error("Repository maintenance scheduler failed.", { error })
      }
    })()
    return repositoryMaintenanceService
  },
}

/**
 * repo.pending-pushes — exposes the pending-pushes service to the registry.
 * The service itself is stateless (queries SQLite per call); this descriptor
 * is mostly a registration record so other services / IPC modules can depend
 * on it via `registry.get("repo.pending-pushes")`.
 */
export const repoPendingPushesDescriptor: ServiceDescriptor<typeof pendingPushesService> = {
  id: "repo.pending-pushes",
  criticality: "degraded",
  dependsOn: ["core.database"],
  create: () => pendingPushesService,
}

export const repoSyncCoordinatorDescriptor: ServiceDescriptor<RepositorySyncCoordinator> = {
  id: "repo.sync-coordinator",
  criticality: "degraded",
  dependsOn: ["core.event-bus", "repo.pending-pushes"],
  create(ctx) {
    return new RepositorySyncCoordinator({
      eventBus: ctx.registry.get<EventBus>("core.event-bus"),
    })
  },
}

/**
 * ui.tray — creates the system tray icon. Wraps `createTray()` and pairs it
 * with `destroyTray()` on stop.
 *
 * The tray needs a "show or create" callback to focus / re-create the main
 * window on click. We accept this callback through descriptor metadata; the
 * default falls back to focusing the first available BrowserWindow. The real
 * wiring (with the proper showOrCreateMainWindow) lands in T1.8 when main.ts
 * builds the registry.
 */
export type TrayShowOrCreateCallback = () => void

export function createUiTrayDescriptor(
  showOrCreate: TrayShowOrCreateCallback,
): ServiceDescriptor<{ initialized: true }> {
  return {
    id: "ui.tray",
    criticality: "degraded",
    dependsOn: ["core.app-icon"],
    create() {
      createTray(showOrCreate)
      return { initialized: true }
    },
    stop() {
      destroyTray()
    },
  }
}

/**
 * core.window-manager — centralizes window lifecycle and broadcast.
 * Phase 0.4 requirement: the only allowed home for webContents.send.
 *
 * Status: fatal — EventBus depends on this for cross-window broadcast.
 */
export const coreWindowManagerDescriptor: ServiceDescriptor<WindowManager> = {
  id: "core.window-manager",
  criticality: "fatal",
  create() {
    return createWindowManager()
  },
}

/**
 * core.event-bus — in-process pub/sub with optional WindowManager broadcast.
 * Phase 0.4 requirement: replaces direct webContents.send calls.
 *
 * Status: fatal — repository updates and other events flow through here.
 */
export const coreEventBusDescriptor: ServiceDescriptor<EventBus> = {
  id: "core.event-bus",
  criticality: "fatal",
  dependsOn: ["core.window-manager"],
  create(ctx) {
    const windowManager = ctx.registry.get<WindowManager>("core.window-manager")
    return createEventBus({
      broadcaster: new WindowBroadcaster(windowManager),
    })
  },
}

export const coreDataRepositoryDescriptor: ServiceDescriptor<DataRepository> = {
  id: "core.data-repository",
  criticality: "fatal",
  create() {
    return createFileBackedDataRepository({
      rootDir: path.join(app.getPath("userData"), "data-v1"),
      safeStorage,
    })
  },
}

export const providerServiceDescriptor: ServiceDescriptor<ProviderService> = {
  id: PROVIDER_SERVICE_ID,
  criticality: "fatal",
  dependsOn: [
    "core.data-repository",
    "core.permission-guard",
    "core.audit-sink",
    "core.task-scheduler",
    "core.workflow",
  ],
  create(ctx) {
    const dataRepository = ctx.registry.get<DataRepository>("core.data-repository")
    return createProviderServiceFromDataRepository({
      dataRepository,
      permissionGuard: ctx.registry.get<PermissionGuard>("core.permission-guard"),
      auditSink: ctx.registry.get<AuditSink>("core.audit-sink"),
      scanReferences: async (providerId) => {
        const taskScheduler = ctx.registry.get<TaskSchedulerService>("core.task-scheduler")
        const workflowService = ctx.registry.get<WorkflowService>("core.workflow")
        const scanner = new ProviderReferenceScanner({
          listTasks: async () => {
            const tasks = await taskScheduler.schedulerTaskList()
            return tasks.map((t) => ({ id: t.id, name: t.name, action: t.action }))
          },
          updateTaskAction: async () => {},
          listWorkflowNodes: async () => {
            const metas = await workflowService.list()
            const nodes: Array<{
              workflowId: string; workflowName: string
              nodeId: string; nodeName: string
              providerId: string; modelTier: string
            }> = []
            for (const meta of metas) {
              const def = await workflowService.get(meta.id) as Record<string, unknown> | null
              if (!def) continue
              const defNodes = (def as { nodes?: Array<{ id: string; name: string; config: Record<string, unknown> }> }).nodes
              if (defNodes) {
                for (const node of defNodes) {
                  const config = node.config
                  if (typeof config.providerId === "string" && config.providerId) {
                    nodes.push({
                      workflowId: (def as { id: string }).id,
                      workflowName: (def as { name: string }).name,
                      nodeId: node.id,
                      nodeName: node.name,
                      providerId: config.providerId,
                      modelTier: typeof config.modelTier === "string" ? config.modelTier : "default",
                    })
                  }
                }
              }
              // Workflow-level default provider — not captured by per-node config scan above
              const defaultProviderId = (def as { defaultProviderId?: string }).defaultProviderId
              if (defaultProviderId) {
                nodes.push({
                  workflowId: (def as { id: string }).id,
                  workflowName: (def as { name: string }).name,
                  nodeId: "",
                  nodeName: "工作流默认供应商",
                  providerId: defaultProviderId,
                  modelTier: typeof (def as { defaultModelTier?: string }).defaultModelTier === "string"
                    ? (def as { defaultModelTier?: string }).defaultModelTier!
                    : "default",
                })
              }
            }
            return nodes
          },
          updateWorkflowNodeProvider: async () => {},
          listConversations: async () => {
            const conversations = dataRepository.namespace<ConversationEntryV1>("conversations")
            const all = await conversations.list()
            return all.map((c) => ({
              id: c.id,
              name: c.name ?? c.id,
              providerId: c.providerId,
            }))
          },
        })
        return scanner.scan(providerId)
      },
    })
  },
}

export const coreDiagnosticsDescriptor: ServiceDescriptor<DiagnosticsService> = {
  id: "core.diagnostics",
  criticality: "degraded",
  dependsOn: [
    "core.process-environment",
    "core.config",
    "core.logging",
    "core.data-repository",
    "core.permission-guard",
    "core.audit-sink",
    "core.database",
  ],
  create(ctx) {
    const permissionGuard = ctx.registry.get<PermissionGuard>("core.permission-guard")
    const auditSink = ctx.registry.get<AuditSink>("core.audit-sink")

    return new DiagnosticsService({
      appInfo: app,
      configStore,
      dataRepository: ctx.registry.get<DataRepository>("core.data-repository"),
      serviceRegistry: ctx.registry,
      logStore,
      database: databaseService,
      getDatabaseRuntimeStatus: () => {
        const dbPath = databaseService.getDbPath()
        return {
          port: getHttpPort(),
          running: getHttpPort() > 0,
          dbSize: databaseService.getDbSize(),
          tableCount: databaseService.getTableCount(),
          dbDirectoryPath: path.dirname(dbPath),
        }
      },
      collectOpsStatus,
      getMcpHttpStatus: () => ({
        running: isMcpServerRunning(),
        port: getMcpServerPort(),
        url: getMcpServerUrl(),
      }),
      getMcpServers,
      probeMcpHttp,
      permissionGuard,
      auditSink,
      logger: ctx.logger.child("diagnostics"),
      createZipArchive: (sourceDirectoryPath, outputFilePath) => createZipArchive(sourceDirectoryPath, outputFilePath, {
        actor: { kind: "user" },
        processRunner: createControlledProcessRunner({ permissionGuard, auditSink }),
      }),
      createConfigBackupPayload,
    })
  },
}

export const deprecatedStoreCleanupDescriptor: ServiceDescriptor<{ clear: () => Promise<void> }> = {
  id: "core.deprecated-store-cleanup",
  criticality: "fatal",
  create(ctx) {
    return {
      clear: () => clearDeprecatedStores(
        app.getPath("userData"),
        ctx.logger.child("deprecated-store-cleanup"),
      ),
    }
  },
  start(service) {
    void service.clear()
  },
}

async function probeMcpHttp(url: string) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
  })
  const text = await response.text()
  let payload: unknown
  try {
    payload = text ? JSON.parse(text) : null
  } catch (error) {
    return {
      ok: false,
      method: "ping",
      status: response.status,
      error: error instanceof Error ? error.message : "MCP 响应不是 JSON",
    }
  }

  const ok = response.ok
    && typeof payload === "object"
    && payload !== null
    && "result" in payload
    && !("error" in payload)

  return ok
    ? { ok: true, method: "ping", status: response.status }
    : { ok: false, method: "ping", status: response.status, error: "MCP ping 响应异常" }
}

export const corePermissionGuardDescriptor: ServiceDescriptor<PermissionGuard> = {
  id: "core.permission-guard",
  criticality: "fatal",
  create() {
    const guard = createPermissionGuard()
    guard.registerPolicy(userInitiatedAllowPolicy)
    guard.registerPolicy(systemShellExecPolicy)
    guard.registerPolicy(systemAutomationPolicy)
    return guard
  },
}

export const coreAuditSinkDescriptor: ServiceDescriptor<AuditSink> = {
  id: "core.audit-sink",
  criticality: "fatal",
  dependsOn: ["core.data-repository"],
  create(ctx) {
    return new DataRepositoryAuditSink({
      audit: ctx.registry.get<DataRepository>("core.data-repository").namespace("audit"),
      logger: ctx.logger,
    })
  },
}

export const coreProcessRuntimeDescriptor: ServiceDescriptor<ProcessRuntime> = {
  id: "core.process-runtime",
  criticality: "fatal",
  create(ctx) {
    return createMainProcessRuntime({
      logger: ctx.logger.child("process-runtime"),
    })
  },
}

export const coreNetworkRegistryDescriptor: ServiceDescriptor<NetworkServiceRegistry> = {
  id: "core.network-registry",
  criticality: "fatal",
  create() {
    return createNetworkServiceRegistry()
  },
}

export const coreProjectContainerRegistryDescriptor: ServiceDescriptor<ProjectContainerRegistry> = {
  id: "core.project-containers",
  criticality: "fatal",
  dependsOn: [
    "core.process-environment",
    "core.event-bus",
    "core.data-repository",
    "core.permission-guard",
    "core.audit-sink",
  ],
  create(ctx) {
    const registry = createProjectContainerRegistry({
      globalRegistry: ctx.registry,
      globalEventBus: ctx.registry.get<EventBus>("core.event-bus"),
      globalDataRepo: ctx.registry.get<DataRepository>("core.data-repository"),
      buildLogger: (projectId) => ctx.logger.child(`project.${projectId}`),
    })
    registry.registerService(createProviderProjectService())
    registry.registerService(createAgentRuntimeProjectService())
    return registry
  },
}

export const coreExecutionIsolationDescriptor: ServiceDescriptor<ExecutionIsolationService> = {
  id: "core.execution-isolation",
  criticality: "degraded",
  dependsOn: [
    "core.data-repository",
    "core.permission-guard",
    "core.audit-sink",
  ],
  create(ctx) {
    const permissionGuard = ctx.registry.get<PermissionGuard>("core.permission-guard")
    const auditSink = ctx.registry.get<AuditSink>("core.audit-sink")
    const dataRepository = ctx.registry.get<DataRepository>("core.data-repository")
    return new ExecutionIsolationService({
      configs: dataRepository.namespace("run_as.config"),
      preflights: dataRepository.namespace("run_as.preflight"),
      processRunner: createControlledProcessRunner({ permissionGuard, auditSink }),
      permissionGuard,
      auditSink,
      logger: ctx.logger.child("execution-isolation"),
    })
  },
}

async function listConfiguredProjects() {
  const config = await configStore.load()
  return config.global.projects.map((project) => ({
    projectId: project.id,
    name: project.name,
    workspacePath: project.path,
  }))
}

export const coreSideChannelDescriptor: ServiceDescriptor<SideChannelService> = {
  id: "core.side-channel",
  criticality: "degraded",
  dependsOn: [
    "core.network-registry",
    "core.project-containers",
    "core.data-repository",
    "core.permission-guard",
    "core.audit-sink",
    "core.execution-isolation",
  ],
  create(ctx) {
    return new SideChannelService({
      projectContainers: ctx.registry.get<ProjectContainerRegistry>("core.project-containers"),
      networkRegistry: ctx.registry.get<NetworkServiceRegistry>("core.network-registry"),
      dataRepository: ctx.registry.get<DataRepository>("core.data-repository"),
      listProjects: listConfiguredProjects,
      permissionGuard: ctx.registry.get<PermissionGuard>("core.permission-guard"),
      auditSink: ctx.registry.get<AuditSink>("core.audit-sink"),
      executionIsolation: ctx.registry.get<ExecutionIsolationService>("core.execution-isolation"),
      logger: ctx.logger.child("side-channel"),
    })
  },
  start(service) {
    return service.start()
  },
  stop(service) {
    return service.stop()
  },
}

export const coreBridgeAdapterDescriptor: ServiceDescriptor<BridgeAdapterService> = {
  id: "core.bridge-adapter",
  criticality: "degraded",
  dependsOn: [
    "core.network-registry",
    "core.project-containers",
    "core.side-channel",
    "core.permission-guard",
    "core.audit-sink",
  ],
  create(ctx) {
    return new BridgeAdapterService({
      projectContainers: ctx.registry.get<ProjectContainerRegistry>("core.project-containers"),
      networkRegistry: ctx.registry.get<NetworkServiceRegistry>("core.network-registry"),
      sideChannel: ctx.registry.get<SideChannelService>("core.side-channel"),
      listProjects: listConfiguredProjects,
      permissionGuard: ctx.registry.get<PermissionGuard>("core.permission-guard"),
      auditSink: ctx.registry.get<AuditSink>("core.audit-sink"),
      logger: ctx.logger.child("bridge-adapter"),
    })
  },
  start(service) {
    return service.start()
  },
  stop(service) {
    return service.stop()
  },
}

export const coreRelayDescriptor: ServiceDescriptor<AgentRelayService> = {
  id: "core.relay",
  criticality: "degraded",
  dependsOn: [
    "core.project-containers",
    "core.side-channel",
    "core.data-repository",
    "core.permission-guard",
    "core.audit-sink",
  ],
  create(ctx) {
    const dataRepository = ctx.registry.get<DataRepository>("core.data-repository")
    const sideChannel = ctx.registry.get<SideChannelService>("core.side-channel")
    const service = new AgentRelayService({
      projectContainers: ctx.registry.get<ProjectContainerRegistry>("core.project-containers"),
      bindings: dataRepository.namespace("relay.bindings"),
      runs: dataRepository.namespace("relay.runs"),
      sideChannel,
      listProjects: listConfiguredProjects,
      permissionGuard: ctx.registry.get<PermissionGuard>("core.permission-guard"),
      auditSink: ctx.registry.get<AuditSink>("core.audit-sink"),
      logger: ctx.logger.child("relay"),
    })
    sideChannel.registerRelaySendHandler((context) => {
      const targetProjectId = context.request.targetProjectId
        ?? context.request.toProjectId
        ?? context.request.to
      if (!targetProjectId) {
        throw new Error("targetProjectId is required")
      }
      return service.send({
        sourceProjectId: context.sourceProjectId,
        sourceSessionKey: context.sourceSessionKey,
        targetProjectId,
        message: context.request.message ?? "",
        timeoutMs: timeoutMinsToMs(context.request.timeoutMins ?? context.request.timeout_mins),
        visible: context.request.visible,
        workspaceKey: context.request.workspaceKey,
        workspacePath: context.request.workspacePath,
        metadata: context.request.metadata,
      })
    })
    return service
  },
}

export const coreAutomationIngressDescriptor: ServiceDescriptor<AutomationIngressService> = {
  id: "core.automation-ingress",
  criticality: "degraded",
  dependsOn: [
    "core.network-registry",
    "core.project-containers",
    "core.data-repository",
    "core.permission-guard",
    "core.audit-sink",
    "core.execution-isolation",
  ],
  create(ctx) {
    const permissionGuard = ctx.registry.get<PermissionGuard>("core.permission-guard")
    const auditSink = ctx.registry.get<AuditSink>("core.audit-sink")
    const dataRepository = ctx.registry.get<DataRepository>("core.data-repository")
    return new AutomationIngressService({
      projectContainers: ctx.registry.get<ProjectContainerRegistry>("core.project-containers"),
      networkRegistry: ctx.registry.get<NetworkServiceRegistry>("core.network-registry"),
      configs: dataRepository.namespace("webhook.config"),
      runs: dataRepository.namespace("webhook.runs"),
      processRunner: createControlledProcessRunner({ permissionGuard, auditSink }),
      listProjects: listConfiguredProjects,
      permissionGuard,
      auditSink,
      executionIsolation: ctx.registry.get<ExecutionIsolationService>("core.execution-isolation"),
      logger: ctx.logger.child("automation-ingress"),
    })
  },
  start(service) {
    return service.start()
  },
  stop(service) {
    return service.stop()
  },
}

function timeoutMinsToMs(value: number | undefined): number | undefined {
  if (value === undefined) return undefined
  return value * 60_000
}

export const coreTaskSchedulerDescriptor: ServiceDescriptor<TaskSchedulerService> = {
  id: "core.task-scheduler",
  criticality: "degraded",
  dependsOn: [
    "core.data-repository",
    "core.permission-guard",
    "core.audit-sink",
    "core.action-runtime",
  ],
  create(ctx) {
    const dataRepository = ctx.registry.get<DataRepository>("core.data-repository")
    const permissionGuard = ctx.registry.get<PermissionGuard>("core.permission-guard")
    const auditSink = ctx.registry.get<AuditSink>("core.audit-sink")
    const defaultCwd = app.getPath("userData")
    const tasks = new ScheduledTaskRepository({
      tasks: dataRepository.namespace("task-scheduler.tasks"),
    })
    const runs = new ScheduledTaskRunRepository({
      runs: dataRepository.namespace("task-scheduler.runs"),
    })
    const actions = ctx.registry.get<MainActionRegistry>("core.action-runtime")
    const execution = new TaskSchedulerExecutionService({
      tasks,
      runs,
      actions,
      permissionGuard,
      auditSink,
      defaultCwd,
    })
    return new TaskSchedulerService({
      tasks,
      runs,
      actions,
      execution,
      defaultCwd,
    })
  },
  start(service) {
    return service.start()
  },
  stop(service) {
    service.stop()
  },
}

/**
 * core.usage-analysis — registers IPC handlers for CC/Codex usage analysis.
 *
 * Status: degraded — local usage reports are non-critical.
 */
export const coreUsageAnalysisDescriptor: ServiceDescriptor<{ initialized: true }> = {
  id: "core.usage-analysis",
  criticality: "degraded",
  dependsOn: [],
  async create() {
    const { registerUsageAnalysisHandlers } = await import("../usage-analysis/ipc-handlers.js")
    registerUsageAnalysisHandlers()
    return { initialized: true }
  },
}

/**
 * core.http-test — registers IPC handler for ad-hoc HTTP request testing.
 *
 * Status: degraded — test requests are non-critical.
 */
export const coreHttpTestDescriptor: ServiceDescriptor<{ initialized: true }> = {
  id: "core.http-test",
  criticality: "degraded",
  dependsOn: ["core.permission-guard", "core.audit-sink"],
  async create(ctx) {
    const { registerHttpTestHandlers } = await import("../modules/http-test/ipc.js")
    registerHttpTestHandlers({
      permissionGuard: ctx.permissionGuard,
      auditSink: ctx.auditSink,
    })
    return { initialized: true }
  },
}

export const coreWorkflowServiceDescriptor: ServiceDescriptor<WorkflowService> = {
  id: "core.workflow",
  criticality: "degraded",
  dependsOn: ["core.data-repository"],
  create(ctx) {
    const dataRepo = ctx.registry.get<DataRepository>("core.data-repository")
    return new WorkflowService(dataRepo)
  },
}

export const coreWorkflowPackageDescriptor: ServiceDescriptor<WorkflowPackageService> = {
  id: "core.workflow.package",
  criticality: "degraded",
  dependsOn: ["core.workflow", PROVIDER_SERVICE_ID],
  create(ctx) {
    return new WorkflowPackageService({
      workflowService: ctx.registry.get<WorkflowService>("core.workflow"),
      providerService: ctx.registry.get<ProviderService>(PROVIDER_SERVICE_ID),
    })
  },
}

export const coreWorkflowSnapshotsDescriptor: ServiceDescriptor<RunSnapshotService> = {
  id: "core.workflow.snapshots",
  criticality: "degraded",
  create() { return new RunSnapshotService(app.getPath("userData")) },
}

export const coreWorkflowRunAbortsDescriptor: ServiceDescriptor<Map<string, AbortController>> = {
  id: "core.workflow.run-aborts",
  criticality: "degraded",
  create() { return new Map<string, AbortController>() },
}

export const coreWorkflowRunStatusesDescriptor: ServiceDescriptor<Map<string, WorkflowRunStatus>> = {
  id: "core.workflow.run-statuses",
  criticality: "degraded",
  create() { return new Map<string, WorkflowRunStatus>() },
}

export const coreWorkflowEngineDescriptor: ServiceDescriptor<WorkflowEngine> = {
  id: "core.workflow.engine",
  criticality: "degraded",
  dependsOn: ["core.project-containers", "core.permission-guard", "core.audit-sink"],
  create(ctx) {
    const registry = ctx.registry
    const engineLogger = createMainLogger("service.workflow.engine.agent-deps")
    const sendToAgent: import("../../workflow-nodes/types").AgentSendDeps["sendToAgent"] = async ({
      providerId,
      modelTier,
      prompt,
      projectId,
      abortSignal,
      timeoutMins,
      workflowId,
      workflowName,
      workflowRunId,
      workflowNodeId,
      workflowNodeName,
      onConversationCreated,
    }) => {
      try {
        if (!projectId) {
          throw new Error("Workflow prompt project is required")
        }
        const config = await configStore.load()
        const repo = config.repositories.find((r) => r.uuid === projectId)
        const proj = !repo ? config.global.projects.find((p) => p.id === projectId) : undefined
        if (!repo && !proj) {
          throw new Error("Workflow prompt project was not found")
        }
        const effectiveProjectId = repo?.uuid ?? proj?.id ?? projectId
        const workspacePath = repo?.localPath ?? proj?.path ?? os.homedir()
        const containers = registry.get<ProjectContainerRegistry>("core.project-containers")
        const container = await containers.open(effectiveProjectId, { name: "", workspacePath })
        const agentRuntime = container.get<import("../services/agent-runtime").AgentRuntimeService>(AGENT_RUNTIME_SERVICE_ID)
        let agentConversation: import("../../src/types/agent-navigation").SynapseAgentConversationTarget | undefined
        const result = await agentRuntime.sendScheduled({
          projectId: effectiveProjectId, agentType: "claude-code", mode: "bypassPermissions", prompt,
          providerId, modelTier,
          sessionPolicy: "fresh", timeoutMs: agentTimeoutMinsToMs(timeoutMins ?? DEFAULT_AGENT_TIMEOUT_MINS), abortSignal,
          sourcePlatform: "workflow",
          userMeta: {
            source: "workflow",
            workflowId,
            workflowName,
            workflowRunId,
            workflowNodeId,
            workflowNodeName,
          },
          onConversationCreated: (target) => {
            agentConversation = target
            onConversationCreated?.(target)
          },
        })
        return {
          status: result.status === "success" ? "success" : "failed",
          response: result.summary ?? "",
          error: result.error,
          durationMs: result.durationMs,
          usage: result.usage,
          costUsd: result.costUsd,
          costCny: result.costCny,
          costCurrency: result.costCurrency,
          agentConversation: agentConversation ?? (
            result.conversationId
              ? {
                  projectId: effectiveProjectId,
                  conversationId: result.conversationId,
                  sessionKey: result.sessionKey,
                  platform: "workflow" as const,
                }
              : undefined
          ),
        }
      } catch (err) {
        const diagnostic = workflowAgentErrorDiagnostic(err)
        engineLogger.error("engine agent call failed (infrastructure)", {
          boundary: "workflow-engine.agent-deps",
          providerId, modelTier, projectId,
          ...diagnostic,
        })
        return { status: "failed", response: "", error: workflowAgentFailureMessage(diagnostic), durationMs: 0 }
      }
    }
    const permissionGuard = registry.get<PermissionGuard>("core.permission-guard")
    const auditSink = registry.get<AuditSink>("core.audit-sink")
    const runtimeDeps: import("../../workflow-nodes/types").NodeRuntimeDeps = {
      processRunner: createControlledProcessRunner({ permissionGuard, auditSink }),
      sendHttpRequest: createHttpSendHandler({ permissionGuard, auditSink }),
      fileConversionService: createDefaultFileConversionService(),
      writeWorkflowFileConversionOutput: createWorkflowFileConversionOutputWriter({ permissionGuard, auditSink }),
    }
    return new WorkflowEngine({ sendToAgent }, undefined, runtimeDeps)
  },
}

function createHttpSendHandler(deps: {
  permissionGuard: PermissionGuard
  auditSink: AuditSink
}): typeof sendOutboundHttpRequest {
  return async (request) => {
    const resource = sanitizeWorkflowHttpAuditResource(request.url)
    const permission = await deps.permissionGuard.check({
      action: "network.connect",
      actor: { kind: "system" },
      resource,
      context: { source: "workflow" },
    })
    if (!permission.allowed) {
      deps.auditSink.record({
        action: "network.connect",
        actor: { kind: "system" },
        resource,
        outcome: "denied",
        metadata: {
          source: "workflow",
          reason: permission.reason,
          policyId: permission.policyId,
        },
      })
      throw new Error(`HTTP request denied by workflow engine: ${permission.reason}`)
    }
    try {
      const response = await sendOutboundHttpRequest(request)
      deps.auditSink.record({
        action: "network.connect",
        actor: { kind: "system" },
        resource,
        outcome: "allowed",
        metadata: { status: response.status, source: "workflow" },
      })
      return response
    } catch (error) {
      deps.auditSink.record({
        action: "network.connect",
        actor: { kind: "system" },
        resource,
        outcome: "failed",
        metadata: { source: "workflow", error: sanitizeError(error instanceof Error ? error.message : String(error)) },
      })
      throw error
    }
  }
}

const SENSITIVE_WORKFLOW_HTTP_PARAM_PATTERN = /token|secret|authorization|api[_-]?key|password|bearer|auth/i

function sanitizeWorkflowHttpAuditResource(raw: string): string {
  try {
    const url = new URL(raw)
    url.username = ""
    url.password = ""
    for (const param of url.searchParams.keys()) {
      if (SENSITIVE_WORKFLOW_HTTP_PARAM_PATTERN.test(param)) {
        url.searchParams.set(param, "[REDACTED]")
      }
    }
    return url.toString()
  } catch {
    return sanitizeError(raw)
  }
}

function workflowAgentErrorDiagnostic(error: unknown): {
  readonly errorName: string
  readonly errorLength: number
  readonly errorMessage?: string
  readonly stackLength?: number
} {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorLength: error.message.length,
      errorMessage: sanitizeDiagnosticMessage(error.message),
      stackLength: error.stack?.length,
    }
  }
  const message = String(error)
  return {
    errorName: typeof error,
    errorLength: message.length,
    errorMessage: sanitizeDiagnosticMessage(message),
  }
}

function capabilityRejectionDiagnostic(error: unknown): {
  readonly errorName: string
  readonly errorLength: number
  readonly errorMessage?: string
  readonly stackLength?: number
} {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorLength: error.message.length,
      errorMessage: sanitizeDiagnosticMessage(error.message),
      stackLength: error.stack?.length,
    }
  }
  const message = String(error)
  return {
    errorName: typeof error,
    errorLength: message.length,
    errorMessage: sanitizeDiagnosticMessage(message),
  }
}

function workflowAgentFailureMessage(diagnostic: { readonly errorName: string; readonly errorLength: number; readonly errorMessage?: string }): string {
  if (!diagnostic.errorMessage) {
    return `Agent call failed (${diagnostic.errorName})`
  }
  return `Agent call failed (${diagnostic.errorName}, ${diagnostic.errorLength} chars)`
}

function sanitizeDiagnosticMessage(message: string): string {
  const safe = sanitizeError(message)
  return safe.length > 200 ? safe.slice(0, 200) + "…" : safe
}

export const coreWorkflowWindowManagerDescriptor: ServiceDescriptor<WorkflowWindowManager> = {
  id: "core.workflow.window-manager",
  criticality: "degraded",
  dependsOn: ["core.window-manager"],
  create(ctx) {
    const windowManager = ctx.registry.get<WindowManager>("core.window-manager")
    return new WorkflowWindowManager(windowManager)
  },
}
