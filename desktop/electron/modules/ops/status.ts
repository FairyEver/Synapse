import { app } from "electron"

import type { SynapseOpsDiagnostics } from "../../../src/types/bridge"
import type { ProjectContainerRegistry } from "../../runtime/project-container"
import {
  AgentRuntimeService,
  AGENT_RUNTIME_SERVICE_ID,
} from "../../services/agent-runtime"
import type { AutomationIngressService } from "../../services/automation-ingress"
import { configStore } from "../../services/config-store"
import type { FeishuConnectorService } from "../../services/connectors"
import { logStore } from "../../services/log-store"
import type { AgentRelayService } from "../../services/relay"
import type { SideChannelService } from "../../services/side-channel"
import { createWindowsCompatibilitySnapshot } from "../../services/windows-compatibility"

type ServiceResolver = <T>(serviceId: string) => T

async function collectOpsStatus(
  resolve: ServiceResolver,
  request?: { projectId?: string },
): Promise<SynapseOpsDiagnostics> {
  const projectId = request?.projectId ?? await firstProjectId()
  return {
    appVersion: app.getVersion(),
    singleInstanceLocked: app.hasSingleInstanceLock(),
    logPath: logStore.getLogDirectory(),
    windowsCompatibility: createOpsWindowsCompatibility(),
    sideChannel: optional<SideChannelService>(resolve, "core.side-channel")?.getStatus(),
    webhook: await optional<AutomationIngressService>(resolve, "core.automation-ingress")?.getStatus(),
    relay: await relayStatus(optional<AgentRelayService>(resolve, "core.relay")),
    agent: projectId ? await agentStatus(resolve, projectId) : undefined,
    feishu: projectId ? await feishuStatus(resolve, projectId) : undefined,
  }
}

function createOpsWindowsCompatibility(): SynapseOpsDiagnostics["windowsCompatibility"] {
  const snapshot = createWindowsCompatibilitySnapshot({
    paths: {
      appPath: app.getAppPath(),
      cwd: process.cwd(),
      userDataPath: app.getPath("userData"),
      tempPath: app.getPath("temp"),
      downloadsPath: app.getPath("downloads"),
      logPath: logStore.getLogDirectory(),
    },
  })

  return {
    platform: snapshot.platform,
    arch: snapshot.arch,
    release: snapshot.release,
    runningOnWindows: snapshot.runningOnWindows,
    env: {
      pathKey: snapshot.env.pathKey,
      hasPath: snapshot.env.hasPath,
      pathEntryCount: snapshot.env.pathEntryCount,
      hasPathext: snapshot.env.hasPathext,
      hasComSpec: snapshot.env.hasComSpec,
      hasSystemRoot: snapshot.env.hasSystemRoot,
      hasWindir: snapshot.env.hasWindir,
      hasUserProfile: snapshot.env.hasUserProfile,
      hasAppData: snapshot.env.hasAppData,
      hasLocalAppData: snapshot.env.hasLocalAppData,
      missingRequiredKeys: snapshot.env.missingRequiredKeys,
    },
    paths: {
      appPath: snapshot.paths.appPath,
      userDataPath: snapshot.paths.userDataPath,
      tempPath: snapshot.paths.tempPath,
      downloadsPath: snapshot.paths.downloadsPath,
      logPath: snapshot.paths.logPath,
      userDataInsideAppPath: snapshot.paths.userDataInsideAppPath,
      logInsideAppPath: snapshot.paths.logInsideAppPath,
      userDataHasSpace: snapshot.paths.userDataHasSpace,
      userDataHasNonAscii: snapshot.paths.userDataHasNonAscii,
      logPathHasSpace: snapshot.paths.logPathHasSpace,
      logPathHasNonAscii: snapshot.paths.logPathHasNonAscii,
    },
  }
}

async function firstProjectId(): Promise<string | undefined> {
  const config = await configStore.load()
  return config.global.projects[0]?.id
}

async function agentStatus(
  resolve: ServiceResolver,
  projectId: string,
) {
  const containers = resolve<ProjectContainerRegistry>("core.project-containers")
  const config = await configStore.load()
  const project = config.global.projects.find((item) => item.id === projectId)
  if (!project) return undefined
  const container = await containers.open(project.id, {
    name: project.name,
    workspacePath: project.path,
  })
  return container.get<AgentRuntimeService>(AGENT_RUNTIME_SERVICE_ID).getStatus()
}

async function feishuStatus(
  resolve: ServiceResolver,
  projectId: string,
) {
  const service = optional<FeishuConnectorService>(resolve, "core.feishu-connector")
  if (!service) return undefined
  const status = await service.getStatus(projectId)
  return {
    projectId: status.projectId,
    configured: status.configured,
    running: status.running,
  }
}

async function relayStatus(service: AgentRelayService | undefined) {
  if (!service) return undefined
  const bindings = await service.listBindings()
  const runs = await service.listRuns()
  return {
    bindingCount: bindings.length,
    recentRunCount: runs.length,
  }
}

function optional<T>(
  resolve: ServiceResolver,
  serviceId: string,
): T | undefined {
  try {
    return resolve<T>(serviceId)
  } catch {
    return undefined
  }
}

export { collectOpsStatus }
export type { ServiceResolver }
