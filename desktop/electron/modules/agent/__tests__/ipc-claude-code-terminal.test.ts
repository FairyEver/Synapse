import { beforeEach, describe, expect, it, vi } from "vitest"

const configStoreMock = vi.hoisted(() => ({ load: vi.fn() }))
const logStoreMock = vi.hoisted(() => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
const runtimeBinaryMock = vi.hoisted(() => ({
  missingMessage: "内置 Claude Code runtime 缺失，请更新或重新安装 Synapse。",
  resolveBundledClaudeExecutable: vi.fn(),
}))

vi.mock("../../../services/config-store", () => ({ configStore: configStoreMock }))
vi.mock("../../../services/log-store", () => ({ createMainLogger: vi.fn(() => logStoreMock.logger) }))
vi.mock("../../../services/agent-runtime/claude-runtime-binary", () => ({
  PACKAGED_CLAUDE_RUNTIME_MISSING_MESSAGE: runtimeBinaryMock.missingMessage,
  resolveBundledClaudeExecutable: runtimeBinaryMock.resolveBundledClaudeExecutable,
}))

import type { IpcHandlerContext } from "../../../runtime/ipc"
import type { ProjectContainer, ProjectContainerRegistry } from "../../../runtime/project-container"
import { AGENT_RUNTIME_SERVICE_ID } from "../../../services/agent-runtime"
import { PROVIDER_SERVICE_ID } from "../../../services/provider"
import { claudeCodeTerminalMethods } from "../ipc-claude-code-terminal"

const method = claudeCodeTerminalMethods.createClaudeCodeTerminal!

function createContext(input: {
  readonly buildEnv: ReturnType<typeof vi.fn>
  readonly createSessionWithEphemeralEnvironment: ReturnType<typeof vi.fn>
}): IpcHandlerContext {
  const container: ProjectContainer = {
    projectId: "project-1",
    get: <T>(id: string): T => {
      if (id === PROVIDER_SERVICE_ID) return { buildEnv: input.buildEnv } as T
      if (id === AGENT_RUNTIME_SERVICE_ID) return {} as T
      throw new Error(`Unknown service: ${id}`)
    },
    inspect: () => [],
    dispose: vi.fn().mockResolvedValue(undefined),
  }
  const projectContainers: Pick<ProjectContainerRegistry, "open"> = {
    open: vi.fn().mockResolvedValue(container),
  }
  return {
    moduleId: "agent",
    resolve: <T>(serviceId: string): T => {
      if (serviceId === "core.project-containers") return projectContainers as T
      if (serviceId === "core.terminal") {
        return { createSessionWithEphemeralEnvironment: input.createSessionWithEphemeralEnvironment } as unknown as T
      }
      throw new Error(`Unknown service: ${serviceId}`)
    },
  }
}

describe("Claude Code terminal IPC", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    configStoreMock.load.mockResolvedValue({
      repositories: [{ uuid: "project-1", name: "Project One", localPath: "/repo", contentDirs: {} }],
      global: { projects: [] },
    })
    runtimeBinaryMock.resolveBundledClaudeExecutable.mockReturnValue("/app/claude")
  })

  it("launches the bundled Claude Code with the selected provider and tier", async () => {
    const buildEnv = vi.fn().mockResolvedValue({
      ANTHROPIC_BASE_URL: "https://example.test/anthropic",
      ANTHROPIC_AUTH_TOKEN: "token-value",
      ANTHROPIC_DEFAULT_SONNET_MODEL: "sonnet-model",
    })
    const createSessionWithEphemeralEnvironment = vi.fn().mockResolvedValue({ id: "session-1" })
    const ctx = createContext({ buildEnv, createSessionWithEphemeralEnvironment })

    await expect(method.handler(ctx, {
      projectId: "project-1",
      providerId: "vendor",
      modelTier: "sonnet",
    })).resolves.toEqual({ sessionId: "session-1" })

    expect(buildEnv).toHaveBeenCalledWith("vendor", {
      actor: { kind: "user", id: "renderer" },
      projectId: "project-1",
    })
    expect(createSessionWithEphemeralEnvironment).toHaveBeenCalledWith({
      title: "Claude Code",
      cwd: "/repo",
      shell: "/app/claude",
      environment: {
        ANTHROPIC_BASE_URL: "https://example.test/anthropic",
        ANTHROPIC_AUTH_TOKEN: "token-value",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "sonnet-model",
        ANTHROPIC_MODEL: "sonnet-model",
        DISABLE_AUTOUPDATER: "1",
      },
    })
  })

  it("keeps the provider env out of the response and fails when the runtime is missing", async () => {
    const buildEnv = vi.fn().mockResolvedValue({ ANTHROPIC_AUTH_TOKEN: "token-value" })
    const createSessionWithEphemeralEnvironment = vi.fn().mockResolvedValue({ id: "session-2" })
    const ctx = createContext({ buildEnv, createSessionWithEphemeralEnvironment })
    const result = await method.handler(ctx, {
      projectId: "project-1",
      providerId: "vendor",
      modelTier: "default",
    })
    expect(JSON.stringify(result)).not.toContain("token-value")

    runtimeBinaryMock.resolveBundledClaudeExecutable.mockReturnValue(undefined)
    await expect(method.handler(ctx, {
      projectId: "project-1",
      providerId: "vendor",
      modelTier: "default",
    })).rejects.toThrow(runtimeBinaryMock.missingMessage)
    expect(createSessionWithEphemeralEnvironment).toHaveBeenCalledTimes(1)
  })
})
