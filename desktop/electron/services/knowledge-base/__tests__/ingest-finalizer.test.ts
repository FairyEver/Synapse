import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { KnowledgeBaseIngestCoordinator } from "../ingest-finalizer"
import { readKnowledgeBaseManifest, writeKnowledgeBaseManifest } from "../manifest"

const roots: string[] = []

async function createKnowledgeBaseRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "synapse-kb-ingest-finalizer-"))
  roots.push(root)
  await mkdir(path.join(root, ".raw"), { recursive: true })
  await mkdir(path.join(root, "wiki", "sources"), { recursive: true })
  await writeFile(path.join(root, ".raw", "source.md"), "# Source\n", "utf8")
  await writeFile(path.join(root, "wiki", "index.md"), "# Index\n", "utf8")
  await writeKnowledgeBaseManifest(root, {
    version: 1,
    sources: {},
    address_map: { "wiki/existing.md": "c-000001" },
  })
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("KnowledgeBaseIngestCoordinator", () => {
  it("finalizes accepted ingest reports through the manifest writer", async () => {
    const root = await createKnowledgeBaseRoot()
    const coordinator = new KnowledgeBaseIngestCoordinator({ projectId: "kb-1", projectPath: root })

    const prepared = await coordinator.prepareTurn(baseMessage("/wiki-ingest ingest all"), {
      conversationId: "conversation-1",
      isNewLiveSession: true,
      turnId: "turn-1",
    })
    await writeFile(path.join(root, "wiki", "sources", "source.md"), "# Source Summary\n", "utf8")
    await writeFile(path.join(root, "wiki", "index.md"), "# Index\n- [[source]]\n", "utf8")

    expect(prepared.content).toContain("Do not edit `.raw/.manifest.json`")
    await coordinator.finalizeTurn({
      message: baseMessage("/wiki-ingest ingest all"),
      conversationId: "conversation-1",
      isNewLiveSession: true,
      turnId: "turn-1",
      result: {
        conversationId: "conversation-1",
        events: [],
        resultText: [
          "done",
          "```synapse_kb_ingest_report",
          JSON.stringify({
            schema: "synapse.kb.ingest.report.v1",
            processed_sources: [{
              source: ".raw/source.md",
              pages_created: ["wiki/sources/source.md"],
              pages_updated: ["wiki/index.md"],
            }],
          }),
          "```",
        ].join("\n"),
      },
    })

    const result = await readKnowledgeBaseManifest(root)
    expect(result.status).toBe("valid")
    expect(result.manifest.sources[".raw/source.md"]).toEqual(expect.objectContaining({
      hash: expect.any(String),
      ingested_at: expect.any(String),
      pages_created: ["wiki/sources/source.md"],
      pages_updated: ["wiki/index.md"],
    }))
    expect(result.manifest.address_map).toEqual({ "wiki/existing.md": "c-000001" })
  })

  it("ignores processed sources that were not in preflight", async () => {
    const root = await createKnowledgeBaseRoot()
    const coordinator = new KnowledgeBaseIngestCoordinator({ projectId: "kb-1", projectPath: root })

    await coordinator.prepareTurn(baseMessage("/wiki-ingest ingest all"), {
      conversationId: "conversation-1",
      isNewLiveSession: true,
      turnId: "turn-1",
    })
    await writeFile(path.join(root, "wiki", "sources", "source.md"), "# Source Summary\n", "utf8")
    await coordinator.finalizeTurn({
      message: baseMessage("/wiki-ingest ingest all"),
      conversationId: "conversation-1",
      isNewLiveSession: true,
      turnId: "turn-1",
      result: {
        conversationId: "conversation-1",
        events: [],
        resultText: [
          "```synapse_kb_ingest_report",
          JSON.stringify({
            schema: "synapse.kb.ingest.report.v1",
            processed_sources: [{
              source: ".raw/missing.md",
              pages_created: ["wiki/sources/source.md"],
            }],
          }),
          "```",
        ].join("\n"),
      },
    })

    const result = await readKnowledgeBaseManifest(root)
    expect(result.manifest.sources).toEqual({})
  })
})

function baseMessage(content: string) {
  return {
    projectId: "kb-1",
    sessionKey: "s1",
    platform: "local-renderer" as const,
    userId: "user-1",
    content,
  }
}
