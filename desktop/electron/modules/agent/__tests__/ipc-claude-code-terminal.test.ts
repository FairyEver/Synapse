import { beforeEach, describe, expect, it, vi } from "vitest"
import { existsSync } from "node:fs"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

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
// The launcher and its two helpers moved out of the handler when the mobile gateway
// became a second caller; only these import paths changed, never an assertion.
import { removeStaleClaudeCodeLaunchDirectories } from "../claude-code-terminal-launch-dirs"
import { resolveClaudeCodeTerminalPermissionMode } from "../claude-code-terminal"
import { claudeCodeTerminalMethods } from "../ipc-claude-code-terminal"

const method = claudeCodeTerminalMethods.createClaudeCodeTerminal!

function createContext(input: {
  readonly buildEnv: ReturnType<typeof vi.fn>
  readonly createSessionWithEphemeralEnvironment: ReturnType<typeof vi.fn>
  readonly getProvider?: ReturnType<typeof vi.fn>
}): IpcHandlerContext {
  const getProvider = input.getProvider ?? vi.fn().mockResolvedValue({ category: "third_party" })
  const container: ProjectContainer = {
    projectId: "project-1",
    get: <T>(id: string): T => {
      if (id === PROVIDER_SERVICE_ID) return { buildEnv: input.buildEnv, getProvider } as T
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
    let launched: Record<string, unknown> | undefined
    const createSessionWithEphemeralEnvironment = vi.fn(async (input: Record<string, unknown>) => {
      launched = input
      return { id: "session-1" }
    })
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
    expect(launched).toMatchObject({
      title: "Claude Code · Project One",
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
    // The user's own settings outrank the process env, so the provider is pinned as flag settings.
    const args = launched?.args as string[]
    const settingsPath = args[1]!
    expect(args).toEqual([
      "--settings", settingsPath,
      "--model", "sonnet-model",
      "--permission-mode", "default",
    ])
    await expect(readFile(settingsPath, "utf8")).resolves.toBe(JSON.stringify({
      env: {
        ANTHROPIC_BASE_URL: "https://example.test/anthropic",
        ANTHROPIC_AUTH_TOKEN: "token-value",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "sonnet-model",
        ANTHROPIC_MODEL: "sonnet-model",
        DISABLE_AUTOUPDATER: "1",
      },
      model: "sonnet-model",
    }))

    // Ending the session releases the caller-owned settings file.
    ;(launched?.onEnded as () => void)()
    await vi.waitFor(() => expect(existsSync(path.dirname(settingsPath))).toBe(false))
  })

  it("launches with the default permission mode configured for Agent conversations", async () => {
    configStoreMock.load.mockResolvedValue({
      repositories: [{ uuid: "project-1", name: "Project One", localPath: "/repo", contentDirs: {} }],
      global: { projects: [] },
      agent: { defaultPermissionMode: "bypassPermissions" },
    })
    const buildEnv = vi.fn().mockResolvedValue({ ANTHROPIC_AUTH_TOKEN: "token-value" })
    let launched: Record<string, unknown> | undefined
    const createSessionWithEphemeralEnvironment = vi.fn(async (input: Record<string, unknown>) => {
      launched = input
      return { id: "session-permission" }
    })
    const ctx = createContext({ buildEnv, createSessionWithEphemeralEnvironment })

    await method.handler(ctx, { projectId: "project-1", providerId: "vendor", modelTier: "default" })

    expect(launched?.args).toEqual(expect.arrayContaining(["--permission-mode", "bypassPermissions"]))
    ;(launched?.onEnded as () => void)()

    // Configs written before the setting existed still launch with the safe default mode.
    configStoreMock.load.mockResolvedValue({
      repositories: [{ uuid: "project-1", name: "Project One", localPath: "/repo", contentDirs: {} }],
      global: { projects: [] },
      agent: {},
    })

    await method.handler(ctx, { projectId: "project-1", providerId: "vendor", modelTier: "default" })

    expect(launched?.args).toEqual(expect.arrayContaining(["--permission-mode", "default"]))
    ;(launched?.onEnded as () => void)()
  })

  it("falls back to the default permission mode for unknown values", () => {
    expect(resolveClaudeCodeTerminalPermissionMode(undefined)).toBe("default")
    expect(resolveClaudeCodeTerminalPermissionMode("unexpected")).toBe("default")
    expect(resolveClaudeCodeTerminalPermissionMode("acceptEdits")).toBe("acceptEdits")
  })

  it("keeps the provider env out of the response and fails when the runtime is missing", async () => {
    const buildEnv = vi.fn().mockResolvedValue({ ANTHROPIC_AUTH_TOKEN: "token-value" })
    let launched: Record<string, unknown> | undefined
    const createSessionWithEphemeralEnvironment = vi.fn(async (input: Record<string, unknown>) => {
      launched = input
      return { id: "session-2" }
    })
    const ctx = createContext({ buildEnv, createSessionWithEphemeralEnvironment })
    const result = await method.handler(ctx, {
      projectId: "project-1",
      providerId: "vendor",
      modelTier: "default",
    })
    expect(JSON.stringify(result)).not.toContain("token-value")
    // A tier without a resolved model keeps Claude Code's own model choice.
    const args = launched?.args as string[]
    expect(args[0]).toBe("--settings")
    expect(args).not.toContain("--model")
    expect(args).toContain("--permission-mode")
    ;(launched?.onEnded as () => void)()

    runtimeBinaryMock.resolveBundledClaudeExecutable.mockReturnValue(undefined)
    await expect(method.handler(ctx, {
      projectId: "project-1",
      providerId: "vendor",
      modelTier: "default",
    })).rejects.toThrow(runtimeBinaryMock.missingMessage)
    expect(createSessionWithEphemeralEnvironment).toHaveBeenCalledTimes(1)
  })

  it("passes through an explicitly configured context window", async () => {
    const buildEnv = vi.fn().mockResolvedValue({
      ANTHROPIC_BASE_URL: "https://dashscope.aliyuncs.com/apps/anthropic",
      ANTHROPIC_AUTH_TOKEN: "token-value",
      ANTHROPIC_MODEL: "qwen3.8-max",
      CLAUDE_CODE_MAX_CONTEXT_TOKENS: "256000",
    })
    let launched: Record<string, unknown> | undefined
    const createSessionWithEphemeralEnvironment = vi.fn(async (input: Record<string, unknown>) => {
      launched = input
      return { id: "session-explicit-window" }
    })
    const ctx = createContext({ buildEnv, createSessionWithEphemeralEnvironment })

    await method.handler(ctx, { projectId: "project-1", providerId: "bailian", modelTier: "default" })

    expect(launched?.environment).toMatchObject({ CLAUDE_CODE_MAX_CONTEXT_TOKENS: "256000" })
    ;(launched?.onEnded as () => void)()
  })

  it("does not derive a context window from the model name or catalog", async () => {
    const buildEnv = vi.fn().mockResolvedValue({
      ANTHROPIC_BASE_URL: "https://api.deepseek.com/anthropic",
      ANTHROPIC_AUTH_TOKEN: "token-value",
      ANTHROPIC_MODEL: "qwen3.8-max[1M]",
    })
    let launched: Record<string, unknown> | undefined
    const createSessionWithEphemeralEnvironment = vi.fn(async (input: Record<string, unknown>) => {
      launched = input
      return { id: "session-unlisted" }
    })
    const ctx = createContext({ buildEnv, createSessionWithEphemeralEnvironment })

    await method.handler(ctx, { projectId: "project-1", providerId: "vendor", modelTier: "default" })

    expect(launched?.environment).not.toHaveProperty("CLAUDE_CODE_MAX_CONTEXT_TOKENS")
    ;(launched?.onEnded as () => void)()
  })

  it("removes launch directories left behind by a previous process and leaves others alone", async () => {
    const base = await mkdtemp(path.join(os.tmpdir(), "synapse-claude-code-sweep-"))
    try {
      await mkdir(path.join(base, "synapse-claude-code-Ab12Cd"))
      await writeFile(path.join(base, "synapse-claude-code-Ab12Cd", "settings.json"), "{}")
      await mkdir(path.join(base, "synapse-claude-code-paths-0Fk6yY"))
      await writeFile(path.join(base, "settings.json"), "{}")

      await expect(removeStaleClaudeCodeLaunchDirectories(base))
        .resolves.toEqual(["synapse-claude-code-Ab12Cd"])
      expect(existsSync(path.join(base, "synapse-claude-code-Ab12Cd"))).toBe(false)
      expect(existsSync(path.join(base, "synapse-claude-code-paths-0Fk6yY"))).toBe(true)
      expect(existsSync(path.join(base, "settings.json"))).toBe(true)
    } finally {
      await rm(base, { recursive: true, force: true })
    }
  })
})
