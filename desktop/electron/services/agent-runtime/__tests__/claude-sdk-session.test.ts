import type {
  PermissionResult,
  SDKMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk" with { "resolution-mode": "import" }
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

  it("cancelCurrentTurn interrupts an alive query", async () => {
    const { factory, query } = createQueryFactory()
    const session = createSession(factory)

    await expect(session.cancelCurrentTurn()).resolves.toBe(true)
    expect(query.interrupt).toHaveBeenCalledOnce()
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
})

function createSession(queryFactory: QueryFactory): ClaudeSDKSession {
  return new ClaudeSDKSession({
    projectId: "project-1",
    conversationId: "conversation-1",
    providerId: "claude-sdk",
    cwd: "/tmp/project",
    env: { FOO: "bar" },
    queryFactory,
    now: () => new Date("2026-05-13T00:00:00.000Z"),
  })
}

function message(content: string): AgentMessage {
  return {
    projectId: "project-1",
    sessionKey: "session-1",
    platform: "test",
    content,
  }
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

  private readonly messages: SDKMessage[] = []
  private readonly waiters: Array<(value: IteratorResult<SDKMessage, void>) => void> = []

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
    return new Promise((resolve) => {
      this.waiters.push(resolve)
    })
  }
}
