/**
 * Phase 0.1 — Build the global ServiceRegistry by registering all bootstrap
 * descriptors in dependency order.
 *
 * Phase 0.6 will replace the temporary console-backed logger context with the
 * real StructuredLogger from `runtime/logging/`. For now we adapt the existing
 * `createMainLogger` to satisfy the placeholder StructuredLogger contract.
 */

import {
  type ServiceContext,
  type ServiceRegistry,
  type StructuredLogger,
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
  registry.register(repoWatchDescriptor)
  registry.register(repoMaintenanceDescriptor)
  registry.register(repoPendingPushesDescriptor)
  registry.register(createUiTrayDescriptor(options.trayShowOrCreate))

  return registry
}

function buildContext(registry: ServiceRegistry): ServiceContext {
  const baseLogger = createMainLogger("registry")
  return {
    logger: adaptMainLogger(baseLogger, "registry"),
    dataRepo: { __placeholder: undefined },
    eventBus: { __placeholder: undefined },
    registry,
    metrics: { __placeholder: undefined },
    tracer: { __placeholder: undefined },
    permissionGuard: { __placeholder: undefined },
    processRuntime: { __placeholder: undefined },
  }
}

/**
 * Adapt `createMainLogger` (which exposes debug/info/warn/error) to the
 * StructuredLogger placeholder shape. Phase 0.6 swaps this for the real one.
 */
type MainLogger = ReturnType<typeof createMainLogger>
type MainLoggerLevel = "debug" | "info" | "warn" | "error"

function adaptMainLogger(base: MainLogger, category: string): StructuredLogger {
  const wrap = (level: MainLoggerLevel) => (message: string, meta?: Record<string, unknown>) => {
    const fn = base[level] as (msg: string, details?: unknown) => void
    if (typeof fn === "function") {
      fn.call(base, message, meta)
    }
  }
  const logger: StructuredLogger = {
    // Existing logger has no `trace`; route through debug.
    trace: wrap("debug"),
    debug: wrap("debug"),
    info: wrap("info"),
    warn: wrap("warn"),
    error: wrap("error"),
    // Existing logger has no `fatal`; route through error.
    fatal: wrap("error"),
    child: (prefix) =>
      adaptMainLogger(
        createMainLogger(`${category}.${prefix}`),
        `${category}.${prefix}`,
      ),
  }
  return logger
}
