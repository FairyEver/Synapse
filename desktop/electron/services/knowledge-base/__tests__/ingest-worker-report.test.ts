import { describe, expect, it } from "vitest"

import {
  KNOWLEDGE_BASE_WORKER_REPORT_SCHEMA,
  parseKnowledgeBaseWorkerReport,
} from "../ingest-worker-report"

const validBlock = [
  "```synapse_kb_worker_report",
  JSON.stringify({
    schema: KNOWLEDGE_BASE_WORKER_REPORT_SCHEMA,
    task_id: "task-1",
    source: ".raw/a.md",
    target_page: "wiki/sources/a.md",
    pages_created: ["wiki/sources/a.md"],
    pages_updated: [],
    candidate_concepts: ["Concept A"],
    candidate_entities: [],
    candidate_questions: [],
    skipped: null,
  }),
  "```",
].join("\n")

describe("parseKnowledgeBaseWorkerReport", () => {
  it("parses one valid worker report", () => {
    expect(parseKnowledgeBaseWorkerReport(validBlock, {
      taskId: "task-1",
      sourcePath: ".raw/a.md",
      targetPage: "wiki/sources/a.md",
    })).toMatchObject({
      status: "valid",
      report: {
        taskId: "task-1",
        source: ".raw/a.md",
        targetPage: "wiki/sources/a.md",
        pagesCreated: ["wiki/sources/a.md"],
        pagesUpdated: [],
      },
    })
  })

  it("rejects missing and multiple worker report blocks", () => {
    expect(parseKnowledgeBaseWorkerReport("done", {
      taskId: "task-1",
      sourcePath: ".raw/a.md",
      targetPage: "wiki/sources/a.md",
    })).toMatchObject({ status: "missing", warnings: [{ code: "worker-report-missing" }] })

    expect(parseKnowledgeBaseWorkerReport(`${validBlock}\n${validBlock}`, {
      taskId: "task-1",
      sourcePath: ".raw/a.md",
      targetPage: "wiki/sources/a.md",
    })).toMatchObject({ status: "invalid", warnings: [{ code: "worker-report-multiple" }] })
  })

  it("rejects schema, task, source, target, and page ownership mismatches", () => {
    const report = {
      schema: KNOWLEDGE_BASE_WORKER_REPORT_SCHEMA,
      task_id: "task-2",
      source: ".raw/b.md",
      target_page: "wiki/sources/b.md",
      pages_created: ["wiki/index.md"],
      pages_updated: [],
      candidate_concepts: [],
      candidate_entities: [],
      candidate_questions: [],
      skipped: null,
    }
    const block = `\`\`\`synapse_kb_worker_report\n${JSON.stringify(report)}\n\`\`\``

    expect(parseKnowledgeBaseWorkerReport(block, {
      taskId: "task-1",
      sourcePath: ".raw/a.md",
      targetPage: "wiki/sources/a.md",
    })).toMatchObject({
      status: "invalid",
      warnings: expect.arrayContaining([
        { code: "worker-report-task-mismatch", message: expect.any(String) },
        { code: "worker-report-source-mismatch", message: expect.any(String) },
        { code: "worker-report-target-mismatch", message: expect.any(String) },
        { code: "worker-report-page-outside-target", message: expect.any(String) },
      ]),
    })
  })
})
