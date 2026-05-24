import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

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

  it("contributes the Synapse knowledge-base SDK plugin outside the vault", async () => {
    const projectPath = await tempDir()
    const contribution = await createKnowledgeBaseAgentContribution({
      project: knowledgeBaseProject(projectPath),
    })

    const plugins = await contribution?.sdkPlugins?.(baseMessage("hello"))

    expect(plugins).toHaveLength(1)
    expect(plugins?.[0]).toMatchObject({ type: "local" })
    expect(plugins?.[0]?.path).toContain(
      path.join("resources", "knowledge-base", "claude-plugin"),
    )
    expect(plugins?.[0]?.path.startsWith(projectPath)).toBe(false)
  })

  it("does not contribute knowledge-base SDK plugins to scheduled agent turns", async () => {
    const projectPath = await tempDir()
    const contribution = await createKnowledgeBaseAgentContribution({
      project: knowledgeBaseProject(projectPath),
    })

    const plugins = await contribution?.sdkPlugins?.({
      ...baseMessage("汲取知识"),
      platform: "scheduled",
    })

    expect(plugins).toEqual([])
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
        name: "wiki research",
        description: "研究一个主题并将结果归档到知识库。",
        source: "custom",
        kind: "prompt",
        adminOnly: false,
        ui: {
          group: "knowledge-base",
          label: "研究入库",
          action: "insert",
          insertText: "/wiki research ",
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
    ].map((command) => ({
      ...command,
      allowedPlatforms: ["local-renderer"],
    })))
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
    }, { isNewLiveSession: true, conversationId: "conv-1", turnId: "turn-1" }))
    const unchanged = await Promise.resolve(contribution?.prepareMessage?.({
      projectId: "project-1",
      sessionKey: "s1",
      platform: "local-renderer",
      content: "What changed?",
    }, { isNewLiveSession: false, conversationId: "conv-1", turnId: "turn-2" }))

    expect(prepared?.content).toContain("Recent fact.")
    expect(prepared?.content).toContain("不要根据 wikilink 标题猜测文件路径。")
    expect(prepared?.content).toContain("address_map")
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
    }, { isNewLiveSession: true, conversationId: "conv-1", turnId: "turn-1" }))
    await writeFile(hotCachePath, "# Hot Cache\n\nNew fact.\n")
    const second = await Promise.resolve(contribution?.prepareMessage?.({
      projectId: "project-1",
      sessionKey: "s2",
      platform: "local-renderer",
      content: "What changed?",
    }, { isNewLiveSession: true, conversationId: "conv-1", turnId: "turn-2" }))
    const reused = await Promise.resolve(contribution?.prepareMessage?.({
      projectId: "project-1",
      sessionKey: "s2",
      platform: "local-renderer",
      content: "What changed?",
    }, { isNewLiveSession: false, conversationId: "conv-1", turnId: "turn-3" }))

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
    }, { isNewLiveSession: true, conversationId: "conv-1", turnId: "turn-1" }))).rejects.toMatchObject({ code: "EISDIR" })
  })

  it("expands /wiki ingest into the internal ingest prompt", async () => {
    const projectPath = await tempDir()
    await mkdir(path.join(projectPath, ".raw"), { recursive: true })
    await writeFile(path.join(projectPath, ".raw", "note.md"), "alpha\n")
    const contribution = await createKnowledgeBaseAgentContribution({
      project: knowledgeBaseProject(projectPath),
    })

    const command = contribution?.commands[0]
    const output = await command?.buildPrompt(["ingest"], baseMessage("/wiki ingest"), { turnId: "turn-1" })

    const content = expectObjectOutput(output, "prompt")
    expect(content).toContain("执行知识库导入")
    expect(content).toContain("address_map")
  })

  it("injects source preflight for natural-language ingest requests", async () => {
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
    }, { isNewLiveSession: false, conversationId: "conv-1", turnId: "turn-1" }))

    expect(prepared?.content).toContain(".raw/note.md")
    expect(prepared?.content).toContain("synapse_kb_ingest_report")
    expect((await contribution?.sdkPlugins?.(baseMessage("汲取知识")))?.[0]?.path.startsWith(projectPath)).toBe(false)
  })

  it("does not inject knowledge-base prompts into scheduled agent turns", async () => {
    const projectPath = await tempDir()
    await mkdir(path.join(projectPath, ".raw"), { recursive: true })
    await writeFile(path.join(projectPath, ".raw", ".manifest.json"), "{\"version\":1,\"sources\":{},\"address_map\":{}}\n")
    await writeFile(path.join(projectPath, ".raw", "note.md"), "alpha\n")
    const contribution = await createKnowledgeBaseAgentContribution({
      project: knowledgeBaseProject(projectPath),
    })

    const scheduled = {
      ...baseMessage("汲取知识"),
      platform: "scheduled",
    }
    const prepared = await Promise.resolve(contribution?.prepareMessage?.(
      scheduled,
      { isNewLiveSession: true, conversationId: "conv-1", turnId: "turn-1" },
    ))

    expect(prepared).toEqual(scheduled)
  })

  it("does not emit a false finalization error when natural-language ingest has no changed sources", async () => {
    const projectPath = await tempDir()
    await mkdir(path.join(projectPath, ".raw"), { recursive: true })
    const sourceContent = "alpha\n"
    const sourceHash = createHash("sha256").update(sourceContent).digest("hex")
    await writeFile(path.join(projectPath, ".raw", ".manifest.json"), `${JSON.stringify({
      version: 1,
      sources: {
        ".raw/note.md": {
          hash: sourceHash,
          ingested_at: "2026-05-24T00:00:00.000Z",
          pages_created: [],
          pages_updated: [],
        },
      },
      address_map: {},
    })}\n`)
    await writeFile(path.join(projectPath, ".raw", "note.md"), sourceContent)
    const contribution = await createKnowledgeBaseAgentContribution({
      project: knowledgeBaseProject(projectPath),
    })

    const prepared = await contribution?.prepareMessage?.(baseMessage("汲取知识"), {
      isNewLiveSession: false,
      conversationId: "conv-1",
      turnId: "turn-1",
    })
    const result = await contribution?.afterTurn?.({
      message: baseMessage("汲取知识"),
      result: { conversationId: "conv-1", resultText: "done", events: [] },
      conversationId: "conv-1",
      turnId: "turn-1",
      isNewLiveSession: false,
    })

    expect(prepared?.content).toContain("没有需要导入的来源")
    expect(result?.events ?? []).toEqual([])
  })

  it("does not emit a false finalization error when natural-language ingest sees an invalid manifest", async () => {
    const projectPath = await tempDir()
    await mkdir(path.join(projectPath, ".raw"), { recursive: true })
    await writeFile(path.join(projectPath, ".raw", ".manifest.json"), "{ bad json")
    await writeFile(path.join(projectPath, ".raw", "note.md"), "alpha\n")
    const contribution = await createKnowledgeBaseAgentContribution({
      project: knowledgeBaseProject(projectPath),
    })

    const prepared = await contribution?.prepareMessage?.(baseMessage("汲取知识"), {
      isNewLiveSession: false,
      conversationId: "conv-1",
      turnId: "turn-1",
    })
    const result = await contribution?.afterTurn?.({
      message: baseMessage("汲取知识"),
      result: { conversationId: "conv-1", resultText: "done", events: [] },
      conversationId: "conv-1",
      turnId: "turn-1",
      isNewLiveSession: false,
    })

    expect(prepared?.content).toContain("Wiki 来源清单无效")
    expect(result?.events ?? []).toEqual([])
  })

  it("returns a direct /wiki status result", async () => {
    const projectPath = await tempDir()
    await mkdir(path.join(projectPath, ".raw"), { recursive: true })
    await writeFile(path.join(projectPath, ".raw", ".manifest.json"), "{\"version\":1,\"sources\":{}}\n")
    await writeFile(path.join(projectPath, ".raw", "note.md"), "alpha\n")
    const contribution = await createKnowledgeBaseAgentContribution({
      project: knowledgeBaseProject(projectPath),
    })

    const output = await contribution?.commands[0]?.buildPrompt(["status"], baseMessage("/wiki status"), { turnId: "turn-1" })

    expect(expectObjectOutput(output, "result")).toContain("- 来源：1")
  })

  it("runs ingest coordinator finalization after natural-language ingest turns", async () => {
    const projectPath = await tempDir()
    const finalizeTurn = vi.fn(async () => undefined)

    const contribution = await createKnowledgeBaseAgentContribution({
      project: knowledgeBaseProject(projectPath),
      ingestCoordinator: {
        prepareTurn: vi.fn(),
        finalizeTurn,
      } as never,
    })

    await contribution?.afterTurn?.({
      message: baseMessage("汲取知识"),
      result: { conversationId: "conv-1", resultText: "done", events: [] },
      conversationId: "conv-1",
      turnId: "turn-1",
      isNewLiveSession: false,
    })

    expect(finalizeTurn).toHaveBeenCalledWith({
      projectPath,
      conversationId: "conv-1",
      turnId: "turn-1",
      assistantText: "done",
    })
  })

  it("runs address finalization after explicit research filing turns", async () => {
    const projectPath = await tempDir()
    const finalizeTurn = vi.fn(async () => undefined)
    const finalizeAddressMap = vi.fn(async () => ({
      assigned: [{ path: "wiki/questions/research.md", address: "c-000001" }],
      reused: [],
      addressMap: { "wiki/questions/research.md": "c-000001" },
    }))

    const contribution = await createKnowledgeBaseAgentContribution({
      project: knowledgeBaseProject(projectPath),
      ingestCoordinator: {
        prepareTurn: vi.fn(),
        finalizeTurn,
      } as never,
      addressFinalizer: {
        finalize: finalizeAddressMap,
      } as never,
    })

    await contribution?.afterTurn?.({
      message: baseMessage("/wiki research Graph databases"),
      result: { conversationId: "conv-1", resultText: "done", events: [] },
      conversationId: "conv-1",
      turnId: "turn-1",
      isNewLiveSession: false,
    })

    expect(finalizeTurn).not.toHaveBeenCalled()
    expect(finalizeAddressMap).toHaveBeenCalledWith(projectPath)
  })

  it("returns a visible error event when ingest finalization cannot parse a report", async () => {
    const projectPath = await tempDir()
    const contribution = await createKnowledgeBaseAgentContribution({
      project: knowledgeBaseProject(projectPath),
      ingestCoordinator: {
        prepareTurn: vi.fn(),
        finalizeTurn: vi.fn(async () => ({
          status: "skipped",
          warnings: [{ code: "report-missing", message: "Missing report." }],
          message: "知识库后置写入未完成：缺少 synapse_kb_ingest_report。",
        })),
      } as never,
    })

    const result = await contribution?.afterTurn?.({
      message: baseMessage("汲取知识"),
      result: { conversationId: "conv-1", resultText: "done", events: [] },
      conversationId: "conv-1",
      turnId: "turn-1",
      isNewLiveSession: false,
    })

    expect(result?.events).toEqual([
      expect.objectContaining({
        type: "error",
        message: "知识库后置写入未完成：缺少 synapse_kb_ingest_report。",
      }),
    ])
  })

  it("does not run the address finalizer for topicless research selection turns", async () => {
    const projectPath = await tempDir()
    const finalizeTurn = vi.fn(async () => undefined)

    const contribution = await createKnowledgeBaseAgentContribution({
      project: knowledgeBaseProject(projectPath),
      ingestCoordinator: {
        prepareTurn: vi.fn(),
        finalizeTurn,
      } as never,
    })

    await contribution?.afterTurn?.({
      message: baseMessage("/wiki research"),
      result: { conversationId: "conv-1", resultText: "choose topic", events: [] },
      conversationId: "conv-1",
      turnId: "turn-1",
      isNewLiveSession: false,
    })

    expect(finalizeTurn).not.toHaveBeenCalled()
  })

  it("does not run the ingest finalizer for query turns", async () => {
    const projectPath = await tempDir()
    const finalizeTurn = vi.fn(async () => undefined)

    const contribution = await createKnowledgeBaseAgentContribution({
      project: knowledgeBaseProject(projectPath),
      ingestCoordinator: {
        prepareTurn: vi.fn(),
        finalizeTurn,
      } as never,
    })

    await contribution?.afterTurn?.({
      message: baseMessage("/wiki query topic"),
      result: { conversationId: "conv-1", resultText: "done", events: [] },
      conversationId: "conv-1",
      turnId: "turn-1",
      isNewLiveSession: false,
    })

    expect(finalizeTurn).not.toHaveBeenCalled()
  })

  it("finalizes manifest sources and address_map after natural-language ingest", async () => {
    const projectPath = await tempDir()
    await mkdir(path.join(projectPath, ".raw"), { recursive: true })
    await writeFile(path.join(projectPath, ".raw", ".manifest.json"), "{\"version\":1,\"sources\":{},\"address_map\":{}}\n")
    await writeFile(path.join(projectPath, ".raw", "note.md"), "alpha\n")
    await mkdir(path.join(projectPath, "wiki", "sources"), { recursive: true })
    const contribution = await createKnowledgeBaseAgentContribution({
      project: knowledgeBaseProject(projectPath),
    })

    await contribution?.prepareMessage?.(baseMessage("汲取知识"), {
      isNewLiveSession: false,
      conversationId: "conv-1",
      turnId: "turn-1",
    })

    await writeFile(
      path.join(projectPath, "wiki", "sources", "note.md"),
      "---\ntype: source\ntitle: Note\n---\n\n# Note\n",
    )
    await contribution?.afterTurn?.({
      message: baseMessage("汲取知识"),
      result: {
        conversationId: "conv-1",
        resultText: "```synapse_kb_ingest_report\n{\"schema\":\"synapse.kb.ingest.report.v1\",\"processed_sources\":[{\"source\":\".raw/note.md\",\"pages_created\":[\"wiki/sources/note.md\"],\"pages_updated\":[]}],\"skipped_sources\":[]}\n```",
        events: [],
      },
      conversationId: "conv-1",
      turnId: "turn-1",
      isNewLiveSession: false,
    })

    const manifest = JSON.parse(await readFile(path.join(projectPath, ".raw", ".manifest.json"), "utf8")) as {
      sources: Record<string, { hash: string; pages_created: string[] }>
      address_map: Record<string, string>
    }
    expect(manifest.sources[".raw/note.md"]?.hash).toMatch(/^[a-f0-9]{64}$/)
    expect(manifest.sources[".raw/note.md"]?.pages_created).toEqual(["wiki/sources/note.md"])
    expect(manifest.address_map["wiki/sources/note.md"]).toBe("c-000001")
  })

  it("expands /wiki query into query prompt with mode", async () => {
    const projectPath = await tempDir()
    const contribution = await createKnowledgeBaseAgentContribution({
      project: knowledgeBaseProject(projectPath),
    })

    const output = await contribution?.commands[0]?.buildPrompt(
      ["query", "quick", "部门职责"],
      baseMessage("/wiki query quick 部门职责"),
      { turnId: "turn-1" },
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

    const output = await contribution?.commands[0]?.buildPrompt(["hot"], baseMessage("/wiki hot"), { turnId: "turn-1" })

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
