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
import {
  coreAppIconDescriptor,
  coreConfigDescriptor,
  coreDataStoreDescriptor,
  coreEventBusDescriptor,
  coreLoggingDescriptor,
  coreUpdateDescriptor,
  coreWindowManagerDescriptor,
  agentSessionsDescriptor,
  automationCronDescriptor,
  automationRuntimeDescriptor,
  connectorsQrOnboardingDescriptor,
  connectorsRegistryDescriptor,
  connectorsSecretStoreDescriptor,
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
  registry.register(coreAppIconDescriptor)
  registry.register(coreWindowManagerDescriptor)
  registry.register(coreEventBusDescriptor)
  registry.register(coreDataStoreDescriptor)
  registry.register(coreUpdateDescriptor)
  registry.register(agentSessionsDescriptor)
  registry.register(automationCronDescriptor)
  registry.register(automationRuntimeDescriptor)
  registry.register(connectorsRegistryDescriptor)
  registry.register(connectorsSecretStoreDescriptor)
  registry.register(connectorsQrOnboardingDescriptor)
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
    dataRepo: { __placeholder: undefined },
    eventBus: { __placeholder: undefined },
    registry,
    metrics: { __placeholder: undefined },
    tracer: { __placeholder: undefined },
    permissionGuard: { __placeholder: undefined },
    processRuntime: { __placeholder: undefined },
  }
}
