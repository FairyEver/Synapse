import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

import { KnowledgeBaseIngestCoordinator } from "../ingest-coordinator"

const roots: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-kb-ingest-coordinator-"))
  roots.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("KnowledgeBaseIngestCoordinator", () => {
  it("prepares ingest prompts with source hashes and report contract", async () => {
    const root = await tempDir()
    await mkdir(path.join(root, ".raw"), { recursive: true })
    await writeFile(path.join(root, ".raw", ".manifest.json"), "{\"version\":1,\"sources\":{},\"address_map\":{}}\n")
    await writeFile(path.join(root, ".raw", "a.md"), "Alpha\n")

    const result = await new KnowledgeBaseIngestCoordinator({
      readPrompt: async () => "INGEST PROMPT",
    }).prepareTurn({
      projectPath: root,
      turnId: "turn-1",
      originalContent: "汲取知识",
      force: false,
    })

    expect(typeof result).not.toBe("string")
    if (typeof result === "string") throw new Error("Expected prompt output.")
    expect(result.kind).toBe("prompt")
    expect(result.content).toContain(".raw/a.md")
    expect(result.content).toContain("synapse_kb_ingest_report")
  })

  it("logs a warning when the ingest report is missing", async () => {
    const warn = vi.fn()
    const coordinator = new KnowledgeBaseIngestCoordinator({
      readPrompt: async () => "INGEST PROMPT",
      logger: { warn },
    })
    await coordinator.store.set("turn-1", {
      projectPath: "/tmp/kb",
      generatedAt: "2026-05-24T00:00:00.000Z",
      force: false,
      changedSources: [{ relativePath: ".raw/a.md", hash: "hash-a", state: "new" }],
      skippedSources: [],
      wikiBefore: { files: {} },
    })

    await coordinator.finalizeTurn({
      projectPath: "/tmp/kb",
      conversationId: "conv-1",
      turnId: "turn-1",
      assistantText: "done without report",
    })

    expect(warn).toHaveBeenCalledWith("Knowledge Base ingest report was not finalized.", expect.objectContaining({
      boundary: "knowledge-base.ingest-finalizer",
      warningCodes: ["report-missing"],
    }))
  })

  it("keeps a recoverable pending ingest when the final report is missing", async () => {
    const coordinator = await coordinatorWithPreflight("turn-1")

    await coordinator.finalizeTurn({
      projectPath: "/tmp/kb",
      conversationId: "conv-1",
      turnId: "turn-1",
      assistantText: "done without report",
    })

    expect(await coordinator.store.getPendingRecovery("turn-1")).toMatchObject({
      projectPath: "/tmp/kb",
      conversationId: "conv-1",
      turnId: "turn-1",
      warningCodes: ["report-missing"],
      assistantText: "done without report",
    })
  })

  it("formats duplicate report warnings with user-facing copy", async () => {
    const coordinator = await coordinatorWithPreflight("turn-1")
    const block = "```synapse_kb_ingest_report\n{\"schema\":\"synapse.kb.ingest.report.v1\",\"processed_sources\":[]}\n```"

    const result = await coordinator.finalizeTurn({
      projectPath: "/tmp/kb",
      conversationId: "conv-1",
      turnId: "turn-1",
      assistantText: `${block}\n${block}`,
    })

    expect(result.message).toContain("检测到多个 synapse_kb_ingest_report")
  })

  it("formats invalid report JSON warnings with user-facing copy", async () => {
    const coordinator = await coordinatorWithPreflight("turn-1")

    const result = await coordinator.finalizeTurn({
      projectPath: "/tmp/kb",
      conversationId: "conv-1",
      turnId: "turn-1",
      assistantText: "```synapse_kb_ingest_report\n{ bad json\n```",
    })

    expect(result.message).toContain("synapse_kb_ingest_report 不是有效 JSON")
  })

  it("formats report schema warnings with user-facing copy", async () => {
    const coordinator = await coordinatorWithPreflight("turn-1")

    const result = await coordinator.finalizeTurn({
      projectPath: "/tmp/kb",
      conversationId: "conv-1",
      turnId: "turn-1",
      assistantText: "```synapse_kb_ingest_report\n{\"schema\":\"bad\",\"processed_sources\":[]}\n```",
    })

    expect(result.message).toContain("synapse_kb_ingest_report schema 不匹配")
  })
})

async function coordinatorWithPreflight(turnId: string): Promise<KnowledgeBaseIngestCoordinator> {
  const coordinator = new KnowledgeBaseIngestCoordinator({
    readPrompt: async () => "INGEST PROMPT",
  })
  await coordinator.store.set(turnId, {
    projectPath: "/tmp/kb",
    generatedAt: "2026-05-24T00:00:00.000Z",
    force: false,
    changedSources: [{ relativePath: ".raw/a.md", hash: "hash-a", state: "new" }],
    skippedSources: [],
    wikiBefore: { files: {} },
  })
  return coordinator
}
