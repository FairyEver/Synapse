/**
 * Phase 0.1 — Bootstrap layer entrypoint.
 *
 * Exposes the helpers that wire existing services into the ServiceRegistry.
 * Each task in Phase 0.1 grows this barrel with new descriptors:
 *  - T1.5 (this commit): coreConfigDescriptor + coreLoggingDescriptor
 *  - T1.6: coreDatabase / coreUpdate / coreAppIcon
 *  - T1.7: repoWatch / repoMaintenance / repoPendingPushes / uiTray
 *  - T1.8: buildServiceRegistry() that registers all of them
 */

export {
  coreActionRuntimeDescriptor,
  coreAppIconDescriptor,
  coreConfigDescriptor,
  coreDatabaseDescriptor,
  coreDriveSyncDescriptor,
  coreLoggingDescriptor,
  coreModelPriceDescriptor,
  coreProcessEnvironmentDescriptor,
  coreHttpTestDescriptor,
  coreQuickInputDescriptor,
  coreUpdateDescriptor,
  coreWorkflowPackageDescriptor,
  createUiTrayDescriptor,
  repoMaintenanceDescriptor,
  repoPendingPushesDescriptor,
  repoSyncCoordinatorDescriptor,
  repoWatchDescriptor,
} from "./descriptors"
export type { TrayShowOrCreateCallback } from "./descriptors"

export { buildServiceRegistry } from "./registry"
export type { BuildServiceRegistryOptions } from "./registry"
export { createAccountExternalUrlOpener } from "./account-external-opener"

export {
  createMainWindow,
  createMainWindowState,
  showOrCreateMainWindow,
} from "./main-window"
export type { MainWindowDeps, MainWindowState } from "./main-window"

export { clearStaleSingletonLock } from "./singleton-lock"

export { attachBeforeQuitHandler } from "./before-quit"
export type { BeforeQuitDeps } from "./before-quit"

export { createIpcRegistry, registeredIpcModules } from "./ipc-registry"

export {
  attachActivateHandler,
  attachOpenUrlHandler,
  configureWindowsAppIdentity,
  attachProcessLevelLogging,
  attachSecondInstanceFocus,
  attachSecondInstanceProtocolHandler,
  registerAuthProtocol,
} from "./app-events"

export {
  createProtocolUrlRouter,
  isSynapseProtocolUrl,
  shouldFocusMainForSecondInstance,
} from "./protocol-router"

export { registerCoreExtensions, EXTENSION_POINT_IDS } from "./extensions"
export type {
  BootstrapContentType,
  BootstrapEditorAdapter,
  BootstrapEditorScanProvider,
} from "./extensions"

export { initializeReadyApp } from "./app-ready"
