import { describe, expect, it, vi } from "vitest"

import { KnowledgeBaseParallelIngestRunner } from "../parallel-ingest-runner"

describe("KnowledgeBaseParallelIngestRunner", () => {
  it("runs workers and builds one merge prompt from accepted reports", async () => {
    const runWorker = vi.fn(async (input: { task: { sourcePath: string; targetPage: string } }) => ({
      status: "completed" as const,
      events: [],
      report: {
        taskId: "task",
        source: input.task.sourcePath,
        targetPage: input.task.targetPage,
        pagesCreated: [input.task.targetPage],
        pagesUpdated: [],
        candidateConcepts: ["Concept A"],
        candidateEntities: [],
        candidateQuestions: [],
        skipped: null,
      },
    }))
    const runner = new KnowledgeBaseParallelIngestRunner({
      runWorker,
      getProviderEnv: async () => ({ providerId: "anthropic", env: {} }),
    })

    const result = await runner.prepareMergePrompt({
      projectId: "project-1",
      projectPath: "/vault",
      conversationId: "conv-1",
      turnId: "turn-1",
      userId: "user-1",
      preflight: {
        projectPath: "/vault",
        generatedAt: "2026-05-24T00:00:00.000Z",
        force: false,
        changedSources: [
          { relativePath: ".raw/a.md", hash: "a".repeat(64), state: "new" },
          { relativePath: ".raw/b.md", hash: "b".repeat(64), state: "new" },
        ],
        skippedSources: [],
        wikiBefore: { files: {} },
      },
      manifestSources: {},
    })

    expect(result.status).toBe("merge-ready")
    if (result.status !== "merge-ready") throw new Error("expected merge-ready result")
    expect(runWorker).toHaveBeenCalledTimes(2)
    expect(result.prompt).toContain("Knowledge Base merge coordinator")
    expect(result.prompt).toContain("wiki/sources/a.md")
    expect(result.prompt).toContain("Concept A")
  })

  it("skips merge when every worker fails", async () => {
    const runner = new KnowledgeBaseParallelIngestRunner({
      runWorker: async () => ({
        status: "failed" as const,
        warnings: [{ code: "worker-report-missing", message: "Missing" }],
        events: [],
      }),
      getProviderEnv: async () => ({ providerId: "anthropic", env: {} }),
    })

    const result = await runner.prepareMergePrompt({
      projectId: "project-1",
      projectPath: "/vault",
      conversationId: "conv-1",
      turnId: "turn-1",
      userId: "user-1",
      preflight: {
        projectPath: "/vault",
        generatedAt: "2026-05-24T00:00:00.000Z",
        force: false,
        changedSources: [{ relativePath: ".raw/a.md", hash: "a".repeat(64), state: "new" }],
        skippedSources: [],
        wikiBefore: { files: {} },
      },
      manifestSources: {},
    })

    expect(result).toMatchObject({
      status: "failed",
      message: expect.stringContaining(".raw/a.md"),
    })
  })

  it("continues the merge when one worker throws", async () => {
    const runner = new KnowledgeBaseParallelIngestRunner({
      runWorker: async (input) => {
        if (input.task.sourcePath === ".raw/b.md") {
          throw new Error("worker crashed")
        }
        return {
          status: "completed" as const,
          events: [],
          report: {
            taskId: input.task.taskId,
            source: input.task.sourcePath,
            targetPage: input.task.targetPage,
            pagesCreated: [input.task.targetPage],
            pagesUpdated: [],
            candidateConcepts: [],
            candidateEntities: [],
            candidateQuestions: [],
            skipped: null,
          },
        }
      },
      getProviderEnv: async () => ({ providerId: "anthropic", env: {} }),
    })

    const result = await runner.prepareMergePrompt({
      projectId: "project-1",
      projectPath: "/vault",
      conversationId: "conv-1",
      turnId: "turn-1",
      userId: "user-1",
      preflight: {
        projectPath: "/vault",
        generatedAt: "2026-05-24T00:00:00.000Z",
        force: false,
        changedSources: [
          { relativePath: ".raw/a.md", hash: "a".repeat(64), state: "new" },
          { relativePath: ".raw/b.md", hash: "b".repeat(64), state: "new" },
        ],
        skippedSources: [],
        wikiBefore: { files: {} },
      },
      manifestSources: {},
    })

    expect(result).toMatchObject({
      status: "merge-ready",
      failedSources: [".raw/b.md"],
    })
    if (result.status !== "merge-ready") throw new Error("expected merge-ready result")
    expect(result.prompt).toContain("wiki/sources/a.md")
    expect(result.prompt).toContain("Failed worker sources: .raw/b.md")
  })
})
