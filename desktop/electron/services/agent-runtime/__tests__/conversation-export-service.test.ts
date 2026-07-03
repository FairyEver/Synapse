import { afterEach, describe, expect, it, vi } from "vitest"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import type {
  AgentArtifactEntryV1,
  AgentEventEntryV1,
  AgentUsageEntryV1,
  ConversationEntryV1,
  DataNamespace,
} from "../../../runtime/data-repo"
import type { AuditSink } from "../../../runtime/security"
import { AgentConversationExportService } from "../conversation-export-service"

const tempRoots: string[] = []
const TEST_SESSION_KEY = "local:renderer-secret-session"

afterEach(async () => {
  for (const root of tempRoots.splice(0)) {
    await rm(root, { recursive: true, force: true })
  }
})

describe("AgentConversationExportService", () => {
  it("writes a redacted conversation debug bundle before zipping it", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "synapse-agent-export-test-"))
    tempRoots.push(tempRoot)
    const outputPath = path.join(tempRoot, "conversation.zip")
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const agentEvents = new MemoryNamespace<AgentEventEntryV1>("agent.events")
    const agentUsage = new MemoryNamespace<AgentUsageEntryV1>("agent.usage")
    const auditEvents: Parameters<AuditSink["record"]>[0][] = []
    const conversation = createConversation()
    await conversations.upsert(conversation)
    await agentEvents.upsert({
      id: "event-1",
      schemaVersion: 1,
      projectId: "project-1",
      conversationId: "conv-1",
      turnId: "turn-1",
      eventType: "toolUse",
      payload: {
        type: "toolUse",
        toolUseId: "toolu-read-1",
        toolName: "Read",
        toolInputRaw: {
          file_path: "/Users/liyang/project/file.ts",
          ANTHROPIC_AUTH_TOKEN: "sk-secret",
        },
      },
      createdAt: "2026-06-08T08:00:01.000Z",
    })
    await agentUsage.upsert({
      id: "usage-1",
      schemaVersion: 1,
      projectId: "project-1",
      conversationId: "conv-1",
      turnId: "turn-1",
      sdkResultUuid: "result-1",
      sdkSessionId: "sdk-1",
      usage: {
        input_tokens: 10,
        output_tokens: 4,
      },
      usageSummary: {
        inputTokens: 10,
        outputTokens: 4,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
        totalTokens: 14,
      },
      createdAt: "2026-06-08T08:00:02.000Z",
    })
    const createZipArchive = vi.fn(async (sourceDirectoryPath: string, targetPath: string) => {
      expect(targetPath).toBe(outputPath)
      const readPackageFile = (name: string) => readFile(path.join(sourceDirectoryPath, name), "utf8")
      const conversationText = await readPackageFile("conversation.json")
      const manifestText = await readPackageFile("manifest.json")
      const summaryText = await readPackageFile("summary.json")
      const manifest = JSON.parse(manifestText) as { included: string[]; sessionKey?: string }
      const summary = JSON.parse(summaryText) as {
        sessionKey?: string
        toolCallCount: number
        failedToolCount: number
        usageSummary: { totalTokens: number }
      }
      const attachments = JSON.parse(await readPackageFile("attachments.json")) as {
        messages: Array<{
          role: string
          contentPreview: string
          attachments: Array<Record<string, unknown>>
        }>
      }
      const eventsText = await readPackageFile("agent-events.json")
      const timelineText = await readPackageFile("timeline.json")
      const transcript = await readPackageFile("transcript.md")
      const packageText = [
        conversationText,
        manifestText,
        summaryText,
        eventsText,
        timelineText,
        transcript,
      ].join("\n")

      expect(manifest.included).toEqual(expect.arrayContaining([
        "conversation.json",
        "attachments.json",
        "timeline.json",
        "agent-events.json",
        "agent-usage.json",
        "summary.json",
        "transcript.md",
        "live-state.json",
      ]))
      expect(summary).toMatchObject({
        sessionKey: "[redacted]",
        toolCallCount: 1,
        failedToolCount: 1,
        usageSummary: { totalTokens: 14 },
      })
      expect(manifest.sessionKey).toBe("[redacted]")
      expect(conversationText).toContain("\"sessionKey\": \"[redacted]\"")
      expect(timelineText).toContain("\"sessionKey\": \"[redacted]\"")
      expect(packageText).not.toContain(TEST_SESSION_KEY)
      expect(attachments.messages).toEqual([{
        messageIndex: 0,
        role: "user",
        timestamp: "2026-06-08T08:00:00.500Z",
        contentPreview: "[Image #1]\n\n请看图",
        attachments: [{
          kind: "image",
          mimeType: "image/png",
          name: "chart_watermark.png",
          size: 3,
          sha256: "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81",
          preparedForSdk: true,
        }],
      }])
      expect(eventsText).toContain("toolu-read-1")
      expect(eventsText).toContain("/Users/liyang/project/file.ts")
      expect(eventsText).not.toContain("sk-secret")
      expect(eventsText).not.toContain("[key]")
      expect(timelineText).toContain("toolu-read-1")
      expect(transcript).toContain("Read")
      expect(transcript).toContain("输出")
      expect(transcript).not.toContain("sk-bearer")
      expect(transcript).not.toContain("[key]")
    })

    const service = new AgentConversationExportService({
      conversations,
      agentEvents,
      agentUsage,
      chooseSavePath: vi.fn().mockResolvedValue(outputPath),
      makeTempDir: async () => {
        const staging = await mkdtemp(path.join(tempRoot, "staging-"))
        tempRoots.push(staging)
        return staging
      },
      createZipArchive,
      getTimeline: async () => ({
        projectId: "project-1",
        sessionKey: TEST_SESSION_KEY,
        conversationId: "conv-1",
        entries: [
          {
            id: "tool-call",
            kind: "toolCall",
            toolUseId: "toolu-read-1",
            toolName: "Read",
            toolInputRaw: {
              file_path: "/Users/liyang/project/file.ts",
              ANTHROPIC_AUTH_TOKEN: "sk-secret",
            },
            timestamp: "2026-06-08T08:00:01.000Z",
          },
          {
            id: "tool-result",
            kind: "toolResult",
            toolUseId: "toolu-read-1",
            toolName: "Read",
            content: "Authorization: Bearer sk-bearer failed",
            status: "error",
            success: false,
            timestamp: "2026-06-08T08:00:02.000Z",
          },
        ],
      }),
      getLiveState: async () => ({
        status: {
          projectId: "project-1",
          projectName: "Project",
          agentType: "claude-code",
          liveSessions: 1,
          busySessions: 0,
          queuedTurns: 0,
          pendingPermissions: 0,
        },
        pendingPermissions: [],
      }),
      now: () => new Date("2026-06-08T08:30:00.000Z"),
      removePath: (targetPath) => rm(targetPath, { recursive: true, force: true }),
      auditSink: {
        record: (event) => {
          auditEvents.push(event)
        },
        list: () => [],
        clearForTests: () => {},
      },
    })

    await expect(service.exportBundle({
      projectId: "project-1",
      conversationId: "conv-1",
      sessionKey: TEST_SESSION_KEY,
    })).resolves.toEqual({
      success: true,
      filePath: outputPath,
      fileCount: 8,
    })
    expect(createZipArchive).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(auditEvents)).not.toContain(TEST_SESSION_KEY)
    expect(auditEvents[0]?.metadata).toMatchObject({
      sessionKey: "[redacted]",
    })
  })

  it("exports agent image artifact metadata and copied files", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "synapse-agent-export-artifact-test-"))
    tempRoots.push(tempRoot)
    const outputPath = path.join(tempRoot, "conversation.zip")
    const imagePath = path.join(tempRoot, "artifact-source.png")
    const { writeFile } = await import("node:fs/promises")
    await writeFile(imagePath, Buffer.from([137, 80, 78, 71]))

    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const agentEvents = new MemoryNamespace<AgentEventEntryV1>("agent.events")
    const agentUsage = new MemoryNamespace<AgentUsageEntryV1>("agent.usage")
    const agentArtifacts = new MemoryNamespace<AgentArtifactEntryV1>("agent.artifacts")
    await conversations.upsert(createConversation())
    await agentArtifacts.upsert({
      id: "artifact-1",
      schemaVersion: 1,
      projectId: "project-1",
      conversationId: "conv-1",
      turnId: "turn-1",
      toolUseId: "toolu-read-1",
      toolName: "Read",
      kind: "image",
      mimeType: "image/png",
      byteSize: 4,
      sha256: "a".repeat(64),
      storagePath: imagePath,
      createdAt: "2026-07-03T00:00:00.000Z",
    })

    const createZipArchive = vi.fn(async (sourceDirectoryPath: string) => {
      const artifactsText = await readFile(path.join(sourceDirectoryPath, "agent-artifacts.json"), "utf8")
      const artifacts = JSON.parse(artifactsText) as {
        binaryIncluded: boolean
        artifacts: Array<{ id: string; relativePath: string }>
      }
      expect(artifacts.binaryIncluded).toBe(true)
      expect(artifacts.artifacts).toEqual([expect.objectContaining({
        id: "artifact-1",
        relativePath: "artifacts/artifact-1.png",
      })])
      await expect(readFile(path.join(sourceDirectoryPath, "artifacts", "artifact-1.png")))
        .resolves.toEqual(Buffer.from([137, 80, 78, 71]))
    })

    const service = new AgentConversationExportService({
      conversations,
      agentEvents,
      agentUsage,
      agentArtifacts,
      chooseSavePath: vi.fn().mockResolvedValue(outputPath),
      makeTempDir: async () => {
        const staging = await mkdtemp(path.join(tempRoot, "staging-"))
        tempRoots.push(staging)
        return staging
      },
      createZipArchive,
      now: () => new Date("2026-07-03T00:00:00.000Z"),
      removePath: (targetPath) => rm(targetPath, { recursive: true, force: true }),
    })

    await expect(service.exportBundle({
      projectId: "project-1",
      conversationId: "conv-1",
      sessionKey: TEST_SESSION_KEY,
    })).resolves.toMatchObject({
      success: true,
      filePath: outputPath,
    })
    expect(createZipArchive).toHaveBeenCalledTimes(1)
  })

  it("returns success false when the save dialog is cancelled", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    await conversations.upsert(createConversation())
    const service = new AgentConversationExportService({
      conversations,
      agentEvents: new MemoryNamespace<AgentEventEntryV1>("agent.events"),
      agentUsage: new MemoryNamespace<AgentUsageEntryV1>("agent.usage"),
      chooseSavePath: vi.fn().mockResolvedValue(null),
      createZipArchive: vi.fn(),
    })

    await expect(service.exportBundle({
      projectId: "project-1",
      conversationId: "conv-1",
    })).resolves.toEqual({ success: false })
  })

  it("validates project ownership before opening the save dialog", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    await conversations.upsert({
      ...createConversation(),
      projectId: "other-project",
      name: "Other Project Secret",
      sessionKey: "other-secret-session",
    })
    const chooseSavePath = vi.fn().mockResolvedValue("/tmp/export.zip")
    const service = new AgentConversationExportService({
      conversations,
      agentEvents: new MemoryNamespace<AgentEventEntryV1>("agent.events"),
      agentUsage: new MemoryNamespace<AgentUsageEntryV1>("agent.usage"),
      chooseSavePath,
      createZipArchive: vi.fn(),
    })

    await expect(service.exportBundle({
      projectId: "project-1",
      conversationId: "conv-1",
    })).rejects.toThrow("找不到 Agent 会话。")
    expect(chooseSavePath).not.toHaveBeenCalled()
  })

  it("does not use the session key as the default filename fallback", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    await conversations.upsert({
      ...createConversation(),
      name: undefined,
    })
    const chooseSavePath = vi.fn().mockResolvedValue(null)
    const service = new AgentConversationExportService({
      conversations,
      agentEvents: new MemoryNamespace<AgentEventEntryV1>("agent.events"),
      agentUsage: new MemoryNamespace<AgentUsageEntryV1>("agent.usage"),
      chooseSavePath,
      createZipArchive: vi.fn(),
      now: () => new Date("2026-06-08T08:30:00.000Z"),
    })

    await expect(service.exportBundle({
      projectId: "project-1",
      conversationId: "conv-1",
      sessionKey: TEST_SESSION_KEY,
    })).resolves.toEqual({ success: false })
    expect(chooseSavePath).toHaveBeenCalledWith(expect.stringContaining("conv-1"))
    expect(chooseSavePath.mock.calls[0]?.[0]).not.toContain(TEST_SESSION_KEY)
  })

  it("exports every stored assistant message when rebuilding transcript from history", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "synapse-agent-export-transcript-test-"))
    tempRoots.push(tempRoot)
    const outputPath = path.join(tempRoot, "conversation.zip")
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    await conversations.upsert({
      ...createConversation(),
      history: [
        {
          role: "user",
          content: "评估一下",
          timestamp: "2026-06-26T00:30:00.000Z",
        },
        {
          role: "assistant",
          content: "正式评估正文",
          timestamp: "2026-06-26T00:30:09.000Z",
          metadata: { agentEventType: "assistant", sdkSessionId: "sdk-1" },
        },
        {
          role: "tool",
          content: "Skill\n{\"skill\":\"sy-worklog\"}",
          timestamp: "2026-06-26T00:30:11.000Z",
          metadata: {
            agentEventType: "toolUse",
            toolUseId: "toolu-1",
            toolName: "Skill",
          },
        },
        {
          role: "tool",
          content: "ok",
          timestamp: "2026-06-26T00:30:27.000Z",
          metadata: {
            agentEventType: "toolResult",
            toolUseId: "toolu-1",
            toolName: "Skill",
            success: true,
          },
        },
        {
          role: "assistant",
          content: "工作记录已写入。",
          timestamp: "2026-06-26T00:30:30.000Z",
          metadata: {
            agentEventType: "assistant",
            sdkSessionId: "sdk-1",
            model: "claude-sonnet-4-5",
          },
        },
      ],
    })
    const createZipArchive = vi.fn(async (sourceDirectoryPath: string) => {
      const transcript = await readFile(path.join(sourceDirectoryPath, "transcript.md"), "utf8")
      expect(transcript).toContain("正式评估正文")
      expect(transcript).toContain("工作记录已写入。")
      expect(transcript.indexOf("正式评估正文")).toBeLessThan(transcript.indexOf("工作记录已写入。"))
    })

    const service = new AgentConversationExportService({
      conversations,
      agentEvents: new MemoryNamespace<AgentEventEntryV1>("agent.events"),
      agentUsage: new MemoryNamespace<AgentUsageEntryV1>("agent.usage"),
      chooseSavePath: vi.fn().mockResolvedValue(outputPath),
      createZipArchive,
      makeTempDir: async () => {
        const staging = await mkdtemp(path.join(tempRoot, "staging-"))
        tempRoots.push(staging)
        return staging
      },
      now: () => new Date("2026-06-26T00:31:00.000Z"),
      removePath: (targetPath) => rm(targetPath, { recursive: true, force: true }),
    })

    await expect(service.exportBundle({
      projectId: "project-1",
      conversationId: "conv-1",
      sessionKey: TEST_SESSION_KEY,
    })).resolves.toMatchObject({
      success: true,
      filePath: outputPath,
    })
    expect(createZipArchive).toHaveBeenCalledTimes(1)
  })

  it("includes main-thread persona labels in exported transcript", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "synapse-agent-export-persona-test-"))
    tempRoots.push(tempRoot)
    const outputPath = path.join(tempRoot, "conversation.zip")
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    await conversations.upsert({
      ...createConversation(),
      history: [
        {
          role: "user",
          content: "Translate this",
          timestamp: "2026-06-30T00:00:00.000Z",
          metadata: {
            mainThreadPersona: {
              id: "builtin-zh-en-translator",
              name: "中英翻译",
              source: "builtin",
              definitionHash: "hash-translator",
            },
          },
        },
        {
          role: "assistant",
          content: "Hello",
          timestamp: "2026-06-30T00:00:01.000Z",
          metadata: {
            agentEventType: "assistant",
            mainThreadPersona: {
              id: "builtin-zh-en-translator",
              name: "中英翻译",
              source: "builtin",
              definitionHash: "hash-translator",
            },
          },
        },
      ],
    })
    const createZipArchive = vi.fn(async (sourceDirectoryPath: string) => {
      const transcript = await readFile(path.join(sourceDirectoryPath, "transcript.md"), "utf8")
      expect(transcript).toContain("[中英翻译]")
      expect(transcript).toContain("Hello")
    })

    const service = new AgentConversationExportService({
      conversations,
      agentEvents: new MemoryNamespace<AgentEventEntryV1>("agent.events"),
      agentUsage: new MemoryNamespace<AgentUsageEntryV1>("agent.usage"),
      chooseSavePath: vi.fn().mockResolvedValue(outputPath),
      createZipArchive,
      makeTempDir: async () => {
        const staging = await mkdtemp(path.join(tempRoot, "staging-"))
        tempRoots.push(staging)
        return staging
      },
      now: () => new Date("2026-06-30T00:01:00.000Z"),
      removePath: (targetPath) => rm(targetPath, { recursive: true, force: true }),
    })

    await expect(service.exportBundle({
      projectId: "project-1",
      conversationId: "conv-1",
      sessionKey: TEST_SESSION_KEY,
    })).resolves.toMatchObject({
      success: true,
      filePath: outputPath,
    })
    expect(createZipArchive).toHaveBeenCalledTimes(1)
  })

  it("bounds default bundle and staging directory names for long conversation names", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "synapse-agent-export-long-name-test-"))
    tempRoots.push(tempRoot)
    const outputPath = path.join(tempRoot, "short.zip")
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    await conversations.upsert({
      ...createConversation(),
      name: `Debug ${"x".repeat(180)}`,
    })
    const createZipArchive = vi.fn(async (sourceDirectoryPath: string, targetPath: string) => {
      expect(targetPath).toBe(outputPath)
      expect(path.basename(sourceDirectoryPath).length).toBeLessThanOrEqual(160)
    })

    const service = new AgentConversationExportService({
      conversations,
      agentEvents: new MemoryNamespace<AgentEventEntryV1>("agent.events"),
      agentUsage: new MemoryNamespace<AgentUsageEntryV1>("agent.usage"),
      chooseSavePath: vi.fn(async (defaultFileName: string) => {
        expect(defaultFileName.length).toBeLessThanOrEqual(160)
        return outputPath
      }),
      createZipArchive,
      makeTempDir: async () => {
        const staging = await mkdtemp(path.join(tempRoot, "staging-"))
        tempRoots.push(staging)
        return staging
      },
      now: () => new Date("2026-06-08T08:30:00.000Z"),
      removePath: (targetPath) => rm(targetPath, { recursive: true, force: true }),
    })

    await expect(service.exportBundle({
      projectId: "project-1",
      conversationId: "conv-1",
      sessionKey: TEST_SESSION_KEY,
    })).resolves.toMatchObject({
      success: true,
      filePath: outputPath,
    })
    expect(createZipArchive).toHaveBeenCalledTimes(1)
  })

  it("serializes cyclic runtime timeline values without blocking export", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "synapse-agent-export-cycle-test-"))
    tempRoots.push(tempRoot)
    const outputPath = path.join(tempRoot, "conversation.zip")
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const conversation = createConversation()
    await conversations.upsert(conversation)

    const cyclicInput: Record<string, unknown> = {
      file_path: "/Users/liyang/project/file.ts",
      token: "sk-secret",
    }
    cyclicInput.self = cyclicInput

    const createZipArchive = vi.fn(async (sourceDirectoryPath: string) => {
      const timelineText = await readFile(path.join(sourceDirectoryPath, "timeline.json"), "utf8")
      expect(timelineText).toContain("[Circular]")
      expect(timelineText).not.toContain("sk-secret")
    })

    const service = new AgentConversationExportService({
      conversations,
      agentEvents: new MemoryNamespace<AgentEventEntryV1>("agent.events"),
      agentUsage: new MemoryNamespace<AgentUsageEntryV1>("agent.usage"),
      chooseSavePath: vi.fn().mockResolvedValue(outputPath),
      createZipArchive,
      getTimeline: async () => ({
        projectId: "project-1",
        sessionKey: TEST_SESSION_KEY,
        conversationId: "conv-1",
        entries: [{
          id: "tool-call",
          kind: "toolCall",
          toolUseId: "toolu-read-1",
          toolName: "Read",
          toolInputRaw: cyclicInput,
          timestamp: "2026-06-08T08:00:01.000Z",
        }],
      }),
      makeTempDir: async () => {
        const staging = await mkdtemp(path.join(tempRoot, "staging-"))
        tempRoots.push(staging)
        return staging
      },
      now: () => new Date("2026-06-08T08:30:00.000Z"),
      removePath: (targetPath) => rm(targetPath, { recursive: true, force: true }),
    })

    await expect(service.exportBundle({
      projectId: "project-1",
      conversationId: "conv-1",
      sessionKey: TEST_SESSION_KEY,
    })).resolves.toMatchObject({
      success: true,
      filePath: outputPath,
    })
    expect(createZipArchive).toHaveBeenCalledTimes(1)
  })
})

function createConversation(): ConversationEntryV1 {
  return {
    id: "conv-1",
    schemaVersion: 1,
    projectId: "project-1",
    sessionKey: TEST_SESSION_KEY,
    providerId: "anthropic",
    sdkSessionId: "sdk-1",
    usage: {
      inputTokens: 10,
      outputTokens: 4,
      totalTokens: 14,
    },
    costCny: 0.01,
    costCurrency: "CNY",
    agentType: "claude-code",
    history: [
      {
        role: "user",
        content: "[Image #1]\n\n请看图",
        timestamp: "2026-06-08T08:00:00.500Z",
        metadata: {
          attachments: [{
            kind: "image",
            mimeType: "image/png",
            name: "chart_watermark.png",
            size: 3,
            sha256: "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81",
            preparedForSdk: true,
          }],
        },
      },
      {
        role: "tool",
        content: "Read\n{\"file_path\":\"/Users/liyang/project/file.ts\"}",
        timestamp: "2026-06-08T08:00:01.000Z",
        metadata: {
          agentEventType: "toolUse",
          toolUseId: "toolu-read-1",
          toolName: "Read",
        },
      },
    ],
    active: true,
    name: "Debug Session",
    createdAt: "2026-06-08T08:00:00.000Z",
    updatedAt: "2026-06-08T08:10:00.000Z",
  }
}

class MemoryNamespace<T extends { id: string }> implements DataNamespace<T> {
  readonly schemaVersion = 1
  readonly backend = "sqlite" as const
  private singleton: T | null = null
  private readonly items = new Map<string, T>()

  constructor(readonly name: string) {}

  async getSingleton(): Promise<T | null> {
    return this.singleton
  }

  async setSingleton(value: T): Promise<void> {
    this.singleton = value
  }

  async list(filter?: Partial<T>): Promise<T[]> {
    const entries = [...this.items.values()]
    if (!filter) return entries
    return entries.filter((entry) =>
      Object.entries(filter).every(([key, value]) => entry[key as keyof T] === value))
  }

  async get(id: string): Promise<T | null> {
    return this.items.get(id) ?? null
  }

  async upsert(item: T & { id: string }): Promise<void> {
    this.items.set(item.id, item)
  }

  async remove(id: string): Promise<void> {
    this.items.delete(id)
  }

  onChange(): () => void {
    return () => {}
  }
}
