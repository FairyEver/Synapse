import type {
  PermissionResult,
  SDKMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk" with { "resolution-mode": "import" }
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, it, vi } from "vitest"

import {
  ClaudeSDKSession,
  type QueryFactory,
  type QueryLike,
} from "../claude-sdk-session"
import type { AgentMessage } from "../types"

describe("ClaudeSDKSession", () => {
  it("send yields user messages into the SDK input stream", async () => {
    const { factory, getPrompt } = createQueryFactory()
    const session = createSession(factory)

    const input = getPrompt()[Symbol.asyncIterator]().next()
    await session.send(message("hello"))

    await expect(input).resolves.toEqual({
      done: false,
      value: {
        type: "user",
        message: {
          role: "user",
          content: "hello",
        },
        parent_tool_use_id: null,
      },
    })
  })

  it("requests partial SDK messages so renderer can stream tokens", () => {
    const { factory, getOptions } = createQueryFactory()
    createSession(factory)

    expect(getOptions()).toMatchObject({
      includePartialMessages: true,
    })
  })

  it("loads local Claude Code rules, memory, skills, and project MCP configuration", () => {
    const { factory, getOptions } = createQueryFactory()
    createSession(factory)

    expect(getOptions()).toMatchObject({
      settingSources: ["user", "project", "local"],
      skills: "all",
      settings: {
        enableAllProjectMcpServers: true,
        disableAllHooks: true,
      },
    })
  })

  it("passes local SDK plugins to Claude Agent SDK", () => {
    const { factory, getOptions } = createQueryFactory()
    createSession(factory, {
      plugins: [{ type: "local", path: "/Applications/Synapse/resources/knowledge-base/claude-plugin" }],
    })

    expect(getOptions()).toMatchObject({
      plugins: [{ type: "local", path: "/Applications/Synapse/resources/knowledge-base/claude-plugin" }],
    })
  })

  it("enables the SDK bypass permission confirmation for bypass mode", () => {
    const { factory, getOptions } = createQueryFactory()
    createSession(factory, { mode: "bypassPermissions" })

    expect(getOptions()).toMatchObject({
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
    })
  })

  it("passes provider env together with the host process env to the SDK", () => {
    const { factory, getOptions } = createQueryFactory()
    createSession(factory, { env: { FOO: "bar" } })

    const sdkEnv = getOptions().env as NodeJS.ProcessEnv
    expect(sdkEnv).toEqual(expect.objectContaining({
      FOO: "bar",
    }))
    expect(sdkEnv.PATH).toContain((process.env.PATH ?? "").split(":").filter(Boolean)[0] ?? "")
    expect(getOptions().settings).toMatchObject({
      env: { FOO: "bar" },
    })
  })

  it("merges login shell PATH and Synapse node fallback into SDK env", () => {
    withProcessPlatform("darwin", () => {
      const { factory, getOptions } = createQueryFactory()
      createSession(factory, {
        env: { FOO: "bar" },
        hostEnv: {
          PATH: "/usr/bin:/bin",
          HOME: "/Users/ada",
        },
        resolveShellPath: () => "/opt/homebrew/bin:/usr/local/bin:/usr/bin",
        nodeRuntimeBinPath: "/Users/ada/Library/Application Support/Synapse/runtime-bin",
      })

      expect(getOptions().env).toEqual(expect.objectContaining({
        PATH: "/usr/bin:/bin:/opt/homebrew/bin:/usr/local/bin:/Users/ada/Library/Application Support/Synapse/runtime-bin",
        FOO: "bar",
      }))
    })
  })

  it.each(packagedRuntimeCases)(
    "uses the unpacked Claude binary for $platform-$arch packaged apps",
    ({ platform, arch, packageName, binaryName }) => {
      withPackagedRuntime({
        platform,
        arch,
        files: [["node_modules", packageName, binaryName]],
      }, ({ unpackedPath }) => {
        const { factory, getOptions } = createQueryFactory()
        createSession(factory)

        expect(getOptions().pathToClaudeCodeExecutable).toBe(
          unpackedPath("node_modules", packageName, binaryName),
        )
      })
    },
  )

  it("prefers the Linux musl unpacked Claude binary when both Linux variants exist", () => {
    withPackagedRuntime({
      platform: "linux",
      arch: "x64",
      files: [
        ["node_modules", "@anthropic-ai/claude-agent-sdk-linux-x64-musl", "claude"],
        ["node_modules", "@anthropic-ai/claude-agent-sdk-linux-x64", "claude"],
      ],
    }, ({ unpackedPath }) => {
      const { factory, getOptions } = createQueryFactory()
      createSession(factory)

      expect(getOptions().pathToClaudeCodeExecutable).toBe(
        unpackedPath("node_modules", "@anthropic-ai/claude-agent-sdk-linux-x64-musl", "claude"),
      )
    })
  })

  it("nextEvent returns bridged SDK messages", async () => {
    const { factory, query } = createQueryFactory()
    const session = createSession(factory)

    const event = session.nextEvent()
    query.push({
      type: "system",
      subtype: "init",
      session_id: "sdk-1",
      tools: ["Read"],
      mcp_servers: [],
    } as unknown as SDKMessage)

    await expect(event).resolves.toMatchObject({
      type: "sessionInit",
      conversationId: "conversation-1",
      providerId: "claude-sdk",
      sdkSessionId: "sdk-1",
      timestamp: "2026-05-13T00:00:00.000Z",
      tools: ["Read"],
    })
    expect(session.currentSessionId()).toBe("sdk-1")
  })

  it("maps SDK tool result ids back to the tool name for timeline display", async () => {
    const { factory, query } = createQueryFactory()
    const session = createSession(factory)

    const assistantEvent = session.nextEvent()
    query.push({
      type: "assistant",
      session_id: "sdk-tools",
      message: {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "toolu-read-1",
            name: "Read",
            input: {
              file_path: "/tmp/project/README.md",
            },
          },
        ],
      },
    } as unknown as SDKMessage)

    await expect(assistantEvent).resolves.toMatchObject({ type: "assistant" })
    await expect(session.nextEvent()).resolves.toMatchObject({
      type: "toolUse",
      toolName: "Read",
    })

    const resultEvent = session.nextEvent()
    query.push({
      type: "user",
      session_id: "sdk-tools",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu-read-1",
            content: "file contents",
            is_error: false,
          },
        ],
      },
    } as unknown as SDKMessage)

    await expect(resultEvent).resolves.toMatchObject({
      type: "toolResult",
      toolName: "Read",
      content: "file contents",
    })
  })

  it("cancelCurrentTurn interrupts an alive query", async () => {
    const { factory, query } = createQueryFactory()
    const session = createSession(factory)

    await expect(session.cancelCurrentTurn()).resolves.toBe(true)
    expect(query.interrupt).toHaveBeenCalledOnce()
  })

  it("forwards permission mode switches to the SDK query", async () => {
    const { factory, query } = createQueryFactory()
    const session = createSession(factory)

    await session.setPermissionMode("acceptEdits")

    expect(query.setPermissionMode).toHaveBeenCalledWith("acceptEdits")
  })

  it("rejects invalid runtime permission modes", async () => {
    const { factory, query } = createQueryFactory()
    const session = createSession(factory)

    await expect(session.setPermissionMode("free-for-all")).rejects.toThrow(
      "Unsupported permission mode: free-for-all",
    )
    expect(query.setPermissionMode).not.toHaveBeenCalled()
  })

  it("close closes the SDK query", async () => {
    const { factory, query } = createQueryFactory()
    const session = createSession(factory)

    await session.close()

    expect(query.close).toHaveBeenCalledOnce()
    expect(session.alive()).toBe(false)
  })

  it("canUseTool enqueues a pending permission and resolves after respondPermission", async () => {
    const { factory, getOptions } = createQueryFactory()
    const session = createSession(factory)

    const canUseTool = getOptions().canUseTool as (
      toolName: string,
      input: Record<string, unknown>,
      context: { signal: AbortSignal },
    ) => Promise<PermissionResult>
    const permission = canUseTool("Bash", { command: "pwd" }, {
      signal: new AbortController().signal,
    })

    const event = await session.nextEvent()

    expect(event).toMatchObject({
      type: "permissionRequest",
      requestId: expect.any(String),
      toolName: "Bash",
      toolInput: "pwd",
      toolInputRaw: { command: "pwd" },
      conversationId: "conversation-1",
      providerId: "claude-sdk",
      timestamp: "2026-05-13T00:00:00.000Z",
    })

    if (event?.type !== "permissionRequest") {
      throw new Error("expected permission request")
    }
    await session.respondPermission(event.requestId, {
      behavior: "allow",
      updatedInput: { command: "pwd" },
    })

    await expect(permission).resolves.toEqual({
      behavior: "allow",
      updatedInput: { command: "pwd" },
    })
  })

  it("logs stale permission responses when the SDK pending request is missing", async () => {
    const { factory } = createQueryFactory()
    const logger = { warn: vi.fn() }
    const session = createSession(factory, { logger, sdkSessionId: "sdk-1" })

    await session.respondPermission("conversation-1-permission-stale", {
      behavior: "deny",
      message: "denied because prompt contained secret",
    })

    expect(logger.warn).toHaveBeenCalledWith("Claude SDK permission response ignored.", {
      boundary: "claude-sdk-permission-response",
      projectId: "project-1",
      conversationId: "conversation-1",
      providerId: "claude-sdk",
      sdkSessionId: "sdk-1",
      requestId: "conversation-1-permission-stale",
      behavior: "deny",
    })
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("prompt contained secret")
  })

  it("redacts and bounds permission request tool input summaries and raw event input", async () => {
    const { factory, getOptions } = createQueryFactory()
    const session = createSession(factory)

    void canUseTool(getOptions())("HttpRequest", {
      authorization: "Bearer sk-live",
      headers: { cookie: "sid=secret" },
      nested: { password: "pass-1", value: "safe" },
      body: "x".repeat(400),
    }, {
      signal: new AbortController().signal,
    })

    const event = await session.nextEvent()

    expect(event?.type).toBe("permissionRequest")
    if (event?.type !== "permissionRequest") {
      throw new Error("expected permission request")
    }
    expect(event.toolInput).toContain("[redacted]")
    expect(event.toolInput).toContain("\"value\":\"safe\"")
    expect(event.toolInput).not.toContain("Bearer sk-live")
    expect(event.toolInput).not.toContain("sid=secret")
    expect(event.toolInput).not.toContain("pass-1")
    expect(event.toolInput).not.toContain("x".repeat(200))
    expect(event.toolInputRaw).toMatchObject({
      authorization: "[redacted]",
      headers: { cookie: "[redacted]" },
      nested: { password: "[redacted]", value: "safe" },
    })
    expect(JSON.stringify(event)).not.toContain("Bearer sk-live")
    expect(JSON.stringify(event)).not.toContain("sid=secret")
    expect(JSON.stringify(event)).not.toContain("pass-1")
  })

  it("redacts Bash permission request header and cookie secrets", async () => {
    const { factory, getOptions } = createQueryFactory()
    const session = createSession(factory)

    void canUseTool(getOptions())("Bash", {
      command: "curl -H 'Authorization: Bearer sk-command' --cookie sid=command https://example.test",
    }, {
      signal: new AbortController().signal,
    })

    const event = await session.nextEvent()

    expect(event?.type).toBe("permissionRequest")
    if (event?.type !== "permissionRequest") {
      throw new Error("expected permission request")
    }
    expect(event.toolInput).toContain("[redacted]")
    expect(event.toolInput).not.toContain("sk-command")
    expect(event.toolInput).not.toContain("sid=command")
    expect(event.toolInputRaw).toMatchObject({
      command: expect.stringContaining("[redacted]"),
    })
    expect(JSON.stringify(event)).not.toContain("sk-command")
    expect(JSON.stringify(event)).not.toContain("sid=command")
  })

  it("preserves local paths in permission request summaries and raw event input", async () => {
    const { factory, getOptions } = createQueryFactory()
    const session = createSession(factory)

    void canUseTool(getOptions())("Read", {
      file_path: "/Users/liyang/private/project/secret.ts",
      windowsPath: "C:\\Users\\liyang\\private\\secret.txt",
      nested: {
        cwd: "/Users/liyang/private/project",
      },
    }, {
      signal: new AbortController().signal,
    })

    const event = await session.nextEvent()

    expect(event?.type).toBe("permissionRequest")
    if (event?.type !== "permissionRequest") {
      throw new Error("expected permission request")
    }
    expect(event.toolInput).toContain("/Users/liyang/private/project/secret.ts")
    expect(event.toolInput).toContain("C:\\\\Users\\\\liyang\\\\private\\\\secret.txt")
    expect(event.toolInputRaw).toMatchObject({
      file_path: "/Users/liyang/private/project/secret.ts",
      windowsPath: "C:\\Users\\liyang\\private\\secret.txt",
      nested: {
        cwd: "/Users/liyang/private/project",
      },
    })
    expect(JSON.stringify(event)).toContain("/Users/liyang/private")
    expect(JSON.stringify(event)).toContain("C:\\\\Users\\\\liyang")
  })

  it("generates permission request ids that are unique across conversations", async () => {
    const first = createQueryFactory()
    const second = createQueryFactory()
    const sessionA = createSession(first.factory, { conversationId: "conversation-a" })
    const sessionB = createSession(second.factory, { conversationId: "conversation-b" })

    void canUseTool(first.getOptions())("Bash", { command: "pwd" }, {
      signal: new AbortController().signal,
    })
    void canUseTool(second.getOptions())("Bash", { command: "pwd" }, {
      signal: new AbortController().signal,
    })

    const eventA = await sessionA.nextEvent()
    const eventB = await sessionB.nextEvent()

    expect(eventA).toMatchObject({
      type: "permissionRequest",
      conversationId: "conversation-a",
      requestId: expect.stringContaining("conversation-a"),
    })
    expect(eventB).toMatchObject({
      type: "permissionRequest",
      conversationId: "conversation-b",
      requestId: expect.stringContaining("conversation-b"),
    })
    expect(eventA?.type).toBe("permissionRequest")
    expect(eventB?.type).toBe("permissionRequest")
    if (eventA?.type !== "permissionRequest" || eventB?.type !== "permissionRequest") {
      throw new Error("Expected permission request events")
    }
    expect(eventA?.requestId).not.toBe(eventB?.requestId)
  })

  it("returns an error event when the SDK query rejects", async () => {
    const { factory, query } = createQueryFactory()
    const session = createSession(factory)

    const event = session.nextEvent()
    query.rejectNext(new Error("sdk exploded"))

    await expect(event).resolves.toMatchObject({
      type: "error",
      message: "sdk exploded",
      conversationId: "conversation-1",
      providerId: "claude-sdk",
      timestamp: "2026-05-13T00:00:00.000Z",
    })
    await expect(session.nextEvent()).resolves.toBeNull()
  })

  it("sanitizes SDK query rejection messages before publishing error events", async () => {
    const { factory, query } = createQueryFactory()
    const session = createSession(factory, { sdkSessionId: "sdk-1" })

    const event = session.nextEvent()
    query.rejectNext(
      new Error(
        "Authorization: Bearer sk-secret failed in /Users/liyang/private/project/file.ts",
      ),
    )

    await expect(event).resolves.toMatchObject({
      type: "error",
      message: expect.stringContaining("[redacted]"),
      conversationId: "conversation-1",
      providerId: "claude-sdk",
      sdkSessionId: "sdk-1",
      timestamp: "2026-05-13T00:00:00.000Z",
    })
    const resolved = await event
    expect(JSON.stringify(resolved)).not.toContain("sk-secret")
    expect(JSON.stringify(resolved)).toContain("/Users/liyang/private")
  })

  it("logs SDK query rejection failures with session context", async () => {
    const { factory, query } = createQueryFactory()
    const logger = { warn: vi.fn() }
    const session = createSession(factory, {
      logger,
      sdkSessionId: "sdk-1",
    })

    const event = session.nextEvent()
    query.rejectNext(new Error("sdk exploded"))

    await expect(event).resolves.toMatchObject({
      type: "error",
      message: "sdk exploded",
    })
    await waitFor(() => logger.warn.mock.calls.length > 0)

    expect(logger.warn).toHaveBeenCalledWith("Claude SDK query failed.", {
      boundary: "claude-sdk-query",
      conversationId: "conversation-1",
      errorLength: 12,
      errorName: "Error",
      projectId: "project-1",
      providerId: "claude-sdk",
      sdkSessionId: "sdk-1",
    })
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("sdk exploded")
  })

  it("stays alive until queued terminal events are drained", async () => {
    const { factory, query } = createQueryFactory()
    const session = createSession(factory)

    query.rejectNext(new Error("sdk exploded"))
    await waitFor(() => !query.hasWaiters())

    expect(session.alive()).toBe(true)
    await expect(session.nextEvent()).resolves.toMatchObject({
      type: "error",
      message: "sdk exploded",
    })
    expect(session.alive()).toBe(false)
  })

  it("ignores sends after the SDK query has finished", async () => {
    const { factory, query } = createQueryFactory()
    const logger = { warn: vi.fn() }
    const session = createSession(factory, { logger, sdkSessionId: "sdk-1" })

    const event = session.nextEvent()
    query.rejectNext(new Error("sdk exploded"))
    await expect(event).resolves.toMatchObject({ type: "error" })
    expect(session.alive()).toBe(false)

    expect(session.finished).toBe(true)
    await expect(session.send(message("late message"))).resolves.toBe(false)
    expect(logger.warn).toHaveBeenCalledWith("Claude SDK send rejected after query finished.", {
      boundary: "claude-sdk-send",
      conversationId: "conversation-1",
      projectId: "project-1",
      providerId: "claude-sdk",
      sdkSessionId: "sdk-1",
    })
  })

  it("releases event waiters when SDK close throws", async () => {
    const { factory, query } = createQueryFactory()
    const session = createSession(factory)
    query.close.mockImplementation(() => {
      throw new Error("close failed")
    })

    const event = session.nextEvent()
    await expect(session.close()).resolves.toBeUndefined()

    await expect(event).resolves.toBeNull()
    expect(query.close).toHaveBeenCalledOnce()
    expect(session.alive()).toBe(false)
  })

  it("logs SDK query close failures with session context", async () => {
    const { factory, query } = createQueryFactory()
    const logger = { warn: vi.fn() }
    const session = createSession(factory, {
      logger,
      sdkSessionId: "sdk-1",
    })
    query.close.mockImplementation(() => {
      throw new Error("close failed")
    })

    await session.close()
    await waitFor(() => logger.warn.mock.calls.length > 0)

    expect(logger.warn).toHaveBeenCalledWith("Claude SDK query close failed.", {
      boundary: "claude-sdk-query.close",
      conversationId: "conversation-1",
      errorLength: 12,
      errorName: "Error",
      projectId: "project-1",
      providerId: "claude-sdk",
      sdkSessionId: "sdk-1",
    })
  })

  it("settles pending permission requests when cancelling the current turn", async () => {
    const { factory, getOptions, query } = createQueryFactory()
    const session = createSession(factory)

    const permission = canUseTool(getOptions())("Bash", { command: "pwd" }, {
      signal: new AbortController().signal,
    })
    const event = await session.nextEvent()

    await expect(session.cancelCurrentTurn()).resolves.toBe(true)

    expect(event?.type).toBe("permissionRequest")
    expect(query.interrupt).toHaveBeenCalledOnce()
    await expect(resolveSoon(permission)).resolves.toEqual({
      behavior: "deny",
      message: "Current turn was cancelled before permission was resolved.",
    })
  })

  it("cleans up forwarded abort listeners on close", async () => {
    const abortController = new AbortController()
    const remove = vi.spyOn(abortController.signal, "removeEventListener")
    const { factory, getOptions } = createQueryFactory()
    const session = createSession(factory, { abortSignal: abortController.signal })

    await session.close()

    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function))
    expect((getOptions().abortController as AbortController).signal.aborted).toBe(true)
  })

  it("denies immediately when permission signal is already aborted", async () => {
    const { factory, getOptions } = createQueryFactory()
    const session = createSession(factory)
    const abortController = new AbortController()
    abortController.abort()

    await expect(resolveSoon(canUseTool(getOptions())("Bash", { command: "pwd" }, {
      signal: abortController.signal,
    }))).resolves.toEqual({
      behavior: "deny",
      message: "Permission request was cancelled.",
    })
  })
})

interface PackagedRuntimeCase {
  readonly platform: NodeJS.Platform
  readonly arch: NodeJS.Architecture
  readonly packageName: string
  readonly binaryName: string
}

const packagedRuntimeCases: readonly PackagedRuntimeCase[] = [
  {
    platform: "darwin",
    arch: "arm64",
    packageName: "@anthropic-ai/claude-agent-sdk-darwin-arm64",
    binaryName: "claude",
  },
  {
    platform: "win32",
    arch: "x64",
    packageName: "@anthropic-ai/claude-agent-sdk-win32-x64",
    binaryName: "claude.exe",
  },
  {
    platform: "linux",
    arch: "x64",
    packageName: "@anthropic-ai/claude-agent-sdk-linux-x64",
    binaryName: "claude",
  },
]

function withProcessPlatform(platform: NodeJS.Platform, run: () => void): void {
  const platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform")

  try {
    Object.defineProperty(process, "platform", {
      configurable: true,
      value: platform,
    })

    run()
  } finally {
    if (platformDescriptor) Object.defineProperty(process, "platform", platformDescriptor)
  }
}

function withPackagedRuntime(
  options: {
    readonly platform: NodeJS.Platform
    readonly arch: NodeJS.Architecture
    readonly files: readonly (readonly string[])[]
  },
  run: (helpers: { unpackedPath(...segments: string[]): string }) => void,
): void {
  const resourcesPath = mkdtempSync(path.join(tmpdir(), "synapse-resources-"))
  const unpackedPath = (...segments: string[]): string =>
    path.join(resourcesPath, "app.asar.unpacked", ...segments)
  const resourcesDescriptor = Object.getOwnPropertyDescriptor(process, "resourcesPath")
  const platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform")
  const archDescriptor = Object.getOwnPropertyDescriptor(process, "arch")

  try {
    for (const fileSegments of options.files) {
      const filePath = unpackedPath(...fileSegments)
      mkdirSync(path.dirname(filePath), { recursive: true })
      writeFileSync(filePath, "")
    }
    Object.defineProperty(process, "resourcesPath", {
      configurable: true,
      value: resourcesPath,
    })
    Object.defineProperty(process, "platform", {
      configurable: true,
      value: options.platform,
    })
    Object.defineProperty(process, "arch", {
      configurable: true,
      value: options.arch,
    })

    run({ unpackedPath })
  } finally {
    if (resourcesDescriptor) {
      Object.defineProperty(process, "resourcesPath", resourcesDescriptor)
    } else {
      Reflect.deleteProperty(process, "resourcesPath")
    }
    if (platformDescriptor) Object.defineProperty(process, "platform", platformDescriptor)
    if (archDescriptor) Object.defineProperty(process, "arch", archDescriptor)
    rmSync(resourcesPath, { recursive: true, force: true })
  }
}

function createSession(
  queryFactory: QueryFactory,
  overrides: Partial<ConstructorParameters<typeof ClaudeSDKSession>[0]> = {},
): ClaudeSDKSession {
  return new ClaudeSDKSession({
    projectId: "project-1",
    conversationId: "conversation-1",
    providerId: "claude-sdk",
    cwd: "/tmp/project",
    env: { FOO: "bar" },
    queryFactory,
    now: () => new Date("2026-05-13T00:00:00.000Z"),
    ...overrides,
  })
}

function canUseTool(options: Record<string, unknown>): (
  toolName: string,
  input: Record<string, unknown>,
  context: { signal: AbortSignal },
) => Promise<PermissionResult> {
  return options.canUseTool as (
    toolName: string,
    input: Record<string, unknown>,
    context: { signal: AbortSignal },
  ) => Promise<PermissionResult>
}

function message(content: string): AgentMessage {
  return {
    projectId: "project-1",
    sessionKey: "session-1",
    platform: "test",
    content,
  }
}

function resolveSoon<T>(promise: Promise<T>): Promise<T | "timeout"> {
  return Promise.race([
    promise,
    new Promise<"timeout">((resolve) => {
      setTimeout(() => resolve("timeout"), 20)
    }),
  ])
}

async function waitFor(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (condition()) return
    await new Promise((resolve) => {
      setTimeout(resolve, 0)
    })
  }
  throw new Error("condition was not met")
}

function createQueryFactory(): {
  readonly factory: QueryFactory
  readonly query: FakeQuery
  getPrompt(): AsyncIterable<SDKUserMessage>
  getOptions(): Record<string, unknown>
} {
  const query = new FakeQuery()
  let prompt: AsyncIterable<SDKUserMessage> | undefined
  let options: Record<string, unknown> | undefined
  const factory: QueryFactory = (input) => {
    prompt = input.prompt
    options = input.options
    return query
  }

  return {
    factory,
    query,
    getPrompt() {
      if (!prompt) throw new Error("queryFactory was not called")
      return prompt
    },
    getOptions() {
      if (!options) throw new Error("queryFactory was not called")
      return options
    },
  }
}

class FakeQuery implements QueryLike {
  readonly interrupt = vi.fn(async () => {})
  readonly close = vi.fn()
  readonly setPermissionMode = vi.fn(async (_mode: string) => {})

  private readonly messages: SDKMessage[] = []
  private readonly waiters: Array<(value: IteratorResult<SDKMessage, void>) => void> = []
  private readonly rejecters: Array<(error: unknown) => void> = []

  push(message: SDKMessage): void {
    const waiter = this.waiters.shift()
    if (waiter) {
      waiter({ done: false, value: message })
      return
    }
    this.messages.push(message)
  }

  next(): Promise<IteratorResult<SDKMessage, void>> {
    const message = this.messages.shift()
    if (message) return Promise.resolve({ done: false, value: message })
    return new Promise((resolve, reject) => {
      this.waiters.push(resolve)
      this.rejecters.push(reject)
    })
  }

  rejectNext(error: unknown): void {
    const reject = this.rejecters.shift()
    this.waiters.shift()
    if (reject) reject(error)
  }

  hasWaiters(): boolean {
    return this.waiters.length > 0
  }
}
