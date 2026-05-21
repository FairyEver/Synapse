import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import type { RegisteredPromptCommandOutput } from "../../agent-runtime/command-router"
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
    const projectPath = await tempDir()
    const contribution = await createKnowledgeBaseAgentContribution({
      project: { id: "project-1", name: "Plain", path: projectPath },
    })

    expect(contribution).toBeNull()
  })

  it("adds wiki commands for projects with a knowledge base marker", async () => {
    const projectPath = await tempDir()
    await writeFile(path.join(projectPath, ".synapse-kb.json"), `${JSON.stringify({
      type: "synapse.knowledgeBase",
      schemaVersion: 1,
      templateVersion: "2026-05-21",
    })}\n`)

    const contribution = await createKnowledgeBaseAgentContribution({
      project: { id: "project-1", name: "KB", path: projectPath },
    })

    expect(contribution?.commands.map((command) => command.name)).toEqual(["wiki"])
  })

  it("adds wiki commands and hot cache bootstrap for knowledge base projects", async () => {
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

    expect(contribution?.commands.map((command) => command.name)).toEqual(["wiki"])
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
    expect(prepared?.content).toContain("Do not guess a file path from a wikilink title.")
    expect(unchanged?.content).toBe("What changed?")
  })

  it("reads wiki hot cache fresh for each new live session", async () => {
    const projectPath = await tempDir()
    await mkdir(path.join(projectPath, "wiki"), { recursive: true })
    const hotCachePath = path.join(projectPath, "wiki", "hot.md")
    await writeFile(hotCachePath, "# Hot Cache\n\nOld fact.\n")
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

    const first = await Promise.resolve(contribution?.prepareMessage?.({
      projectId: "project-1",
      sessionKey: "s1",
      platform: "local-renderer",
      content: "What changed?",
    }, { isNewLiveSession: true }))
    await writeFile(hotCachePath, "# Hot Cache\n\nNew fact.\n")
    const second = await Promise.resolve(contribution?.prepareMessage?.({
      projectId: "project-1",
      sessionKey: "s2",
      platform: "local-renderer",
      content: "What changed?",
    }, { isNewLiveSession: true }))
    const reused = await Promise.resolve(contribution?.prepareMessage?.({
      projectId: "project-1",
      sessionKey: "s2",
      platform: "local-renderer",
      content: "What changed?",
    }, { isNewLiveSession: false }))

    expect(first?.content).toContain("Old fact.")
    expect(second?.content).toContain("New fact.")
    expect(second?.content).not.toContain("Old fact.")
    expect(reused?.content).toBe("What changed?")
  })

  it("does not swallow non-missing hot cache read errors", async () => {
    const projectPath = await tempDir()
    await mkdir(path.join(projectPath, "wiki", "hot.md"), { recursive: true })
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

    await expect(Promise.resolve(contribution?.prepareMessage?.({
      projectId: "project-1",
      sessionKey: "s1",
      platform: "local-renderer",
      content: "What changed?",
    }, { isNewLiveSession: true }))).rejects.toMatchObject({ code: "EISDIR" })
  })

  it("expands /wiki ingest into the internal ingest prompt", async () => {
    const projectPath = await tempDir()
    await mkdir(path.join(projectPath, ".raw"), { recursive: true })
    await writeFile(path.join(projectPath, ".raw", "note.md"), "alpha\n")
    const contribution = await createKnowledgeBaseAgentContribution({
      project: knowledgeBaseProject(projectPath),
    })

    const command = contribution?.commands[0]
    const output = await command?.buildPrompt(["ingest"], baseMessage("/wiki ingest"))

    expect(expectObjectOutput(output, "prompt")).toContain("Run Knowledge Base ingest")
  })

  it("returns a direct /wiki status result", async () => {
    const projectPath = await tempDir()
    await mkdir(path.join(projectPath, ".raw"), { recursive: true })
    await writeFile(path.join(projectPath, ".raw", ".manifest.json"), "{\"version\":1,\"sources\":{}}\n")
    await writeFile(path.join(projectPath, ".raw", "note.md"), "alpha\n")
    const contribution = await createKnowledgeBaseAgentContribution({
      project: knowledgeBaseProject(projectPath),
    })

    const output = await contribution?.commands[0]?.buildPrompt(["status"], baseMessage("/wiki status"))

    expect(expectObjectOutput(output, "result")).toContain("Sources: 1")
  })

  it("expands /wiki query into query prompt with mode", async () => {
    const projectPath = await tempDir()
    const contribution = await createKnowledgeBaseAgentContribution({
      project: knowledgeBaseProject(projectPath),
    })

    const output = await contribution?.commands[0]?.buildPrompt(
      ["query", "quick", "部门职责"],
      baseMessage("/wiki query quick 部门职责"),
    )
    const content = expectObjectOutput(output, "prompt")

    expect(content).toContain("Mode: quick")
    expect(content).toContain("Question: 部门职责")
  })

  it("expands /wiki hot into hot cache prompt", async () => {
    const projectPath = await tempDir()
    await mkdir(path.join(projectPath, "wiki"), { recursive: true })
    await writeFile(path.join(projectPath, "wiki", "log.md"), "# Log\n")
    const contribution = await createKnowledgeBaseAgentContribution({
      project: knowledgeBaseProject(projectPath),
    })

    const output = await contribution?.commands[0]?.buildPrompt(["hot"], baseMessage("/wiki hot"))

    expect(expectObjectOutput(output, "prompt")).toContain("Refresh `wiki/hot.md`")
  })
})

function knowledgeBaseProject(projectPath: string) {
  return {
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
  } as const
}

function baseMessage(content: string) {
  return {
    projectId: "project-1",
    sessionKey: "s1",
    platform: "local-renderer",
    content,
  } as const
}

function expectObjectOutput(
  output: RegisteredPromptCommandOutput | undefined,
  kind: "prompt" | "result",
): string {
  expect(typeof output).toBe("object")
  if (!output || typeof output === "string") {
    throw new Error("expected object command output")
  }
  expect(output.kind).toBe(kind)
  return output.content
}
