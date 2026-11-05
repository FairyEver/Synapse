import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"

const configStoreMock = vi.hoisted(() => ({ load: vi.fn() }))
const runtimeBinaryMock = vi.hoisted(() => ({
  missingMessage: "内置 Claude Code runtime 缺失，请更新或重新安装 Synapse。",
  resolveBundledClaudeExecutable: vi.fn(),
}))
const ipcSharedMock = vi.hoisted(() => ({ resolveProjectAgent: vi.fn() }))

vi.mock("../../../services/config-store", () => ({ configStore: configStoreMock }))
vi.mock("../../../services/log-store", () => ({
  createMainLogger: vi.fn(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })),
}))
vi.mock("../../../services/agent-runtime/claude-runtime-binary", () => ({
  PACKAGED_CLAUDE_RUNTIME_MISSING_MESSAGE: runtimeBinaryMock.missingMessage,
  resolveBundledClaudeExecutable: runtimeBinaryMock.resolveBundledClaudeExecutable,
}))
vi.mock("../ipc-shared", () => ({ resolveProjectAgent: ipcSharedMock.resolveProjectAgent }))

import { createClaudeCodeTerminalSession } from "../claude-code-terminal"
import { createTerminalService, type PtyLike } from "../../../../app-capabilities/terminal/main/service"
import { terminalStoreStateSchema } from "../../../../app-capabilities/terminal/main/store"

// Each launcher process performs its own stale sweep: isolate it from other tests and live sessions.
const launchTestDirectory = mkdtempSync(path.join(os.tmpdir(), "synapse-cli-launch-test-"))
let restoreTmpdir: () => void
beforeAll(() => {
  const tmpdir = vi.spyOn(os, "tmpdir").mockReturnValue(launchTestDirectory)
  restoreTmpdir = () => tmpdir.mockRestore()
})
afterAll(() => { restoreTmpdir(); rmSync(launchTestDirectory, { recursive: true, force: true }) })

/** A Provider as `pickInitialProviderModelSelection` reads it: a tier is usable when it names a model. */
type ProviderFixture = {
  readonly id: string
  readonly name: string
  readonly active?: boolean
  readonly archived?: boolean
  readonly model?: string
  readonly haikuModel?: string
  readonly sonnetModel?: string
  readonly opusModel?: string
}

/*
 * A Provider's tier names are markers, not the launched model: the launcher resolves
 * the tier against the Provider's *env*, and it is that env value which becomes
 * `--model`. So a fixture naming a tier is saying "this tier is selectable", and the
 * value that shows up in the arguments names the tier that was selected.
 */
const configured: ProviderFixture = {
  id: "preferred",
  name: "Anthropic 官方",
  model: "tier-default",
  opusModel: "tier-opus",
  sonnetModel: "tier-sonnet",
  haikuModel: "tier-haiku",
}
const activated: ProviderFixture = {
  id: "active",
  name: "百炼",
  active: true,
  model: "tier-default",
  sonnetModel: "tier-sonnet",
}
/** Names only its cheapest tier, so the tier taken from it is unambiguous. */
const spare: ProviderFixture = { id: "spare", name: "备用", haikuModel: "tier-haiku" }
/** Names nothing, which is what a Provider with no model configured looks like. */
const unusable: ProviderFixture = { id: "empty", name: "空" }

/** A Provider env naming every tier, one per `resolveTierModelFromEnv` case. */
const providerEnv = {
  ANTHROPIC_AUTH_TOKEN: "token-value",
  ANTHROPIC_MODEL: "env-default",
  ANTHROPIC_DEFAULT_OPUS_MODEL: "env-opus",
  ANTHROPIC_DEFAULT_SONNET_MODEL: "env-sonnet",
  ANTHROPIC_DEFAULT_HAIKU_MODEL: "env-haiku",
}

function harness(input: {
  readonly providers?: readonly ProviderFixture[]
  readonly defaultProviderModel?: { providerId: string; modelTier: string } | null
  readonly buildEnv?: ReturnType<typeof vi.fn>
  readonly createSession?: ReturnType<typeof vi.fn>
  /** Omitted means "no notification service registered", which is its own case. */
  readonly notificationService?: unknown
  readonly projectPath?: string
} = {}) {
  const buildEnv = input.buildEnv ?? vi.fn().mockResolvedValue(providerEnv)
  const listAllProviders = vi.fn().mockResolvedValue(input.providers ?? [])
  const createSession = input.createSession ?? vi.fn().mockResolvedValue({ id: "session-1", status: "running" })
  ipcSharedMock.resolveProjectAgent.mockResolvedValue({
    providerService: { buildEnv, listAllProviders },
    project: { uuid: "project-1", name: "Synapse", localPath: input.projectPath ?? "/repo" },
  })
  configStoreMock.load.mockResolvedValue({
    global: { projects: [] },
    agent: input.defaultProviderModel === undefined
      ? {}
      : { defaultProviderModel: input.defaultProviderModel },
  })
  const resolve = <T,>(serviceId: string): T => {
    if (serviceId === "core.process-environment") return { nodePath: process.execPath } as T
    if (serviceId === "core.terminal") {
      return { createSessionWithEphemeralEnvironment: createSession } as unknown as T
    }
    // 常量来自通知服务；这里写成字面量是为了顺带钉住 launcher 解析的就是这个 id。
    if (serviceId === "core.terminal-agent-notifications" && input.notificationService) {
      return input.notificationService as unknown as T
    }
    throw new Error(`Unknown service: ${serviceId}`)
  }
  return { buildEnv, listAllProviders, createSession, resolve }
}

/** The model the launcher pinned, or undefined when it left the choice to Claude Code. */
function launchedModel(createSession: ReturnType<typeof vi.fn>): string | undefined {
  const args = (createSession.mock.calls[0]![0] as { readonly args: readonly string[] }).args
  const at = args.indexOf("--model")
  return at === -1 ? undefined : args[at + 1]
}

/** Launch directories the service owns; anything matching this in tmp is a leaked credential file. */
function launchDirectories(): readonly string[] {
  return readdirSync(os.tmpdir()).filter((name) => name.startsWith("synapse-claude-code-"))
}

describe("Claude Code terminal launch", () => {
  it("submits through the real terminal environment validator without persisting internal receipt values", async () => {
    const prompt = "Review through the real TerminalService"
    let state = terminalStoreStateSchema.parse({ groups: [], sessions: [], output: [] })
    const pty: PtyLike = {
      onData: () => ({ dispose() {} }), onExit: () => ({ dispose() {} }),
      write() {}, resize() {}, kill() {},
    }
    const spawnPty = vi.fn((options) => {
      const settingsPath = options.shellArgs[options.shellArgs.indexOf("--settings") + 1]
      const hook = spawnSync(process.execPath, [path.join(path.dirname(settingsPath), "prompt-submitted.cjs")], {
        env: options.env, input: JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt }), timeout: 5000,
      })
      if (hook.error || hook.status !== 0) throw hook.error ?? new Error("Hook failed")
      return pty
    })
    const terminal = createTerminalService({
      store: { loadState: async () => state, saveState: async next => { state = terminalStoreStateSchema.parse(next) } },
      spawnPty, resolveDefaultShell: () => process.execPath, resolveDefaultCwd: () => process.cwd(),
    })
    await terminal.start()
    const h = harness({ providers: [configured], projectPath: process.cwd() })
    runtimeBinaryMock.resolveBundledClaudeExecutable.mockReturnValue(process.execPath)
    const resolve = <T,>(id: string): T => id === "core.terminal" ? terminal as T : h.resolve<T>(id)
    try {
      const session = await createClaudeCodeTerminalSession(resolve, { projectId: "project-1", initialPrompt: prompt })
      expect(session.status).toBe("running")
      expect(spawnPty).toHaveBeenCalledTimes(1)
      const environment = spawnPty.mock.calls[0]![0].env
      expect(environment.SYNAPSE_CLAUDE_PROMPT_TOKEN).toBeTypeOf("string")
      expect(environment.SYNAPSE_SESSION_ID).toBe(session.id)
      expect(JSON.stringify(state)).not.toContain(environment.SYNAPSE_CLAUDE_PROMPT_TOKEN)
      expect(JSON.stringify(state)).not.toContain(environment.SYNAPSE_CLAUDE_PROMPT_DIGEST)
      expect(JSON.stringify(state)).not.toContain("SYNAPSE_CLAUDE_PROMPT_")
    } finally { await terminal.stop() }
  })
  it("preserves confirmed submission when the CLI exits before terminal creation returns", async () => {
    const prompt = "Review before exit"
    const createSession = vi.fn(async (options: { args: string[]; environment: Record<string, string>; internalEnvironment?: Record<string, string>; onEnded(): void }) => {
      const settingsPath = options.args[options.args.indexOf("--settings") + 1]!
      const hook = spawnSync(process.execPath, [path.join(path.dirname(settingsPath), "prompt-submitted.cjs")], {
        env: { ...process.env, ...options.environment, ...options.internalEnvironment }, input: JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt }), timeout: 5000,
      })
      if (hook.error || hook.status !== 0) throw hook.error ?? new Error("Hook failed")
      options.onEnded()
      return { id: "session-1", status: "failed" }
    })
    const { resolve } = harness({ providers: [configured], createSession, projectPath: process.cwd() })
    await expect(createClaudeCodeTerminalSession(resolve, { projectId: "project-1", initialPrompt: prompt })).resolves.toMatchObject({ id: "session-1" })
  })
  it("confirms the initial prompt independently of notifications and retains live settings", async () => {
    const prompt = "Review 中文\n\"quoted\" $()"
    const notifyHook = { matcher: "", hooks: [{ type: "command", command: "notify", async: true }] }
    const createSession = vi.fn(async (options: { args: string[]; environment: Record<string, string>; internalEnvironment?: Record<string, string>; onEnded(): void }) => {
      const settingsPath = options.args[options.args.indexOf("--settings") + 1]!
      const hook = spawnSync(process.execPath, [path.join(path.dirname(settingsPath), "prompt-submitted.cjs")], {
        env: { ...process.env, ...options.environment, ...options.internalEnvironment },
        input: JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt }), encoding: "utf8", timeout: 5000,
      })
      if (hook.error || hook.status !== 0) throw hook.error ?? new Error("Hook failed")
      return { id: "session-1", status: "running" }
    })
    const { resolve, buildEnv } = harness({ providers: [configured], createSession, projectPath: process.cwd(),
      notificationService: { buildClaudeCodeHookSettings: () => ({ hooks: { UserPromptSubmit: [notifyHook] } }) },
    })
    const session = await createClaudeCodeTerminalSession(resolve, { projectId: "project-1", initialPrompt: prompt, actor: { kind: "user", id: "automation" } })
    expect(session.id).toBe("session-1")
    expect(buildEnv).toHaveBeenCalledWith("preferred", { actor: { kind: "user", id: "automation" }, projectId: "project-1" })
    const options = createSession.mock.calls[0]![0]
    const settingsPath = options.args[options.args.indexOf("--settings") + 1]!
    try {
      const settings = JSON.parse(readFileSync(settingsPath, "utf8"))
      expect(settings.hooks.UserPromptSubmit).toHaveLength(2)
      expect(settings.hooks.UserPromptSubmit[0]).toEqual(notifyHook)
      expect(settings.env.SYNAPSE_CLAUDE_PROMPT_DIGEST).toBeUndefined()
      expect(settings.env.SYNAPSE_CLAUDE_PROMPT_TOKEN).toBeUndefined()
      expect(JSON.stringify(settings)).not.toContain(prompt)
    } finally { options.onEnded() }
  })
  it("passes an initial prompt as one positional argv and waits for its submission", async () => {
    const controller = new AbortController()
    const createSession = vi.fn(async (_input: { args: string[]; onEnded(): void }) => {
      controller.abort()
      return { id: "session-1", status: "running" }
    })
    const { resolve } = harness({ providers: [configured], createSession, projectPath: process.cwd() })
    await expect(createClaudeCodeTerminalSession(resolve, {
      projectId: "project-1", initialPrompt: "--中文\n\"review\" $()", abortSignal: controller.signal,
    })).rejects.toThrow()
    expect(createSession).toHaveBeenCalledTimes(1)
    expect(createSession.mock.calls[0]![0].args.slice(-2)).toEqual(["--", "--中文\n\"review\" $()"])
    createSession.mock.calls[0]![0].onEnded()
  })

  it("resumes the requested native session with its workspace, exact model and permission mode", async () => {
    const { resolve, createSession } = harness()
    await createClaudeCodeTerminalSession(resolve, {
      projectId: "project-1",
      continuation: {
        phase: "launching", sdkSessionId: "sdk-original", providerId: "deepseek",
        cwd: "/original-workspace", model: "deepseek-flash", permissionMode: "acceptEdits",
        createdAt: "2026-10-10T00:00:00Z",
      },
    })
    const launched = createSession.mock.calls[0]?.[0]
    expect(launched.cwd).toBe("/original-workspace")
    expect(launched.args).toContain("--resume")
    expect(launched.args).toContain("sdk-original")
    expect(launched.args).toContain("deepseek-flash")
    expect(launched.args).toContain("acceptEdits")
  })

  it("rejects a failed PTY result instead of reporting a launched conversation", async () => {
    const { resolve } = harness({ createSession: vi.fn().mockResolvedValue({ id: "failed", status: "failed" }) })
    await expect(createClaudeCodeTerminalSession(resolve, { projectId: "project-1", providerId: "preferred", modelTier: "sonnet" }))
      .rejects.toThrow("Claude Code")
  })

  beforeEach(() => {
    vi.clearAllMocks()
    runtimeBinaryMock.resolveBundledClaudeExecutable.mockReturnValue("/app/claude")
  })

  it("resolves the configured default, tier and all, when the caller names no Provider", async () => {
    // The mobile gateway sends only a project, so this is the path that decides what
    // 默认 means — and it has to be the desktop's own answer, or the phone's default
    // and the ⌘-click default would be two different things.
    const { buildEnv, createSession, resolve } = harness({
      providers: [activated, configured],
      defaultProviderModel: { providerId: "preferred", modelTier: "opus" },
    })

    await createClaudeCodeTerminalSession(resolve, { projectId: "project-1" })

    expect(buildEnv).toHaveBeenCalledWith("preferred", {
      actor: { kind: "user", id: "renderer" },
      projectId: "project-1",
    })
    // The configured tier, not merely the configured Provider.
    expect(launchedModel(createSession)).toBe("env-opus")
    expect(createSession).toHaveBeenCalledWith(expect.objectContaining({
      title: "Claude Code · Synapse",
      cwd: "/repo",
      shell: "/app/claude",
      environment: expect.objectContaining({
        ANTHROPIC_MODEL: "env-opus",
        DISABLE_AUTOUPDATER: "1",
      }),
    }))
  })

  it("falls back to the active Provider when the configured default is gone", async () => {
    // The ordinary way this happens: the setting outlives the Provider it names.
    // The tier then comes from that Provider — its own best one — not from the stale
    // setting, which named a Provider that no longer exists.
    const { buildEnv, createSession, resolve } = harness({
      providers: [spare, activated],
      defaultProviderModel: { providerId: "removed", modelTier: "opus" },
    })

    await createClaudeCodeTerminalSession(resolve, { projectId: "project-1" })

    expect(buildEnv).toHaveBeenCalledWith("active", expect.anything())
    // The active Provider's own best tier is sonnet, which it names.
    expect(launchedModel(createSession)).toBe("env-sonnet")
  })

  it("falls back to the first non-archived Provider when none is active", async () => {
    const { buildEnv, createSession, resolve } = harness({
      providers: [{ ...activated, active: false }, spare],
    })

    await createClaudeCodeTerminalSession(resolve, { projectId: "project-1" })

    // First in the list wins, and the tier is its own best one rather than a guess.
    expect(buildEnv).toHaveBeenCalledWith("active", expect.anything())
    expect(launchedModel(createSession)).toBe("env-sonnet")

    const withoutArchived = harness({ providers: [{ ...unusable, archived: true }, spare] })
    await createClaudeCodeTerminalSession(withoutArchived.resolve, { projectId: "project-1" })
    // Archived Providers are not candidates at all, so the archived one being first
    // in the array does not make it the fallback. `spare` names only its haiku tier,
    // which is therefore the only one this launch could have pinned.
    expect(withoutArchived.buildEnv).toHaveBeenCalledWith("spare", expect.anything())
    expect(launchedModel(withoutArchived.createSession)).toBe("env-haiku")
  })

  it("uses an explicit Provider and tier without consulting the default at all", async () => {
    // Both callers that pass a selection have already chosen it against the same
    // Provider list; re-resolving here would let the two disagree.
    const { buildEnv, listAllProviders, createSession, resolve } = harness({
      providers: [unusable],
      defaultProviderModel: { providerId: "preferred", modelTier: "default" },
    })

    await createClaudeCodeTerminalSession(resolve, {
      projectId: "project-1",
      providerId: "vendor",
      modelTier: "sonnet",
    })

    expect(listAllProviders).not.toHaveBeenCalled()
    expect(buildEnv).toHaveBeenCalledWith("vendor", expect.anything())
    expect(launchedModel(createSession)).toBe("env-sonnet")
  })

  it("refuses half a Provider choice rather than completing it", async () => {
    const { buildEnv, createSession, resolve } = harness({ providers: [configured] })

    await expect(createClaudeCodeTerminalSession(resolve, { projectId: "project-1", providerId: "vendor" }))
      .rejects.toMatchObject({ code: "invalid_input" })
    await expect(createClaudeCodeTerminalSession(resolve, { projectId: "project-1", modelTier: "opus" }))
      .rejects.toMatchObject({ code: "invalid_input" })

    expect(buildEnv).not.toHaveBeenCalled()
    expect(createSession).not.toHaveBeenCalled()
  })

  it("rejects when no Provider can name a model, leaving no session and no launch directory", async () => {
    const before = launchDirectories()
    const { createSession, resolve } = harness({ providers: [unusable] })

    await expect(createClaudeCodeTerminalSession(resolve, { projectId: "project-1" }))
      .rejects.toMatchObject({ code: "model_unavailable" })

    expect(createSession).not.toHaveBeenCalled()
    // The launch directory holds the Provider's credentials, so a failure before the
    // terminal starts must not have created one at all.
    expect(launchDirectories()).toEqual(before)
  })

  it("names the missing runtime with the desktop's own wording", async () => {
    runtimeBinaryMock.resolveBundledClaudeExecutable.mockReturnValue(undefined)
    const { buildEnv, resolve } = harness({ providers: [configured] })

    await expect(createClaudeCodeTerminalSession(resolve, { projectId: "project-1" }))
      .rejects.toMatchObject({ code: "runtime_missing", message: runtimeBinaryMock.missingMessage })
    // Checked before the Provider is touched, so a broken install does not also read a key.
    expect(buildEnv).not.toHaveBeenCalled()
  })

  it("passes the initial grid into creation, so the CLI is born the right shape", async () => {
    // Claude Code paints its banner and prompt immediately; those lines keep whatever
    // width the PTY had, so resizing after creation is too late (ADR 0063).
    const { createSession, resolve } = harness({ providers: [configured] })

    await createClaudeCodeTerminalSession(resolve, {
      projectId: "project-1",
      providerId: "preferred",
      modelTier: "default",
      cols: 54,
      rows: 37,
    })

    expect(createSession).toHaveBeenCalledWith(expect.objectContaining({ cols: 54, rows: 37 }))
  })

  it("deletes the launch directory once the terminal ends", async () => {
    const { createSession, resolve } = harness({ providers: [configured] })
    await createClaudeCodeTerminalSession(resolve, { projectId: "project-1" })

    const launched = createSession.mock.calls[0]![0] as {
      readonly args: readonly string[]
      readonly onEnded: () => void
    }
    expect(existsSync(launched.args[1]!)).toBe(true)
    launched.onEnded()
    await vi.waitFor(() => expect(existsSync(launched.args[1]!)).toBe(false))
  })

  it("writes the notification hooks the notification service builds into the settings file", async () => {
    // 这条路绕过了 PATH shim（内置 runtime 是绝对路径启动），所以 hooks 只能由 launcher 自己写进
    // settings。写法与 wrapper 合并出来的那份必须一致 —— 逐字比对的锁在通知服务那一侧。
    const managed = {
      __synapse: { managed: "terminal-agent-notifications", version: 1 },
      hooks: { Stop: [{ matcher: "", hooks: [{ type: "command", command: "hook-command", timeout: 5, async: true }] }] },
    }
    const buildClaudeCodeHookSettings = vi.fn(() => managed)
    const { createSession, resolve } = harness({
      providers: [configured],
      notificationService: { buildClaudeCodeHookSettings },
    })

    await createClaudeCodeTerminalSession(resolve, { projectId: "project-1" })

    expect(buildClaudeCodeHookSettings).toHaveBeenCalledOnce()
    const settings = JSON.parse(readFileSync(
      (createSession.mock.calls[0]![0] as { readonly args: readonly string[] }).args[1]!,
      "utf8",
    )) as Record<string, unknown>
    expect(settings.hooks).toEqual(managed.hooks)
    expect(settings.__synapse).toEqual(managed.__synapse)
    // 凭据那条承诺不变：settings 里仍然只有 env、可选的 model，以及这次加的 hooks 与身份标记。
    expect(Object.keys(settings).filter((key) => !["env", "model", "hooks", "__synapse"].includes(key))).toEqual([])
  })

  it("starts without hooks when the notification service is not available", async () => {
    // 通知从来不是启动的前置条件：拿不到服务就照常起，且不能因此抛错。
    const { createSession, resolve } = harness({ providers: [configured] })

    await createClaudeCodeTerminalSession(resolve, { projectId: "project-1" })

    const settings = JSON.parse(readFileSync(
      (createSession.mock.calls[0]![0] as { readonly args: readonly string[] }).args[1]!,
      "utf8",
    )) as Record<string, unknown>
    expect(settings).not.toHaveProperty("hooks")
    expect(settings).not.toHaveProperty("__synapse")
    expect(settings).toHaveProperty("env")
  })
})
