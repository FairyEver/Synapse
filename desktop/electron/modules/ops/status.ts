import { app } from "electron"

import type { SynapseOpsDiagnostics } from "../../../src/types/bridge"
import type { ProjectContainerRegistry } from "../../runtime/project-container"
import {
  AgentRuntimeService,
  AGENT_RUNTIME_SERVICE_ID,
} from "../../services/agent-runtime"
import type { AutomationIngressService } from "../../services/automation-ingress"
import { configStore } from "../../services/config-store"
import { createMainLogger, logStore } from "../../services/log-store"
import type { AgentRelayService } from "../../services/relay"
import type { SideChannelService } from "../../services/side-channel"
import { createWindowsCompatibilitySnapshot } from "../../services/windows-compatibility"

type ServiceResolver = <T>(serviceId: string) => T

const logger = createMainLogger("ops.status")

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
    agent: projectId ? await safeAgentStatus(resolve, projectId) : undefined,
  }
}

async function safeAgentStatus(
  resolve: ServiceResolver,
  projectId: string,
) {
  try {
    return await agentStatus(resolve, projectId)
  } catch (error) {
    logger.warn("Ops Agent status collection failed.", {
      boundary: "agent-runtime.status",
      projectId,
      ...errorDiagnostic(error),
    })
    return undefined
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

async function relayStatus(service: AgentRelayService | undefined) {
  if (!service) return undefined
  const [bindingCount, recentRunCount] = await Promise.all([
    service.countBindings(),
    service.countRuns(),
  ])
  return {
    bindingCount,
    recentRunCount,
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

function errorDiagnostic(error: unknown): {
  readonly errorName: string
  readonly errorLength: number
  readonly errorCode?: string
} {
  const message = error instanceof Error ? error.message : String(error)
  const code = typeof error === "object" && error !== null && "code" in error
    ? (error as { readonly code?: unknown }).code
    : undefined
  return {
    errorName: error instanceof Error ? error.name : typeof error,
    errorLength: message.length,
    ...(typeof code === "string" || typeof code === "number" ? { errorCode: String(code) } : {}),
  }
}

export { collectOpsStatus }
export type { ServiceResolver }
