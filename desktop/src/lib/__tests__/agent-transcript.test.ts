import { describe, expect, it } from "vitest"

import { formatAgentTranscript } from "../agent-transcript"

describe("agent transcript helpers", () => {
  it("exports cancelled turn outcome copy instead of raw SDK abort diagnostics", () => {
    const transcript = formatAgentTranscript([{
      id: "result-1",
      kind: "result",
      content: "",
      timestamp: "2026-06-11T00:00:00.000Z",
      metadata: {
        cancelled: true,
        turnOutcome: {
          status: "cancelled",
          mode: "graceful",
          reason: "user_cancelled",
          message: "已停止本次执行。",
          diagnostics: [{
            source: "claude-sdk",
            kind: "aborted",
            message: "Request was aborted",
          }],
        },
      },
    }])

    expect(transcript).toContain("已停止本次执行。")
    expect(transcript).not.toContain("Request was aborted")
  })

  it("keeps paths and tool use ids useful while redacting secret-shaped values", () => {
    const transcript = formatAgentTranscript([
      {
        id: "tool-call",
        kind: "toolCall",
        toolUseId: "toolu-read-1",
        toolName: "Read",
        toolInputRaw: {
          file_path: "/Users/liyang/project/file.ts",
          ANTHROPIC_AUTH_TOKEN: "sk-secret",
        },
        timestamp: "2026-06-08T08:00:00.000Z",
      },
      {
        id: "tool-result",
        kind: "toolResult",
        toolUseId: "toolu-read-1",
        toolName: "Read",
        content: "Authorization: Bearer sk-bearer\nok /Users/liyang/project/file.ts",
        status: "success",
        success: true,
        timestamp: "2026-06-08T08:00:01.000Z",
      },
    ])

    expect(transcript).toContain('"file_path": "/Users/liyang/project/file.ts"')
    expect(transcript).toContain('"ANTHROPIC_AUTH_TOKEN": "[redacted]"')
    expect(transcript).toContain("输出")
    expect(transcript).toContain("/Users/liyang/project/file.ts")
    expect(transcript).not.toContain("sk-secret")
    expect(transcript).not.toContain("sk-bearer")
  })

  it("mentions image artifacts in tool result transcript text", () => {
    const transcript = formatAgentTranscript([{
      id: "tool-result",
      kind: "toolResult",
      toolUseId: "toolu-read-1",
      toolName: "Read",
      imageArtifacts: [{
        id: "artifact-1",
        kind: "image",
        mimeType: "image/png",
        byteSize: 4,
        url: "/tmp/artifact-1.png",
      }],
      status: "success",
      success: true,
      timestamp: "2026-07-03T00:00:00.000Z",
    }])

    expect(transcript).toContain("Read")
    expect(transcript).toContain("image/png")
    expect(transcript).toContain("artifact-1")
  })
})
