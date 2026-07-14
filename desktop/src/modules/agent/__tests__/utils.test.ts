import { describe, expect, it } from "vitest"

import {
  formatAgentHeaderModelLabel,
  formatAgentTranscript,
  formatEntryTime,
  sessionLabel,
  thinkingIndicatorText,
} from "../utils"

describe("agent utils", () => {
  it("cycles the waiting indicator text through three middle dots", () => {
    expect([0, 1, 2, 3, 4, 5].map(thinkingIndicatorText)).toEqual([
      "thinking",
      "thinking·",
      "thinking··",
      "thinking···",
      "thinking",
      "thinking·",
    ])
  })

  it("uses source labels for unnamed external session rows", () => {
    expect(sessionLabel({
      projectId: "project-1",
      id: "external-conv",
      sessionKey: "external:group:user",
      platform: "external",
      sourceLabel: "Dev Group / User One",
      active: true,
      historyCount: 0,
      createdAt: "2026-04-27T00:00:00.000Z",
      updatedAt: "2026-04-27T01:00:00.000Z",
    })).toBe("Dev Group / User One")

    expect(sessionLabel({
      projectId: "project-1",
      id: "named-conv",
      sessionKey: "local:named",
      name: "Named Session",
      sourceLabel: "Source Label",
      active: true,
      historyCount: 0,
      createdAt: "2026-04-27T00:00:00.000Z",
      updatedAt: "2026-04-27T01:00:00.000Z",
    })).toBe("Named Session")

    expect(sessionLabel({
      projectId: "project-1",
      id: "source-conv",
      sessionKey: "local:source",
      sourceLabel: "Source Label",
      active: true,
      historyCount: 0,
      createdAt: "2026-04-27T00:00:00.000Z",
      updatedAt: "2026-04-27T01:00:00.000Z",
    })).toBe("Source Label")

    expect(sessionLabel({
      projectId: "project-1",
      id: "key-conv",
      sessionKey: "local:key",
      active: true,
      historyCount: 0,
      createdAt: "2026-04-27T00:00:00.000Z",
      updatedAt: "2026-04-27T01:00:00.000Z",
    })).toBe("local:key")
  })

  it("formats the Agent header provider and selected model", () => {
    expect(formatAgentHeaderModelLabel({
      provider: {
        id: "bailian",
        display: "百炼",
        active: true,
        model: "qwen-main",
        sonnetModel: "qwen-sonnet",
        scope: "global",
      },
      modelTier: "sonnet",
    })).toBe("百炼 qwen-sonnet")
  })

  it("keeps the runtime model visible when the SDK reports one", () => {
    expect(formatAgentHeaderModelLabel({
      currentConversationModel: "claude-sonnet-4-5",
      provider: {
        id: "bailian",
        display: "百炼",
        active: true,
        model: "qwen-main",
        scope: "global",
      },
      modelTier: "default",
    })).toBe("百炼 claude-sonnet-4-5")
  })

  it("formats the current conversation for clipboard copy", () => {
    const entries = [
      {
        id: "one",
        kind: "message",
        role: "user",
        content: "你好",
        timestamp: "2026-04-27T03:15:00.000Z",
      },
      {
        id: "two",
        kind: "message",
        role: "assistant",
        content: "第一行\n第二行",
        timestamp: "2026-04-27T03:16:00.000Z",
      },
      {
        id: "three",
        kind: "toolCall",
        toolName: "read_file",
        timestamp: "2026-04-27T03:17:00.000Z",
      },
    ] as const

    expect(formatAgentTranscript(entries)).toBe([
      `用户 ${formatEntryTime(entries[0].timestamp)}`,
      "你好",
      "",
      `Agent ${formatEntryTime(entries[1].timestamp)}`,
      "第一行\n第二行",
      "",
      `工具 ${formatEntryTime(entries[2].timestamp)}`,
      "read_file",
    ].join("\n"))
  })

  it("exports native slash passthrough annotations without user arguments", () => {
    const entries = [
      {
        id: "native-slash",
        kind: "sdkEvent",
        sdkType: "nativeSlashPassthrough",
        sdkSubtype: "/wiki-ingest",
        label: "Native slash",
        summary: "/wiki-ingest",
        timestamp: "2026-05-31T03:15:00.000Z",
      },
    ] as const

    expect(formatAgentTranscript(entries)).toBe([
      `SDK ${formatEntryTime(entries[0].timestamp)}`,
      "nativeSlashPassthrough /wiki-ingest",
    ].join("\n"))
  })

  it("groups tool call and result transcript output with readable file paths", () => {
    const entries = [
      {
        id: "tool-1",
        kind: "toolCall",
        toolUseId: "toolu-read-1",
        toolName: "Read",
        toolInputRaw: {
          file_path: "/Users/liyang/project/secret.txt",
          ANTHROPIC_AUTH_TOKEN: "sk-auth",
        },
        timestamp: "2026-04-27T03:17:00.000Z",
      },
      {
        id: "result-1",
        kind: "toolResult",
        toolUseId: "toolu-read-1",
        toolName: "Read",
        content: "file content",
        status: "success",
        success: true,
        timestamp: "2026-04-27T03:17:01.000Z",
      },
    ] as const

    const transcript = formatAgentTranscript(entries)

    expect(transcript).toContain(`工具 ${formatEntryTime(entries[0].timestamp)}`)
    expect(transcript).toContain('"file_path": "/Users/liyang/project/secret.txt"')
    expect(transcript).toContain('"ANTHROPIC_AUTH_TOKEN": "[redacted]"')
    expect(transcript).toContain("输出\nfile content")
    expect(transcript).not.toContain("sk-auth")
    expect(transcript.match(/工具/g)).toHaveLength(1)
  })

  it("groups out-of-order same-name tool results by tool use id", () => {
    const entries = [
      {
        id: "tool-a",
        kind: "toolCall",
        toolUseId: "toolu-read-a",
        toolName: "Read",
        toolInputRaw: { file_path: "/Users/liyang/project/a.md" },
        timestamp: "2026-04-27T03:17:00.000Z",
      },
      {
        id: "tool-b",
        kind: "toolCall",
        toolUseId: "toolu-read-b",
        toolName: "Read",
        toolInputRaw: { file_path: "/Users/liyang/project/b.md" },
        timestamp: "2026-04-27T03:17:01.000Z",
      },
      {
        id: "result-b",
        kind: "toolResult",
        toolUseId: "toolu-read-b",
        toolName: "Read",
        content: "content b",
        status: "success",
        success: true,
        timestamp: "2026-04-27T03:17:02.000Z",
      },
      {
        id: "result-a",
        kind: "toolResult",
        toolUseId: "toolu-read-a",
        toolName: "Read",
        content: "content a",
        status: "success",
        success: true,
        timestamp: "2026-04-27T03:17:03.000Z",
      },
    ] as const

    const transcript = formatAgentTranscript(entries)

    expect(transcript).toContain('"file_path": "/Users/liyang/project/a.md"\n}\n\n输出\ncontent a')
    expect(transcript).toContain('"file_path": "/Users/liyang/project/b.md"\n}\n\n输出\ncontent b')
    expect(transcript).not.toContain('"file_path": "/Users/liyang/project/a.md"\n}\n\n输出\ncontent b')
    expect(transcript).not.toContain('"file_path": "/Users/liyang/project/b.md"\n}\n\n输出\ncontent a')
    expect(transcript.match(/工具/g)).toHaveLength(2)
  })

  it("does not attach identified tool results to legacy tool calls without tool use ids", () => {
    const entries = [
      {
        id: "legacy-tool",
        kind: "toolCall",
        toolName: "Read",
        toolInputRaw: { file_path: "/Users/liyang/project/legacy.md" },
        timestamp: "2026-04-27T03:17:00.000Z",
      },
      {
        id: "result-new",
        kind: "toolResult",
        toolUseId: "toolu-new",
        toolName: "Read",
        content: "new content",
        status: "success",
        success: true,
        timestamp: "2026-04-27T03:17:01.000Z",
      },
    ] as const

    const transcript = formatAgentTranscript(entries)

    expect(transcript).not.toContain('"file_path": "/Users/liyang/project/legacy.md"\n}\n\n输出\nnew content')
    expect(transcript.match(/工具/g)).toHaveLength(2)
  })

  it("uses tool use ids before tool names when grouping identified results", () => {
    const entries = [
      {
        id: "tool-1",
        kind: "toolCall",
        toolUseId: "toolu-same",
        toolName: "tool_result",
        toolInputRaw: { value: "placeholder name before resolution" },
        timestamp: "2026-04-27T03:17:00.000Z",
      },
      {
        id: "result-1",
        kind: "toolResult",
        toolUseId: "toolu-same",
        toolName: "Read",
        content: "resolved output",
        status: "success",
        success: true,
        timestamp: "2026-04-27T03:17:01.000Z",
      },
    ] as const

    const transcript = formatAgentTranscript(entries)

    expect(transcript).toContain('"value": "placeholder name before resolution"\n}\n\n输出\nresolved output')
    expect(transcript.match(/工具/g)).toHaveLength(1)
  })

  it("keeps legacy tool result fallback for entries without tool use ids", () => {
    const entries = [
      {
        id: "legacy-tool",
        kind: "toolCall",
        toolName: "Read",
        toolInputRaw: { file_path: "/Users/liyang/project/legacy.md" },
        timestamp: "2026-04-27T03:17:00.000Z",
      },
      {
        id: "legacy-result",
        kind: "toolResult",
        toolName: "Read",
        content: "legacy content",
        status: "success",
        success: true,
        timestamp: "2026-04-27T03:17:01.000Z",
      },
    ] as const

    const transcript = formatAgentTranscript(entries)

    expect(transcript).toContain('"file_path": "/Users/liyang/project/legacy.md"\n}\n\n输出\nlegacy content')
    expect(transcript.match(/工具/g)).toHaveLength(1)
  })

  it("redacts secret-shaped values in copied transcripts", () => {
    const entries = [{
      id: "tool-secret",
      kind: "toolCall",
      toolName: "Bash",
      toolInput: "ANTHROPIC_API_KEY=sk-api SYNAPSE_SIDE_CHANNEL_TOKEN=side-token curl -H 'Authorization: Bearer sk-bearer'",
      timestamp: "2026-04-27T03:17:00.000Z",
    }] as const

    const transcript = formatAgentTranscript(entries)

    expect(transcript).toContain("[redacted]")
    expect(transcript).not.toContain("sk-api")
    expect(transcript).not.toContain("side-token")
    expect(transcript).not.toContain("sk-bearer")
  })

  it("redacts secret-shaped tool result output in copied transcripts", () => {
    const entries = [{
      id: "tool-result-secret",
      kind: "toolResult",
      toolName: "Bash",
      content: [
        "ANTHROPIC_AUTH_TOKEN=sk-auth",
        "SYNAPSE_SIDE_CHANNEL_TOKEN=side-token",
        "Authorization: Bearer sk-bearer failed at /Users/liyang/project/file.ts",
        "{\"token\":\"data-server-token\"}",
      ].join("\n"),
      status: "success",
      success: true,
      timestamp: "2026-04-27T03:17:00.000Z",
    }] as const

    const transcript = formatAgentTranscript(entries)

    expect(transcript).toContain("[redacted]")
    expect(transcript).toContain("/Users/liyang/project/file.ts")
    expect(transcript).not.toContain("sk-auth")
    expect(transcript).not.toContain("side-token")
    expect(transcript).not.toContain("sk-bearer")
    expect(transcript).not.toContain("data-server-token")
  })

  it("labels AskUserQuestion transcript entries as pending answers", () => {
    const entries = [{
      id: "question-1",
      kind: "permissionRequest",
      requestId: "request-1",
      toolName: "AskUserQuestion",
      timestamp: "2026-04-27T03:18:00.000Z",
      questions: [{
        header: "Pick one",
        question: "你最想学哪门编程语言？",
        options: [
          { label: "Python", description: "AI/数据科学" },
          { label: "TypeScript", description: "前端全栈" },
        ],
        multiSelect: false,
      }],
    }] as const

    const transcript = formatAgentTranscript(entries)

    expect(transcript).toContain(`待回答 ${formatEntryTime(entries[0].timestamp)}`)
    expect(transcript).toContain("Pick one: 你最想学哪门编程语言？")
    expect(transcript).toContain("- Python: AI/数据科学")
    expect(transcript).not.toContain("权限")
  })

  it("includes resolved AskUserQuestion answers in copied transcripts", () => {
    const entries = [{
      id: "question-1",
      kind: "permissionRequest",
      requestId: "request-1",
      toolName: "AskUserQuestion",
      timestamp: "2026-04-27T03:18:00.000Z",
      questions: [{
        question: "选择处理范围",
        options: [{ label: "文档, 图片" }, { label: "音频" }],
        multiSelect: true,
      }],
      resolution: {
        status: "answered",
        resolvedAt: "2026-04-27T03:19:00.000Z",
        answers: [{ questionIndex: 0, values: ["文档, 图片", "音频"] }],
      },
    }] as const

    const transcript = formatAgentTranscript(entries)

    expect(transcript).toContain(`已回答 ${formatEntryTime(entries[0].timestamp)}`)
    expect(transcript).toContain("回答：文档, 图片、音频")
  })

  it("omits malformed timestamps from copied transcripts", () => {
    const entries = [
      {
        id: "bad-time",
        kind: "message",
        role: "assistant",
        content: "SDK result still readable",
        timestamp: "not-a-date",
      },
    ] as const

    const transcript = formatAgentTranscript(entries)

    expect(transcript).toBe([
      "Agent",
      "SDK result still readable",
    ].join("\n"))
    expect(transcript).not.toContain("Invalid Date")
    expect(transcript).not.toContain("NaN")
  })
})
