import { describe, expect, it } from "vitest"

import { planKnowledgeBaseIngestTasks } from "../ingest-task-planner"

describe("planKnowledgeBaseIngestTasks", () => {
  it("assigns one stable source target per changed source", () => {
    const tasks = planKnowledgeBaseIngestTasks({
      changedSources: [
        { relativePath: ".raw/articles/Alpha Note.md", hash: "a".repeat(64), state: "new" },
        { relativePath: ".raw/transcripts/Alpha Note.md", hash: "b".repeat(64), state: "new" },
      ],
      manifestSources: {},
    })

    expect(tasks).toHaveLength(2)
    expect(tasks[0]).toMatchObject({
      taskId: "kb-ingest-worker-0001",
      sourcePath: ".raw/articles/Alpha Note.md",
      sourceHash: "a".repeat(64),
      targetPage: "wiki/sources/articles-alpha-note.md",
    })
    expect(tasks[1]?.targetPage).toBe("wiki/sources/transcripts-alpha-note.md")
  })

  it("reuses an existing source page from manifest history", () => {
    const tasks = planKnowledgeBaseIngestTasks({
      changedSources: [
        { relativePath: ".raw/a.md", hash: "a".repeat(64), state: "changed" },
      ],
      manifestSources: {
        ".raw/a.md": {
          hash: "old",
          ingested_at: "2026-05-24T00:00:00.000Z",
          pages_created: ["wiki/sources/custom-a.md"],
          pages_updated: ["wiki/index.md"],
        },
      },
    })

    expect(tasks[0]?.targetPage).toBe("wiki/sources/custom-a.md")
  })
})
