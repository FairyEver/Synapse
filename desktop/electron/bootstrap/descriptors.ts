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
 *   initDataStore()                      -> core.data-store    (degraded)
 *   updateService.initialize()           -> core.update        (degraded)
 *   repositoryStore.watchRepository(*)   -> repo.watch         (degraded)
 *   repositoryMaintenanceService         -> repo.maintenance   (degraded)
 *   pendingPushesService                 -> repo.pending-pushes(degraded)
 *   createTray()                         -> ui.tray            (degraded)
 *
 * Phase 0.1 lands core.config + core.logging here (T1.5).
 * T1.6 adds core.data-store / core.update / core.app-icon.
 * T1.7 adds repo.* + ui.tray.
 */

import { app, safeStorage } from "electron"
import path from "node:path"

import type { ServiceDescriptor } from "../runtime/service-registry"
import { createZipArchive } from "../runtime/archive"
import { configStore } from "../services/config-store"
import { logStore } from "../services/log-store"
import { initializeAppIcon } from "../services/app-icon-service"
import { updateService } from "../services/update-service"
import { initDataStore, shutdownDataStore } from "../data-store"
import { repositoryStore } from "../services/repository-store"
import { repositoryMaintenanceService } from "../services/repository-maintenance-service"
import { pendingPushesService } from "../services/pending-pushes-service"
import { createTray, destroyTray } from "../services/tray-service"
import { createAgentRuntimeProjectService } from "../services/agent-runtime"
import { createProviderConfigProjectService } from "../services/provider-config"
import { BridgeAdapterService } from "../services/bridge-adapter"
import { FeishuConnectorService } from "../services/connectors"
import { SideChannelService } from "../services/side-channel"
import { ExecutionIsolationService } from "../services/execution-isolation"
import { AgentRelayService } from "../services/relay"
import { AutomationIngressService } from "../services/automation-ingress"
import { DiagnosticsService } from "../services/diagnostics-service"
import { createConfigBackupPayload } from "../services/config-backup-service"
import {
  CronExecutionService,
  HeartbeatRepository,
  HeartbeatService,
  ScheduledJobRepository,
  SchedulerService,
} from "../services/scheduler"
import type { WindowManager } from "../runtime/window"
import { createWindowManager } from "../runtime/window"
import type { EventBus } from "../runtime/event-bus"
import { createEventBus } from "../runtime/event-bus/bus"
import { WindowBroadcaster } from "../runtime/event-bus/broadcaster"
import type { DataRepository } from "../runtime/data-repo"
import { createFileBackedDataRepository } from "../runtime/data-repo"
import type { PermissionGuard, AuditSink } from "../runtime/security"
import { DataRepositoryAuditSink, createPermissionGuard } from "../runtime/security"
import type { ProcessRuntime } from "../runtime/process"
import { createControlledProcessRunner, createMainProcessRuntime } from "../runtime/process"
import type { NetworkServiceRegistry } from "../runtime/network"
import { createNetworkServiceRegistry } from "../runtime/network"
import type { ProjectContainerRegistry } from "../runtime/project-container"
import { createProjectContainerRegistry } from "../runtime/project-container"
import { migrateRepositoryScopedConnectorData } from "./project-scope-migration"
import { dataStoreService } from "../data-store/service"
import { getHttpPort } from "../data-store/http-server"
import { getCliDebugInfo } from "../data-store/cli-installer"
import { getMcpServers } from "../data-store/mcp-installer"
import { getMcpServerPort, getMcpServerUrl, isMcpServerRunning } from "../data-store/mcp-server"
import { collectOpsStatus } from "../modules/ops/status"

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

/**
 * core.data-store — opens SQLite, starts HTTP + MCP servers, registers IPC,
 * wires change dispatcher, attempts CLI install, attempts MCP registration.
 * Wraps `initDataStore()` and `shutdownDataStore()`.
 *
 * Status: degraded — SPEC §4 mapping. If the data store fails the app still
 * runs without CLI/MCP.
 */
export const coreDataStoreDescriptor: ServiceDescriptor<{ initialized: true }> = {
  id: "core.data-store",
  criticality: "degraded",
  dependsOn: ["core.config", "core.event-bus"],
  async create(ctx) {
    const eventBus = ctx.registry.get<EventBus>("core.event-bus")
    await initDataStore(eventBus)
    return { initialized: true }
  },
  async stop() {
    await shutdownDataStore()
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
 * at startup. SPEC §4 lists this as `repo.watch`-dependent. Status: degraded.
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
  dependsOn: ["repo.watch"],
  create(ctx) {
    void (async () => {
      try {
        const config = await configStore.load()
        for (const repository of config.repositories) {
          try {
            await repositoryMaintenanceService.runScheduledMaintenanceIfDue(repository)
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
  dependsOn: ["core.data-store"],
  create: () => pendingPushesService,
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
      rootDir: `${app.getPath("userData")}/data-v1`,
      safeStorage,
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
    "core.data-store",
  ],
  create(ctx) {
    return new DiagnosticsService({
      appInfo: app,
      configStore,
      dataRepository: ctx.registry.get<DataRepository>("core.data-repository"),
      serviceRegistry: ctx.registry,
      logStore,
      dataStore: dataStoreService,
      getDataStoreRuntimeStatus: () => {
        const dbPath = dataStoreService.getDbPath()
        return {
          port: getHttpPort(),
          running: getHttpPort() > 0,
          dbSize: dataStoreService.getDbSize(),
          tableCount: dataStoreService.getTableCount(),
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
    return createPermissionGuard()
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
    registry.registerService(createProviderConfigProjectService())
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

export const coreSchedulerDescriptor: ServiceDescriptor<SchedulerService> = {
  id: "core.scheduler",
  criticality: "degraded",
  dependsOn: [
    "core.project-containers",
    "core.side-channel",
    "core.feishu-connector",
    "core.data-repository",
    "core.permission-guard",
    "core.audit-sink",
    "core.execution-isolation",
  ],
  create(ctx) {
    const permissionGuard = ctx.registry.get<PermissionGuard>("core.permission-guard")
    const auditSink = ctx.registry.get<AuditSink>("core.audit-sink")
    const dataRepository = ctx.registry.get<DataRepository>("core.data-repository")
    const sideChannel = ctx.registry.get<SideChannelService>("core.side-channel")
    const feishuConnector = ctx.registry.get<FeishuConnectorService>("core.feishu-connector")
    const execution = new CronExecutionService({
      projectContainers: ctx.registry.get<ProjectContainerRegistry>("core.project-containers"),
      dataRepository,
      processRunner: createControlledProcessRunner({ permissionGuard, auditSink }),
      executionIsolation: ctx.registry.get<ExecutionIsolationService>("core.execution-isolation"),
      sideChannel,
      feishuConnector,
      listProjects: listConfiguredProjects,
      logger: ctx.logger.child("scheduler.execution"),
    })
    const service = new SchedulerService({
      repository: new ScheduledJobRepository({
        jobs: dataRepository.namespace("scheduled.jobs"),
      }),
      execution,
      sideChannel,
      logger: ctx.logger.child("scheduler"),
    })
    feishuConnector.registerSchedulerService(service)
    return service
  },
  start(service) {
    return service.start()
  },
  stop(service) {
    service.stop()
  },
}

export const coreHeartbeatDescriptor: ServiceDescriptor<HeartbeatService> = {
  id: "core.heartbeat",
  criticality: "degraded",
  dependsOn: [
    "core.project-containers",
    "core.side-channel",
    "core.feishu-connector",
    "core.data-repository",
    "core.permission-guard",
    "core.audit-sink",
    "core.execution-isolation",
  ],
  create(ctx) {
    const permissionGuard = ctx.registry.get<PermissionGuard>("core.permission-guard")
    const auditSink = ctx.registry.get<AuditSink>("core.audit-sink")
    const dataRepository = ctx.registry.get<DataRepository>("core.data-repository")
    const sideChannel = ctx.registry.get<SideChannelService>("core.side-channel")
    const feishuConnector = ctx.registry.get<FeishuConnectorService>("core.feishu-connector")
    const execution = new CronExecutionService({
      projectContainers: ctx.registry.get<ProjectContainerRegistry>("core.project-containers"),
      dataRepository,
      processRunner: createControlledProcessRunner({ permissionGuard, auditSink }),
      executionIsolation: ctx.registry.get<ExecutionIsolationService>("core.execution-isolation"),
      sideChannel,
      feishuConnector,
      listProjects: listConfiguredProjects,
      logger: ctx.logger.child("heartbeat.execution"),
    })
    const service = new HeartbeatService({
      repository: new HeartbeatRepository({
        heartbeats: dataRepository.namespace("scheduled.heartbeat"),
      }),
      execution,
      logger: ctx.logger.child("heartbeat"),
    })
    feishuConnector.registerHeartbeatService(service)
    return service
  },
  start(service) {
    return service.start()
  },
  stop(service) {
    service.stop()
  },
}
