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
    expect(content).toContain("synapse_kb_ingest_report")
    expect(content).toContain("synapse.kb.ingest.report.v1")
    expect(content).toContain("pages_created")
    expect(content).toContain("pages_updated")
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

  it("builds a lint prompt with Synapse deterministic preflight appendix", async () => {
    const projectPath = await tempDir()

    const output = await buildKnowledgeBaseCommandOutput({
      projectPath,
      args: ["lint"],
      readPrompt: promptReader({ "lint.md": "执行知识库健康检查。" }),
      lintPreflight: {
        run: async () => ({
          generatedDate: "2026-05-24",
          pagesScanned: 2,
          issues: [{
            severity: "error",
            code: "address.missing-post-rollout",
            path: "wiki/concepts/Alpha.md",
            message: "Missing address.",
          }],
          address: {
            counter: 2,
            highestCAddress: "c-000001",
            postRolloutPagesChecked: 1,
            legacyPagesPendingBackfill: 0,
            issues: [],
          },
          tiling: {
            status: "ok",
            reportPath: "wiki/meta/tiling-report-2026-05-24.md",
            errors: 1,
            reviews: 2,
            calibrated: false,
          },
        }),
      },
    })

    const content = expectObjectOutput(output, "prompt")
    expect(content).toContain("执行知识库健康检查。")
    expect(content).toContain("## Synapse 确定性预检")
    expect(content).toContain("address.missing-post-rollout")
    expect(content).toContain("wiki/meta/tiling-report-2026-05-24.md")
    expect(content).toContain("不要重新运行 DragonScale 脚本")
    expect(content).toContain("wiki/meta/lint-report-2026-05-24.md")
  })

  it("builds a research prompt with explicit topic", async () => {
    const projectPath = await tempDir()

    const output = await buildKnowledgeBaseCommandOutput({
      projectPath,
      args: ["research", "Graph", "databases"],
      readPrompt: promptReader({ "research.md": "执行知识库研究入库。" }),
      researchPreflight: {
        prepare: async () => ({ mode: "explicit-topic", topic: "Graph databases" }),
      },
    })

    const content = expectObjectOutput(output, "prompt")
    expect(content).toContain("执行知识库研究入库。")
    expect(content).toContain("Topic: Graph databases")
    expect(content).toContain("新页面地址由 Synapse 后置 finalizer 补齐")
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
