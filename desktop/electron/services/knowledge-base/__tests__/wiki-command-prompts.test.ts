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
  it("returns a Chinese markdown status result with source counts and commands", async () => {
    const projectPath = await tempDir()
    await mkdir(path.join(projectPath, ".raw"), { recursive: true })
    await writeFile(path.join(projectPath, ".raw", "note.md"), "部门职责\n")

    const output = await buildKnowledgeBaseCommandOutput({
      projectPath,
      args: ["status"],
      readPrompt: promptReader(),
    })

    const content = expectObjectOutput(output, "result")
    expect(content).toContain("## Wiki 状态")
    expect(content).toContain("- 来源：1")
    expect(content).toContain("- 有变更：1")
    expect(content).toContain("`/wiki ingest`")
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

    const content = expectObjectOutput(output, "result")
    expect(content).toContain("## 没有需要导入的来源")
    expect(content).toContain("- 来源：1")
  })

  it("builds a Chinese markdown ingest prompt with preflight sources and manifest requirements", async () => {
    const projectPath = await tempDir()
    await mkdir(path.join(projectPath, ".raw"), { recursive: true })
    await writeFile(path.join(projectPath, ".raw", "note.md"), "部门职责\n")

    const output = await buildKnowledgeBaseCommandOutput({
      projectPath,
      args: ["ingest"],
      readPrompt: promptReader({ "ingest.md": "执行知识库导入模板。" }),
    })

    const content = expectObjectOutput(output, "prompt")
    expect(content).toContain("执行知识库导入模板。")
    expect(content).toContain(projectPath)
    expect(content).toContain(".raw/note.md")
    expect(content).toContain("## 清单更新要求")
    expect(content).toContain("address_map")
    expect(content).toContain("claude-obsidian")
    expect(content).toContain("Synapse 会在导入回合结束后补齐 DragonScale 地址")
    expect(content).toContain("不要编辑 `.vault-meta/address-counter.txt`")
  })

  it("builds a Chinese markdown quick query prompt with mode and question", async () => {
    const projectPath = await tempDir()

    const output = await buildKnowledgeBaseCommandOutput({
      projectPath,
      args: ["query", "quick", "部门职责"],
      readPrompt: promptReader({ "query.md": "从这个 Synapse 知识库回答。" }),
    })

    const content = expectObjectOutput(output, "prompt")
    expect(content).toContain("从这个 Synapse 知识库回答。")
    expect(content).toContain("## 查询参数")
    expect(content).toContain("- 模式：`quick`")
    expect(content).toContain("- 问题：部门职责")
  })

  it("builds a hot-cache prompt with recent log context", async () => {
    const projectPath = await tempDir()
    await mkdir(path.join(projectPath, "wiki"), { recursive: true })
    await writeFile(path.join(projectPath, "wiki", "log.md"), "# Log\n\n- Recent source update.\n")

    const output = await buildKnowledgeBaseCommandOutput({
      projectPath,
      args: ["hot"],
      readPrompt: promptReader({ "hot-cache.md": "刷新 `wiki/hot.md`。" }),
    })

    const content = expectObjectOutput(output, "prompt")
    expect(content).toContain("刷新 `wiki/hot.md`。")
    expect(content).toContain("## 最近日志上下文")
    expect(content).toContain("Recent source update.")
  })
})

function promptReader(overrides: Record<string, string> = {}): (fileName: string) => Promise<string> {
  return async (fileName) => overrides[fileName] ?? `提示：${fileName}`
}

function expectObjectOutput(output: RegisteredPromptCommandOutput, kind: "prompt" | "result"): string {
  expect(typeof output).toBe("object")
  if (typeof output === "string") {
    throw new Error("expected object command output")
  }
  expect(output.kind).toBe(kind)
  return output.content
}
