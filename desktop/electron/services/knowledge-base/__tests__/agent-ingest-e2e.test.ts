import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import type { RegisteredPromptCommandOutput } from "../../agent-runtime/command-router"
import type { AgentMessage } from "../../agent-runtime/types"
import { createKnowledgeBaseAgentContribution } from "../agent-contribution"
import { readKnowledgeBaseManifest } from "../manifest"

const roots: string[] = []
const SOURCE_TEXT = "# Source Note\n\nAlpha fact.\n"

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-kb-agent-ingest-e2e-"))
  roots.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("Knowledge Base Agent ingest E2E harness", () => {
  it("finalizes a fake SDK /wiki ingest turn through the real contribution path", async () => {
    const projectPath = await createVault()

    await runFakeSdkIngestTurn(projectPath, "/wiki ingest")

    await expectIngestManifest(projectPath)
  })

  it("finalizes a fake SDK natural-language ingest turn through the real contribution path", async () => {
    const projectPath = await createVault()

    await runFakeSdkIngestTurn(projectPath, "汲取知识")

    await expectIngestManifest(projectPath)
  })
})

async function runFakeSdkIngestTurn(projectPath: string, content: "/wiki ingest" | "汲取知识"): Promise<void> {
  const contribution = await createKnowledgeBaseAgentContribution({
    project: knowledgeBaseProject(projectPath),
  })
  expect(contribution).not.toBeNull()

  const message = baseMessage(content)
  const plugins = await contribution?.sdkPlugins?.(message)
  expect(plugins).toHaveLength(1)
  expect(plugins?.[0]?.path.startsWith(projectPath)).toBe(false)

  const agentFacingPrompt = content === "/wiki ingest"
    ? expectObjectOutput(await contribution?.commands[0]?.buildPrompt(["ingest"], message, { turnId: "turn-1" }), "prompt")
    : (await Promise.resolve(contribution?.prepareMessage?.(message, {
      isNewLiveSession: true,
      conversationId: "conv-1",
      turnId: "turn-1",
    })))?.content

  expect(agentFacingPrompt).toContain(".raw/note.md")
  expect(agentFacingPrompt).toContain("## 预检来源")
  expect(agentFacingPrompt).toContain("synapse_kb_ingest_report")
  expect(agentFacingPrompt).toContain("不要编辑 `.raw/.manifest.json`")
  expect(agentFacingPrompt).toContain("由 Synapse")

  await fakeAssistantWikiWrites(projectPath)

  const assistantText = ingestReport([{
    source: ".raw/note.md",
    pages_created: ["wiki/sources/note.md"],
    pages_updated: ["wiki/index.md", "wiki/hot.md", "wiki/log.md"],
  }])
  expect(assistantText).toContain("synapse_kb_ingest_report")

  await contribution?.afterTurn?.({
    message,
    result: {
      conversationId: "conv-1",
      resultText: assistantText,
      events: [],
    },
    conversationId: "conv-1",
    turnId: "turn-1",
    isNewLiveSession: true,
  })
}

async function createVault(): Promise<string> {
  const projectPath = await tempDir()
  await mkdir(path.join(projectPath, ".raw"), { recursive: true })
  await writeFile(path.join(projectPath, ".raw", "note.md"), SOURCE_TEXT)
  await writeFile(path.join(projectPath, ".raw", ".manifest.json"), `${JSON.stringify({
    version: 1,
    sources: {},
    address_map: {},
  }, null, 2)}\n`)
  return projectPath
}

async function fakeAssistantWikiWrites(projectPath: string): Promise<void> {
  await mkdir(path.join(projectPath, "wiki", "sources"), { recursive: true })
  await writeFile(
    path.join(projectPath, "wiki", "sources", "note.md"),
    "---\ntype: source\n---\n\n# Source Note\n\nAlpha fact.\n",
  )
  await writeFile(path.join(projectPath, "wiki", "index.md"), "# Index\n\n- [[sources/note|Source Note]]\n")
  await writeFile(path.join(projectPath, "wiki", "hot.md"), "# Hot\n\nAlpha fact.\n")
  await writeFile(path.join(projectPath, "wiki", "log.md"), "# Log\n\n- Ingested note.\n")
}

async function expectIngestManifest(projectPath: string): Promise<void> {
  const readResult = await readKnowledgeBaseManifest(projectPath)
  expect(readResult.status).toBe("valid")
  expect(readResult.manifest.sources[".raw/note.md"]).toMatchObject({
    hash: createHash("sha256").update(SOURCE_TEXT).digest("hex"),
    pages_created: ["wiki/sources/note.md"],
    pages_updated: ["wiki/hot.md", "wiki/index.md", "wiki/log.md"],
  })
  expect(readResult.manifest.sources[".raw/note.md"]?.ingested_at).toEqual(expect.any(String))
  expect(readResult.manifest.address_map).toEqual({
    "wiki/sources/note.md": "c-000001",
  })
  await expect(readFile(path.join(projectPath, "wiki", "sources", "note.md"), "utf8"))
    .resolves.toContain("address: c-000001")
}

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

function baseMessage(content: string): AgentMessage {
  return {
    projectId: "project-1",
    sessionKey: "s1",
    platform: "local-renderer",
    content,
  }
}

function ingestReport(processedSources: readonly object[]): string {
  return [
    "```json synapse_kb_ingest_report",
    JSON.stringify({
      schema: "synapse.kb.ingest.report.v1",
      processed_sources: processedSources,
      skipped_sources: [],
    }),
    "```",
  ].join("\n")
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
