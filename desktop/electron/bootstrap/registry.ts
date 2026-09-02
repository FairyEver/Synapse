/**
 * Phase 0.1 — Build the global ServiceRegistry by registering all bootstrap
 * descriptors in dependency order.
 *
 * Phase 0.6 — now uses the real StructuredLogger from runtime/logging/ via
 * createMainLogger which returns the unified interface.
 */

import {
  type ServiceContext,
  type ServiceRegistry,
  ServiceRegistryImpl,
} from "../runtime/service-registry"
import { createMainLogger } from "../services/log-store"
import type { DataRepository } from "../runtime/data-repo"
import type { EventBus } from "../runtime/event-bus"
import { createMetricsRegistry, createTracer } from "../runtime/observability"
import type { ProcessRuntime } from "../runtime/process"
import type { AuditSink, PermissionGuard } from "../runtime/security"
import {
  coreActionRuntimeDescriptor,
  coreAgentReferenceActionsDescriptor,
  coreAgentConversationWindowDescriptor,
  coreAppIconDescriptor,
  coreAuditSinkDescriptor,
  coreAutomationDescriptor,
  coreAutomationIngressDescriptor,
  coreBridgeAdapterDescriptor,
  coreCheatCodeStateDescriptor,
  coreClientTelemetryDescriptor,
  coreConfigDescriptor,
  coreDataRepositoryDescriptor,
  coreDatabaseDescriptor,
  coreFileOpenerDescriptor,
  coreTextFileWriterDescriptor,
  coreHtmlGenerationDescriptor,
  coreHtmlGenerationFileDescriptor,
  coreTextExtractorDescriptor,
  coreDiagnosticsDescriptor,
  coreDriveSyncDescriptor,
  coreEventBusDescriptor,
  coreExecutionIsolationDescriptor,
  coreLoggingDescriptor,
  coreModelPriceDescriptor,
  coreProcessEnvironmentDescriptor,
  coreScriptRuntimeDescriptor,
  coreNetworkRegistryDescriptor,
  corePermissionGuardDescriptor,
  coreProblemFeedbackDescriptor,
  coreProcessRuntimeDescriptor,
  coreProjectContainerRegistryDescriptor,
  coreAgentPersonasDescriptor,
  coreQuickInputDescriptor,
  coreConnectorsDescriptor,
  coreSecretsDescriptor,
  coreRelayDescriptor,
  coreSideChannelDescriptor,
  coreSoundNotifierDescriptor,
  coreSystemNotifierDescriptor,
  coreSystemNotifierIntegrationDescriptor,
  coreSynapseSkillDescriptor,
  coreTerminalDescriptor,
  coreUsageAnalysisDescriptor,
  coreHttpTestDescriptor,
  coreKnowledgeBaseDescriptor,
  coreKnowledgeBaseStorageMigrationDescriptor,
  coreKnowledgeBaseTransferDescriptor,
  coreJsonRepairDescriptor,
  coreClipboardDescriptor,
  coreUpdateDescriptor,
  coreWindowManagerDescriptor,
  coreWorkflowServiceDescriptor,
  coreWorkflowSnapshotsDescriptor,
  coreWorkflowRunAbortsDescriptor,
  coreWorkflowRunStatusesDescriptor,
  coreWorkflowEngineDescriptor,
  coreWorkflowPackageDescriptor,
  coreWorkflowParamPresetServiceDescriptor,
  coreWorkflowWindowManagerDescriptor,
  gitAccessServiceDescriptor,
  gitBranchServiceDescriptor,
  gitChangeSelectionServiceDescriptor,
  gitCloneServiceDescriptor,
  gitCommandRunnerDescriptor,
  gitCommitServiceDescriptor,
  gitDiscardServiceDescriptor,
  gitEnvironmentServiceDescriptor,
  gitHistoryServiceDescriptor,
  gitOperationCoordinatorDescriptor,
  gitRepositoryRegistryDescriptor,
  gitStatusServiceDescriptor,
  gitSyncServiceDescriptor,
  providerServiceDescriptor,
  createUiTrayDescriptor,
  repoMaintenanceDescriptor,
  repoPendingPushesDescriptor,
  repoSyncCoordinatorDescriptor,
  repoWatchDescriptor,
  type TrayShowOrCreateCallback,
} from "./descriptors"

export interface BuildServiceRegistryOptions {
  readonly trayShowOrCreate: TrayShowOrCreateCallback
}

export function buildServiceRegistry(
  options: BuildServiceRegistryOptions,
): ServiceRegistryImpl {
  const registry = new ServiceRegistryImpl({
    contextProvider: (r) => buildContext(r),
  })

  // Order doesn't matter for register(); topo at startAll resolves it.
  registry.register(coreLoggingDescriptor)
  registry.register(coreProcessEnvironmentDescriptor)
  registry.register(coreScriptRuntimeDescriptor)
  registry.register(coreConfigDescriptor)
  registry.register(coreDataRepositoryDescriptor)
  registry.register(coreClientTelemetryDescriptor)
  registry.register(corePermissionGuardDescriptor)
  registry.register(coreAuditSinkDescriptor)
  registry.register(providerServiceDescriptor)
  registry.register(coreProcessRuntimeDescriptor)
  registry.register(coreNetworkRegistryDescriptor)
  registry.register(coreAppIconDescriptor)
  registry.register(coreWindowManagerDescriptor)
  registry.register(coreAgentConversationWindowDescriptor)
  registry.register(coreEventBusDescriptor)
  registry.register(coreCheatCodeStateDescriptor)
  registry.register(coreProjectContainerRegistryDescriptor)
  registry.register(coreExecutionIsolationDescriptor)
  registry.register(coreSideChannelDescriptor)
  registry.register(coreTerminalDescriptor)
  registry.register(coreSynapseSkillDescriptor)
  registry.register(coreQuickInputDescriptor)
  registry.register(coreConnectorsDescriptor)
  registry.register(coreSecretsDescriptor)
  registry.register(coreAgentPersonasDescriptor)
  registry.register(coreSoundNotifierDescriptor)
  registry.register(coreSystemNotifierDescriptor)
  registry.register(coreProblemFeedbackDescriptor)
  registry.register(coreSystemNotifierIntegrationDescriptor)
  registry.register(coreTextExtractorDescriptor)
  registry.register(coreFileOpenerDescriptor)
  registry.register(coreAgentReferenceActionsDescriptor)
  registry.register(coreTextFileWriterDescriptor)
  registry.register(coreHtmlGenerationDescriptor)
  registry.register(coreHtmlGenerationFileDescriptor)
  registry.register(coreJsonRepairDescriptor)
  registry.register(coreClipboardDescriptor)
  registry.register(coreDriveSyncDescriptor)
  registry.register(coreRelayDescriptor)
  registry.register(coreAutomationIngressDescriptor)
  registry.register(coreActionRuntimeDescriptor)
  registry.register(coreAutomationDescriptor)
  registry.register(coreBridgeAdapterDescriptor)
  registry.register(coreDatabaseDescriptor)
  registry.register(coreUsageAnalysisDescriptor)
  registry.register(coreModelPriceDescriptor)
  registry.register(coreHttpTestDescriptor)
  registry.register(coreKnowledgeBaseDescriptor)
  registry.register(coreKnowledgeBaseStorageMigrationDescriptor)
  registry.register(coreKnowledgeBaseTransferDescriptor)
  registry.register(coreWorkflowParamPresetServiceDescriptor)
  registry.register(coreWorkflowServiceDescriptor)
  registry.register(coreWorkflowPackageDescriptor)
  registry.register(coreWorkflowSnapshotsDescriptor)
  registry.register(coreWorkflowRunAbortsDescriptor)
  registry.register(coreWorkflowRunStatusesDescriptor)
  registry.register(coreWorkflowEngineDescriptor)
  registry.register(coreWorkflowWindowManagerDescriptor)
  registry.register(gitCommandRunnerDescriptor)
  registry.register(gitOperationCoordinatorDescriptor)
  registry.register(gitAccessServiceDescriptor)
  registry.register(gitRepositoryRegistryDescriptor)
  registry.register(gitEnvironmentServiceDescriptor)
  registry.register(gitCloneServiceDescriptor)
  registry.register(gitStatusServiceDescriptor)
  registry.register(gitChangeSelectionServiceDescriptor)
  registry.register(gitCommitServiceDescriptor)
  registry.register(gitDiscardServiceDescriptor)
  registry.register(gitSyncServiceDescriptor)
  registry.register(gitBranchServiceDescriptor)
  registry.register(gitHistoryServiceDescriptor)
  registry.register(coreDiagnosticsDescriptor)
  registry.register(coreUpdateDescriptor)
  registry.register(repoWatchDescriptor)
  registry.register(repoMaintenanceDescriptor)
  registry.register(repoPendingPushesDescriptor)
  registry.register(repoSyncCoordinatorDescriptor)
  registry.register(createUiTrayDescriptor(options.trayShowOrCreate))

  return registry
}

function buildContext(registry: ServiceRegistry): ServiceContext {
  const logger = createMainLogger("registry")
  return {
    logger,
    dataRepo: serviceProxy<DataRepository>(registry, "core.data-repository"),
    eventBus: serviceProxy<EventBus>(registry, "core.event-bus"),
    registry,
    metrics: createMetricsRegistry(),
    tracer: createTracer(),
    permissionGuard: serviceProxy<PermissionGuard>(registry, "core.permission-guard"),
    auditSink: serviceProxy<AuditSink>(registry, "core.audit-sink"),
    processRuntime: serviceProxy<ProcessRuntime>(registry, "core.process-runtime"),
  }
}

function serviceProxy<T extends object>(
  registry: ServiceRegistry,
  serviceId: string,
): T {
  return new Proxy({}, {
    get(_target, prop) {
      let service: Record<PropertyKey, unknown>
      try {
        service = registry.get<T>(serviceId) as Record<PropertyKey, unknown>
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(`Service "${serviceId}" is unavailable while resolving "${String(prop)}": ${message}`)
      }
      const value = service[prop]
      return typeof value === "function" ? value.bind(service) : value
    },
  }) as T
}
