import { describe, expect, it } from "vitest"

import { KnowledgeBaseResearchPreflightService, formatKnowledgeBaseResearchAppendix } from "../research-preflight"

describe("KnowledgeBaseResearchPreflightService", () => {
  it("uses an explicit topic without boundary scoring", async () => {
    const service = new KnowledgeBaseResearchPreflightService({
      boundaryService: {
        score: async () => {
          throw new Error("should not score")
        },
      },
    })

    const result = await service.prepare("/kb", "Graph databases")

    expect(result).toEqual({ mode: "explicit-topic", topic: "Graph databases" })
    expect(formatKnowledgeBaseResearchAppendix(result)).toContain("Graph databases")
  })

  it("returns boundary candidates when topic is missing", async () => {
    const result = await new KnowledgeBaseResearchPreflightService({
      boundaryService: {
        score: async () => ({
          generated: "2026-05-24T00:00:00Z",
          halflifeDays: 30,
          pageCountScoreable: 1,
          results: [{
            title: "Alpha",
            titleKey: "Alpha",
            path: "wiki/concepts/Alpha.md",
            outDegree: 3,
            inDegree: 1,
            ageDays: 0,
            recencyWeight: 1,
            score: 2,
          }],
        }),
      },
    }).prepare("/kb", "")

    expect(result).toEqual({
      mode: "boundary-candidates",
      candidates: [{
        title: "Alpha",
        path: "wiki/concepts/Alpha.md",
        score: 2,
        outDegree: 3,
        inDegree: 1,
      }],
    })
    expect(formatKnowledgeBaseResearchAppendix(result)).toContain("Boundary-First")
  })

  it("falls back to asking for a topic when boundary scoring is unavailable", async () => {
    const result = await new KnowledgeBaseResearchPreflightService({
      boundaryService: {
        score: async () => {
          throw new Error("no wiki")
        },
      },
    }).prepare("/kb", "")

    expect(result).toEqual({ mode: "needs-topic", reason: "no wiki" })
  })
})
