import { describe, expect, it, vi } from "vitest"

import type { AgentEvent, AgentLiveSession, AgentMessage } from "../../agent-runtime/types"
import { KNOWLEDGE_BASE_WORKER_REPORT_SCHEMA } from "../ingest-worker-report"
import { KnowledgeBaseWorkerSessionRunner } from "../ingest-worker-session-runner"

class FakeWorkerSession implements AgentLiveSession {
  readonly agentType = "claude-sdk"
  readonly sent: string[] = []
  private events: AgentEvent[]

  constructor(resultText: string) {
    this.events = [{ type: "result", content: resultText, done: true }]
  }

  async send(message: AgentMessage): Promise<boolean> {
    this.sent.push(message.content)
    return true
  }
  async respondPermission(): Promise<void> {}
  async nextEvent(): Promise<AgentEvent | null> { return this.events.shift() ?? null }
  currentSessionId(): string | undefined { return "worker-sdk-1" }
  alive(): boolean { return this.events.length > 0 }
  async close(): Promise<void> {}
}

describe("KnowledgeBaseWorkerSessionRunner", () => {
  it("sends a scoped worker prompt and parses the worker report", async () => {
    const resultText = [
      "```synapse_kb_worker_report",
      JSON.stringify({
        schema: KNOWLEDGE_BASE_WORKER_REPORT_SCHEMA,
        task_id: "kb-ingest-worker-0001",
        source: ".raw/a.md",
        target_page: "wiki/sources/a.md",
        pages_created: ["wiki/sources/a.md"],
        pages_updated: [],
        candidate_concepts: [],
        candidate_entities: [],
        candidate_questions: [],
        skipped: null,
      }),
      "```",
    ].join("\n")
    const session = new FakeWorkerSession(resultText)
    const createSession = vi.fn(() => session)
    const runner = new KnowledgeBaseWorkerSessionRunner({ createSession })

    const result = await runner.run({
      projectId: "project-1",
      conversationId: "conv-1",
      providerId: "anthropic",
      cwd: "/vault",
      env: {},
      task: {
        taskId: "kb-ingest-worker-0001",
        sourcePath: ".raw/a.md",
        sourceHash: "a".repeat(64),
        targetPage: "wiki/sources/a.md",
        mode: "create-or-update-source-page",
      },
      userId: "user-1",
    })

    expect(result.status).toBe("completed")
    if (result.status !== "completed") throw new Error("expected completed worker result")
    expect(result.report).toMatchObject({ source: ".raw/a.md", targetPage: "wiki/sources/a.md" })
    expect(session.sent[0]).toContain("Process exactly one Knowledge Base source")
    expect(session.sent[0]).toContain(".raw/a.md")
    expect(session.sent[0]).toContain("wiki/sources/a.md")
    expect(createSession).toHaveBeenCalledWith(expect.objectContaining({
      cwd: "/vault",
      providerId: "anthropic",
      targetPage: "wiki/sources/a.md",
    }))
  })
})
