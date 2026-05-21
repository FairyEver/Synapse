import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import type { RegisteredPromptCommandOutput } from "../../agent-runtime/command-router"
import { scanKnowledgeBaseSources } from "../source-scan"
import { buildKnowledgeBaseCommandOutput } from "../wiki-command-prompts"

const roots: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-wiki-command-"))
  roots.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("wiki command prompts", () => {
  it("returns a direct status result with source counts and commands", async () => {
    const projectPath = await tempDir()
    await mkdir(path.join(projectPath, ".raw"), { recursive: true })
    await writeFile(path.join(projectPath, ".raw", "note.md"), "部门职责\n")

    const output = await buildKnowledgeBaseCommandOutput({
      projectPath,
      args: ["status"],
      readPrompt: promptReader(),
    })

    const content = expectObjectOutput(output, "result")
    expect(content).toContain("Sources: 1")
    expect(content).toContain("Changed: 1")
    expect(content).toContain("/wiki ingest")
  })

  it("returns a direct ingest result when sources are unchanged", async () => {
    const projectPath = await tempDir()
    await mkdir(path.join(projectPath, ".raw"), { recursive: true })
    await writeFile(path.join(projectPath, ".raw", "note.md"), "部门职责\n")
    const scan = await scanKnowledgeBaseSources(projectPath)
    const source = scan.sources[0]
    await writeFile(path.join(projectPath, ".raw", ".manifest.json"), `${JSON.stringify({
      version: 1,
      sources: {
        [source.relativePath]: {
          hash: source.hash,
          ingested_at: "2026-05-21T00:00:00.000Z",
          pages_created: [],
          pages_updated: [],
        },
      },
    }, null, 2)}\n`)

    const output = await buildKnowledgeBaseCommandOutput({
      projectPath,
      args: ["ingest"],
      readPrompt: promptReader(),
    })

    expect(expectObjectOutput(output, "result")).toContain("No wiki source changes")
  })

  it("builds an ingest prompt with preflight sources and manifest requirements", async () => {
    const projectPath = await tempDir()
    await mkdir(path.join(projectPath, ".raw"), { recursive: true })
    await writeFile(path.join(projectPath, ".raw", "note.md"), "部门职责\n")

    const output = await buildKnowledgeBaseCommandOutput({
      projectPath,
      args: ["ingest"],
      readPrompt: promptReader({ "ingest.md": "Run Knowledge Base ingest template." }),
    })

    const content = expectObjectOutput(output, "prompt")
    expect(content).toContain("Run Knowledge Base ingest template.")
    expect(content).toContain(".raw/note.md")
    expect(content).toContain("Manifest update requirements")
  })

  it("builds a quick query prompt with mode and question", async () => {
    const projectPath = await tempDir()

    const output = await buildKnowledgeBaseCommandOutput({
      projectPath,
      args: ["query", "quick", "部门职责"],
      readPrompt: promptReader({ "query.md": "Answer from this Synapse Knowledge Base." }),
    })

    const content = expectObjectOutput(output, "prompt")
    expect(content).toContain("Answer from this Synapse Knowledge Base.")
    expect(content).toContain("Mode: quick")
    expect(content).toContain("Question: 部门职责")
  })

  it("builds a hot-cache prompt with recent log context", async () => {
    const projectPath = await tempDir()
    await mkdir(path.join(projectPath, "wiki"), { recursive: true })
    await writeFile(path.join(projectPath, "wiki", "log.md"), "# Log\n\n- Recent source update.\n")

    const output = await buildKnowledgeBaseCommandOutput({
      projectPath,
      args: ["hot"],
      readPrompt: promptReader({ "hot-cache.md": "Refresh `wiki/hot.md`." }),
    })

    const content = expectObjectOutput(output, "prompt")
    expect(content).toContain("Refresh `wiki/hot.md`.")
    expect(content).toContain("Recent log context")
    expect(content).toContain("Recent source update.")
  })
})

function promptReader(overrides: Record<string, string> = {}): (fileName: string) => Promise<string> {
  return async (fileName) => overrides[fileName] ?? `Prompt: ${fileName}`
}

function expectObjectOutput(output: RegisteredPromptCommandOutput, kind: "prompt" | "result"): string {
  expect(typeof output).toBe("object")
  if (typeof output === "string") {
    throw new Error("expected object command output")
  }
  expect(output.kind).toBe(kind)
  return output.content
}
