import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { KnowledgeBaseIngestCoordinator } from "../ingest-coordinator"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("KnowledgeBaseIngestCoordinator image intake", () => {
  it("adds image intake instructions when changed sources include image records", async () => {
    const root = await makeImageVault()
    const coordinator = new KnowledgeBaseIngestCoordinator({
      readPrompt: async () => "执行知识库导入。",
    })

    const output = await coordinator.prepareTurn({
      projectPath: root,
      turnId: "turn-1",
      originalContent: "/wiki ingest",
      force: false,
    })

    expect(typeof output).toBe("object")
    if (typeof output === "string" || output.kind !== "prompt") throw new Error("expected prompt")
    expect(output.content).toContain("Image Intake Sources")
    expect(output.content).toContain("_attachments/images/2026/05/24/diagram.png")
    expect(output.content).toContain("Do not edit `.raw/images/")
  })
})

async function makeImageVault(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "synapse-kb-image-ingest-"))
  roots.push(root)
  await mkdir(path.join(root, ".raw/images/2026/05/24"), { recursive: true })
  await mkdir(path.join(root, "_attachments/images/2026/05/24"), { recursive: true })
  await mkdir(path.join(root, "wiki"), { recursive: true })
  await writeFile(path.join(root, ".raw/.manifest.json"), JSON.stringify({ version: 1, sources: {}, address_map: {} }))
  await writeFile(path.join(root, "wiki/index.md"), "# Index\n")
  await writeFile(path.join(root, "wiki/hot.md"), "# Hot\n")
  await writeFile(path.join(root, "wiki/log.md"), "# Log\n")
  await writeFile(path.join(root, "_attachments/images/2026/05/24/diagram.png"), Buffer.from([0x89, 0x50]))
  await writeFile(path.join(root, ".raw/images/2026/05/24/diagram.md"), [
    "---",
    "source_type: image",
    "attachment: _attachments/images/2026/05/24/diagram.png",
    "source_format: png",
    "---",
    "",
    "# Image Intake: diagram",
    "",
  ].join("\n"))
  return root
}
