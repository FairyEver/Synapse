import { describe, expect, it } from "vitest"

import { parseKnowledgeBaseIngestReport } from "../ingest-report"

describe("parseKnowledgeBaseIngestReport", () => {
  it("parses the fenced report contract", () => {
    const text = [
      "done",
      "```synapse_kb_ingest_report",
      JSON.stringify({
        schema: "synapse.kb.ingest.report.v1",
        processed_sources: [{
          source: ".raw/a.md",
          pages_created: ["wiki/sources/a.md"],
          pages_updated: ["wiki/index.md"],
        }],
        skipped_sources: [{ source: ".raw/b.md", reason: "unchanged" }],
      }, null, 2),
      "```",
    ].join("\n")

    expect(parseKnowledgeBaseIngestReport(text)).toMatchObject({
      status: "valid",
      report: {
        processedSources: [{
          source: ".raw/a.md",
          pagesCreated: ["wiki/sources/a.md"],
          pagesUpdated: ["wiki/index.md"],
        }],
      },
    })
  })

  it("parses reports with a json info string before the schema marker", () => {
    const text = [
      "```json synapse_kb_ingest_report",
      JSON.stringify({
        schema: "synapse.kb.ingest.report.v1",
        processed_sources: [{ source: ".raw/a.md", pages_created: [], pages_updated: [] }],
      }),
      "```",
    ].join("\n")

    expect(parseKnowledgeBaseIngestReport(text)).toMatchObject({
      status: "valid",
      report: {
        processedSources: [{ source: ".raw/a.md" }],
      },
    })
  })

  it("rejects missing and duplicate reports", () => {
    expect(parseKnowledgeBaseIngestReport("done")).toEqual({
      status: "missing",
      warnings: [{ code: "report-missing", message: "Missing synapse_kb_ingest_report block." }],
    })

    const block = "```synapse_kb_ingest_report\n{\"schema\":\"synapse.kb.ingest.report.v1\",\"processed_sources\":[]}\n```"
    expect(parseKnowledgeBaseIngestReport(`${block}\n${block}`)).toMatchObject({
      status: "invalid",
      warnings: [{ code: "report-multiple" }],
    })
  })
})
