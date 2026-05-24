import type { KnowledgeBaseIngestTurnState } from "./ingest-turn-store"
import { planKnowledgeBaseIngestTasks, type KnowledgeBaseIngestWorkerTask } from "./ingest-task-planner"
import type { KnowledgeBaseWorkerReport } from "./ingest-worker-report"
import type { KnowledgeBaseWorkerSessionResult } from "./ingest-worker-session-runner"
import type { KnowledgeBaseManifest } from "./manifest"

export interface KnowledgeBaseParallelIngestRunnerInput {
  readonly projectId: string
  readonly projectPath: string
  readonly conversationId: string
  readonly turnId: string
  readonly userId?: string
  readonly preflight: KnowledgeBaseIngestTurnState
  readonly manifestSources: KnowledgeBaseManifest["sources"]
}

export type KnowledgeBaseParallelIngestRunnerResult =
  | { readonly status: "merge-ready"; readonly prompt: string; readonly failedSources: readonly string[] }
  | { readonly status: "failed"; readonly message: string; readonly failedSources: readonly string[] }

export type RunKnowledgeBaseIngestWorker = (input: {
  readonly projectId: string
  readonly conversationId: string
  readonly providerId: string
  readonly cwd: string
  readonly env: Record<string, string>
  readonly model?: string
  readonly mode?: string
  readonly task: KnowledgeBaseIngestWorkerTask
  readonly userId?: string
}) => Promise<KnowledgeBaseWorkerSessionResult>

export interface KnowledgeBaseParallelIngestRunnerDeps {
  readonly runWorker: RunKnowledgeBaseIngestWorker
  readonly getProviderEnv: (input: {
    readonly projectId: string
    readonly userId?: string
  }) => Promise<{
    readonly providerId: string
    readonly env: Record<string, string>
    readonly model?: string
    readonly mode?: string
  }>
  readonly concurrency?: number
}

export class KnowledgeBaseParallelIngestRunner {
  private readonly concurrency: number

  constructor(private readonly deps: KnowledgeBaseParallelIngestRunnerDeps) {
    this.concurrency = deps.concurrency ?? 3
  }

  async prepareMergePrompt(
    input: KnowledgeBaseParallelIngestRunnerInput,
  ): Promise<KnowledgeBaseParallelIngestRunnerResult> {
    const provider = await this.deps.getProviderEnv({
      projectId: input.projectId,
      userId: input.userId,
    })
    const tasks = planKnowledgeBaseIngestTasks({
      changedSources: input.preflight.changedSources,
      manifestSources: input.manifestSources,
    })

    const results = await runBounded(tasks, this.concurrency, (task) =>
      this.deps.runWorker({
        projectId: input.projectId,
        conversationId: input.conversationId,
        providerId: provider.providerId,
        cwd: input.projectPath,
        env: provider.env,
        model: provider.model,
        mode: provider.mode,
        task,
        userId: input.userId,
      }),
    )

    const reports = results.flatMap((result) => (result.status === "completed" ? [result.report] : []))
    const failedSources = tasks
      .filter((_task, index) => results[index]?.status !== "completed")
      .map((task) => task.sourcePath)

    if (reports.length === 0) {
      return {
        status: "failed",
        failedSources,
        message: `知识库并行导入未完成：所有 worker 失败。失败来源：${failedSources.join(", ")}`,
      }
    }

    return {
      status: "merge-ready",
      failedSources,
      prompt: buildMergePrompt({ reports, failedSources }),
    }
  }
}

async function runBounded<T, R>(
  items: readonly T[],
  concurrency: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = []
  let index = 0
  const workerCount = Math.min(Math.max(1, concurrency), items.length)
  const workers = Array.from({ length: workerCount }, async () => {
    while (index < items.length) {
      const current = index
      index += 1
      const item = items[current]
      if (item !== undefined) {
        results[current] = await run(item)
      }
    }
  })
  await Promise.all(workers)
  return results
}

function buildMergePrompt(input: {
  readonly reports: readonly KnowledgeBaseWorkerReport[]
  readonly failedSources: readonly string[]
}): string {
  return [
    "Knowledge Base merge coordinator.",
    "Workers already created or updated source-owned pages. Do not reprocess .raw sources from scratch.",
    "Update shared wiki pages exactly once: wiki/concepts, wiki/entities, wiki/questions, wiki/index.md, wiki/hot.md, and wiki/log.md.",
    "Do not edit .raw/.manifest.json, .vault-meta, hashes, ingested_at, or address_map.",
    "Worker reports:",
    JSON.stringify(input.reports, null, 2),
    input.failedSources.length > 0 ? `Failed worker sources: ${input.failedSources.join(", ")}` : "",
    "Finish with exactly one synapse_kb_ingest_report fenced JSON block.",
  ]
    .filter(Boolean)
    .join("\n\n")
}
