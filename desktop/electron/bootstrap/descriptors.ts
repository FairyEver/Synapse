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
import { createWorkflowDispatcher } from "../capabilities/workflow-dispatcher"
import { configStore } from "../services/config-store"
import { logStore, createMainLogger } from "../services/log-store"
import { initializeAppIcon } from "../services/app-icon-service"
import { updateService } from "../services/update-service"
import { initDatabase, shutdownDatabase } from "../database"
import { dispatchDatabaseAction } from "../database/dispatcher"
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
import { FeishuConnectorService } from "../services/connectors"
import { SideChannelService } from "../services/side-channel"
import { ExecutionIsolationService } from "../services/execution-isolation"
import { AgentRelayService } from "../services/relay"
import { AutomationIngressService } from "../services/automation-ingress"
import { DiagnosticsService } from "../services/diagnostics-service"
import { LicenseClient, LicenseService } from "../services/license"
import { createConfigBackupPayload } from "../services/config-backup-service"
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
import { DataRepositoryAuditSink, createPermissionGuard, userInitiatedAllowPolicy, systemShellExecPolicy } from "../runtime/security"
import type { ProcessRuntime } from "../runtime/process"
import { createControlledProcessRunner, createMainProcessRuntime } from "../runtime/process"
import type { NetworkServiceRegistry } from "../runtime/network"
import { createNetworkServiceRegistry, sendOutboundHttpRequest } from "../runtime/network"
import type { ProjectContainerRegistry } from "../runtime/project-container"
import { createProjectContainerRegistry } from "../runtime/project-container"
import { migrateRepositoryScopedConnectorData } from "./project-scope-migration"
import { databaseService } from "../database/service"
import { getHttpPort } from "../database/http-server"
import { getCliDebugInfo } from "../database/cli-installer"
import { getMcpServers } from "../database/mcp-installer"
import { getMcpServerPort, getMcpServerUrl, isMcpServerRunning } from "../database/mcp-server"
import { collectOpsStatus } from "../modules/ops/status"
import { WorkflowService } from "../services/workflow/workflow-service"
import { WorkflowEngine } from "../services/workflow/workflow-engine"
import { RunSnapshotService } from "../services/workflow/run-snapshot-service"
import { buildEffectiveRunParams, validateWorkflow, validateRunParams } from "../services/workflow/workflow-validator"
import { WorkflowWindowManager } from "../services/workflow/window-manager"
import type { WorkflowRunStatus, ValidationError } from "../../src/types/workflow"
import { nodeTypeRegistry } from "../../workflow-nodes/registry"
import "../../workflow-nodes/register.main"

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

export const coreActionRuntimeDescriptor: ServiceDescriptor<MainActionRegistry> = {
  id: "core.action-runtime",
  criticality: "fatal",
  dependsOn: [
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
  capabilityLogger: ReturnType<typeof createMainLogger>
}) {
  return async (id: string, params: Record<string, unknown>): Promise<{ runId: string } | { errors: ValidationError[] }> => {
    const { workflowService, workflowEngine, snapshotService, eventBus, runAborts, runStatuses, capabilityLogger } = deps
    const def = await workflowService.get(id)
    if (!def) return { errors: [{ type: "invalid_config" as const, message: "Workflow not found" }] }
    const validation = validateWorkflow(def)
    if (!validation.valid) return { errors: validation.errors }
    const paramErrors = validateRunParams(def, params)
    if (paramErrors.length > 0) return { errors: paramErrors }
    const effectiveParams = buildEffectiveRunParams(def, params)
    const runId = randomUUID()
    const ac = new AbortController()
    const startedAt = Date.now()
    runAborts.set(runId, ac)
    runStatuses.set(runId, { runId, workflowId: id, status: "running", nodeResults: {}, startedAt, params: effectiveParams, definition: def })
    const appConfig = await configStore.load()
    const activeRepo = appConfig.repositories.find((r) => r.uuid === appConfig.activeRepoUuid) ?? appConfig.repositories[0]
    const projectId = activeRepo?.uuid
    workflowEngine.run(def, effectiveParams, runId, (event) => {
      const current = runStatuses.get(runId) ?? { runId, workflowId: id, status: "running" as const, nodeResults: {}, startedAt }
      const nextNodeResults = { ...current.nodeResults }
      if (event.type === "node:started") {
        nextNodeResults[event.nodeId] = { ...(nextNodeResults[event.nodeId] ?? { nodeId: event.nodeId, input: { variables: {} } }), status: "running", startedAt: event.startedAt ?? Date.now() }
      } else if (event.type === "node:completed" || event.type === "node:failed" || event.type === "node:skipped") {
        nextNodeResults[event.nodeId] = event.result ?? nextNodeResults[event.nodeId] ?? { nodeId: event.nodeId, status: "failed", input: { variables: {} } }
      }
      runStatuses.set(runId, { ...current, nodeResults: nextNodeResults })
      eventBus.emit({ domain: "workflow", type: event.type, payload: event, timestamp: new Date().toISOString() }, { backpressure: "block" })
      if (event.type === "workflow:completed" || event.type === "workflow:failed" || event.type === "workflow:cancelled") {
        runAborts.delete(runId)
        const endedAt = Date.now()
        const status = event.type === "workflow:completed" ? "completed" : event.type === "workflow:cancelled" ? "cancelled" : "failed"
        runStatuses.set(runId, { ...current, runId, workflowId: id, status, nodeResults: event.result?.nodeResults ?? nextNodeResults, startedAt, endedAt, durationMs: event.result?.durationMs ?? endedAt - startedAt, ...(event.type === "workflow:failed" ? { error: event.error } : {}) })
        snapshotService.save({ runId, workflowId: id, version: def.version, startedAt, endedAt, status, params: effectiveParams, nodeResults: event.result?.nodeResults ?? nextNodeResults, definition: def }).catch((err) => {
          capabilityLogger.warn("failed to persist workflow run snapshot", { runId, workflowId: id, boundary: "workflow-snapshot", ...capabilityRejectionDiagnostic(err) })
        })
      }
    }, ac.signal, projectId, "mcp").catch((err) => {
      const diagnostic = capabilityRejectionDiagnostic(err)
      capabilityLogger.error("workflow engine rejected (mcp dispatch)", { workflowId: id, runId, ...diagnostic })
      runAborts.delete(runId)
      const current = runStatuses.get(runId)
      if (current && current.status === "running") {
        const endedAt = Date.now()
        runStatuses.set(runId, {
          ...current, runId, workflowId: id,
          status: "failed",
          error: "工作流引擎异常",
          nodeResults: current.nodeResults,
          startedAt, endedAt,
          durationMs: endedAt - startedAt,
        })
        eventBus.emit({
          domain: "workflow",
          type: "workflow:failed",
          payload: {
            type: "workflow:failed",
            runId,
            error: "工作流引擎异常",
            result: { status: "failed", nodeResults: current.nodeResults, durationMs: endedAt - startedAt },
          },
          timestamp: new Date().toISOString(),
        }, { backpressure: "block" })
        snapshotService.save({
          runId, workflowId: id, version: def.version,
          startedAt, endedAt, status: "failed",
          params: effectiveParams,
          nodeResults: current.nodeResults,
          definition: def,
        }).catch((err) => {
          capabilityLogger.warn("failed to persist workflow run snapshot", { runId, workflowId: id, boundary: "workflow-snapshot", ...capabilityRejectionDiagnostic(err) })
        })
      }
    })
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
    const capabilityLogger = createMainLogger("bootstrap.workflow-capability")

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
        capabilityLogger,
      }),
      cancelRun: (runId: string) => { runAborts.get(runId)?.abort(); runAborts.delete(runId) },
      cancelRunsForWorkflow: (workflowId: string) => {
        for (const [runId, status] of runStatuses) {
          if (status.workflowId === workflowId && status.status === "running") {
            runAborts.get(runId)?.abort()
            runAborts.delete(runId)
          }
        }
      },
      getRunStatus: async (runId: string) => runStatuses.get(runId) ?? null,
      listProviders: () => providerService.listProviders(),
    })

    const actionRouter = createSynapseActionRouter({
      databaseDispatch: dispatchDatabaseAction,
      schedulerDispatch: (action, params) => dispatchSchedulerAction(taskScheduler, actionRuntime, action, params),
      workflowDispatch: (action, params, context) => workflowDispatcher.dispatch(action, params, context),
    })
    await initDatabase(eventBus, actionRouter)
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
  dependsOn: ["core.config"],
  async create() {
    const config = await configStore.load()
    for (const repository of config.repositories) {
      repositoryStore.watchRepository(repository)
    }
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
              if (!defNodes) continue
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
    "core.config",
    "core.logging",
    "core.data-repository",
    "core.permission-guard",
    "core.audit-sink",
    "core.database",
  ],
  create(ctx) {
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
      getCliDebugInfo,
      getMcpHttpStatus: () => ({
        running: isMcpServerRunning(),
        port: getMcpServerPort(),
        url: getMcpServerUrl(),
      }),
      getMcpServers,
      probeMcpHttp,
      permissionGuard: ctx.registry.get<PermissionGuard>("core.permission-guard"),
      auditSink: ctx.registry.get<AuditSink>("core.audit-sink"),
      logger: ctx.logger.child("diagnostics"),
      createZipArchive,
      createConfigBackupPayload,
    })
  },
}

export const coreLicenseDescriptor: ServiceDescriptor<LicenseService> = {
  id: "core.license",
  criticality: "fatal",
  dependsOn: [
    "core.data-repository",
    "core.permission-guard",
    "core.audit-sink",
  ],
  create(ctx) {
    const permissionGuard = ctx.registry.get<PermissionGuard>("core.permission-guard")
    const auditSink = ctx.registry.get<AuditSink>("core.audit-sink")
    return new LicenseService({
      store: ctx.registry.get<DataRepository>("core.data-repository").namespace("core.license"),
      client: new LicenseClient({ permissionGuard, auditSink, logger: ctx.logger.child("license.http") }),
      appVersion: app.getVersion(),
      logger: ctx.logger.child("license"),
    })
  },
  start(service) {
    service.start()
  },
  stop(service) {
    service.stop()
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
  create() {
    return createMainProcessRuntime()
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
    "core.feishu-connector",
    "core.data-repository",
    "core.audit-sink",
  ],
  create(ctx) {
    const dataRepository = ctx.registry.get<DataRepository>("core.data-repository")
    const sideChannel = ctx.registry.get<SideChannelService>("core.side-channel")
    const feishuConnector = ctx.registry.get<FeishuConnectorService>("core.feishu-connector")
    const service = new AgentRelayService({
      projectContainers: ctx.registry.get<ProjectContainerRegistry>("core.project-containers"),
      bindings: dataRepository.namespace("relay.bindings"),
      runs: dataRepository.namespace("relay.runs"),
      sideChannel,
      feishuConnector,
      listProjects: listConfiguredProjects,
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
    feishuConnector.registerRelayService(service)
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
    "core.feishu-connector",
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
      feishuConnector: ctx.registry.get<FeishuConnectorService>("core.feishu-connector"),
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

export const coreFeishuConnectorDescriptor: ServiceDescriptor<FeishuConnectorService> = {
  id: "core.feishu-connector",
  criticality: "degraded",
  dependsOn: [
    "core.project-containers",
    "core.side-channel",
    "core.data-repository",
    "core.permission-guard",
    "core.audit-sink",
  ],
  async create(ctx) {
    const dataRepository = ctx.registry.get<DataRepository>("core.data-repository")
    const config = await configStore.load()
    await migrateRepositoryScopedConnectorData(dataRepository, config, ctx.logger.child("project-scope-migration"))
    return new FeishuConnectorService({
      projectContainers: ctx.registry.get<ProjectContainerRegistry>("core.project-containers"),
      sideChannel: ctx.registry.get<SideChannelService>("core.side-channel"),
      dataRepository,
      listProjects: listConfiguredProjects,
      permissionGuard: ctx.registry.get<PermissionGuard>("core.permission-guard"),
      auditSink: ctx.registry.get<AuditSink>("core.audit-sink"),
      logger: ctx.logger.child("feishu-connector"),
    })
  },
  start(service) {
    service.start()
  },
  stop(service) {
    return service.stop()
  },
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
 * core.token-usage — registers IPC handlers for the token usage monitor.
 *
 * Status: degraded — token usage is non-critical.
 */
export const coreTokenUsageDescriptor: ServiceDescriptor<{ initialized: true }> = {
  id: "core.token-usage",
  criticality: "degraded",
  dependsOn: [],
  async create() {
    const { registerTokenUsageHandlers } = await import("../token-usage/ipc-handlers.js")
    registerTokenUsageHandlers()
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
  dependsOn: [],
  async create() {
    const { registerHttpTestHandlers } = await import("../modules/http-test/ipc.js")
    registerHttpTestHandlers()
    return { initialized: true }
  },
}

export const coreWorkflowServiceDescriptor: ServiceDescriptor<WorkflowService> = {
  id: "core.workflow",
  criticality: "degraded",
  dependsOn: ["core.config"],
  create() {
    // Pass a getter so WorkflowService always resolves the CURRENT active repo path,
    // not a stale snapshot captured at service creation time.
    const getRepoPath = (): string => {
      const config = configStore.loadSync()
      const activeRepo = config.repositories.find((r) => r.uuid === config.activeRepoUuid) ?? config.repositories[0]
      return activeRepo?.localPath ?? app.getPath("userData")
    }
    return new WorkflowService(getRepoPath)
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
    const sendToAgent: import("../../workflow-nodes/types").AgentSendDeps["sendToAgent"] = async ({ providerId, modelTier, prompt, projectId, abortSignal }) => {
      try {
        const config = await configStore.load()
        const repo = projectId
          ? config.repositories.find((r) => r.uuid === projectId)
          : (config.repositories.find((r) => r.uuid === config.activeRepoUuid) ?? config.repositories[0])
        const effectiveProjectId = repo?.uuid ?? ""
        const workspacePath = repo?.localPath ?? os.homedir()
        const containers = registry.get<ProjectContainerRegistry>("core.project-containers")
        const container = await containers.open(effectiveProjectId, { name: "", workspacePath })
        const agentRuntime = container.get<import("../services/agent-runtime").AgentRuntimeService>(AGENT_RUNTIME_SERVICE_ID)
        const result = await agentRuntime.sendScheduled({
          projectId: effectiveProjectId, agentType: "claude-code", mode: "bypassPermissions", prompt,
          providerId, modelTier,
          sessionPolicy: "fresh", timeoutMs: 120_000, abortSignal,
        })
        return { status: result.status === "success" ? "success" : "failed", response: result.summary ?? "", error: result.error, durationMs: result.durationMs }
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
      sendHttpRequest: sendOutboundHttpRequest,
    }
    return new WorkflowEngine({ sendToAgent }, undefined, runtimeDeps)
  },
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
      errorMessage: error.message.length > 200 ? error.message.slice(0, 200) + "…" : error.message,
      stackLength: error.stack?.length,
    }
  }
  const message = String(error)
  return {
    errorName: typeof error,
    errorLength: message.length,
    errorMessage: message.length > 200 ? message.slice(0, 200) + "…" : message,
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
      errorMessage: error.message.length > 200 ? error.message.slice(0, 200) + "…" : error.message,
      stackLength: error.stack?.length,
    }
  }
  const message = String(error)
  return {
    errorName: typeof error,
    errorLength: message.length,
    errorMessage: message.length > 200 ? message.slice(0, 200) + "…" : message,
  }
}

function workflowAgentFailureMessage(diagnostic: { readonly errorName: string; readonly errorMessage?: string }): string {
  const detail = diagnostic.errorMessage ?? "unknown error"
  return `Agent call failed (${diagnostic.errorName}): ${detail}`
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
