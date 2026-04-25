/**
 * Phase 0.1 — Bootstrap layer entrypoint.
 *
 * Exposes the helpers that wire existing services into the ServiceRegistry.
 * Each task in Phase 0.1 grows this barrel with new descriptors:
 *  - T1.5 (this commit): coreConfigDescriptor + coreLoggingDescriptor
 *  - T1.6: coreDataStore / coreUpdate / coreAppIcon
 *  - T1.7: repoWatch / repoMaintenance / repoPendingPushes / uiTray
 *  - T1.8: buildServiceRegistry() that registers all of them
 */

export {
  coreAppIconDescriptor,
  coreConfigDescriptor,
  coreDataStoreDescriptor,
  coreLoggingDescriptor,
  coreUpdateDescriptor,
  createUiTrayDescriptor,
  repoMaintenanceDescriptor,
  repoPendingPushesDescriptor,
  repoWatchDescriptor,
} from "./descriptors"
export type { TrayShowOrCreateCallback } from "./descriptors"
