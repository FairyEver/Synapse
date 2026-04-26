import { describe, expect, it, vi } from "vitest"

import type {
  ConversationEntryV1,
  DataChangeEvent,
  DataChangeListener,
  DataNamespace,
} from "../../../runtime/data-repo"
import {
  createControlledProcessRunner,
  type ControlledProcessResult,
  type ControlledProcessRunRequest,
} from "../../../runtime/process"
import { InMemoryAuditSink, createPermissionGuard } from "../../../runtime/security"
import { CodexExecAdapter, type CodexProcessRunner } from "../adapters/codex-exec"
import { AgentRuntimeService, conversationId } from "../agent-runtime-service"

describe("AgentRuntimeService", () => {
  it("sends a prompt through Codex exec JSONL and persists the thread id", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const lines = [
      { type: "thread.started", thread_id: "thread-1" },
      { type: "turn.started" },
      {
        type: "item.completed",
        item: {
          type: "agent_message",
          content: [{ type: "output_text", text: "done" }],
        },
      },
      { type: "turn.completed" },
    ].map((line) => JSON.stringify(line))
    const runner = new FakeRunner(lines)
    const service = new AgentRuntimeService({
      projectId: "project-1",
      workDir: "/repo",
      conversations,
      adapter: new CodexExecAdapter(runner),
      now: fixedNow,
    })

    const result = await service.send({
      projectId: "project-1",
      sessionKey: "local:user-1",
      platform: "local",
      userId: "user-1",
      userName: "User One",
      content: "hello\nworld",
    })

    expect(result.resultText).toBe("done")
    expect(result.threadId).toBe("thread-1")
    expect(runner.requests).toHaveLength(1)
    expect(runner.requests[0]).toEqual(
      expect.objectContaining({
        action: "agent.spawn",
        command: "codex",
        cwd: "/repo",
        stdin: "hello\nworld",
      }),
    )
    expect(runner.requests[0]?.args).toEqual([
      "exec",
      "--skip-git-repo-check",
      "--json",
      "--cd",
      "/repo",
      "-",
    ])

    const saved = await conversations.get(conversationId("local", "local:user-1"))
    expect(saved).toEqual(
      expect.objectContaining({
        projectId: "project-1",
        sessionKey: "local:user-1",
        platform: "local",
        agentType: "codex",
        agentSessionId: "thread-1",
        userMeta: expect.objectContaining({
          userId: "user-1",
          userName: "User One",
          platform: "local",
        }),
      }),
    )
    expect(saved?.history).toEqual([
      expect.objectContaining({ role: "user", content: "hello\nworld" }),
      expect.objectContaining({ role: "assistant", content: "done" }),
    ])
  })

  it("uses saved thread id for resume turns", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    await conversations.upsert({
      id: conversationId("local", "s1"),
      schemaVersion: 1,
      projectId: "project-1",
      sessionKey: "s1",
      platform: "local",
      agentType: "codex",
      agentSessionId: "thread-1",
      history: [],
      active: true,
      createdAt: "2026-04-26T00:00:00.000Z",
      updatedAt: "2026-04-26T00:00:00.000Z",
    })
    const runner = new FakeRunner([
      JSON.stringify({ type: "turn.started" }),
      JSON.stringify({
        type: "item.completed",
        item: { type: "agent_message", content: [{ type: "output_text", text: "again" }] },
      }),
      JSON.stringify({ type: "turn.completed" }),
    ])
    const service = new AgentRuntimeService({
      projectId: "project-1",
      workDir: "/repo",
      conversations,
      adapter: new CodexExecAdapter(runner),
      now: fixedNow,
    })

    await service.send({
      projectId: "project-1",
      sessionKey: "s1",
      platform: "local",
      content: "next",
    })

    expect(runner.requests[0]?.args).toEqual([
      "exec",
      "resume",
      "--skip-git-repo-check",
      "thread-1",
      "--json",
      "-",
    ])
  })

  it("does not spawn when permission is denied and records audit", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const guard = createPermissionGuard()
    guard.registerPolicy({
      id: "deny-agent-spawn",
      decide: (request) => request.action === "agent.spawn" ? "deny" : "defer-to-next",
    })
    const auditSink = new InMemoryAuditSink()
    const spawnImpl = vi.fn()
    const runner = createControlledProcessRunner({
      permissionGuard: guard,
      auditSink,
      spawnImpl,
    })
    const service = new AgentRuntimeService({
      projectId: "project-1",
      workDir: "/repo",
      conversations,
      adapter: new CodexExecAdapter(runner),
      now: fixedNow,
    })

    const result = await service.send({
      projectId: "project-1",
      sessionKey: "local:user-1",
      platform: "local",
      content: "hello",
    })

    expect(spawnImpl).not.toHaveBeenCalled()
    expect(result.events).toEqual([
      expect.objectContaining({
        type: "error",
        message: "denied by deny-agent-spawn",
      }),
    ])
    expect(auditSink.list()).toEqual([
      expect.objectContaining({
        action: "agent.spawn",
        outcome: "denied",
        resource: "codex",
      }),
    ])
  })
})

class FakeRunner implements CodexProcessRunner {
  readonly requests: ControlledProcessRunRequest[] = []
  private readonly lines: readonly string[]

  constructor(lines: readonly string[]) {
    this.lines = lines
  }

  async run(request: ControlledProcessRunRequest): Promise<ControlledProcessResult> {
    this.requests.push(request)
    for (const line of this.lines) {
      request.onStdoutLine?.(line)
    }
    return {
      exitCode: 0,
      signal: null,
      stdout: `${this.lines.join("\n")}\n`,
      stderr: "",
      timedOut: false,
      durationMs: 1,
    }
  }
}

class MemoryNamespace<T extends { id: string }> implements DataNamespace<T> {
  readonly schemaVersion = 1
  readonly backend = "json" as const
  readonly name: string
  private readonly values = new Map<string, T>()
  private readonly listeners: DataChangeListener<T>[] = []

  constructor(name: string) {
    this.name = name
  }

  async getSingleton(): Promise<T | null> {
    return null
  }

  async setSingleton(): Promise<void> {}

  async list(filter?: Partial<T>): Promise<T[]> {
    const values = [...this.values.values()]
    if (!filter) return values
    return values.filter((value) =>
      Object.entries(filter).every(([key, expected]) =>
        (value as Record<string, unknown>)[key] === expected,
      ),
    )
  }

  async get(id: string): Promise<T | null> {
    return this.values.get(id) ?? null
  }

  async upsert(item: T): Promise<void> {
    const previous = this.values.get(item.id)
    this.values.set(item.id, item)
    this.emit({
      namespace: this.name,
      kind: "upsert",
      id: item.id,
      value: item,
      previous,
      timestamp: new Date().toISOString(),
    })
  }

  async remove(id: string): Promise<void> {
    const previous = this.values.get(id)
    this.values.delete(id)
    this.emit({
      namespace: this.name,
      kind: "remove",
      id,
      previous,
      timestamp: new Date().toISOString(),
    })
  }

  onChange(listener: DataChangeListener<T>): () => void {
    this.listeners.push(listener)
    return () => {
      const index = this.listeners.indexOf(listener)
      if (index >= 0) this.listeners.splice(index, 1)
    }
  }

  private emit(event: DataChangeEvent<T>): void {
    for (const listener of this.listeners) listener(event)
  }
}

function fixedNow(): Date {
  return new Date("2026-04-26T00:00:00.000Z")
}
