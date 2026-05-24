import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { RegisteredPromptCommandOutput } from "../../agent-runtime/command-router"
import { createKnowledgeBaseAgentContribution } from "../../knowledge-base/agent-contribution"
import { readKnowledgeBaseManifest } from "../../knowledge-base/manifest"

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

  it("contributes the Synapse knowledge-base SDK plugin outside the vault", async () => {
    const projectPath = await tempDir()
    const contribution = await createKnowledgeBaseAgentContribution({
      project: knowledgeBaseProject(projectPath),
    })

    expect(contribution?.sdkPlugins).toHaveLength(1)
    expect(contribution?.sdkPlugins?.[0]).toMatchObject({ type: "local" })
    expect(contribution?.sdkPlugins?.[0]?.path).toContain(
      path.join("resources", "knowledge-base", "claude-plugin"),
    )
    expect(contribution?.sdkPlugins?.[0]?.path.startsWith(projectPath)).toBe(false)
  })

  it("keeps the Synapse SDK ingest skill from telling agents to edit the manifest", async () => {
    const skillText = await readFile(
      path.resolve(process.cwd(), "resources", "knowledge-base", "claude-plugin", "skills", "wiki-ingest", "SKILL.md"),
      "utf8",
    )

    expect(skillText).toContain("Do not edit `.raw/.manifest.json`")
    expect(skillText).toContain("synapse_kb_ingest_report")
    expect(skillText).toContain("Synapse writes `.raw/.manifest.json`")
    expect(skillText).not.toContain("except `.raw/.manifest.json`")
    expect(skillText).not.toContain("Update `.raw/.manifest.json`")
  })

  it("publishes knowledge base composer actions for knowledge base projects", async () => {
    const projectPath = await tempDir()
    const contribution = await createKnowledgeBaseAgentContribution({
      project: knowledgeBaseProject(projectPath),
    })

    expect(contribution?.publishedCommands).toEqual([
      {
        name: "wiki ingest",
        description: "扫描 .raw/ 变更来源并导入到 wiki。",
        source: "custom",
        kind: "prompt",
        adminOnly: false,
        ui: {
          group: "knowledge-base",
          label: "汲取来源",
          action: "send",
          insertText: "/wiki ingest",
        },
      },
      {
        name: "wiki query",
        description: "插入查询指令，继续输入要检索的问题。",
        source: "custom",
        kind: "prompt",
        adminOnly: false,
        ui: {
          group: "knowledge-base",
          label: "查询知识库",
          action: "insert",
          insertText: "/wiki query ",
        },
      },
      {
        name: "wiki hot",
        description: "更新 wiki/hot.md 的近期事实和活跃主题。",
        source: "custom",
        kind: "prompt",
        adminOnly: false,
        ui: {
          group: "knowledge-base",
          label: "刷新热点",
          action: "send",
          insertText: "/wiki hot",
        },
      },
      {
        name: "wiki save",
        description: "将当前对话要点追加到知识库日志。",
        source: "custom",
        kind: "prompt",
        adminOnly: false,
        ui: {
          group: "knowledge-base",
          label: "保存记录",
          action: "send",
          insertText: "/wiki save",
        },
      },
      {
        name: "wiki lint",
        description: "检查知识库结构、索引和链接状态。",
        source: "custom",
        kind: "prompt",
        adminOnly: false,
        ui: {
          group: "knowledge-base",
          label: "检查知识库",
          action: "send",
          insertText: "/wiki lint",
        },
      },
      {
        name: "wiki status",
        description: "查看来源清单、页面数量和知识库状态。",
        source: "custom",
        kind: "prompt",
        adminOnly: false,
        ui: {
          group: "knowledge-base",
          label: "查看状态",
          action: "send",
          insertText: "/wiki status",
        },
      },
    ])
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
    expect(prepared?.content).toContain("不要根据 wikilink 标题猜测文件路径。")
    expect(prepared?.content).toContain("不要修改 `.raw/` 下的任何文件，包括 `.raw/.manifest.json`")
    expect(prepared?.content).toContain("由 Synapse 根据导入回合报告写入")
    expect(prepared?.content).toContain("address_map")
    expect(prepared?.content).not.toContain("除 `.raw/.manifest.json` 外")
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

    const content = expectObjectOutput(output, "prompt")
    expect(content).toContain("执行知识库导入")
    expect(content).toContain("address_map")
    expect(content).toContain("不要编辑 `.raw/.manifest.json`")
    expect(content).toContain("synapse_kb_ingest_report")
    expect(content).not.toContain("为每个已处理来源更新 `.raw/.manifest.json`")
  })

  it("injects coordinator preflight for natural-language ingest requests", async () => {
    const projectPath = await tempDir()
    await mkdir(path.join(projectPath, ".raw"), { recursive: true })
    await writeFile(path.join(projectPath, ".raw", ".manifest.json"), "{\"version\":1,\"sources\":{},\"address_map\":{}}\n")
    await writeFile(path.join(projectPath, ".raw", "note.md"), "alpha\n")
    const contribution = await createKnowledgeBaseAgentContribution({
      project: knowledgeBaseProject(projectPath),
    })

    const prepared = await Promise.resolve(contribution?.prepareMessage?.({
      projectId: "project-1",
      sessionKey: "s1",
      platform: "local-renderer",
      content: "汲取知识",
    }, { isNewLiveSession: false }))

    expect(prepared?.content).toContain("汲取知识")
    expect(prepared?.content).toContain("## Synapse 预检")
    expect(prepared?.content).toContain(".raw/note.md")
    expect(prepared?.content).toContain("synapse_kb_ingest_report")
    expect(prepared?.content).toContain("不要编辑 `.raw/.manifest.json`")
    expect(contribution?.sdkPlugins?.[0]?.path.startsWith(projectPath)).toBe(false)
  })

  it("blocks natural-language ingest when the source manifest is invalid", async () => {
    const projectPath = await tempDir()
    await mkdir(path.join(projectPath, ".raw"), { recursive: true })
    await writeFile(path.join(projectPath, ".raw", ".manifest.json"), "{ bad json")
    await writeFile(path.join(projectPath, ".raw", "note.md"), "alpha\n")
    const contribution = await createKnowledgeBaseAgentContribution({
      project: knowledgeBaseProject(projectPath),
    })

    const prepared = await Promise.resolve(contribution?.prepareMessage?.({
      projectId: "project-1",
      sessionKey: "s1",
      platform: "local-renderer",
      content: "汲取知识",
    }, { isNewLiveSession: false }))

    expect(prepared?.content).toContain("## Wiki 来源清单无效")
    expect(prepared?.content).toContain("JSON")
    expect(prepared?.content).not.toContain("执行知识库导入")
    expect(prepared?.content).not.toContain("synapse_kb_ingest_report")
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

    expect(expectObjectOutput(output, "result")).toContain("- 来源：1")
  })

  it("finalizes natural-language ingest through the coordinator with assistant report text", async () => {
    const projectPath = await tempDir()
    await mkdir(path.join(projectPath, ".raw"), { recursive: true })
    await writeFile(path.join(projectPath, ".raw", ".manifest.json"), "{\"version\":1,\"sources\":{},\"address_map\":{}}\n")
    await writeFile(path.join(projectPath, ".raw", "note.md"), "alpha\n")
    await mkdir(path.join(projectPath, "wiki", "sources"), { recursive: true })
    await writeFile(path.join(projectPath, "wiki", "sources", "note.md"), "---\ntype: source\naddress: c-000007\n---\n\n# Note\n")

    const contribution = await createKnowledgeBaseAgentContribution({
      project: knowledgeBaseProject(projectPath),
    })
    await Promise.resolve(contribution?.prepareMessage?.({
      projectId: "project-1",
      sessionKey: "s1",
      platform: "local-renderer",
      content: "汲取知识",
    }, { isNewLiveSession: false }))

    await contribution?.afterTurn?.({
      message: baseMessage("汲取知识"),
      result: { conversationId: "conv-1", resultText: ingestReport([{
        source: ".raw/note.md",
        pages_created: ["wiki/sources/note.md"],
        pages_updated: [],
      }]), events: [] },
      conversationId: "conv-1",
      isNewLiveSession: false,
    })

    await expect(readKnowledgeBaseManifest(projectPath)).resolves.toMatchObject({
      manifest: {
        sources: {
          ".raw/note.md": {
            pages_created: ["wiki/sources/note.md"],
            pages_updated: [],
          },
        },
        address_map: {
          "wiki/sources/note.md": "c-000007",
        },
      },
    })
  })

  it("finalizes /wiki ingest through the coordinator with assistant report text", async () => {
    const projectPath = await tempDir()
    await mkdir(path.join(projectPath, ".raw"), { recursive: true })
    await writeFile(path.join(projectPath, ".raw", ".manifest.json"), "{\"version\":1,\"sources\":{},\"address_map\":{}}\n")
    await writeFile(path.join(projectPath, ".raw", "note.md"), "alpha\n")
    await mkdir(path.join(projectPath, "wiki", "sources"), { recursive: true })
    await writeFile(path.join(projectPath, "wiki", "sources", "note.md"), "---\ntype: source\naddress: c-000008\n---\n\n# Note\n")

    const contribution = await createKnowledgeBaseAgentContribution({
      project: knowledgeBaseProject(projectPath),
    })
    await contribution?.commands[0]?.buildPrompt(["ingest"], baseMessage("/wiki ingest"))
    await contribution?.afterTurn?.({
      message: baseMessage("/wiki ingest"),
      result: { conversationId: "conv-1", resultText: ingestReport([{
        source: ".raw/note.md",
        pages_created: ["wiki/sources/note.md"],
        pages_updated: [],
      }]), events: [] },
      conversationId: "conv-1",
      isNewLiveSession: false,
    })

    await expect(readKnowledgeBaseManifest(projectPath)).resolves.toMatchObject({
      manifest: {
        sources: {
          ".raw/note.md": {
            pages_created: ["wiki/sources/note.md"],
            pages_updated: [],
          },
        },
        address_map: {
          "wiki/sources/note.md": "c-000008",
        },
      },
    })
  })

  it("preserves /wiki ingest preflight when runtime callbacks resolve contribution through one cached instance", async () => {
    const projectPath = await tempDir()
    await mkdir(path.join(projectPath, ".raw"), { recursive: true })
    await writeFile(path.join(projectPath, ".raw", ".manifest.json"), "{\"version\":1,\"sources\":{},\"address_map\":{}}\n")
    await writeFile(path.join(projectPath, ".raw", "note.md"), "alpha\n")
    await mkdir(path.join(projectPath, "wiki", "sources"), { recursive: true })
    await writeFile(path.join(projectPath, "wiki", "sources", "note.md"), "---\ntype: source\naddress: c-000009\n---\n\n# Note\n")
    let contributionCreations = 0
    let cachedContribution: Awaited<ReturnType<typeof createKnowledgeBaseAgentContribution>> | null = null
    const resolveContribution = async () => {
      if (!cachedContribution) {
        contributionCreations += 1
        cachedContribution = await createKnowledgeBaseAgentContribution({
          project: knowledgeBaseProject(projectPath),
        })
      }
      return cachedContribution
    }

    const commandContribution = await resolveContribution()
    await commandContribution?.commands[0]?.buildPrompt(["ingest"], baseMessage("/wiki ingest"))
    const afterTurnContribution = await resolveContribution()
    await afterTurnContribution?.afterTurn?.({
      message: baseMessage("/wiki ingest"),
      result: { conversationId: "conv-1", resultText: ingestReport([{
        source: ".raw/note.md",
        pages_created: ["wiki/sources/note.md"],
        pages_updated: [],
      }]), events: [] },
      conversationId: "conv-1",
      isNewLiveSession: false,
    })

    expect(contributionCreations).toBe(1)
    await expect(readKnowledgeBaseManifest(projectPath)).resolves.toMatchObject({
      manifest: {
        sources: {
          ".raw/note.md": {
            pages_created: ["wiki/sources/note.md"],
            pages_updated: [],
          },
        },
        address_map: {
          "wiki/sources/note.md": "c-000009",
        },
      },
    })
  })

  it("leaves manifest sources unchanged when coordinator finalization rejects an invalid report", async () => {
    const projectPath = await tempDir()
    await mkdir(path.join(projectPath, ".raw"), { recursive: true })
    await writeFile(path.join(projectPath, ".raw", ".manifest.json"), `${JSON.stringify({
      version: 1,
      sources: {
        ".raw/existing.md": { hash: "existing-hash" },
      },
      address_map: {},
    }, null, 2)}\n`)
    await writeFile(path.join(projectPath, ".raw", "note.md"), "alpha\n")
    const warn = vi.fn()
    const contribution = await createKnowledgeBaseAgentContribution({
      project: knowledgeBaseProject(projectPath),
      logger: { warn },
    })
    await contribution?.commands[0]?.buildPrompt(["ingest"], baseMessage("/wiki ingest"))

    await contribution?.afterTurn?.({
      message: baseMessage("/wiki ingest"),
      result: {
        conversationId: "conv-1",
        resultText: ["```json synapse_kb_ingest_report", "{ bad json", "```"].join("\n"),
        events: [],
      },
      conversationId: "conv-1",
      isNewLiveSession: false,
    })

    await expect(readKnowledgeBaseManifest(projectPath)).resolves.toMatchObject({
      manifest: {
        sources: {
          ".raw/existing.md": { hash: "existing-hash" },
        },
      },
    })
    expect(warn).toHaveBeenCalledWith("Knowledge base ingest finalization produced warnings.", {
      boundary: "knowledge-base.ingest.finalize",
      projectId: "project-1",
      warnings: [expect.stringContaining("Ingest report was not accepted")],
    })
  })

  it("does not run the ingest finalizer for query turns", async () => {
    const projectPath = await tempDir()
    const finalize = vi.fn(async () => ({ assigned: [], reused: [] }))

    const contribution = await createKnowledgeBaseAgentContribution({
      project: knowledgeBaseProject(projectPath),
      ingestFinalizer: { finalize },
    })

    await contribution?.afterTurn?.({
      message: baseMessage("/wiki query topic"),
      result: { conversationId: "conv-1", resultText: "done", events: [] },
      conversationId: "conv-1",
      isNewLiveSession: false,
    })

    expect(finalize).not.toHaveBeenCalled()
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

    expect(content).toContain("- 模式：`quick`")
    expect(content).toContain("- 问题：部门职责")
  })

  it("expands /wiki hot into hot cache prompt", async () => {
    const projectPath = await tempDir()
    await mkdir(path.join(projectPath, "wiki"), { recursive: true })
    await writeFile(path.join(projectPath, "wiki", "log.md"), "# Log\n")
    const contribution = await createKnowledgeBaseAgentContribution({
      project: knowledgeBaseProject(projectPath),
    })

    const output = await contribution?.commands[0]?.buildPrompt(["hot"], baseMessage("/wiki hot"))

    expect(expectObjectOutput(output, "prompt")).toContain("刷新 `wiki/hot.md`")
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
