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

import { app, safeStorage, shell } from "electron"
import os from "node:os"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { readFile, statfs } from "node:fs/promises"

import type { ServiceDescriptor } from "../runtime/service-registry"
import { createZipArchive } from "../runtime/archive"
import { createSynapseActionRouter } from "../capabilities/action-router"
import { createAppCapabilityDispatcher } from "../../app-capabilities/dispatcher"
import { createDocumentTemplateCapabilityDispatcher } from "../../app-capabilities/document-template/main/dispatcher"
import { createDocumentTemplateService } from "../../app-capabilities/document-template/main/service"
import { createScreenshotCapabilityDispatcher } from "../../app-capabilities/screenshot/main/dispatcher"
import { createScreenshotService } from "../../app-capabilities/screenshot/main/service"
import { createSoundNotifierCapabilityDispatcher } from "../../app-capabilities/sound-notifier/main/dispatcher"
import { soundNotifierIpcModule } from "../../app-capabilities/sound-notifier/main/ipc"
import { createSoundNotifierService, type SoundNotifierService } from "../../app-capabilities/sound-notifier/main/service"
import { SOUND_NOTIFIER_SETTINGS_NAMESPACE } from "../../app-capabilities/sound-notifier/shared/capability"
import { createSwarmTaskCapabilityDispatcher } from "../../app-capabilities/swarm-task/main/dispatcher"
import { createAgentRuntimeSwarmGateway, createSwarmTaskService, type SwarmTaskService } from "../../app-capabilities/swarm-task/main/service"
import { SWARM_TASK_SERVICE_ID } from "../../app-capabilities/swarm-task/shared/capability"
import { createTerminalCapabilityDispatcher } from "../../app-capabilities/terminal/main/dispatcher"
import { createTerminalService, type TerminalService } from "../../app-capabilities/terminal/main/service"
import { createTerminalStore } from "../../app-capabilities/terminal/main/store"
import { createQuickInputService, type QuickInputService } from "../../app-capabilities/quick-input/main/service"
import {
  QUICK_INPUT_ITEMS_NAMESPACE,
  QUICK_INPUT_SETTINGS_NAMESPACE,
} from "../../app-capabilities/quick-input/shared/capability"
import { AgentPersonaCache } from "../../app-capabilities/agent-personas/main/cache"
import { RemoteAgentPersonaClient } from "../../app-capabilities/agent-personas/main/remote-client"
import { createAgentPersonaService, type AgentPersonaService } from "../../app-capabilities/agent-personas/main/service"
import { AGENT_PERSONAS_REMOTE_CACHE_NAMESPACE } from "../../app-capabilities/agent-personas/shared/capability"
import { createAutomationCapabilityDispatcher } from "../capabilities/automation-dispatcher"
import { createContentCapabilityDispatcher } from "../capabilities/content-dispatcher"
import { createDriveCapabilityDispatcher } from "../capabilities/drive-dispatcher"
import { createModelPriceCapabilityDispatcher } from "../capabilities/model-price-dispatcher"
import { createRepositoryCapabilityDispatcher } from "../capabilities/repository-dispatcher"
import { createSkillRepositoryCapabilityDispatcher } from "../capabilities/skill-repository-dispatcher"
import { createVariableCapabilityDispatcher } from "../capabilities/variable-dispatcher"
import { createWorkflowDispatcher } from "../capabilities/workflow-dispatcher"
import { configStore } from "../services/config-store"
import { logStore, createMainLogger } from "../services/log-store"
import {
  assertKnowledgeBaseStorageMigrationInactive,
  KNOWLEDGE_BASE_MIGRATION_ACTIVE_ERROR,
  resolveProjectAgent,
} from "../modules/agent/ipc-shared"
import { initializeAppIcon } from "../services/app-icon-service"
import { updateService } from "../services/update-service"
import { CheatCodeStateService, CHEAT_CODE_STATE_SERVICE_ID } from "../services/cheat-code-state-service"
import { KnowledgeBaseService } from "../services/knowledge-base"
import {
  KnowledgeBaseStorageMigrationService,
  type KnowledgeBaseStorageMigrationState,
} from "../services/knowledge-base/storage-migration-service"
import {
  isManagedKnowledgeBaseProject,
  resolveProjectWorkspacePath as resolveKnowledgeBaseAwareProjectWorkspacePath,
} from "../services/knowledge-base/managed-path"
import { knowledgeBaseSourceManagerWindowService } from "../services/knowledge-base/source-manager-window-service"
import { initDatabase, shutdownDatabase } from "../database"
import { dispatchDatabaseAction } from "../database/dispatcher"
import { getActiveRepositoryConfig } from "../../src/lib/config"
import { sanitizeUrl } from "../../src/lib/url-sanitize"
import { repositoryStore } from "../services/repository-store"
import { repositoryMaintenanceService } from "../services/repository-maintenance-service"
import { repositoryLockManager } from "../services/repository-lock-manager"
import { pendingPushesService } from "../services/pending-pushes-service"
import { RepositorySyncCoordinator } from "../services/repository-sync-coordinator"
import { createTray, destroyTray } from "../services/tray-service"
import { createAgentRuntimeProjectService, AgentRuntimeService, AGENT_RUNTIME_SERVICE_ID } from "../services/agent-runtime"
import {
  AGENT_CONVERSATION_WINDOW_SERVICE_ID,
  createDefaultAgentConversationWindowService,
  type AgentConversationWindowService,
} from "../services/agent-conversation-window-service"
import {
  createProviderProjectService,
  createProviderServiceFromDataRepository,
  PROVIDER_SERVICE_ID,
  type ProviderService,
} from "../services/provider"
import { ProviderReferenceScanner } from "../services/provider/provider-reference-scanner"
import {
  SWARM_TASK_RUNS_NAMESPACE,
  SWARM_TASKS_NAMESPACE,
  SWARM_TASK_WORKER_RUNS_NAMESPACE,
} from "../runtime/data-repo"
import type {
  AgentPersonaRemoteCacheEntryV1,
  ConversationEntryV1,
  DriveSyncBaselineEntryV1,
  DriveSyncBindingEntryV1,
  DriveSyncConflictEntryV1,
  DriveSyncOperationEntryV1,
  DriveSyncStateEntryV1,
  QuickInputItemEntryV1,
  QuickInputSettingsEntryV1,
  SoundNotifierSettingsEntryV3,
  SwarmRunEntryV1,
  SwarmTaskEntryV1,
  SwarmWorkerRunEntryV1,
} from "../runtime/data-repo"
import { BridgeAdapterService } from "../services/bridge-adapter"
import { SideChannelService } from "../services/side-channel"
import { ExecutionIsolationService } from "../services/execution-isolation"
import { AgentRelayService } from "../services/relay"
import { AutomationIngressService } from "../services/automation-ingress"
import { DiagnosticsService } from "../services/diagnostics-service"
import { contentService } from "../services/content-service"
import { contentSubmissionService } from "../services/content-submission-service"
import { prepareContentIconImageBytes } from "../services/content-icon-image-service"
import { readSkillDraftFromDirectory } from "../services/content-skill-source-service"
import { getUsageAnalysisDb } from "../services/usage-analysis"
import { userIdentityService } from "../services/user-identity-service"
import { accountService } from "../services/account-service"
import { SYNAPSE_DESKTOP_DEPLOYMENT_CONFIG } from "../generated/deployment-config.generated"
import { SkillRepositoryUploadService } from "../services/skill-repository-upload-service"
import { createDriveSyncService, type DriveSyncService } from "../services/drive-sync-service"
import {
  AutomationExecutionService,
  AutomationItemRepository,
  AutomationRunRepository,
  AutomationService,
  createBuiltinAutomationTriggerRegistry,
} from "../services/automation"
import { pathExists } from "../services/fs-utils"
import { createBuiltinMainActionRegistry } from "../action-runtime/builtin-actions"
import { configureGitCommandSecurity } from "../services/git-command"
import { setConfigBackupDataRepository } from "../services/config-backup-service"
import { createGitAccessService, type GitAccessService } from "../services/git-client/git-access-service"
import { createGitBranchService, type GitBranchService } from "../services/git-client/git-branch-service"
import { createGitClientCommandRunner, type GitClientCommandRunner } from "../services/git-client/git-command-runner"
import { createGitCloneService, type GitCloneService } from "../services/git-client/git-clone-service"
import { createGitCommitService, type GitCommitService } from "../services/git-client/git-commit-service"
import { createGitEnvironmentService, type GitEnvironmentService } from "../services/git-client/git-environment-service"
import { createGitHistoryService, type GitHistoryService } from "../services/git-client/git-history-service"
import { createGitRepositoryRegistry, type GitRepositoryRegistry } from "../services/git-client/git-repository-registry"
import { createGitStateDiagnosticsReader, createGitStatusService, type GitStatusService } from "../services/git-client/git-status-service"
import { createGitSyncService, type GitSyncService } from "../services/git-client/git-sync-service"
import type { MainActionRegistry } from "../action-runtime/action-registry"
import type { WindowManager } from "../runtime/window"
import { createWindowManager } from "../runtime/window"
import type { EventBus } from "../runtime/event-bus"
import { createEventBus } from "../runtime/event-bus/bus"
import { WindowBroadcaster } from "../runtime/event-bus/broadcaster"
import type { DataRepository } from "../runtime/data-repo"
import { createFileBackedDataRepository } from "../runtime/data-repo"
import type { ActorIdentity, PermissionGuard, AuditSink } from "../runtime/security"
import { DataRepositoryAuditSink, createPermissionGuard, userInitiatedAllowPolicy, systemShellExecPolicy, webhookShellExecPolicy, systemAutomationPolicy, systemMcpAutoRegisterPolicy } from "../runtime/security"
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
import { WorkflowParamPresetService } from "../services/workflow/workflow-param-preset-service"
import { WorkflowPackageService } from "../services/workflow/workflow-package-service"
import { WorkflowEngine } from "../services/workflow/workflow-engine"
import { RunSnapshotService } from "../services/workflow/run-snapshot-service"
import { configuredWorkflowProjectIdsFromConfig, validateWorkflow } from "../services/workflow/workflow-validator"
import { normalizeWorkflowRunParams } from "../services/workflow/workflow-param-normalizer"
import { sanitizeNodeResultsForSnapshot, sanitizeWorkflowRunSnapshot } from "../services/workflow/run-snapshot-sanitize"
import { agentProviderFailureFromResponse } from "../services/workflow/workflow-utils"
import { WorkflowWindowManager } from "../services/workflow/window-manager"
import { sanitizeError } from "../services/error-sanitize"
import type { WorkflowRunResult, WorkflowRunStatus, ValidationError } from "../../src/types/workflow"
import type { SynapseConfig, SynapseProjectConfig, SynapseRepositoryConfig } from "../../src/types/config"
import { SYNAPSE_APP_VERSION } from "../../src/lib/app-version"
import { agentTimeoutMinsToMs, DEFAULT_AGENT_TIMEOUT_MINS } from "../../workflow-nodes/agent-timeout"
import { nodeTypeRegistry } from "../../workflow-nodes/registry"
import "../../workflow-nodes/register.main"

const knowledgeBaseMigrationLogger = createMainLogger("bootstrap.knowledge-base-storage-migration")
const knowledgeBaseMigrationSubscriptions = new WeakMap<KnowledgeBaseStorageMigrationService, () => void>()

type ProcessEnvironmentService = {
  readonly nodeRuntimeBinPath?: string
  readonly nodePath?: string
  readonly shell: ShellEnvironmentSnapshot
  readonly shimError?: string
}

type RunWorkflowHandlerOptions = {
  readonly abortSignal?: AbortSignal
  readonly triggerSource?: "mcp" | "automation"
  readonly automationId?: string
  readonly automationRunId?: string
  readonly actor?: ActorIdentity
}

async function loadWorkflowValidationOptions(workflowService: Pick<WorkflowService, "list">) {
  const [appConfig, workflows] = await Promise.all([
    configStore.load(),
    workflowService.list(),
  ])
  return {
    configuredProjectIds: configuredWorkflowProjectIdsFromConfig(appConfig),
    availableWorkflowIds: workflows.map((workflow) => workflow.id),
  }
}

function buildWorkflowRunAttribution(input: {
  readonly automationId?: string
  readonly automationRunId?: string
}): { readonly automationId?: string; readonly automationRunId?: string } | undefined {
  return input.automationId || input.automationRunId
    ? {
        automationId: input.automationId,
        automationRunId: input.automationRunId,
      }
    : undefined
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

export const coreTerminalDescriptor: ServiceDescriptor<TerminalService> = {
  id: "core.terminal",
  criticality: "degraded",
  create(ctx) {
    return createTerminalService({
      store: createTerminalStore({ baseDir: path.join(app.getPath("userData"), "terminal") }),
      logger: ctx.logger.child("terminal"),
    })
  },
  async start(instance) {
    await instance.start()
  },
  async stop(instance) {
    await instance.stop()
  },
}

export const coreQuickInputDescriptor: ServiceDescriptor<QuickInputService> = {
  id: "core.quick-input",
  criticality: "degraded",
  dependsOn: ["core.data-repository", "core.config"],
  create(ctx) {
    const dataRepository = ctx.registry.get<DataRepository>("core.data-repository")
    return createQuickInputService({
      items: dataRepository.namespace<QuickInputItemEntryV1>(QUICK_INPUT_ITEMS_NAMESPACE),
      settings: dataRepository.namespace<QuickInputSettingsEntryV1>(QUICK_INPUT_SETTINGS_NAMESPACE),
      loadConfig: () => configStore.load(),
      updateConfig: (patch) => configStore.update(patch),
      appVersion: SYNAPSE_APP_VERSION,
      logger: ctx.logger.child("quick-input"),
    })
  },
  async start(instance) {
    await instance.initialize()
  },
}

export const coreAgentPersonasDescriptor: ServiceDescriptor<AgentPersonaService> = {
  id: "core.agent-personas",
  criticality: "degraded",
  dependsOn: ["core.data-repository"],
  create(ctx) {
    const dataRepository = ctx.registry.get<DataRepository>("core.data-repository")
    return createAgentPersonaService({
      remote: new RemoteAgentPersonaClient(accountService),
      cache: new AgentPersonaCache(
        dataRepository.namespace<AgentPersonaRemoteCacheEntryV1>(AGENT_PERSONAS_REMOTE_CACHE_NAMESPACE),
      ),
      account: accountService,
      logger: ctx.logger.child("agent-personas"),
    })
  },
}

export const coreSoundNotifierDescriptor: ServiceDescriptor<SoundNotifierService> = {
  id: "core.sound-notifier",
  criticality: "degraded",
  dependsOn: ["core.data-repository", "core.window-manager"],
  create(ctx) {
    const dataRepository = ctx.registry.get<DataRepository>("core.data-repository")
    const windowManager = ctx.registry.get<WindowManager>("core.window-manager")
    const logger = ctx.logger.child("sound-notifier")
    const service = createSoundNotifierService({
      settings: dataRepository.namespace<SoundNotifierSettingsEntryV3>(SOUND_NOTIFIER_SETTINGS_NAMESPACE),
      logger,
    })

    service.events.on("changed", (payload) => {
      windowManager.broadcast(soundNotifierIpcModule.events.changed.channel, payload)
    })
    service.events.on("playRequested", (payload) => {
      const sent = windowManager.broadcast(soundNotifierIpcModule.events.playRequested.channel, payload)
      if (sent === 0) {
        logger.warn("Sound notifier playback request had no renderer window.", {
          eventType: payload.eventType,
          presetId: payload.presetId,
        })
      }
    })
    return service
  },
}

export const coreSwarmTaskDescriptor: ServiceDescriptor<SwarmTaskService> = {
  id: SWARM_TASK_SERVICE_ID,
  criticality: "degraded",
  dependsOn: ["core.data-repository", "core.event-bus", "core.project-containers"],
  create(ctx) {
    const dataRepository = ctx.registry.get<DataRepository>("core.data-repository")
    return createSwarmTaskService({
      tasks: dataRepository.namespace<SwarmTaskEntryV1>(SWARM_TASKS_NAMESPACE),
      runs: dataRepository.namespace<SwarmRunEntryV1>(SWARM_TASK_RUNS_NAMESPACE),
      workers: dataRepository.namespace<SwarmWorkerRunEntryV1>(SWARM_TASK_WORKER_RUNS_NAMESPACE),
      outputRoot: path.join(app.getPath("userData"), "swarm-runs"),
      eventBus: ctx.registry.get<EventBus>("core.event-bus"),
      agent: createAgentRuntimeSwarmGateway({
        resolveAgent: async (projectId) => {
          const { agent } = await resolveProjectAgent(ctx.registry.get.bind(ctx.registry), projectId)
          return agent
        },
      }),
    })
  },
}

export const coreDriveSyncDescriptor: ServiceDescriptor<DriveSyncService> = {
  id: "core.drive-sync",
  criticality: "degraded",
  dependsOn: ["core.data-repository", "core.permission-guard", "core.audit-sink"],
  create(ctx) {
    const dataRepository = ctx.registry.get<DataRepository>("core.data-repository")
    return createDriveSyncService({
      bindings: dataRepository.namespace<DriveSyncBindingEntryV1>("drive.sync.bindings"),
      baseline: dataRepository.namespace<DriveSyncBaselineEntryV1>("drive.sync.baseline"),
      operations: dataRepository.namespace<DriveSyncOperationEntryV1>("drive.sync.operations"),
      conflicts: dataRepository.namespace<DriveSyncConflictEntryV1>("drive.sync.conflicts"),
      state: dataRepository.namespace<DriveSyncStateEntryV1>("drive.sync.state"),
      accountService,
      permissionGuard: ctx.registry.get<PermissionGuard>("core.permission-guard"),
      auditSink: ctx.registry.get<AuditSink>("core.audit-sink"),
    })
  },
  async start(service) {
    await service.startLocalWatcher()
    service.startRemotePolling()
  },
  async stop(service) {
    await service.stopRemotePolling()
    await service.stopLocalWatcher()
  },
}

export const coreKnowledgeBaseDescriptor: ServiceDescriptor<KnowledgeBaseService> = {
  id: "knowledge-base.service",
  criticality: "degraded",
  create() {
    return new KnowledgeBaseService()
  },
}

export const coreKnowledgeBaseStorageMigrationDescriptor: ServiceDescriptor<KnowledgeBaseStorageMigrationService> = {
  id: "knowledge-base.storage-migration-service",
  criticality: "degraded",
  dependsOn: ["core.event-bus", "core.project-containers"],
  create(ctx) {
    return new KnowledgeBaseStorageMigrationService({
      userDataPath: app.getPath("userData"),
      loadConfig: () => configStore.load(),
      updateConfig: (patch) => configStore.update(patch),
      trashItem: (targetPath) => shell.trashItem(targetPath),
      journalPath: path.join(app.getPath("userData"), "knowledge-base-storage-migration.json"),
      sourceManager: knowledgeBaseSourceManagerWindowService,
      hasActiveKnowledgeBaseSession: async () => hasActiveKnowledgeBaseSession(ctx.registry.get<ProjectContainerRegistry>("core.project-containers")),
      getAvailableBytes: async (targetRoot) => {
        const stats = await statfs(targetRoot)
        return stats.bavail * stats.bsize
      },
    })
  },
  async start(instance, ctx) {
    const eventBus = ctx.registry.get<EventBus>("core.event-bus")
    const unsubscribe = instance.subscribe((state) => {
      eventBus.emit({
        domain: "knowledge-base",
        type: "knowledge-base.storageMigrationChanged",
        payload: storageMigrationEventPayload(state),
        timestamp: new Date().toISOString(),
      }, { backpressure: "coalesce", coalesceWindowMs: 16 })
    })
    knowledgeBaseMigrationSubscriptions.set(instance, unsubscribe)
    await instance.recoverIfNeeded()
  },
  stop(instance) {
    knowledgeBaseMigrationSubscriptions.get(instance)?.()
    knowledgeBaseMigrationSubscriptions.delete(instance)
  },
}

function hasActiveKnowledgeBaseSession(containers: ProjectContainerRegistry): boolean {
  return containers.list().some(({ projectId }) => {
    try {
      const container = containers.peek(projectId)
      return container?.get<AgentRuntimeService>(AGENT_RUNTIME_SERVICE_ID).hasActiveKnowledgeBaseSession() ?? false
    } catch (error) {
      knowledgeBaseMigrationLogger.warn("Failed to inspect project agent runtime during Knowledge Base storage migration check.", {
        projectId,
        error: error instanceof Error ? error.message : String(error),
      })
      return false
    }
  })
}

function storageMigrationEventPayload(state: KnowledgeBaseStorageMigrationState) {
  return {
    active: state.active,
    phase: state.phase,
    cancellable: state.cancellable,
    copiedBytes: state.progress.copiedBytes,
    totalBytes: state.progress.totalBytes,
    message: state.message,
    ...(state.warningCode ? { warningCode: state.warningCode } : {}),
    ...(state.errorMessage ? { errorMessage: state.errorMessage } : {}),
  }
}

export const coreActionRuntimeDescriptor: ServiceDescriptor<MainActionRegistry> = {
  id: "core.action-runtime",
  criticality: "fatal",
  dependsOn: [
    "core.process-environment",
    "core.permission-guard",
    "core.audit-sink",
    "core.event-bus",
    "core.workflow",
    "core.workflow.engine",
    "core.workflow.snapshots",
    "core.workflow.run-aborts",
    "core.workflow.run-statuses",
  ],
  create(ctx) {
    const permissionGuard = ctx.registry.get<PermissionGuard>("core.permission-guard")
    const auditSink = ctx.registry.get<AuditSink>("core.audit-sink")
    configureGitCommandSecurity({
      processRunner: createControlledProcessRunner({ permissionGuard, auditSink }),
      actor: { kind: "system", id: "repository-git" },
    })
    const workflowService = ctx.registry.get<WorkflowService>("core.workflow")
    const workflowEngine = ctx.registry.get<WorkflowEngine>("core.workflow.engine")
    const snapshotService = ctx.registry.get<RunSnapshotService>("core.workflow.snapshots")
    const runAborts = ctx.registry.get<Map<string, AbortController>>("core.workflow.run-aborts")
    const runStatuses = ctx.registry.get<Map<string, WorkflowRunStatus>>("core.workflow.run-statuses")
    const runCompletions = new Map<string, Promise<unknown>>()
    const capabilityLogger = createMainLogger("bootstrap.workflow-action")
    return createBuiltinMainActionRegistry({
      processRunner: createControlledProcessRunner({ permissionGuard, auditSink }),
      workflowRuntime: {
        getWorkflowDefinition: (workflowId) => workflowService.get(workflowId),
        runWorkflowAndWait: createRunWorkflowAndWait({
          workflowService,
          workflowEngine,
          snapshotService,
          eventBus: ctx.registry.get<EventBus>("core.event-bus"),
          runAborts,
        runStatuses,
        runCompletions,
        capabilityLogger,
        loadValidationOptions: () => loadWorkflowValidationOptions(workflowService),
      }),
      },
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
  loadValidationOptions?: () => Promise<import("../services/workflow/workflow-validator").WorkflowValidationOptions>
}) {
  return async (id: string, params: Record<string, unknown>, options?: RunWorkflowHandlerOptions): Promise<{ runId: string } | { errors: ValidationError[] }> => {
    const { workflowService, workflowEngine, snapshotService, eventBus, runAborts, runStatuses, runCompletions, capabilityLogger, isWorkflowDeleted, loadValidationOptions } = deps
    const def = await workflowService.get(id)
    if (!def) return { errors: [{ type: "invalid_config" as const, message: "Workflow not found" }] }
    const validation = validateWorkflow(def, await loadValidationOptions?.())
    if (!validation.valid) return { errors: validation.errors }
    const normalizedParams = await normalizeWorkflowRunParams(def, params)
    if (normalizedParams.errors.length > 0) return { errors: normalizedParams.errors }

    for (const [, status] of runStatuses) {
      if (status.workflowId === id && status.status === "running") {
        return { errors: [{ type: "invalid_config" as const, message: "已有运行中的实例，请先取消或等待完成" }] }
      }
    }

    const effectiveParams = normalizedParams.params
    const runId = randomUUID()
    const ac = new AbortController()
    const source = options?.triggerSource ?? "mcp"
    const abortFromOuter = () => ac.abort()
    if (options?.abortSignal) {
      if (options.abortSignal.aborted) {
        ac.abort()
      } else {
        options.abortSignal.addEventListener("abort", abortFromOuter, { once: true })
      }
    }
    const startedAt = Date.now()
    runAborts.set(runId, ac)
    runStatuses.set(runId, { runId, workflowId: id, status: "running", nodeResults: {}, startedAt, params: effectiveParams, definition: def })
    const appConfig = await configStore.load()
    const defaultProject = def.defaultProjectId
      ? appConfig.repositories.find((r) => r.uuid === def.defaultProjectId)
      : undefined
    const activeRepo = defaultProject ?? appConfig.repositories.find((r) => r.uuid === appConfig.activeRepoUuid) ?? appConfig.repositories[0]
    const projectId = activeRepo?.uuid
    const attribution = buildWorkflowRunAttribution(options ?? {})
    const completion = workflowEngine.run(def, effectiveParams, runId, (event) => {
      const current = runStatuses.get(runId) ?? { runId, workflowId: id, status: "running" as const, nodeResults: {}, startedAt }
      const nextNodeResults = { ...current.nodeResults }
      if (event.type === "node:started") {
        nextNodeResults[event.nodeId] = event.result ?? { ...(nextNodeResults[event.nodeId] ?? { nodeId: event.nodeId, input: { variables: {} } }), status: "running", startedAt: event.startedAt ?? Date.now() }
      } else if (event.type === "node:progress") {
        nextNodeResults[event.nodeId] = { ...(nextNodeResults[event.nodeId] ?? { nodeId: event.nodeId, input: { variables: {} }, status: "running" as const }), progressLabel: event.label }
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
          Promise.resolve(snapshotService.save(sanitizeWorkflowRunSnapshot({ runId, workflowId: id, version: def.version, startedAt, endedAt, status, params: effectiveParams, nodeResults: event.result?.nodeResults ?? nextNodeResults, definition: def, ...(event.type === "workflow:failed" ? { error: event.error } : {}) }))).catch((err) => {
            capabilityLogger.warn("failed to persist workflow run snapshot", { runId, workflowId: id, boundary: "workflow-snapshot", ...capabilityRejectionDiagnostic(err) })
            eventBus.emit({ domain: "workflow", type: "snapshot:failed", payload: { runId, workflowId: id, error: err instanceof Error ? err.message : String(err) }, timestamp: new Date().toISOString() }, { backpressure: "block" })
          })
        }
      }
    }, ac.signal, projectId, source, options?.actor, undefined, attribution).catch((err) => {
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
          Promise.resolve(snapshotService.save(sanitizeWorkflowRunSnapshot({
            runId, workflowId: id, version: def.version,
            startedAt, endedAt, status: "failed",
            params: effectiveParams,
            nodeResults: sanitizedNodeResults,
            definition: def,
            error: "工作流引擎异常",
          }))).catch((err) => {
            capabilityLogger.warn("failed to persist workflow run snapshot", { runId, workflowId: id, boundary: "workflow-snapshot", ...capabilityRejectionDiagnostic(err) })
          })
        }
      }
    }).finally(() => {
      options?.abortSignal?.removeEventListener("abort", abortFromOuter)
      runCompletions.delete(runId)
    })
    runCompletions.set(runId, completion)
    return { runId }
  }
}

export function createRunWorkflowAndWait(deps: {
  workflowService: Pick<WorkflowService, "get">
  workflowEngine: WorkflowEngine
  snapshotService: Pick<RunSnapshotService, "save">
  eventBus: EventBus
  runAborts: Map<string, AbortController>
  runStatuses: Map<string, WorkflowRunStatus>
  runCompletions: Map<string, Promise<unknown>>
  capabilityLogger: ReturnType<typeof createMainLogger>
  isWorkflowDeleted?: (workflowId: string) => boolean
  loadValidationOptions?: () => Promise<import("../services/workflow/workflow-validator").WorkflowValidationOptions>
}) {
  return async (input: {
    readonly workflowId: string
    readonly params: Record<string, unknown>
    readonly abortSignal?: AbortSignal
    readonly triggerSource: "mcp" | "automation"
    readonly automationId?: string
    readonly automationRunId?: string
    readonly actor?: ActorIdentity
  }) => {
    const handler = createRunWorkflowHandler(deps)
    const started = await handler(input.workflowId, input.params, {
      abortSignal: input.abortSignal,
      triggerSource: input.triggerSource,
      automationId: input.automationId,
      automationRunId: input.automationRunId,
      actor: input.actor,
    })
    if ("errors" in started) {
      throw new Error(started.errors[0]?.message ?? "工作流启动失败")
    }

    const completion = deps.runCompletions.get(started.runId)
    const completionResult = completion ? await completion : undefined
    const status = deps.runStatuses.get(started.runId)
    const definition = await deps.workflowService.get(input.workflowId)
    if (!definition) {
      throw new Error("工作流不存在")
    }

    const result = isWorkflowRunResult(completionResult)
      ? completionResult
      : status && status.status !== "running"
        ? {
            status: status.status,
            nodeResults: status.nodeResults,
            durationMs: status.durationMs ?? 0,
            output: resolveWorkflowOutput(status.nodeResults, definition.nodes.find((node) => node.type === "end")?.id),
          }
        : undefined
    if (!result) {
      throw new Error("工作流状态未知")
    }

    return {
      runId: started.runId,
      definition,
      result,
    }
  }
}

function isWorkflowRunResult(value: unknown): value is WorkflowRunResult {
  if (!value || typeof value !== "object") {
    return false
  }
  const status = (value as { status?: unknown }).status
  return status === "completed" || status === "failed" || status === "cancelled"
}

function resolveWorkflowOutput(
  nodeResults: WorkflowRunStatus["nodeResults"],
  endNodeId: string | undefined,
): string | undefined {
  if (!endNodeId) {
    return undefined
  }
  return nodeResults[endNodeId]?.output
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
    "core.automation",
    "core.action-runtime",
    "core.workflow",
    "core.workflow.snapshots",
    "core.workflow.run-aborts",
    "core.workflow.run-statuses",
    "core.workflow.engine",
    "core.permission-guard",
    "core.audit-sink",
    "core.terminal",
    "core.sound-notifier",
    SWARM_TASK_SERVICE_ID,
    PROVIDER_SERVICE_ID,
  ],
  async create(ctx) {
    const eventBus = ctx.registry.get<EventBus>("core.event-bus")
    const automation = ctx.registry.get<AutomationService>("core.automation")
    const actionRuntime = ctx.registry.get<MainActionRegistry>("core.action-runtime")

    const workflowService = ctx.registry.get<WorkflowService>("core.workflow")
    const snapshotService = ctx.registry.get<RunSnapshotService>("core.workflow.snapshots")
    const runAborts = ctx.registry.get<Map<string, AbortController>>("core.workflow.run-aborts")
    const runStatuses = ctx.registry.get<Map<string, WorkflowRunStatus>>("core.workflow.run-statuses")
    const workflowEngine = ctx.registry.get<WorkflowEngine>("core.workflow.engine")
    const providerService = ctx.registry.get<ProviderService>(PROVIDER_SERVICE_ID)
    const permissionGuard = ctx.registry.get<PermissionGuard>("core.permission-guard")
    const auditSink = ctx.registry.get<AuditSink>("core.audit-sink")
    const terminalService = ctx.registry.get<TerminalService>("core.terminal")
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
        loadValidationOptions: () => loadWorkflowValidationOptions(workflowService),
      }),
      cancelRun: (runId: string) => {
        const controller = runAborts.get(runId)
        if (!controller) return false
        controller.abort()
        runAborts.delete(runId)
        return true
      },
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
      loadValidationOptions: () => loadWorkflowValidationOptions(workflowService),
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
      permissionGuard,
      auditSink,
    })
    const repositoryDispatcher = createRepositoryCapabilityDispatcher({
      loadConfig: () => configStore.load(),
      permissionGuard,
      auditSink,
    })
    const skillRepositoryUploadService = new SkillRepositoryUploadService({
      accountService,
      publicAppUrl: SYNAPSE_DESKTOP_DEPLOYMENT_CONFIG.publicAppUrl,
      openExternal: (url) => shell.openExternal(url),
    })
    const skillRepositoryDispatcher = createSkillRepositoryCapabilityDispatcher({
      accountService,
      uploadService: skillRepositoryUploadService,
      publicAppUrl: SYNAPSE_DESKTOP_DEPLOYMENT_CONFIG.publicAppUrl,
      openExternal: (url) => shell.openExternal(url),
      auditSink,
      permissionGuard,
      actor: { kind: "user", id: "synapse-mcp", display: "Synapse MCP" },
    })
    const variableDispatcher = createVariableCapabilityDispatcher({
      loadConfig: () => configStore.load(),
      updateConfig: (patch) => configStore.update(patch),
      eventBus,
      permissionGuard,
      auditSink,
      actor: { kind: "user", id: "synapse-mcp", display: "Synapse MCP" },
    })
    const automationDispatcher = createAutomationCapabilityDispatcher({
      service: automation,
      accountService,
      triggers: createBuiltinAutomationTriggerRegistry(),
      actions: actionRuntime,
      permissionGuard,
      auditSink,
      logger: createMainLogger("capability.automation"),
    })
    const driveDispatcher = createDriveCapabilityDispatcher({
      accountService,
      permissionGuard,
      auditSink,
    })
    const documentTemplateDispatcher = createDocumentTemplateCapabilityDispatcher({
      service: createDocumentTemplateService(),
      permissionGuard,
      auditSink,
    })
    const terminalDispatcher = createTerminalCapabilityDispatcher({
      service: terminalService,
      permissionGuard,
      auditSink,
    })
    const screenshotDispatcher = createScreenshotCapabilityDispatcher({
      service: createScreenshotService(),
      permissionGuard,
      auditSink,
    })
    const soundNotifierDispatcher = createSoundNotifierCapabilityDispatcher({
      service: ctx.registry.get<SoundNotifierService>("core.sound-notifier"),
    })
    const swarmTaskDispatcher = createSwarmTaskCapabilityDispatcher({
      service: ctx.registry.get<SwarmTaskService>(SWARM_TASK_SERVICE_ID),
    })
    const appDispatcher = createAppCapabilityDispatcher({
      documentTemplate: documentTemplateDispatcher,
      screenshot: screenshotDispatcher,
      soundNotifier: soundNotifierDispatcher,
      swarmTask: swarmTaskDispatcher,
    })

    const actionRouter = createSynapseActionRouter({
      appDispatch: (action, params, context) => {
        if (action.startsWith("app.terminal.")) {
          return terminalDispatcher.dispatch(action, params, context)
        }
        return appDispatcher.dispatch(action, params, context)
      },
      automationDispatch: (action, params, context) => automationDispatcher.dispatch(action, params, context),
      contentDispatch: (action, params, context) => contentDispatcher.dispatch(action, params, context),
      driveDispatch: (action, params, context) => driveDispatcher.dispatch(action, params, context),
      modelPriceDispatch: (action, params, context) => modelPriceDispatcher.dispatch(action, params, context),
      repositoryDispatch: (action, params, context) => repositoryDispatcher.dispatch(action, params, context),
      skillRepositoryDispatch: (action, params, context) => skillRepositoryDispatcher.dispatch(action, params, context),
      databaseDispatch: (action, params, context) => dispatchDatabaseAction(
        action,
        params,
        context,
        { permissionGuard, auditSink },
      ),
      variableDispatch: (action, params, context) => variableDispatcher.dispatch(action, params, context),
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

export const coreAgentConversationWindowDescriptor: ServiceDescriptor<AgentConversationWindowService> = {
  id: AGENT_CONVERSATION_WINDOW_SERVICE_ID,
  criticality: "degraded",
  dependsOn: ["core.window-manager"],
  create(ctx) {
    return createDefaultAgentConversationWindowService(
      ctx.registry.get<WindowManager>("core.window-manager"),
    )
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
    const dataRepository = createFileBackedDataRepository({
      rootDir: path.join(app.getPath("userData"), "data-v1"),
      safeStorage,
    })
    setConfigBackupDataRepository(dataRepository)
    return dataRepository
  },
}

export const coreCheatCodeStateDescriptor: ServiceDescriptor<CheatCodeStateService> = {
  id: CHEAT_CODE_STATE_SERVICE_ID,
  criticality: "degraded",
  dependsOn: ["core.data-repository", "core.event-bus"],
  create(ctx) {
    const dataRepository = ctx.registry.get<DataRepository>("core.data-repository")
    return new CheatCodeStateService({
      states: dataRepository.namespace("cheat-code.states"),
      eventBus: ctx.registry.get<EventBus>("core.event-bus"),
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
    "core.workflow",
  ],
  create(ctx) {
    const dataRepository = ctx.registry.get<DataRepository>("core.data-repository")
    return createProviderServiceFromDataRepository({
      dataRepository,
      permissionGuard: ctx.registry.get<PermissionGuard>("core.permission-guard"),
      auditSink: ctx.registry.get<AuditSink>("core.audit-sink"),
      scanReferences: async (providerId) => {
        const workflowService = ctx.registry.get<WorkflowService>("core.workflow")
        const scanner = new ProviderReferenceScanner({
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
    })
  },
}

const MCP_HTTP_PROBE_TIMEOUT_MS = 5_000

async function probeMcpHttp(url: string) {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
      signal: AbortSignal.timeout(MCP_HTTP_PROBE_TIMEOUT_MS),
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
  } catch (error) {
    return { ok: false, method: "ping", error: mcpHttpProbeErrorMessage(error) }
  }
}

function mcpHttpProbeErrorMessage(error: unknown): string {
  if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
    return "MCP 服务响应超时"
  }
  return error instanceof Error ? error.message : String(error)
}

export const corePermissionGuardDescriptor: ServiceDescriptor<PermissionGuard> = {
  id: "core.permission-guard",
  criticality: "fatal",
  create() {
    const guard = createPermissionGuard()
    guard.registerPolicy(userInitiatedAllowPolicy)
    guard.registerPolicy(systemShellExecPolicy)
    guard.registerPolicy(webhookShellExecPolicy)
    guard.registerPolicy(systemAutomationPolicy)
    guard.registerPolicy(systemMcpAutoRegisterPolicy)
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
    workspacePath: resolveKnowledgeBaseAwareProjectWorkspacePath(project, {
      storage: config.global.knowledgeBaseStorage,
    }),
    ...(isManagedKnowledgeBaseProject(project) ? { managedKnowledgeBase: true } : undefined),
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

export const coreAutomationDescriptor: ServiceDescriptor<AutomationService> = {
  id: "core.automation",
  criticality: "degraded",
  dependsOn: [
    "core.data-repository",
    "core.permission-guard",
    "core.audit-sink",
    "core.action-runtime",
    "core.event-bus",
  ],
  create(ctx) {
    const dataRepository = ctx.registry.get<DataRepository>("core.data-repository")
    const permissionGuard = ctx.registry.get<PermissionGuard>("core.permission-guard")
    const auditSink = ctx.registry.get<AuditSink>("core.audit-sink")
    const eventBus = ctx.registry.get<EventBus>("core.event-bus")
    const defaultCwd = app.getPath("userData")
    const triggers = createBuiltinAutomationTriggerRegistry()
    const items = new AutomationItemRepository({
      items: dataRepository.namespace("automation.items"),
      triggers,
    })
    const runs = new AutomationRunRepository({
      runs: dataRepository.namespace("automation.runs"),
    })
    const actions = ctx.registry.get<MainActionRegistry>("core.action-runtime")
    const execution = new AutomationExecutionService({
      items,
      runs,
      actions,
      permissionGuard,
      auditSink,
      defaultCwd,
    })
    return new AutomationService({
      items,
      runs,
      triggers,
      actions,
      execution,
      defaultCwd,
      eventBus,
    })
  },
  start(service) {
    return service.start()
  },
  stop(service) {
    return service.stop()
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
 * core.model-price — registers first-class model price IPC handlers.
 *
 * Status: degraded — price management is non-critical at startup.
 */
export const coreModelPriceDescriptor: ServiceDescriptor<{ initialized: true }> = {
  id: "core.model-price",
  criticality: "degraded",
  dependsOn: [],
  async create() {
    const { registerModelPriceHandlers } = await import("../model-price/ipc-handlers.js")
    registerModelPriceHandlers()
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

export const gitCommandRunnerDescriptor: ServiceDescriptor<GitClientCommandRunner> = {
  id: "git.command-runner",
  criticality: "degraded",
  create(ctx) {
    return createGitClientCommandRunner({
      logger: ctx.logger.child("git.command"),
    })
  },
}

export const gitRepositoryRegistryDescriptor: ServiceDescriptor<GitRepositoryRegistry> = {
  id: "git.repository-registry",
  criticality: "degraded",
  create(ctx) {
    return createGitRepositoryRegistry({
      logger: ctx.logger.child("git.registry"),
      userDataPath: app.getPath("userData"),
      trashItem: (targetPath) => shell.trashItem(targetPath),
    })
  },
}

export const gitAccessServiceDescriptor: ServiceDescriptor<GitAccessService> = {
  id: "git.access-service",
  criticality: "degraded",
  dependsOn: ["git.command-runner", "core.process-environment", "core.permission-guard", "core.audit-sink"],
  create(ctx) {
    return createGitAccessService({
      actor: { kind: "user" },
      auditSink: ctx.registry.get<AuditSink>("core.audit-sink"),
      commandRunner: ctx.registry.get<GitClientCommandRunner>("git.command-runner"),
      effectivePath: ctx.registry.get<ProcessEnvironmentService>("core.process-environment").shell.effectivePath,
      homeDir: os.homedir(),
      logger: ctx.logger.child("git.access"),
      pathExists,
      permissionGuard: ctx.registry.get<PermissionGuard>("core.permission-guard"),
      readFile: (filePath) => readFile(filePath, "utf8"),
      platform: process.platform,
    })
  },
}

export const gitEnvironmentServiceDescriptor: ServiceDescriptor<GitEnvironmentService> = {
  id: "git.environment-service",
  criticality: "degraded",
  dependsOn: ["git.command-runner", "core.process-environment"],
  create(ctx) {
    return createGitEnvironmentService({
      commandRunner: ctx.registry.get<GitClientCommandRunner>("git.command-runner"),
      homeDir: os.homedir(),
      logger: ctx.logger.child("git.environment"),
      pathExists,
      readFile: (filePath) => readFile(filePath, "utf8"),
      platform: process.platform,
      shellEnvironment: ctx.registry.get<ProcessEnvironmentService>("core.process-environment").shell,
    })
  },
}

export const gitCloneServiceDescriptor: ServiceDescriptor<GitCloneService> = {
  id: "git.clone-service",
  criticality: "degraded",
  dependsOn: ["git.command-runner", "git.repository-registry"],
  create(ctx) {
    return createGitCloneService({
      commandRunner: ctx.registry.get<GitClientCommandRunner>("git.command-runner"),
      logger: ctx.logger.child("git.clone"),
      registry: ctx.registry.get<GitRepositoryRegistry>("git.repository-registry"),
      pathExists,
    })
  },
}

export const gitStatusServiceDescriptor: ServiceDescriptor<GitStatusService> = {
  id: "git.status-service",
  criticality: "degraded",
  dependsOn: ["git.command-runner"],
  create(ctx) {
    const commandRunner = ctx.registry.get<GitClientCommandRunner>("git.command-runner")
    return createGitStatusService({
      commandRunner,
      logger: ctx.logger.child("git.status"),
      pathExists,
      readStateDiagnostics: createGitStateDiagnosticsReader(commandRunner, pathExists),
    })
  },
}

export const gitCommitServiceDescriptor: ServiceDescriptor<GitCommitService> = {
  id: "git.commit-service",
  criticality: "degraded",
  dependsOn: ["git.command-runner"],
  create(ctx) {
    return createGitCommitService({
      commandRunner: ctx.registry.get<GitClientCommandRunner>("git.command-runner"),
      logger: ctx.logger.child("git.commit"),
    })
  },
}

export const gitSyncServiceDescriptor: ServiceDescriptor<GitSyncService> = {
  id: "git.sync-service",
  criticality: "degraded",
  dependsOn: ["git.command-runner", "git.status-service"],
  create(ctx) {
    const statusService = ctx.registry.get<GitStatusService>("git.status-service")
    return createGitSyncService({
      commandRunner: ctx.registry.get<GitClientCommandRunner>("git.command-runner"),
      getSnapshot: (repository) => statusService.getSnapshot(repository),
      logger: ctx.logger.child("git.sync"),
    })
  },
}

export const gitBranchServiceDescriptor: ServiceDescriptor<GitBranchService> = {
  id: "git.branch-service",
  criticality: "degraded",
  dependsOn: ["git.command-runner", "git.status-service"],
  create(ctx) {
    const statusService = ctx.registry.get<GitStatusService>("git.status-service")
    return createGitBranchService({
      commandRunner: ctx.registry.get<GitClientCommandRunner>("git.command-runner"),
      getSnapshot: (repository) => statusService.getSnapshot(repository),
      logger: ctx.logger.child("git.branch"),
    })
  },
}

export const gitHistoryServiceDescriptor: ServiceDescriptor<GitHistoryService> = {
  id: "git.history-service",
  criticality: "degraded",
  dependsOn: ["git.command-runner"],
  create(ctx) {
    return createGitHistoryService({
      commandRunner: ctx.registry.get<GitClientCommandRunner>("git.command-runner"),
      logger: ctx.logger.child("git.history"),
    })
  },
}

export const coreWorkflowParamPresetServiceDescriptor: ServiceDescriptor<WorkflowParamPresetService> = {
  id: "core.workflow.param-presets",
  criticality: "degraded",
  dependsOn: ["core.data-repository"],
  create(ctx) {
    return new WorkflowParamPresetService(ctx.registry.get<DataRepository>("core.data-repository"))
  },
}

export const coreWorkflowServiceDescriptor: ServiceDescriptor<WorkflowService> = {
  id: "core.workflow",
  criticality: "degraded",
  dependsOn: ["core.data-repository", "core.workflow.param-presets"],
  create(ctx) {
    const dataRepo = ctx.registry.get<DataRepository>("core.data-repository")
    return new WorkflowService(dataRepo, async () => ({
      configuredProjectIds: configuredWorkflowProjectIdsFromConfig(await configStore.load()),
    }), ctx.registry.get<WorkflowParamPresetService>("core.workflow.param-presets"))
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

function resolveWorkflowProjectWorkspacePath(
  config: Pick<SynapseConfig, "global">,
  repo: SynapseRepositoryConfig | undefined,
  project: SynapseProjectConfig | undefined,
): string | null {
  if (repo) return repo.localPath
  if (!project) return null
  return resolveKnowledgeBaseAwareProjectWorkspacePath(project, {
    storage: config.global.knowledgeBaseStorage,
  })
}

export const coreWorkflowEngineDescriptor: ServiceDescriptor<WorkflowEngine> = {
  id: "core.workflow.engine",
  criticality: "degraded",
  dependsOn: ["core.project-containers", "core.permission-guard", "core.audit-sink", "core.workflow", "core.workflow.snapshots", "knowledge-base.storage-migration-service"],
  create(ctx) {
    const registry = ctx.registry
    const engineLogger = createMainLogger("service.workflow.engine.agent-deps")
    const loadWorkflowProject = async (projectId: string) => {
      const config = await configStore.load()
      const repo = config.repositories.find((r) => r.uuid === projectId)
      const proj = !repo ? config.global.projects.find((p) => p.id === projectId) : undefined
      return { config, repo, proj }
    }
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
        const { config, repo, proj } = await loadWorkflowProject(projectId)
        if (!repo && !proj) {
          throw new Error("Workflow prompt project was not found")
        }
        if (proj) {
          try {
            assertKnowledgeBaseStorageMigrationInactive(<T>(serviceId: string) => registry.get<T>(serviceId), proj)
          } catch (error) {
            if (error instanceof Error && error.message === KNOWLEDGE_BASE_MIGRATION_ACTIVE_ERROR) {
              return { status: "failed", response: "", error: KNOWLEDGE_BASE_MIGRATION_ACTIVE_ERROR, durationMs: 0 }
            }
            throw error
          }
        }
        const effectiveProjectId = repo?.uuid ?? proj?.id ?? projectId
        const workspacePath = resolveWorkflowProjectWorkspacePath(config, repo, proj) ?? os.homedir()
        const containers = registry.get<ProjectContainerRegistry>("core.project-containers")
        const container = await containers.open(effectiveProjectId, {
          name: "",
          workspacePath,
          ...(isManagedKnowledgeBaseProject(proj) ? { managedKnowledgeBase: true } : undefined),
        })
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
        const providerFailure = result.status === "success" && result.summary
          ? agentProviderFailureFromResponse(result.summary)
          : undefined
        return {
          status: result.status === "success" && !providerFailure ? "success" : "failed",
          response: providerFailure ? "" : result.summary ?? "",
          error: providerFailure ?? result.error,
          durationMs: result.durationMs,
          usage: result.usage,
          modelName: result.modelName,
          costUsd: result.costUsd,
          costCny: result.costCny,
          costBreakdownCny: result.costBreakdownCny,
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
    // eslint-disable-next-line prefer-const -- Nested workflow runtime closes over this before assignment.
    let workflowEngine: WorkflowEngine
    const runtimeDeps: import("../../workflow-nodes/types").NodeRuntimeDeps = {
      processRunner: createControlledProcessRunner({ permissionGuard, auditSink }),
      sendHttpRequest: createHttpSendHandler({ permissionGuard, auditSink }),
      permissionGuard,
      auditSink,
      resolveProjectWorkspacePath: async (projectId) => {
        const { config, repo, proj } = await loadWorkflowProject(projectId)
        return resolveWorkflowProjectWorkspacePath(config, repo, proj)
      },
      resolveService: <T>(serviceId: string) => registry.get<T>(serviceId),
      workflowCall: {
        getWorkflowDefinition: (id) => registry.get<WorkflowService>("core.workflow").get(id),
        runWorkflow: async (input) => {
          const snapshots = registry.get<RunSnapshotService>("core.workflow.snapshots")
          const runId = randomUUID()
          const startedAt = Date.now()
          const normalizedParams = await normalizeWorkflowRunParams(input.definition, input.params)
          if (normalizedParams.errors.length > 0) {
            const endedAt = Date.now()
            const error = normalizedParams.errors.map((validationError) => validationError.message).join("；")
            const result = {
              status: "failed" as const,
              nodeResults: {},
              durationMs: endedAt - startedAt,
              error,
            }
            try {
              await snapshots.save(sanitizeWorkflowRunSnapshot({
                runId,
                workflowId: input.definition.id,
                version: input.definition.version,
                startedAt,
                endedAt,
                status: "failed",
                params: input.params,
                nodeResults: {},
                definition: input.definition,
                error,
              }))
            } catch (err) {
              engineLogger.warn("failed to persist nested workflow run snapshot", {
                runId,
                workflowId: input.definition.id,
                boundary: "workflow-call-snapshot",
                ...capabilityRejectionDiagnostic(err),
              })
            }
            return { runId, result }
          }
          let workflowError: string | undefined
          const result = await workflowEngine.run(
            input.definition,
            normalizedParams.params,
            runId,
            (event) => {
              if (event.type === "workflow:failed") {
                workflowError = event.error
              }
            },
            input.abortSignal,
            input.projectId,
            input.triggerSource,
            input.actor,
            input.callStack,
            buildWorkflowRunAttribution(input),
          )
          const endedAt = Date.now()
          const resultError = (result as WorkflowRunResult & { error?: unknown }).error
          const resultWithWorkflowError = result.status === "failed"
            && typeof resultError !== "string"
            && workflowError
            ? { ...result, error: workflowError }
            : result
          const snapshotError = typeof (resultWithWorkflowError as WorkflowRunResult & { error?: unknown }).error === "string"
            ? (resultWithWorkflowError as WorkflowRunResult & { error: string }).error
            : undefined
          try {
            await snapshots.save(sanitizeWorkflowRunSnapshot({
              runId,
              workflowId: input.definition.id,
              version: input.definition.version,
              startedAt,
              endedAt,
              status: resultWithWorkflowError.status,
              params: normalizedParams.params,
              nodeResults: resultWithWorkflowError.nodeResults,
              definition: input.definition,
              ...(snapshotError ? { error: snapshotError } : {}),
            }))
          } catch (err) {
            engineLogger.warn("failed to persist nested workflow run snapshot", {
              runId,
              workflowId: input.definition.id,
              boundary: "workflow-call-snapshot",
              ...capabilityRejectionDiagnostic(err),
            })
          }
          return { runId, result: resultWithWorkflowError }
        },
      },
    }
    workflowEngine = new WorkflowEngine({ sendToAgent }, undefined, runtimeDeps)
    return workflowEngine
  },
}

function createHttpSendHandler(deps: {
  permissionGuard: PermissionGuard
  auditSink: AuditSink
}): typeof sendOutboundHttpRequest {
  return async (request) => {
    const resource = sanitizeUrl(request.url)
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
