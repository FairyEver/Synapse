/**
 * Phase 0.3 — Electron IPC transport adapter and module registration.
 *
 * Wires IpcModule descriptors into ipcMain.handle for production use.
 */

import type { IpcHandlerContext, IpcModule } from "../runtime/ipc/types"
import { IpcRegistryImpl } from "../runtime/ipc/registry"
import { createElectronTransportInstall } from "../runtime/ipc/electron-adapter"
import { shellIpcModule } from "../modules/shell/ipc"
import { identityIpcModule } from "../modules/identity/ipc"
import { userProfileIpcModule } from "../modules/user-profile/ipc"
import { logIpcModule } from "../modules/log/ipc"
import { updateIpcModule } from "../modules/update/ipc"
import { cheatCodeIpcModule } from "../modules/cheat-code/ipc"
import { editorScanIpcModule } from "../modules/editor-scan/ipc"
import { editorCopyIpcModule } from "../modules/editor-copy/ipc"
import { editorInstallStatusIpcModule } from "../modules/editor-install-status/ipc"
import { installStatusIpcModule } from "../modules/install-status/ipc"
import { editorIpcModule } from "../modules/editor/ipc"
import { configIpcModule } from "../modules/config/ipc"
import { repositoryIpcModule } from "../modules/repository/ipc"
import { contentIpcModule } from "../modules/content/ipc"
import { skillRepositoryInstallIpcModule } from "../modules/skill-repository-install/ipc"
import { installersIpcModule } from "../modules/installers/ipc"
import { agentIpcModule } from "../modules/agent/ipc"
import { opsIpcModule } from "../modules/ops/ipc"
import { automationIpcModule } from "../modules/automation/ipc"
import { appsIpcModule } from "../modules/apps/ipc"
import { gitIpcModule } from "../modules/git/ipc"
import { workflowIpcModule } from "../modules/workflow/ipc"
import { knowledgeBaseIpcModule } from "../modules/knowledge-base/ipc"
import { accountIpcModule } from "../modules/account/ipc"
import { driveSyncIpcModule } from "../modules/drive-sync/ipc"
import { liveIpcModule } from "../modules/live/ipc"
import { documentTemplateIpcModule } from "../../app-capabilities/document-template/main/ipc"
import { terminalIpcModule } from "../../app-capabilities/terminal/main/ipc"
import { quickInputIpcModule } from "../../app-capabilities/quick-input/main/ipc"
import { agentPersonasIpcModule } from "../../app-capabilities/agent-personas/main/ipc"
import { soundNotifierIpcModule } from "../../app-capabilities/sound-notifier/main/ipc"
import { swarmTaskIpcModule } from "../../app-capabilities/swarm-task/main/ipc"
import { synapseSkillIpcModule } from "../../app-capabilities/synapse-skill/main/ipc"
import { secretsIpcModule } from "../../app-capabilities/secrets/main/ipc"
import { skillUninstallerIpcModule } from "../../app-capabilities/skill-uninstaller/main/ipc"

/**
 * Creates and configures the IpcRegistry with all migrated modules.
 */
export function createIpcRegistry(ctx: IpcHandlerContext): IpcRegistryImpl {
  const registry = new IpcRegistryImpl({
    install: createElectronTransportInstall({ logger: ctx.logger?.child("ipc") }),
  })

  // Register migrated IpcModules (Phase 0.3)
  registry.register(shellIpcModule, ctx)
  registry.register(identityIpcModule, ctx)
  registry.register(userProfileIpcModule, ctx)
  registry.register(logIpcModule, ctx)
  registry.register(updateIpcModule, ctx)
  registry.register(cheatCodeIpcModule, ctx)
  registry.register(editorScanIpcModule, ctx)
  registry.register(editorCopyIpcModule, ctx)
  registry.register(editorInstallStatusIpcModule, ctx)
  registry.register(installStatusIpcModule, ctx)
  registry.register(editorIpcModule, ctx)
  registry.register(configIpcModule, ctx)
  registry.register(repositoryIpcModule, ctx)
  registry.register(contentIpcModule, ctx)
  registry.register(skillRepositoryInstallIpcModule, ctx)
  registry.register(installersIpcModule, ctx)
  registry.register(agentIpcModule, ctx)
  registry.register(automationIpcModule, ctx)
  registry.register(appsIpcModule, ctx)
  registry.register(gitIpcModule, ctx)
  registry.register(workflowIpcModule, ctx)
  registry.register(knowledgeBaseIpcModule, ctx)
  registry.register(accountIpcModule, ctx)
  registry.register(driveSyncIpcModule, ctx)
  registry.register(liveIpcModule, ctx)
  registry.register(documentTemplateIpcModule, ctx)
  registry.register(terminalIpcModule, ctx)
  registry.register(quickInputIpcModule, ctx)
  registry.register(secretsIpcModule, ctx)
  registry.register(skillUninstallerIpcModule, ctx)
  registry.register(agentPersonasIpcModule, ctx)
  registry.register(soundNotifierIpcModule, ctx)
  registry.register(swarmTaskIpcModule, ctx)
  registry.register(synapseSkillIpcModule, ctx)
  registry.register(opsIpcModule, ctx)

  return registry
}

/**
 * List of all IpcModules for diagnostic purposes.
 */
export const registeredIpcModules: readonly IpcModule[] = [
  shellIpcModule,
  identityIpcModule,
  userProfileIpcModule,
  logIpcModule,
  updateIpcModule,
  cheatCodeIpcModule,
  editorScanIpcModule,
  editorCopyIpcModule,
  editorInstallStatusIpcModule,
  installStatusIpcModule,
  editorIpcModule,
  configIpcModule,
  repositoryIpcModule,
  contentIpcModule,
  skillRepositoryInstallIpcModule,
  installersIpcModule,
  agentIpcModule,
  automationIpcModule,
  appsIpcModule,
  gitIpcModule,
  workflowIpcModule,
  knowledgeBaseIpcModule,
  accountIpcModule,
  driveSyncIpcModule,
  liveIpcModule,
  documentTemplateIpcModule,
  terminalIpcModule,
  quickInputIpcModule,
  secretsIpcModule,
  skillUninstallerIpcModule,
  agentPersonasIpcModule,
  soundNotifierIpcModule,
  swarmTaskIpcModule,
  synapseSkillIpcModule,
  opsIpcModule,
]
