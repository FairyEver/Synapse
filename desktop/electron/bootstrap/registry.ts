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
  coreAppIconDescriptor,
  coreAuditSinkDescriptor,
  coreAutomationIngressDescriptor,
  coreBridgeAdapterDescriptor,
  coreConfigDescriptor,
  coreDataRepositoryDescriptor,
  coreDataStoreDescriptor,
  coreDiagnosticsDescriptor,
  coreEventBusDescriptor,
  coreExecutionIsolationDescriptor,
  coreFeishuConnectorDescriptor,
  coreHeartbeatDescriptor,
  coreLoggingDescriptor,
  coreNetworkRegistryDescriptor,
  corePermissionGuardDescriptor,
  coreProcessRuntimeDescriptor,
  coreProjectContainerRegistryDescriptor,
  coreRelayDescriptor,
  coreSchedulerDescriptor,
  coreSideChannelDescriptor,
  coreTaskSchedulerDescriptor,
  coreUpdateDescriptor,
  coreWindowManagerDescriptor,
  createUiTrayDescriptor,
  repoMaintenanceDescriptor,
  repoPendingPushesDescriptor,
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
  registry.register(coreConfigDescriptor)
  registry.register(coreDataRepositoryDescriptor)
  registry.register(corePermissionGuardDescriptor)
  registry.register(coreAuditSinkDescriptor)
  registry.register(coreProcessRuntimeDescriptor)
  registry.register(coreNetworkRegistryDescriptor)
  registry.register(coreAppIconDescriptor)
  registry.register(coreWindowManagerDescriptor)
  registry.register(coreEventBusDescriptor)
  registry.register(coreProjectContainerRegistryDescriptor)
  registry.register(coreExecutionIsolationDescriptor)
  registry.register(coreSideChannelDescriptor)
  registry.register(coreFeishuConnectorDescriptor)
  registry.register(coreRelayDescriptor)
  registry.register(coreAutomationIngressDescriptor)
  registry.register(coreTaskSchedulerDescriptor)
  registry.register(coreSchedulerDescriptor)
  registry.register(coreHeartbeatDescriptor)
  registry.register(coreBridgeAdapterDescriptor)
  registry.register(coreDataStoreDescriptor)
  registry.register(coreDiagnosticsDescriptor)
  registry.register(coreUpdateDescriptor)
  registry.register(repoWatchDescriptor)
  registry.register(repoMaintenanceDescriptor)
  registry.register(repoPendingPushesDescriptor)
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
      const service = registry.get<T>(serviceId) as Record<PropertyKey, unknown>
      const value = service[prop]
      return typeof value === "function" ? value.bind(service) : value
    },
  }) as T
}
