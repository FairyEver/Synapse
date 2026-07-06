import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
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
  await mkdir(path.join(root, ".vault-meta"), { recursive: true })
  await mkdir(path.join(root, "wiki", "sources"), { recursive: true })
  await writeFile(path.join(root, ".raw", "source.md"), "# Source\n", "utf8")
  await writeFile(path.join(root, ".vault-meta", "address-counter.txt"), "10\n", "utf8")
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
  it("bounds the preflight source list for large ingest batches", async () => {
    const root = await createKnowledgeBaseRoot()
    for (let index = 0; index < 125; index += 1) {
      await writeFile(path.join(root, ".raw", `batch-${String(index).padStart(3, "0")}.md`), `# Source ${index}\n`, "utf8")
    }
    const coordinator = new KnowledgeBaseIngestCoordinator({ projectId: "kb-1", projectPath: root })

    const prepared = await coordinator.prepareTurn(baseMessage("/wiki-ingest ingest all"), {
      conversationId: "conversation-1",
      isNewLiveSession: true,
      turnId: "turn-1",
    })

    expect(prepared.content).toContain(".raw/batch-000.md")
    expect(prepared.content).not.toContain(".raw/batch-124.md")
    expect(prepared.content).toContain("26 additional changed `.raw/` sources were omitted from this prompt")
  })

  it("does not omit sources only because the preflight path list is long", async () => {
    const root = await createKnowledgeBaseRoot()
    for (let index = 0; index < 80; index += 1) {
      const name = `long-source-${String(index).padStart(3, "0")}-${"segment-".repeat(18)}.md`
      await writeFile(path.join(root, ".raw", name), `# Source ${index}\n`, "utf8")
    }
    const coordinator = new KnowledgeBaseIngestCoordinator({ projectId: "kb-1", projectPath: root })

    const prepared = await coordinator.prepareTurn(baseMessage("/wiki-ingest ingest all"), {
      conversationId: "conversation-1",
      isNewLiveSession: true,
      turnId: "turn-1",
    })

    expect(prepared.content).toContain(".raw/source.md")
    expect(prepared.content).toContain(".raw/long-source-079-")
    expect(prepared.content).not.toContain("additional changed `.raw/` sources were omitted")
  })

  it("includes skipped raw sources in the ingest preflight appendix", async () => {
    const root = await createKnowledgeBaseRoot()
    await writeFile(path.join(root, ".raw", "large.md"), "a".repeat(16 * 1024 * 1024 + 1), "utf8")
    const coordinator = new KnowledgeBaseIngestCoordinator({ projectId: "kb-1", projectPath: root })

    const prepared = await coordinator.prepareTurn(baseMessage("/wiki-ingest ingest all"), {
      conversationId: "conversation-1",
      isNewLiveSession: true,
      turnId: "turn-1",
    })

    expect(prepared.content).toContain("Skipped `.raw/` sources:")
    expect(prepared.content).toContain("  - .raw/large.md (too-large)")
    expect(prepared.content).toContain("Tell the user why these sources were skipped")
  })

  it("ignores reported sources omitted from a bounded preflight batch", async () => {
    const root = await createKnowledgeBaseRoot()
    for (let index = 0; index < 125; index += 1) {
      await writeFile(path.join(root, ".raw", `batch-${String(index).padStart(3, "0")}.md`), `# Source ${index}\n`, "utf8")
    }
    const coordinator = new KnowledgeBaseIngestCoordinator({ projectId: "kb-1", projectPath: root })

    const prepared = await coordinator.prepareTurn(baseMessage("/wiki-ingest ingest all"), {
      conversationId: "conversation-1",
      isNewLiveSession: true,
      turnId: "turn-1",
    })
    await writeFile(path.join(root, "wiki", "sources", "batch-124.md"), "# Batch 124\n", "utf8")

    expect(prepared.content).not.toContain(".raw/batch-124.md")
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
              source: ".raw/batch-124.md",
              pages_created: ["wiki/sources/batch-124.md"],
            }],
          }),
          "```",
        ].join("\n"),
      },
    })

    const result = await readKnowledgeBaseManifest(root)
    expect(result.status).toBe("valid")
    expect(result.manifest.sources).not.toHaveProperty(".raw/batch-124.md")
  })

  it("rejects wiki ingest preflight when the raw manifest is invalid", async () => {
    const root = await createKnowledgeBaseRoot()
    await writeFile(path.join(root, ".raw", ".manifest.json"), "{", "utf8")
    const coordinator = new KnowledgeBaseIngestCoordinator({ projectId: "kb-1", projectPath: root })

    await expect(coordinator.prepareTurn(baseMessage("/wiki-ingest ingest all"), {
      conversationId: "conversation-1",
      isNewLiveSession: true,
      turnId: "turn-1",
    })).rejects.toThrow(".raw/.manifest.json")

    const result = await readKnowledgeBaseManifest(root)
    expect(result.status).toBe("invalid")
  })

  it("finalizes accepted ingest reports through the manifest writer", async () => {
    const root = await createKnowledgeBaseRoot()
    const coordinator = new KnowledgeBaseIngestCoordinator({ projectId: "kb-1", projectPath: root })

    const prepared = await coordinator.prepareTurn(baseMessage("/wiki-ingest ingest all"), {
      conversationId: "conversation-1",
      isNewLiveSession: true,
      turnId: "turn-1",
    })
    await writeFile(path.join(root, "wiki", "sources", "source.md"), [
      "---",
      "address: c-000010",
      "type: source",
      "---",
      "# Source Summary",
      "",
    ].join("\n"), "utf8")
    await writeFile(path.join(root, "wiki", "index.md"), [
      "---",
      "address: c-999999",
      "---",
      "# Index",
      "- [[source]]",
      "",
    ].join("\n"), "utf8")

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
    expect(result.manifest.address_map).toEqual({
      "wiki/existing.md": "c-000001",
      "wiki/sources/source.md": "c-000010",
    })
    expect(result.manifest.address_map).not.toHaveProperty("wiki/index.md")
  })

  it("moves existing address mappings to newly reported page paths", async () => {
    const root = await createKnowledgeBaseRoot()
    await writeKnowledgeBaseManifest(root, {
      version: 1,
      sources: {},
      address_map: {
        "wiki/existing.md": "c-000001",
        "wiki/sources/old.md": "c-000011",
      },
    })
    const coordinator = new KnowledgeBaseIngestCoordinator({ projectId: "kb-1", projectPath: root })

    await coordinator.prepareTurn(baseMessage("/wiki-ingest ingest all"), {
      conversationId: "conversation-1",
      isNewLiveSession: true,
      turnId: "turn-1",
    })
    await writeFile(path.join(root, "wiki", "sources", "renamed.md"), [
      "---",
      "address: c-000011",
      "---",
      "# Renamed",
      "",
    ].join("\n"), "utf8")
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
              source: ".raw/source.md",
              pages_created: ["wiki/sources/renamed.md"],
            }],
          }),
          "```",
        ].join("\n"),
      },
    })

    const result = await readKnowledgeBaseManifest(root)
    expect(result.manifest.address_map).toEqual({
      "wiki/existing.md": "c-000001",
      "wiki/sources/renamed.md": "c-000011",
    })
  })

  it("assigns addresses to newly created ingest pages when the Agent omitted them", async () => {
    const root = await createKnowledgeBaseRoot()
    const coordinator = new KnowledgeBaseIngestCoordinator({ projectId: "kb-1", projectPath: root })

    await coordinator.prepareTurn(baseMessage("/wiki-ingest ingest all"), {
      conversationId: "conversation-1",
      isNewLiveSession: true,
      turnId: "turn-1",
    })
    await writeFile(path.join(root, "wiki", "sources", "source.md"), [
      "---",
      "type: source",
      "---",
      "# Source Summary",
      "",
    ].join("\n"), "utf8")
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
              source: ".raw/source.md",
              pages_created: ["wiki/sources/source.md"],
            }],
          }),
          "```",
        ].join("\n"),
      },
    })

    const page = await readFile(path.join(root, "wiki", "sources", "source.md"), "utf8")
    expect(page).toContain("address: c-000010\n")
    expect(page).toContain("type: source\n")
    await expect(readFile(path.join(root, ".vault-meta", "address-counter.txt"), "utf8"))
      .resolves.toBe("11\n")
    const result = await readKnowledgeBaseManifest(root)
    expect(result.manifest.address_map).toEqual({
      "wiki/existing.md": "c-000001",
      "wiki/sources/source.md": "c-000010",
    })
  })

  it("preserves CRLF frontmatter when assigning omitted addresses", async () => {
    const root = await createKnowledgeBaseRoot()
    const coordinator = new KnowledgeBaseIngestCoordinator({ projectId: "kb-1", projectPath: root })

    await coordinator.prepareTurn(baseMessage("/wiki-ingest ingest all"), {
      conversationId: "conversation-1",
      isNewLiveSession: true,
      turnId: "turn-1",
    })
    await writeFile(path.join(root, "wiki", "sources", "source.md"), [
      "---",
      "type: source",
      "---",
      "# Source Summary",
      "",
    ].join("\r\n"), "utf8")
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
              source: ".raw/source.md",
              pages_created: ["wiki/sources/source.md"],
            }],
          }),
          "```",
        ].join("\n"),
      },
    })

    const page = await readFile(path.join(root, "wiki", "sources", "source.md"), "utf8")
    expect(page.startsWith("---\r\naddress: c-000010\r\ntype: source\r\n---\r\n")).toBe(true)
    expect(page.match(/^---\r?$/gm)).toHaveLength(2)
    const result = await readKnowledgeBaseManifest(root)
    expect(result.manifest.address_map).toEqual({
      "wiki/existing.md": "c-000001",
      "wiki/sources/source.md": "c-000010",
    })
  })

  it("assigns addresses to updated ingest pages when the Agent omitted them", async () => {
    const root = await createKnowledgeBaseRoot()
    const coordinator = new KnowledgeBaseIngestCoordinator({ projectId: "kb-1", projectPath: root })

    await coordinator.prepareTurn(baseMessage("/wiki-ingest ingest all"), {
      conversationId: "conversation-1",
      isNewLiveSession: true,
      turnId: "turn-1",
    })
    await writeFile(path.join(root, "wiki", "sources", "source.md"), [
      "---",
      "type: source",
      "---",
      "# Source Summary",
      "",
    ].join("\n"), "utf8")
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
              source: ".raw/source.md",
              pages_updated: ["wiki/sources/source.md"],
            }],
          }),
          "```",
        ].join("\n"),
      },
    })

    const page = await readFile(path.join(root, "wiki", "sources", "source.md"), "utf8")
    expect(page).toContain("address: c-000010\n")
    expect(page).toContain("type: source\n")
    await expect(readFile(path.join(root, ".vault-meta", "address-counter.txt"), "utf8"))
      .resolves.toBe("11\n")
    const result = await readKnowledgeBaseManifest(root)
    expect(result.manifest.address_map).toEqual({
      "wiki/existing.md": "c-000001",
      "wiki/sources/source.md": "c-000010",
    })
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

  it("skips malformed processed source report entries without throwing", async () => {
    const root = await createKnowledgeBaseRoot()
    const coordinator = new KnowledgeBaseIngestCoordinator({ projectId: "kb-1", projectPath: root })

    await coordinator.prepareTurn(baseMessage("/wiki-ingest ingest all"), {
      conversationId: "conversation-1",
      isNewLiveSession: true,
      turnId: "turn-1",
    })

    await expect(coordinator.finalizeTurn({
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
            processed_sources: [null],
          }),
          "```",
        ].join("\n"),
      },
    })).resolves.toBeUndefined()

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
