import { describe, expect, it } from "vitest"

import { formatAgentTranscript } from "../agent-transcript"

describe("agent transcript helpers", () => {
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
})
