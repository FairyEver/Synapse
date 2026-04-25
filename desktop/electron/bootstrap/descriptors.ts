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

import type { ServiceDescriptor } from "../runtime/service-registry"
import { configStore } from "../services/config-store"
import { logStore } from "../services/log-store"
import { initializeAppIcon } from "../services/app-icon-service"
import { updateService } from "../services/update-service"
import { initDataStore, shutdownDataStore } from "../data-store"

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
 * core.config — wraps the existing `configStore` singleton and pre-loads the
 * config file during start. Mirrors today's `main.ts:190 await configStore.load()`.
 *
 * Status: fatal — SPEC §4 mapping table.
 */
export const coreConfigDescriptor: ServiceDescriptor<typeof configStore> = {
  id: "core.config",
  criticality: "fatal",
  async create() {
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
  dependsOn: ["core.config"],
  async create() {
    await initDataStore()
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
  dependsOn: ["core.config"],
  create() {
    updateService.initialize()
    updateService.startAutoCheck()
    return updateService
  },
}
