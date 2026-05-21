import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { createKnowledgeBaseAgentContribution } from "../../knowledge-base/agent-contribution"

const roots: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-kb-agent-"))
  roots.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("knowledge base Agent contribution", () => {
  it("returns no contribution for ordinary projects", async () => {
    const contribution = await createKnowledgeBaseAgentContribution({
      project: { id: "project-1", name: "Plain", path: "/tmp/plain" },
    })

    expect(contribution).toBeNull()
  })

  it("adds kb commands and hot cache bootstrap for knowledge base projects", async () => {
    const projectPath = await tempDir()
    await mkdir(path.join(projectPath, "wiki"), { recursive: true })
    await writeFile(path.join(projectPath, "wiki", "hot.md"), "# Hot Cache\n\nRecent fact.\n")

    const contribution = await createKnowledgeBaseAgentContribution({
      project: {
        id: "project-1",
        name: "KB",
        path: projectPath,
        capabilities: {
          knowledgeBase: {
            enabled: true,
            schemaVersion: 1,
            templateVersion: "2026-05-21",
          },
        },
      },
    })

    expect(contribution?.commands.map((command) => command.name)).toEqual(["kb"])
    const prepared = await Promise.resolve(contribution?.prepareMessage?.({
      projectId: "project-1",
      sessionKey: "s1",
      platform: "local-renderer",
      content: "What changed?",
    }, { isNewLiveSession: true }))
    const unchanged = await Promise.resolve(contribution?.prepareMessage?.({
      projectId: "project-1",
      sessionKey: "s1",
      platform: "local-renderer",
      content: "What changed?",
    }, { isNewLiveSession: false }))

    expect(prepared?.content).toContain("Recent fact.")
    expect(unchanged?.content).toBe("What changed?")
  })

  it("expands /kb ingest into the internal ingest prompt", async () => {
    const projectPath = await tempDir()
    const contribution = await createKnowledgeBaseAgentContribution({
      project: {
        id: "project-1",
        name: "KB",
        path: projectPath,
        capabilities: {
          knowledgeBase: {
            enabled: true,
            schemaVersion: 1,
            templateVersion: "2026-05-21",
          },
        },
      },
    })

    const command = contribution?.commands[0]
    const prompt = await command?.buildPrompt(["ingest"], {
      projectId: "project-1",
      sessionKey: "s1",
      platform: "local-renderer",
      content: "/kb ingest",
    })

    expect(prompt).toContain("Run Knowledge Base ingest")
  })
})
