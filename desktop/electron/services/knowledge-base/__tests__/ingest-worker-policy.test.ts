import { describe, expect, it } from "vitest"

import { evaluateKnowledgeBaseWorkerToolPolicy } from "../ingest-worker-policy"

describe("evaluateKnowledgeBaseWorkerToolPolicy", () => {
  it("allows worker writes only to the assigned target page", () => {
    expect(evaluateKnowledgeBaseWorkerToolPolicy("Write", {
      file_path: "wiki/sources/a.md",
      content: "# A",
    }, {
      targetPage: "wiki/sources/a.md",
    })).toBeUndefined()
  })

  it("denies manifest, vault metadata, and shared wiki writes", () => {
    const context = { targetPage: "wiki/sources/a.md" }

    expect(evaluateKnowledgeBaseWorkerToolPolicy("Write", { file_path: ".raw/.manifest.json" }, context)).toMatchObject({ behavior: "deny" })
    expect(evaluateKnowledgeBaseWorkerToolPolicy("Edit", { file_path: ".vault-meta/address-counter.txt" }, context)).toMatchObject({ behavior: "deny" })
    expect(evaluateKnowledgeBaseWorkerToolPolicy("MultiEdit", { file_path: "wiki/index.md" }, context)).toMatchObject({ behavior: "deny" })
    expect(evaluateKnowledgeBaseWorkerToolPolicy("Write", { file_path: "wiki/concepts/a.md" }, context)).toMatchObject({ behavior: "deny" })
  })

  it("does not intercept read tools", () => {
    expect(evaluateKnowledgeBaseWorkerToolPolicy("Read", {
      file_path: "wiki/index.md",
    }, {
      targetPage: "wiki/sources/a.md",
    })).toBeUndefined()
  })
})
