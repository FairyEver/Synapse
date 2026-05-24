import type { AgentEvent, AgentLiveSession, AgentMessage } from "../agent-runtime/types"
import type { KnowledgeBaseIngestWorkerTask } from "./ingest-task-planner"
import { parseKnowledgeBaseWorkerReport, type KnowledgeBaseWorkerReport } from "./ingest-worker-report"

export interface CreateKnowledgeBaseWorkerSessionInput {
  readonly projectId: string
  readonly conversationId: string
  readonly providerId: string
  readonly cwd: string
  readonly env: Record<string, string>
  readonly model?: string
  readonly mode?: string
  readonly targetPage: string
}

export type CreateKnowledgeBaseWorkerSession = (
  input: CreateKnowledgeBaseWorkerSessionInput,
) => AgentLiveSession | Promise<AgentLiveSession>

export type KnowledgeBaseWorkerSessionResult =
  | { readonly status: "completed"; readonly report: KnowledgeBaseWorkerReport; readonly events: readonly AgentEvent[] }
  | {
    readonly status: "failed"
    readonly warnings: readonly { readonly code: string; readonly message: string }[]
    readonly events: readonly AgentEvent[]
  }

export class KnowledgeBaseWorkerSessionRunner {
  constructor(private readonly deps: { readonly createSession: CreateKnowledgeBaseWorkerSession }) {}

  async run(input: {
    readonly projectId: string
    readonly conversationId: string
    readonly providerId: string
    readonly cwd: string
    readonly env: Record<string, string>
    readonly model?: string
    readonly mode?: string
    readonly task: KnowledgeBaseIngestWorkerTask
    readonly userId?: string
  }): Promise<KnowledgeBaseWorkerSessionResult> {
    const session = await this.deps.createSession({
      projectId: input.projectId,
      conversationId: input.conversationId,
      providerId: input.providerId,
      cwd: input.cwd,
      env: input.env,
      model: input.model,
      mode: input.mode,
      targetPage: input.task.targetPage,
    })
    const message: AgentMessage = {
      projectId: input.projectId,
      sessionKey: input.task.taskId,
      platform: "local-renderer",
      userId: input.userId,
      content: workerPrompt(input.task),
    }
    const events: AgentEvent[] = []
    let resultText = ""
    const accepted = await session.send(message)
    if (!accepted) {
      return {
        status: "failed",
        warnings: [{ code: "worker-send-rejected", message: "Worker session rejected message." }],
        events,
      }
    }
    while (session.alive()) {
      const event = await session.nextEvent()
      if (!event) break
      events.push(event)
      if (event.type === "result") {
        resultText = event.content ?? ""
        break
      }
      if (event.type === "error") {
        return { status: "failed", warnings: [{ code: "worker-session-error", message: event.message }], events }
      }
    }
    const parsed = parseKnowledgeBaseWorkerReport(resultText, {
      taskId: input.task.taskId,
      sourcePath: input.task.sourcePath,
      targetPage: input.task.targetPage,
    })
    return parsed.status === "valid"
      ? { status: "completed", report: parsed.report, events }
      : { status: "failed", warnings: parsed.warnings, events }
  }
}

function workerPrompt(task: KnowledgeBaseIngestWorkerTask): string {
  return [
    "Process exactly one Knowledge Base source.",
    `Task id: ${task.taskId}`,
    `Source: ${task.sourcePath}`,
    `Target page: ${task.targetPage}`,
    "Write only the target page. Do not edit shared wiki pages, .raw/.manifest.json, or .vault-meta.",
    "Return exactly one synapse_kb_worker_report fenced JSON block.",
  ].join("\n")
}
