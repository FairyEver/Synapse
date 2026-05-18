import { describe, expect, it } from "vitest"

import {
  agentCliLabel,
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

  it("formats agent cli names for compact display", () => {
    expect(agentCliLabel("codex")).toBe("codex")
    expect(agentCliLabel("claude-code")).toBe("claudecode")
    expect(agentCliLabel("claude-sdk")).toBe("claudecode")
    expect(agentCliLabel("claude-agent-sdk")).toBe("claudecode")
    expect(agentCliLabel(undefined)).toBeUndefined()
  })

  it("uses source labels for Feishu session rows", () => {
    expect(sessionLabel({
      projectId: "project-1",
      id: "feishu-conv",
      sessionKey: "feishu:oc_group:ou_user",
      platform: "feishu",
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
