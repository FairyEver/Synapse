/**
 * Phase 0.3 — Electron IPC transport adapter and module registration.
 *
 * Wires IpcModule descriptors into ipcMain.handle for production use.
 */

import type { IpcHandlerContext, IpcModule } from "../runtime/ipc/types"
import { IpcRegistryImpl } from "../runtime/ipc/registry"
import { createElectronTransportInstall } from "../runtime/ipc/electron-adapter"
import { shellIpcModule } from "../modules/shell/ipc"
import { cliIpcModule } from "../modules/cli/ipc"
import { identityIpcModule } from "../modules/identity/ipc"
import { userProfileIpcModule } from "../modules/user-profile/ipc"
import { logIpcModule } from "../modules/log/ipc"
import { updateIpcModule } from "../modules/update/ipc"
import { editorScanIpcModule } from "../modules/editor-scan/ipc"
import { editorIpcModule } from "../modules/editor/ipc"
import { configIpcModule } from "../modules/config/ipc"
import { repositoryIpcModule } from "../modules/repository/ipc"
import { contentIpcModule } from "../modules/content/ipc"
import { connectorsIpcModule } from "../modules/connectors/ipc"
import { agentSessionsIpcModule } from "../modules/agent-sessions/ipc"

/**
 * Creates and configures the IpcRegistry with all migrated modules.
 */
export function createIpcRegistry(ctx: IpcHandlerContext): IpcRegistryImpl {
  const registry = new IpcRegistryImpl({
    install: createElectronTransportInstall(),
  })

  // Register migrated IpcModules (Phase 0.3)
  registry.register(shellIpcModule, ctx)
  registry.register(cliIpcModule, ctx)
  registry.register(identityIpcModule, ctx)
  registry.register(userProfileIpcModule, ctx)
  registry.register(logIpcModule, ctx)
  registry.register(updateIpcModule, ctx)
  registry.register(editorScanIpcModule, ctx)
  registry.register(editorIpcModule, ctx)
  registry.register(configIpcModule, ctx)
  registry.register(repositoryIpcModule, ctx)
  registry.register(contentIpcModule, ctx)
  registry.register(connectorsIpcModule, ctx)
  registry.register(agentSessionsIpcModule, ctx)

  return registry
}

/**
 * List of all IpcModules for diagnostic purposes.
 */
export const registeredIpcModules: readonly IpcModule[] = [
  shellIpcModule,
  cliIpcModule,
  identityIpcModule,
  userProfileIpcModule,
  logIpcModule,
  updateIpcModule,
  editorScanIpcModule,
  editorIpcModule,
  configIpcModule,
  repositoryIpcModule,
  contentIpcModule,
  connectorsIpcModule,
  agentSessionsIpcModule,
]
