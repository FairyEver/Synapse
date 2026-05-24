import { describe, expect, it } from "vitest"

import { parseKnowledgeBaseIngestReport } from "../ingest-report"

describe("parseKnowledgeBaseIngestReport", () => {
  it("parses one valid ingest report block with camelCase fields", () => {
    const result = parseKnowledgeBaseIngestReport([
      "Agent summary",
      "```json synapse_kb_ingest_report",
      JSON.stringify({
        schema: "synapse.kb.ingest.report.v1",
        processed_sources: [{
          source: ".raw/documents/a.md",
          pages_created: ["wiki/sources/a.md"],
          pages_updated: ["wiki/index.md"],
        }],
        skipped_sources: [{
          source: ".raw/documents/b.md",
          reason: "unsupported format",
        }],
      }),
      "```",
    ].join("\n"))

    expect(result).toEqual({
      ok: true,
      schema: "synapse.kb.ingest.report.v1",
      processedSources: [{
        source: ".raw/documents/a.md",
        pagesCreated: ["wiki/sources/a.md"],
        pagesUpdated: ["wiki/index.md"],
      }],
      skippedSources: [{
        source: ".raw/documents/b.md",
        reason: "unsupported format",
      }],
      warnings: [],
    })
  })

  it("fails closed when multiple report blocks are present", () => {
    const block = [
      "```json synapse_kb_ingest_report",
      "{\"schema\":\"synapse.kb.ingest.report.v1\",\"processed_sources\":[],\"skipped_sources\":[]}",
      "```",
    ].join("\n")

    expect(parseKnowledgeBaseIngestReport(`${block}\n${block}`)).toMatchObject({
      ok: false,
      code: "multiple-reports",
    })
  })

  it("fails closed when the report block is missing", () => {
    expect(parseKnowledgeBaseIngestReport("No structured report here.")).toMatchObject({
      ok: false,
      code: "missing-report",
    })
  })

  it("fails closed when report JSON is invalid", () => {
    const result = parseKnowledgeBaseIngestReport([
      "```json synapse_kb_ingest_report",
      "{ bad json",
      "```",
    ].join("\n"))

    expect(result).toMatchObject({
      ok: false,
      code: "invalid-json",
    })
  })

  it("fails closed when the schema is invalid", () => {
    const result = parseKnowledgeBaseIngestReport([
      "```json synapse_kb_ingest_report",
      "{\"schema\":\"synapse.kb.ingest.report.v0\",\"processed_sources\":[],\"skipped_sources\":[]}",
      "```",
    ].join("\n"))

    expect(result).toMatchObject({
      ok: false,
      code: "invalid-schema",
    })
  })

  it("filters malformed entries from report arrays", () => {
    const result = parseKnowledgeBaseIngestReport([
      "```json synapse_kb_ingest_report",
      JSON.stringify({
        schema: "synapse.kb.ingest.report.v1",
        processed_sources: [
          null,
          { source: 12, pages_created: ["wiki/bad.md"], pages_updated: [] },
          {
            source: ".raw/documents/a.md",
            pages_created: ["wiki/sources/a.md", 12, ""],
            pages_updated: ["wiki/index.md", false],
          },
        ],
        skipped_sources: [
          { source: ".raw/documents/missing-reason.md" },
          { source: ".raw/documents/b.md", reason: "ignored" },
          { source: "", reason: "blank source" },
        ],
      }),
      "```",
    ].join("\n"))

    expect(result).toEqual({
      ok: true,
      schema: "synapse.kb.ingest.report.v1",
      processedSources: [{
        source: ".raw/documents/a.md",
        pagesCreated: ["wiki/sources/a.md"],
        pagesUpdated: ["wiki/index.md"],
      }],
      skippedSources: [{
        source: ".raw/documents/b.md",
        reason: "ignored",
      }],
      warnings: [],
    })
  })
})
