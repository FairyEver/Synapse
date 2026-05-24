import { describe, expect, it } from "vitest"

import { parseKnowledgeBaseResearchReport } from "../research-report"

describe("parseKnowledgeBaseResearchReport", () => {
  it("parses one valid research report", () => {
    const result = parseKnowledgeBaseResearchReport([
      "Done.",
      "```synapse_kb_research_report",
      JSON.stringify({
        schema: "synapse.kb.research.report.v1",
        topic: "Graph databases",
        rounds: 2,
        searches: 8,
        pages_created: ["wiki/questions/Research - Graph databases.md"],
        pages_updated: ["wiki/index.md", "wiki/hot.md", "wiki/log.md"],
        sources: ["wiki/sources/Example.md"],
      }),
      "```",
    ].join("\n"))

    expect(result.status).toBe("valid")
    if (result.status !== "valid") throw new Error("expected valid")
    expect(result.report.topic).toBe("Graph databases")
  })

  it("rejects missing reports", () => {
    expect(parseKnowledgeBaseResearchReport("plain text").status).toBe("invalid")
  })
})
