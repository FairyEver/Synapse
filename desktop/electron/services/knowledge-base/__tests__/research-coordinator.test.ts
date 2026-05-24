import { describe, expect, it, vi } from "vitest"

import { KnowledgeBaseResearchCoordinator } from "../research-coordinator"

describe("KnowledgeBaseResearchCoordinator", () => {
  it("builds an explicit-topic research prompt with report contract", async () => {
    const coordinator = new KnowledgeBaseResearchCoordinator({
      readPrompt: async () => "执行知识库研究入库。",
      researchPreflight: {
        prepare: async () => ({ mode: "explicit-topic", topic: "Graph databases" }),
      },
    })

    const output = await coordinator.prepareTurn({
      projectPath: "/vault",
      args: ["Graph", "databases"],
    })

    if (typeof output === "string" || output.kind !== "prompt") throw new Error("expected prompt")
    expect(output.kind).toBe("prompt")
    expect(output.content).toContain("Graph databases")
    expect(output.content).toContain("synapse_kb_research_report")
    expect(output.content).toContain("Max rounds: 3")
  })

  it("finalizes only when the report is valid", async () => {
    const finalize = vi.fn(async () => ({
      assigned: [],
      reused: [],
      addressMap: {},
      skippedReason: undefined,
    }))
    const coordinator = new KnowledgeBaseResearchCoordinator({
      readPrompt: async () => "",
      addressFinalizer: { finalize },
    })

    const result = await coordinator.finalizeTurn({
      projectPath: "/vault",
      assistantText: [
        "```synapse_kb_research_report",
        JSON.stringify({
          schema: "synapse.kb.research.report.v1",
          topic: "Graph databases",
          rounds: 1,
          searches: 2,
          pages_created: ["wiki/questions/Research - Graph databases.md"],
          pages_updated: ["wiki/index.md", "wiki/hot.md", "wiki/log.md"],
          sources: ["wiki/sources/Example.md"],
        }),
        "```",
      ].join("\n"),
    })

    expect(result.status).toBe("finalized")
    expect(finalize).toHaveBeenCalledWith("/vault")
  })
})
